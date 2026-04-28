mod ai_processor;
mod commands;
mod db;
mod models;
mod repository;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let _ = dotenvy::dotenv();
            let state =
                db::init(app.handle()).map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::health_check,
            commands::create_ingestion_task,
            commands::save_ai_result,
            commands::list_ingestion_tasks,
            commands::list_entities,
            commands::get_entity_detail,
            commands::process_with_ai,
            commands::save_ai_model_config,
            commands::list_ai_model_configs,
            commands::set_active_ai_model,
            commands::get_active_ai_model,
            commands::test_ai_model_connection,
            commands::get_usage_summary,
            commands::create_chunked_task,
            commands::get_task_chunks,
            commands::list_chunked_tasks,
            commands::process_chunk,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
