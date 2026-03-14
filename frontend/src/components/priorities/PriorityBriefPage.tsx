import { useParams } from "@tanstack/react-router";

export function PriorityBriefPage() {
  const { priorityId } = useParams({ from: "/priorities/$priorityId" });

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-[#1A1A18] mb-2">Priority Brief</h1>
      <p className="text-[#6B7068]">
        Full brief editor for priority <code className="bg-slate-100 px-1 rounded text-xs">{priorityId}</code> — coming in Phase 2
      </p>
    </div>
  );
}
