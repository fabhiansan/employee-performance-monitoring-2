use crate::commands::analytics::compute_employee_performance;
use crate::db::models::{Dataset, Employee};
use crate::AppState;
use chrono::Datelike;
use pdf_canvas::{BuiltinFont, Canvas, Pdf};
use tauri::State;
use unicode_normalization::UnicodeNormalization;

#[derive(Clone)]
struct WeightedParameter {
    parameter: &'static str,
    weight: f64,
    aliases: &'static [&'static str],
}

#[derive(Clone)]
struct DualWeightedParameter {
    parameter: &'static str,
    eselon_weight: f64,
    staff_weight: f64,
    aliases: &'static [&'static str],
}

#[derive(Clone)]
struct ScoreComponent {
    parameter: String,
    raw_score: f64,
    weight_percentage: f64,
    weighted_score: f64,
}

#[derive(Clone)]
struct ComponentResult {
    subtotal: f64,
    breakdown: Vec<ScoreComponent>,
}

#[derive(Clone)]
struct LeadershipScoreResult {
    raw_score: f64,
    weighted_score: f64,
    applied: bool,
}

#[derive(Clone)]
struct ComponentSection {
    title: String,
    cap: f64,
    subtotal: f64,
    breakdown: Vec<ScoreComponent>,
}

#[derive(Clone)]
struct CompetencyScore {
    name: String,
    raw_score: f64,
    original_score: f64,
}

#[derive(Clone)]
struct EmployeeReportContext {
    dataset: Dataset,
    employee: Employee,
    position_type: PositionType,
    normalization_scale: f64,
    competencies: Vec<CompetencyScore>,
    component_sections: Vec<ComponentSection>,
    total_score: f64,
    rating: String,
    strengths: Vec<String>,
    gaps: Vec<String>,
    average_score: f64,
}

#[derive(Clone, Copy)]
enum PositionType {
    Eselon,
    Staff,
}

impl PositionType {
    fn label(&self) -> &'static str {
        match self {
            PositionType::Eselon => "eselon",
            PositionType::Staff => "staff",
        }
    }
}

const PERILAKU_PARAMS: &[WeightedParameter] = &[
    WeightedParameter {
        parameter: "Inisiatif dan fleksibilitas",
        weight: 5.0,
        aliases: &["inisiatif", "initiative", "fleksibilitas", "flexibility"],
    },
    WeightedParameter {
        parameter: "Kehadiran dan ketepatan waktu",
        weight: 5.0,
        aliases: &[
            "kehadiran",
            "ketepatan waktu",
            "attendance",
            "punctuality",
            "absensi",
        ],
    },
    WeightedParameter {
        parameter: "Kerjasama dan team work",
        weight: 5.0,
        aliases: &["kerjasama", "team work", "teamwork", "kolaborasi", "team"],
    },
    WeightedParameter {
        parameter: "Manajemen waktu kerja",
        weight: 5.0,
        aliases: &["manajemen waktu", "time management"],
    },
    WeightedParameter {
        parameter: "Kepemimpinan",
        weight: 10.0,
        aliases: &["kepemimpinan", "leadership", "leader"],
    },
];

const KUALITAS_PARAMS: &[DualWeightedParameter] = &[
    DualWeightedParameter {
        parameter: "Kualitas kinerja",
        eselon_weight: 25.5,
        staff_weight: 42.5,
        aliases: &["kualitas kinerja", "kinerja", "quality of work", "quality"],
    },
    DualWeightedParameter {
        parameter: "Kemampuan berkomunikasi",
        eselon_weight: 8.5,
        staff_weight: 8.5,
        aliases: &["komunikasi", "communication"],
    },
    DualWeightedParameter {
        parameter: "Pemahaman tentang permasalahan sosial",
        eselon_weight: 8.5,
        staff_weight: 8.5,
        aliases: &[
            "permasalahan sosial",
            "social issues",
            "social problem",
            "pemahaman sosial",
        ],
    },
];

const PERILAKU_CAP: f64 = 25.5;
const KUALITAS_CAP_ESELON: f64 = 42.5;
const KUALITAS_CAP_STAFF: f64 = 70.0;
const LEADERSHIP_CAP: f64 = 17.0;
const TOTAL_CAP: f64 = 85.0;
const LEADERSHIP_WEIGHT: f64 = 0.17;
const DEFAULT_LEADERSHIP_SCORE: f64 = 80.0;

const ESELON_KEYWORDS: &[&str] = &[
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

const STAFF_KEYWORDS: &[&str] = &["staff", "staf"];

#[tauri::command]
pub async fn export_employee_report_pdf(
    state: State<'_, AppState>,
    dataset_id: i64,
    employee_id: i64,
    file_path: String,
) -> Result<(), String> {
    let pool = state.pool.clone();

    let dataset = sqlx::query_as::<_, Dataset>("SELECT * FROM datasets WHERE id = ?")
        .bind(dataset_id)
        .fetch_one(&pool)
        .await
        .map_err(|e| format!("Failed to load dataset: {}", e))?;

    let performance = compute_employee_performance(&pool, dataset_id, employee_id)
        .await
        .map_err(|e| format!("Failed to load employee performance: {}", e))?;

    let report_context = build_report_context(dataset, performance);
    render_report_pdf(&report_context, &file_path)
}

fn build_report_context(
    dataset: Dataset,
    performance: crate::commands::analytics::EmployeePerformance,
) -> EmployeeReportContext {
    let (normalization_result, normalization_scale) = normalize_competencies(&performance.scores);
    let position_type = determine_position_type(&performance.employee);

    let perilaku = calculate_perilaku_kinerja(&normalization_result);
    let kualitas = calculate_kualitas_kerja(&normalization_result, position_type);
    let has_performance_data =
        !normalization_result.is_empty() && (perilaku.subtotal > 0.0 || kualitas.subtotal > 0.0);
    let leadership = compute_leadership_score(position_type, has_performance_data, None);
    let total_score =
        calculate_total_score(position_type, &perilaku, &kualitas, leadership.as_ref());
    let rating = get_performance_rating(total_score).to_string();

    let mut component_sections = Vec::new();
    component_sections.push(ComponentSection {
        title: "Perilaku Kerja (30%)".to_string(),
        cap: PERILAKU_CAP,
        subtotal: perilaku.subtotal,
        breakdown: perilaku.breakdown.clone(),
    });

    component_sections.push(ComponentSection {
        title: "Kualitas Kerja".to_string(),
        cap: match position_type {
            PositionType::Eselon => KUALITAS_CAP_ESELON,
            PositionType::Staff => KUALITAS_CAP_STAFF,
        },
        subtotal: kualitas.subtotal,
        breakdown: kualitas.breakdown.clone(),
    });

    if let Some(leader) = leadership.clone() {
        component_sections.push(ComponentSection {
            title: "Penilaian Pimpinan".to_string(),
            cap: LEADERSHIP_CAP,
            subtotal: leader.weighted_score,
            breakdown: vec![ScoreComponent {
                parameter: if leader.applied {
                    "Nilai Pimpinan"
                } else {
                    "Tidak diaplikasikan"
                }
                .to_string(),
                raw_score: leader.raw_score,
                weight_percentage: 20.0,
                weighted_score: leader.weighted_score,
            }],
        });
    }

    let mut competencies: Vec<CompetencyScore> = performance
        .scores
        .iter()
        .zip(normalization_result.iter())
        .map(|(score, normalized)| CompetencyScore {
            name: score.competency.name.clone(),
            raw_score: normalized.raw_score,
            original_score: normalized.original_score,
        })
        .collect();

    competencies.sort_by(|a, b| {
        b.raw_score
            .partial_cmp(&a.raw_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    EmployeeReportContext {
        dataset,
        employee: performance.employee.clone(),
        position_type,
        normalization_scale,
        competencies,
        component_sections,
        total_score,
        rating,
        strengths: performance.strengths.clone(),
        gaps: performance.gaps.clone(),
        average_score: performance.average_score,
    }
}

fn normalize_competencies(
    scores: &[crate::commands::analytics::ScoreWithCompetency],
) -> (Vec<CompetencyScore>, f64) {
    let original_values: Vec<f64> = scores.iter().map(parse_numeric_score).collect();
    let normalization_scale = determine_scale(&original_values);

    let competencies = scores
        .iter()
        .zip(original_values.iter())
        .map(|(entry, original)| {
            let normalized = if normalization_scale <= 0.0 {
                0.0
            } else {
                ((original / normalization_scale) * 100.0).clamp(0.0, 100.0)
            };

            CompetencyScore {
                name: entry.competency.name.clone(),
                raw_score: normalized,
                original_score: *original,
            }
        })
        .collect();

    (competencies, normalization_scale)
}

fn parse_numeric_score(score: &crate::commands::analytics::ScoreWithCompetency) -> f64 {
    if let Some(value) = score.score.numeric_value {
        if value.is_finite() {
            return value;
        }
    }
    score
        .score
        .raw_value
        .replace(',', ".")
        .parse::<f64>()
        .unwrap_or(0.0)
}

fn determine_scale(values: &[f64]) -> f64 {
    let max = values
        .iter()
        .copied()
        .fold(0.0_f64, |current, value| current.max(value));
    if max <= 0.0 {
        100.0
    } else if max <= 5.0 {
        4.0
    } else if max <= 10.0 {
        10.0
    } else if max <= 20.0 {
        20.0
    } else if max <= 100.0 {
        100.0
    } else {
        max
    }
}

fn calculate_perilaku_kinerja(scores: &[CompetencyScore]) -> ComponentResult {
    let mut breakdown = Vec::new();

    for param in PERILAKU_PARAMS {
        let raw = find_competency_score(scores, param.parameter, param.aliases);
        breakdown.push(to_component(param.parameter, raw, param.weight));
    }

    let subtotal = breakdown
        .iter()
        .map(|component| component.weighted_score)
        .sum::<f64>()
        .min(PERILAKU_CAP);

    ComponentResult {
        subtotal,
        breakdown,
    }
}

fn calculate_kualitas_kerja(
    scores: &[CompetencyScore],
    position_type: PositionType,
) -> ComponentResult {
    let mut breakdown = Vec::new();

    for param in KUALITAS_PARAMS {
        let raw = find_competency_score(scores, param.parameter, param.aliases);
        let weight = match position_type {
            PositionType::Eselon => param.eselon_weight,
            PositionType::Staff => param.staff_weight,
        };
        breakdown.push(to_component(param.parameter, raw, weight));
    }

    let cap = match position_type {
        PositionType::Eselon => KUALITAS_CAP_ESELON,
        PositionType::Staff => KUALITAS_CAP_STAFF,
    };

    let subtotal = breakdown
        .iter()
        .map(|component| component.weighted_score)
        .sum::<f64>()
        .min(cap);

    ComponentResult {
        subtotal,
        breakdown,
    }
}

fn compute_leadership_score(
    position_type: PositionType,
    has_performance_data: bool,
    override_score: Option<f64>,
) -> Option<LeadershipScoreResult> {
    if !matches!(position_type, PositionType::Eselon) {
        return None;
    }

    if !has_performance_data {
        return Some(LeadershipScoreResult {
            raw_score: 0.0,
            weighted_score: 0.0,
            applied: false,
        });
    }

    let raw = clamp_score(override_score.unwrap_or(DEFAULT_LEADERSHIP_SCORE));
    Some(LeadershipScoreResult {
        raw_score: raw,
        weighted_score: raw * LEADERSHIP_WEIGHT,
        applied: true,
    })
}

fn calculate_total_score(
    position_type: PositionType,
    perilaku: &ComponentResult,
    kualitas: &ComponentResult,
    leadership: Option<&LeadershipScoreResult>,
) -> f64 {
    let leadership_contrib = if matches!(position_type, PositionType::Eselon) {
        leadership.map(|s| s.weighted_score).unwrap_or(0.0)
    } else {
        0.0
    };

    (perilaku.subtotal + kualitas.subtotal + leadership_contrib).min(TOTAL_CAP)
}

fn get_performance_rating(total_score: f64) -> &'static str {
    if total_score >= 80.0 {
        "Sangat Baik"
    } else if total_score >= 70.0 {
        "Baik"
    } else if total_score >= 60.0 {
        "Kurang Baik"
    } else {
        "Perlu Pembinaan"
    }
}

fn to_component(parameter: &str, raw_score: f64, weight_percentage: f64) -> ScoreComponent {
    ScoreComponent {
        parameter: parameter.to_string(),
        raw_score,
        weight_percentage,
        weighted_score: (raw_score * weight_percentage) / 100.0,
    }
}

fn find_competency_score(scores: &[CompetencyScore], parameter: &str, aliases: &[&str]) -> f64 {
    if scores.is_empty() {
        return 0.0;
    }

    let mut targets: Vec<String> = Vec::with_capacity(1 + aliases.len());
    targets.push(normalize_text(parameter));
    for alias in aliases {
        targets.push(normalize_text(alias));
    }

    for score in scores {
        let normalized_name = normalize_text(&score.name);
        if targets.iter().any(|token| normalized_name.contains(token)) {
            return clamp_score(score.raw_score);
        }
    }

    0.0
}

fn normalize_text(value: &str) -> String {
    value
        .nfd()
        .filter(|c| !unicode_normalization::char::is_combining_mark(*c))
        .collect::<String>()
        .to_lowercase()
        .chars()
        .filter(|ch| ch.is_ascii_alphabetic() || ch.is_whitespace())
        .collect()
}

fn clamp_score(value: f64) -> f64 {
    if !value.is_finite() {
        0.0
    } else {
        value.clamp(0.0, 100.0)
    }
}

fn determine_position_type(employee: &Employee) -> PositionType {
    let combined = format!(
        "{} {}",
        employee.jabatan.as_deref().unwrap_or_default(),
        employee.sub_jabatan.as_deref().unwrap_or_default()
    );
    let normalized = normalize_text(&combined);

    if !normalized.is_empty() {
        if STAFF_KEYWORDS
            .iter()
            .map(|keyword| normalize_text(keyword))
            .any(|token| normalized.contains(&token))
        {
            return PositionType::Staff;
        }

        if ESELON_KEYWORDS
            .iter()
            .map(|keyword| normalize_text(keyword))
            .any(|token| normalized.contains(&token))
        {
            return PositionType::Eselon;
        }
    }

    if let Some(gol) = employee.gol.as_deref() {
        let gol_upper = gol.trim().to_uppercase();
        if gol_upper.starts_with("IV") {
            return PositionType::Eselon;
        }
    }

    PositionType::Staff
}

fn render_report_pdf(context: &EmployeeReportContext, file_path: &str) -> Result<(), String> {
    let mut document =
        Pdf::create(file_path).map_err(|e| format!("Failed to create PDF: {}", e))?;

    // Page 1: Cover/criteria (landscape A4)
    document
        .render_page(842.0, 595.0, |canvas| {
            draw_cover_page_landscape(canvas, context)
        })
        .map_err(|e| format!("Failed to render cover page: {}", e))?;

    // Page 2: Worksheet/evaluation (landscape A4)
    document
        .render_page(842.0, 595.0, |canvas| {
            draw_worksheet_page_landscape(canvas, context)
        })
        .map_err(|e| format!("Failed to render worksheet page: {}", e))?;

    document
        .finish()
        .map_err(|e| format!("Failed to save PDF: {}", e))
}

fn fmt_id(value: f64) -> String {
    format!("{:.2}", value).replace('.', ",")
}

fn draw_cover_page_landscape(
    canvas: &mut Canvas<'_>,
    context: &EmployeeReportContext,
) -> std::io::Result<()> {
    let mut y = 555.0;

    // Header with logo placeholder and agency info
    canvas.left_text(
        50.0,
        y,
        BuiltinFont::Helvetica_Bold,
        11.0,
        "PEMERINTAH PROVINSI KALIMANTAN SELATAN",
    )?;
    y -= 16.0;
    canvas.left_text(50.0, y, BuiltinFont::Helvetica_Bold, 14.0, "DINAS SOSIAL")?;
    y -= 20.0;

    // Contact information
    canvas.left_text(
        50.0,
        y,
        BuiltinFont::Helvetica,
        9.0,
        "Jalan Letjen R. Soeprapto No. 8 Banjarmasin Kode Pos 70114",
    )?;
    y -= 11.0;
    canvas.left_text(
        50.0,
        y,
        BuiltinFont::Helvetica,
        9.0,
        "Telepon : (0511) 335 0825, Fax. (0511) 335 4193",
    )?;
    y -= 11.0;
    canvas.left_text(
        50.0,
        y,
        BuiltinFont::Helvetica,
        9.0,
        "Email: dinsosialselprov@gmail.com Website: dinsoss.kalselprov.go.id",
    )?;
    y -= 25.0;

    // Title
    let year = context
        .dataset
        .created_at
        .with_timezone(&chrono::Local)
        .year();
    canvas.center_text(
        421.0,
        y,
        BuiltinFont::Helvetica_Bold,
        12.0,
        "HASIL PENILAIAN KINERJA PEGAWAI DINAS SOSIAL PROVINSI",
    )?;
    y -= 14.0;
    canvas.center_text(
        421.0,
        y,
        BuiltinFont::Helvetica_Bold,
        12.0,
        &format!("KALIMANTAN SELATAN SEMESTER I TAHUN {}", year),
    )?;
    y -= 25.0;

    // Official intro paragraph
    canvas.left_text(50.0, y, BuiltinFont::Helvetica, 10.0, "       Penilaian Kinerja oleh seluruh pegawai Dinas Sosial Provinsi Kalimantan Selatan sampai dengan")?;
    y -= 12.0;
    let year_line = format!("Semester I Tahun {} berdasarkan dari Kualitas Kinerja dengan melalui form yang disebarkan tiap akhir", year);
    canvas.left_text(50.0, y, BuiltinFont::Helvetica, 10.0, &year_line)?;
    y -= 12.0;
    canvas.left_text(
        50.0,
        y,
        BuiltinFont::Helvetica,
        10.0,
        "semester, dengan kriteria penilaian sebagai berikut :",
    )?;
    y -= 20.0;

    // Table: Kriteria dan Bobot
    canvas.left_text(50.0, y, BuiltinFont::Helvetica_Bold, 10.5, "NO.")?;
    canvas.left_text(120.0, y, BuiltinFont::Helvetica_Bold, 10.5, "KRITERIA")?;
    canvas.left_text(720.0, y, BuiltinFont::Helvetica_Bold, 10.5, "BOBOT")?;
    y -= 14.0;

    // A. Perilaku Kerja (30%)
    canvas.left_text(50.0, y, BuiltinFont::Helvetica_Bold, 10.0, "A.")?;
    canvas.left_text(
        120.0,
        y,
        BuiltinFont::Helvetica_Bold,
        10.0,
        "PERILAKU KERJA",
    )?;
    canvas.left_text(720.0, y, BuiltinFont::Helvetica_Bold, 10.0, "30%")?;
    y -= 12.0;

    let perilaku_items = [
        "1. Kehadiran dan Tepat Waktu",
        "2. Management Waktu Kerja",
        "3. Kerjasama dan Teamwork",
        "4. Inisiatif dan Flexibilitas",
        "5. Kepemimpinan",
    ];
    for item in perilaku_items.iter() {
        canvas.left_text(140.0, y, BuiltinFont::Helvetica, 9.5, item)?;
        y -= 11.0;
    }

    // B. Kualitas Kinerja (50%)
    y -= 4.0;
    canvas.left_text(50.0, y, BuiltinFont::Helvetica_Bold, 10.0, "B.")?;
    canvas.left_text(
        120.0,
        y,
        BuiltinFont::Helvetica_Bold,
        10.0,
        "KUALITAS KINERJA",
    )?;
    canvas.left_text(720.0, y, BuiltinFont::Helvetica_Bold, 10.0, "50%")?;
    y -= 12.0;

    let kualitas_items = [
        "1. Kualitas Kinerja",
        "2. Kemampuan Berkomunikasi",
        "3. Pemahaman Urusan Sosial",
    ];
    for item in kualitas_items.iter() {
        canvas.left_text(140.0, y, BuiltinFont::Helvetica, 9.5, item)?;
        y -= 11.0;
    }

    // C. Penilaian Pimpinan (20%)
    y -= 4.0;
    canvas.left_text(50.0, y, BuiltinFont::Helvetica_Bold, 10.0, "C.")?;
    canvas.left_text(
        120.0,
        y,
        BuiltinFont::Helvetica_Bold,
        10.0,
        "PENILAIAN PIMPINAN",
    )?;
    canvas.left_text(720.0, y, BuiltinFont::Helvetica_Bold, 10.0, "20%")?;
    y -= 14.0;

    // Total row
    y -= 4.0;
    canvas.center_text(420.0, y, BuiltinFont::Helvetica_Bold, 10.0, "TOTAL")?;
    canvas.left_text(720.0, y, BuiltinFont::Helvetica_Bold, 10.0, "100%")?;
    y -= 18.0;

    // Rating bands
    canvas.left_text(
        50.0,
        y,
        BuiltinFont::Helvetica,
        9.5,
        "Predikat skor akhir penilaian Penilaian Pegawai dengan kinerja terbaik sebagai berikut :",
    )?;
    y -= 12.0;

    let bands = [
        ("SANGAT BAIK", ">= 80,00"),
        ("BAIK", "70,00 - 79,99"),
        ("KURANG BAIK", "65,00 - 69,99"),
    ];
    for (i, (label, thr)) in bands.iter().enumerate() {
        canvas.left_text(
            70.0,
            y,
            BuiltinFont::Helvetica,
            9.5,
            &format!("{}. {} : {}", (b'a' + i as u8) as char, label, thr),
        )?;
        y -= 11.0;
    }
    y -= 12.0;

    // Conclusion line
    let position_title = match context.position_type {
        PositionType::Eselon => {
            if let Some(jabatan) = &context.employee.jabatan {
                jabatan.clone()
            } else {
                "Pegawai".to_string()
            }
        }
        PositionType::Staff => "Pegawai".to_string(),
    };

    let conclusion = format!(
        "       Berdasarkan hasil penilaian, dapat disampaikan bahwa capaian kinerja {} {} memperoleh",
        position_title, context.employee.name
    );
    canvas.left_text(50.0, y, BuiltinFont::Helvetica, 10.0, &conclusion)?;
    y -= 12.0;
    let conclusion2 = format!(
        "predikat \"{}\" dengan nilai {}.",
        context.rating.to_uppercase(),
        fmt_id(context.total_score)
    );
    canvas.left_text(50.0, y, BuiltinFont::Helvetica, 10.0, &conclusion2)?;

    Ok(())
}

fn draw_worksheet_page_landscape(
    canvas: &mut Canvas<'_>,
    context: &EmployeeReportContext,
) -> std::io::Result<()> {
    let mut y = 555.0;

    // Header with logo placeholder and contact info
    canvas.left_text(
        50.0,
        y,
        BuiltinFont::Helvetica_Bold,
        11.0,
        "PEMERINTAH PROVINSI KALIMANTAN SELATAN",
    )?;
    y -= 16.0;
    canvas.left_text(50.0, y, BuiltinFont::Helvetica_Bold, 14.0, "DINAS SOSIAL")?;
    y -= 20.0;

    // Contact information
    canvas.left_text(
        50.0,
        y,
        BuiltinFont::Helvetica,
        9.0,
        "Jalan Letjen R. Soeprapto No. 8 Banjarmasin Kode Pos 70114",
    )?;
    y -= 11.0;
    canvas.left_text(
        50.0,
        y,
        BuiltinFont::Helvetica,
        9.0,
        "Telepon : (0511) 335 0825, Fax. (0511) 335 4193",
    )?;
    y -= 11.0;
    canvas.left_text(
        50.0,
        y,
        BuiltinFont::Helvetica,
        9.0,
        "Email: dinsosialselprov@gmail.com Website: dinsoss.kalselprov.go.id",
    )?;
    y -= 25.0;

    // Title
    let year = context
        .dataset
        .created_at
        .with_timezone(&chrono::Local)
        .year();

    let position_title = match context.position_type {
        PositionType::Eselon => "ESELON III",
        PositionType::Staff => "STAFF",
    };

    canvas.center_text(
        421.0,
        y,
        BuiltinFont::Helvetica_Bold,
        12.0,
        &format!(
            "KERTAS KERJA EVALUASI PENGUKURAN KINERJA {}",
            position_title
        ),
    )?;
    y -= 14.0;
    canvas.center_text(
        421.0,
        y,
        BuiltinFont::Helvetica_Bold,
        12.0,
        "DINAS SOSIAL PROVINSI KALIMANTAN SELATAN SEMESTER I",
    )?;
    y -= 14.0;
    canvas.center_text(
        421.0,
        y,
        BuiltinFont::Helvetica_Bold,
        12.0,
        &format!("TAHUN {}", year),
    )?;
    y -= 25.0;

    // Table header
    canvas.left_text(50.0, y, BuiltinFont::Helvetica_Bold, 10.5, "NO.")?;
    canvas.left_text(
        120.0,
        y,
        BuiltinFont::Helvetica_Bold,
        10.5,
        "KOMPONEN / KRITERIA",
    )?;
    canvas.left_text(660.0, y, BuiltinFont::Helvetica_Bold, 10.5, "BOBOT")?;
    canvas.left_text(750.0, y, BuiltinFont::Helvetica_Bold, 10.5, "NILAI")?;
    y -= 4.0;
    canvas.left_text(50.0, y, BuiltinFont::Helvetica_Bold, 10.5, "1")?;
    canvas.left_text(120.0, y, BuiltinFont::Helvetica_Bold, 10.5, "2")?;
    canvas.left_text(660.0, y, BuiltinFont::Helvetica_Bold, 10.5, "3")?;
    canvas.left_text(750.0, y, BuiltinFont::Helvetica_Bold, 10.5, "3")?;
    y -= 14.0;

    // I. PERILAKU KERJA (30%)
    canvas.left_text(50.0, y, BuiltinFont::Helvetica_Bold, 10.0, "I.")?;
    canvas.left_text(
        120.0,
        y,
        BuiltinFont::Helvetica_Bold,
        10.0,
        "PERILAKU KERJA (30%)",
    )?;
    canvas.left_text(
        660.0,
        y,
        BuiltinFont::Helvetica_Bold,
        10.0,
        &fmt_id(PERILAKU_CAP),
    )?;
    canvas.left_text(
        750.0,
        y,
        BuiltinFont::Helvetica_Bold,
        10.0,
        &fmt_id(
            context
                .component_sections
                .get(0)
                .map(|s| s.subtotal)
                .unwrap_or(0.0),
        ),
    )?;
    y -= 12.0;

    // Perilaku kerja breakdown
    let perilaku_section = &context.component_sections[0];
    for (i, component) in perilaku_section.breakdown.iter().enumerate() {
        let num = format!("{}", i + 1);
        canvas.left_text(120.0, y, BuiltinFont::Helvetica, 9.5, &num)?;
        canvas.left_text(140.0, y, BuiltinFont::Helvetica, 9.5, &component.parameter)?;
        canvas.left_text(
            750.0,
            y,
            BuiltinFont::Helvetica,
            9.5,
            &fmt_id(component.weighted_score),
        )?;
        y -= 11.0;
    }
    y -= 4.0;

    // II. KUALITAS KINERJA (50%)
    canvas.left_text(50.0, y, BuiltinFont::Helvetica_Bold, 10.0, "II.")?;
    canvas.left_text(
        120.0,
        y,
        BuiltinFont::Helvetica_Bold,
        10.0,
        "KUALITAS KINERJA (50%)",
    )?;
    let kualitas_cap = match context.position_type {
        PositionType::Eselon => KUALITAS_CAP_ESELON,
        PositionType::Staff => KUALITAS_CAP_STAFF,
    };
    canvas.left_text(
        660.0,
        y,
        BuiltinFont::Helvetica_Bold,
        10.0,
        &fmt_id(kualitas_cap),
    )?;
    canvas.left_text(
        750.0,
        y,
        BuiltinFont::Helvetica_Bold,
        10.0,
        &fmt_id(
            context
                .component_sections
                .get(1)
                .map(|s| s.subtotal)
                .unwrap_or(0.0),
        ),
    )?;
    y -= 12.0;

    // Kualitas kinerja breakdown
    let kualitas_section = &context.component_sections[1];
    for (i, component) in kualitas_section.breakdown.iter().enumerate() {
        let num = format!("{}", i + 1);
        canvas.left_text(120.0, y, BuiltinFont::Helvetica, 9.5, &num)?;
        canvas.left_text(140.0, y, BuiltinFont::Helvetica, 9.5, &component.parameter)?;
        canvas.left_text(
            750.0,
            y,
            BuiltinFont::Helvetica,
            9.5,
            &fmt_id(component.weighted_score),
        )?;
        y -= 11.0;
    }
    y -= 4.0;

    // III. PENILAIAN PIMPINAN (20%)
    canvas.left_text(50.0, y, BuiltinFont::Helvetica_Bold, 10.0, "III.")?;
    canvas.left_text(
        120.0,
        y,
        BuiltinFont::Helvetica_Bold,
        10.0,
        "PENILAIAN PIMPINAN (20%)",
    )?;
    canvas.left_text(
        660.0,
        y,
        BuiltinFont::Helvetica_Bold,
        10.0,
        &fmt_id(LEADERSHIP_CAP),
    )?;
    canvas.left_text(
        750.0,
        y,
        BuiltinFont::Helvetica_Bold,
        10.0,
        &fmt_id(
            context
                .component_sections
                .get(2)
                .map(|s| s.subtotal)
                .unwrap_or(0.0),
        ),
    )?;
    y -= 16.0;

    // Final total row
    canvas.left_text(350.0, y, BuiltinFont::Helvetica_Bold, 10.5, "NILAI AKHIR")?;
    canvas.left_text(
        660.0,
        y,
        BuiltinFont::Helvetica_Bold,
        10.5,
        &fmt_id(TOTAL_CAP),
    )?;
    canvas.left_text(
        750.0,
        y,
        BuiltinFont::Helvetica_Bold,
        10.5,
        &fmt_id(context.total_score),
    )?;
    y -= 40.0;

    // Official signature section
    canvas.right_text(
        792.0,
        y,
        BuiltinFont::Helvetica,
        10.0,
        "Plt. KEPALA DINAS SOSIAL",
    )?;
    y -= 11.0;
    canvas.right_text(
        792.0,
        y,
        BuiltinFont::Helvetica,
        10.0,
        "PROVINSI KALIMANTAN SELATAN",
    )?;
    y -= 55.0;
    canvas.right_text(
        792.0,
        y,
        BuiltinFont::Helvetica_Bold,
        10.0,
        "MUHAMMADUN, A.KS, M.I.Kom",
    )?;

    Ok(())
}
