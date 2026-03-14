/**
 * GridView — data table for roadmap investments with TanStack Virtual,
 * column toggle (persisted to localStorage), and groupBy support.
 */
import { useRows, useUpdateRow } from "../../hooks/useRows";
import { useUIStore } from "../../hooks/useUIStore";
import { useSearch } from "@tanstack/react-router";
import { StatusBadge } from "../ui/StatusBadge";
import { getDomainColor } from "../ui/tokens";
import { useState, useRef, useCallback, useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight, Columns3 } from "lucide-react";
import type { RoadmapRow } from "@roadmap/shared";

// ── Column definitions ─────────────────────────────────────────────────────

interface ColDef {
  key: string;
  label: string;
  width: number;
  optional?: boolean;
}

const ALL_COLUMNS: ColDef[] = [
  { key: "investment", label: "Investment", width: 280 },
  { key: "domain", label: "Domain", width: 140 },
  { key: "status", label: "Status", width: 130 },
  { key: "productPriority", label: "Priority", width: 160, optional: true },
  { key: "strategicPillar", label: "Pillar", width: 160, optional: true },
  { key: "owners", label: "Owner", width: 140, optional: true },
  { key: "timeline", label: "Timeline", width: 160, optional: true },
  { key: "themes", label: "Themes", width: 160, optional: true },
  { key: "tags", label: "Tags", width: 160, optional: true },
  { key: "tactics", label: "Tactics", width: 80, optional: true },
  { key: "jira", label: "Jira", width: 70, optional: true },
  { key: "visibility", label: "Visibility", width: 130, optional: true },
  { key: "subDomain", label: "Sub-domain", width: 140, optional: true },
];

const STORAGE_KEY = "roadmap-columns-v3";

function loadVisibleColumns(): Set<string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return new Set(JSON.parse(stored));
  } catch {}
  // Default: show first 6 columns
  return new Set(ALL_COLUMNS.filter((c) => !c.optional).map((c) => c.key).concat(["owners", "productPriority", "strategicPillar"]));
}

function saveVisibleColumns(cols: Set<string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...cols]));
}

const ROW_HEIGHT = 40;

// ── Main component ─────────────────────────────────────────────────────────

export function GridView() {
  const { data: rows = [], isLoading } = useRows();
  const search = useSearch({ from: "/roadmap/" });
  const { selectRow } = useUIStore();
  const updateRow = useUpdateRow();
  const [visibleCols, setVisibleCols] = useState<Set<string>>(loadVisibleColumns);
  const [showColToggle, setShowColToggle] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const colToggleRef = useRef<HTMLDivElement>(null);

  // Close column toggle on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (colToggleRef.current && !colToggleRef.current.contains(e.target as Node)) {
        setShowColToggle(false);
      }
    }
    if (showColToggle) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showColToggle]);

  const toggleCol = (key: string) => {
    const next = new Set(visibleCols);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    saveVisibleColumns(next);
    setVisibleCols(next);
  };

  const columns = ALL_COLUMNS.filter((c) => !c.optional || visibleCols.has(c.key));
  const hiddenCount = ALL_COLUMNS.filter((c) => c.optional && !visibleCols.has(c.key)).length;

  const filtered = rows.filter((r) => {
    if (search.pillar && r.strategicPillar !== search.pillar) return false;
    if (search.priority && r.productPriority !== search.priority) return false;
    if (search.domain && r.domain !== search.domain) return false;
    if (search.status && r.status !== search.status) return false;
    if (search.owner && r.owners !== search.owner) return false;
    return true;
  });

  // GroupBy logic
  const groupBy = search.groupBy as string | undefined;

  const getGroupKey = useCallback((row: RoadmapRow): string => {
    if (!groupBy) return "";
    if (groupBy === "pillar") return row.strategicPillar || "—";
    if (groupBy === "priority") return row.productPriority || "—";
    if (groupBy === "domain") return row.domain || "—";
    return "";
  }, [groupBy]);

  // Build groups or flat list
  const groups: Array<{ key: string; rows: RoadmapRow[] }> = [];
  if (groupBy) {
    const map = new Map<string, RoadmapRow[]>();
    for (const row of filtered) {
      const k = getGroupKey(row);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(row);
    }
    map.forEach((rows, key) => groups.push({ key, rows }));
    groups.sort((a, b) => a.key.localeCompare(b.key));
  }

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Virtual scrolling for flat mode
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  const tableHeader = (
    <table className="w-full border-collapse text-sm" style={{ tableLayout: "fixed" }}>
      <thead>
        <tr className="h-9 bg-[#FAFAF9] border-b border-[#E5E5E3]">
          {columns.map((col) => (
            <th
              key={col.key}
              style={{ width: col.width, minWidth: col.width }}
              className="text-left px-3 text-xs font-medium text-[#9CA39A] uppercase tracking-wide"
            >
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
    </table>
  );

  if (isLoading) {
    return (
      <div className="overflow-x-auto">
        {tableHeader}
        <table className="w-full border-collapse text-sm" style={{ tableLayout: "fixed" }}>
          <tbody>
            {Array.from({ length: 8 }).map((_, i) => (
              <tr key={i} className="h-10 border-b border-[#E5E5E3]">
                {columns.map((col) => (
                  <td key={col.key} className="px-3" style={{ width: col.width, minWidth: col.width }}>
                    <div className="h-3 rounded bg-[#E5E5E3] animate-pulse" style={{ width: col.key === "investment" ? "75%" : "60%" }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto flex flex-col">
      {/* Column toggle button row */}
      <div className="flex items-center justify-end px-3 py-1.5 border-b border-[#E5E5E3] bg-white gap-2">
        <div className="relative" ref={colToggleRef}>
          <button
            onClick={() => setShowColToggle((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-[#6B7068] hover:text-[#1A1A18] border border-[#E5E5E3] rounded px-2 py-1 hover:bg-[#FAFAF9] transition-colors"
          >
            <Columns3 size={13} />
            Columns
            {hiddenCount > 0 && (
              <span className="ml-0.5 bg-amber-100 text-amber-700 rounded-full px-1.5 text-[10px] font-medium">
                {hiddenCount} hidden
              </span>
            )}
          </button>
          {showColToggle && (
            <div className="absolute right-0 top-8 z-50 bg-white border border-[#E5E5E3] rounded-lg shadow-lg p-3 w-52">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-[#6B7068]">Toggle columns</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const next = new Set(ALL_COLUMNS.map((c) => c.key));
                      saveVisibleColumns(next);
                      setVisibleCols(next);
                    }}
                    className="text-[10px] text-amber-600 hover:text-amber-700"
                  >
                    Show all
                  </button>
                  <button
                    onClick={() => {
                      const next = new Set(ALL_COLUMNS.filter((c) => !c.optional).map((c) => c.key));
                      saveVisibleColumns(next);
                      setVisibleCols(next);
                    }}
                    className="text-[10px] text-[#9CA39A] hover:text-[#6B7068]"
                  >
                    Reset
                  </button>
                </div>
              </div>
              {ALL_COLUMNS.filter((c) => c.optional).map((col) => (
                <label key={col.key} className="flex items-center gap-2 py-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={visibleCols.has(col.key)}
                    onChange={() => toggleCol(col.key)}
                    className="accent-amber-500"
                  />
                  <span className="text-sm text-[#1A1A18]">{col.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Fixed header */}
      {tableHeader}

      {/* Grouped mode */}
      {groupBy ? (
        <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 240px)" }}>
          {groups.map((group) => {
            const isCollapsed = collapsed.has(group.key);
            return (
              <div key={group.key}>
                {/* Group header */}
                <div
                  className="flex items-center gap-2 px-3 py-2 bg-[#FAFAF9] border-b border-[#E5E5E3] cursor-pointer hover:bg-[#F0F0EE] transition-colors"
                  onClick={() => toggleGroup(group.key)}
                >
                  {isCollapsed ? <ChevronRight size={14} className="text-[#9CA39A]" /> : <ChevronDown size={14} className="text-[#9CA39A]" />}
                  <span className="text-sm font-medium text-[#1A1A18]">{group.key}</span>
                  <span className="text-xs text-[#9CA39A]">({group.rows.length})</span>
                </div>
                {/* Group rows */}
                {!isCollapsed && group.rows.map((row) => (
                  <GridRow
                    key={row.id}
                    row={row}
                    columns={columns}
                    onSelect={() => selectRow(row.id)}
                    onUpdate={(body) => updateRow.mutate({ id: row.id, body })}
                  />
                ))}
              </div>
            );
          })}
          {groups.length === 0 && (
            <div className="py-16 text-center">
              <p className="text-sm font-medium text-[#6B7068]">No investments match the active filters</p>
            </div>
          )}
        </div>
      ) : (
        /* Flat virtual scroll mode */
        <div ref={parentRef} className="overflow-auto" style={{ maxHeight: "calc(100vh - 240px)" }}>
          <div style={{ height: `${virtualizer.getTotalSize()}px`, width: "100%", position: "relative" }}>
            {filtered.length === 0 ? (
              <div className="py-16 text-center">
                <p className="text-sm font-medium text-[#6B7068]">No investments match the active filters</p>
                <p className="text-xs text-[#9CA39A] mt-1">Try clearing a filter from the toolbar above</p>
              </div>
            ) : (
              virtualizer.getVirtualItems().map((virtualRow) => {
                const row = filtered[virtualRow.index];
                return (
                  <div
                    key={row.id}
                    style={{ position: "absolute", top: 0, left: 0, width: "100%", height: `${virtualRow.size}px`, transform: `translateY(${virtualRow.start}px)` }}
                  >
                    <GridRow
                      row={row}
                      columns={columns}
                      onSelect={() => selectRow(row.id)}
                      onUpdate={(body) => updateRow.mutate({ id: row.id, body })}
                    />
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="px-3 py-2 border-t border-[#E5E5E3] text-xs text-[#9CA39A]">
        {filtered.length} investment{filtered.length !== 1 ? "s" : ""}
        {filtered.length !== rows.length && ` (${rows.length} total)`}
      </div>
    </div>
  );
}

// ── Row component ──────────────────────────────────────────────────────────

function GridRow({
  row,
  columns,
  onSelect,
  onUpdate,
}: {
  row: RoadmapRow;
  columns: ColDef[];
  onSelect: () => void;
  onUpdate: (b: Partial<RoadmapRow>) => void;
}) {
  const domainColor = getDomainColor(row.domain);
  const [editingCell, setEditingCell] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const startEdit = (cell: string, value: string) => {
    setEditingCell(cell);
    setDraft(value);
  };

  const commitEdit = () => {
    if (editingCell === "investment" && draft !== row.investment) onUpdate({ investment: draft });
    if (editingCell === "domain" && draft !== row.domain) onUpdate({ domain: draft });
    setEditingCell(null);
  };

  const timelineText = row.timeline
    ? `${row.timeline.start || ""}${row.timeline.end ? ` – ${row.timeline.end}` : ""}`
    : "";

  const renderCell = (col: ColDef) => {
    switch (col.key) {
      case "investment":
        return (
          <td
            className="px-3"
            style={{ width: col.width, minWidth: col.width, borderLeft: `3px solid ${domainColor}` }}
          >
            {editingCell === "investment" ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); e.stopPropagation(); }}
                onClick={(e) => e.stopPropagation()}
                className="w-full outline-none bg-transparent border-b border-amber-400 text-[#1A1A18]"
              />
            ) : (
              <span
                className="font-medium text-[#1A1A18] block truncate"
                onDoubleClick={(e) => { e.stopPropagation(); startEdit("investment", row.investment); }}
              >
                {row.investment}
              </span>
            )}
          </td>
        );
      case "domain":
        return (
          <td className="px-3 text-[#6B7068]" style={{ width: col.width, minWidth: col.width }}>
            <span>{row.domain}</span>
          </td>
        );
      case "status":
        return (
          <td className="px-3" style={{ width: col.width, minWidth: col.width }}>
            <StatusBadge status={row.status ?? "Not Started"} />
          </td>
        );
      case "productPriority":
        return (
          <td className="px-3 text-[#6B7068] truncate" style={{ width: col.width, minWidth: col.width, maxWidth: col.width }}>
            {row.productPriority}
          </td>
        );
      case "strategicPillar":
        return (
          <td className="px-3 text-[#6B7068] truncate" style={{ width: col.width, minWidth: col.width, maxWidth: col.width }}>
            {row.strategicPillar}
          </td>
        );
      case "owners":
        return (
          <td className="px-3 text-[#6B7068]" style={{ width: col.width, minWidth: col.width }}>
            {row.owners}
          </td>
        );
      case "timeline":
        return (
          <td className="px-3 text-[#6B7068] text-xs" style={{ width: col.width, minWidth: col.width }}>
            {timelineText}
          </td>
        );
      case "themes":
        return (
          <td className="px-3" style={{ width: col.width, minWidth: col.width }}>
            <div className="flex flex-wrap gap-0.5">
              {(row.themes ?? []).slice(0, 2).map((t) => (
                <span key={t} className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded-full">{t}</span>
              ))}
              {(row.themes ?? []).length > 2 && (
                <span className="text-[10px] px-1.5 py-0.5 bg-[#F0F0EE] text-[#6B7068] rounded-full">+{(row.themes ?? []).length - 2}</span>
              )}
            </div>
          </td>
        );
      case "tags":
        return (
          <td className="px-3" style={{ width: col.width, minWidth: col.width }}>
            <div className="flex flex-wrap gap-0.5">
              {(row.tags ?? []).slice(0, 2).map((t) => (
                <span key={t} className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full">{t}</span>
              ))}
              {(row.tags ?? []).length > 2 && (
                <span className="text-[10px] px-1.5 py-0.5 bg-[#F0F0EE] text-[#6B7068] rounded-full">+{(row.tags ?? []).length - 2}</span>
              )}
            </div>
          </td>
        );
      case "tactics":
        return (
          <td className="px-3 text-center" style={{ width: col.width, minWidth: col.width }}>
            {(row.tactics ?? []).length > 0 && (
              <span className="text-xs bg-[#F0F0EE] text-[#6B7068] rounded-full px-2 py-0.5">
                {row.tactics.length}
              </span>
            )}
          </td>
        );
      case "jira":
        return (
          <td className="px-3 text-center" style={{ width: col.width, minWidth: col.width }}>
            {(row.jiraLinks ?? []).length > 0 && (
              <span className="text-xs bg-blue-50 text-blue-600 rounded-full px-2 py-0.5">
                {row.jiraLinks.length}
              </span>
            )}
          </td>
        );
      case "visibility":
        return (
          <td className="px-3" style={{ width: col.width, minWidth: col.width }}>
            {row.visibility === "external_approved" ? (
              <span className="text-[10px] px-2 py-0.5 bg-green-100 text-green-700 rounded-full">External</span>
            ) : (
              <span className="text-[10px] px-2 py-0.5 bg-[#F0F0EE] text-[#6B7068] rounded-full">Internal</span>
            )}
          </td>
        );
      case "subDomain":
        return (
          <td className="px-3 text-[#6B7068] text-xs truncate" style={{ width: col.width, minWidth: col.width }}>
            {row.subDomain}
          </td>
        );
      default:
        return <td key={col.key} style={{ width: col.width, minWidth: col.width }} />;
    }
  };

  return (
    <table className="w-full border-collapse text-sm" style={{ tableLayout: "fixed" }}>
      <tbody>
        <tr
          className="h-10 border-b border-[#E5E5E3] hover:bg-[#FAFAF9] cursor-pointer group transition-colors"
          onClick={onSelect}
        >
          {columns.map((col) => renderCell(col))}
        </tr>
      </tbody>
    </table>
  );
}
