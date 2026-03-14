/**
 * Import Page — sub-tabbed container with Spreadsheet, Paste, Slide, and PDF import flows.
 * Adapted from v2 ImportView into hook-based v3 architecture.
 */
import { useState, useRef } from "react";
import { useSearch, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Upload,
  FileText,
  ClipboardPaste,
  Image,
  FileStack,
  Loader2,
  CheckCircle,
  XCircle,
  Trash2,
  Send,
  Undo2,
} from "lucide-react";
import { api } from "../../lib/api";
import { useToastStore } from "../layout/Toast";
import type { SlideExtraction } from "@roadmap/shared";

// ─── Types ────────────────────────────────────────────────────────────────────
interface ImportJobSummary {
  id: string;
  fileName: string;
  status: string;
  createdAt: string;
  createdBy: string;
  totalChanges: number;
  accepted: number;
  rejected: number;
  pending: number;
  totalTactics: number;
}

// ─── Tab configs ──────────────────────────────────────────────────────────────
const TABS = [
  { key: "spreadsheet" as const, label: "Spreadsheet", icon: FileText },
  { key: "paste" as const, label: "Paste", icon: ClipboardPaste },
  { key: "slide" as const, label: "Slide", icon: Image },
  { key: "pdf" as const, label: "PDF Bulk", icon: FileStack },
] as const;

type ImportTab = (typeof TABS)[number]["key"];

export function ImportPage() {
  const search = useSearch({ from: "/import/" });
  const navigate = useNavigate();
  const qc = useQueryClient();
  const showToast = useToastStore((s) => s.show);

  const [activeTab, setActiveTab] = useState<ImportTab>("spreadsheet");

  // ─── Import jobs list ───────────────────────────────────────────────────────
  const { data: jobs = [], isLoading: jobsLoading } = useQuery({
    queryKey: ["import-jobs"],
    queryFn: api.listImportJobs,
  });

  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  // ─── Active draft ───────────────────────────────────────────────────────────
  const { data: draftChanges = [] } = useQuery({
    queryKey: ["import-draft", activeJobId],
    queryFn: () => (activeJobId ? api.getImportDraft(activeJobId) : Promise.resolve([])),
    enabled: !!activeJobId,
  });

  const commitMutation = useMutation({
    mutationFn: (id: string) => api.commitImport(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["import-jobs"] });
      qc.invalidateQueries({ queryKey: ["rows"] });
      showToast("Import committed successfully");
    },
  });

  const deleteJobMutation = useMutation({
    mutationFn: (id: string) => api.deleteImportJob(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["import-jobs"] });
      if (activeJobId) setActiveJobId(null);
      showToast("Import job deleted");
    },
  });

  const undoMutation = useMutation({
    mutationFn: (id: string) => api.undoImport(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["import-jobs"] });
      qc.invalidateQueries({ queryKey: ["rows"] });
      showToast("Import undone");
    },
  });

  const updateDraftMutation = useMutation({
    mutationFn: ({
      jobId,
      changeId,
      status,
    }: {
      jobId: string;
      changeId: string;
      status: "accepted" | "rejected" | "pending";
    }) => api.updateImportDraft(jobId, changeId, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["import-draft", activeJobId] });
      qc.invalidateQueries({ queryKey: ["import-jobs"] });
    },
  });

  const bulkStatusMutation = useMutation({
    mutationFn: ({
      jobId,
      status,
    }: {
      jobId: string;
      status: "accepted" | "rejected" | "pending";
    }) => api.bulkUpdateDraftStatus(jobId, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["import-draft", activeJobId] });
      qc.invalidateQueries({ queryKey: ["import-jobs"] });
    },
  });

  return (
    <div className="h-full flex flex-col">
      {/* Page header */}
      <div className="px-6 pt-6 pb-4 border-b border-[#E5E5E3]">
        <h1 className="text-2xl font-bold text-[#1A1A18] tracking-tight">Import</h1>
        <p className="text-sm text-[#6B7068] mt-1">
          Import investments from spreadsheets, slide decks, or paste raw data
        </p>
      </div>

      {/* Sub-tabs */}
      <div className="px-6 pt-3 flex gap-1 border-b border-[#E5E5E3]">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-md border-b-2 transition-colors ${
              activeTab === key
                ? "border-amber-600 text-amber-700 bg-amber-50/50"
                : "border-transparent text-[#6B7068] hover:text-[#1A1A18] hover:bg-[#FAFAF9]"
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {activeTab === "spreadsheet" && (
          <SpreadsheetImport
            onUploaded={(jobId) => {
              setActiveJobId(jobId);
              qc.invalidateQueries({ queryKey: ["import-jobs"] });
            }}
          />
        )}
        {activeTab === "paste" && (
          <PasteImport
            onUploaded={(jobId) => {
              setActiveJobId(jobId);
              qc.invalidateQueries({ queryKey: ["import-jobs"] });
            }}
          />
        )}
        {activeTab === "slide" && <SlideImport />}
        {activeTab === "pdf" && <PdfImport />}

        {/* Import jobs list */}
        <div className="mt-8">
          <h2 className="text-sm font-semibold text-[#1A1A18] mb-3">Import History</h2>
          {jobsLoading ? (
            <p className="text-sm text-[#9CA39A]">Loading...</p>
          ) : jobs.length === 0 ? (
            <p className="text-sm text-[#9CA39A]">No import jobs yet</p>
          ) : (
            <div className="space-y-2">
              {jobs.map((job) => (
                <ImportJobCard
                  key={job.id}
                  job={job}
                  isActive={job.id === activeJobId}
                  onSelect={() => setActiveJobId(job.id)}
                  onDelete={() => deleteJobMutation.mutate(job.id)}
                  onCommit={() => commitMutation.mutate(job.id)}
                  onUndo={() => undoMutation.mutate(job.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Draft review panel */}
        {activeJobId && draftChanges.length > 0 && (() => {
          const activeJob = jobs.find((j) => j.id === activeJobId);
          const isCommitted = activeJob?.status === "committed";
          const acceptedCount = draftChanges.filter((c) => c.status === "accepted").length;
          const pendingCount = draftChanges.filter((c) => c.status === "pending").length;

          return (
            <div className="mt-6">
              {/* Committed banner */}
              {isCommitted && (
                <div className="flex items-center gap-2 mb-4 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700">
                  <CheckCircle size={16} />
                  <span className="font-medium">Imported successfully</span>
                  <span className="text-emerald-600">— {acceptedCount} investments are now on the Roadmap.</span>
                </div>
              )}

              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-[#1A1A18]">
                  Draft Changes ({draftChanges.length})
                </h2>
                <div className="flex gap-2">
                  {!isCommitted && (
                    <>
                      <button
                        onClick={() =>
                          bulkStatusMutation.mutate({ jobId: activeJobId, status: "accepted" })
                        }
                        className="px-3 py-1.5 text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md hover:bg-emerald-100"
                      >
                        Accept All
                      </button>
                      <button
                        onClick={() =>
                          bulkStatusMutation.mutate({ jobId: activeJobId, status: "rejected" })
                        }
                        className="px-3 py-1.5 text-xs font-medium bg-red-50 text-red-700 border border-red-200 rounded-md hover:bg-red-100"
                      >
                        Reject All
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                {draftChanges.map((change) => (
                  <DraftChangeRow
                    key={change.id}
                    change={change}
                    readonly={isCommitted}
                    onAccept={() =>
                      updateDraftMutation.mutate({
                        jobId: activeJobId,
                        changeId: change.id,
                        status: "accepted",
                      })
                    }
                    onReject={() =>
                      updateDraftMutation.mutate({
                        jobId: activeJobId,
                        changeId: change.id,
                        status: "rejected",
                      })
                    }
                  />
                ))}
              </div>

              {/* Commit button — the key action */}
              {!isCommitted && (
                <div className="mt-4 flex items-center gap-3 pt-4 border-t border-[#E5E5E3]">
                  <button
                    onClick={() => commitMutation.mutate(activeJobId)}
                    disabled={acceptedCount === 0 || commitMutation.isPending}
                    className="flex items-center gap-2 px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {commitMutation.isPending ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Send size={14} />
                    )}
                    {commitMutation.isPending
                      ? "Importing…"
                      : `Commit ${acceptedCount} investment${acceptedCount !== 1 ? "s" : ""} to Roadmap`}
                  </button>
                  {pendingCount > 0 && (
                    <span className="text-xs text-[#9CA39A]">{pendingCount} still pending review</span>
                  )}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ─── Spreadsheet Import ───────────────────────────────────────────────────────
function SpreadsheetImport({ onUploaded }: { onUploaded: (jobId: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  async function handleFile(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext || !["csv", "xlsx", "xls"].includes(ext)) {
      setError("Please upload a CSV or Excel file");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const job = await api.uploadImport(file);
      onUploaded(job.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files[0];
          if (file) handleFile(file);
        }}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
          dragOver
            ? "border-amber-400 bg-amber-50"
            : "border-[#E5E5E3] hover:border-amber-300 hover:bg-amber-50/30"
        }`}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        {uploading ? (
          <Loader2 size={32} className="mx-auto text-amber-600 animate-spin" />
        ) : (
          <Upload size={32} className="mx-auto text-[#9CA39A]" />
        )}
        <p className="mt-3 text-sm font-medium text-[#1A1A18]">
          {uploading ? "Uploading..." : "Drop a CSV or Excel file here"}
        </p>
        <p className="text-xs text-[#9CA39A] mt-1">or click to browse</p>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

// ─── Paste Import ─────────────────────────────────────────────────────────────
function PasteImport({ onUploaded }: { onUploaded: (jobId: string) => void }) {
  const [text, setText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState("");

  async function handlePaste() {
    if (!text.trim()) return;
    setParsing(true);
    setError("");
    try {
      const job = await api.pasteImport(text, false);
      onUploaded(job.id);
      setText("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Parse failed");
    } finally {
      setParsing(false);
    }
  }

  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste tab-separated data from a spreadsheet..."
        rows={8}
        className="w-full border border-[#E5E5E3] rounded-lg p-4 text-sm text-[#1A1A18] placeholder-[#9CA39A] resize-y focus:outline-none focus:border-amber-400"
      />
      <div className="flex items-center gap-3 mt-3">
        <button
          onClick={handlePaste}
          disabled={!text.trim() || parsing}
          className="flex items-center gap-2 px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {parsing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {parsing ? "Parsing..." : "Import"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

// ─── Slide Import ─────────────────────────────────────────────────────────────
function SlideImport() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [extraction, setExtraction] = useState<SlideExtraction | null>(null);
  const qc = useQueryClient();
  const showToast = useToastStore((s) => s.show);

  async function handleFile(file: File) {
    setUploading(true);
    setError("");
    try {
      const result = await api.uploadSlide(file);
      setExtraction(result);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Slide import failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleCommit() {
    if (!extraction) return;
    try {
      await api.commitSlide(extraction);
      qc.invalidateQueries({ queryKey: ["rows"] });
      showToast("Slide imported successfully");
      setExtraction(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Commit failed");
    }
  }

  return (
    <div>
      <div
        onClick={() => fileRef.current?.click()}
        className="border-2 border-dashed rounded-xl p-10 text-center cursor-pointer border-[#E5E5E3] hover:border-amber-300 hover:bg-amber-50/30 transition-colors"
      >
        <input
          ref={fileRef}
          type="file"
          accept=".png,.jpg,.jpeg,.webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        {uploading ? (
          <Loader2 size={32} className="mx-auto text-amber-600 animate-spin" />
        ) : (
          <Image size={32} className="mx-auto text-[#9CA39A]" />
        )}
        <p className="mt-3 text-sm font-medium text-[#1A1A18]">
          {uploading ? "Processing slide..." : "Upload a slide screenshot"}
        </p>
        <p className="text-xs text-[#9CA39A] mt-1">PNG, JPG, or WebP</p>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {extraction && (
        <div className="mt-4 border border-[#E5E5E3] rounded-lg p-4">
          <h3 className="text-sm font-semibold text-[#1A1A18]">{extraction.investmentName}</h3>
          <p className="text-xs text-[#6B7068] mt-1">Domain: {extraction.domain}</p>
          {extraction.tactics.length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-[#9CA39A] font-medium">
                {extraction.tactics.length} tactic(s) detected
              </p>
            </div>
          )}
          <button
            onClick={handleCommit}
            className="mt-3 px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700"
          >
            Commit Import
          </button>
        </div>
      )}
    </div>
  );
}

// ─── PDF Import ───────────────────────────────────────────────────────────────
function PdfImport() {
  const [pages, setPages] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<
    Array<{ investmentName: string; tacticsCount: number }>
  >([]);

  return (
    <div>
      <div className="border border-[#E5E5E3] rounded-lg p-6 text-center">
        <FileStack size={32} className="mx-auto text-[#9CA39A]" />
        <p className="mt-3 text-sm font-medium text-[#1A1A18]">PDF Bulk Import</p>
        <p className="text-xs text-[#9CA39A] mt-1">
          Paste the text content of each page below, one per field.
          This uses AI to extract investment data from POR deck pages.
        </p>
        <textarea
          value={pages.join("\n---PAGE BREAK---\n")}
          onChange={(e) => setPages(e.target.value.split("\n---PAGE BREAK---\n"))}
          placeholder="Paste page text here... Use ---PAGE BREAK--- to separate pages"
          rows={10}
          className="mt-4 w-full border border-[#E5E5E3] rounded-lg p-3 text-sm resize-y focus:outline-none focus:border-amber-400"
        />
        <button
          onClick={async () => {
            if (pages.length === 0 || !pages[0].trim()) return;
            setParsing(true);
            setError("");
            try {
              const result = await api.parsePdfSlides(pages);
              setResults(
                result.extractions.map((e) => ({
                  investmentName: e.investmentName,
                  tacticsCount: e.tactics.length,
                })),
              );
            } catch (err: unknown) {
              setError(err instanceof Error ? err.message : "Parse failed");
            } finally {
              setParsing(false);
            }
          }}
          disabled={parsing || pages.length === 0}
          className="mt-3 px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50"
        >
          {parsing ? "Processing..." : "Parse Pages"}
        </button>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        {results.length > 0 && (
          <div className="mt-4 text-left">
            <p className="text-sm font-medium text-[#1A1A18]">
              Found {results.length} investment(s):
            </p>
            <ul className="mt-2 space-y-1">
              {results.map((r, i) => (
                <li key={i} className="text-sm text-[#6B7068]">
                  {r.investmentName} ({r.tacticsCount} tactics)
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Import Job Card ──────────────────────────────────────────────────────────
function ImportJobCard({
  job,
  isActive,
  onSelect,
  onDelete,
  onCommit,
  onUndo,
}: {
  job: ImportJobSummary;
  isActive: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onCommit: () => void;
  onUndo: () => void;
}) {
  const date = new Date(job.createdAt);
  const formatted = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div
      onClick={onSelect}
      className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-colors ${
        isActive
          ? "border-amber-300 bg-amber-50/50"
          : "border-[#E5E5E3] hover:bg-[#FAFAF9]"
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <FileText size={16} className="text-[#9CA39A] shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-[#1A1A18] truncate">{job.fileName}</p>
          <p className="text-xs text-[#9CA39A]">
            {formatted} -- {job.totalChanges} changes ({job.accepted} accepted, {job.rejected}{" "}
            rejected, {job.pending} pending)
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {job.status === "ready_for_review" && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onCommit();
            }}
            className="p-1.5 rounded hover:bg-emerald-50 text-[#9CA39A] hover:text-emerald-600"
            title="Commit"
          >
            <CheckCircle size={14} />
          </button>
        )}
        {job.status === "committed" && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUndo();
            }}
            className="p-1.5 rounded hover:bg-amber-50 text-[#9CA39A] hover:text-amber-600"
            title="Undo"
          >
            <Undo2 size={14} />
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="p-1.5 rounded hover:bg-red-50 text-[#9CA39A] hover:text-red-600"
          title="Delete"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

// ─── Draft Change Row ─────────────────────────────────────────────────────────
function DraftChangeRow({
  change,
  onAccept,
  onReject,
  readonly = false,
}: {
  change: {
    id: string;
    action: string;
    status: string;
    proposed: { investment?: string; strategicPillar?: string; productPriority?: string; domain?: string };
  };
  onAccept: () => void;
  onReject: () => void;
  readonly?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between p-2 rounded-md border ${
        change.status === "accepted"
          ? "border-emerald-200 bg-emerald-50/50"
          : change.status === "rejected"
            ? "border-red-200 bg-red-50/50"
            : "border-[#E5E5E3]"
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span
          className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
            change.action === "create"
              ? "bg-emerald-100 text-emerald-700"
              : "bg-amber-100 text-amber-700"
          }`}
        >
          {change.action}
        </span>
        <span className="text-sm text-[#1A1A18] truncate">
          {change.proposed.investment || "Unknown"}
        </span>
        {change.proposed.domain && (
          <span className="text-xs text-[#9CA39A]">{change.proposed.domain}</span>
        )}
      </div>
      {!readonly && (
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onAccept}
            className={`p-1 rounded ${
              change.status === "accepted"
                ? "bg-emerald-100 text-emerald-700"
                : "hover:bg-emerald-50 text-[#9CA39A] hover:text-emerald-600"
            }`}
            title="Accept"
          >
            <CheckCircle size={14} />
          </button>
          <button
            onClick={onReject}
            className={`p-1 rounded ${
              change.status === "rejected"
                ? "bg-red-100 text-red-700"
                : "hover:bg-red-50 text-[#9CA39A] hover:text-red-600"
            }`}
            title="Reject"
          >
            <XCircle size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
