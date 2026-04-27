use std::env;
use std::time::{Duration, Instant};

use reqwest::Client;
use serde_json::Value;

use crate::models::{AiModelConfigRow, AiResult, TestConnectionResult};

const DEFAULT_BASE_URL: &str = "https://api.openai.com";
const DEFAULT_MODEL: &str = "gpt-4o-mini";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

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
    {"tcm": "tcm concept", "western": "western medicine equivalent", "mapping_level": "exact|reasonable_inference|speculative"}
  ],
  "review": {
    "level": "A",
    "decision": "direct_import|import_with_label|hold_for_review",
    "reason": "brief justification"
  }
}

Review levels: A = classical source or well-evidenced, B = modern/reasonable, C = uncertain or low-quality source.
Confidence values must be between 0.0 and 1.0.
Return ONLY valid JSON. No explanation, no markdown wrapping."#;

/// Primary AI processing — DB config takes priority, falls back to env vars.
pub async fn process(input_text: &str, config: Option<AiModelConfigRow>) -> Result<AiResult, String> {
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
            return Err(
                "已激活模型配置中的 API Key 为空，请在模型设置页更新。".to_string()
            );
        }
        return Ok((api_key, c.base_url, c.model_name, c.api_type));
    }
    // Fallback to env vars (backwards-compat with .env / OPENAI_API_KEY)
    let api_key = env::var("OPENAI_API_KEY").map_err(|_| {
        "未配置可用模型，请先到「模型设置」页添加配置并设为激活。".to_string()
    })?;
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
    let path = if api_type == "responses" { "responses" } else { "chat/completions" };
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
) -> Result<AiResult, String> {
    let client = build_client()?;
    let url = build_endpoint_url(base_url, api_type);

    let body = match api_type {
        "responses" => serde_json::json!({
            "model": model_name,
            "instructions": SYSTEM_PROMPT,
            "input": input_text,
        }),
        _ => serde_json::json!({
            "model": model_name,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": input_text}
            ],
            "response_format": {"type": "json_object"},
            "temperature": 0.3
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

    let content = extract_content(&response_value, api_type)?;
    let clean = strip_markdown(&content);

    serde_json::from_str::<AiResult>(clean)
        .map_err(|e| format!("解析 AI 输出 JSON 失败: {e}\n原始内容: {content}"))
}
