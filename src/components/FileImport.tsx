import { useState, useRef } from 'react';
import { Upload, File as FileIcon, X, Loader2 } from 'lucide-react';
import { previewCSV, isTauri } from '@/lib/api';
import type { CSVPreview } from '@/types/models';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';

interface FileImportProps {
  onFileSelected: (filePathOrFile: string | File, preview: CSVPreview) => void;
  onFileCleared?: () => void;
  title?: string;
  description?: string;
  supportedFormatsLabel?: string;
}

export function FileImport({
  onFileSelected,
  onFileCleared,
  title = 'Impor Berkas CSV',
  description = 'Klik untuk mencari berkas Anda',
  supportedFormatsLabel = 'Format yang didukung: CSV, TSV, TXT',
}: FileImportProps) {
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [selectedFileOrPath, setSelectedFileOrPath] = useState<File | string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileProcess = async (fileOrPath: File | string) => {
    setIsLoading(true);
    setError(null);

    try {
      const preview = await previewCSV(fileOrPath, 10);
      const fileName = fileOrPath instanceof File ? fileOrPath.name : fileOrPath.split('/').pop() ?? fileOrPath;

      setSelectedFileName(fileName);
      setSelectedFileOrPath(fileOrPath);
      onFileSelected(fileOrPath, preview);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat berkas');
    } finally {
      setIsLoading(false);
    }
  };

  const handleHTMLFileInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      void handleFileProcess(file);
    }
  };

  const handleClick = async () => {
    // Try to use Tauri dialog if available, otherwise fall back to HTML input
    if (isTauri()) {
      try {
        const { open: openDialog } = await import('@tauri-apps/plugin-dialog');
        const selected = await openDialog({
          multiple: false,
          filters: [{
            name: 'CSV',
            extensions: ['csv', 'tsv', 'txt']
          }]
        });

        if (selected && typeof selected === 'string') {
          await handleFileProcess(selected);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Gagal membuka pemilih berkas');
      }
    } else {
      // Use HTML file input
      fileInputRef.current?.click();
    }
  };

  const clearFile = () => {
    setSelectedFileName(null);
    setSelectedFileOrPath(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    onFileCleared?.();
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.tsv,.txt,text/csv"
        onChange={handleHTMLFileInput}
        className="hidden"
      />

      {!selectedFileName ? (
        <div
          className={cn(
            "border-2 border-dashed rounded-lg p-12 text-center cursor-pointer",
            "transition-colors duration-200",
            "border-border hover:border-primary/50 hover:bg-accent/50"
          )}
          onClick={() => void handleClick()}
        >
          <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold mb-2">
            {title}
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            {description}
          </p>
          <p className="text-xs text-muted-foreground">
            {supportedFormatsLabel}
          </p>
        </div>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileIcon className="w-8 h-8 text-primary" />
                <div>
                  <h4 className="font-medium">{selectedFileName}</h4>
                  {selectedFileOrPath && typeof selectedFileOrPath === 'string' && (
                    <p className="text-sm text-muted-foreground">{selectedFileOrPath}</p>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={clearFile}
                className="rounded-full"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {error && (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {isLoading && (
        <Alert className="mt-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          <AlertDescription>Memuat pratinjau berkas...</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
