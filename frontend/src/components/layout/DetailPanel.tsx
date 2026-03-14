/**
 * DetailPanel — right-side slide-over for viewing/editing investment details.
 * Full field parity: all 15 fields + AI description button + per-tactic AI button.
 */
import { useUIStore } from "../../hooks/useUIStore";
import { useRows, useUpdateRow } from "../../hooks/useRows";
import { useTaxonomy } from "../../hooks/useTaxonomy";
import { useQuery } from "@tanstack/react-query";
import { X, Link2, ExternalLink, Sparkles, Loader2 } from "lucide-react";
import { StatusBadge } from "../ui/StatusBadge";
import { TacticsView } from "../roadmap/TacticsView";
import { JiraLinkModal } from "../roadmap/JiraLinkModal";
import { useState, useRef, useEffect } from "react";
import { api } from "../../lib/api";
import type { RoadmapRow } from "@roadmap/shared";

export function DetailPanel() {
  const { selectedRowId, detailPanelOpen, selectRow } = useUIStore();
  const { data: rows } = useRows();
  const { data: taxonomy } = useTaxonomy();
  const { data: metrics } = useQuery({ queryKey: ["metrics"], queryFn: api.listMetricDefinitions });
  const updateRow = useUpdateRow();
  const row = rows?.find((r) => r.id === selectedRowId);
  const [showJiraModal, setShowJiraModal] = useState(false);
  const [generatingDesc, setGeneratingDesc] = useState(false);

  useEffect(() => {
    setShowJiraModal(false);
  }, [selectedRowId]);

  if (!detailPanelOpen || !row) return null;

  const handleGenerateDescription = async () => {
    setGeneratingDesc(true);
    try {
      const result = await api.generateInvestmentDescription(
        row.investment,
        (row.tactics ?? []).map((t) => ({
          name: t.name,
          description: t.description,
          status: t.status,
          owner: t.owner,
          jiraLinks: t.jiraLinks ?? [],
        })),
        row.jiraLinks ?? [],
      );
      updateRow.mutate({ id: row.id, body: { description: result.description } });
    } finally {
      setGeneratingDesc(false);
    }
  };

  return (
    <>
      <aside className="w-[480px] h-screen border-l border-[#E5E5E3] bg-white flex flex-col shadow-xl overflow-hidden">
        {/* Header */}
        <div className="h-14 flex items-center justify-between px-5 border-b border-[#E5E5E3]">
          <span className="text-sm font-medium text-[#6B7068]">
            Investment Details
          </span>
          <button
            onClick={() => selectRow(null)}
            className="p-1 rounded hover:bg-[#FAFAF9] text-[#9CA39A] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Investment name */}
          <InlineTextField
            label="Investment"
            value={row.investment}
            onSave={(v) => updateRow.mutate({ id: row.id, body: { investment: v } })}
            className="text-lg font-semibold text-[#1A1A18]"
          />

          {/* Status */}
          <FieldWrapper label="Status">
            <StatusSelect
              value={row.status ?? "Not Started"}
              onSave={(v) => updateRow.mutate({ id: row.id, body: { status: v as RoadmapRow["status"] } })}
            />
          </FieldWrapper>

          {/* Description + AI button */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-[#9CA39A] uppercase tracking-wide">Description</label>
              <button
                onClick={handleGenerateDescription}
                disabled={generatingDesc}
                className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 disabled:opacity-50"
                title="Generate with AI"
              >
                {generatingDesc ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                {generatingDesc ? "Generating…" : "AI"}
              </button>
            </div>
            <InlineTextAreaRaw
              value={row.description ?? ""}
              onSave={(v) => updateRow.mutate({ id: row.id, body: { description: v } })}
            />
          </div>

          {/* Strategic Pillar */}
          <FieldWrapper label="Strategic Pillar">
            <SelectField
              value={row.strategicPillar}
              options={taxonomy?.pillars ?? []}
              onSave={(v) => updateRow.mutate({ id: row.id, body: { strategicPillar: v } })}
            />
          </FieldWrapper>

          {/* Product Priority */}
          <FieldWrapper label="Product Priority">
            <SelectField
              value={row.productPriority}
              options={taxonomy?.priorities ?? []}
              onSave={(v) => updateRow.mutate({ id: row.id, body: { productPriority: v } })}
            />
          </FieldWrapper>

          {/* Domain */}
          <InlineTextField
            label="Domain"
            value={row.domain}
            onSave={(v) => updateRow.mutate({ id: row.id, body: { domain: v } })}
          />

          {/* Sub-domain */}
          <FieldWrapper label="Sub-domain">
            <SelectField
              value={row.subDomain ?? ""}
              options={["", ...(taxonomy?.subDomains ?? [])]}
              onSave={(v) => updateRow.mutate({ id: row.id, body: { subDomain: v || undefined } })}
              placeholder="None"
            />
          </FieldWrapper>

          {/* Owner */}
          <InlineTextField
            label="Owner"
            value={row.owners ?? ""}
            onSave={(v) => updateRow.mutate({ id: row.id, body: { owners: v } })}
          />

          {/* Visibility */}
          <FieldWrapper label="Visibility">
            <select
              value={row.visibility ?? "internal_only"}
              onChange={(e) =>
                updateRow.mutate({ id: row.id, body: { visibility: e.target.value as RoadmapRow["visibility"] } })
              }
              className="text-sm border border-[#E5E5E3] rounded px-2 py-1 focus:outline-none focus:border-amber-400"
            >
              <option value="internal_only">Internal Only</option>
              <option value="external_approved">External Approved</option>
            </select>
          </FieldWrapper>

          {/* Timeline */}
          <div>
            <label className="text-xs font-medium text-[#9CA39A] uppercase tracking-wide">Timeline</label>
            <div className="mt-1 flex gap-2">
              <div className="flex-1">
                <label className="text-xs text-[#9CA39A]">Start</label>
                <QuarterInput
                  value={row.timeline?.start ?? ""}
                  onSave={(v) =>
                    updateRow.mutate({
                      id: row.id,
                      body: { timeline: { start: v, end: row.timeline?.end ?? "" } },
                    })
                  }
                />
              </div>
              <div className="flex-1">
                <label className="text-xs text-[#9CA39A]">End</label>
                <QuarterInput
                  value={row.timeline?.end ?? ""}
                  onSave={(v) =>
                    updateRow.mutate({
                      id: row.id,
                      body: { timeline: { start: row.timeline?.start ?? "", end: v } },
                    })
                  }
                />
              </div>
            </div>
          </div>

          {/* Metric */}
          <FieldWrapper label="Metric">
            <select
              value={row.metricId ?? ""}
              onChange={(e) =>
                updateRow.mutate({ id: row.id, body: { metricId: e.target.value || undefined } })
              }
              className="text-sm border border-[#E5E5E3] rounded px-2 py-1 focus:outline-none focus:border-amber-400 w-full"
            >
              <option value="">None</option>
              {(metrics ?? []).map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </FieldWrapper>

          {/* Themes */}
          <TagPickerField
            label="Themes"
            values={row.themes ?? []}
            options={taxonomy?.themes ?? []}
            onSave={(v) => updateRow.mutate({ id: row.id, body: { themes: v } })}
          />

          {/* Tags */}
          <TagPickerField
            label="Tags"
            values={row.tags ?? []}
            options={taxonomy?.tags ?? []}
            onSave={(v) => updateRow.mutate({ id: row.id, body: { tags: v } })}
          />

          {/* Jira Links */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-[#9CA39A] uppercase tracking-wide">
                Jira Links ({row.jiraLinks?.length ?? 0})
              </label>
              <button
                onClick={() => setShowJiraModal(true)}
                className="text-xs text-amber-600 hover:text-amber-700 font-medium flex items-center gap-1"
              >
                <Link2 size={12} />
                Link Jira
              </button>
            </div>
            {row.jiraLinks && row.jiraLinks.length > 0 ? (
              <div className="mt-2 space-y-1">
                {row.jiraLinks.map((link) => (
                  <a
                    key={link.id}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 p-2 rounded-md border border-[#E5E5E3] hover:bg-[#FAFAF9] transition-colors text-sm"
                  >
                    <span className="text-xs font-mono text-amber-600">{link.key}</span>
                    <span className="text-[#1A1A18] truncate flex-1">{link.title}</span>
                    <ExternalLink size={12} className="text-[#9CA39A] shrink-0" />
                  </a>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-sm text-[#9CA39A]">No Jira issues linked</p>
            )}
          </div>

          {/* Tactics */}
          <div>
            <label className="text-xs font-medium text-[#9CA39A] uppercase tracking-wide">
              Tactics ({row.tactics?.length ?? 0})
            </label>
            <div className="mt-2">
              <TacticsView tactics={row.tactics ?? []} />
            </div>
          </div>
        </div>
      </aside>

      {showJiraModal && (
        <JiraLinkModal
          rowId={row.id}
          investmentName={row.investment}
          existingLinks={row.jiraLinks ?? []}
          onClose={() => setShowJiraModal(false)}
        />
      )}
    </>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function FieldWrapper({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-[#9CA39A] uppercase tracking-wide">{label}</label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function SelectField({
  value,
  options,
  onSave,
  placeholder = "Select…",
}: {
  value: string;
  options: string[];
  onSave: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onSave(e.target.value)}
      className="text-sm border border-[#E5E5E3] rounded px-2 py-1 focus:outline-none focus:border-amber-400 w-full"
    >
      {!options.includes("") && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o} value={o}>{o || placeholder}</option>
      ))}
    </select>
  );
}

function QuarterInput({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onSave(draft); }}
      placeholder="Q1 2025"
      className="w-full mt-0.5 text-sm border border-[#E5E5E3] rounded px-2 py-1 focus:outline-none focus:border-amber-400"
    />
  );
}

function TagPickerField({
  label,
  values,
  options,
  onSave,
}: {
  label: string;
  values: string[];
  options: string[];
  onSave: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const toggle = (opt: string) => {
    if (values.includes(opt)) onSave(values.filter((v) => v !== opt));
    else onSave([...values, opt]);
  };

  const addNew = () => {
    const trimmed = input.trim();
    if (trimmed && !values.includes(trimmed)) {
      onSave([...values, trimmed]);
      setInput("");
    }
  };

  const filtered = options.filter((o) => o.toLowerCase().includes(input.toLowerCase()) && !values.includes(o));

  return (
    <div ref={ref} className="relative">
      <label className="text-xs font-medium text-[#9CA39A] uppercase tracking-wide">{label}</label>
      <div
        className="mt-1 min-h-[2rem] border border-[#E5E5E3] rounded px-2 py-1 flex flex-wrap gap-1 cursor-text"
        onClick={() => setOpen(true)}
      >
        {values.map((v) => (
          <span
            key={v}
            className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full flex items-center gap-1"
          >
            {v}
            <button
              onClick={(e) => { e.stopPropagation(); toggle(v); }}
              className="opacity-60 hover:opacity-100"
            >×</button>
          </span>
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); addNew(); }
          }}
          placeholder={values.length === 0 ? `Add ${label.toLowerCase()}…` : ""}
          className="text-xs outline-none bg-transparent flex-1 min-w-[80px]"
        />
      </div>
      {open && (filtered.length > 0 || input.trim()) && (
        <div className="absolute z-50 mt-1 bg-white border border-[#E5E5E3] rounded shadow-lg max-h-40 overflow-y-auto w-full">
          {filtered.map((o) => (
            <button
              key={o}
              onMouseDown={(e) => { e.preventDefault(); toggle(o); }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-[#FAFAF9] text-[#1A1A18]"
            >
              {o}
            </button>
          ))}
          {input.trim() && !options.includes(input.trim()) && (
            <button
              onMouseDown={(e) => { e.preventDefault(); addNew(); }}
              className="w-full text-left px-3 py-1.5 text-sm hover:bg-amber-50 text-amber-600"
            >
              + Add "{input.trim()}"
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function InlineTextField({
  label,
  value,
  onSave,
  className = "",
}: {
  label: string;
  value: string;
  onSave: (v: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);
  useEffect(() => { setDraft(value); }, [value]);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onSave(draft);
  };

  return (
    <div>
      <label className="text-xs font-medium text-[#9CA39A] uppercase tracking-wide">{label}</label>
      {editing ? (
        <input
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          className={`mt-1 w-full border-b border-amber-400 outline-none bg-transparent ${className} text-sm text-[#1A1A18] pb-0.5`}
        />
      ) : (
        <p
          onClick={() => setEditing(true)}
          className={`mt-1 cursor-text rounded px-1 -mx-1 hover:bg-[#FAFAF9] transition-colors ${className} text-sm text-[#1A1A18] min-h-[1.5rem]`}
        >
          {value || <span className="text-[#9CA39A]">Click to edit…</span>}
        </p>
      )}
    </div>
  );
}

function InlineTextAreaRaw({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (editing) ref.current?.focus(); }, [editing]);
  useEffect(() => { setDraft(value); }, [value]);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onSave(draft);
  };

  return editing ? (
    <textarea
      ref={ref}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      rows={4}
      className="w-full border border-[#E5E5E3] rounded p-2 text-sm text-[#1A1A18] resize-none focus:outline-none focus:border-amber-400"
    />
  ) : (
    <p
      onClick={() => setEditing(true)}
      className="cursor-text text-sm text-[#1A1A18] whitespace-pre-wrap hover:bg-[#FAFAF9] transition-colors rounded px-1 -mx-1 min-h-[2rem]"
    >
      {value || <span className="text-[#9CA39A]">Click to add description…</span>}
    </p>
  );
}

const STATUSES = ["Not Started", "In Discovery", "In Progress", "Paused", "Completed"];

function StatusSelect({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onSave(e.target.value)}
      className="text-sm border border-[#E5E5E3] rounded px-2 py-1 focus:outline-none focus:border-amber-400"
    >
      {STATUSES.map((s) => <option key={s}>{s}</option>)}
    </select>
  );
}
