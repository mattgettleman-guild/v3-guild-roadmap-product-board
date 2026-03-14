import { useRows, useUpdateRow } from "../../hooks/useRows";
import { useUIStore } from "../../hooks/useUIStore";
import { useSearch } from "@tanstack/react-router";
import { StatusBadge } from "../ui/StatusBadge";
import { getDomainColor } from "../ui/tokens";
import { useState } from "react";
import type { RoadmapRow } from "@roadmap/shared";

const COLUMNS = [
  { key: "investment", label: "Investment", width: 280 },
  { key: "domain", label: "Domain", width: 140 },
  { key: "status", label: "Status", width: 130 },
  { key: "productPriority", label: "Priority", width: 160 },
  { key: "strategicPillar", label: "Pillar", width: 160 },
  { key: "owners", label: "Owner", width: 140 },
];

export function GridView() {
  const { data: rows = [], isLoading } = useRows();
  const search = useSearch({ from: "/roadmap/" });
  const { selectRow } = useUIStore();
  const updateRow = useUpdateRow();

  const filtered = rows.filter((r) => {
    if (search.pillar && r.strategicPillar !== search.pillar) return false;
    if (search.priority && r.productPriority !== search.priority)
      return false;
    if (search.domain && r.domain !== search.domain) return false;
    if (search.status && r.status !== search.status) return false;
    return true;
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
        <tbody>
          {filtered.map((row) => (
            <GridRow
              key={row.id}
              row={row}
              onSelect={() => selectRow(row.id)}
              onUpdate={(body) =>
                updateRow.mutate({ id: row.id, body })
              }
            />
          ))}
          {filtered.length === 0 && (
            <tr>
              <td
                colSpan={COLUMNS.length}
                className="p-8 text-center text-[#9CA39A]"
              >
                No investments found
              </td>
            </tr>
          )}
        </tbody>
      </table>
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
    <tr
      className="h-10 border-b border-[#E5E5E3] hover:bg-slate-50 cursor-pointer group"
      onClick={onSelect}
    >
      {/* Investment name with domain border */}
      <td className="px-3" style={{ borderLeft: `3px solid ${domainColor}` }}>
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
      <td className="px-3 text-[#6B7068]">
        <span>{row.domain}</span>
      </td>

      {/* Status */}
      <td className="px-3">
        <StatusBadge status={row.status ?? "Not Started"} />
      </td>

      {/* Priority */}
      <td className="px-3 text-[#6B7068] truncate max-w-[160px]">
        {row.productPriority}
      </td>

      {/* Pillar */}
      <td className="px-3 text-[#6B7068] truncate max-w-[160px]">
        {row.strategicPillar}
      </td>

      {/* Owner */}
      <td className="px-3 text-[#6B7068]">{row.owners}</td>
    </tr>
  );
}
