use crate::commands::analytics::{compute_employee_performance, EmployeePerformance};
use crate::db::models::Summary;
use crate::AppState;
use pdf_canvas::{BuiltinFont, Canvas, Pdf};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedSummary {
    pub content: String,
}

#[tauri::command]
pub async fn generate_employee_summary(
    state: State<'_, AppState>,
    employee_id: i64,
) -> Result<GeneratedSummary, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Database not initialized")?;
    let pool = &db.pool;

    let performance = compute_employee_performance(pool, employee_id)
        .await
        .map_err(|e| format!("Failed to generate summary: {}", e))?;

    let content = build_summary(&performance);

    Ok(GeneratedSummary { content })
}

fn build_summary(performance: &EmployeePerformance) -> String {
    let employee = &performance.employee;
    let total_competencies = performance.scores.len();
    let average = performance.average_score;

    let mut numeric_scores: Vec<_> = performance
        .scores
        .iter()
        .filter_map(|score| {
            score
                .score
                .numeric_value
                .map(|val| (score.competency.name.clone(), val))
        })
        .collect();
    numeric_scores.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());

    let top_competency = numeric_scores.first();
    let lowest_competency = numeric_scores.last();

    let strengths_text = if performance.strengths.is_empty() {
        "Belum ada kompetensi dengan skor numerik tercatat sebagai kekuatan utama.".to_string()
    } else {
        format!(
            "Kekuatan utama saat ini mencakup {}.",
            performance
                .strengths
                .iter()
                .map(|s| format!("{}", s))
                .collect::<Vec<_>>()
                .join(", ")
        )
    };

    let gaps_text = if performance.gaps.is_empty() {
        "Tidak ada area pengembangan yang tercatat karena nilai numerik belum lengkap.".to_string()
    } else {
        format!(
            "Area yang memerlukan perhatian lanjutan meliputi {}.",
            performance
                .gaps
                .iter()
                .map(|s| format!("{}", s))
                .collect::<Vec<_>>()
                .join(", ")
        )
    };

    let highlight_text = match (top_competency, lowest_competency) {
        (Some(top), Some(low)) if top.0 != low.0 => format!(
            "Skor tertinggi berada pada kompetensi {} dengan nilai {:.2}, sementara skor terendah tercatat pada {} dengan nilai {:.2}.",
            top.0, top.1, low.0, low.1
        ),
        (Some(top), _) => format!(
            "Kompetensi dengan capaian tertinggi adalah {} dengan nilai {:.2}.",
            top.0, top.1
        ),
        _ => "Belum tersedia skor numerik untuk mendeskripsikan capaian kompetensi secara detail.".to_string(),
    };

    let role_text = match (&employee.jabatan, &employee.sub_jabatan) {
        (Some(jabatan), Some(sub)) if !jabatan.is_empty() && !sub.is_empty() => {
            format!("berperan sebagai {} ({})", jabatan, sub)
        }
        (Some(jabatan), _) if !jabatan.is_empty() => format!("berperan sebagai {}", jabatan),
        _ => "berperan sebagai karyawan".to_string(),
    };

    let nip_text = employee
        .nip
        .as_deref()
        .filter(|nip| !nip.is_empty())
        .map(|nip| format!(" dengan NIP {}", nip))
        .unwrap_or_default();

    let intro = format!(
        "{} saat ini {}{}. Rata-rata pencapaian dari {} kompetensi yang dinilai adalah {:.2}.",
        employee.name, role_text, nip_text, total_competencies, average
    );

    let supportive = if average >= 3.5 {
        "Secara keseluruhan performa berada pada kategori sangat baik dan konsisten di atas ekspektasi organisasi.".to_string()
    } else if average >= 3.0 {
        "Secara keseluruhan performa berada pada kategori baik dengan hasil yang stabil dan memenuhi target utama.".to_string()
    } else if average >= 2.5 {
        "Rata-rata skor menunjukkan performa cukup dengan beberapa area yang masih memerlukan peningkatan.".to_string()
    } else {
        "Performa saat ini berada di bawah target organisasi sehingga dibutuhkan rencana pengembangan terstruktur.".to_string()
    };

    let closing = "Rekomendasikan tindak lanjut berupa sesi umpan balik terjadwal, pemantauan target triwulanan, serta dukungan pelatihan yang relevan agar progres dapat diakselerasi.";

    vec![
        intro,
        supportive,
        strengths_text,
        gaps_text,
        highlight_text,
        closing.to_string(),
    ]
    .into_iter()
    .collect::<Vec<_>>()
    .join("\n\n")
}

#[tauri::command]
pub async fn get_employee_summary(
    state: State<'_, AppState>,
    employee_id: i64,
) -> Result<Option<Summary>, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Database not initialized")?;
    let pool = &db.pool;

    let summary = sqlx::query_as::<_, Summary>("SELECT * FROM summaries WHERE employee_id = ?")
        .bind(employee_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("Failed to load summary: {}", e))?;

    Ok(summary)
}

#[tauri::command]
pub async fn save_employee_summary(
    state: State<'_, AppState>,
    employee_id: i64,
    content: String,
) -> Result<Summary, String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Database not initialized")?;
    let pool = &db.pool;

    let summary = sqlx::query_as::<_, Summary>(
        r#"
        INSERT INTO summaries (employee_id, content, created_at, updated_at)
        VALUES (?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(employee_id) DO UPDATE
        SET content = excluded.content,
            updated_at = datetime('now')
        RETURNING *
        "#,
    )
    .bind(employee_id)
    .bind(content)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to save summary: {}", e))?;

    Ok(summary)
}

#[tauri::command]
pub async fn export_employee_summary_pdf(
    state: State<'_, AppState>,
    employee_id: i64,
    file_path: String,
) -> Result<(), String> {
    let db_lock = state.db.lock().await;
    let db = db_lock.as_ref().ok_or("Database not initialized")?;
    let pool = &db.pool;

    let performance = compute_employee_performance(pool, employee_id)
        .await
        .map_err(|e| format!("Failed to prepare export: {}", e))?;

    let content = if let Some(existing) =
        sqlx::query_as::<_, Summary>("SELECT * FROM summaries WHERE employee_id = ?")
            .bind(employee_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("Failed to load summary for export: {}", e))?
    {
        existing.content
    } else {
        build_summary(&performance)
    };

    write_summary_pdf(&performance, &content, file_path)
}

fn write_summary_pdf(
    performance: &EmployeePerformance,
    content: &str,
    file_path: String,
) -> Result<(), String> {
    let mut document =
        Pdf::create(&file_path).map_err(|e| format!("Failed to create PDF: {}", e))?;
    let title = format!("Ringkasan Kinerja - {}", performance.employee.name);

    let body_lines = wrap_text(content, 90);
    let metadata_lines = collect_metadata_lines(performance);

    let first_capacity = summary_first_page_capacity(metadata_lines.len());
    let follow_capacity = summary_followup_page_capacity();
    let page_ranges =
        summary_partition_body_lines(body_lines.len(), first_capacity, follow_capacity);

    let (first_start, first_end) = page_ranges[0];
    document
        .render_page(595.0, 842.0, |canvas| {
            render_summary_first_page(
                canvas,
                &title,
                &metadata_lines,
                &body_lines[first_start..first_end],
            )
        })
        .map_err(|e| format!("Failed to render PDF: {}", e))?;

    for (page_index, &(start, end)) in page_ranges.iter().enumerate().skip(1) {
        document
            .render_page(595.0, 842.0, |canvas| {
                render_summary_followup_page(canvas, &title, page_index, &body_lines[start..end])
            })
            .map_err(|e| format!("Failed to render PDF: {}", e))?;
    }

    document
        .finish()
        .map_err(|e| format!("Failed to save PDF: {}", e))
}

fn summary_first_page_capacity(metadata_count: usize) -> usize {
    let mut cursor: f64 = 800.0;
    cursor -= 40.0;
    cursor -= metadata_count as f64 * 16.0;
    cursor -= 16.0;
    let available = cursor - 80.0;
    if available <= 0.0 {
        0
    } else {
        (available / 16.0).floor() as usize
    }
}

fn summary_followup_page_capacity() -> usize {
    let mut cursor: f64 = 800.0;
    cursor -= 24.0;
    let available = cursor - 80.0;
    (available / 16.0).floor() as usize
}

fn summary_partition_body_lines(
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

fn render_summary_first_page(
    canvas: &mut Canvas<'_>,
    title: &str,
    metadata_lines: &[String],
    body_lines: &[String],
) -> std::io::Result<()> {
    let mut cursor_y = 800.0;
    canvas.left_text(50.0, cursor_y, BuiltinFont::Helvetica_Bold, 18.0, title)?;
    cursor_y -= 40.0;

    for line in metadata_lines {
        canvas.left_text(50.0, cursor_y, BuiltinFont::Helvetica, 12.0, line)?;
        cursor_y -= 16.0;
    }

    cursor_y -= 16.0;

    for line in body_lines {
        canvas.left_text(50.0, cursor_y, BuiltinFont::Helvetica, 12.0, line)?;
        cursor_y -= 16.0;
    }

    Ok(())
}

fn render_summary_followup_page(
    canvas: &mut Canvas<'_>,
    title: &str,
    page_index: usize,
    body_lines: &[String],
) -> std::io::Result<()> {
    let mut cursor_y = 800.0;
    let header = if page_index == 1 {
        format!("{} (lanjutan)", title)
    } else {
        format!("{} (lanjutan {})", title, page_index)
    };
    canvas.left_text(50.0, cursor_y, BuiltinFont::Helvetica_Bold, 16.0, &header)?;
    cursor_y -= 24.0;

    for line in body_lines {
        canvas.left_text(50.0, cursor_y, BuiltinFont::Helvetica, 12.0, line)?;
        cursor_y -= 16.0;
    }

    Ok(())
}

fn collect_metadata_lines(performance: &EmployeePerformance) -> Vec<String> {
    let mut lines = Vec::new();
    if let Some(nip) = performance.employee.nip.as_deref() {
        if !nip.is_empty() {
            lines.push(format!("NIP: {}", nip));
        }
    }
    if let Some(jabatan) = performance.employee.jabatan.as_deref() {
        if !jabatan.is_empty() {
            lines.push(format!("Jabatan: {}", jabatan));
        }
    }
    if let Some(gol) = performance.employee.gol.as_deref() {
        if !gol.is_empty() {
            lines.push(format!("Golongan: {}", gol));
        }
    }
    lines.push(format!("Rata-rata skor: {:.2}", performance.average_score));
    lines
}

fn wrap_text(text: &str, max_chars: usize) -> Vec<String> {
    text.split('\n')
        .flat_map(|paragraph| {
            let mut lines = Vec::new();
            let mut current = String::new();
            for word in paragraph.split_whitespace() {
                if current.len() + word.len() + 1 > max_chars {
                    if !current.is_empty() {
                        lines.push(current.clone());
                        current.clear();
                    }
                }
                if !current.is_empty() {
                    current.push(' ');
                }
                current.push_str(word);
            }
            if !current.is_empty() {
                lines.push(current);
            }
            if lines.is_empty() {
                lines.push(String::new());
            }
            lines.push(String::new());
            lines
        })
        .collect()
}
