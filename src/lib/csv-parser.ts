import Papa from 'papaparse';
import type { CSVPreview, ParsedEmployee, ParsedScore } from '@/types/models';

export class BrowserCSVParser {
  /**
   * Detect delimiter from CSV content
   */
  static detectDelimiter(content: string): string {
    const firstLine = content.split('\n')[0] ?? '';
    const delimiters = [',', '\t', ';', '|'];

    const counts = delimiters.map(d => ({
      delimiter: d,
      count: (firstLine.match(new RegExp(`\\${d}`, 'g')) ?? []).length
    }));

    counts.sort((a, b) => b.count - a.count);
    return counts[0]?.delimiter ?? ',';
  }

  /**
   * Clean field values
   */
  static cleanField(field: string): string {
    return field.trim().replace(/^"|"$/g, '').trim();
  }

  /**
   * Extract employee name from bracketed format: "1. Competency [Employee Name]"
   */
  static extractEmployeeName(field: string): string | null {
    const match = field.match(/\[([^\]]+)\]/);
    return match ? match[1].trim() : null;
  }

  /**
   * Preview CSV file
   */
  static async preview(file: File, maxRows: number = 10): Promise<CSVPreview> {
    return new Promise((resolve, reject) => {
      const text = file.slice(0, Math.min(file.size, 1024 * 1024)); // Read first 1MB for preview

      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        const delimiter = this.detectDelimiter(content);

        Papa.parse(content, {
          delimiter,
          skipEmptyLines: true,
          complete: (results) => {
            const headers = (results.data[0] as string[]).map(h => this.cleanField(h));
            const rows = results.data.slice(1, maxRows + 1).map((row: unknown) =>
              (row as string[]).map(f => this.cleanField(f))
            );

            resolve({
              headers,
              rows,
              detected_delimiter: delimiter,
              employee_count: results.data.length - 1,
              encoding: 'UTF-8'
            });
          },
          error: (error: Error) => {
            reject(new Error(`CSV parse error: ${error.message}`));
          }
        });
      };

      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(text);
    });
  }

  /**
   * Parse employee CSV
   */
  static async parseEmployeeCSV(file: File): Promise<ParsedEmployee[]> {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const normalizeKey = (key: string): string =>
            this.cleanField(key)
              .toLowerCase()
              .replace(/[^a-z0-9]/g, '');

          const employees: ParsedEmployee[] = (results.data)
            .map((row) => {
              const obj: Record<string, unknown> =
                typeof row === 'object' && row !== null ? (row as Record<string, unknown>) : {};
              const keyMap = new Map<string, string>();
              Object.keys(obj).forEach((k) => {
                keyMap.set(normalizeKey(k), k);
              });

              const pick = (candidates: string[]): string | null => {
                for (const cand of candidates) {
                  const k = keyMap.get(normalizeKey(cand));
                  if (k) {
                    const v = obj[k];
                    if (typeof v === 'string') return v;
                    if (typeof v === 'number') return String(v);
                  }
                }
                return null;
              };

              const name = pick(['NAMA', 'Nama', 'NAME', 'Name', 'nama']) ?? '';
              const nip = pick(['NIP', 'Nip', 'nip', 'No NIP', 'No. NIP', 'Nomor Induk Pegawai']);
              const gol = pick(['GOL', 'Gol', 'Golongan', 'gol']);
              const jabatan = pick(['JABATAN', 'Jabatan', 'jabatan']);
              const subJabatan = pick(['SUB JABATAN', 'Sub Jabatan', 'Sub_Jabatan', 'sub_jabatan']);

              return {
                name: this.cleanField(name),
                nip: nip !== null ? this.cleanField(nip) : null,
                gol: gol !== null ? this.cleanField(gol) : null,
                jabatan: jabatan !== null ? this.cleanField(jabatan) : null,
                sub_jabatan: subJabatan !== null ? this.cleanField(subJabatan) : null,
              };
            })
            .filter(emp => emp.name);

          resolve(employees);
        },
        error: (error: Error) => {
          reject(new Error(`Employee CSV parse error: ${error.message}`));
        }
      });
    });
  }

  /**
   * Parse scores CSV
   */
  static async parseScoresCSV(file: File): Promise<ParsedScore[]> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = (e) => {
        const content = e.target?.result as string;
        const delimiter = this.detectDelimiter(content);

        Papa.parse(content, {
          delimiter,
          skipEmptyLines: true,
          complete: (results) => {
            const scores: ParsedScore[] = [];
            const headers = results.data[0] as string[];

            // Parse each row
            for (let rowIdx = 1; rowIdx < results.data.length; rowIdx++) {
              const row = results.data[rowIdx] as string[];

              // Parse each column header to extract competency and employee
              headers.forEach((header, colIdx) => {
                const employeeName = this.extractEmployeeName(header);

                if (employeeName) {
                  const competency = header.split('[')[0].trim();
                  const value = this.cleanField(row[colIdx] ?? '');

                  if (value) {
                    scores.push({
                      employee_name: employeeName,
                      competency: this.cleanField(competency),
                      value
                    });
                  }
                }
              });
            }

            resolve(scores);
          },
          error: (error: Error) => {
            reject(new Error(`Scores CSV parse error: ${error.message}`));
          }
        });
      };

      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }
}
