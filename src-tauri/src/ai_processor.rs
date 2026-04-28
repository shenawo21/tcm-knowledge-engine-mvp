use std::env;
use std::time::{Duration, Instant};

use reqwest::Client;
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::models::{AiCallOutcome, AiModelConfigRow, AiResult, TestConnectionResult};

const DEFAULT_BASE_URL: &str = "https://api.openai.com";
const DEFAULT_MODEL: &str = "gpt-4o-mini";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_TOKENS: u32 = 1800;
pub const PROMPT_VERSION: &str = "TCM_STRUCTURER_V2";

const SYSTEM_PROMPT: &str = r#"You are a TCM (Traditional Chinese Medicine) knowledge extraction assistant.
Given a Chinese medicine text, extract entities and relationships and return ONLY a JSON object with this exact structure (no markdown, no code blocks):

{
  "content_type": "tcm_material",
  "summary": {
    "one_sentence": "one-sentence summary of the text",
    "key_points": ["key point 1", "key point 2"],
    "learning_value": "learning value assessment"
  },
  "entities": [
    {"type": "formula|herb|syndrome|symptom|pattern|treatment|concept", "name": "entity name", "confidence": 0.0}
  ],
  "relations": [
    {"from": "entity_name", "relation_type": "treats|contains|indicates|belongs_to|contraindicates", "to": "entity_name", "confidence": 0.0}
  ],
  "western_mapping": [
    {"tcm": "tcm concept", "western": "western medicine equivalent", "mapping_level": "source_fact|reasonable_inference|hypothesis|uncertain"}
  ],
  "review": {
    "level": "A",
    "decision": "direct_import|import_with_label|hold_for_review",
    "reason": "brief justification"
  }
}

Review levels: A = classical source or well-evidenced, B = modern/reasonable, C = uncertain or low-quality source.
Confidence scale: >= 0.85 = directly stated in source text; 0.50–0.84 = reasonably inferred, will be flagged for human review; < 0.50 = uncertain, omit unless significant. Do not fabricate entities or relationships; fewer honest entries are better than more invented ones.
For western_mapping: use "source_fact" only when the source text explicitly states the biomedical equivalence; use "reasonable_inference" for well-accepted cross-system mappings; use "hypothesis" for speculative or emerging connections; use "uncertain" when there is no clear basis. Never invent biomedical mechanisms not present or clearly implied by the source text. All western_mapping entries will be flagged for human review regardless of mapping_level.
STRICT OUTPUT LIMITS (prioritise the most important items to stay within token budget): entities ≤ 20, relations ≤ 20, western_mapping ≤ 5, key_points ≤ 5. The JSON must be complete and valid — no trailing commas, no truncation, no ellipsis. If you cannot fit all items, drop the least important ones entirely.
Return ONLY valid JSON. No explanation, no markdown, no code fences."#;

pub fn normalize_input(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn compute_cache_key(
    prompt_version: &str,
    prompt_type: &str,
    model_name: &str,
    api_type: &str,
    normalized_input: &str,
) -> String {
    let mut h = Sha256::new();
    h.update(prompt_version.as_bytes());
    h.update(b"\0");
    h.update(prompt_type.as_bytes());
    h.update(b"\0");
    h.update(model_name.as_bytes());
    h.update(b"\0");
    h.update(api_type.as_bytes());
    h.update(b"\0");
    h.update(normalized_input.as_bytes());
    hex::encode(h.finalize())
}

/// Primary AI processing — DB config takes priority, falls back to env vars.
/// Returns AiCallOutcome which always carries token usage (even on content failure).
/// Outer Err is reserved for network/transport failures where no usage data exists.
pub async fn process(
    input_text: &str,
    config: Option<AiModelConfigRow>,
) -> Result<AiCallOutcome, String> {
    let (api_key, base_url, model_name, api_type) = resolve_credentials(config)?;
    make_ai_request(input_text, &api_key, &base_url, &model_name, &api_type).await
}

/// Connection smoke-test — returns TestConnectionResult (never Err on API errors,
/// only Err on IPC-level failures so the frontend always gets a structured result).
pub async fn test_connection(config: &AiModelConfigRow) -> Result<TestConnectionResult, String> {
    let client = build_client()?;
    let url = build_endpoint_url(&config.base_url, &config.api_type);

    let body = match config.api_type.as_str() {
        "responses" => serde_json::json!({
            "model": config.model_name,
            "input": "ping",
            "max_output_tokens": 5
        }),
        _ => serde_json::json!({
            "model": config.model_name,
            "messages": [{"role": "user", "content": "ping"}],
            "max_tokens": 5
        }),
    };

    let start = Instant::now();
    match client
        .post(&url)
        .header("Authorization", format!("Bearer {}", config.api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
    {
        Err(e) => Ok(TestConnectionResult {
            success: false,
            message: format!("连接失败: {e}"),
            latency_ms: Some(start.elapsed().as_millis() as u64),
        }),
        Ok(resp) => {
            let latency_ms = start.elapsed().as_millis() as u64;
            let status = resp.status();
            if status.is_success() {
                Ok(TestConnectionResult {
                    success: true,
                    message: format!("连接成功（{}ms，HTTP {}）", latency_ms, status),
                    latency_ms: Some(latency_ms),
                })
            } else {
                let body_text = resp.text().await.unwrap_or_default();
                Ok(TestConnectionResult {
                    success: false,
                    message: format!("API 返回 {}: {}", status, body_text),
                    latency_ms: Some(latency_ms),
                })
            }
        }
    }
}

// ─── private helpers ──────────────────────────────────────────────────────────

fn resolve_credentials(
    config: Option<AiModelConfigRow>,
) -> Result<(String, String, String, String), String> {
    if let Some(c) = config {
        let api_key = c.api_key.trim().to_string();
        if api_key.is_empty() {
            return Err("已激活模型配置中的 API Key 为空，请在模型设置页更新。".to_string());
        }
        return Ok((api_key, c.base_url, c.model_name, c.api_type));
    }
    // Fallback to env vars (backwards-compat with .env / OPENAI_API_KEY)
    let api_key = env::var("OPENAI_API_KEY")
        .map_err(|_| "未配置可用模型，请先到「模型设置」页添加配置并设为激活。".to_string())?;
    let api_key = api_key.trim().to_string();
    if api_key.is_empty() {
        return Err("OPENAI_API_KEY 环境变量为空，请检查配置。".to_string());
    }
    let base_url = env::var("OPENAI_BASE_URL").unwrap_or_else(|_| DEFAULT_BASE_URL.to_string());
    let model = env::var("OPENAI_MODEL").unwrap_or_else(|_| DEFAULT_MODEL.to_string());
    Ok((api_key, base_url, model, "chat_completions".to_string()))
}

fn build_client() -> Result<Client, String> {
    Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|e| format!("HTTP 客户端初始化失败: {e}"))
}

fn build_endpoint_url(base_url: &str, api_type: &str) -> String {
    let base = base_url.trim_end_matches('/');
    let path = if api_type == "responses" {
        "responses"
    } else {
        "chat/completions"
    };
    if base.ends_with("/v1") {
        format!("{}/{}", base, path)
    } else {
        format!("{}/v1/{}", base, path)
    }
}

fn strip_markdown(s: &str) -> &str {
    let s = s.trim();
    let s = s.strip_prefix("```json").unwrap_or(s);
    let s = s.strip_prefix("```").unwrap_or(s);
    let s = s.strip_suffix("```").unwrap_or(s);
    s.trim()
}

fn extract_content(value: &Value, api_type: &str) -> Result<String, String> {
    if api_type == "responses" {
        value["output"][0]["content"][0]["text"]
            .as_str()
            .or_else(|| value["output_text"].as_str())
            .map(str::to_owned)
            .ok_or_else(|| "Responses API 响应中未找到文本输出字段".to_string())
    } else {
        value["choices"][0]["message"]["content"]
            .as_str()
            .map(str::to_owned)
            .ok_or_else(|| "Chat Completions API 响应中缺少 content 字段".to_string())
    }
}

async fn make_ai_request(
    input_text: &str,
    api_key: &str,
    base_url: &str,
    model_name: &str,
    api_type: &str,
) -> Result<AiCallOutcome, String> {
    let client = build_client()?;
    let url = build_endpoint_url(base_url, api_type);

    let body = match api_type {
        "responses" => serde_json::json!({
            "model": model_name,
            "instructions": SYSTEM_PROMPT,
            "input": input_text,
            "max_output_tokens": MAX_TOKENS,
        }),
        _ => serde_json::json!({
            "model": model_name,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": input_text}
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.3,
            "max_tokens": MAX_TOKENS,
        }),
    };

    let response = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("API 请求失败: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let body_text = response.text().await.unwrap_or_default();
        return Err(format!("API 返回错误 {status}: {body_text}"));
    }

    let response_value: Value = response
        .json()
        .await
        .map_err(|e| format!("解析 API 响应失败: {e}"))?;

    // Parse usage — failure must not interrupt the main flow.
    let input_tokens = response_value["usage"]["prompt_tokens"]
        .as_i64()
        .or_else(|| response_value["usage"]["input_tokens"].as_i64())
        .unwrap_or(0);
    let output_tokens = response_value["usage"]["completion_tokens"]
        .as_i64()
        .or_else(|| response_value["usage"]["output_tokens"].as_i64())
        .unwrap_or(0);

    // Check finish_reason before attempting JSON parse.
    let finish_reason = response_value["choices"][0]["finish_reason"]
        .as_str()
        .or_else(|| response_value["incomplete_details"]["reason"].as_str())
        .unwrap_or("");

    if finish_reason == "length" {
        return Ok(AiCallOutcome {
            result: Err(
                "AI 输出达到 max_tokens 限制，JSON 可能被截断。请缩短输入或稍后重试。"
                    .to_string(),
            ),
            input_tokens,
            output_tokens,
        });
    }

    let content = extract_content(&response_value, api_type)?;
    let clean = strip_markdown(&content);

    let result = match serde_json::from_str::<AiResult>(clean) {
        Ok(r) => r,
        Err(e) => {
            let preview: String = content.chars().take(500).collect();
            let suffix = if content.chars().count() > 500 { "…（已截断）" } else { "" };
            return Ok(AiCallOutcome {
                result: Err(format!(
                    "解析 AI 输出 JSON 失败: {e}\n预览（前500字符）:\n{preview}{suffix}"
                )),
                input_tokens,
                output_tokens,
            });
        }
    };

    Ok(AiCallOutcome { result: Ok(result), input_tokens, output_tokens })
}
