import { useMemo, useState } from "react";
import { Link, useSearch } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { usePriorities } from "../../hooks/usePriorities";
import { useRows } from "../../hooks/useRows";
import { StatusBadge } from "../ui/StatusBadge";

function statusToDisplay(s: string) {
  if (s === "active") return "In Progress";
  if (s === "paused") return "Paused";
  if (s === "complete") return "Completed";
  return "Not Started";
}

export function PrioritiesPage() {
  const { data: priorities = [], isLoading } = usePriorities();
  const { data: rows = [] } = useRows();
  const search = useSearch({ from: "/priorities/" });

  const [collapsedPillars, setCollapsedPillars] = useState<Set<string>>(
    new Set(),
  );

  const filtered = useMemo(() => {
    let result = priorities;
    if (search.pillar) {
      result = result.filter((p) => p.strategicPillar === search.pillar);
    }
    if (search.status) {
      result = result.filter((p) => p.status === search.status);
    }
    return result;
  }, [priorities, search]);

  const investmentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const row of rows) {
      const key = row.productPriority;
      counts[key] = (counts[key] || 0) + 1;
    }
    return counts;
  }, [rows]);

  const grouped = useMemo(() => {
    const groups = new Map<string, typeof filtered>();
    for (const p of filtered) {
      const pillar = p.strategicPillar || "Uncategorized";
      if (!groups.has(pillar)) groups.set(pillar, []);
      groups.get(pillar)!.push(p);
    }
    return Array.from(groups.entries()).sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
  }, [filtered]);

  const togglePillar = (pillar: string) => {
    setCollapsedPillars((prev) => {
      const next = new Set(prev);
      if (next.has(pillar)) next.delete(pillar);
      else next.add(pillar);
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="p-5 space-y-5">
        <h1 className="text-2xl font-bold text-[#1A1A18] tracking-tight">
          Product Priorities
        </h1>
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="border border-[#E5E5E3] rounded-xl bg-white overflow-hidden">
              <div className="px-4 py-3 bg-[#FAFAF9] border-b border-[#E5E5E3] flex items-center gap-2">
                <div className="h-3 w-32 rounded bg-[#E5E5E3] animate-pulse" />
              </div>
              <div className="divide-y divide-[#E5E5E3]">
                {Array.from({ length: 3 }).map((_, j) => (
                  <div key={j} className="px-4 py-3 flex items-center gap-3">
                    <div className="h-3 flex-1 rounded bg-[#E5E5E3] animate-pulse" />
                    <div className="h-5 w-16 rounded-full bg-[#E5E5E3] animate-pulse" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#1A1A18] tracking-tight">
          Product Priorities
        </h1>
        <button className="flex items-center gap-1.5 px-3 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 transition-colors cursor-pointer border-none">
          <Plus size={14} />
          New Priority
        </button>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3">
        <select
          value={search.pillar ?? ""}
          onChange={() => {}}
          className="px-3 py-1.5 text-sm border border-[#E5E5E3] rounded-lg bg-white text-[#1A1A18] min-w-[160px]"
        >
          <option value="">All Pillars</option>
          {[...new Set(priorities.map((p) => p.strategicPillar).filter(Boolean))]
            .sort()
            .map((p) => (
              <option key={p!} value={p!}>
                {p}
              </option>
            ))}
        </select>
        <select
          value={search.status ?? ""}
          onChange={() => {}}
          className="px-3 py-1.5 text-sm border border-[#E5E5E3] rounded-lg bg-white text-[#1A1A18] min-w-[140px]"
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="complete">Complete</option>
        </select>
        <span className="text-sm text-[#9CA39A]">
          {filtered.length} priorities
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="text-[#6B7068] text-sm py-8 text-center">
          No priorities found. Use the sync feature to populate from taxonomy.
        </p>
      ) : (
        <div className="space-y-4">
          {grouped.map(([pillar, items]) => {
            const isCollapsed = collapsedPillars.has(pillar);
            return (
              <div
                key={pillar}
                className="border border-[#E5E5E3] rounded-xl bg-white overflow-hidden"
              >
                <button
                  onClick={() => togglePillar(pillar)}
                  className="w-full flex items-center gap-2 px-4 py-3 bg-[#FAFAF9] border-b border-[#E5E5E3] cursor-pointer text-left hover:bg-amber-50/50 transition-colors border-none"
                >
                  {isCollapsed ? (
                    <ChevronRight size={14} className="text-[#9CA39A]" />
                  ) : (
                    <ChevronDown size={14} className="text-[#9CA39A]" />
                  )}
                  <span className="text-sm font-semibold text-[#1A1A18]">
                    {pillar}
                  </span>
                  <span className="ml-auto text-xs text-[#9CA39A] bg-white border border-[#E5E5E3] rounded-full px-2 py-0.5">
                    {items.length}
                  </span>
                </button>
                {!isCollapsed && (
                  <div className="divide-y divide-[#E5E5E3]">
                    {items.map((p) => (
                      <Link
                        key={p.id}
                        to="/priorities/$priorityId"
                        params={{ priorityId: p.id }}
                        className="block px-4 py-3 hover:bg-[#FAFAF9] transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <h3 className="text-sm font-semibold text-[#1A1A18] truncate">
                              {p.name}
                            </h3>
                            <StatusBadge status={statusToDisplay(p.status)} />
                          </div>
                          <div className="flex items-center gap-4 text-xs text-[#9CA39A] shrink-0 ml-4">
                            {p.owner && p.owner.length > 0 && (
                              <span>{p.owner.join(", ")}</span>
                            )}
                            <span>
                              {investmentCounts[p.name] ?? 0} investments
                            </span>
                            <span>
                              Updated{" "}
                              {new Date(p.updatedAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        {p.commercialWhy && (
                          <p className="text-xs text-[#6B7068] mt-1 line-clamp-1">
                            {p.commercialWhy}
                          </p>
                        )}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
