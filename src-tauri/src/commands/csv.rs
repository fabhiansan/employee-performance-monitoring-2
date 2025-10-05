use crate::csv_parser::{CsvParser, CsvPreview, ParsedEmployee, ParsedScore};
use std::path::PathBuf;

#[tauri::command]
pub async fn preview_csv(file_path: String, max_rows: usize) -> Result<CsvPreview, String> {
    let path = PathBuf::from(file_path);

    CsvParser::preview(&path, max_rows).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn parse_employee_csv(file_path: String) -> Result<Vec<ParsedEmployee>, String> {
    let path = PathBuf::from(file_path);

    CsvParser::parse_employee_csv(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn parse_scores_csv(file_path: String) -> Result<Vec<ParsedScore>, String> {
    let path = PathBuf::from(file_path);

    CsvParser::parse_scores_csv(&path).map_err(|e| e.to_string())
}
