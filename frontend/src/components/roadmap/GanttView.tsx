import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  ChevronRight,
  ChevronDown,
  Filter,
  X,
  ChevronsUpDown,
} from "lucide-react";
import { useSearch } from "@tanstack/react-router";
import { useRows } from "../../hooks/useRows";
import { useTaxonomy } from "../../hooks/useTaxonomy";
import { useUIStore } from "../../hooks/useUIStore";
import type { RoadmapRow } from "@roadmap/shared";

type TimeMode = "month" | "standard_quarter" | "guild_quarter";
type TimeSpan = "1y" | "18m" | "24m";
type GroupByField =
  | "pillar"
  | "priority"
  | "domain"
  | "theme"
  | "owner"
  | null;

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function getStandardQuarters(
  year: number,
): { label: string; start: Date; end: Date }[] {
  return [
    {
      label: `Q1 ${year}`,
      start: new Date(year, 0, 1),
      end: new Date(year, 2, 31),
    },
    {
      label: `Q2 ${year}`,
      start: new Date(year, 3, 1),
      end: new Date(year, 5, 30),
    },
    {
      label: `Q3 ${year}`,
      start: new Date(year, 6, 1),
      end: new Date(year, 8, 30),
    },
    {
      label: `Q4 ${year}`,
      start: new Date(year, 9, 1),
      end: new Date(year, 11, 31),
    },
  ];
}

function getGuildQuarters(
  year: number,
): { label: string; start: Date; end: Date }[] {
  return [
    {
      label: `GQ1 ${year}`,
      start: new Date(year, 1, 1),
      end: new Date(year, 4, 0),
    },
    {
      label: `GQ2 ${year}`,
      start: new Date(year, 4, 1),
      end: new Date(year, 7, 0),
    },
    {
      label: `GQ3 ${year}`,
      start: new Date(year, 7, 1),
      end: new Date(year, 10, 0),
    },
    {
      label: `GQ4 ${year}`,
      start: new Date(year, 10, 1),
      end: new Date(year + 1, 1, 0),
    },
  ];
}

function getMonthPeriods(
  year: number,
): { label: string; start: Date; end: Date }[] {
  return Array.from({ length: 12 }, (_, i) => ({
    label: `${MONTH_NAMES[i]} ${year}`,
    start: new Date(year, i, 1),
    end: new Date(year, i + 1, 0),
  }));
}

function getTimelinePeriods(
  mode: TimeMode,
  year: number,
  span: TimeSpan = "1y",
) {
  const spanEndDate =
    span === "24m"
      ? new Date(year + 1, 11, 31)
      : span === "18m"
        ? new Date(year + 1, 5, 30)
        : new Date(year, 11, 31);

  let periods: { label: string; start: Date; end: Date }[] = [];

  if (mode === "month") {
    periods = getMonthPeriods(year);
    if (span !== "1y") periods = [...periods, ...getMonthPeriods(year + 1)];
  } else if (mode === "guild_quarter") {
    periods = getGuildQuarters(year);
    if (span !== "1y") periods = [...periods, ...getGuildQuarters(year + 1)];
  } else {
    periods = getStandardQuarters(year);
    if (span !== "1y")
      periods = [...periods, ...getStandardQuarters(year + 1)];
  }

  if (span !== "1y") {
    periods = periods.filter((p) => p.start < spanEndDate);
  }

  return periods;
}

function barPosition(
  start: string | undefined,
  end: string | undefined,
  rangeStart: Date,
  rangeEnd: Date,
): { left: string; width: string } | null {
  if (!start || !end) return null;
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T23:59:59");
  const totalMs = rangeEnd.getTime() - rangeStart.getTime();
  if (totalMs <= 0) return null;

  const leftMs = Math.max(0, s.getTime() - rangeStart.getTime());
  const rightMs = Math.min(totalMs, e.getTime() - rangeStart.getTime());
  if (rightMs <= leftMs) return null;

  const left = (leftMs / totalMs) * 100;
  const width = Math.max(1, ((rightMs - leftMs) / totalMs) * 100);
  return { left: `${left}%`, width: `${width}%` };
}

function getRowFieldForGroupBy(
  row: RoadmapRow,
  groupBy: GroupByField,
): string {
  if (groupBy === "pillar") return row.strategicPillar || "";
  if (groupBy === "priority") return row.productPriority || "";
  if (groupBy === "domain") return row.domain || "";
  if (groupBy === "owner") return row.owners || "";
  return "";
}

export function GanttView() {
  const { data: rows = [] } = useRows();
  const { data: taxonomy } = useTaxonomy();
  const search = useSearch({ from: "/roadmap/" });
  const { selectRow } = useUIStore();

  const [timeMode, setTimeMode] = useState<TimeMode>("standard_quarter");
  const [timeSpan, setTimeSpan] = useState<TimeSpan>("1y");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupByField>(
    (search.groupBy as GroupByField) ?? null,
  );
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(
    new Set(),
  );
  const [showTodayLine, setShowTodayLine] = useState(true);
  const [labelColWidth, setLabelColWidth] = useState(280);
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const [filterPillar, setFilterPillar] = useState(search.pillar ?? "");
  const [filterPriority, setFilterPriority] = useState(
    search.priority ?? "",
  );
  const [filterOwner, setFilterOwner] = useState(search.owner ?? "");
  const [filterDomain, setFilterDomain] = useState(search.domain ?? "");
  const [filterStatus, setFilterStatus] = useState(search.status ?? "");

  const activeFilterCount = [
    filterPillar,
    filterPriority,
    filterOwner,
    filterDomain,
    filterStatus,
  ].filter(Boolean).length;

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = labelColWidth;
      dragRef.current = { startX, startWidth };

      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const delta = ev.clientX - dragRef.current.startX;
        setLabelColWidth(
          Math.max(140, Math.min(600, dragRef.current.startWidth + delta)),
        );
      };
      const onUp = () => {
        dragRef.current = null;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [labelColWidth],
  );

  const currentYear = new Date().getFullYear();

  const displayRows = useMemo(() => {
    let result = rows;
    if (filterPillar)
      result = result.filter((r) => r.strategicPillar === filterPillar);
    if (filterPriority)
      result = result.filter((r) => r.productPriority === filterPriority);
    if (filterOwner)
      result = result.filter((r) => (r.owners || "").includes(filterOwner));
    if (filterDomain)
      result = result.filter((r) => r.domain === filterDomain);
    if (filterStatus)
      result = result.filter((r) => r.status === filterStatus);
    return result;
  }, [rows, filterPillar, filterPriority, filterOwner, filterDomain, filterStatus]);

  const sections = useMemo(() => {
    if (!groupBy) return null;
    const groups = new Map<string, RoadmapRow[]>();
    for (const row of displayRows) {
      const val = getRowFieldForGroupBy(row, groupBy) || "Uncategorized";
      if (!groups.has(val)) groups.set(val, []);
      groups.get(val)!.push(row);
    }
    return Array.from(groups.entries()).map(([label, rows]) => ({
      label,
      rows,
    }));
  }, [displayRows, groupBy]);

  const periods = getTimelinePeriods(timeMode, currentYear, timeSpan);
  const rangeStart = periods[0].start;
  const rangeEnd = periods[periods.length - 1].end;

  const todayPct = useMemo(() => {
    const now = new Date();
    const totalMs = rangeEnd.getTime() - rangeStart.getTime();
    if (totalMs <= 0) return null;
    const elapsed = now.getTime() - rangeStart.getTime();
    if (elapsed < 0 || elapsed > totalMs) return null;
    return (elapsed / totalMs) * 100;
  }, [rangeStart, rangeEnd]);

  useEffect(() => {
    if (todayPct === null || !scrollContainerRef.current) return;
    const container = scrollContainerRef.current;
    requestAnimationFrame(() => {
      const chartWidth = container.scrollWidth - labelColWidth;
      const todayX = labelColWidth + (todayPct / 100) * chartWidth;
      container.scrollLeft = Math.max(0, todayX - container.clientWidth / 2);
    });
  }, [todayPct, labelColWidth]);

  const needsScroll = timeMode === "month" && timeSpan !== "1y";
  const chartMinWidth = needsScroll ? periods.length * 80 : 0;
  const gridStyle = {
    gridTemplateColumns: `${labelColWidth}px minmax(${chartMinWidth}px, 1fr)`,
  };

  function toggleExpand(rowId: string) {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  function clearFilters() {
    setFilterPillar("");
    setFilterPriority("");
    setFilterOwner("");
    setFilterDomain("");
    setFilterStatus("");
  }

  function renderRow(row: RoadmapRow) {
    const isExpanded = expandedRows.has(row.id);
    const hasTactics = row.tactics.length > 0;
    // Only use explicit timeline dates for bar display
    const pos = barPosition(
      row.timeline?.start,
      row.timeline?.end,
      rangeStart,
      rangeEnd,
    );

    return (
      <div key={row.id}>
        <div
          className="grid border-b border-[#E5E5E3] hover:bg-[#FAFAF9] transition-colors"
          style={gridStyle}
        >
          <div
            className="px-4 py-3 flex items-center gap-2 cursor-pointer"
            onClick={() => selectRow(row.id)}
          >
            {hasTactics ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleExpand(row.id);
                }}
                aria-label={isExpanded ? "Collapse row" : "Expand row"}
                className="w-5 h-5 flex items-center justify-center rounded hover:bg-black/5 transition-colors cursor-pointer border-none bg-transparent p-0 text-[#9CA39A] shrink-0"
              >
                {isExpanded ? (
                  <ChevronDown size={14} />
                ) : (
                  <ChevronRight size={14} />
                )}
              </button>
            ) : (
              <span className="w-5 shrink-0" />
            )}
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[#1A1A18] truncate">
                {row.investment}
              </div>
              <div className="text-[11px] text-[#9CA39A] truncate">
                {row.owners || "Unassigned"}
                {row.strategicPillar ? ` \u00b7 ${row.strategicPillar}` : ""}
              </div>
            </div>
          </div>
          <div
            className="relative border-l border-[#E5E5E3] cursor-pointer"
            onClick={() => selectRow(row.id)}
          >
            <div className="absolute inset-0 flex">
              {periods.map((_, i) => (
                <div
                  key={i}
                  className="flex-1 border-r border-[#E5E5E3]/50 last:border-r-0"
                />
              ))}
            </div>
            {showTodayLine && todayPct !== null && (
              <div
                className="absolute top-0 bottom-0 z-0 pointer-events-none"
                style={{ left: `${todayPct}%` }}
              >
                <div className="absolute top-0 bottom-0 w-px bg-red-400 opacity-30" />
              </div>
            )}
            {pos && (
              <div
                className="absolute top-2 h-[calc(100%-16px)] rounded-md bg-gradient-to-r from-amber-600 to-amber-400 opacity-90 min-w-[4px] cursor-pointer hover:opacity-100 transition-opacity"
                style={{ left: pos.left, width: pos.width }}
                title={`${row.timeline?.start} \u2013 ${row.timeline?.end}`}
              >
                <div className="absolute inset-0 flex items-center px-2">
                  <span className="text-[10px] font-semibold text-white truncate">
                    {row.timeline?.start && row.timeline?.end
                      ? `${new Date(row.timeline.start + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} \u2013 ${new Date(row.timeline.end + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                      : ""}
                  </span>
                </div>
              </div>
            )}
            {!pos && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[10px] text-[#9CA39A]">
                  No timeline set
                </span>
              </div>
            )}
          </div>
        </div>

        {isExpanded &&
          hasTactics &&
          row.tactics.map((tactic) => {
            // Only show tactic bars if the tactic itself has explicit timeline dates
            const tPos = barPosition(
              tactic.timeline?.start,
              tactic.timeline?.end,
              rangeStart,
              rangeEnd,
            );

            return (
              <div
                key={tactic.id}
                className="grid border-b border-[#E5E5E3]/50 cursor-pointer hover:bg-[#FAFAF9]"
                style={{
                  ...gridStyle,
                  background: "rgba(250, 250, 249, 0.5)",
                }}
                onClick={() => selectRow(row.id)}
              >
                <div className="px-4 py-2 flex items-center gap-2 pl-12">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-[#1A1A18] truncate flex items-center gap-1.5">
                      {tactic.name}
                      {tactic.deliveryConfidence && (
                        <span
                          className={`inline-block px-1.5 py-0 text-[9px] font-semibold uppercase rounded-full border ${
                            tactic.deliveryConfidence === "high"
                              ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                              : tactic.deliveryConfidence === "medium"
                                ? "bg-amber-100 text-amber-700 border-amber-200"
                                : "bg-red-100 text-red-700 border-red-200"
                          }`}
                        >
                          {tactic.deliveryConfidence}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-[#9CA39A]">
                      {tactic.owner || ""}
                    </div>
                  </div>
                </div>
                <div className="relative border-l border-[#E5E5E3]">
                  <div className="absolute inset-0 flex">
                    {periods.map((_, i) => (
                      <div
                        key={i}
                        className="flex-1 border-r border-[#E5E5E3]/50 last:border-r-0"
                      />
                    ))}
                  </div>
                  {showTodayLine && todayPct !== null && (
                    <div
                      className="absolute top-0 bottom-0 z-0 pointer-events-none"
                      style={{ left: `${todayPct}%` }}
                    >
                      <div className="absolute top-0 bottom-0 w-px bg-red-400 opacity-30" />
                    </div>
                  )}
                  {tPos && (
                    <div
                      className="absolute top-1.5 h-[calc(100%-12px)] rounded-sm bg-gradient-to-r from-[#6B7068] to-[#9CA39A] opacity-75 min-w-[4px]"
                      style={{ left: tPos.left, width: tPos.width }}
                      title={`${tactic.timeline?.start} \u2013 ${tactic.timeline?.end}`}
                    >
                      <div className="absolute inset-0 flex items-center px-1.5 overflow-hidden">
                        <span className="text-[9px] font-semibold text-white truncate whitespace-nowrap">
                          {tactic.timeline?.start && tactic.timeline?.end
                            ? `${new Date(tactic.timeline.start + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} \u2013 ${new Date(tactic.timeline.end + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
                            : ""}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 h-full p-5 pt-2">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              showFilters || activeFilterCount > 0
                ? "border-amber-300 bg-amber-50 text-amber-700"
                : "hover:bg-[#FAFAF9]"
            }`}
            style={{
              color:
                showFilters || activeFilterCount > 0 ? undefined : "#6B7068",
              border:
                showFilters || activeFilterCount > 0
                  ? "1px solid #fcd34d"
                  : "1px solid #E5E5E3",
            }}
          >
            <Filter size={14} />
            Filters
            {activeFilterCount > 0 && (
              <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-amber-600 text-white text-[10px] font-bold">
                {activeFilterCount}
              </span>
            )}
          </button>
          <span
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: "#9CA39A" }}
          >
            Group by:
          </span>
          <div
            className="flex rounded-lg border border-[#E5E5E3]"
            style={{ overflow: "visible" }}
          >
            {(
              [
                { id: null, label: "None" },
                { id: "pillar", label: "Pillar" },
                { id: "priority", label: "Priority" },
                { id: "domain", label: "Domain" },
                { id: "owner", label: "Owner" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.label}
                onClick={() => setGroupBy(opt.id as GroupByField)}
                className="px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors border-none whitespace-nowrap"
                style={{
                  backgroundColor:
                    groupBy === opt.id ? "#d97706" : "white",
                  color: groupBy === opt.id ? "white" : "#9CA39A",
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {groupBy && sections && (
            <button
              onClick={() => {
                const allCollapsed = sections.every((s) =>
                  collapsedSections.has(s.label),
                );
                setCollapsedSections((prev) => {
                  const next = new Set(prev);
                  if (allCollapsed) {
                    sections.forEach((s) => next.delete(s.label));
                  } else {
                    sections.forEach((s) => next.add(s.label));
                  }
                  return next;
                });
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-[#FAFAF9] cursor-pointer"
              style={{
                color: "#6B7068",
                border: "1px solid #E5E5E3",
                background: "white",
              }}
            >
              <ChevronsUpDown size={14} />
              {sections.every((s) => collapsedSections.has(s.label))
                ? "Expand Groups"
                : "Collapse Groups"}
            </button>
          )}
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <div
              onClick={() => setShowTodayLine((v) => !v)}
              className={`relative w-8 h-[18px] rounded-full transition-colors cursor-pointer ${showTodayLine ? "bg-red-400" : "bg-[#9CA39A]"}`}
            >
              <div
                className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform ${showTodayLine ? "left-[16px]" : "left-[2px]"}`}
              />
            </div>
            <span className="text-xs text-[#9CA39A]">Today</span>
          </label>
          <div className="flex rounded-lg border border-[#E5E5E3] overflow-hidden">
            {(
              [
                { id: "1y" as TimeSpan, label: "1 Year" },
                { id: "18m" as TimeSpan, label: "18 Mo" },
                { id: "24m" as TimeSpan, label: "24 Mo" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                onClick={() => setTimeSpan(opt.id)}
                className={`px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors border-none ${
                  timeSpan === opt.id
                    ? "bg-amber-600 text-white"
                    : "bg-white text-[#1A1A18] hover:bg-[#FAFAF9]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="flex rounded-lg border border-[#E5E5E3] overflow-hidden">
            <button
              onClick={() => setTimeMode("month")}
              className={`px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors border-none ${
                timeMode === "month"
                  ? "bg-amber-600 text-white"
                  : "bg-white text-[#1A1A18] hover:bg-[#FAFAF9]"
              }`}
            >
              Monthly
            </button>
            <button
              onClick={() => setTimeMode("standard_quarter")}
              className={`px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors border-none ${
                timeMode === "standard_quarter"
                  ? "bg-amber-600 text-white"
                  : "bg-white text-[#1A1A18] hover:bg-[#FAFAF9]"
              }`}
            >
              Quarters
            </button>
            <button
              onClick={() => setTimeMode("guild_quarter")}
              className={`px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors border-none ${
                timeMode === "guild_quarter"
                  ? "bg-amber-600 text-white"
                  : "bg-white text-[#1A1A18] hover:bg-[#FAFAF9]"
              }`}
            >
              Guild Quarters
            </button>
          </div>
        </div>
      </div>

      {showFilters && (
        <div className="bg-[#FAFAF9] border border-[#E5E5E3] rounded-xl p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1 text-[#9CA39A]">
                Strategic Pillar
              </label>
              <select
                value={filterPillar}
                onChange={(e) => setFilterPillar(e.target.value)}
                className="px-3 py-1.5 text-sm border border-[#E5E5E3] rounded-lg bg-white min-w-[160px] text-[#1A1A18]"
              >
                <option value="">All Strategic Pillars</option>
                {(taxonomy?.pillars ?? []).map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1 text-[#9CA39A]">
                Product Priority
              </label>
              <select
                value={filterPriority}
                onChange={(e) => setFilterPriority(e.target.value)}
                className="px-3 py-1.5 text-sm border border-[#E5E5E3] rounded-lg bg-white min-w-[160px] text-[#1A1A18]"
              >
                <option value="">All Product Priorities</option>
                {(taxonomy?.priorities ?? []).map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1 text-[#9CA39A]">
                Owner
              </label>
              <select
                value={filterOwner}
                onChange={(e) => setFilterOwner(e.target.value)}
                className="px-3 py-1.5 text-sm border border-[#E5E5E3] rounded-lg bg-white min-w-[160px] text-[#1A1A18]"
              >
                <option value="">All Owners</option>
                {[
                  ...new Set(
                    rows.map((r) => r.owners).filter(Boolean),
                  ),
                ]
                  .sort()
                  .map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wide mb-1 text-[#9CA39A]">
                Domain
              </label>
              <select
                value={filterDomain}
                onChange={(e) => setFilterDomain(e.target.value)}
                className="px-3 py-1.5 text-sm border border-[#E5E5E3] rounded-lg bg-white min-w-[160px] text-[#1A1A18]"
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
                onClick={clearFilters}
                aria-label="Clear all filters"
                className="px-3 py-1.5 text-sm font-medium hover:bg-[#FAFAF9] bg-transparent border border-[#E5E5E3] rounded-lg cursor-pointer transition-colors flex items-center gap-1 text-[#6B7068]"
              >
                <X size={14} />
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      <div
        ref={scrollContainerRef}
        className="bg-white border border-[#E5E5E3] rounded-xl shadow-sm overflow-auto flex-1"
      >
        <div
          className="grid border-b border-[#E5E5E3] bg-[#FAFAF9] sticky top-0 z-20"
          style={gridStyle}
        >
          <div className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[#9CA39A] sticky left-0 bg-[#FAFAF9] z-10 relative">
            Investment
            <div
              onMouseDown={onResizeStart}
              className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize z-20 hover:bg-amber-400/40 transition-colors"
              style={{ borderRight: "2px solid transparent" }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.borderRight =
                  "2px solid #d97706";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.borderRight =
                  "2px solid transparent";
              }}
            />
          </div>
          <div className="relative flex border-l border-[#E5E5E3]">
            {periods.map((period) => (
              <div
                key={period.label}
                className="flex-1 px-2 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-[#9CA39A] border-r border-[#E5E5E3]/50 last:border-r-0"
                style={
                  timeMode === "month" && timeSpan !== "1y"
                    ? { minWidth: 80 }
                    : undefined
                }
              >
                {period.label}
              </div>
            ))}
            {showTodayLine && todayPct !== null && (
              <div
                className="absolute top-0 bottom-0 z-10 pointer-events-none"
                style={{ left: `${todayPct}%` }}
              >
                <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 bg-red-400 text-white text-[8px] font-bold px-1 py-0 rounded-b leading-tight opacity-70">
                  TODAY
                </div>
                <div className="absolute top-0 bottom-0 w-px bg-red-400 opacity-30" />
              </div>
            )}
          </div>
        </div>

        <div>
          {displayRows.length === 0 && (
            <div className="py-12 text-center text-sm text-[#9CA39A]">
              No investments match the current filters.
            </div>
          )}
          {sections
            ? sections.map((section) => {
                const isCollapsed = collapsedSections.has(section.label);
                return (
                  <div key={section.label}>
                    <div
                      className="grid border-b border-[#E5E5E3] cursor-pointer select-none bg-amber-50/70 hover:bg-amber-100 transition-colors"
                      style={gridStyle}
                      onClick={() => {
                        setCollapsedSections((prev) => {
                          const next = new Set(prev);
                          if (next.has(section.label))
                            next.delete(section.label);
                          else next.add(section.label);
                          return next;
                        });
                      }}
                    >
                      <div className="flex items-center gap-2 px-4 py-2.5">
                        <button
                          aria-label={
                            isCollapsed
                              ? `Expand group ${section.label}`
                              : `Collapse group ${section.label}`
                          }
                          className="w-5 h-5 flex items-center justify-center rounded hover:bg-black/5 transition-colors cursor-pointer border-none bg-transparent p-0 text-amber-700"
                        >
                          {isCollapsed ? (
                            <ChevronRight size={14} />
                          ) : (
                            <ChevronDown size={14} />
                          )}
                        </button>
                        <span className="text-sm font-semibold text-amber-800">
                          {section.label}
                        </span>
                        <span className="inline-flex items-center justify-center min-w-[22px] h-[22px] rounded-full bg-amber-200 text-amber-800 text-xs font-semibold">
                          {section.rows.length}
                        </span>
                      </div>
                      <div className="relative border-l border-[#E5E5E3]">
                        <div className="absolute inset-0 flex">
                          {periods.map((_, i) => (
                            <div
                              key={i}
                              className="flex-1 border-r border-[#E5E5E3]/50 last:border-r-0"
                            />
                          ))}
                        </div>
                        {showTodayLine && todayPct !== null && (
                          <div
                            className="absolute top-0 bottom-0 z-0 pointer-events-none"
                            style={{ left: `${todayPct}%` }}
                          >
                            <div className="absolute top-0 bottom-0 w-px bg-red-400 opacity-30" />
                          </div>
                        )}
                      </div>
                    </div>
                    {!isCollapsed &&
                      section.rows.map((row) => renderRow(row))}
                  </div>
                );
              })
            : displayRows.map((row) => renderRow(row))}
        </div>
      </div>
    </div>
  );
}
