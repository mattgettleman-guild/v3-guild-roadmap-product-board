import { useState, useRef, useEffect, useMemo } from "react";
import { useParams, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Sparkles,
  Plus,
  Trash2,
  Loader2,
  Share2,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useRows } from "../../hooks/useRows";
import { useUIStore } from "../../hooks/useUIStore";
import { StatusBadge } from "../ui/StatusBadge";
import type { Priority } from "@roadmap/shared";

// ─── Inline editing primitives ─────────────────────────────────────────────

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

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onSave(draft);
  };

  return (
    <div>
      {label && (
        <label className="text-xs font-medium text-[#9CA39A] uppercase tracking-wide">
          {label}
        </label>
      )}
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
          className={`mt-1 w-full border-b border-amber-400 outline-none bg-transparent text-[#1A1A18] pb-0.5 ${className}`}
        />
      ) : (
        <p
          onClick={() => setEditing(true)}
          className={`mt-1 cursor-text rounded px-1 -mx-1 hover:bg-[#FAFAF9] transition-colors text-[#1A1A18] min-h-[1.5rem] ${className}`}
        >
          {value || (
            <span className="text-[#9CA39A]">Click to edit...</span>
          )}
        </p>
      )}
    </div>
  );
}

function InlineTextArea({
  label,
  value,
  onSave,
  placeholder = "Click to add...",
}: {
  label: string;
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onSave(draft);
  };

  return (
    <div>
      <label className="text-xs font-medium text-[#9CA39A] uppercase tracking-wide">
        {label}
      </label>
      {editing ? (
        <textarea
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          rows={4}
          className="mt-1 w-full border border-[#E5E5E3] rounded p-2 text-sm text-[#1A1A18] resize-none focus:outline-none focus:border-amber-400"
        />
      ) : (
        <p
          onClick={() => setEditing(true)}
          className="mt-1 cursor-text text-sm text-[#1A1A18] whitespace-pre-wrap hover:bg-[#FAFAF9] transition-colors rounded px-1 -mx-1 min-h-[2rem]"
        >
          {value || <span className="text-[#9CA39A]">{placeholder}</span>}
        </p>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function PriorityBriefPage() {
  const { priorityId } = useParams({ from: "/priorities/$priorityId" });
  const qc = useQueryClient();
  const { selectRow } = useUIStore();
  const { data: rows = [] } = useRows();

  const { data: priority, isLoading } = useQuery({
    queryKey: ["priorities-v3", priorityId],
    queryFn: () => api.getPriorityById(priorityId),
  });

  const updateMutation = useMutation({
    mutationFn: (body: Partial<Priority>) =>
      api.updatePriorityById(priorityId, body),
    onSuccess: (updated) => {
      qc.setQueryData(["priorities-v3", priorityId], updated);
      qc.invalidateQueries({ queryKey: ["priorities-v3"] });
    },
  });

  const generateSummaryMutation = useMutation({
    mutationFn: () => api.generatePrioritySummaryV3(priorityId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["priorities-v3", priorityId] });
    },
  });

  const linkedInvestments = useMemo(
    () => rows.filter((r) => r.productPriority === priority?.name),
    [rows, priority?.name],
  );

  const save = (body: Partial<Priority>) => {
    updateMutation.mutate(body);
  };

  if (isLoading || !priority) {
    return (
      <div className="p-8 text-center text-[#9CA39A] text-sm">
        Loading priority...
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-5 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          to="/priorities"
          className="flex items-center gap-1 text-sm text-[#6B7068] hover:text-[#1A1A18] transition-colors"
        >
          <ArrowLeft size={14} />
          Back to Priorities
        </Link>
        <div className="flex-1" />
        <select
          value={priority.status}
          onChange={(e) =>
            save({ status: e.target.value as Priority["status"] })
          }
          className="text-sm border border-[#E5E5E3] rounded px-2 py-1 focus:outline-none focus:border-amber-400"
        >
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="complete">Complete</option>
        </select>
        <select
          value={priority.strategicPillar ?? ""}
          onChange={(e) =>
            save({ strategicPillar: e.target.value || null })
          }
          className="text-sm border border-[#E5E5E3] rounded px-2 py-1 focus:outline-none focus:border-amber-400"
        >
          <option value="">No Pillar</option>
        </select>
        <button className="flex items-center gap-1 px-3 py-1.5 text-sm text-[#6B7068] border border-[#E5E5E3] rounded hover:bg-[#FAFAF9] cursor-pointer bg-white">
          <Share2 size={14} />
          Share
        </button>
      </div>

      {/* Priority Name */}
      <InlineTextField
        label=""
        value={priority.name}
        onSave={(v) => save({ name: v })}
        className="text-2xl font-bold tracking-tight"
      />

      {/* BRIEF Section */}
      <section className="bg-white border border-[#E5E5E3] rounded-xl p-5 space-y-5">
        <h2 className="text-sm font-semibold text-[#1A1A18] uppercase tracking-wide">
          Brief
        </h2>
        <InlineTextArea
          label="Objective"
          value={priority.briefObjective ?? ""}
          onSave={(v) => save({ briefObjective: v })}
          placeholder="What is the objective of this priority?"
        />
        <InlineTextArea
          label="Problem Statement"
          value={priority.problemStatement ?? ""}
          onSave={(v) => save({ problemStatement: v })}
          placeholder="What problem are we solving?"
        />
        <div>
          <div className="flex items-center gap-2 mb-1">
            <label className="text-xs font-medium text-[#9CA39A] uppercase tracking-wide">
              Commercial Why
            </label>
            <button
              onClick={() => {
                /* AI generate - future */
              }}
              className="flex items-center gap-1 text-[10px] text-amber-600 hover:text-amber-700 cursor-pointer bg-transparent border-none"
            >
              <Sparkles size={10} />
              AI generate
            </button>
          </div>
          <InlineTextArea
            label=""
            value={priority.commercialWhy ?? ""}
            onSave={(v) => save({ commercialWhy: v })}
            placeholder="Why is this commercially important?"
          />
        </div>
        <InlineTextArea
          label="Out of Scope"
          value={priority.outOfScope ?? ""}
          onSave={(v) => save({ outOfScope: v })}
          placeholder="What is explicitly out of scope?"
        />
      </section>

      {/* SUCCESS METRICS */}
      <section className="bg-white border border-[#E5E5E3] rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[#1A1A18] uppercase tracking-wide">
            Success Metrics
          </h2>
          <button
            onClick={() => {
              const existing = priority.successMetrics ?? [];
              save({
                successMetrics: [
                  ...existing,
                  {
                    name: "",
                    target: "",
                    unit: "",
                    direction: "increase",
                    baseline: "",
                  },
                ],
              });
            }}
            className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 cursor-pointer bg-transparent border-none"
          >
            <Plus size={12} />
            Add metric
          </button>
        </div>
        {(priority.successMetrics ?? []).length === 0 ? (
          <p className="text-sm text-[#9CA39A]">
            No metrics defined yet. Click &ldquo;Add metric&rdquo; to get
            started.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-[#E5E5E3]">
                <th className="pb-2 text-xs font-medium text-[#9CA39A] uppercase tracking-wide">
                  Metric
                </th>
                <th className="pb-2 text-xs font-medium text-[#9CA39A] uppercase tracking-wide">
                  Target
                </th>
                <th className="pb-2 text-xs font-medium text-[#9CA39A] uppercase tracking-wide">
                  Unit
                </th>
                <th className="pb-2 text-xs font-medium text-[#9CA39A] uppercase tracking-wide">
                  Direction
                </th>
                <th className="pb-2 text-xs font-medium text-[#9CA39A] uppercase tracking-wide">
                  Baseline
                </th>
                <th className="pb-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {(priority.successMetrics ?? []).map((m, i) => (
                <tr key={i} className="border-b border-[#E5E5E3]/50">
                  <td className="py-2 pr-2">
                    <input
                      value={m.name}
                      onChange={(e) => {
                        const updated = [...(priority.successMetrics ?? [])];
                        updated[i] = { ...updated[i], name: e.target.value };
                        save({ successMetrics: updated });
                      }}
                      className="w-full border-none bg-transparent text-sm text-[#1A1A18] outline-none"
                      placeholder="Metric name"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      value={m.target}
                      onChange={(e) => {
                        const updated = [...(priority.successMetrics ?? [])];
                        updated[i] = { ...updated[i], target: e.target.value };
                        save({ successMetrics: updated });
                      }}
                      className="w-full border-none bg-transparent text-sm text-[#1A1A18] outline-none"
                      placeholder="Target"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      value={m.unit}
                      onChange={(e) => {
                        const updated = [...(priority.successMetrics ?? [])];
                        updated[i] = { ...updated[i], unit: e.target.value };
                        save({ successMetrics: updated });
                      }}
                      className="w-full border-none bg-transparent text-sm text-[#1A1A18] outline-none"
                      placeholder="Unit"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <select
                      value={m.direction}
                      onChange={(e) => {
                        const updated = [...(priority.successMetrics ?? [])];
                        updated[i] = {
                          ...updated[i],
                          direction: e.target.value,
                        };
                        save({ successMetrics: updated });
                      }}
                      className="border-none bg-transparent text-sm text-[#1A1A18] outline-none"
                    >
                      <option value="increase">Increase</option>
                      <option value="decrease">Decrease</option>
                      <option value="maintain">Maintain</option>
                    </select>
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      value={m.baseline}
                      onChange={(e) => {
                        const updated = [...(priority.successMetrics ?? [])];
                        updated[i] = {
                          ...updated[i],
                          baseline: e.target.value,
                        };
                        save({ successMetrics: updated });
                      }}
                      className="w-full border-none bg-transparent text-sm text-[#1A1A18] outline-none"
                      placeholder="Baseline"
                    />
                  </td>
                  <td className="py-2">
                    <button
                      onClick={() => {
                        const updated = (priority.successMetrics ?? []).filter(
                          (_, j) => j !== i,
                        );
                        save({ successMetrics: updated });
                      }}
                      className="text-[#9CA39A] hover:text-red-500 cursor-pointer bg-transparent border-none p-1"
                    >
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* STRATEGIC TRANSFORMATIONS */}
      <section className="bg-white border border-[#E5E5E3] rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[#1A1A18] uppercase tracking-wide">
            Strategic Transformations
          </h2>
          <button
            onClick={() => {
              const existing = priority.transformations ?? [];
              save({
                transformations: [
                  ...existing,
                  { from: "", to: "", impact: "" },
                ],
              });
            }}
            className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 cursor-pointer bg-transparent border-none"
          >
            <Plus size={12} />
            Add transformation
          </button>
        </div>
        {(priority.transformations ?? []).length === 0 ? (
          <p className="text-sm text-[#9CA39A]">
            No transformations defined.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-[#E5E5E3]">
                <th className="pb-2 text-xs font-medium text-[#9CA39A] uppercase tracking-wide">
                  From
                </th>
                <th className="pb-2 text-xs font-medium text-[#9CA39A] uppercase tracking-wide">
                  To
                </th>
                <th className="pb-2 text-xs font-medium text-[#9CA39A] uppercase tracking-wide">
                  Impact
                </th>
                <th className="pb-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {(priority.transformations ?? []).map((t, i) => (
                <tr key={i} className="border-b border-[#E5E5E3]/50">
                  <td className="py-2 pr-2">
                    <input
                      value={t.from}
                      onChange={(e) => {
                        const updated = [
                          ...(priority.transformations ?? []),
                        ];
                        updated[i] = { ...updated[i], from: e.target.value };
                        save({ transformations: updated });
                      }}
                      className="w-full border-none bg-transparent text-sm text-[#1A1A18] outline-none"
                      placeholder="From state"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      value={t.to}
                      onChange={(e) => {
                        const updated = [
                          ...(priority.transformations ?? []),
                        ];
                        updated[i] = { ...updated[i], to: e.target.value };
                        save({ transformations: updated });
                      }}
                      className="w-full border-none bg-transparent text-sm text-[#1A1A18] outline-none"
                      placeholder="To state"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      value={t.impact}
                      onChange={(e) => {
                        const updated = [
                          ...(priority.transformations ?? []),
                        ];
                        updated[i] = {
                          ...updated[i],
                          impact: e.target.value,
                        };
                        save({ transformations: updated });
                      }}
                      className="w-full border-none bg-transparent text-sm text-[#1A1A18] outline-none"
                      placeholder="Business impact"
                    />
                  </td>
                  <td className="py-2">
                    <button
                      onClick={() => {
                        const updated = (
                          priority.transformations ?? []
                        ).filter((_, j) => j !== i);
                        save({ transformations: updated });
                      }}
                      className="text-[#9CA39A] hover:text-red-500 cursor-pointer bg-transparent border-none p-1"
                    >
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* INVESTMENTS */}
      <section className="bg-white border border-[#E5E5E3] rounded-xl p-5">
        <h2 className="text-sm font-semibold text-[#1A1A18] uppercase tracking-wide mb-3">
          Investments ({linkedInvestments.length})
        </h2>
        {linkedInvestments.length === 0 ? (
          <p className="text-sm text-[#9CA39A]">
            No investments linked to this priority.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-[#E5E5E3]">
                <th className="pb-2 text-xs font-medium text-[#9CA39A] uppercase tracking-wide">
                  Investment
                </th>
                <th className="pb-2 text-xs font-medium text-[#9CA39A] uppercase tracking-wide">
                  Domain
                </th>
                <th className="pb-2 text-xs font-medium text-[#9CA39A] uppercase tracking-wide">
                  Owner
                </th>
                <th className="pb-2 text-xs font-medium text-[#9CA39A] uppercase tracking-wide">
                  Status
                </th>
                <th className="pb-2 text-xs font-medium text-[#9CA39A] uppercase tracking-wide">
                  Updated
                </th>
              </tr>
            </thead>
            <tbody>
              {linkedInvestments.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => selectRow(row.id)}
                  className="border-b border-[#E5E5E3]/50 cursor-pointer hover:bg-[#FAFAF9] transition-colors"
                >
                  <td className="py-2 pr-2 font-medium text-[#1A1A18]">
                    {row.investment}
                  </td>
                  <td className="py-2 pr-2 text-[#6B7068]">{row.domain}</td>
                  <td className="py-2 pr-2 text-[#6B7068]">{row.owners}</td>
                  <td className="py-2 pr-2">
                    <StatusBadge status={row.status ?? "Not Started"} />
                  </td>
                  <td className="py-2 text-[#9CA39A]">
                    {new Date(row.updatedAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* AI SUMMARY */}
      <section className="bg-white border border-[#E5E5E3] rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[#1A1A18] uppercase tracking-wide">
            AI Summary
          </h2>
          <button
            onClick={() => generateSummaryMutation.mutate()}
            disabled={generateSummaryMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-600 border border-amber-200 bg-amber-50 rounded-lg hover:bg-amber-100 cursor-pointer disabled:opacity-50 transition-colors"
          >
            {generateSummaryMutation.isPending ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Sparkles size={12} />
            )}
            Generate Summary
          </button>
        </div>
        {priority.aiSummary ? (
          <div>
            <p className="text-sm text-[#1A1A18] whitespace-pre-wrap leading-relaxed">
              {priority.aiSummary}
            </p>
            {priority.aiGeneratedAt && (
              <p className="text-[11px] text-[#9CA39A] mt-2">
                Last generated:{" "}
                {new Date(priority.aiGeneratedAt).toLocaleString()}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-[#9CA39A]">
            No summary generated yet. Click the button above to generate an
            AI-powered summary.
          </p>
        )}
      </section>
    </div>
  );
}
