import { useRef, useState } from "react";
import { api } from "../../api";
import { Loader2, Check, AlertCircle, Download, Upload } from "lucide-react";

export function DataSettings() {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [exporting, setExporting] = useState(false);
  const [importingJson, setImportingJson] = useState(false);
  const [importingCsv, setImportingCsv] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const jsonFileInputRef = useRef<HTMLInputElement>(null);
  const csvFileInputRef = useRef<HTMLInputElement>(null);

  const refreshAll = async () => {
    setSyncing(true);
    setResult(null);
    setError(null);
    try {
      const res = await api.refreshAllMetadata();
      setResult(`Refreshed ${res.refreshed} of ${res.total} items`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Metadata sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleExport = async () => {
    setExporting(true);
    setImportError(null);
    try {
      const payload = await api.exportData();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cataloggy-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const handleImportJsonFile = async (file: File) => {
    setImportingJson(true);
    setImportResult(null);
    setImportError(null);
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const res = await api.importData(payload);
      const s = res.summary;
      setImportResult(
        `Imported ${s.watchEvents} watch events, ${s.listItems} list items, ${s.seriesProgress} series progress entries, ${s.ratings} ratings`
      );
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImportingJson(false);
    }
  };

  const handleImportCsvFile = async (file: File) => {
    setImportingCsv(true);
    setImportResult(null);
    setImportError(null);
    try {
      const csv = await file.text();
      const res = await api.importCsv(csv);
      setImportResult(`Imported ${res.summary.imported} watch events (${res.summary.skipped} rows skipped)`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "CSV import failed");
    } finally {
      setImportingCsv(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <p className="text-sm leading-relaxed" style={{ color: "var(--text-dim)" }}>Re-fetch metadata (posters, descriptions, etc.) for all tracked items from TMDB.</p>
        <button
          type="button"
          onClick={refreshAll}
          disabled={syncing}
          className="inline-flex items-center gap-2 rounded-xl bg-claw-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-claw-600 disabled:opacity-60"
        >
          {syncing ? <><Loader2 size={16} className="animate-spin" /> Syncing...</> : "Sync all metadata"}
        </button>
        {result && <p className="flex items-center gap-2 text-sm text-emerald-600"><Check size={16} /> {result}</p>}
        {error && <p className="flex items-center gap-2 text-sm text-rose-600"><AlertCircle size={16} /> {error}</p>}
      </div>

      <div className="space-y-4 pt-5" style={{ borderTop: "1px solid var(--border)" }}>
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--text-dim)" }}>Export your data</p>
          <p className="text-sm leading-relaxed" style={{ color: "var(--text-dim)" }}>Download a JSON file with your lists, watch history, series progress, and ratings.</p>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-[var(--surface)] disabled:opacity-60"
          style={{ background: "var(--surface-strong)", border: "1px solid var(--border)", color: "var(--text-dim)" }}
        >
          {exporting ? <><Loader2 size={16} className="animate-spin" /> Exporting...</> : <><Download size={16} /> Download export</>}
        </button>
      </div>

      <div className="space-y-4 pt-5" style={{ borderTop: "1px solid var(--border)" }}>
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--text-dim)" }}>Import data</p>
          <p className="text-sm leading-relaxed" style={{ color: "var(--text-dim)" }}>
            Restore from a Cataloggy JSON export, or import watch history from a CSV file with columns <code>imdbId,type,season,episode,watchedAt</code>.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={jsonFileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImportJsonFile(file);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => jsonFileInputRef.current?.click()}
            disabled={importingJson}
            className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-[var(--surface)] disabled:opacity-60"
            style={{ background: "var(--surface-strong)", border: "1px solid var(--border)", color: "var(--text-dim)" }}
          >
            {importingJson ? <><Loader2 size={16} className="animate-spin" /> Importing...</> : <><Upload size={16} /> Import JSON export</>}
          </button>

          <input
            ref={csvFileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleImportCsvFile(file);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => csvFileInputRef.current?.click()}
            disabled={importingCsv}
            className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-[var(--surface)] disabled:opacity-60"
            style={{ background: "var(--surface-strong)", border: "1px solid var(--border)", color: "var(--text-dim)" }}
          >
            {importingCsv ? <><Loader2 size={16} className="animate-spin" /> Importing...</> : <><Upload size={16} /> Import CSV history</>}
          </button>
        </div>
        {importResult && <p className="flex items-center gap-2 text-sm text-emerald-600"><Check size={16} /> {importResult}</p>}
        {importError && <p className="flex items-center gap-2 text-sm text-rose-600"><AlertCircle size={16} /> {importError}</p>}
      </div>
    </div>
  );
}
