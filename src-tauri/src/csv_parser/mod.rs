use csv::{ReaderBuilder, StringRecord};
use encoding_rs::{Encoding, UTF_8, WINDOWS_1252};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum CsvParseError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("CSV error: {0}")]
    Csv(#[from] csv::Error),

    #[error("Encoding error")]
    Encoding,

    #[error("Invalid format: {0}")]
    InvalidFormat(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CsvPreview {
    pub headers: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub detected_delimiter: char,
    pub employee_count: usize,
    pub encoding: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedEmployee {
    pub name: String,
    pub nip: Option<String>,
    pub gol: Option<String>,
    pub jabatan: Option<String>,
    pub sub_jabatan: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedScore {
    pub employee_name: String,
    pub competency: String,
    pub value: String,
}

pub struct CsvParser;

impl CsvParser {
    /// Detect the encoding of a file
    pub fn detect_encoding(file_path: &Path) -> Result<&'static Encoding, CsvParseError> {
        let mut file = File::open(file_path)?;
        let mut buffer = vec![0u8; 8192];
        let bytes_read = file.read(&mut buffer)?;

        let (_encoding, _) = Encoding::for_bom(&buffer[..bytes_read]).unwrap_or((UTF_8, 0));

        // Check if it's valid UTF-8
        if std::str::from_utf8(&buffer[..bytes_read]).is_ok() {
            return Ok(UTF_8);
        }

        // Default to Windows-1252 for Indonesian data
        Ok(WINDOWS_1252)
    }

    /// Detect the delimiter used in the CSV file
    pub fn detect_delimiter(content: &str) -> char {
        let first_line = content.lines().next().unwrap_or("");

        let delimiters = [',', '\t', ';', '|'];
        let mut counts: Vec<(char, usize)> = delimiters
            .iter()
            .map(|&d| (d, first_line.matches(d).count()))
            .collect();

        counts.sort_by_key(|&(_, count)| std::cmp::Reverse(count));

        counts.first().map(|&(d, _)| d).unwrap_or(',')
    }

    /// Parse CSV and return a preview
    pub fn preview(file_path: &Path, max_rows: usize) -> Result<CsvPreview, CsvParseError> {
        // Detect encoding
        let encoding = Self::detect_encoding(file_path)?;

        // Read file with detected encoding
        let file = File::open(file_path)?;
        let mut reader = BufReader::new(file);
        let mut bytes = Vec::new();
        reader.read_to_end(&mut bytes)?;

        let (content, _, had_errors) = encoding.decode(&bytes);
        if had_errors {
            return Err(CsvParseError::Encoding);
        }

        // Detect delimiter
        let delimiter = Self::detect_delimiter(&content);

        // Parse CSV
        let mut csv_reader = ReaderBuilder::new()
            .delimiter(delimiter as u8)
            .flexible(true)
            .from_reader(content.as_bytes());

        let header_record = csv_reader.headers()?.clone();
        let headers: Vec<String> = header_record.iter().map(|h| Self::clean_field(h)).collect();
        let unique_employee_names = Self::extract_employee_names(&header_record);

        let mut rows = Vec::new();
        let mut record_count = 0;

        for (idx, result) in csv_reader.records().enumerate() {
            let record = result?;

            if idx < max_rows {
                let row: Vec<String> = record.iter().map(|f| Self::clean_field(f)).collect();
                rows.push(row);
            }

            record_count += 1;
        }

        let employee_count = if !unique_employee_names.is_empty() {
            unique_employee_names.len()
        } else {
            record_count
        };

        Ok(CsvPreview {
            headers,
            rows,
            detected_delimiter: delimiter,
            employee_count,
            encoding: encoding.name().to_string(),
        })
    }

    /// Clean and normalize field values
    pub fn clean_field(field: &str) -> String {
        let trimmed = field.trim().trim_matches('"').trim();

        let mut parts = trimmed.split_whitespace();
        if let Some(first) = parts.next() {
            let mut normalized = String::from(first);
            for part in parts {
                normalized.push(' ');
                normalized.push_str(part);
            }
            normalized
        } else {
            String::new()
        }
    }

    /// Extract employee name from bracketed format: "1. Competency [Employee Name]"
    pub fn extract_employee_name(field: &str) -> Option<String> {
        let start = field.find('[')?;
        let end = field.find(']')?;

        if start < end {
            Some(field[start + 1..end].trim().to_string())
        } else {
            None
        }
    }

    /// Parse employee data CSV (like data_pegawai_all.csv)
    pub fn parse_employee_csv(file_path: &Path) -> Result<Vec<ParsedEmployee>, CsvParseError> {
        let encoding = Self::detect_encoding(file_path)?;

        let file = File::open(file_path)?;
        let mut reader = BufReader::new(file);
        let mut bytes = Vec::new();
        reader.read_to_end(&mut bytes)?;

        let (content, _, had_errors) = encoding.decode(&bytes);
        if had_errors {
            return Err(CsvParseError::Encoding);
        }

        let delimiter = Self::detect_delimiter(&content);

        let mut csv_reader = ReaderBuilder::new()
            .delimiter(delimiter as u8)
            .from_reader(content.as_bytes());

        let headers = csv_reader.headers()?.clone();
        let has_structured_employee_columns = headers.iter().any(|h| {
            let normalized = Self::clean_field(h);
            normalized.eq_ignore_ascii_case("NAMA")
                || normalized.eq_ignore_ascii_case("NAME")
                || normalized.eq_ignore_ascii_case("NAMA PEGAWAI")
        });

        if has_structured_employee_columns {
            let mut employees = Vec::new();

            for result in csv_reader.records() {
                let record = result?;

                let name = Self::get_field(&record, &headers, &["NAMA", "Name", "Nama"])?;
                let nip = Self::get_field_opt(&record, &headers, &["NIP", "Nip"]);
                let gol = Self::get_field_opt(&record, &headers, &["GOL", "Gol", "Golongan"]);
                let jabatan = Self::get_field_opt(&record, &headers, &["JABATAN", "Jabatan"]);
                let sub_jabatan = Self::get_field_opt(
                    &record,
                    &headers,
                    &["SUB JABATAN", "Sub Jabatan", "Sub_Jabatan"],
                );

                employees.push(ParsedEmployee {
                    name: Self::clean_field(&name),
                    nip,
                    gol,
                    jabatan,
                    sub_jabatan,
                });
            }

            return Ok(employees);
        }

        let employee_names = Self::extract_employee_names(&headers);
        if employee_names.is_empty() {
            return Err(CsvParseError::InvalidFormat(
                "Unable to detect employee names from CSV headers".to_string(),
            ));
        }

        let employees = employee_names
            .into_iter()
            .map(|name| ParsedEmployee {
                name,
                nip: None,
                gol: None,
                jabatan: None,
                sub_jabatan: None,
            })
            .collect();

        Ok(employees)
    }

    /// Parse performance scores CSV (like contoh_data_penilaian.csv)
    pub fn parse_scores_csv(file_path: &Path) -> Result<Vec<ParsedScore>, CsvParseError> {
        let encoding = Self::detect_encoding(file_path)?;

        let file = File::open(file_path)?;
        let mut reader = BufReader::new(file);
        let mut bytes = Vec::new();
        reader.read_to_end(&mut bytes)?;

        let (content, _, had_errors) = encoding.decode(&bytes);
        if had_errors {
            return Err(CsvParseError::Encoding);
        }

        let delimiter = Self::detect_delimiter(&content);

        let mut csv_reader = ReaderBuilder::new()
            .delimiter(delimiter as u8)
            .flexible(true)
            .from_reader(content.as_bytes());

        let headers = csv_reader.headers()?.clone();
        let mut scores = Vec::new();

        for result in csv_reader.records() {
            let record = result?;

            // Parse each column header to extract competency and employee
            for (idx, header) in headers.iter().enumerate() {
                if let Some(raw_employee_name) = Self::extract_employee_name(header) {
                    let employee_name = Self::clean_field(&raw_employee_name);
                    let competency = header
                        .split('[')
                        .next()
                        .map(|s| Self::clean_field(s))
                        .unwrap_or_default();

                    let value = record
                        .get(idx)
                        .map(|v| Self::clean_field(v))
                        .unwrap_or_default();

                    if !value.is_empty() {
                        scores.push(ParsedScore {
                            employee_name,
                            competency,
                            value,
                        });
                    }
                }
            }
        }

        Ok(scores)
    }

    fn extract_employee_names(headers: &StringRecord) -> Vec<String> {
        let mut seen = HashSet::new();
        let mut names = Vec::new();

        for header in headers.iter() {
            if let Some(employee_name) = Self::extract_employee_name(header) {
                let normalized = Self::clean_field(&employee_name);
                if !normalized.is_empty() && seen.insert(normalized.clone()) {
                    names.push(normalized);
                }
            }
        }

        names
    }

    fn get_field(
        record: &StringRecord,
        headers: &StringRecord,
        names: &[&str],
    ) -> Result<String, CsvParseError> {
        for name in names {
            if let Some(pos) = headers.iter().position(|h| h.eq_ignore_ascii_case(name)) {
                if let Some(value) = record.get(pos) {
                    return Ok(value.to_string());
                }
            }
        }
        Err(CsvParseError::InvalidFormat(format!(
            "Required field not found: {:?}",
            names
        )))
    }

    fn get_field_opt(
        record: &StringRecord,
        headers: &StringRecord,
        names: &[&str],
    ) -> Option<String> {
        for name in names {
            if let Some(pos) = headers.iter().position(|h| h.eq_ignore_ascii_case(name)) {
                if let Some(value) = record.get(pos) {
                    let cleaned = Self::clean_field(value);
                    if !cleaned.is_empty() {
                        return Some(cleaned);
                    }
                }
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn test_extract_employee_name() {
        let field = "1. Inisiatif & Fleksibilitas [GUSNANDA EFFENDI, S.Pd, MM]";
        let name = CsvParser::extract_employee_name(field);
        assert_eq!(name, Some("GUSNANDA EFFENDI, S.Pd, MM".to_string()));
    }

    #[test]
    fn test_detect_delimiter() {
        assert_eq!(CsvParser::detect_delimiter("a,b,c"), ',');
        assert_eq!(CsvParser::detect_delimiter("a\tb\tc"), '\t');
        assert_eq!(CsvParser::detect_delimiter("a;b;c"), ';');
    }

    #[test]
    fn test_clean_field_normalizes_whitespace() {
        assert_eq!(CsvParser::clean_field("  Kurang  Baik  "), "Kurang Baik");
        assert_eq!(CsvParser::clean_field("\tBaik"), "Baik");
    }

    #[test]
    fn test_parse_employee_csv_supports_wide_format() {
        let path = Path::new("../docs/contoh_data_penilaian.csv");
        let employees = CsvParser::parse_employee_csv(path).expect("Failed to parse employees");

        assert_eq!(employees.len(), 19);
        assert_eq!(employees[0].name, "GUSNANDA EFFENDI, S.Pd, MM");
        assert!(employees.iter().all(|emp| emp.nip.is_none()));
    }

    #[test]
    fn test_parse_scores_csv_supports_wide_format() {
        let path = Path::new("../docs/contoh_data_penilaian.csv");
        let scores = CsvParser::parse_scores_csv(path).expect("Failed to parse scores");

        assert_eq!(scores.len(), 604);
        let first = &scores[0];
        assert_eq!(first.employee_name, "GUSNANDA EFFENDI, S.Pd, MM");
        assert_eq!(first.competency, "1. Inisiatif & Fleksibilitas");
        assert_eq!(first.value, "Baik");
    }
}
