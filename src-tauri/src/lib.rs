mod commands;
mod csv_parser;
mod db;

use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;

pub struct AppState {
    pub db: Arc<Mutex<Option<db::Database>>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Initialize database
            let app_dir = app.path().app_data_dir().expect("failed to get app dir");
            std::fs::create_dir_all(&app_dir).expect("failed to create app dir");

            let db_path = app_dir.join("epa.db");

            let state = AppState {
                db: Arc::new(Mutex::new(None)),
            };

            app.manage(state);

            // Initialize database in background
            let db_clone = app.state::<AppState>().db.clone();
            tauri::async_runtime::spawn(async move {
                match db::Database::new(db_path).await {
                    Ok(database) => {
                        let mut db_lock = db_clone.lock().await;
                        *db_lock = Some(database);
                        println!("Database initialized successfully");
                    }
                    Err(e) => {
                        eprintln!("Failed to initialize database: {}", e);
                    }
                }
            });

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
            commands::import::import_dataset,
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
