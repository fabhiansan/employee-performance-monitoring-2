use crate::commands::analytics::{compute_dataset_stats, ScoreWithCompetency};
use crate::db::models::{Competency, Dataset, Employee};
use crate::AppState;
use pdf_canvas::{BuiltinFont, Canvas, Pdf};
use rust_xlsxwriter::{Format, Workbook};
use std::collections::HashMap;
use tauri::State;

#[derive(Debug)]
struct DatasetExportData {
    dataset: Dataset,
    employees: Vec<Employee>,
    competencies: Vec<Competency>,
    scores_by_employee: HashMap<i64, Vec<ScoreWithCompetency>>,
}

#[tauri::command]
pub async fn export_dataset(
    state: State<'_, AppState>,
    dataset_id: i64,
    format: String,
    file_path: String,
) -> Result<(), String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Database not initialized")?;
    let pool = &db.pool;

    let export_data = collect_dataset_data(pool, dataset_id)
        .await
        .map_err(|e| format!("Failed to collect dataset: {}", e))?;

    match format.as_str() {
        "csv" => export_csv(&export_data, &file_path),
        "xlsx" => export_xlsx(&export_data, &file_path),
        "pdf" => export_pdf(pool, &export_data, &file_path).await,
        other => Err(format!("Unsupported export format: {}", other)),
    }
}

async fn collect_dataset_data(
    pool: &sqlx::SqlitePool,
    dataset_id: i64,
) -> Result<DatasetExportData, sqlx::Error> {
    let dataset = sqlx::query_as::<_, Dataset>("SELECT * FROM datasets WHERE id = ?")
        .bind(dataset_id)
        .fetch_one(pool)
        .await?;

    let employees =
        sqlx::query_as::<_, Employee>("SELECT * FROM employees WHERE dataset_id = ? ORDER BY name")
            .bind(dataset_id)
            .fetch_all(pool)
            .await?;

    let competencies = sqlx::query_as::<_, Competency>(
        "SELECT DISTINCT c.* FROM competencies c
         JOIN scores s ON c.id = s.competency_id
         JOIN employees e ON s.employee_id = e.id
         WHERE e.dataset_id = ?
         ORDER BY c.display_order, c.name",
    )
    .bind(dataset_id)
    .fetch_all(pool)
    .await?;

    let score_rows: Vec<(
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
                s.id, s.employee_id, s.competency_id, s.raw_value, s.numeric_value, s.created_at,
                c.id, c.name, c.description, c.display_order
            FROM scores s
            JOIN competencies c ON s.competency_id = c.id
            JOIN employees e ON s.employee_id = e.id
            WHERE e.dataset_id = ?
            ORDER BY e.name, c.display_order, c.name",
    )
    .bind(dataset_id)
    .fetch_all(pool)
    .await?;

    let mut scores_by_employee: HashMap<i64, Vec<ScoreWithCompetency>> = HashMap::new();
    for (
        score_id,
        employee_id,
        competency_id,
        raw_value,
        numeric_value,
        created_at,
        comp_id,
        comp_name,
        comp_description,
        comp_order,
    ) in score_rows
    {
        let entry = scores_by_employee.entry(employee_id).or_default();
        entry.push(ScoreWithCompetency {
            score: crate::db::models::Score {
                id: score_id,
                employee_id,
                competency_id,
                raw_value,
                numeric_value,
                created_at: created_at.parse().unwrap_or_default(),
            },
            competency: Competency {
                id: comp_id,
                name: comp_name,
                description: comp_description,
                display_order: comp_order,
            },
        });
    }

    Ok(DatasetExportData {
        dataset,
        employees,
        competencies,
        scores_by_employee,
    })
}

fn export_csv(data: &DatasetExportData, file_path: &str) -> Result<(), String> {
    let mut writer =
        csv::Writer::from_path(file_path).map_err(|e| format!("Failed to open CSV file: {}", e))?;

    let mut headers = vec![
        "Employee Name".to_string(),
        "NIP".to_string(),
        "Gol".to_string(),
        "Jabatan".to_string(),
        "Sub Jabatan".to_string(),
        "Average Score".to_string(),
    ];
    for competency in &data.competencies {
        headers.push(format!("{} (Raw)", competency.name));
        headers.push(format!("{} (Numeric)", competency.name));
    }

    writer
        .write_record(headers)
        .map_err(|e| format!("Failed to write CSV header: {}", e))?;

    for employee in &data.employees {
        let scores = data
            .scores_by_employee
            .get(&employee.id)
            .cloned()
            .unwrap_or_default();
        let mut score_map: HashMap<i64, (&str, Option<f64>)> = HashMap::new();
        let mut numeric_values = Vec::new();
        for score in &scores {
            if let Some(value) = score.score.numeric_value {
                numeric_values.push(value);
            }
            score_map.insert(
                score.competency.id,
                (&score.score.raw_value, score.score.numeric_value),
            );
        }

        let average = if numeric_values.is_empty() {
            0.0
        } else {
            numeric_values.iter().sum::<f64>() / numeric_values.len() as f64
        };

        let mut row = vec![
            employee.name.clone(),
            employee.nip.clone().unwrap_or_default(),
            employee.gol.clone().unwrap_or_default(),
            employee.jabatan.clone().unwrap_or_default(),
            employee.sub_jabatan.clone().unwrap_or_default(),
            format!("{:.2}", average),
        ];

        for competency in &data.competencies {
            if let Some((raw, numeric)) = score_map.get(&competency.id) {
                row.push(raw.to_string());
                row.push(
                    numeric
                        .map(|val| format!("{:.2}", val))
                        .unwrap_or_else(|| "".to_string()),
                );
            } else {
                row.extend(["".to_string(), "".to_string()]);
            }
        }

        writer
            .write_record(row)
            .map_err(|e| format!("Failed to write CSV row: {}", e))?;
    }

    writer
        .flush()
        .map_err(|e| format!("Failed to finish CSV export: {}", e))
}

fn export_xlsx(data: &DatasetExportData, file_path: &str) -> Result<(), String> {
    let mut workbook = Workbook::new();
    let worksheet = workbook.add_worksheet();

    let header_format = Format::new().set_bold().set_background_color(0xDDDDDD);

    let mut col = 0;
    let headers = [
        "Employee Name",
        "NIP",
        "Gol",
        "Jabatan",
        "Sub Jabatan",
        "Average Score",
    ];
    for header in headers {
        worksheet
            .write_string_with_format(0, col, header, &header_format)
            .map_err(|e| format!("Failed to write header: {}", e))?;
        col += 1;
    }

    for competency in &data.competencies {
        worksheet
            .write_string_with_format(
                0,
                col,
                &format!("{} (Raw)", competency.name),
                &header_format,
            )
            .map_err(|e| format!("Failed to write header: {}", e))?;
        col += 1;
        worksheet
            .write_string_with_format(
                0,
                col,
                &format!("{} (Numeric)", competency.name),
                &header_format,
            )
            .map_err(|e| format!("Failed to write header: {}", e))?;
        col += 1;
    }

    for (row_idx, employee) in data.employees.iter().enumerate() {
        let row = (row_idx + 1) as u32;
        let scores = data
            .scores_by_employee
            .get(&employee.id)
            .cloned()
            .unwrap_or_default();
        let mut score_map: HashMap<i64, (&str, Option<f64>)> = HashMap::new();
        let mut numeric_values = Vec::new();
        for score in &scores {
            if let Some(value) = score.score.numeric_value {
                numeric_values.push(value);
            }
            score_map.insert(
                score.competency.id,
                (&score.score.raw_value, score.score.numeric_value),
            );
        }
        let average = if numeric_values.is_empty() {
            0.0
        } else {
            numeric_values.iter().sum::<f64>() / numeric_values.len() as f64
        };

        let mut col_idx = 0u16;
        worksheet
            .write_string(row, col_idx, &employee.name)
            .map_err(|e| format!("Failed to write cell: {}", e))?;
        col_idx += 1;
        worksheet
            .write_string(row, col_idx, employee.nip.as_deref().unwrap_or(""))
            .map_err(|e| format!("Failed to write cell: {}", e))?;
        col_idx += 1;
        worksheet
            .write_string(row, col_idx, employee.gol.as_deref().unwrap_or(""))
            .map_err(|e| format!("Failed to write cell: {}", e))?;
        col_idx += 1;
        worksheet
            .write_string(row, col_idx, employee.jabatan.as_deref().unwrap_or(""))
            .map_err(|e| format!("Failed to write cell: {}", e))?;
        col_idx += 1;
        worksheet
            .write_string(row, col_idx, employee.sub_jabatan.as_deref().unwrap_or(""))
            .map_err(|e| format!("Failed to write cell: {}", e))?;
        col_idx += 1;
        worksheet
            .write_number(row, col_idx, average)
            .map_err(|e| format!("Failed to write cell: {}", e))?;
        col_idx += 1;

        for competency in &data.competencies {
            if let Some((raw, numeric)) = score_map.get(&competency.id) {
                worksheet
                    .write_string(row, col_idx, *raw)
                    .map_err(|e| format!("Failed to write cell: {}", e))?;
                col_idx += 1;
                if let Some(value) = numeric {
                    worksheet
                        .write_number(row, col_idx, *value)
                        .map_err(|e| format!("Failed to write cell: {}", e))?;
                } else {
                    worksheet
                        .write_string(row, col_idx, "")
                        .map_err(|e| format!("Failed to write cell: {}", e))?;
                }
            } else {
                worksheet
                    .write_string(row, col_idx, "")
                    .map_err(|e| format!("Failed to write cell: {}", e))?;
                col_idx += 1;
                worksheet
                    .write_string(row, col_idx, "")
                    .map_err(|e| format!("Failed to write cell: {}", e))?;
            }
            col_idx += 1;
        }
    }

    workbook
        .save(file_path)
        .map_err(|e| format!("Failed to save workbook: {}", e))
}

async fn export_pdf(
    pool: &sqlx::SqlitePool,
    data: &DatasetExportData,
    file_path: &str,
) -> Result<(), String> {
    let stats = compute_dataset_stats(pool, data.dataset.id)
        .await
        .map_err(|e| format!("Failed to compute dataset stats: {}", e))?;

    let employee_lines: Vec<String> = data
        .employees
        .iter()
        .map(|employee| {
            let scores = data
                .scores_by_employee
                .get(&employee.id)
                .cloned()
                .unwrap_or_default();
            let mut numeric_values: Vec<(String, f64)> = scores
                .iter()
                .filter_map(|score| {
                    score
                        .score
                        .numeric_value
                        .map(|val| (score.competency.name.clone(), val))
                })
                .collect();
            numeric_values.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());

            let average = if numeric_values.is_empty() {
                0.0
            } else {
                numeric_values.iter().map(|(_, value)| *value).sum::<f64>()
                    / numeric_values.len() as f64
            };

            if let Some((name, value)) = numeric_values.first() {
                format!(
                    "{} - Rata-rata {:.2} | Kekuatan utama: {} ({:.2})",
                    employee.name, average, name, value
                )
            } else {
                format!(
                    "{} - Rata-rata {:.2} | Belum ada skor numerik",
                    employee.name, average
                )
            }
        })
        .collect();

    let mut document =
        Pdf::create(file_path).map_err(|e| format!("Failed to create PDF: {}", e))?;
    let title = format!("Laporan Dataset - {}", data.dataset.name);
    let subtitle = data
        .dataset
        .description
        .as_deref()
        .unwrap_or("Ringkasan performa karyawan");
    let stats_summary = format!(
        "Total Karyawan: {} | Kompetensi: {} | Rata-rata Skor: {:.2}",
        stats.total_employees, stats.total_competencies, stats.average_score
    );

    let score_distribution_lines: Vec<String> = stats
        .score_distribution
        .iter()
        .map(|dist| format!("Rentang {}: {} entri", dist.range, dist.count))
        .collect();

    let first_capacity = dataset_first_page_capacity(score_distribution_lines.len());
    let follow_capacity = dataset_followup_page_capacity();
    let page_ranges =
        dataset_partition_employee_lines(employee_lines.len(), first_capacity, follow_capacity);

    let (first_start, first_end) = page_ranges[0];
    document
        .render_page(595.0, 842.0, |canvas| {
            render_dataset_first_page(
                canvas,
                &title,
                subtitle,
                &stats_summary,
                &score_distribution_lines,
                &employee_lines[first_start..first_end],
            )
        })
        .map_err(|e| format!("Failed to render PDF: {}", e))?;

    for (page_index, &(start, end)) in page_ranges.iter().enumerate().skip(1) {
        document
            .render_page(595.0, 842.0, |canvas| {
                render_dataset_followup_page(
                    canvas,
                    &title,
                    page_index,
                    &employee_lines[start..end],
                )
            })
            .map_err(|e| format!("Failed to render PDF: {}", e))?;
    }

    document
        .finish()
        .map_err(|e| format!("Failed to save PDF: {}", e))
}

fn dataset_first_page_capacity(score_distribution_count: usize) -> usize {
    let mut cursor: f64 = 800.0;
    cursor -= 24.0;
    cursor -= 40.0;
    cursor -= 20.0;
    cursor -= score_distribution_count as f64 * 16.0;
    cursor -= 20.0;
    cursor -= 24.0;
    let available = cursor - 80.0;
    if available <= 0.0 {
        0
    } else {
        (available / 16.0).floor() as usize
    }
}

fn dataset_followup_page_capacity() -> usize {
    let mut cursor: f64 = 800.0;
    cursor -= 24.0;
    let available = cursor - 80.0;
    (available / 16.0).floor() as usize
}

fn dataset_partition_employee_lines(
    total: usize,
    first_capacity: usize,
    follow_capacity: usize,
) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    let first_end = first_capacity.min(total);
    ranges.push((0, first_end));
    let mut start = first_end;
    let capacity = follow_capacity.max(1);
    while start < total {
        let end = (start + capacity).min(total);
        ranges.push((start, end));
        start = end;
    }
    ranges
}

fn render_dataset_first_page(
    canvas: &mut Canvas<'_>,
    title: &str,
    subtitle: &str,
    stats_summary: &str,
    score_distribution_lines: &[String],
    employee_lines: &[String],
) -> std::io::Result<()> {
    let mut cursor_y = 800.0;
    canvas.left_text(50.0, cursor_y, BuiltinFont::Helvetica_Bold, 18.0, title)?;
    cursor_y -= 24.0;
    canvas.left_text(50.0, cursor_y, BuiltinFont::Helvetica, 12.0, subtitle)?;
    cursor_y -= 40.0;
    canvas.left_text(50.0, cursor_y, BuiltinFont::Helvetica, 12.0, stats_summary)?;
    cursor_y -= 20.0;

    for line in score_distribution_lines {
        canvas.left_text(50.0, cursor_y, BuiltinFont::Helvetica, 12.0, line)?;
        cursor_y -= 16.0;
    }

    cursor_y -= 20.0;
    canvas.left_text(
        50.0,
        cursor_y,
        BuiltinFont::Helvetica_Bold,
        14.0,
        "Daftar Karyawan",
    )?;
    cursor_y -= 24.0;

    for line in employee_lines {
        canvas.left_text(50.0, cursor_y, BuiltinFont::Helvetica, 11.0, line)?;
        cursor_y -= 16.0;
    }

    Ok(())
}

fn render_dataset_followup_page(
    canvas: &mut Canvas<'_>,
    title: &str,
    page_index: usize,
    employee_lines: &[String],
) -> std::io::Result<()> {
    let mut cursor_y = 800.0;
    let header = if page_index == 1 {
        format!("{} (lanjutan)", title)
    } else {
        format!("{} (lanjutan {})", title, page_index)
    };
    canvas.left_text(50.0, cursor_y, BuiltinFont::Helvetica_Bold, 14.0, &header)?;
    cursor_y -= 24.0;

    for line in employee_lines {
        canvas.left_text(50.0, cursor_y, BuiltinFont::Helvetica, 11.0, line)?;
        cursor_y -= 16.0;
    }

    Ok(())
}
