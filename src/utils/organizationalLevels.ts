import type { Employee } from '@/types/models';
import type { PositionType } from '@/types/scoring';

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
];

const STAFF_KEYWORDS = ['staff', 'staf'];

function normalize(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
}

export function getPositionType(employee: Pick<Employee, 'jabatan' | 'sub_jabatan' | 'gol'>): PositionType {
  const combined = `${normalize(employee.jabatan)} ${normalize(employee.sub_jabatan)}`.trim();

  if (combined.length > 0) {
    if (STAFF_KEYWORDS.some(keyword => combined.includes(keyword))) {
      return 'staff';
    }

    if (ESELON_KEYWORDS.some(keyword => combined.includes(keyword))) {
      return 'eselon';
    }
  }

  const gol = normalize(employee.gol).toUpperCase();
  if (gol.startsWith('IV')) {
    return 'eselon';
  }

  return 'staff';
}
