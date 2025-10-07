import type {
  Dataset,
  CreateDataset,
  Employee,
  Competency,
  Score,
  CreateRatingMapping,
  DatasetStats,
  DashboardOverview,
  DatasetSummary,
  EmployeeListResult,
  EmployeePerformance,
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
  UpdateDatasetRequest,
  MergeDatasetsRequest,
  MergeDatasetsResult,
  EmployeeImportRequest,
  EmployeeImportResult,
  PerformanceImportRequest,
  ParsedEmployee,
  DatasetEmployeeAppendResult,
  SortState,
} from '@/types/models';

import {
  DEFAULT_EMPLOYEE_SORT,
  derivePositionStatus,
  isEmployeeSortColumn,
  sortEmployees,
  type EmployeeSortColumn,
} from './employee-utils';

const DB_NAME = 'employee_monitoring';
const DB_VERSION = 3;

interface DBSchema {
  datasets: Dataset;
  employees: Employee;
  dataset_employees: DatasetEmployeeRecord;
  competencies: Competency;
  scores: Score;
  rating_mappings: RatingMapping;
  summaries: Summary;
}

interface DatasetEmployeeRecord {
  id: number;
  dataset_id: number;
  employee_id: number;
  created_at: string;
  updated_at: string;
}

interface LegacyEmployeeRecord {
  id: number;
  dataset_id?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
}

interface LegacyScoreRecord {
  id: number;
  employee_id: number;
  competency_id: number;
  raw_value: string;
  numeric_value?: number | null;
  created_at?: string | null;
  dataset_id?: number | null;
  [key: string]: unknown;
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
        const transaction = (event.target as IDBOpenDBRequest).transaction;
        if (!transaction) {
          return;
        }

        const oldVersion = event.oldVersion ?? 0;

        // Datasets store
        if (!db.objectStoreNames.contains('datasets')) {
          const datasetsStore = db.createObjectStore('datasets', { keyPath: 'id', autoIncrement: true });
          datasetsStore.createIndex('name', 'name', { unique: false });
        }

        // Employees store
        let employeesStore: IDBObjectStore;
        if (!db.objectStoreNames.contains('employees')) {
          employeesStore = db.createObjectStore('employees', { keyPath: 'id', autoIncrement: true });
          employeesStore.createIndex('name', 'name', { unique: false });
        } else {
          employeesStore = transaction.objectStore('employees');
          if (employeesStore.indexNames.contains('dataset_id')) {
            employeesStore.deleteIndex('dataset_id');
          }
          if (!employeesStore.indexNames.contains('name')) {
            employeesStore.createIndex('name', 'name', { unique: false });
          }
        }

        // Dataset employees store
        let datasetEmployeesStore: IDBObjectStore;
        if (!db.objectStoreNames.contains('dataset_employees')) {
          datasetEmployeesStore = db.createObjectStore('dataset_employees', { keyPath: 'id', autoIncrement: true });
          datasetEmployeesStore.createIndex('dataset_id', 'dataset_id', { unique: false });
          datasetEmployeesStore.createIndex('employee_id', 'employee_id', { unique: false });
          datasetEmployeesStore.createIndex('dataset_employee_unique', ['dataset_id', 'employee_id'], { unique: true });
        } else {
          datasetEmployeesStore = transaction.objectStore('dataset_employees');
          if (!datasetEmployeesStore.indexNames.contains('dataset_employee_unique')) {
            datasetEmployeesStore.createIndex('dataset_employee_unique', ['dataset_id', 'employee_id'], { unique: true });
          }
        }

        // Competencies store
        if (!db.objectStoreNames.contains('competencies')) {
          const competenciesStore = db.createObjectStore('competencies', { keyPath: 'id', autoIncrement: true });
          competenciesStore.createIndex('name', 'name', { unique: true });
        }

        // Scores store
        let scoresStore: IDBObjectStore | null = null;
        if (!db.objectStoreNames.contains('scores')) {
          scoresStore = db.createObjectStore('scores', { keyPath: 'id', autoIncrement: true });
          scoresStore.createIndex('employee_id', 'employee_id', { unique: false });
          scoresStore.createIndex('dataset_id', 'dataset_id', { unique: false });
          scoresStore.createIndex('competency_id', 'competency_id', { unique: false });
        } else {
          scoresStore = transaction.objectStore('scores');
          if (!scoresStore.indexNames.contains('dataset_id')) {
            scoresStore.createIndex('dataset_id', 'dataset_id', { unique: false });
          }
          if (!scoresStore.indexNames.contains('employee_id')) {
            scoresStore.createIndex('employee_id', 'employee_id', { unique: false });
          }
          if (!scoresStore.indexNames.contains('competency_id')) {
            scoresStore.createIndex('competency_id', 'competency_id', { unique: false });
          }
        }

        // Rating mappings store
        if (!db.objectStoreNames.contains('rating_mappings')) {
          const ratingsStore = db.createObjectStore('rating_mappings', { keyPath: 'id', autoIncrement: true });
          ratingsStore.createIndex('dataset_id', 'dataset_id', { unique: false });
        }

        // Summaries store
        if (!db.objectStoreNames.contains('summaries')) {
          const summaryStore = db.createObjectStore('summaries', { keyPath: 'id', autoIncrement: true });
          summaryStore.createIndex('employee_id', 'employee_id', { unique: true });
        }

        if (oldVersion > 0 && oldVersion < 3) {
          const employeeDatasetMap = new Map<number, number>();

          const migrateScores = () => {
            if (!scoresStore) {
              return;
            }

            const scoreCursor = scoresStore.openCursor();
            scoreCursor.onsuccess = (scoreEvent) => {
              const cursor = (scoreEvent.target as IDBRequest<IDBCursorWithValue | null>).result;
              if (!cursor) {
                return;
              }

              const value = cursor.value as LegacyScoreRecord;
              if (value.dataset_id !== undefined && value.dataset_id !== null) {
                cursor.continue();
                return;
              }

              const employeeId = value.employee_id;
              if (typeof employeeId !== 'number') {
                cursor.continue();
                return;
              }

              const datasetFromMap = employeeDatasetMap.get(employeeId);
              if (datasetFromMap !== undefined) {
                value.dataset_id = datasetFromMap;
                cursor.update(value);
                cursor.continue();
                return;
              }

              const lookup = datasetEmployeesStore
                .index('employee_id')
                .get(employeeId);
              lookup.onsuccess = () => {
                const record = lookup.result as DatasetEmployeeRecord | undefined;
                if (record) {
                  value.dataset_id = record.dataset_id;
                  cursor.update(value);
                }
                cursor.continue();
              };
              lookup.onerror = () => {
                cursor.continue();
              };
            };
          };

          const cursorRequest = employeesStore.openCursor();
          cursorRequest.onsuccess = (cursorEvent) => {
            const cursor = (cursorEvent.target as IDBRequest<IDBCursorWithValue | null>).result;
            if (!cursor) {
              migrateScores();
              return;
            }

            const value = cursor.value as LegacyEmployeeRecord;
            const datasetId = value.dataset_id;
            const createdAt: string = value.created_at ?? new Date().toISOString();
            const now = new Date().toISOString();
            value.created_at = createdAt;
            value.updated_at = value.updated_at ?? now;
            delete value.dataset_id;

            cursor.update(value);

            if (typeof datasetId === 'number' && !Number.isNaN(datasetId)) {
              employeeDatasetMap.set(value.id, datasetId);
              datasetEmployeesStore.add({
                dataset_id: datasetId,
                employee_id: value.id,
                created_at: createdAt,
                updated_at: now,
              });
            }

            cursor.continue();
          };
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

  async listAllEmployees(): Promise<Employee[]> {
    return this.getAllEmployees();
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

  async updateDataset(id: number, updates: UpdateDatasetRequest): Promise<Dataset> {
    const store = await this.getObjectStore('datasets', 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => {
        const existing = request.result as Dataset | undefined;
        if (!existing) {
          reject(new Error('Dataset not found'));
          return;
        }

        const name = updates.name.trim();
        if (!name) {
          reject(new Error('Dataset name cannot be empty'));
          return;
        }

        const descriptionInput = updates.description;
        let nextDescription: string | null;
        if (descriptionInput === undefined) {
          nextDescription = existing.description;
        } else if (descriptionInput === null) {
          nextDescription = null;
        } else {
          const trimmed = descriptionInput.trim();
          nextDescription = trimmed.length === 0 ? null : trimmed;
        }

        const updated: Dataset = {
          ...existing,
          name,
          description: nextDescription,
          updated_at: new Date().toISOString(),
        };

        const putRequest = store.put(updated);
        putRequest.onsuccess = () => resolve(updated);
        putRequest.onerror = () => reject(new Error(putRequest.error?.message ?? 'Failed to update dataset'));
      };
      request.onerror = () => reject(new Error(request.error?.message ?? 'Failed to load dataset for update'));
    });
  }

  async mergeDatasets(request: MergeDatasetsRequest): Promise<MergeDatasetsResult> {
    const uniqueIds = request.source_dataset_ids.filter((id, index, array) => array.indexOf(id) === index);
    if (uniqueIds.length < 2) {
      throw new Error('Select at least two datasets to merge');
    }

    const name = request.target_name.trim();
    if (!name) {
      throw new Error('Target dataset name cannot be empty');
    }

    const description = request.target_description
      ? request.target_description.trim().length === 0
        ? undefined
        : request.target_description.trim()
      : undefined;

    const dataset = await this.createDataset({
      name,
      description,
    });

    const employeeIds = new Set<number>();
    for (const datasetId of uniqueIds) {
      const links = await this.getDatasetEmployees(datasetId);
      links.forEach((link) => employeeIds.add(link.employee_id));
    }

    for (const employeeId of employeeIds) {
      await this.linkEmployeeToDataset(dataset.id, employeeId);
    }

    for (const datasetId of uniqueIds) {
      const scores = await this.getScoresByDataset(datasetId);
      for (const score of scores) {
        await this.insertScoreIfMissing({
          employee_id: score.employee_id,
          dataset_id: dataset.id,
          competency_id: score.competency_id,
          raw_value: score.raw_value,
          numeric_value: score.numeric_value ?? null,
          created_at: score.created_at ?? new Date().toISOString(),
        });
      }

      const mappings = await this.getRatingMappingsByDataset(datasetId);
      for (const mapping of mappings) {
        await this.insertRatingMappingIfMissing({
          dataset_id: dataset.id,
          text_value: mapping.text_value,
          numeric_value: mapping.numeric_value,
        });
      }
    }

    const employee_count = (await this.getDatasetEmployees(dataset.id)).length;
    const score_count = (await this.getScoresByDataset(dataset.id)).length;
    const rating_mapping_count = (await this.getRatingMappingsByDataset(dataset.id)).length;

    return {
      dataset,
      employee_count,
      score_count,
      rating_mapping_count,
      source_dataset_ids: uniqueIds,
    };
  }

  // Employee operations
  private async createEmployee(data: {
    name: string;
    nip: string | null;
    gol: string | null;
    jabatan: string | null;
    sub_jabatan: string | null;
  }): Promise<Employee> {
    const store = await this.getObjectStore('employees', 'readwrite');
    const now = new Date().toISOString();
    const record: Omit<Employee, 'id'> = {
      name: data.name,
      nip: data.nip,
      gol: data.gol,
      jabatan: data.jabatan,
      sub_jabatan: data.sub_jabatan,
      created_at: now,
      updated_at: now,
    };

    return new Promise((resolve, reject) => {
      const request = store.add(record);
      request.onsuccess = () => {
        resolve({ ...record, id: request.result as number });
      };
      request.onerror = () => reject(new Error(request.error?.message ?? 'Failed to create employee'));
    });
  }

  private async updateEmployee(
    id: number,
    updates: Partial<Omit<Employee, 'id' | 'created_at'>>
  ): Promise<Employee> {
    const store = await this.getObjectStore('employees', 'readwrite');
    return new Promise((resolve, reject) => {
      const getRequest = store.get(id);
      getRequest.onsuccess = () => {
        const existing = getRequest.result as Employee | undefined;
        if (!existing) {
          reject(new Error('Employee not found'));
          return;
        }

        const updated: Employee = {
          ...existing,
          ...updates,
          updated_at: new Date().toISOString(),
        };

        const putRequest = store.put(updated);
        putRequest.onsuccess = () => resolve(updated);
        putRequest.onerror = () => reject(new Error(putRequest.error?.message ?? 'Failed to update employee'));
      };
      getRequest.onerror = () => reject(new Error(getRequest.error?.message ?? 'Failed to load employee for update'));
    });
  }

  private async getEmployeeById(id: number): Promise<Employee | null> {
    const store = await this.getObjectStore('employees');
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve((request.result as Employee | undefined) ?? null);
      request.onerror = () => reject(new Error(request.error?.message ?? 'Failed to load employee'));
    });
  }

  private async getAllEmployees(): Promise<Employee[]> {
    const store = await this.getObjectStore('employees');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result as Employee[]);
      request.onerror = () => reject(new Error(request.error?.message ?? 'Failed to load employees'));
    });
  }

  private async getDatasetEmployees(datasetId: number): Promise<DatasetEmployeeRecord[]> {
    const store = await this.getObjectStore('dataset_employees');
    return new Promise((resolve, reject) => {
      const index = store.index('dataset_id');
      const request = index.getAll(IDBKeyRange.only(datasetId));
      request.onsuccess = () => resolve(request.result as DatasetEmployeeRecord[]);
      request.onerror = () => reject(new Error(request.error?.message ?? 'Failed to load dataset employees'));
    });
  }

  private async getDatasetEmployeeRecord(
    datasetId: number,
    employeeId: number
  ): Promise<DatasetEmployeeRecord | null> {
    const store = await this.getObjectStore('dataset_employees');
    return new Promise((resolve, reject) => {
      const index = store.index('dataset_employee_unique');
      const request = index.get([datasetId, employeeId]);
      request.onsuccess = () => resolve((request.result as DatasetEmployeeRecord | undefined) ?? null);
      request.onerror = () => reject(new Error(request.error?.message ?? 'Failed to load dataset employee record'));
    });
  }

  private async linkEmployeeToDataset(
    datasetId: number,
    employeeId: number
  ): Promise<DatasetEmployeeRecord> {
    const store = await this.getObjectStore('dataset_employees', 'readwrite');
    const now = new Date().toISOString();
    const record: Omit<DatasetEmployeeRecord, 'id'> = {
      dataset_id: datasetId,
      employee_id: employeeId,
      created_at: now,
      updated_at: now,
    };

    return new Promise((resolve, reject) => {
      const addRequest = store.add(record);
      addRequest.onsuccess = () => {
        resolve({ ...record, id: addRequest.result as number });
      };
      addRequest.onerror = () => {
        const error = addRequest.error;
        if (error && error.name === 'ConstraintError') {
          const index = store.index('dataset_employee_unique');
          const getRequest = index.get([datasetId, employeeId]);
          getRequest.onsuccess = () => {
            const existing = getRequest.result as DatasetEmployeeRecord | undefined;
            if (!existing) {
              reject(new Error('Failed to fetch existing dataset employee link'));
              return;
            }
            const updated: DatasetEmployeeRecord = { ...existing, updated_at: now };
            const putRequest = store.put(updated);
            putRequest.onsuccess = () => resolve(updated);
            putRequest.onerror = () =>
              reject(new Error(putRequest.error?.message ?? 'Failed to update dataset employee link'));
          };
          getRequest.onerror = () =>
            reject(new Error(getRequest.error?.message ?? 'Failed to load dataset employee link'));
        } else {
          reject(new Error(error?.message ?? 'Failed to link employee to dataset'));
        }
      };
    });
  }

  private normalizeName(name: string): string {
    return name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z\s]/g, '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  private sanitizeOptional(value: string | null | undefined): string | null {
    if (value === undefined || value === null) {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  async listEmployees(
    datasetId: number,
    search?: string,
    limit: number = 50,
    offset: number = 0,
    sort?: SortState,
  ): Promise<EmployeeListResult> {
    const links = await this.getDatasetEmployees(datasetId);
    const records = await Promise.all(
      links.map(async (link) => {
        const employee = await this.getEmployeeById(link.employee_id);
        return employee;
      })
    );

    let employees = records.filter((emp): emp is Employee => emp !== null);

    if (search) {
      const searchLower = search.toLowerCase();
      employees = employees.filter((emp) =>
        emp.name.toLowerCase().includes(searchLower) ||
        (emp.nip?.toLowerCase() ?? '').includes(searchLower)
      );
    }

    const effectiveSort: SortState<EmployeeSortColumn> =
      sort && typeof sort.column === 'string' && isEmployeeSortColumn(sort.column)
        ? {
            column: sort.column,
            direction: sort.direction === 'desc' ? 'desc' : 'asc',
          }
        : DEFAULT_EMPLOYEE_SORT;

    const employeesWithStatus = employees.map((emp) => ({
      ...emp,
      position_status: derivePositionStatus(emp.jabatan, emp.sub_jabatan, emp.gol),
    }));

    const sorted = sortEmployees(employeesWithStatus, effectiveSort);

    const total = sorted.length;
    const paginated = sorted.slice(offset, offset + limit);

    const employeesWithStats: EmployeeWithStats[] = await Promise.all(
      paginated.map(async (emp) => {
        const scores = await this.getScoresByEmployee(emp.id, datasetId);
        const numericScores = scores
          .map((s) => s.numeric_value)
          .filter((v): v is number => v !== null);
        const average = numericScores.length > 0
          ? numericScores.reduce((a, b) => a + b, 0) / numericScores.length
          : 0;

        return {
          ...emp,
          average_score: average,
          score_count: scores.length,
        };
      })
    );

    return {
      employees: employeesWithStats,
      total_count: total,
    };
  }
 
  private async getScoresByEmployee(employeeId: number, datasetId?: number): Promise<Score[]> {
    const store = await this.getObjectStore('scores');
    return new Promise((resolve, reject) => {
      const index = store.index('employee_id');
      const request = index.getAll(IDBKeyRange.only(employeeId));
      request.onsuccess = () => {
        const results = request.result as Score[];
        resolve(typeof datasetId === 'number' ? results.filter((score) => score.dataset_id === datasetId) : results);
      };
      request.onerror = () => reject(new Error(request.error?.message ?? 'Failed to get scores by employee'));
    });
  }

  private async getScoresByDataset(datasetId: number): Promise<Score[]> {
    const store = await this.getObjectStore('scores');
    return new Promise((resolve, reject) => {
      const index = store.index('dataset_id');
      const request = index.getAll(IDBKeyRange.only(datasetId));
      request.onsuccess = () => resolve(request.result as Score[]);
      request.onerror = () => reject(new Error(request.error?.message ?? 'Failed to get scores by dataset'));
    });
  }

  private async getRatingMappingsByDataset(datasetId: number): Promise<RatingMapping[]> {
    const store = await this.getObjectStore('rating_mappings');
    return new Promise((resolve, reject) => {
      const index = store.index('dataset_id');
      const request = index.getAll(IDBKeyRange.only(datasetId));
      request.onsuccess = () => resolve(request.result as RatingMapping[]);
      request.onerror = () => reject(new Error(request.error?.message ?? 'Failed to get rating mappings by dataset'));
    });
  }

  async getEmployeePerformance(datasetId: number, employeeId: number): Promise<EmployeePerformance> {
    const employee = await this.getEmployeeById(employeeId);
    if (!employee) {
      throw new Error('Employee not found');
    }

    const link = await this.getDatasetEmployeeRecord(datasetId, employeeId);
    if (!link) {
      throw new Error('Employee is not associated with this dataset');
    }

    const scores = await this.getScoresByEmployee(employeeId, datasetId);
    const competencies = await this.getAllCompetencies();

    const scoresWithComp: ScoreWithCompetency[] = scores
      .map((score) => {
        const competency = competencies.find((c) => c.id === score.competency_id);
        return competency ? { score, competency } : null;
      })
      .filter((value): value is ScoreWithCompetency => value !== null);

    const numericScores = scores
      .map((s) => s.numeric_value)
      .filter((v): v is number => v !== null);
    const average = numericScores.length > 0
      ? numericScores.reduce((a, b) => a + b, 0) / numericScores.length
      : 0;

    const sorted = [...scoresWithComp].sort(
      (a, b) => (b.score.numeric_value ?? 0) - (a.score.numeric_value ?? 0)
    );

    const strengths = sorted.slice(0, 3).map((s) => s.competency.name);
    const gaps = sorted.slice(-3).reverse().map((s) => s.competency.name);

    return {
      employee,
      scores: scoresWithComp,
      average_score: average,
      strengths,
      gaps,
    };
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

  private async insertScoreIfMissing(score: Omit<Score, 'id'>): Promise<void> {
    const store = await this.getObjectStore('scores', 'readwrite');
    await new Promise<void>((resolve, reject) => {
      const request = store.add(score);
      request.onsuccess = () => resolve();
      request.onerror = () => {
        const error = request.error;
        if (error && error.name === 'ConstraintError') {
          resolve();
        } else {
          reject(new Error(error?.message ?? 'Failed to copy score'));
        }
      };
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

  private async insertRatingMappingIfMissing(mapping: Omit<RatingMapping, 'id'>): Promise<void> {
    const store = await this.getObjectStore('rating_mappings', 'readwrite');
    await new Promise<void>((resolve, reject) => {
      const request = store.add(mapping);
      request.onsuccess = () => resolve();
      request.onerror = () => {
        const error = request.error;
        if (error && error.name === 'ConstraintError') {
          resolve();
        } else {
          reject(new Error(error?.message ?? 'Failed to copy rating mapping'));
        }
      };
    });
  }

  getDefaultRatingMappings(): CreateRatingMapping[] {
    return [
      { dataset_id: 0, text_value: 'Sangat Baik', numeric_value: 85 },
      { dataset_id: 0, text_value: 'Baik', numeric_value: 75 },
      { dataset_id: 0, text_value: 'Kurang Baik', numeric_value: 65 },
    ];
  }

  // Import operations
  async importEmployees(request: EmployeeImportRequest): Promise<EmployeeImportResult> {
    if (request.employees.length === 0) {
      return { inserted: 0, updated: 0, total: 0 };
    }

    const existingEmployees = await this.getAllEmployees();
    const employeesByNormalized = new Map<string, Employee>();
    existingEmployees.forEach((employee) => {
      employeesByNormalized.set(this.normalizeName(employee.name), employee);
    });

    const uniqueEmployees = new Map<string, ParsedEmployee>();
    for (const employee of request.employees) {
      const trimmedName = employee.name.trim();
      if (!trimmedName) {
        throw new Error('Employee name cannot be blank');
      }
      uniqueEmployees.set(this.normalizeName(trimmedName), {
        name: trimmedName,
        nip: this.sanitizeOptional(employee.nip),
        gol: this.sanitizeOptional(employee.gol),
        jabatan: this.sanitizeOptional(employee.jabatan),
        sub_jabatan: this.sanitizeOptional(employee.sub_jabatan),
      });
    }

    let inserted = 0;
    let updated = 0;

    for (const [normalized, employeeData] of uniqueEmployees.entries()) {
      const existing = employeesByNormalized.get(normalized);
      if (existing) {
        const next = await this.updateEmployee(existing.id, {
          name: employeeData.name,
          nip: employeeData.nip ?? existing.nip,
          gol: employeeData.gol ?? existing.gol,
          jabatan: employeeData.jabatan ?? existing.jabatan,
          sub_jabatan: employeeData.sub_jabatan ?? existing.sub_jabatan,
        });
        employeesByNormalized.set(normalized, next);
        updated += 1;
      } else {
        const created = await this.createEmployee({
          name: employeeData.name,
          nip: employeeData.nip,
          gol: employeeData.gol,
          jabatan: employeeData.jabatan,
          sub_jabatan: employeeData.sub_jabatan,
        });
        employeesByNormalized.set(normalized, created);
        inserted += 1;
      }
    }

    return {
      inserted,
      updated,
      total: inserted + updated,
    };
  }

  async appendDatasetEmployees(
    datasetId: number,
    employees: ParsedEmployee[],
  ): Promise<DatasetEmployeeAppendResult> {
    if (!Number.isFinite(datasetId)) {
      throw new Error('A valid dataset is required');
    }

    if (employees.length === 0) {
      throw new Error('Provide at least one employee to append');
    }

    const uniqueEmployees = new Map<string, ParsedEmployee>();
    for (const employee of employees) {
      const trimmed = employee.name.trim();
      if (!trimmed) {
        continue;
      }
      const normalized = this.normalizeName(trimmed);
      const sanitized: ParsedEmployee = {
        name: trimmed,
        nip: this.sanitizeOptional(employee.nip),
        gol: this.sanitizeOptional(employee.gol),
        jabatan: this.sanitizeOptional(employee.jabatan),
        sub_jabatan: this.sanitizeOptional(employee.sub_jabatan),
      };

      const existing = uniqueEmployees.get(normalized);
      if (existing) {
        if (!existing.nip && sanitized.nip) existing.nip = sanitized.nip;
        if (!existing.gol && sanitized.gol) existing.gol = sanitized.gol;
        if (!existing.jabatan && sanitized.jabatan) existing.jabatan = sanitized.jabatan;
        if (!existing.sub_jabatan && sanitized.sub_jabatan) {
          existing.sub_jabatan = sanitized.sub_jabatan;
        }
      } else {
        uniqueEmployees.set(normalized, sanitized);
      }
    }

    if (uniqueEmployees.size === 0) {
      throw new Error('Provide at least one employee to append');
    }

    const dataset = await this.getDataset(datasetId);
    const employeesToImport = Array.from(uniqueEmployees.values());
    const importResult = await this.importEmployees({ employees: employeesToImport });

    const allEmployees = await this.getAllEmployees();
    const employeesByNormalized = new Map<string, Employee>();
    allEmployees.forEach((employee) => {
      employeesByNormalized.set(this.normalizeName(employee.name), employee);
    });

    let linked = 0;
    for (const [normalized] of uniqueEmployees.entries()) {
      const employee = employeesByNormalized.get(normalized);
      if (!employee) {
        continue;
      }
      const existingLink = await this.getDatasetEmployeeRecord(datasetId, employee.id);
      await this.linkEmployeeToDataset(datasetId, employee.id);
      if (!existingLink) {
        linked += 1;
      }
    }

    const datasetStore = await this.getObjectStore('datasets', 'readwrite');
    await new Promise<void>((resolve, reject) => {
      const putRequest = datasetStore.put({
        ...dataset,
        updated_at: new Date().toISOString(),
      });
      putRequest.onsuccess = () => resolve();
      putRequest.onerror = () => reject(new Error(putRequest.error?.message ?? 'Failed to update dataset timestamp'));
    });

    return {
      created: importResult.inserted,
      updated: importResult.updated,
      linked,
    };
  }

  async importPerformanceDataset(request: PerformanceImportRequest): Promise<ImportResult> {
    const dataset = await this.createDataset({
      name: request.dataset_name,
      description: request.dataset_description ?? undefined,
      source_file: request.source_file,
    });

    const ratingMappings: Map<string, number> = new Map();
    for (const mapping of request.rating_mappings) {
      const textValue = mapping.text_value.trim();
      if (!textValue) {
        continue;
      }
      const created = await this.createRatingMapping({
        dataset_id: dataset.id,
        text_value: textValue,
        numeric_value: mapping.numeric_value,
      });
      ratingMappings.set(textValue.toLowerCase(), created.numeric_value);
    }

    const existingEmployees = await this.getAllEmployees();
    const employeesByNormalized = new Map<string, Employee>();
    existingEmployees.forEach((employee) => {
      employeesByNormalized.set(this.normalizeName(employee.name), employee);
    });

    const normalizedToDisplay = new Map<string, string>();
    for (const name of request.employee_names) {
      const trimmed = name.trim();
      if (!trimmed) {
        continue;
      }
      normalizedToDisplay.set(this.normalizeName(trimmed), trimmed);
    }

    for (const score of request.scores) {
      const trimmed = score.employee_name.trim();
      if (!trimmed) {
        throw new Error('Score is associated with a blank employee name');
      }
      const normalized = this.normalizeName(trimmed);
      if (!normalizedToDisplay.has(normalized)) {
        normalizedToDisplay.set(normalized, trimmed);
      }
    }

    const linkedEmployeeIds = new Set<number>();
    const employeeLookup = new Map<string, Employee>();

    for (const [normalized, displayName] of normalizedToDisplay.entries()) {
      const employee = employeesByNormalized.get(normalized);
      if (!employee) {
        throw new Error(`Employee not found in master data: ${displayName}`);
      }

      await this.linkEmployeeToDataset(dataset.id, employee.id);
      employeeLookup.set(normalized, employee);
      linkedEmployeeIds.add(employee.id);
    }

    const uniqueCompetencies = [...new Set(request.scores.map((score) => score.competency.trim()).filter(Boolean))];
    const competencyMap: Map<string, Competency> = new Map();
    for (let i = 0; i < uniqueCompetencies.length; i++) {
      const competencyName = uniqueCompetencies[i];
      const competency = await this.createCompetency(competencyName, i);
      competencyMap.set(competencyName, competency);
    }

    let scoreCount = 0;
    for (const parsedScore of request.scores) {
      const employeeName = parsedScore.employee_name.trim();
      const normalizedName = this.normalizeName(employeeName);
      const employee = employeeLookup.get(normalizedName);
      if (!employee) {
        throw new Error(`Employee not found: ${employeeName}`);
      }

      const competencyName = parsedScore.competency.trim();
      const competency = competencyMap.get(competencyName);
      if (!competency) {
        continue;
      }

      const valueKey = parsedScore.value.trim().toLowerCase();
      const numericValue = valueKey ? ratingMappings.get(valueKey) ?? null : null;

      await this.createScore({
        employee_id: employee.id,
        dataset_id: dataset.id,
        competency_id: competency.id,
        raw_value: parsedScore.value.trim(),
        numeric_value: numericValue,
        created_at: new Date().toISOString(),
      });
      scoreCount++;
    }

    return {
      dataset,
      employee_count: linkedEmployeeIds.size,
      competency_count: competencyMap.size,
      score_count: scoreCount,
    };
  }

  // Analytics operations
  async getDatasetStats(datasetId: number): Promise<DatasetStats> {
    const dataset = await this.getDataset(datasetId);
    const links = await this.getDatasetEmployees(datasetId);
    const scores = await this.getScoresByDataset(datasetId);

    const numericScores = scores
      .map((score) => score.numeric_value)
      .filter((value): value is number => value !== null);

    const average = numericScores.length > 0
      ? numericScores.reduce((a, b) => a + b, 0) / numericScores.length
      : 0;

    const scoreDistribution: ScoreDistribution[] = [
      { range: '0-1', count: numericScores.filter((value) => value < 1).length },
      { range: '1-2', count: numericScores.filter((value) => value >= 1 && value < 2).length },
      { range: '2-3', count: numericScores.filter((value) => value >= 2 && value < 3).length },
      { range: '3-4', count: numericScores.filter((value) => value >= 3 && value < 4).length },
      { range: '4+', count: numericScores.filter((value) => value >= 4).length },
    ];

    const competencies = await this.getAllCompetencies();
    const competencyMap = new Map<number, Competency>();
    competencies.forEach((competency) => {
      competencyMap.set(competency.id, competency);
    });

    const competencyAccumulator = new Map<
      number,
      { competency: Competency; numericValues: number[]; employeeIds: Set<number> }
    >();

    scores.forEach((score) => {
      const competency = competencyMap.get(score.competency_id);
      if (!competency) {
        return;
      }

      let entry = competencyAccumulator.get(competency.id);
      if (!entry) {
        entry = {
          competency,
          numericValues: [],
          employeeIds: new Set<number>(),
        };
        competencyAccumulator.set(competency.id, entry);
      }

      entry.employeeIds.add(score.employee_id);
      if (score.numeric_value !== null) {
        entry.numericValues.push(score.numeric_value);
      }
    });

    const competencyStats: CompetencyStats[] = Array.from(competencyAccumulator.values())
      .map(({ competency, numericValues, employeeIds }) => {
        const avg = numericValues.length > 0
          ? numericValues.reduce((a, b) => a + b, 0) / numericValues.length
          : 0;

        return {
          competency,
          average_score: avg,
          employee_count: employeeIds.size,
        };
      })
      .sort((a, b) => a.competency.display_order - b.competency.display_order || a.competency.name.localeCompare(b.competency.name));

    const uniqueCompetencyCount = new Set(scores.map((score) => score.competency_id)).size;

    return {
      dataset,
      total_employees: links.length,
      total_competencies: uniqueCompetencyCount,
      total_scores: scores.length,
      average_score: average,
      score_distribution: scoreDistribution,
      competency_stats: competencyStats,
    };
  }

  async getDashboardOverview(): Promise<DashboardOverview> {
    const [datasets, employees, competencies] = await Promise.all([
      this.listDatasets(),
      this.getAllEmployees(),
      this.getAllCompetencies(),
    ]);

    const scoresStore = await this.getObjectStore('scores');
    const scores: Score[] = await new Promise((resolve, reject) => {
      const request = scoresStore.getAll();
      request.onsuccess = () => resolve(request.result as Score[]);
      request.onerror = () => reject(new Error(request.error?.message ?? 'Failed to load scores'));
    });

    const numericScores = scores
      .map((score) => score.numeric_value)
      .filter((value): value is number => value !== null);

    const averageScore = numericScores.length > 0
      ? numericScores.reduce((sum, value) => sum + value, 0) / numericScores.length
      : 0;

    const scoreDistribution: ScoreDistribution[] = [
      { range: '0-1', count: numericScores.filter((value) => value < 1).length },
      { range: '1-2', count: numericScores.filter((value) => value >= 1 && value < 2).length },
      { range: '2-3', count: numericScores.filter((value) => value >= 2 && value < 3).length },
      { range: '3-4', count: numericScores.filter((value) => value >= 3 && value < 4).length },
      { range: '4+', count: numericScores.filter((value) => value >= 4).length },
    ];

    const datasetStats = await Promise.all(
      datasets.map((dataset) => this.getDatasetStats(dataset.id))
    );

    const toSummary = (stats: DatasetStats): DatasetSummary => ({
      dataset: stats.dataset,
      total_employees: stats.total_employees,
      total_competencies: stats.total_competencies,
      total_scores: stats.total_scores,
      average_score: stats.average_score,
    });

    const topDatasets = datasetStats
      .slice()
      .sort((a, b) => b.average_score - a.average_score)
      .slice(0, 5)
      .map(toSummary);

    const recentDatasets = datasetStats
      .slice()
      .sort((a, b) => new Date(b.dataset.created_at).getTime() - new Date(a.dataset.created_at).getTime())
      .slice(0, 5)
      .map(toSummary);

    const competencyLookup = new Map<number, Competency>(
      competencies.map((competency) => [competency.id, competency])
    );

    const competencyAccumulator = new Map<
      number,
      { competency: Competency; numericValues: number[]; datasetIds: Set<number>; scoreCount: number }
    >();

    scores.forEach((score) => {
      const competency = competencyLookup.get(score.competency_id);
      if (!competency) {
        return;
      }

      let entry = competencyAccumulator.get(competency.id);
      if (!entry) {
        entry = {
          competency,
          numericValues: [],
          datasetIds: new Set<number>(),
          scoreCount: 0,
        };
        competencyAccumulator.set(competency.id, entry);
      }

      entry.scoreCount += 1;
      entry.datasetIds.add(score.dataset_id);
      if (score.numeric_value !== null) {
        entry.numericValues.push(score.numeric_value);
      }
    });

    const competencyOverview = Array.from(competencyAccumulator.values())
      .map(({ competency, numericValues, datasetIds, scoreCount }) => ({
        competency,
        average_score: numericValues.length > 0
          ? numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length
          : 0,
        dataset_count: datasetIds.size,
        score_count: scoreCount,
      }))
      .sort((a, b) => b.average_score - a.average_score)
      .slice(0, 8);

    return {
      total_datasets: datasets.length,
      total_employees: employees.length,
      total_scores: scores.length,
      total_competencies: competencies.length,
      average_score: averageScore,
      score_distribution: scoreDistribution,
      top_datasets: topDatasets,
      recent_datasets: recentDatasets,
      competency_overview: competencyOverview,
    };
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

  async generateEmployeeSummary(datasetId: number, employeeId: number): Promise<GeneratedSummary> {
    const performance = await this.getEmployeePerformance(datasetId, employeeId);
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
