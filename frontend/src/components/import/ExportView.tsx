/**
 * ExportView — CSV, JSON, and Changelog PDF export options.
 */
import { useState } from "react";
import { Download, FileText, FileJson, Loader2, CheckCircle } from "lucide-react";
import { api } from "../../lib/api";

export function ExportView() {
  const [csvLoading, setCsvLoading] = useState(false);
  const [jsonLoading, setJsonLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [csvDone, setCsvDone] = useState(false);
  const [jsonDone, setJsonDone] = useState(false);
  const [pdfDone, setPdfDone] = useState(false);

  const handleCsv = async () => {
    setCsvLoading(true);
    setCsvDone(false);
    try {
      await api.exportCsv();
      setCsvDone(true);
      setTimeout(() => setCsvDone(false), 3000);
    } finally {
      setCsvLoading(false);
    }
  };

  const handleJson = async () => {
    setJsonLoading(true);
    setJsonDone(false);
    try {
      const res = await fetch("/api/data/export", { credentials: "include" });
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `roadmap-export-${new Date().toISOString().split("T")[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setJsonDone(true);
      setTimeout(() => setJsonDone(false), 3000);
    } finally {
      setJsonLoading(false);
    }
  };

  const handlePdf = async () => {
    setPdfLoading(true);
    setPdfDone(false);
    try {
      const blob = await api.exportChangelogPdf({
        filters: {},
        filterSummary: [],
        dateRange: "All time",
        includeAiSummary: false,
        generatedBy: "Export",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `changelog-${new Date().toISOString().split("T")[0]}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setPdfDone(true);
      setTimeout(() => setPdfDone(false), 3000);
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h2 className="text-base font-semibold text-[#1A1A18] mb-1">Export Data</h2>
        <p className="text-sm text-[#6B7068]">Download your roadmap data in various formats.</p>
      </div>

      <div className="space-y-3">
        <ExportCard
          icon={<FileText size={20} className="text-green-600" />}
          title="CSV Export"
          description="All investments with fields: investment, pillar, priority, domain, owner, status, timeline, themes, tags."
          loading={csvLoading}
          done={csvDone}
          onExport={handleCsv}
          buttonLabel="Download CSV"
        />

        <ExportCard
          icon={<FileJson size={20} className="text-blue-600" />}
          title="Full JSON Export"
          description="Complete data snapshot including taxonomy, metrics, and saved views. Use for backup or migration."
          loading={jsonLoading}
          done={jsonDone}
          onExport={handleJson}
          buttonLabel="Download JSON"
        />

        <ExportCard
          icon={<Download size={20} className="text-amber-600" />}
          title="Changelog PDF"
          description="Export the roadmap change history as a formatted PDF report."
          loading={pdfLoading}
          done={pdfDone}
          onExport={handlePdf}
          buttonLabel="Download PDF"
        />
      </div>
    </div>
  );
}

function ExportCard({
  icon,
  title,
  description,
  loading,
  done,
  onExport,
  buttonLabel,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  loading: boolean;
  done: boolean;
  onExport: () => void;
  buttonLabel: string;
}) {
  return (
    <div className="flex items-start gap-4 p-4 border border-[#E5E5E3] rounded-lg bg-white">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#1A1A18]">{title}</p>
        <p className="text-xs text-[#6B7068] mt-0.5">{description}</p>
      </div>
      <button
        onClick={onExport}
        disabled={loading}
        className="shrink-0 flex items-center gap-1.5 text-sm px-3 py-1.5 rounded border border-[#E5E5E3] hover:bg-[#FAFAF9] disabled:opacity-50 transition-colors text-[#1A1A18]"
      >
        {loading ? (
          <Loader2 size={14} className="animate-spin" />
        ) : done ? (
          <CheckCircle size={14} className="text-green-600" />
        ) : (
          <Download size={14} />
        )}
        {done ? "Downloaded!" : buttonLabel}
      </button>
    </div>
  );
}
