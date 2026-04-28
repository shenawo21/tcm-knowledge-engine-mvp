use tauri::State;

use crate::ai_processor;
use crate::db::AppState;
use crate::models::{
    AiModelConfigView, AiResult, EntityDetail, EntityListItem, IngestionTaskRow,
    TestConnectionResult,
};
use crate::repository;

const MAX_INPUT_TEXT_CHARS: usize = 10_000;

fn lock_err(e: impl std::fmt::Display) -> String {
    format!("db lock poisoned: {e}")
}

fn db_err(e: impl std::fmt::Display) -> String {
    format!("db error: {e}")
}

#[tauri::command]
pub fn health_check() -> String {
    "TCM Knowledge Engine Core OK".into()
}

#[tauri::command]
pub fn create_ingestion_task(
    state: State<'_, AppState>,
    input_text: String,
    task_type: Option<String>,
) -> Result<String, String> {
    let trimmed = input_text.trim();
    if trimmed.is_empty() {
        return Err("input_text is empty".into());
    }
    if trimmed.chars().count() > MAX_INPUT_TEXT_CHARS {
        return Err(format!("input_text exceeds {MAX_INPUT_TEXT_CHARS} characters").into());
    }
    let kind = task_type.unwrap_or_else(|| "text".into());
    let conn = state.db.lock().map_err(lock_err)?;
    repository::create_ingestion_task(&conn, &kind, trimmed).map_err(db_err)
}

#[tauri::command]
pub fn save_ai_result(
    state: State<'_, AppState>,
    task_id: String,
    input_text: String,
    ai_output: AiResult,
) -> Result<(), String> {
    if task_id.trim().is_empty() {
        return Err("task_id is empty".into());
    }
    let trimmed_input = input_text.trim();
    if trimmed_input.is_empty() {
        return Err("input_text is empty".into());
    }
    if trimmed_input.chars().count() > MAX_INPUT_TEXT_CHARS {
        return Err(format!("input_text exceeds {MAX_INPUT_TEXT_CHARS} characters").into());
    }
    let mut conn = state.db.lock().map_err(lock_err)?;
    match repository::save_ai_result(&mut conn, &task_id, &ai_output, trimmed_input) {
        Ok(()) => Ok(()),
        Err(e) => {
            let msg = format!("save_ai_result failed: {e}");
            let _ = repository::mark_task_failed(&conn, &task_id, &msg);
            Err(msg)
        }
    }
}

#[tauri::command]
pub fn list_ingestion_tasks(
    state: State<'_, AppState>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<IngestionTaskRow>, String> {
    let conn = state.db.lock().map_err(lock_err)?;
    repository::list_ingestion_tasks(&conn, limit.unwrap_or(50), offset.unwrap_or(0))
        .map_err(db_err)
}

#[tauri::command]
pub fn list_entities(
    state: State<'_, AppState>,
    limit: Option<i64>,
) -> Result<Vec<EntityListItem>, String> {
    let conn = state.db.lock().map_err(lock_err)?;
    repository::list_entities(&conn, limit.unwrap_or(200)).map_err(db_err)
}

#[tauri::command]
pub fn get_entity_detail(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<EntityDetail>, String> {
    let conn = state.db.lock().map_err(lock_err)?;
    repository::get_entity_detail(&conn, &id).map_err(db_err)
}

/// process_with_ai: reads active model config from DB (falls back to env vars).
/// Lock released before the async HTTP call to avoid holding MutexGuard across await.
#[tauri::command]
pub async fn process_with_ai(
    state: State<'_, AppState>,
    input_text: String,
) -> Result<AiResult, String> {
    let trimmed = input_text.trim().to_string();
    if trimmed.is_empty() {
        return Err("input_text is empty".into());
    }
    if trimmed.chars().count() > MAX_INPUT_TEXT_CHARS {
        return Err(format!("input_text exceeds {MAX_INPUT_TEXT_CHARS} characters").into());
    }
    let config_opt = {
        let conn = state.db.lock().map_err(lock_err)?;
        repository::get_active_ai_model_full(&conn).map_err(db_err)?
        // MutexGuard dropped here
    };
    ai_processor::process(&trimmed, config_opt).await
}

// ─── model config commands ────────────────────────────────────────────────────

#[tauri::command]
pub fn save_ai_model_config(
    state: State<'_, AppState>,
    id: Option<String>,
    provider_name: String,
    base_url: String,
    api_key: String,
    model_name: String,
    api_type: String,
) -> Result<String, String> {
    let provider_name = provider_name.trim();
    let base_url = base_url.trim();
    let api_key = api_key.trim();
    let model_name = model_name.trim();
    let api_type = api_type.trim();

    if provider_name.is_empty() {
        return Err("provider_name is required".into());
    }
    if base_url.is_empty() {
        return Err("base_url is required".into());
    }
    if api_key.is_empty() {
        return Err("api_key is required".into());
    }
    if model_name.is_empty() {
        return Err("model_name is required".into());
    }
    if !["chat_completions", "responses"].contains(&api_type) {
        return Err(format!(
            "api_type must be chat_completions or responses, got: {api_type}"
        ));
    }

    let conn = state.db.lock().map_err(lock_err)?;
    repository::save_ai_model_config(
        &conn,
        id.as_deref(),
        provider_name,
        base_url,
        api_key,
        model_name,
        api_type,
    )
    .map_err(db_err)
}

#[tauri::command]
pub fn list_ai_model_configs(state: State<'_, AppState>) -> Result<Vec<AiModelConfigView>, String> {
    let conn = state.db.lock().map_err(lock_err)?;
    repository::list_ai_model_configs(&conn).map_err(db_err)
}

#[tauri::command]
pub fn set_active_ai_model(state: State<'_, AppState>, config_id: String) -> Result<bool, String> {
    if config_id.trim().is_empty() {
        return Err("config_id is required".into());
    }
    let mut conn = state.db.lock().map_err(lock_err)?;
    repository::set_active_ai_model(&mut conn, &config_id).map_err(db_err)
}

#[tauri::command]
pub fn get_active_ai_model(
    state: State<'_, AppState>,
) -> Result<Option<AiModelConfigView>, String> {
    let conn = state.db.lock().map_err(lock_err)?;
    repository::get_active_ai_model(&conn).map_err(db_err)
}

#[tauri::command]
pub async fn test_ai_model_connection(
    state: State<'_, AppState>,
    config_id: String,
) -> Result<TestConnectionResult, String> {
    if config_id.trim().is_empty() {
        return Err("config_id is required".into());
    }
    let config = {
        let conn = state.db.lock().map_err(lock_err)?;
        repository::get_ai_model_config_by_id(&conn, &config_id).map_err(db_err)?
        // MutexGuard dropped here
    };
    let config = config.ok_or_else(|| format!("config not found: {config_id}"))?;
    ai_processor::test_connection(&config).await
}
