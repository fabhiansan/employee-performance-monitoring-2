import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  getEmployeePerformance,
  generateEmployeeSummary,
  getEmployeeSummary,
  saveEmployeeSummary,
  exportEmployeeSummary,
  isTauri,
} from '@/lib/api';
import type { EmployeePerformance, ScoreWithCompetency, Summary } from '@/types/models';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, ResponsiveContainer, Legend } from 'recharts';
import { ArrowLeft, TrendingUp, TrendingDown, User, FileText } from 'lucide-react';
import { save } from '@tauri-apps/plugin-dialog';

export function EmployeeDetailPage() {
  const { datasetId, employeeId } = useParams<{ datasetId: string; employeeId: string }>();
  const [performance, setPerformance] = useState<EmployeePerformance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryDraft, setSummaryDraft] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryMessage, setSummaryMessage] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  useEffect(() => {
    if (!employeeId || !datasetId) return;

    const fetchPerformance = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getEmployeePerformance(parseInt(datasetId), parseInt(employeeId));
        setPerformance(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load employee performance');
        console.error('Failed to load performance:', err);
      } finally {
        setLoading(false);
      }
    };

    void fetchPerformance();
  }, [datasetId, employeeId]);

  useEffect(() => {
    if (!employeeId || !datasetId) return;

    const fetchSummary = async () => {
      try {
        setSummaryLoading(true);
        setSummaryError(null);
        const existing = await getEmployeeSummary(parseInt(employeeId));
        if (existing) {
          setSummary(existing);
          setSummaryDraft(existing.content);
        } else {
          setSummary(null);
          setSummaryDraft('');
        }
      } catch (err) {
        setSummaryError(err instanceof Error ? err.message : 'Failed to load summary');
      } finally {
        setSummaryLoading(false);
      }
    };

    void fetchSummary();
  }, [datasetId, employeeId]);

  const getScoreColor = (score: number | null) => {
    if (score === null) return 'bg-gray-100 text-gray-600';
    if (score >= 3) return 'bg-green-100 text-green-700';
    if (score >= 2) return 'bg-yellow-100 text-yellow-700';
    return 'bg-red-100 text-red-700';
  };

  const handleGenerateSummary = async () => {
    if (!employeeId || !datasetId) return;
    try {
      setSummaryLoading(true);
      setSummaryError(null);
      setSummaryMessage(null);
      const result = await generateEmployeeSummary(parseInt(datasetId), parseInt(employeeId));
      setSummaryDraft(result.content);
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : 'Failed to generate summary');
    } finally {
      setSummaryLoading(false);
    }
  };

  const handleSaveSummary = async () => {
    if (!employeeId || !summaryDraft.trim()) return;
    try {
      setSummaryLoading(true);
      setSummaryError(null);
      const saved = await saveEmployeeSummary(parseInt(employeeId), summaryDraft.trim());
      setSummary(saved);
      setSummaryMessage('Summary saved successfully.');
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : 'Failed to save summary');
    } finally {
      setSummaryLoading(false);
    }
  };

  const handleExportSummary = async () => {
    if (!employeeId || !datasetId || !isTauri()) return;
    try {
      setSummaryLoading(true);
      setSummaryError(null);
      setSummaryMessage(null);
      const filePath = await save({
        title: 'Export Summary',
        defaultPath: `${performance?.employee.name ?? 'summary'}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (!filePath) {
        setSummaryLoading(false);
        return;
      }
      let latestContent = summaryDraft.trim();
      if (!latestContent) {
        const generated = await generateEmployeeSummary(parseInt(datasetId), parseInt(employeeId));
        setSummaryDraft(generated.content);
        latestContent = generated.content;
      }
      const saved = await saveEmployeeSummary(parseInt(employeeId), latestContent.trim());
      setSummary(saved);
      await exportEmployeeSummary(parseInt(datasetId), parseInt(employeeId), filePath);
      setSummaryMessage('Summary exported to PDF.');
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : 'Failed to export summary');
    } finally {
      setSummaryLoading(false);
    }
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
            Back to Employees
          </Link>
        </Button>
        <Alert variant="destructive">
          <AlertDescription>{error ?? 'Employee not found'}</AlertDescription>
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
              Back to Employees
            </Link>
          </Button>
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">{performance.employee.name}</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {performance.employee.jabatan ?? 'Employee'} • NIP: {performance.employee.nip ?? 'N/A'}
              </p>
            </div>
          </div>
        </div>
        <Card className="w-48">
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Average Score</p>
            <p className="text-3xl font-bold">{performance.average_score.toFixed(2)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Employee Info */}
      <Card>
        <CardHeader>
          <CardTitle>Employee Information</CardTitle>
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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Competency Profile</CardTitle>
            <CardDescription>Visual representation of performance across competencies</CardDescription>
          </CardHeader>
          <CardContent>
            {radarData.length > 0 ? (
              <ResponsiveContainer width="100%" height={400}>
                <RadarChart data={radarData}>
                  <PolarGrid />
                  <PolarAngleAxis dataKey="competency" tick={{ fontSize: 12 }} />
                  <PolarRadiusAxis angle={90} domain={[0, 4]} />
                  <Radar
                    name="Score"
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
                No numeric scores available
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
                Strengths
              </CardTitle>
              <CardDescription>Top performing competencies</CardDescription>
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
                <p className="text-sm text-muted-foreground">No strengths identified</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingDown className="h-5 w-5 text-red-600" />
                Development Areas
              </CardTitle>
              <CardDescription>Areas for improvement</CardDescription>
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
                <p className="text-sm text-muted-foreground">No gaps identified</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Performance Summary
          </CardTitle>
          <CardDescription>
            Generate, refine, and export the narrative summary for this employee.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {summaryError && (
            <Alert variant="destructive">
              <AlertDescription>{summaryError}</AlertDescription>
            </Alert>
          )}
          {summaryMessage && (
            <Alert>
              <AlertDescription>{summaryMessage}</AlertDescription>
            </Alert>
          )}
          <Textarea
            value={summaryDraft}
            onChange={event => {
              setSummaryDraft(event.target.value);
              setSummaryMessage(null);
            }}
            placeholder="Generate a summary to get started or edit the existing narrative."
            className="min-h-[180px]"
            disabled={summaryLoading}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void handleGenerateSummary()} disabled={summaryLoading} variant="outline">
              Generate Summary
            </Button>
            <Button onClick={() => void handleSaveSummary()} disabled={summaryLoading || !summaryDraft.trim()}>
              Save Summary
            </Button>
            {isTauri() && (
              <Button
                onClick={() => void handleExportSummary()}
                disabled={summaryLoading || !summaryDraft.trim()}
                variant="secondary"
              >
                Export as PDF
              </Button>
            )}
            {summary && (
              <span className="text-xs text-muted-foreground">
                Last updated {new Date(summary.updated_at).toLocaleString()}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Competency Scores Table */}
      <Card>
        <CardHeader>
          <CardTitle>Detailed Scores</CardTitle>
          <CardDescription>Complete breakdown of competency assessments</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left font-medium">Competency</th>
                  <th className="p-3 text-center font-medium">Raw Value</th>
                  <th className="p-3 text-center font-medium">Numeric Score</th>
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
