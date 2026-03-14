import { useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
  useDroppable,
  useDraggable,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useSearch } from "@tanstack/react-router";
import { useRows, useUpdateRow } from "../../hooks/useRows";
import { useUIStore } from "../../hooks/useUIStore";
import { StatusBadge } from "../ui/StatusBadge";
import { getDomainColor, SEMANTIC_STATUS } from "../ui/tokens";
import type { RoadmapRow, InvestmentStatus } from "@roadmap/shared";

const BOARD_COLUMNS: { key: InvestmentStatus; label: string }[] = [
  { key: "Not Started", label: "Not Started" },
  { key: "In Discovery", label: "In Discovery" },
  { key: "In Progress", label: "In Progress" },
  { key: "Paused", label: "Paused" },
  { key: "Completed", label: "Completed" },
];

function DroppableColumn({
  status,
  children,
  count,
}: {
  status: string;
  children: React.ReactNode;
  count: number;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: status });
  const style = SEMANTIC_STATUS[status] ?? SEMANTIC_STATUS["Not Started"];

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col min-w-[260px] w-[260px] rounded-xl border transition-colors ${
        isOver ? "border-amber-400 bg-amber-50/30" : "border-[#E5E5E3] bg-[#FAFAF9]"
      }`}
    >
      <div className="px-3 py-2.5 flex items-center gap-2 border-b border-[#E5E5E3]">
        <div
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: style.text }}
        />
        <span className="text-xs font-semibold text-[#1A1A18]">{status}</span>
        <span className="ml-auto text-[10px] font-medium text-[#9CA39A] bg-white border border-[#E5E5E3] rounded-full px-1.5 py-0.5">
          {count}
        </span>
      </div>
      <div className="flex-1 p-2 space-y-2 overflow-y-auto min-h-[200px]">
        {children}
      </div>
    </div>
  );
}

function DraggableCard({
  row,
  onSelect,
}: {
  row: RoadmapRow;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: row.id });

  const domainColor = getDomainColor(row.domain);
  const style = transform
    ? {
        transform: `translate(${transform.x}px, ${transform.y}px)`,
        opacity: isDragging ? 0.5 : 1,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={onSelect}
      className="bg-white rounded-lg border border-[#E5E5E3] p-3 cursor-pointer hover:shadow-sm transition-shadow"
    >
      <div
        className="border-l-[3px] pl-2.5 -ml-0.5"
        style={{ borderColor: domainColor }}
      >
        <p className="text-sm font-medium text-[#1A1A18] line-clamp-2">
          {row.investment}
        </p>
        <div className="flex items-center gap-2 mt-1.5 text-[11px] text-[#9CA39A]">
          <span>{row.domain}</span>
          {row.owners && (
            <>
              <span className="text-[#E5E5E3]">|</span>
              <span className="truncate max-w-[100px]">{row.owners}</span>
            </>
          )}
        </div>
        {row.productPriority && (
          <p className="text-[11px] text-[#6B7068] mt-1 truncate">
            {row.productPriority}
          </p>
        )}
      </div>
    </div>
  );
}

function CardOverlay({ row }: { row: RoadmapRow }) {
  const domainColor = getDomainColor(row.domain);
  return (
    <div className="bg-white rounded-lg border border-amber-400 p-3 shadow-xl w-[240px]">
      <div
        className="border-l-[3px] pl-2.5 -ml-0.5"
        style={{ borderColor: domainColor }}
      >
        <p className="text-sm font-medium text-[#1A1A18] line-clamp-2">
          {row.investment}
        </p>
        <div className="flex items-center gap-2 mt-1.5 text-[11px] text-[#9CA39A]">
          <span>{row.domain}</span>
        </div>
      </div>
    </div>
  );
}

export function BoardView() {
  const { data: rows = [], isLoading } = useRows();
  const search = useSearch({ from: "/roadmap/" });
  const updateRow = useUpdateRow();
  const { selectRow } = useUIStore();
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (search.pillar && r.strategicPillar !== search.pillar) return false;
      if (search.priority && r.productPriority !== search.priority)
        return false;
      if (search.domain && r.domain !== search.domain) return false;
      if (search.status && r.status !== search.status) return false;
      return true;
    });
  }, [rows, search]);

  const columns = useMemo(() => {
    const map = new Map<string, RoadmapRow[]>();
    for (const col of BOARD_COLUMNS) {
      map.set(col.key, []);
    }
    for (const row of filtered) {
      const status = row.status ?? "Not Started";
      const list = map.get(status);
      if (list) {
        list.push(row);
      } else {
        map.get("Not Started")!.push(row);
      }
    }
    return map;
  }, [filtered]);

  const activeRow = activeId ? rows.find((r) => r.id === activeId) : null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const rowId = active.id as string;
    const newStatus = over.id as string;

    const row = rows.find((r) => r.id === rowId);
    if (!row) return;

    const currentStatus = row.status ?? "Not Started";
    if (currentStatus !== newStatus) {
      updateRow.mutate({
        id: rowId,
        body: { status: newStatus as InvestmentStatus },
      });
    }
  }

  if (isLoading) {
    return (
      <div className="flex gap-4 p-5 pt-2 overflow-x-auto h-full">
        {BOARD_COLUMNS.map((col) => (
          <div
            key={col.key}
            className="flex flex-col min-w-[260px] w-[260px] rounded-xl border border-[#E5E5E3] bg-[#FAFAF9]"
          >
            <div className="px-3 py-2.5 flex items-center gap-2 border-b border-[#E5E5E3]">
              <div className="w-2 h-2 rounded-full bg-[#E5E5E3] animate-pulse" />
              <div className="h-3 w-24 rounded bg-[#E5E5E3] animate-pulse" />
            </div>
            <div className="flex-1 p-2 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="bg-white rounded-lg border border-[#E5E5E3] p-3 space-y-2">
                  <div className="h-3 w-full rounded bg-[#E5E5E3] animate-pulse" />
                  <div className="h-3 w-3/4 rounded bg-[#E5E5E3] animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 p-5 pt-2 overflow-x-auto h-full">
        {BOARD_COLUMNS.map((col) => {
          const colRows = columns.get(col.key) ?? [];
          return (
            <DroppableColumn
              key={col.key}
              status={col.key}
              count={colRows.length}
            >
              {colRows.map((row) => (
                <DraggableCard
                  key={row.id}
                  row={row}
                  onSelect={() => selectRow(row.id)}
                />
              ))}
              {colRows.length === 0 && (
                <div className="text-[11px] text-[#9CA39A] text-center py-4">
                  No investments
                </div>
              )}
            </DroppableColumn>
          );
        })}
      </div>
      <DragOverlay>
        {activeRow ? <CardOverlay row={activeRow} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
