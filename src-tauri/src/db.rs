use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::{AppHandle, Manager};

const SCHEMA_SQL: &str = include_str!("../../database/schema.sql");

pub struct AppState {
    pub db: Mutex<Connection>,
}

pub fn init(app: &AppHandle) -> Result<AppState, String> {
    let dir: PathBuf = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("resolve app_data_dir failed: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create app_data_dir failed: {e}"))?;
    let db_path = dir.join("tcm-knowledge-engine.sqlite");

    let conn = Connection::open(&db_path)
        .map_err(|e| format!("open sqlite failed at {db_path:?}: {e}"))?;

    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("enable foreign_keys failed: {e}"))?;
    conn.execute_batch(SCHEMA_SQL)
        .map_err(|e| format!("apply schema failed: {e}"))?;

    Ok(AppState {
        db: Mutex::new(conn),
    })
}
