import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { FileImport } from '@/components/FileImport';
import { useDatasets } from '@/lib/dataset-context';
import {
  deleteDataset,
  getDatasetStats,
  mergeDatasets,
  updateDataset,
  parseEmployeeCSV,
  appendDatasetEmployees,
} from '@/lib/api';
import type {
  Dataset,
  DatasetStats,
  MergeDatasetsResult,
  CSVPreview,
  ParsedEmployee,
  DatasetEmployeeAppendResult,
} from '@/types/models';

export function DataManagementPage() {
  const {
    datasets,
    loading,
    error: datasetError,
    refreshDatasets,
    selectDataset,
  } = useDatasets();

  const [statsMap, setStatsMap] = useState<Record<number, DatasetStats>>({});
  const [loadingStats, setLoadingStats] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [editingDataset, setEditingDataset] = useState<Dataset | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [datasetToDelete, setDatasetToDelete] = useState<Dataset | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [mergeSelection, setMergeSelection] = useState<number[]>([]);
  const [mergeName, setMergeName] = useState('');
  const [mergeDescription, setMergeDescription] = useState('');
  const [isMerging, setIsMerging] = useState(false);
  const [mergeResult, setMergeResult] = useState<MergeDatasetsResult | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [appendDataset, setAppendDataset] = useState<Dataset | null>(null);
  const [appendPreview, setAppendPreview] = useState<CSVPreview | null>(null);
  const [appendEmployees, setAppendEmployees] = useState<ParsedEmployee[]>([]);
  const [appendResult, setAppendResult] = useState<DatasetEmployeeAppendResult | null>(null);
  const [appendError, setAppendError] = useState<string | null>(null);
  const [appendLoading, setAppendLoading] = useState(false);
  const [appendFileKey, setAppendFileKey] = useState(0);

  useEffect(() => {
    setMergeSelection((prev) => prev.filter((id) => datasets.some((dataset) => dataset.id === id)));
  }, [datasets]);

  useEffect(() => {
    let isMounted = true;
    const loadStats = async () => {
      if (datasets.length === 0) {
        if (isMounted) {
          setStatsMap({});
        }
        return;
      }

      setLoadingStats(true);
      const next: Record<number, DatasetStats> = {};
      for (const dataset of datasets) {
        try {
          const stats = await getDatasetStats(dataset.id);
          next[dataset.id] = stats;
        } catch (err) {
          if (isMounted) {
            setPageError(err instanceof Error ? err.message : 'Failed to load dataset statistics');
          }
        }
      }
      if (isMounted) {
        setStatsMap(next);
        setLoadingStats(false);
      }
    };

    void loadStats();
    return () => {
      isMounted = false;
    };
  }, [datasets]);

  const selectedDatasets = useMemo(
    () => datasets.filter((dataset) => mergeSelection.includes(dataset.id)),
    [datasets, mergeSelection]
  );

  const showMessages = Boolean(datasetError ?? pageError ?? successMessage);
  const appendEmployeeCount = appendEmployees.length;
  const appendPreviewRows = appendPreview?.rows ?? [];

  const handleOpenEdit = (dataset: Dataset) => {
    setPageError(null);
    setSuccessMessage(null);
    setEditingDataset(dataset);
    setEditName(dataset.name);
    setEditDescription(dataset.description ?? '');
  };

  const handleSaveEdit = async () => {
    if (!editingDataset) return;
    const name = editName.trim();
    if (!name) {
      setPageError('Nama dataset wajib diisi');
      return;
    }

    setSavingEdit(true);
    setPageError(null);
    try {
      await updateDataset(editingDataset.id, {
        name,
        description: editDescription.trim().length === 0 ? null : editDescription,
      });
      setSuccessMessage('Dataset berhasil diperbarui.');
      setEditingDataset(null);
      await refreshDatasets();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Gagal memperbarui dataset');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!datasetToDelete) return;
    setDeleting(true);
    setPageError(null);
    try {
      await deleteDataset(datasetToDelete.id);
      setSuccessMessage(`Dataset "${datasetToDelete.name}" dihapus.`);
      setMergeSelection((prev) => prev.filter((id) => id !== datasetToDelete.id));
      setDatasetToDelete(null);
      await refreshDatasets();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Gagal menghapus dataset');
    } finally {
      setDeleting(false);
    }
  };

  const handleMerge = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mergeSelection.length < 2) {
      setPageError('Pilih setidaknya dua dataset untuk digabungkan');
      return;
    }

    const name = mergeName.trim();
    if (!name) {
      setPageError('Berikan nama untuk dataset gabungan');
      return;
    }

    setIsMerging(true);
    setPageError(null);
    try {
      const result = await mergeDatasets({
        source_dataset_ids: mergeSelection,
        target_name: name,
        target_description: mergeDescription.trim().length === 0 ? null : mergeDescription,
      });
      setMergeResult(result);
      setSuccessMessage(`Dataset digabungkan ke dalam "${result.dataset.name}".`);
      setMergeSelection([]);
      setMergeName('');
      setMergeDescription('');
      await refreshDatasets();
      selectDataset(result.dataset.id);
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Gagal menggabungkan dataset');
    } finally {
      setIsMerging(false);
    }
  };

  const toggleMergeSelection = (datasetId: number) => {
    setMergeSelection((prev) =>
      prev.includes(datasetId) ? prev.filter((id) => id !== datasetId) : [...prev, datasetId]
    );
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setPageError(null);
    try {
      await refreshDatasets();
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Gagal menyegarkan dataset');
    } finally {
      setRefreshing(false);
    }
  };

  const sanitizeAppendOptional = (value: string | null | undefined): string | null => {
    if (value === undefined || value === null) {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const normalizeAppendName = (value: string): string =>
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const prepareEmployeesForAppend = (list: ParsedEmployee[]): ParsedEmployee[] => {
    const unique = new Map<string, ParsedEmployee>();
    for (const employee of list) {
      const trimmed = employee.name.trim();
      if (!trimmed) {
        continue;
      }
      const normalized = normalizeAppendName(trimmed);
      const sanitized: ParsedEmployee = {
        name: trimmed,
        nip: sanitizeAppendOptional(employee.nip),
        gol: sanitizeAppendOptional(employee.gol),
        jabatan: sanitizeAppendOptional(employee.jabatan),
        sub_jabatan: sanitizeAppendOptional(employee.sub_jabatan),
      };

      const existing = unique.get(normalized);
      if (existing) {
        if (!existing.nip && sanitized.nip) existing.nip = sanitized.nip;
        if (!existing.gol && sanitized.gol) existing.gol = sanitized.gol;
        if (!existing.jabatan && sanitized.jabatan) existing.jabatan = sanitized.jabatan;
        if (!existing.sub_jabatan && sanitized.sub_jabatan) {
          existing.sub_jabatan = sanitized.sub_jabatan;
        }
      } else {
        unique.set(normalized, sanitized);
      }
    }
    return Array.from(unique.values());
  };

  const resetAppendState = () => {
    setAppendPreview(null);
    setAppendEmployees([]);
    setAppendResult(null);
    setAppendError(null);
    setAppendLoading(false);
    setAppendFileKey((key) => key + 1);
  };

  const handleOpenAppend = (dataset: Dataset) => {
    setPageError(null);
    setSuccessMessage(null);
    resetAppendState();
    setAppendDataset(dataset);
  };

  const handleAppendFileSelected = async (fileOrPath: string | File, preview: CSVPreview) => {
    setAppendPreview(preview);
    setAppendResult(null);
    setAppendError(null);
    try {
      const parsed = await parseEmployeeCSV(fileOrPath);
      const prepared = prepareEmployeesForAppend(parsed);
      setAppendEmployees(prepared);
      if (prepared.length === 0) {
        setAppendError('Tidak ada pegawai valid yang ditemukan di file yang dipilih');
      }
    } catch (err) {
      setAppendEmployees([]);
      setAppendError(err instanceof Error ? err.message : 'Gagal mengurai file pegawai');
    }
  };

  const handleAppendFileCleared = () => {
    setAppendPreview(null);
    setAppendEmployees([]);
    setAppendResult(null);
    setAppendError(null);
  };

  const handleAppendSubmit = async () => {
    if (!appendDataset) {
      return;
    }
    if (appendEmployees.length === 0) {
      setAppendError('Pilih file pegawai sebelum menambahkan');
      return;
    }

    setAppendLoading(true);
    setAppendError(null);
    setAppendResult(null);

    try {
      const result = await appendDatasetEmployees(appendDataset.id, appendEmployees);
      setAppendResult(result);
      setSuccessMessage(
        result.linked > 0
          ? `Menambahkan ${result.linked} pegawai ke "${appendDataset.name}".`
          : `Memperbarui pegawai untuk "${appendDataset.name}".`
      );
      await refreshDatasets();
      try {
        const stats = await getDatasetStats(appendDataset.id);
        setStatsMap((prev) => ({ ...prev, [appendDataset.id]: stats }));
      } catch (statsErr) {
        const message = statsErr instanceof Error ? statsErr.message : 'Gagal memuat statistik dataset';
        setPageError((prev) => prev ?? message);
      }
    } catch (err) {
      setAppendError(err instanceof Error ? err.message : 'Gagal menambahkan pegawai');
    } finally {
      setAppendLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Manajemen Data</h2>
          <p className="text-sm text-muted-foreground">
            Lihat, perbarui, hapus, dan gabungkan dataset agar ruang kerja Anda tetap teratur.
          </p>
        </div>
        <Button variant="outline" onClick={() => void handleRefresh()} disabled={refreshing}>
          {refreshing ? 'Menyegarkan…' : 'Segarkan'}
        </Button>
      </div>

      {showMessages && (
        <div className="space-y-3">
          {datasetError && (
            <Alert variant="destructive">
              <AlertDescription>{datasetError}</AlertDescription>
            </Alert>
          )}
          {pageError && (
            <Alert variant="destructive">
              <AlertDescription>{pageError}</AlertDescription>
            </Alert>
          )}
          {successMessage && (
            <Alert>
              <AlertDescription>{successMessage}</AlertDescription>
            </Alert>
          )}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Dataset</CardTitle>
            <CardDescription>Kelola dataset yang ada dan perbarui detailnya.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Memuat dataset…</p>
          ) : datasets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Belum ada dataset yang tersedia. Impor dataset untuk memulai.
            </p>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40%]">Dataset</TableHead>
                    <TableHead>Pegawai</TableHead>
                    <TableHead>Kompetensi</TableHead>
                    <TableHead>Skor</TableHead>
                    <TableHead>Diperbarui</TableHead>
                    <TableHead className="text-right">Tindakan</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {datasets.map((dataset) => {
                    const stats = statsMap[dataset.id];
                    return (
                      <TableRow key={dataset.id}>
                        <TableCell>
                          <div className="flex items-start gap-3">
                            <input
                              type="checkbox"
                              className="mt-1 h-4 w-4 accent-primary"
                              checked={mergeSelection.includes(dataset.id)}
                              onChange={() => toggleMergeSelection(dataset.id)}
                            />
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-sm sm:text-base">{dataset.name}</span>
                                <Badge variant="outline">#{dataset.id}</Badge>
                              </div>
                              {dataset.description && (
                                <p className="text-sm text-muted-foreground line-clamp-2">
                                  {dataset.description}
                                </p>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {stats ? stats.total_employees : loadingStats ? 'Memuat…' : '—'}
                        </TableCell>
                        <TableCell>
                          {stats ? stats.total_competencies : loadingStats ? 'Memuat…' : '—'}
                        </TableCell>
                        <TableCell>{stats ? stats.total_scores : loadingStats ? 'Memuat…' : '—'}</TableCell>
                        <TableCell>
                          {new Date(dataset.updated_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="flex justify-end gap-2">
                          <Button size="sm" onClick={() => handleOpenAppend(dataset)}>
                            Tambahkan pegawai
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => handleOpenEdit(dataset)}>
                            Ubah
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              setPageError(null);
                              setSuccessMessage(null);
                              setDatasetToDelete(dataset);
                            }}
                          >
                            Hapus
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Gabungkan Dataset</CardTitle>
          <CardDescription>
            Gabungkan beberapa dataset menjadi satu dataset terkonsolidasi dengan semua catatan terkait.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={(event) => void handleMerge(event)}>
            <div className="space-y-2">
              <label className="text-sm font-medium">Dataset terpilih</label>
              {selectedDatasets.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Pilih setidaknya dua dataset dari tabel di atas untuk mengaktifkan penggabungan.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {selectedDatasets.map((dataset) => (
                    <Badge key={dataset.id} variant="secondary">
                      {dataset.name}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="merge-name">
                  Nama dataset gabungan
                </label>
                <Input
                  id="merge-name"
                  value={mergeName}
                  onChange={(event) => setMergeName(event.target.value)}
                  placeholder="Nama dataset gabungan"
                  disabled={isMerging}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="merge-description">
                  Deskripsi (opsional)
                </label>
                <Textarea
                  id="merge-description"
                  value={mergeDescription}
                  onChange={(event) => setMergeDescription(event.target.value)}
                  placeholder="Jelaskan dataset gabungan"
                  disabled={isMerging}
                  className="min-h-[80px]"
                />
              </div>
            </div>

            {mergeResult && (
              <Alert>
                <AlertDescription>
                  Dataset baru "{mergeResult.dataset.name}" termasuk {mergeResult.employee_count} pegawai,
                  {mergeResult.score_count} skor, dan {mergeResult.rating_mapping_count} pemetaan peringkat.
                </AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={isMerging || mergeSelection.length < 2}>
              {isMerging ? 'Menggabungkan…' : 'Gabungkan dataset terpilih'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(appendDataset)}
        onOpenChange={(open) => {
          if (!open) {
            setAppendDataset(null);
            resetAppendState();
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Tambahkan pegawai</DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground">
              Unggah file pegawai yang diperbarui untuk menambahkan pegawai baru ke "{appendDataset?.name}".
            </p>
            <FileImport
              key={appendFileKey}
              onFileSelected={(file, preview) => void handleAppendFileSelected(file, preview)}
              onFileCleared={handleAppendFileCleared}
              title="Pilih CSV pegawai"
              description="Pilih file data induk pegawai untuk ditambahkan"
            />

            {appendError && (
              <Alert variant="destructive">
                <AlertDescription>{appendError}</AlertDescription>
              </Alert>
            )}

            {appendEmployees.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {appendEmployeeCount} pegawai siap ditambahkan.
                </p>
                <div className="max-h-64 overflow-y-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nama</TableHead>
                        <TableHead>NIP</TableHead>
                        <TableHead>Gol</TableHead>
                        <TableHead>Jabatan</TableHead>
                        <TableHead>Sub jabatan</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {appendEmployees.slice(0, 10).map((employee, index) => (
                        <TableRow key={`${employee.name}-${index}`}>
                          <TableCell>{employee.name}</TableCell>
                          <TableCell>{employee.nip ?? '—'}</TableCell>
                          <TableCell>{employee.gol ?? '—'}</TableCell>
                          <TableCell>{employee.jabatan ?? '—'}</TableCell>
                          <TableCell>{employee.sub_jabatan ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {appendEmployees.length > 10 && (
                  <p className="text-xs text-muted-foreground">
                    Menampilkan 10 pegawai pertama.
                  </p>
                )}
              </div>
            )}

            {appendPreviewRows.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Pratinjau file</p>
                <div className="max-h-48 overflow-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {(appendPreview?.headers ?? []).map((header, idx) => (
                          <TableHead key={`${header}-${idx}`}>{header}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {appendPreviewRows.slice(0, 5).map((row, rowIdx) => (
                        <TableRow key={`append-preview-${rowIdx}`}>
                          {row.map((cell, cellIdx) => (
                            <TableCell key={`${rowIdx}-${cellIdx}`}>{cell}</TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {appendResult && (
              <Alert>
                <AlertDescription>
                  Dibuat {appendResult.created} pegawai, diperbarui {appendResult.updated}, tertaut {appendResult.linked}.
                </AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter className="pt-4">
            <Button
              variant="outline"
              onClick={() => {
                setAppendDataset(null);
                resetAppendState();
              }}
              disabled={appendLoading}
            >
              Batal
            </Button>
            <Button onClick={() => void handleAppendSubmit()} disabled={appendLoading || appendEmployees.length === 0}>
              {appendLoading ? 'Menambahkan…' : 'Tambahkan pegawai'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingDataset)} onOpenChange={(open) => !open && setEditingDataset(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ubah dataset</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="edit-name">
                Nama dataset
              </label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                disabled={savingEdit}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="edit-description">
                Deskripsi
              </label>
              <Textarea
                id="edit-description"
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
                disabled={savingEdit}
                className="min-h-[100px]"
              />
            </div>
          </div>
          <DialogFooter className="pt-4">
            <Button variant="outline" onClick={() => setEditingDataset(null)} disabled={savingEdit}>
              Batal
            </Button>
            <Button onClick={() => void handleSaveEdit()} disabled={savingEdit}>
              {savingEdit ? 'Menyimpan…' : 'Simpan perubahan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(datasetToDelete)} onOpenChange={(open) => !open && setDatasetToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hapus dataset</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Apakah Anda yakin ingin menghapus "{datasetToDelete?.name}"? Tindakan ini tidak dapat dibatalkan dan akan
            menghapus semua catatan terkait.
          </p>
          <DialogFooter className="pt-4">
            <Button variant="outline" onClick={() => setDatasetToDelete(null)} disabled={deleting}>
              Batal
            </Button>
            <Button variant="destructive" onClick={() => void handleConfirmDelete()} disabled={deleting}>
              {deleting ? 'Menghapus…' : 'Hapus'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
