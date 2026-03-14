/**
 * GridView — data table for roadmap investments with TanStack Virtual
 * for smooth scrolling on large datasets.
 */
import { useRows, useUpdateRow } from "../../hooks/useRows";
import { useUIStore } from "../../hooks/useUIStore";
import { useSearch } from "@tanstack/react-router";
import { StatusBadge } from "../ui/StatusBadge";
import { getDomainColor } from "../ui/tokens";
import { useState, useRef, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { RoadmapRow } from "@roadmap/shared";

const COLUMNS = [
  { key: "investment", label: "Investment", width: 280 },
  { key: "domain", label: "Domain", width: 140 },
  { key: "status", label: "Status", width: 130 },
  { key: "productPriority", label: "Priority", width: 160 },
  { key: "strategicPillar", label: "Pillar", width: 160 },
  { key: "owners", label: "Owner", width: 140 },
];

const ROW_HEIGHT = 40;

export function GridView() {
  const { data: rows = [], isLoading } = useRows();
  const search = useSearch({ from: "/roadmap/" });
  const { selectRow } = useUIStore();
  const updateRow = useUpdateRow();

  const filtered = rows.filter((r) => {
    if (search.pillar && r.strategicPillar !== search.pillar) return false;
    if (search.priority && r.productPriority !== search.priority) return false;
    if (search.domain && r.domain !== search.domain) return false;
    if (search.status && r.status !== search.status) return false;
    return true;
  });

  // Virtual scrolling container ref
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 20,
  });

  if (isLoading) {
    return (
      <div className="p-8 text-center text-[#9CA39A] text-sm">
        Loading investments...
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      {/* Fixed header */}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="h-9 bg-[#FAFAF9] border-b border-[#E5E5E3]">
            {COLUMNS.map((col) => (
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

      {/* Virtual scroll container */}
      <div
        ref={parentRef}
        className="overflow-auto"
        style={{ maxHeight: "calc(100vh - 200px)" }}
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-[#9CA39A]">No investments found</div>
          ) : (
            virtualizer.getVirtualItems().map((virtualRow) => {
              const row = filtered[virtualRow.index];
              return (
                <div
                  key={row.id}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <GridRow
                    row={row}
                    onSelect={() => selectRow(row.id)}
                    onUpdate={(body) => updateRow.mutate({ id: row.id, body })}
                  />
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Row count footer */}
      <div className="px-3 py-2 border-t border-[#E5E5E3] text-xs text-[#9CA39A]">
        {filtered.length} investment{filtered.length !== 1 ? "s" : ""}
        {filtered.length !== rows.length && ` (${rows.length} total)`}
      </div>
    </div>
  );
}

function GridRow({
  row,
  onSelect,
  onUpdate,
}: {
  row: RoadmapRow;
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
    if (editingCell === "investment" && draft !== row.investment)
      onUpdate({ investment: draft });
    if (editingCell === "domain" && draft !== row.domain)
      onUpdate({ domain: draft });
    setEditingCell(null);
  };

  return (
    <table className="w-full border-collapse text-sm">
      <tbody>
        <tr
          className="h-10 border-b border-[#E5E5E3] hover:bg-slate-50 cursor-pointer group"
          onClick={onSelect}
        >
          {/* Investment name with domain border */}
          <td
            className="px-3"
            style={{ width: 280, minWidth: 280, borderLeft: `3px solid ${domainColor}` }}
          >
            {editingCell === "investment" ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEdit();
                  e.stopPropagation();
                }}
                onClick={(e) => e.stopPropagation()}
                className="w-full outline-none bg-transparent border-b border-amber-400 text-[#1A1A18]"
              />
            ) : (
              <span
                className="font-medium text-[#1A1A18] block truncate"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startEdit("investment", row.investment);
                }}
              >
                {row.investment}
              </span>
            )}
          </td>

          {/* Domain */}
          <td className="px-3 text-[#6B7068]" style={{ width: 140, minWidth: 140 }}>
            <span>{row.domain}</span>
          </td>

          {/* Status */}
          <td className="px-3" style={{ width: 130, minWidth: 130 }}>
            <StatusBadge status={row.status ?? "Not Started"} />
          </td>

          {/* Priority */}
          <td
            className="px-3 text-[#6B7068] truncate"
            style={{ width: 160, minWidth: 160, maxWidth: 160 }}
          >
            {row.productPriority}
          </td>

          {/* Pillar */}
          <td
            className="px-3 text-[#6B7068] truncate"
            style={{ width: 160, minWidth: 160, maxWidth: 160 }}
          >
            {row.strategicPillar}
          </td>

          {/* Owner */}
          <td className="px-3 text-[#6B7068]" style={{ width: 140, minWidth: 140 }}>
            {row.owners}
          </td>
        </tr>
      </tbody>
    </table>
  );
}
