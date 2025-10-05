use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Dataset {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub source_file: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Employee {
    pub id: i64,
    pub dataset_id: i64,
    pub name: String,
    pub nip: Option<String>,
    pub gol: Option<String>,
    pub jabatan: Option<String>,
    pub sub_jabatan: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Competency {
    pub id: i64,
    pub name: String,
    pub description: Option<String>,
    pub display_order: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Score {
    pub id: i64,
    pub employee_id: i64,
    pub competency_id: i64,
    pub raw_value: String,
    pub numeric_value: Option<f64>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct RatingMapping {
    pub id: i64,
    pub dataset_id: i64,
    pub text_value: String,
    pub numeric_value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Summary {
    pub id: i64,
    pub employee_id: i64,
    pub content: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ValidationIssue {
    pub id: i64,
    pub dataset_id: i64,
    pub issue_type: String,
    pub severity: String,
    pub message: String,
    pub metadata: Option<String>,
    pub resolved: bool,
    pub created_at: DateTime<Utc>,
}

// DTOs for creating new records
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateDataset {
    pub name: String,
    pub description: Option<String>,
    pub source_file: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateEmployee {
    pub dataset_id: i64,
    pub name: String,
    pub nip: Option<String>,
    pub gol: Option<String>,
    pub jabatan: Option<String>,
    pub sub_jabatan: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateScore {
    pub employee_id: i64,
    pub competency_id: i64,
    pub raw_value: String,
    pub numeric_value: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRatingMapping {
    pub dataset_id: i64,
    pub text_value: String,
    pub numeric_value: f64,
}
