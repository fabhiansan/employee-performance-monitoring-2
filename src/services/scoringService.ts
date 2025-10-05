import type { Employee } from '@/types/models';
import type {
  CompetencyScore,
  ComponentResult,
  EmployeeScoreRecap,
  LeadershipScoreResult,
  PositionType,
  ScoreComponent,
} from '@/types/scoring';
import { getPositionType } from '@/utils/organizationalLevels';

interface WeightedParameter {
  parameter: string;
  weight: number;
  aliases: string[];
}

interface DualWeightedParameter {
  parameter: string;
  eselonWeight: number;
  staffWeight: number;
  aliases: string[];
}

const PERILAKU_PARAMS: WeightedParameter[] = [
  {
    parameter: 'Inisiatif dan fleksibilitas',
    weight: 5,
    aliases: ['inisiatif', 'initiative', 'fleksibilitas', 'flexibility'],
  },
  {
    parameter: 'Kehadiran dan ketepatan waktu',
    weight: 5,
    aliases: ['kehadiran', 'ketepatan waktu', 'attendance', 'punctuality', 'absensi'],
  },
  {
    parameter: 'Kerjasama dan team work',
    weight: 5,
    aliases: ['kerjasama', 'team work', 'teamwork', 'kolaborasi', 'team'],
  },
  {
    parameter: 'Manajemen waktu kerja',
    weight: 5,
    aliases: ['manajemen waktu', 'time management'],
  },
  {
    parameter: 'Kepemimpinan',
    weight: 10,
    aliases: ['kepemimpinan', 'leadership', 'leader'],
  },
];

const KUALITAS_PARAMS: DualWeightedParameter[] = [
  {
    parameter: 'Kualitas kinerja',
    eselonWeight: 25.5,
    staffWeight: 42.5,
    aliases: ['kualitas kinerja', 'kinerja', 'quality of work', 'quality'],
  },
  {
    parameter: 'Kemampuan berkomunikasi',
    eselonWeight: 8.5,
    staffWeight: 8.5,
    aliases: ['komunikasi', 'communication'],
  },
  {
    parameter: 'Pemahaman tentang permasalahan sosial',
    eselonWeight: 8.5,
    staffWeight: 8.5,
    aliases: ['permasalahan sosial', 'social issues', 'social problem', 'pemahaman sosial'],
  },
];

const PERILAKU_CAP = 25.5;
const KUALITAS_CAP: Record<PositionType, number> = {
  eselon: 42.5,
  staff: 70,
};

const TOTAL_CAP = 85;
const LEADERSHIP_WEIGHT = 0.2;
const DEFAULT_LEADERSHIP_SCORE = 80;

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
}

function clampScore(value: number | undefined | null): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function findCompetencyScore(scores: CompetencyScore[], parameter: string, aliases: string[]): number {
  if (scores.length === 0) return 0;

  const targetTokens = [parameter, ...aliases].map(token => normalizeText(token));

  for (const score of scores) {
    const normalizedName = normalizeText(score.name);
    if (targetTokens.some(token => normalizedName.includes(token))) {
      return clampScore(score.rawScore);
    }
  }

  return 0;
}

function toComponent(parameter: string, rawScore: number, weightPercentage: number): ScoreComponent {
  const weightedScore = (rawScore * weightPercentage) / 100;
  return {
    parameter,
    rawScore,
    weightPercentage,
    weightedScore,
  };
}

export function calculatePerilakuKinerja(scores: CompetencyScore[]): ComponentResult {
  const breakdown = PERILAKU_PARAMS.map(param => {
    const raw = findCompetencyScore(scores, param.parameter, param.aliases);
    return toComponent(param.parameter, raw, param.weight);
  });

  const subtotal = Math.min(
    breakdown.reduce((total, current) => total + current.weightedScore, 0),
    PERILAKU_CAP,
  );

  return { subtotal, breakdown };
}

export function calculateKualitasKerja(scores: CompetencyScore[], positionType: PositionType): ComponentResult {
  const breakdown = KUALITAS_PARAMS.map(param => {
    const raw = findCompetencyScore(scores, param.parameter, param.aliases);
    const weight = positionType === 'eselon' ? param.eselonWeight : param.staffWeight;
    return toComponent(param.parameter, raw, weight);
  });

  const subtotal = Math.min(
    breakdown.reduce((total, current) => total + current.weightedScore, 0),
    KUALITAS_CAP[positionType],
  );

  return { subtotal, breakdown };
}

export function calculateTotalScore(
  positionType: PositionType,
  perilaku: ComponentResult,
  kualitas: ComponentResult,
  leadership: LeadershipScoreResult | null,
): number {
  const leadershipContribution = positionType === 'eselon' ? leadership?.weightedScore ?? 0 : 0;
  const total = perilaku.subtotal + kualitas.subtotal + leadershipContribution;
  return Math.min(total, TOTAL_CAP);
}

export function getPerformanceRating(totalScore: number): string {
  if (totalScore >= 80) return 'Sangat Baik';
  if (totalScore >= 70) return 'Baik';
  if (totalScore >= 60) return 'Kurang Baik';
  return 'Kurang Baik';
}

function computeLeadershipScore(
  positionType: PositionType,
  hasPerformanceData: boolean,
  overrideScore?: number,
): LeadershipScoreResult | null {
  if (positionType !== 'eselon') {
    return null;
  }

  if (!hasPerformanceData) {
    return {
      rawScore: 0,
      weightedScore: 0,
      applied: false,
    };
  }

  const rawScore = clampScore(overrideScore ?? DEFAULT_LEADERSHIP_SCORE);
  return {
    rawScore,
    weightedScore: rawScore * LEADERSHIP_WEIGHT,
    applied: true,
  };
}

export function generateEmployeeRecap(
  employee: Employee,
  competencyScores: CompetencyScore[],
  leadershipOverride?: number,
): EmployeeScoreRecap {
  const positionType = getPositionType(employee);
  const perilakuKinerja = calculatePerilakuKinerja(competencyScores);
  const kualitasKerja = calculateKualitasKerja(competencyScores, positionType);
  const hasPerformanceData = competencyScores.length > 0 && (perilakuKinerja.subtotal > 0 || kualitasKerja.subtotal > 0);
  const penilaianPimpinan = computeLeadershipScore(positionType, hasPerformanceData, leadershipOverride);
  const totalNilai = calculateTotalScore(positionType, perilakuKinerja, kualitasKerja, penilaianPimpinan);
  const rating = getPerformanceRating(totalNilai);

  return {
    employee,
    positionType,
    perilakuKinerja,
    kualitasKerja,
    penilaianPimpinan,
    totalNilai,
    rating,
  };
}

export function generateAllEmployeeRecaps(
  employees: Employee[],
  employeeCompetencyScores: Map<number, CompetencyScore[]>,
  manualLeadershipScores: Partial<Record<number, number>> = {},
): EmployeeScoreRecap[] {
  return employees.map(employee => {
    const scores = employeeCompetencyScores.get(employee.id) ?? [];
    const override = manualLeadershipScores[employee.id];
    return generateEmployeeRecap(employee, scores, override);
  });
}
