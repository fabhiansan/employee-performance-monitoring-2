import type {
  Dataset,
  CreateDataset,
  Employee,
  Competency,
  Score,
  CreateRatingMapping,
  DatasetStats,
  EmployeeListResult,
  EmployeePerformance,
  ImportRequest,
  ImportResult,
  ScoreDistribution,
  CompetencyStats,
  EmployeeWithStats,
  ScoreWithCompetency,
  RatingMapping,
  ImportValidationPayload,
  ImportValidationSummary,
  DuplicateEmployeeGroup,
  OrphanScoreIssue,
  UnmappedRatingIssue,
  BlankEmployeeNameIssue,
  ValidationStats,
  Summary,
  GeneratedSummary,
  DatasetComparison,
  CompetencyDelta,
} from '@/types/models';

const DB_NAME = 'employee_monitoring';
const DB_VERSION = 2;

interface DBSchema {
  datasets: Dataset;
  employees: Employee;
  competencies: Competency;
  scores: Score;
  rating_mappings: RatingMapping;
  summaries: Summary;
}

class BrowserStorage {
  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    if (this.db) return;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(new Error(request.error?.message ?? 'Failed to open database'));
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Datasets store
        if (!db.objectStoreNames.contains('datasets')) {
          const datasetsStore = db.createObjectStore('datasets', { keyPath: 'id', autoIncrement: true });
          datasetsStore.createIndex('name', 'name', { unique: false });
        }

        // Employees store
        if (!db.objectStoreNames.contains('employees')) {
          const employeesStore = db.createObjectStore('employees', { keyPath: 'id', autoIncrement: true });
          employeesStore.createIndex('dataset_id', 'dataset_id', { unique: false });
          employeesStore.createIndex('name', 'name', { unique: false });
        }

        // Competencies store
        if (!db.objectStoreNames.contains('competencies')) {
          const competenciesStore = db.createObjectStore('competencies', { keyPath: 'id', autoIncrement: true });
          competenciesStore.createIndex('name', 'name', { unique: true });
        }

        // Scores store
        if (!db.objectStoreNames.contains('scores')) {
          const scoresStore = db.createObjectStore('scores', { keyPath: 'id', autoIncrement: true });
          scoresStore.createIndex('employee_id', 'employee_id', { unique: false });
          scoresStore.createIndex('competency_id', 'competency_id', { unique: false });
        }

        // Rating mappings store
        if (!db.objectStoreNames.contains('rating_mappings')) {
          const ratingsStore = db.createObjectStore('rating_mappings', { keyPath: 'id', autoIncrement: true });
          ratingsStore.createIndex('dataset_id', 'dataset_id', { unique: false });
        }

        if (!db.objectStoreNames.contains('summaries')) {
          const summaryStore = db.createObjectStore('summaries', { keyPath: 'id', autoIncrement: true });
          summaryStore.createIndex('employee_id', 'employee_id', { unique: true });
        }
      };
    });
  }

  private async getObjectStore<K extends keyof DBSchema>(
    storeName: K,
    mode: IDBTransactionMode = 'readonly'
  ): Promise<IDBObjectStore> {
    await this.init();
    if (!this.db) throw new Error('Database not initialized');
    const transaction = this.db.transaction(storeName, mode);
    return transaction.objectStore(storeName);
  }

  // Dataset operations
  async createDataset(dataset: CreateDataset): Promise<Dataset> {
    const store = await this.getObjectStore('datasets', 'readwrite');
    const now = new Date().toISOString();

    const newDataset: Omit<Dataset, 'id'> = {
      name: dataset.name,
      description: dataset.description ?? null,
      source_file: dataset.source_file ?? null,
      created_at: now,
      updated_at: now,
    };

    return new Promise((resolve, reject) => {
      const request = store.add(newDataset);
      request.onsuccess = () => {
        resolve({ ...newDataset, id: request.result as number });
      };
      request.onerror = () => reject(new Error(request.error?.message ?? 'Failed to create dataset'));
    });
  }

  async listDatasets(): Promise<Dataset[]> {
    const store = await this.getObjectStore('datasets');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error(request.error?.message ?? 'Failed to list datasets'));
    });
  }

  async getDataset(id: number): Promise<Dataset> {
    const store = await this.getObjectStore('datasets');
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => {
        if (request.result) {
          resolve(request.result as Dataset);
        } else {
          reject(new Error('Dataset not found'));
        }
      };
      request.onerror = () => reject(new Error(request.error?.message ?? 'Failed to get dataset'));
    });
  }

  async deleteDataset(id: number): Promise<void> {
    const store = await this.getObjectStore('datasets', 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error(request.error?.message ?? 'Failed to delete dataset'));
    });
  }

  // Employee operations
  private async createEmployee(employee: Omit<Employee, 'id'>): Promise<Employee> {
    const store = await this.getObjectStore('employees', 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.add(employee);
      request.onsuccess = () => {
        resolve({ ...employee, id: request.result as number });
      };
      request.onerror = () => reject(new Error(request.error?.message ?? 'Failed to create employee'));
    });
  }

  async listEmployees(
    datasetId: number,
    search?: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<EmployeeListResult> {
    const empStore = await this.getObjectStore('employees');

    return new Promise((resolve, reject) => {
      const index = empStore.index('dataset_id');
      const request = index.getAll(IDBKeyRange.only(datasetId));

      request.onsuccess = async () => {
        let employees = request.result as Employee[];

        // Filter by search
        if (search) {
          const searchLower = search.toLowerCase();
          employees = employees.filter(emp =>
            emp.name.toLowerCase().includes(searchLower) ||
            emp.nip?.toLowerCase().includes(searchLower)
          );
        }

        // Get scores for each employee
        const employeesWithStats: EmployeeWithStats[] = await Promise.all(
          employees.map(async (emp) => {
            const scores = await this.getScoresByEmployee(emp.id);
            const numericScores = scores.map(s => s.numeric_value).filter((v): v is number => v !== null);
            const average = numericScores.length > 0
              ? numericScores.reduce((a, b) => a + b, 0) / numericScores.length
              : 0;

            return {
              ...emp,
              average_score: average,
              score_count: scores.length
            };
          })
        );

        // Pagination
        const total = employeesWithStats.length;
        const paginated = employeesWithStats.slice(offset, offset + limit);

        resolve({
          employees: paginated,
          total_count: total
        });
      };

      request.onerror = () => reject(new Error(request.error?.message ?? 'Failed to list employees'));
    });
  }

  private async getScoresByEmployee(employeeId: number): Promise<Score[]> {
    const store = await this.getObjectStore('scores');
    return new Promise((resolve, reject) => {
      const index = store.index('employee_id');
      const request = index.getAll(IDBKeyRange.only(employeeId));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error(request.error?.message ?? 'Failed to get scores by employee'));
    });
  }

  async getEmployeePerformance(employeeId: number): Promise<EmployeePerformance> {
    const empStore = await this.getObjectStore('employees');

    return new Promise((resolve, reject) => {
      const empRequest = empStore.get(employeeId);

      empRequest.onsuccess = async () => {
        const employee = empRequest.result as Employee | undefined;
        if (!employee) {
          reject(new Error('Employee not found'));
          return;
        }

        const scores = await this.getScoresByEmployee(employeeId);
        const competencies = await this.getAllCompetencies();

        const scoresWithComp: ScoreWithCompetency[] = scores.map(score => ({
          score,
          competency: competencies.find(c => c.id === score.competency_id)!
        })).filter((s): s is ScoreWithCompetency => !!s.competency);

        const numericScores = scores.map(s => s.numeric_value).filter((v): v is number => v !== null);
        const average = numericScores.length > 0
          ? numericScores.reduce((a, b) => a + b, 0) / numericScores.length
          : 0;

        // Calculate strengths and gaps (top 3 and bottom 3)
        const sorted = [...scoresWithComp].sort((a, b) =>
          (b.score.numeric_value ?? 0) - (a.score.numeric_value ?? 0)
        );

        const strengths = sorted.slice(0, 3).map(s => s.competency.name);
        const gaps = sorted.slice(-3).reverse().map(s => s.competency.name);

        resolve({
          employee,
          scores: scoresWithComp,
          average_score: average,
          strengths,
          gaps
        });
      };

      empRequest.onerror = () => reject(new Error(empRequest.error?.message ?? 'Failed to get employee performance'));
    });
  }

  // Competency operations
  private async createCompetency(name: string, displayOrder: number): Promise<Competency> {
    const store = await this.getObjectStore('competencies', 'readwrite');

    // Check if competency already exists
    const existing = await this.getCompetencyByName(name);
    if (existing) return existing;

    const competency: Omit<Competency, 'id'> = {
      name,
      description: null,
      display_order: displayOrder
    };

    return new Promise((resolve, reject) => {
      const request = store.add(competency);
      request.onsuccess = () => {
        resolve({ ...competency, id: request.result as number });
      };
      request.onerror = () => reject(new Error(request.error?.message ?? 'Failed to create competency'));
    });
  }

  private async getCompetencyByName(name: string): Promise<Competency | null> {
    const store = await this.getObjectStore('competencies');
    return new Promise((resolve, reject) => {
      const index = store.index('name');
      const request = index.get(name);
      request.onsuccess = () => {
        const result = request.result as Competency | undefined;
        resolve(result ?? null);
      };
      request.onerror = () => reject(new Error(request.error?.message ?? 'Failed to get competency by name'));
    });
  }

  private async getAllCompetencies(): Promise<Competency[]> {
    const store = await this.getObjectStore('competencies');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error(request.error?.message ?? 'Failed to get all competencies'));
    });
  }

  // Score operations
  private async createScore(score: Omit<Score, 'id'>): Promise<Score> {
    const store = await this.getObjectStore('scores', 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.add(score);
      request.onsuccess = () => {
        resolve({ ...score, id: request.result as number });
      };
      request.onerror = () => reject(new Error(request.error?.message ?? 'Failed to create score'));
    });
  }

  // Rating mapping operations
  private async createRatingMapping(mapping: Omit<RatingMapping, 'id'>): Promise<RatingMapping> {
    const store = await this.getObjectStore('rating_mappings', 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.add(mapping);
      request.onsuccess = () => {
        resolve({ ...mapping, id: request.result as number });
      };
      request.onerror = () => reject(new Error(request.error?.message ?? 'Failed to create rating mapping'));
    });
  }

  getDefaultRatingMappings(): CreateRatingMapping[] {
    return [
      { dataset_id: 0, text_value: 'Sangat Baik', numeric_value: 5 },
      { dataset_id: 0, text_value: 'Baik', numeric_value: 4 },
      { dataset_id: 0, text_value: 'Cukup', numeric_value: 3 },
      { dataset_id: 0, text_value: 'Kurang', numeric_value: 2 },
      { dataset_id: 0, text_value: 'Sangat Kurang', numeric_value: 1 },
    ];
  }

  // Import operation
  async importDataset(request: ImportRequest): Promise<ImportResult> {
    // Create dataset
    const dataset = await this.createDataset({
      name: request.dataset_name,
      description: request.dataset_description ?? undefined,
      source_file: request.source_file
    });

    // Create rating mappings
    const mappings: Map<string, number> = new Map();
    for (const mapping of request.rating_mappings) {
      const created = await this.createRatingMapping({
        ...mapping,
        dataset_id: dataset.id
      });
      mappings.set(created.text_value, created.numeric_value);
    }

    // Create employees
    const employeeMap: Map<string, Employee> = new Map();
    for (const parsedEmp of request.employees) {
      const employee = await this.createEmployee({
        dataset_id: dataset.id,
        name: parsedEmp.name,
        nip: parsedEmp.nip,
        gol: parsedEmp.gol,
        jabatan: parsedEmp.jabatan,
        sub_jabatan: parsedEmp.sub_jabatan,
        created_at: new Date().toISOString()
      });
      employeeMap.set(employee.name, employee);
    }

    // Create competencies
    const uniqueCompetencies = [...new Set(request.scores.map(s => s.competency))];
    const competencyMap: Map<string, Competency> = new Map();
    for (let i = 0; i < uniqueCompetencies.length; i++) {
      const comp = await this.createCompetency(uniqueCompetencies[i], i);
      competencyMap.set(comp.name, comp);
    }

    // Create scores
    let scoreCount = 0;
    for (const parsedScore of request.scores) {
      const employee = employeeMap.get(parsedScore.employee_name);
      const competency = competencyMap.get(parsedScore.competency);

      if (employee && competency) {
        const numericValue = mappings.get(parsedScore.value) ?? null;
        await this.createScore({
          employee_id: employee.id,
          competency_id: competency.id,
          raw_value: parsedScore.value,
          numeric_value: numericValue,
          created_at: new Date().toISOString()
        });
        scoreCount++;
      }
    }

    return {
      dataset,
      employee_count: employeeMap.size,
      competency_count: competencyMap.size,
      score_count: scoreCount
    };
  }

  // Analytics operations
  async getDatasetStats(datasetId: number): Promise<DatasetStats> {
    const dataset = await this.getDataset(datasetId);
    const empStore = await this.getObjectStore('employees');

    return new Promise((resolve, reject) => {
      const empIndex = empStore.index('dataset_id');
      const empRequest = empIndex.getAll(IDBKeyRange.only(datasetId));

      empRequest.onsuccess = async () => {
        const employees = empRequest.result as Employee[];

        // Get all scores for this dataset's employees
        const allScores: Score[] = [];
        for (const emp of employees) {
          const scores = await this.getScoresByEmployee(emp.id);
          allScores.push(...scores);
        }

        const numericScores = allScores.map(s => s.numeric_value).filter((v): v is number => v !== null);
        const average = numericScores.length > 0
          ? numericScores.reduce((a, b) => a + b, 0) / numericScores.length
          : 0;

        // Score distribution
        const distribution: ScoreDistribution[] = [
          { range: '1.0-2.0', count: numericScores.filter(s => s >= 1 && s < 2).length },
          { range: '2.0-3.0', count: numericScores.filter(s => s >= 2 && s < 3).length },
          { range: '3.0-4.0', count: numericScores.filter(s => s >= 3 && s < 4).length },
          { range: '4.0-5.0', count: numericScores.filter(s => s >= 4 && s <= 5).length },
        ];

        // Competency stats
        const competencies = await this.getAllCompetencies();
        const competencyStats: CompetencyStats[] = competencies.map((comp) => {
            const compScores = allScores.filter(s => s.competency_id === comp.id);
            const compNumeric = compScores.map(s => s.numeric_value).filter((v): v is number => v !== null);
            const avg = compNumeric.length > 0
              ? compNumeric.reduce((a, b) => a + b, 0) / compNumeric.length
              : 0;

            return {
              competency: comp,
              average_score: avg,
              employee_count: new Set(compScores.map(s => s.employee_id)).size
            };
          });

        resolve({
          dataset,
          total_employees: employees.length,
          total_competencies: competencies.length,
          total_scores: allScores.length,
          average_score: average,
          score_distribution: distribution,
          competency_stats: competencyStats
        });
      };

      empRequest.onerror = () => reject(new Error(empRequest.error?.message ?? 'Failed to get dataset stats'));
    });
  }

  validateImportData(payload: ImportValidationPayload): Promise<ImportValidationSummary> {
    const duplicateEmployees: DuplicateEmployeeGroup[] = [];
    const orphanScores: OrphanScoreIssue[] = [];
    const unmappedRatings: UnmappedRatingIssue[] = [];
    const blankEmployeeNames: BlankEmployeeNameIssue[] = [];

    const nameMap: Map<string, number[]> = new Map();
    const canonicalNames: Set<string> = new Set();

    payload.employees.forEach((employee, index) => {
      const trimmed = employee.name.trim();
      if (trimmed.length === 0) {
        blankEmployeeNames.push({ employee_index: index });
        return;
      }

      const key = trimmed.toLowerCase();
      canonicalNames.add(key);
      const existing = nameMap.get(key);
      if (existing) {
        existing.push(index);
      } else {
        nameMap.set(key, [index]);
      }
    });

    nameMap.forEach((indices) => {
      if (indices.length > 1) {
        const displayName = payload.employees[indices[0]].name;
        duplicateEmployees.push({ name: displayName, employee_indices: [...indices] });
      }
    });

    const ratingMap = new Map<string, number>(
      payload.rating_mappings.map((mapping) => [mapping.text_value.trim().toLowerCase(), mapping.numeric_value])
    );

    const unmappedCounts: Map<string, number> = new Map();

    payload.scores.forEach((score, index) => {
      const employeeKey = score.employee_name.trim().toLowerCase();
      if (employeeKey.length === 0 || !canonicalNames.has(employeeKey)) {
        orphanScores.push({
          score_index: index,
          employee_name: score.employee_name,
          competency: score.competency,
        });
      }

      const valueKey = score.value.trim().toLowerCase();
      if (valueKey.length > 0 && !ratingMap.has(valueKey)) {
        const current = unmappedCounts.get(score.value) ?? 0;
        unmappedCounts.set(score.value, current + 1);
      }
    });

    unmappedCounts.forEach((occurrences, value) => {
      unmappedRatings.push({ value, occurrences });
    });

    const errorCount =
      duplicateEmployees.length +
      orphanScores.length +
      unmappedRatings.length +
      blankEmployeeNames.length;

    const stats: ValidationStats = {
      error_count: errorCount,
      warning_count: 0,
      total_issues: errorCount,
      can_import: errorCount === 0,
    };

    return Promise.resolve({
      stats,
      duplicate_employees: duplicateEmployees,
      orphan_scores: orphanScores,
      unmapped_ratings: unmappedRatings,
      blank_employee_names: blankEmployeeNames,
    });
  }

  async getEmployeeSummary(employeeId: number): Promise<Summary | null> {
    const store = await this.getObjectStore('summaries');
    return new Promise((resolve, reject) => {
      const index = store.index('employee_id');
      const request = index.get(employeeId);
      request.onsuccess = () => resolve((request.result as Summary | undefined) ?? null);
      request.onerror = () => reject(new Error(request.error?.message ?? 'Failed to load summary'));
    });
  }

  async saveEmployeeSummary(employeeId: number, content: string): Promise<Summary> {
    const store = await this.getObjectStore('summaries', 'readwrite');
    const existing = await this.getEmployeeSummary(employeeId);
    const now = new Date().toISOString();

    const summary: Summary = existing
      ? { ...existing, content, updated_at: now }
      : {
          id: 0,
          employee_id: employeeId,
          content,
          created_at: now,
          updated_at: now,
        };

    return new Promise((resolve, reject) => {
      const record = existing ? summary : { ...summary, id: undefined };
      const request = store.put(record);
      request.onsuccess = () => {
        const id = existing ? summary.id : (request.result as number);
        resolve({ ...summary, id });
      };
      request.onerror = () => reject(new Error(request.error?.message ?? 'Failed to save summary'));
    });
  }

  async generateEmployeeSummary(employeeId: number): Promise<GeneratedSummary> {
    const performance = await this.getEmployeePerformance(employeeId);
    return { content: buildSummary(performance) };
  }

  async compareDatasets(baseDatasetId: number, comparisonDatasetId: number): Promise<DatasetComparison> {
    const base = await this.getDatasetStats(baseDatasetId);
    const comparison = await this.getDatasetStats(comparisonDatasetId);

    const baseMap = new Map<number, CompetencyStats>();
    base.competency_stats.forEach(stat => baseMap.set(stat.competency.id, stat));

    const deltas: CompetencyDelta[] = [];
    comparison.competency_stats.forEach(stat => {
      const counterpart = baseMap.get(stat.competency.id);
      const baseAverage = counterpart?.average_score ?? 0;
      deltas.push({
        competency: stat.competency,
        base_average: baseAverage,
        comparison_average: stat.average_score,
        delta: stat.average_score - baseAverage,
      });
      baseMap.delete(stat.competency.id);
    });

    baseMap.forEach(stat => {
      deltas.push({
        competency: stat.competency,
        base_average: stat.average_score,
        comparison_average: 0,
        delta: -stat.average_score,
      });
    });

    deltas.sort((a, b) => a.competency.display_order - b.competency.display_order);

    return {
      base,
      comparison,
      competency_deltas: deltas,
      average_delta: comparison.average_score - base.average_score,
    };
  }
}

export const browserStorage = new BrowserStorage();

function buildSummary(performance: EmployeePerformance): string {
  const { employee } = performance;
  const totalCompetencies = performance.scores.length;
  const average = performance.average_score;

  const numericScores = performance.scores
    .map(score => (
      score.score.numeric_value !== null
        ? { name: score.competency.name, value: score.score.numeric_value }
        : null
    ))
    .filter((value): value is { name: string; value: number } => value !== null)
    .sort((a, b) => b.value - a.value);

  const topCompetency = numericScores[0];
  const lowestCompetency = numericScores[numericScores.length - 1];

  const strengthsText = performance.strengths.length > 0
    ? `Kekuatan utama saat ini mencakup ${performance.strengths.join(', ')}.`
    : 'Belum ada kompetensi dengan skor numerik tercatat sebagai kekuatan utama.';

  const gapText = performance.gaps.length > 0
    ? `Area yang memerlukan perhatian lanjutan meliputi ${performance.gaps.join(', ')}.`
    : 'Tidak ada area pengembangan yang tercatat karena nilai numerik belum lengkap.';

  const highlight = typeof topCompetency !== 'undefined'
    ? lowestCompetency && lowestCompetency.name !== topCompetency.name
      ? `Skor tertinggi berada pada kompetensi ${topCompetency.name} dengan nilai ${topCompetency.value.toFixed(2)}, sementara skor terendah tercatat pada ${lowestCompetency.name} dengan nilai ${lowestCompetency.value.toFixed(2)}.`
      : `Kompetensi dengan capaian tertinggi adalah ${topCompetency.name} dengan nilai ${topCompetency.value.toFixed(2)}.`
    : 'Belum tersedia skor numerik untuk mendeskripsikan capaian kompetensi secara detail.';

  const roleText = employee.jabatan
    ? employee.sub_jabatan
      ? `berperan sebagai ${employee.jabatan} (${employee.sub_jabatan})`
      : `berperan sebagai ${employee.jabatan}`
    : 'berperan sebagai karyawan';

  const nipText = employee.nip ? ` dengan NIP ${employee.nip}` : '';

  const intro = `${employee.name} saat ini ${roleText}${nipText}. Rata-rata pencapaian dari ${totalCompetencies} kompetensi yang dinilai adalah ${average.toFixed(2)}.`;

  const supportive = average >= 3.5
    ? 'Secara keseluruhan performa berada pada kategori sangat baik dan konsisten di atas ekspektasi organisasi.'
    : average >= 3.0
      ? 'Secara keseluruhan performa berada pada kategori baik dengan hasil yang stabil dan memenuhi target utama.'
      : average >= 2.5
        ? 'Rata-rata skor menunjukkan performa cukup dengan beberapa area yang masih memerlukan peningkatan.'
        : 'Performa saat ini berada di bawah target organisasi sehingga dibutuhkan rencana pengembangan terstruktur.';

  const closing = 'Rekomendasikan tindak lanjut berupa sesi umpan balik terjadwal, pemantauan target triwulanan, serta dukungan pelatihan yang relevan agar progres dapat diakselerasi.';

  return [intro, supportive, strengthsText, gapText, highlight, closing].join('\n\n');
}
