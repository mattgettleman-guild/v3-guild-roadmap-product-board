import { usePriorities } from "../../hooks/usePriorities";
import { Link } from "@tanstack/react-router";
import { StatusBadge } from "../ui/StatusBadge";

export function PrioritiesPage() {
  const { data: priorities = [], isLoading } = usePriorities();

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-[#1A1A18] mb-4 tracking-tight">
        Product Priorities
      </h1>
      {isLoading ? (
        <p className="text-[#9CA39A] text-sm">Loading priorities...</p>
      ) : priorities.length === 0 ? (
        <p className="text-[#6B7068]">
          No priorities found. Use the sync feature to populate from taxonomy.
        </p>
      ) : (
        <div className="grid gap-4">
          {priorities.map((p) => (
            <Link
              key={p.id}
              to="/priorities/$priorityId"
              params={{ priorityId: p.id }}
              className="block bg-white border border-[#E5E5E3] rounded-lg p-4 hover:shadow-sm transition-shadow"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-[#1A1A18]">
                  {p.name}
                </h2>
                <StatusBadge
                  status={
                    p.status === "active"
                      ? "In Progress"
                      : p.status === "paused"
                        ? "Paused"
                        : "Completed"
                  }
                />
              </div>
              {p.strategicPillar && (
                <p className="text-xs text-[#9CA39A] mt-1">
                  {p.strategicPillar}
                </p>
              )}
              {p.commercialWhy && (
                <p className="text-sm text-[#6B7068] mt-2 line-clamp-2">
                  {p.commercialWhy}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
