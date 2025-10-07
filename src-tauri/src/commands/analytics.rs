use crate::db::models::{Competency, Dataset, Employee, Score};
use crate::AppState;
use serde::{Deserialize, Serialize};
use sqlx::{QueryBuilder, SqlitePool};
use std::str::FromStr;
use tauri::State;
use unicode_normalization::UnicodeNormalization;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoreDistribution {
    pub range: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompetencyStats {
    pub competency: Competency,
    pub average_score: f64,
    pub employee_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatasetStats {
    pub dataset: Dataset,
    pub total_employees: i64,
    pub total_competencies: i64,
    pub total_scores: i64,
    pub average_score: f64,
    pub score_distribution: Vec<ScoreDistribution>,
    pub competency_stats: Vec<CompetencyStats>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmployeeWithStats {
    #[serde(flatten)]
    pub employee: Employee,
    pub position_status: String,
    pub average_score: f64,
    pub score_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmployeeListResult {
    pub employees: Vec<EmployeeWithStats>,
    pub total_count: i64,
}

const STAFF_KEYWORDS: [&str; 2] = ["staff", "staf"];
const ESELON_KEYWORDS: [&str; 14] = [
    "eselon",
    "kepala",
    "sekretaris",
    "kabid",
    "kabag",
    "kasubag",
    "kepala seksi",
    "kasi",
    "koordinator",
    "pengawas",
    "sub bagian",
    "subbagian",
    "subbidang",
    "sub bidang",
];

const ROLE_ORDER_EXPR: &str =
    "LOWER(REPLACE(REPLACE(REPLACE(TRIM(IFNULL(e.jabatan, '') || ' ' || IFNULL(e.sub_jabatan, '')), '.', ' '), ',', ' '), '/', ' '))";

fn sanitize_text(value: &str) -> String {
    let decomposed: String = value
        .nfkd()
        .filter(|ch| !matches!(ch, '\u{0300}'..='\u{036f}'))
        .collect();

    decomposed
        .to_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphabetic() || ch.is_ascii_whitespace() { ch } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn derive_position_status(jabatan: Option<&str>, sub_jabatan: Option<&str>, gol: Option<&str>) -> String {
    let combined = format!("{} {}", jabatan.unwrap_or_default(), sub_jabatan.unwrap_or_default());
    let normalized = sanitize_text(&combined);

    if !normalized.is_empty() {
        if STAFF_KEYWORDS.iter().any(|keyword| normalized.contains(keyword)) {
            return "Staff".to_string();
        }
        if ESELON_KEYWORDS.iter().any(|keyword| normalized.contains(keyword)) {
            return "Eselon".to_string();
        }
    }

    let gol_value = gol.unwrap_or_default().trim().to_uppercase();
    if gol_value.starts_with("IV") {
        "Eselon".to_string()
    } else {
        "Staff".to_string()
    }
}

#[derive(Debug, Clone, Copy)]
enum EmployeeSortField {
    Name,
    Nip,
    Jabatan,
    Status,
    AverageScore,
    ScoreCount,
    CreatedAt,
}

impl EmployeeSortField {
    fn order_expression(self) -> &'static str {
        match self {
            Self::Name => "LOWER(e.name)",
            Self::Nip => "LOWER(IFNULL(e.nip, ''))",
            Self::Jabatan => ROLE_ORDER_EXPR,
            Self::Status => "position_status",
            Self::AverageScore => "average_score",
            Self::ScoreCount => "score_count",
            Self::CreatedAt => "e.created_at",
        }
    }
}

impl FromStr for EmployeeSortField {
    type Err = ();

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "name" => Ok(Self::Name),
            "nip" => Ok(Self::Nip),
            "jabatan" => Ok(Self::Jabatan),
            "status" => Ok(Self::Status),
            "average_score" => Ok(Self::AverageScore),
            "score_count" => Ok(Self::ScoreCount),
            "created_at" => Ok(Self::CreatedAt),
            _ => Err(()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScoreWithCompetency {
    pub score: Score,
    pub competency: Competency,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmployeePerformance {
    pub employee: Employee,
    pub scores: Vec<ScoreWithCompetency>,
    pub average_score: f64,
    pub strengths: Vec<String>,
    pub gaps: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompetencyDelta {
    pub competency: Competency,
    pub base_average: f64,
    pub comparison_average: f64,
    pub delta: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatasetComparison {
    pub base: DatasetStats,
    pub comparison: DatasetStats,
    pub competency_deltas: Vec<CompetencyDelta>,
    pub average_delta: f64,
}

pub async fn compute_dataset_stats(
    pool: &SqlitePool,
    dataset_id: i64,
) -> Result<DatasetStats, sqlx::Error> {
    let dataset = sqlx::query_as::<_, Dataset>("SELECT * FROM datasets WHERE id = ?")
        .bind(dataset_id)
        .fetch_one(pool)
        .await?;

    let total_employees: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM dataset_employees WHERE dataset_id = ?")
            .bind(dataset_id)
            .fetch_one(pool)
            .await?;

    let total_competencies: i64 =
        sqlx::query_scalar("SELECT COUNT(DISTINCT competency_id) FROM scores WHERE dataset_id = ?")
            .bind(dataset_id)
            .fetch_one(pool)
            .await?;

    let score_stats: (i64, Option<f64>) = sqlx::query_as(
        "SELECT COUNT(*), AVG(numeric_value) FROM scores
         WHERE dataset_id = ? AND numeric_value IS NOT NULL",
    )
    .bind(dataset_id)
    .fetch_one(pool)
    .await?;

    let total_scores = score_stats.0;
    let average_score = score_stats.1.unwrap_or(0.0);

    let distribution_rows: Vec<(i64, i64)> = sqlx::query_as(
        "SELECT
            CASE
                WHEN numeric_value < 1 THEN 0
                WHEN numeric_value < 2 THEN 1
                WHEN numeric_value < 3 THEN 2
                WHEN numeric_value < 4 THEN 3
                ELSE 4
            END as range_key,
            COUNT(*) as count
        FROM scores
        WHERE dataset_id = ? AND numeric_value IS NOT NULL
        GROUP BY range_key
        ORDER BY range_key",
    )
    .bind(dataset_id)
    .fetch_all(pool)
    .await?;

    let score_distribution: Vec<ScoreDistribution> = distribution_rows
        .into_iter()
        .map(|(range_key, count)| {
            let range = match range_key {
                0 => "0-1",
                1 => "1-2",
                2 => "2-3",
                3 => "3-4",
                _ => "4+",
            };
            ScoreDistribution {
                range: range.to_string(),
                count,
            }
        })
        .collect();

    let competency_stats_rows: Vec<(i64, String, Option<String>, i32, Option<f64>, i64)> =
        sqlx::query_as(
            "SELECT
                c.id, c.name, c.description, c.display_order,
                AVG(s.numeric_value) as avg_score,
                COUNT(DISTINCT s.employee_id) as employee_count
            FROM competencies c
            JOIN scores s ON c.id = s.competency_id
            WHERE s.dataset_id = ? AND s.numeric_value IS NOT NULL
            GROUP BY c.id, c.name, c.description, c.display_order
            ORDER BY c.display_order, c.name",
        )
        .bind(dataset_id)
        .fetch_all(pool)
        .await?;

    let competency_stats: Vec<CompetencyStats> = competency_stats_rows
        .into_iter()
        .map(
            |(id, name, description, display_order, avg_score, employee_count)| CompetencyStats {
                competency: Competency {
                    id,
                    name,
                    description,
                    display_order,
                },
                average_score: avg_score.unwrap_or(0.0),
                employee_count,
            },
        )
        .collect();

    Ok(DatasetStats {
        dataset,
        total_employees,
        total_competencies,
        total_scores,
        average_score,
        score_distribution,
        competency_stats,
    })
}

pub async fn compute_employee_performance(
    pool: &SqlitePool,
    dataset_id: i64,
    employee_id: i64,
) -> Result<EmployeePerformance, sqlx::Error> {
    let employee = sqlx::query_as::<_, Employee>(
        "SELECT e.* FROM employees e
         JOIN dataset_employees de ON de.employee_id = e.id
         WHERE e.id = ? AND de.dataset_id = ?",
    )
    .bind(employee_id)
    .bind(dataset_id)
    .fetch_one(pool)
    .await?;

    let score_rows: Vec<(
        i64,
        i64,
        i64,
        i64,
        String,
        Option<f64>,
        String,
        i64,
        String,
        Option<String>,
        i32,
    )> = sqlx::query_as(
        "SELECT
                s.id, s.employee_id, s.dataset_id, s.competency_id, s.raw_value, s.numeric_value, s.created_at,
                c.id, c.name, c.description, c.display_order
            FROM scores s
            JOIN competencies c ON s.competency_id = c.id
            WHERE s.employee_id = ? AND s.dataset_id = ?
            ORDER BY c.display_order, c.name",
    )
    .bind(employee_id)
    .bind(dataset_id)
    .fetch_all(pool)
    .await?;

    let scores: Vec<ScoreWithCompetency> = score_rows
        .into_iter()
        .map(
            |(
                score_id,
                emp_id,
                score_dataset_id,
                comp_id,
                raw_value,
                numeric_value,
                created_at,
                c_id,
                c_name,
                c_desc,
                c_order,
            )| {
                ScoreWithCompetency {
                    score: Score {
                        id: score_id,
                        employee_id: emp_id,
                        dataset_id: score_dataset_id,
                        competency_id: comp_id,
                        raw_value,
                        numeric_value,
                        created_at: created_at.parse().unwrap_or_default(),
                    },
                    competency: Competency {
                        id: c_id,
                        name: c_name,
                        description: c_desc,
                        display_order: c_order,
                    },
                }
            },
        )
        .collect();

    let numeric_scores: Vec<f64> = scores
        .iter()
        .filter_map(|s| s.score.numeric_value)
        .collect();
    let average_score = if numeric_scores.is_empty() {
        0.0
    } else {
        numeric_scores.iter().sum::<f64>() / numeric_scores.len() as f64
    };

    let mut sorted_scores = scores.clone();
    sorted_scores.sort_by(|a, b| {
        b.score
            .numeric_value
            .unwrap_or(0.0)
            .partial_cmp(&a.score.numeric_value.unwrap_or(0.0))
            .unwrap()
    });
    let strengths: Vec<String> = sorted_scores
        .iter()
        .filter(|s| s.score.numeric_value.is_some())
        .take(3)
        .map(|s| s.competency.name.clone())
        .collect();

    let mut reversed_scores = scores.clone();
    reversed_scores.sort_by(|a, b| {
        a.score
            .numeric_value
            .unwrap_or(0.0)
            .partial_cmp(&b.score.numeric_value.unwrap_or(0.0))
            .unwrap()
    });
    let gaps: Vec<String> = reversed_scores
        .iter()
        .filter(|s| s.score.numeric_value.is_some())
        .take(3)
        .map(|s| s.competency.name.clone())
        .collect();

    Ok(EmployeePerformance {
        employee,
        scores,
        average_score,
        strengths,
        gaps,
    })
}

#[tauri::command]
pub async fn get_dataset_stats(
    state: State<'_, AppState>,
    dataset_id: i64,
) -> Result<DatasetStats, String> {
    let pool = state.pool.clone();
    compute_dataset_stats(&pool, dataset_id)
        .await
        .map_err(|e| format!("Failed to compute dataset stats: {}", e))
}

#[tauri::command]
pub async fn list_employees(
    state: State<'_, AppState>,
    dataset_id: i64,
    search: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
    sort_by: Option<String>,
    sort_direction: Option<String>,
) -> Result<EmployeeListResult, String> {
    let pool = state.pool.clone();
    let limit = limit.unwrap_or(50).clamp(1, 500);
    let offset = offset.unwrap_or(0).max(0);

    let sort_field = sort_by
        .as_deref()
        .and_then(|value| EmployeeSortField::from_str(value).ok())
        .unwrap_or(EmployeeSortField::Name);
    let sort_direction_str = match sort_direction.as_deref() {
        Some(direction) if direction.eq_ignore_ascii_case("desc") => "DESC",
        _ => "ASC",
    };

    let staff_condition = STAFF_KEYWORDS
        .iter()
        .map(|keyword| format!("instr({role}, '{keyword}') > 0", role = ROLE_ORDER_EXPR, keyword = keyword))
        .collect::<Vec<_>>()
        .join(" OR ");
    let staff_condition = if staff_condition.is_empty() {
        "0".to_string()
    } else {
        staff_condition
    };

    let eselon_condition = ESELON_KEYWORDS
        .iter()
        .map(|keyword| format!("instr({role}, '{keyword}') > 0", role = ROLE_ORDER_EXPR, keyword = keyword))
        .collect::<Vec<_>>()
        .join(" OR ");
    let eselon_condition = if eselon_condition.is_empty() {
        "0".to_string()
    } else {
        eselon_condition
    };

    let position_case = format!(
        "CASE
            WHEN {staff} THEN 'Staff'
            WHEN {eselon} THEN 'Eselon'
            WHEN UPPER(IFNULL(e.gol, '')) LIKE 'IV%' THEN 'Eselon'
            ELSE 'Staff'
        END as position_status",
        staff = staff_condition,
        eselon = eselon_condition,
    );

    let select_clause = format!(
        "SELECT
            e.id,
            e.name,
            e.nip,
            e.gol,
            e.jabatan,
            e.sub_jabatan,
            e.created_at,
            e.updated_at,
            {position_case},
            COALESCE(AVG(s.numeric_value), 0.0) as average_score,
            COUNT(s.id) as score_count
        FROM employees e
        LEFT JOIN scores s ON s.employee_id = e.id AND s.dataset_id = ",
        position_case = position_case,
    );

    let mut employees_query = QueryBuilder::new(select_clause);
    employees_query.push_bind(dataset_id);
    employees_query.push(" AND s.numeric_value IS NOT NULL");

    if let Some(search_term) = &search {
        let normalized = search_term.trim().to_lowercase();
        if !normalized.is_empty() {
            employees_query.push(" WHERE (");
            employees_query.push("LOWER(e.name) LIKE ");
            employees_query.push_bind(format!("%{}%", normalized));
            employees_query.push(" OR LOWER(IFNULL(e.nip, '')) LIKE ");
            employees_query.push_bind(format!("%{}%", normalized));
            employees_query.push(" OR LOWER(IFNULL(e.jabatan, '')) LIKE ");
            employees_query.push_bind(format!("%{}%", normalized));
            employees_query.push(" OR LOWER(IFNULL(e.sub_jabatan, '')) LIKE ");
            employees_query.push_bind(format!("%{}%", normalized));
            employees_query.push(")");
        }
    }

    employees_query.push(
        " GROUP BY e.id, e.name, e.nip, e.gol, e.jabatan, e.sub_jabatan, e.created_at, e.updated_at, position_status",
    );
    employees_query.push(" ORDER BY ");
    employees_query.push(sort_field.order_expression());
    employees_query.push(" ");
    employees_query.push(sort_direction_str);
    employees_query.push(", LOWER(e.name) ASC LIMIT ");
    employees_query.push_bind(limit);
    employees_query.push(" OFFSET ");
    employees_query.push_bind(offset);

    let employees: Vec<(
        i64,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        String,
        String,
        String,
        f64,
        i64,
    )> = employees_query
        .build_query_as()
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to fetch employees: {}", e))?;

    let employees_with_stats: Vec<EmployeeWithStats> = employees
        .into_iter()
        .map(
            |(
                id,
                name,
                nip,
                gol,
                jabatan,
                sub_jabatan,
                created_at,
                updated_at,
                position_status,
                avg,
                count,
            )| {
                let status = if matches!(position_status.as_str(), "Staff" | "Eselon") {
                    position_status
                } else {
                    derive_position_status(jabatan.as_deref(), sub_jabatan.as_deref(), gol.as_deref())
                };

                EmployeeWithStats {
                    employee: Employee {
                        id,
                        name,
                        nip,
                        gol,
                        jabatan,
                        sub_jabatan,
                        created_at: created_at.parse().unwrap_or_default(),
                        updated_at: updated_at.parse().unwrap_or_default(),
                    },
                    position_status: status,
                    average_score: avg,
                    score_count: count,
                }
            },
        )
        .collect();

    let mut count_query = QueryBuilder::new("SELECT COUNT(*) FROM employees e");

    if let Some(search_term) = &search {
        let normalized = search_term.trim().to_lowercase();
        if !normalized.is_empty() {
            count_query.push(" WHERE (");
            count_query.push("LOWER(e.name) LIKE ");
            count_query.push_bind(format!("%{}%", normalized));
            count_query.push(" OR LOWER(IFNULL(e.nip, '')) LIKE ");
            count_query.push_bind(format!("%{}%", normalized));
            count_query.push(" OR LOWER(IFNULL(e.jabatan, '')) LIKE ");
            count_query.push_bind(format!("%{}%", normalized));
            count_query.push(" OR LOWER(IFNULL(e.sub_jabatan, '')) LIKE ");
            count_query.push_bind(format!("%{}%", normalized));
            count_query.push(")");
        }
    }

    let total_count: i64 = count_query
        .build_query_scalar()
        .fetch_one(&pool)
        .await
        .map_err(|e| format!("Failed to count employees: {}", e))?;

    Ok(EmployeeListResult {
        employees: employees_with_stats,
        total_count,
    })
}

#[tauri::command]
pub async fn get_employee_performance(
    state: State<'_, AppState>,
    dataset_id: i64,
    employee_id: i64,
) -> Result<EmployeePerformance, String> {
    let pool = state.pool.clone();

    compute_employee_performance(&pool, dataset_id, employee_id)
        .await
        .map_err(|e| format!("Failed to load employee performance: {}", e))
}

#[tauri::command]
pub async fn compare_datasets(
    state: State<'_, AppState>,
    base_dataset_id: i64,
    comparison_dataset_id: i64,
) -> Result<DatasetComparison, String> {
    let pool = state.pool.clone();

    let base_stats = compute_dataset_stats(&pool, base_dataset_id)
        .await
        .map_err(|e| format!("Failed to compute base dataset stats: {}", e))?;
    let comparison_stats = compute_dataset_stats(&pool, comparison_dataset_id)
        .await
        .map_err(|e| format!("Failed to compute comparison dataset stats: {}", e))?;

    let mut competency_map = std::collections::HashMap::new();
    for stat in &base_stats.competency_stats {
        competency_map.insert(stat.competency.id, stat.clone());
    }

    let mut deltas: Vec<CompetencyDelta> = Vec::new();
    for comp_stat in &comparison_stats.competency_stats {
        if let Some(base_stat) = competency_map.get(&comp_stat.competency.id) {
            let delta = comp_stat.average_score - base_stat.average_score;
            deltas.push(CompetencyDelta {
                competency: comp_stat.competency.clone(),
                base_average: base_stat.average_score,
                comparison_average: comp_stat.average_score,
                delta,
            });
        } else {
            deltas.push(CompetencyDelta {
                competency: comp_stat.competency.clone(),
                base_average: 0.0,
                comparison_average: comp_stat.average_score,
                delta: comp_stat.average_score,
            });
        }
    }

    // Include competencies that existed only in base dataset
    for base_stat in base_stats.competency_stats.iter() {
        if !deltas
            .iter()
            .any(|d| d.competency.id == base_stat.competency.id)
        {
            deltas.push(CompetencyDelta {
                competency: base_stat.competency.clone(),
                base_average: base_stat.average_score,
                comparison_average: 0.0,
                delta: -base_stat.average_score,
            });
        }
    }

    deltas.sort_by(|a, b| a.competency.display_order.cmp(&b.competency.display_order));

    let average_delta = comparison_stats.average_score - base_stats.average_score;

    Ok(DatasetComparison {
        base: base_stats,
        comparison: comparison_stats,
        competency_deltas: deltas,
        average_delta,
    })
}
