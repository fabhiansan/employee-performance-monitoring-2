import type { Employee } from './models';

export type PositionType = 'eselon' | 'staff';

export interface CompetencyScore {
  competencyId?: number;
  name: string;
  rawScore: number;
}

export interface ScoreComponent {
  parameter: string;
  rawScore: number;
  weightPercentage: number;
  weightedScore: number;
}

export interface ComponentResult {
  subtotal: number;
  breakdown: ScoreComponent[];
}

export interface LeadershipScoreResult {
  rawScore: number;
  weightedScore: number;
  applied: boolean;
}

export interface EmployeeScoreRecap {
  employee: Employee;
  positionType: PositionType;
  perilakuKinerja: ComponentResult;
  kualitasKerja: ComponentResult;
  penilaianPimpinan: LeadershipScoreResult | null;
  totalNilai: number;
  rating: string;
}
