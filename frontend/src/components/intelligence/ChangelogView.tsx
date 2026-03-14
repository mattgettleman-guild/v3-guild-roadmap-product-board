import { useState, useMemo } from "react";
import {
  Filter,
  X,
  Flag,
  AlertTriangle,
  MessageSquare,
  Sparkles,
  FileDown,
  Trash2,
  RotateCcw,
  Loader2,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useTaxonomy } from "../../hooks/useTaxonomy";
import { useUIStore } from "../../hooks/useUIStore";

const CHANGE_TYPE_LABELS: Record<string, string> = {
  status_change: "Status Change",
  date_shift: "Date Shift",
  scope_change: "Scope Change",
  priority_change: "Priority Change",
  new_item: "New Item",
  removed_item: "Removed Item",
  assignment_change: "Assignment Change",
};

const CHANGE_TYPE_COLORS: Record<string, string> = {
  status_change: "bg-amber-100 text-amber-700",
  date_shift: "bg-blue-100 text-blue-700",
  scope_change: "bg-purple-100 text-purple-700",
  priority_change: "bg-emerald-100 text-emerald-700",
  new_item: "bg-green-100 text-green-700",
  removed_item: "bg-red-100 text-red-700",
  assignment_change: "bg-orange-100 text-orange-700",
};

export function ChangelogView() {
  const qc = useQueryClient();
  const { data: taxonomy } = useTaxonomy();
  const { selectRow } = useUIStore();

  const [showFilters, setShowFilters] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [changeType, setChangeType] = useState("");
  const [pillar, setPillar] = useState("");
  const [priority, setPriority] = useState("");
  const [domain, setDomain] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const filters = useMemo(
    () => ({
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      changeType: changeType || undefined,
      strategicPillar: pillar || undefined,
      productPriority: priority || undefined,
      domain: domain || undefined,
      limit: pageSize,
      offset: page * pageSize,
    }),
    [startDate, endDate, changeType, pillar, priority, domain, page],
  );

  const { data, isLoading } = useQuery({
    queryKey: ["changelog", filters],
    queryFn: () => api.listChangelog(filters),
  });

  const events = data?.events ?? [];
  const total = data?.total ?? 0;
  const countsByType = data?.countsByType ?? {};

  const updateNoteMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: { pmNote?: string; gtmActionNeeded?: boolean };
    }) => api.updateChangelogNote(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["changelog"] }),
  });

  const activeFilterCount = [
    startDate,
    endDate,
    changeType,
    pillar,
    priority,
    domain,
  ].filter(Boolean).length;

  return (
    <div className="p-5 space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
            showFilters || activeFilterCount > 0
              ? "bg-amber-50 text-amber-700 border border-amber-300"
              : "text-[#6B7068] border border-[#E5E5E3] bg-white hover:bg-[#FAFAF9]"
          }`}
        >
          <Filter size={12} />
          Filters
          {activeFilterCount > 0 && (
            <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-amber-600 text-white text-[10px] font-bold">
              {activeFilterCount}
            </span>
          )}
        </button>

        {/* Type pills */}
        <div className="flex items-center gap-1.5">
          {Object.entries(countsByType)
            .filter(([_, count]) => count > 0)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([type, count]) => (
              <button
                key={type}
                onClick={() =>
                  setChangeType(changeType === type ? "" : type)
                }
                className={`px-2 py-1 text-[10px] rounded-full font-medium cursor-pointer border-none transition-colors ${
                  changeType === type
                    ? "bg-amber-600 text-white"
                    : CHANGE_TYPE_COLORS[type] || "bg-[#FAFAF9] text-[#6B7068]"
                }`}
              >
                {CHANGE_TYPE_LABELS[type] || type} ({count})
              </button>
            ))}
        </div>

        <div className="flex-1" />
        <span className="text-xs text-[#9CA39A]">{total} events</span>
      </div>

      {/* Filters panel */}
      {showFilters && (
        <div className="bg-[#FAFAF9] border border-[#E5E5E3] rounded-xl p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1 text-[#9CA39A]">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-3 py-1.5 text-sm border border-[#E5E5E3] rounded-lg bg-white text-[#1A1A18]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1 text-[#9CA39A]">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-3 py-1.5 text-sm border border-[#E5E5E3] rounded-lg bg-white text-[#1A1A18]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1 text-[#9CA39A]">
                Pillar
              </label>
              <select
                value={pillar}
                onChange={(e) => setPillar(e.target.value)}
                className="px-3 py-1.5 text-sm border border-[#E5E5E3] rounded-lg bg-white text-[#1A1A18] min-w-[160px]"
              >
                <option value="">All Pillars</option>
                {(taxonomy?.pillars ?? []).map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1 text-[#9CA39A]">
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="px-3 py-1.5 text-sm border border-[#E5E5E3] rounded-lg bg-white text-[#1A1A18] min-w-[160px]"
              >
                <option value="">All Priorities</option>
                {(taxonomy?.priorities ?? []).map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1 text-[#9CA39A]">
                Domain
              </label>
              <select
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                className="px-3 py-1.5 text-sm border border-[#E5E5E3] rounded-lg bg-white text-[#1A1A18] min-w-[160px]"
              >
                <option value="">All Domains</option>
                {(taxonomy?.domains ?? []).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            {activeFilterCount > 0 && (
              <button
                onClick={() => {
                  setStartDate("");
                  setEndDate("");
                  setChangeType("");
                  setPillar("");
                  setPriority("");
                  setDomain("");
                }}
                className="px-3 py-1.5 text-sm font-medium hover:bg-white bg-transparent border border-[#E5E5E3] rounded-lg cursor-pointer transition-colors flex items-center gap-1 text-[#6B7068]"
              >
                <X size={14} />
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* Events list */}
      {isLoading ? (
        <p className="text-sm text-[#9CA39A]">Loading changelog...</p>
      ) : events.length === 0 ? (
        <div className="text-center py-12">
          <MessageSquare size={40} className="mx-auto mb-3 text-[#E5E5E3]" />
          <p className="text-sm text-[#9CA39A]">No changelog events found.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <div
              key={event.id}
              className="bg-white border border-[#E5E5E3] rounded-lg px-4 py-3 hover:shadow-sm transition-shadow"
            >
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${CHANGE_TYPE_COLORS[event.changeType] || "bg-[#FAFAF9] text-[#6B7068]"}`}
                    >
                      {CHANGE_TYPE_LABELS[event.changeType] ||
                        event.changeType}
                    </span>
                    {event.gtmActionNeeded && (
                      <span className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
                        <Flag size={8} />
                        GTM Action
                      </span>
                    )}
                    <span className="text-[10px] text-[#9CA39A]">
                      {event.changedBy} &middot;{" "}
                      {new Date(event.changedAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm text-[#1A1A18]">
                    <span className="font-medium">
                      {event.investmentName || event.entityId}
                    </span>{" "}
                    &mdash; {event.fieldName}:{" "}
                    <span className="text-[#9CA39A] line-through">
                      {String(event.oldValue ?? "empty")}
                    </span>{" "}
                    &rarr;{" "}
                    <span className="font-medium">
                      {String(event.newValue ?? "empty")}
                    </span>
                  </p>
                  {event.pmNote && (
                    <p className="text-xs text-[#6B7068] mt-1 italic">
                      {event.pmNote}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-[#9CA39A]">
                    {event.strategicPillar && (
                      <span>{event.strategicPillar}</span>
                    )}
                    {event.productPriority && (
                      <span>&middot; {event.productPriority}</span>
                    )}
                    {event.domain && <span>&middot; {event.domain}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() =>
                      updateNoteMutation.mutate({
                        id: event.id,
                        data: {
                          gtmActionNeeded: !event.gtmActionNeeded,
                        },
                      })
                    }
                    className={`p-1.5 rounded cursor-pointer bg-transparent border-none transition-colors ${
                      event.gtmActionNeeded
                        ? "text-red-500 hover:bg-red-50"
                        : "text-[#9CA39A] hover:bg-[#FAFAF9]"
                    }`}
                    title="Toggle GTM flag"
                  >
                    <Flag size={12} />
                  </button>
                  {event.investmentId && (
                    <button
                      onClick={() => selectRow(event.investmentId!)}
                      className="p-1.5 rounded text-[#9CA39A] hover:text-amber-600 hover:bg-amber-50 cursor-pointer bg-transparent border-none"
                      title="View investment"
                    >
                      <MessageSquare size={12} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1.5 text-xs border border-[#E5E5E3] rounded-lg bg-white text-[#6B7068] disabled:opacity-40 cursor-pointer"
          >
            Previous
          </button>
          <span className="text-xs text-[#9CA39A]">
            Page {page + 1} of {Math.ceil(total / pageSize)}
          </span>
          <button
            onClick={() =>
              setPage((p) =>
                p < Math.ceil(total / pageSize) - 1 ? p + 1 : p,
              )
            }
            disabled={page >= Math.ceil(total / pageSize) - 1}
            className="px-3 py-1.5 text-xs border border-[#E5E5E3] rounded-lg bg-white text-[#6B7068] disabled:opacity-40 cursor-pointer"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
