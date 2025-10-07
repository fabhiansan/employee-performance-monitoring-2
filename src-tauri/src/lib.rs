mod commands;
mod csv_parser;
mod db;

use tauri::Manager;

pub struct AppState {
    pub pool: sqlx::SqlitePool,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Initialize database
            let app_dir = app.path().app_data_dir().expect("failed to get app dir");
            std::fs::create_dir_all(&app_dir)
                .map_err(|e| -> Box<dyn std::error::Error> { Box::new(e) })?;

            let db_path = app_dir.join("epa.db");

            let database = tauri::async_runtime::block_on(db::Database::new(db_path))
                .map_err(|e| -> Box<dyn std::error::Error> { Box::new(e) })?;

            let db::Database { pool } = database;

            let state = AppState { pool };

            app.manage(state);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::csv::preview_csv,
            commands::csv::parse_employee_csv,
            commands::csv::parse_scores_csv,
            commands::dataset::create_dataset,
            commands::dataset::list_datasets,
            commands::dataset::get_dataset,
            commands::dataset::delete_dataset,
            commands::dataset::update_dataset,
            commands::dataset::merge_datasets,
            commands::employee::list_all_employees,
            commands::employee::bulk_delete_employees,
            commands::employee::bulk_update_employees,
            commands::import::import_employees,
            commands::import::import_performance_dataset,
            commands::import::import_performance_into_dataset,
            commands::import::append_dataset_employees,
            commands::import::get_default_rating_mappings,
            commands::import::validate_import_data,
            commands::analytics::get_dataset_stats,
            commands::analytics::list_employees,
            commands::analytics::get_employee_performance,
            commands::analytics::compare_datasets,
            commands::summaries::generate_employee_summary,
            commands::summaries::get_employee_summary,
            commands::summaries::save_employee_summary,
            commands::summaries::export_employee_summary_pdf,
            commands::export::export_dataset,
            commands::report::export_employee_report_pdf,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
