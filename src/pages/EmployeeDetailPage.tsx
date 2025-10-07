import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getEmployeePerformance, listDatasets } from '@/lib/api';
import type { EmployeePerformance, ScoreWithCompetency } from '@/types/models';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
// removed summary editor textarea
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, Legend, LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts';
import { ChartContainer, ChartTooltip } from '@/components/ui/chart';
import { ArrowLeft, TrendingUp, TrendingDown, User } from 'lucide-react';

export function EmployeeDetailPage() {
  const { datasetId, employeeId } = useParams<{ datasetId: string; employeeId: string }>();
  const [performance, setPerformance] = useState<EmployeePerformance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trend, setTrend] = useState<{ date: string; average_score: number }[]>([]);

  useEffect(() => {
    if (!employeeId || !datasetId) return;

    const fetchPerformance = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getEmployeePerformance(parseInt(datasetId), parseInt(employeeId));
        setPerformance(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Gagal memuat kinerja pegawai');
        console.error('Failed to load performance:', err);
      } finally {
        setLoading(false);
      }
    };

    void fetchPerformance();
  }, [datasetId, employeeId]);

  useEffect(() => {
    if (!employeeId) return;
    let cancelled = false;
    const loadTrend = async () => {
      try {
        const all = await listDatasets();
        const points = await Promise.all(
          all.map(async (ds) => {
            try {
              const perf = await getEmployeePerformance(ds.id, parseInt(employeeId));
              return { date: ds.created_at, average_score: perf.average_score };
            } catch {
              return null;
            }
          })
        );
        if (!cancelled) {
          const filtered = points
            .filter((p): p is { date: string; average_score: number } => p !== null)
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
          setTrend(filtered);
        }
      } catch {
        // ignore trend errors
      }
    };
    void loadTrend();
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  const getScoreColor = (score: number | null) => {
    if (score === null) return 'bg-gray-100 text-gray-600';
    if (score >= 3) return 'bg-green-100 text-green-700';
    if (score >= 2) return 'bg-yellow-100 text-yellow-700';
    return 'bg-red-100 text-red-700';
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="h-64 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (error || !performance) {
    return (
      <div className="space-y-4">
        <Button variant="outline" asChild>
          <Link to={`/employees/${datasetId}`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Kembali ke Pegawai
          </Link>
        </Button>
        <Alert variant="destructive">
          <AlertDescription>{error ?? 'Pegawai tidak ditemukan'}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const radarData = performance.scores
    .filter((s): s is ScoreWithCompetency & { score: { numeric_value: number } } =>
      s.score.numeric_value !== null
    )
    .map(s => ({
      competency: s.competency.name.length > 20
        ? s.competency.name.substring(0, 20) + '...'
        : s.competency.name,
      value: s.score.numeric_value,
      fullName: s.competency.name,
    }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <Button variant="ghost" size="sm" asChild className="mb-2">
            <Link to={`/employees/${datasetId}`}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Kembali ke Pegawai
            </Link>
          </Button>
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">{performance.employee.name}</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {performance.employee.jabatan ?? 'Pegawai'} • NIP: {performance.employee.nip ?? 'N/A'}
              </p>
            </div>
          </div>
        </div>
        <Card className="w-48">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Skor Rata-rata</p>
            <p className="text-3xl font-bold">{performance.average_score.toFixed(2)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Employee Info */}
      <Card>
        <CardHeader>
          <CardTitle>Informasi Pegawai</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">NIP</p>
              <p className="text-base">{performance.employee.nip ?? '-'}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Golongan</p>
              <p className="text-base">{performance.employee.gol ?? '-'}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Jabatan</p>
              <p className="text-base">{performance.employee.jabatan ?? '-'}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Sub Jabatan</p>
              <p className="text-base">{performance.employee.sub_jabatan ?? '-'}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Radar Chart and Insights */}
      {/* Score Over Time */}
      <Card>
        <CardHeader>
          <CardTitle>Skor dari Waktu ke Waktu</CardTitle>
          <CardDescription>Skor rata-rata berdasarkan waktu pembuatan dataset</CardDescription>
        </CardHeader>
        <CardContent>
          {trend.length > 0 ? (
            <ChartContainer
              config={{ average_score: { label: 'Skor Rata-rata', color: 'hsl(var(--primary))' } }}
              className="h-[260px] w-full"
            >
              <ResponsiveContainer>
                <LineChart data={trend} margin={{ left: 8, right: 8, top: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10 }}
                    tickFormatter={(v: string) => new Date(v).toLocaleDateString()}
                  />
                  <YAxis domain={[0, 4]} tick={{ fontSize: 10 }} width={28} />
                  <ChartTooltip />
                  <Line type="monotone" dataKey="average_score" stroke="var(--color-average_score)" dot={false} strokeWidth={1} />
                </LineChart>
              </ResponsiveContainer>
            </ChartContainer>
          ) : (
            <div className="flex items-center justify-center h-[260px] text-muted-foreground">Tidak ada data historis</div>
          )}
        </CardContent>
      </Card>

      {/* Radar Chart and Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Profil Kompetensi</CardTitle>
            <CardDescription>Representasi visual kinerja di seluruh kompetensi</CardDescription>
          </CardHeader>
          <CardContent>
            {radarData.length > 0 ? (
              <ResponsiveContainer width="100%" height={400}>
                <RadarChart data={radarData}>
                  <PolarGrid />
                  <PolarAngleAxis dataKey="competency" tick={{ fontSize: 12 }} />
                  <PolarRadiusAxis angle={90} domain={[0, 4]} />
                  <Radar
                    name="Skor"
                    dataKey="value"
                    stroke="#3b82f6"
                    fill="#3b82f6"
                    fillOpacity={0.6}
                  />
                  <Legend />
                </RadarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[400px] text-muted-foreground">
                Tidak ada skor numerik yang tersedia
              </div>
            )}
          </CardContent>
        </Card>

        {/* Strengths and Gaps */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-green-600" />
                Kekuatan
              </CardTitle>
              <CardDescription>Kompetensi dengan kinerja terbaik</CardDescription>
            </CardHeader>
            <CardContent>
              {performance.strengths.length > 0 ? (
                <div className="space-y-2">
                  {performance.strengths.map((strength, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                        #{idx + 1}
                      </Badge>
                      <span className="text-sm">{strength}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Tidak ada kekuatan yang teridentifikasi</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingDown className="h-5 w-5 text-red-600" />
                Area Pengembangan
              </CardTitle>
              <CardDescription>Area untuk perbaikan</CardDescription>
            </CardHeader>
            <CardContent>
              {performance.gaps.length > 0 ? (
                <div className="space-y-2">
                  {performance.gaps.map((gap, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                        #{idx + 1}
                      </Badge>
                      <span className="text-sm">{gap}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Tidak ada kesenjangan yang teridentifikasi</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Summary section removed as requested */}

      {/* Competency Scores Table */}
      <Card>
        <CardHeader>
          <CardTitle>Skor Terperinci</CardTitle>
          <CardDescription>Rincian lengkap penilaian kompetensi</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left font-medium">Kompetensi</th>
                  <th className="p-3 text-center font-medium">Nilai Mentah</th>
                  <th className="p-3 text-center font-medium">Skor Numerik</th>
                </tr>
              </thead>
              <tbody>
                {performance.scores.map((scoreItem) => (
                  <tr key={scoreItem.competency.id} className="border-b last:border-0">
                    <td className="p-3">
                      <div>
                        <p className="font-medium">{scoreItem.competency.name}</p>
                        {scoreItem.competency.description && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {scoreItem.competency.description}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="p-3 text-center">
                      <code className="px-2 py-1 bg-muted rounded text-sm">
                        {scoreItem.score.raw_value}
                      </code>
                    </td>
                    <td className="p-3 text-center">
                      <Badge className={getScoreColor(scoreItem.score.numeric_value)}>
                        {scoreItem.score.numeric_value?.toFixed(2) ?? 'N/A'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
