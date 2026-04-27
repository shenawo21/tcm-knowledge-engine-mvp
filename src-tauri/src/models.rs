use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct AiResult {
    pub content_type: Option<String>,
    pub summary: Option<AiSummary>,
    #[serde(default)]
    pub entities: Vec<AiEntity>,
    #[serde(default)]
    pub relations: Vec<AiRelation>,
    #[serde(default)]
    pub western_mapping: Vec<AiWesternMapping>,
    pub review: Option<AiReview>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AiSummary {
    pub one_sentence: Option<String>,
    #[serde(default)]
    pub key_points: Vec<String>,
    pub learning_value: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AiEntity {
    #[serde(rename = "type")]
    pub entity_type: String,
    pub name: String,
    pub confidence: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AiRelation {
    pub from: String,
    pub to: String,
    pub relation_type: String,
    pub confidence: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AiWesternMapping {
    pub tcm: Option<String>,
    pub western: Option<String>,
    pub mapping_level: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AiReview {
    pub level: Option<String>,
    pub decision: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IngestionTaskRow {
    pub id: String,
    pub task_type: String,
    pub input_text: Option<String>,
    pub status: String,
    pub content_type: Option<String>,
    pub source_id: Option<String>,
    pub error_message: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityListItem {
    pub id: String,
    pub entity_type: String,
    pub name: String,
    pub description: Option<String>,
    pub confidence: Option<f64>,
    pub source_count: i64,
    pub relations_count: i64,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityRow {
    pub id: String,
    pub entity_type: String,
    pub name: String,
    pub aliases: Option<String>,
    pub description: Option<String>,
    pub tcm_explanation: Option<String>,
    pub western_explanation: Option<String>,
    pub confidence: Option<f64>,
    pub source_count: i64,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationView {
    pub id: String,
    pub from_entity_id: String,
    pub from_name: String,
    pub to_entity_id: String,
    pub to_name: String,
    pub relation_type: String,
    pub confidence: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityDetail {
    pub entity: EntityRow,
    pub outgoing: Vec<RelationView>,
    pub incoming: Vec<RelationView>,
}

/// Internal row — NOT Serialize; api_key must never reach the frontend.
#[derive(Debug)]
pub struct AiModelConfigRow {
    pub id: String,
    pub provider_name: String,
    pub base_url: String,
    pub api_key: String,
    pub model_name: String,
    pub api_type: String,
    pub is_active: bool,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

/// Frontend-safe view — api_key is replaced by masked_api_key.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModelConfigView {
    pub id: String,
    pub provider_name: String,
    pub base_url: String,
    pub masked_api_key: String,
    pub model_name: String,
    pub api_type: String,
    pub is_active: bool,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestConnectionResult {
    pub success: bool,
    pub message: String,
    pub latency_ms: Option<u64>,
}
