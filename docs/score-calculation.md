# Score Calculation Guide

## Overview
Employee performance scores are produced in `services/scoringService.ts` by combining three weighted components:

- `perilakuKinerja` (behavioural performance)
- `kualitasKerja` (quality of work)
- `penilaianPimpinan` (leadership evaluation, Eselon-only)

The service consumes normalized competency scores (`CompetencyScore`) for each employee, determines the correct position type, and outputs a capped total score together with supporting breakdown data.

## Position Classification
`getPositionType` (in `utils/organizationalLevels.ts`) classifies each employee as `eselon` or `staff` based on organizational level, position title, and (optionally) golongan. This choice controls weighting rules for `kualitasKerja` and whether `penilaianPimpinan` contributes to the final result.

## Behavioural Performance (`perilakuKinerja`)
The function `calculatePerilakuKinerja` inspects competency entries that match the following parameters. Each raw score is interpreted on a 0–100 scale and converted to a weighted contribution.

| Parameter | Weight (%) |
| --- | --- |
| Inisiatif dan fleksibilitas | 5 |
| Kehadiran dan ketepatan waktu | 5 |
| Kerjasama dan team work | 5 |
| Manajemen waktu kerja | 5 |
| Kepemimpinan | 10 |

Weighted scores are summed and then capped at **25.5**. The implementation adds alias search terms (e.g., `team`, `leadership`) to handle naming variations in uploaded data.

## Quality of Work (`kualitasKerja`)
`calculateKualitasKerja` uses the position type to select one of two weighting profiles. The same competency parameters are used for both profiles; only the weights differ.

| Parameter | Eselon Weight (%) | Staff Weight (%) |
| --- | --- | --- |
| Kualitas kinerja | 25.5 | 42.5 |
| Kemampuan berkomunikasi | 8.5 | 8.5 |
| Pemahaman tentang permasalahan sosial | 8.5 | 8.5 |

For Eselon roles the subtotal is capped at **42.5**, while Staff totals are capped at **70**. As with behavioural scores, helper aliases (e.g., `quality`, `communication`) improve term matching.

## Leadership Evaluation (`penilaianPimpinan`)
Leadership evaluations are only applied to Eselon employees. `generateEmployeeRecap` provides a default raw score of **80** (equivalent to 16 weighted points) unless a manual override is supplied via the `manualScores` map in `generateAllEmployeeRecaps`. When no performance data exists, the contribution is forced to zero to avoid inflating incomplete records.

The raw `penilaianPimpinan` value remains on the 0–100 scale until `calculateTotalScore` converts it to a weighted share: `raw * 20%`.

## Total Score
`calculateTotalScore` combines the components as follows:

```
if positionType === 'eselon':
  total = perilakuKinerja + kualitasKerja + (penilaianPimpinan * 0.20)
else:
  total = perilakuKinerja + kualitasKerja

return min(total, 85)
```

Both paths enforce an **85** point ceiling.

## Recap Generation Workflow
`generateEmployeeRecap` orchestrates score computation for a single employee:

1. Determine position type with `getPositionType`.
2. Compute `perilakuKinerja` and `kualitasKerja`.
3. Select an effective leadership score (only for Eselon with performance data).
4. Produce the capped `totalNilai` via `calculateTotalScore`.

`generateAllEmployeeRecaps` applies the same pipeline across the employee list, accepting optional overrides for leadership evaluations.

## Rating Bands
`getPerformanceRating` maps the capped total to qualitative labels:

- `>= 80` → `Sangat Baik`
- `70 – 79.99` → `Baik`
- `60 – 69.99` → `Kurang Baik`
- `< 60` → `Kurang Baik`

These thresholds are used wherever a descriptive rating is required alongside the numeric score.
