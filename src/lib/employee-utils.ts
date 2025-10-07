import type { Employee, PositionStatus, SortState } from '@/types/models';

const STAFF_KEYWORDS = ['staff', 'staf'] as const;
const ESELON_KEYWORDS = [
  'eselon',
  'kepala',
  'sekretaris',
  'kabid',
  'kabag',
  'kasubag',
  'kepala seksi',
  'kasi',
  'koordinator',
  'pengawas',
  'sub bagian',
  'subbagian',
  'subbidang',
  'sub bidang',
] as const;

const collator = new Intl.Collator('id-ID', { sensitivity: 'base', usage: 'sort' });

const sanitize = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export type EmployeeSortColumn =
  | 'name'
  | 'nip'
  | 'jabatan'
  | 'status'
  | 'average_score'
  | 'score_count'
  | 'created_at';

export const EMPLOYEE_SORT_COLUMNS: readonly EmployeeSortColumn[] = [
  'name',
  'nip',
  'jabatan',
  'status',
  'average_score',
  'score_count',
  'created_at',
] as const;

export const isEmployeeSortColumn = (value: string): value is EmployeeSortColumn =>
  (EMPLOYEE_SORT_COLUMNS as readonly string[]).includes(value);

export interface EmployeeSortableLike
  extends Pick<
    Employee,
    'name' | 'nip' | 'jabatan' | 'sub_jabatan' | 'gol' | 'created_at'
  > {
  position_status?: PositionStatus;
  average_score?: number;
  score_count?: number;
}

export const DEFAULT_EMPLOYEE_SORT: SortState<EmployeeSortColumn> = {
  column: 'name',
  direction: 'asc',
};

export const derivePositionStatus = (
  jabatan?: string | null,
  subJabatan?: string | null,
  gol?: string | null,
): PositionStatus => {
  const combined = `${jabatan ?? ''} ${subJabatan ?? ''}`;
  const normalized = sanitize(combined);
  if (normalized.length > 0) {
    if (STAFF_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
      return 'Staff';
    }
    if (ESELON_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
      return 'Eselon';
    }
  }

  const golValue = (gol ?? '').trim().toUpperCase();
  if (golValue.startsWith('IV')) {
    return 'Eselon';
  }
  return 'Staff';
};

const compareStrings = (a: string, b: string): number => collator.compare(a, b);

const compareNumbers = (a?: number | null, b?: number | null): number => {
  const safeA = typeof a === 'number' && Number.isFinite(a) ? a : Number.NEGATIVE_INFINITY;
  const safeB = typeof b === 'number' && Number.isFinite(b) ? b : Number.NEGATIVE_INFINITY;
  return safeA === safeB ? 0 : safeA < safeB ? -1 : 1;
};

const comparePosition = (a: PositionStatus, b: PositionStatus): number =>
  a === b ? 0 : a === 'Eselon' ? -1 : 1;

const getStringValue = (value?: string | null): string => value?.trim() ?? '';

export const sortEmployees = <T extends EmployeeSortableLike>(
  employees: T[],
  sort: SortState<EmployeeSortColumn>,
): T[] => {
  const sorted = [...employees];
  const directionFactor = sort.direction === 'asc' ? 1 : -1;

  sorted.sort((left, right) => {
    const result = (() => {
      switch (sort.column) {
        case 'name':
          return compareStrings(getStringValue(left.name), getStringValue(right.name));
        case 'nip':
          return compareStrings(getStringValue(left.nip), getStringValue(right.nip));
        case 'jabatan':
          return compareStrings(
            getStringValue(left.jabatan ?? left.sub_jabatan ?? ''),
            getStringValue(right.jabatan ?? right.sub_jabatan ?? ''),
          );
        case 'status': {
          const leftStatus = left.position_status ?? derivePositionStatus(left.jabatan, left.sub_jabatan, left.gol);
          const rightStatus =
            right.position_status ?? derivePositionStatus(right.jabatan, right.sub_jabatan, right.gol);
          const statusCompare = comparePosition(leftStatus, rightStatus);
          return statusCompare !== 0
            ? statusCompare
            : compareStrings(getStringValue(left.name), getStringValue(right.name));
        }
        case 'average_score':
          return compareNumbers(left.average_score, right.average_score);
        case 'score_count':
          return compareNumbers(left.score_count, right.score_count);
        case 'created_at': {
          const leftDate = Date.parse(left.created_at ?? '');
          const rightDate = Date.parse(right.created_at ?? '');
          return compareNumbers(
            Number.isFinite(leftDate) ? leftDate : undefined,
            Number.isFinite(rightDate) ? rightDate : undefined,
          );
        }
        default:
          return 0;
      }
    })();

    if (result !== 0) {
      return result * directionFactor;
    }
    return compareStrings(getStringValue(left.name), getStringValue(right.name));
  });

  return sorted;
};
