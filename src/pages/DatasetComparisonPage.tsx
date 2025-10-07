import { useEffect, useMemo, useState } from 'react';
import { compareDatasets } from '@/lib/api';
import { useDatasets } from '@/lib/dataset-context';
import type { DatasetComparison } from '@/types/models';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TrendingUp, TrendingDown } from 'lucide-react';

export function DatasetComparisonPage() {
  const { datasets, loading: datasetsLoading, selectedDatasetId } = useDatasets();
  const [baseDatasetId, setBaseDatasetId] = useState<number | null>(null);
  const [comparisonDatasetId, setComparisonDatasetId] = useState<number | null>(null);
  const [comparison, setComparison] = useState<DatasetComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (datasets.length === 0 || baseDatasetId !== null) return;
    if (selectedDatasetId) {
      setBaseDatasetId(selectedDatasetId);
    } else if (datasets.length > 0) {
      setBaseDatasetId(datasets[0].id);
    }
  }, [datasets, selectedDatasetId, baseDatasetId]);

  useEffect(() => {
    if (datasets.length < 2 || comparisonDatasetId !== null) return;
    const candidate = datasets.find(dataset => dataset.id !== baseDatasetId)?.id ?? null;
    setComparisonDatasetId(candidate);
  }, [datasets, baseDatasetId, comparisonDatasetId]);

  useEffect(() => {
    if (!baseDatasetId || !comparisonDatasetId) {
      setComparison(null);
      return;
    }
    if (baseDatasetId === comparisonDatasetId) {
      setError('Silakan pilih dua dataset yang berbeda untuk dibandingkan.');
      setComparison(null);
      return;
    }

    const runComparison = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await compareDatasets(baseDatasetId, comparisonDatasetId);
        setComparison(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Gagal membandingkan dataset');
        setComparison(null);
      } finally {
        setLoading(false);
      }
    };

    void runComparison();
  }, [baseDatasetId, comparisonDatasetId]);

  const datasetOptions = useMemo(() => datasets.map(dataset => ({
    label: dataset.name,
    value: dataset.id.toString(),
  })), [datasets]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Perbandingan Dataset</h1>
        <p className="text-muted-foreground mt-1">
          Tolok ukur metrik dan kinerja kompetensi antara dua snapshot dataset.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pilih dataset</CardTitle>
          <CardDescription>Pilih dataset dasar dan dataset perbandingan.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <p className="text-sm font-medium mb-2">Dataset dasar</p>
            <Select
              disabled={datasetsLoading || datasetOptions.length === 0}
              value={baseDatasetId ? baseDatasetId.toString() : undefined}
              onValueChange={value => setBaseDatasetId(parseInt(value))}
            >
              <SelectTrigger>
                <SelectValue placeholder={datasetsLoading ? 'Memuat dataset...' : 'Pilih dataset'} />
              </SelectTrigger>
              <SelectContent>
                {datasetOptions.map(option => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <p className="text-sm font-medium mb-2">Dataset perbandingan</p>
            <Select
              disabled={datasetsLoading || datasetOptions.length < 2}
              value={comparisonDatasetId ? comparisonDatasetId.toString() : undefined}
              onValueChange={value => setComparisonDatasetId(parseInt(value))}
            >
              <SelectTrigger>
                <SelectValue placeholder={datasetOptions.length < 2 ? 'Butuh setidaknya dua dataset' : 'Pilih dataset'} />
              </SelectTrigger>
              <SelectContent>
                {datasetOptions
                  .filter(option => option.value !== baseDatasetId?.toString())
                  .map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading && (
        <div className="space-y-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-80" />
        </div>
      )}

      {!loading && !comparison && !error && (
        <Alert>
          <AlertDescription>Pilih dua dataset yang berbeda untuk melihat perbandingannya.</AlertDescription>
        </Alert>
      )}

      {comparison && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Delta Skor Rata-rata</CardTitle>
                {comparison.average_delta >= 0 ? (
                  <TrendingUp className="h-4 w-4 text-green-600" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-red-600" />
                )}
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${comparison.average_delta >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {comparison.average_delta >= 0 ? '+' : ''}{comparison.average_delta.toFixed(2)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {comparison.base.dataset.name} → {comparison.comparison.dataset.name}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Jumlah Pegawai</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{comparison.base.total_employees} → {comparison.comparison.total_employees}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Perubahan {comparison.comparison.total_employees - comparison.base.total_employees}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Cakupan Kompetensi</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{comparison.base.total_competencies} → {comparison.comparison.total_competencies}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Perubahan {comparison.comparison.total_competencies - comparison.base.total_competencies}
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Perubahan Kinerja Kompetensi</CardTitle>
              <CardDescription>Nilai positif menunjukkan peningkatan pada dataset perbandingan.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Kompetensi</TableHead>
                      <TableHead className="text-right">Rata-rata Dasar</TableHead>
                      <TableHead className="text-right">Rata-rata Perbandingan</TableHead>
                      <TableHead className="text-right">Delta</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {comparison.competency_deltas.map(delta => (
                      <TableRow key={delta.competency.id}>
                        <TableCell>{delta.competency.name}</TableCell>
                        <TableCell className="text-right">{delta.base_average.toFixed(2)}</TableCell>
                        <TableCell className="text-right">{delta.comparison_average.toFixed(2)}</TableCell>
                        <TableCell className={`text-right font-semibold ${delta.delta >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {delta.delta >= 0 ? '+' : ''}{delta.delta.toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
