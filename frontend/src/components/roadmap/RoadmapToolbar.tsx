import { useNavigate, useSearch } from "@tanstack/react-router";

export function RoadmapToolbar() {
  const search = useSearch({ from: "/roadmap/" });
  const navigate = useNavigate({ from: "/roadmap/" });

  const setView = (view: "grid" | "gantt" | "board") => {
    navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, view }) });
  };

  const views = [
    { key: "grid" as const, label: "Grid" },
    { key: "gantt" as const, label: "Timeline" },
    { key: "board" as const, label: "Board" },
  ];

  return (
    <div className="h-12 flex items-center gap-3 px-5 border-b border-[#E5E5E3] bg-white">
      {/* View switcher */}
      <div className="flex items-center bg-[#FAFAF9] border border-[#E5E5E3] rounded-md p-0.5">
        {views.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`px-3 py-1 text-sm rounded transition-colors ${
              search.view === key
                ? "bg-white text-[#1A1A18] shadow-sm font-medium"
                : "text-[#6B7068] hover:text-[#1A1A18]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1" />

      {/* Filter indicators */}
      {search.pillar && (
        <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full">
          Pillar: {search.pillar}
          <button
            onClick={() =>
              navigate({
                search: (p: Record<string, unknown>) => ({ ...p, pillar: undefined }),
              })
            }
            className="ml-1 opacity-60 hover:opacity-100"
          >
            x
          </button>
        </span>
      )}
      {search.priority && (
        <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full">
          Priority: {search.priority}
          <button
            onClick={() =>
              navigate({
                search: (p: Record<string, unknown>) => ({ ...p, priority: undefined }),
              })
            }
            className="ml-1 opacity-60 hover:opacity-100"
          >
            x
          </button>
        </span>
      )}
      {search.domain && (
        <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full">
          Domain: {search.domain}
          <button
            onClick={() =>
              navigate({
                search: (p: Record<string, unknown>) => ({ ...p, domain: undefined }),
              })
            }
            className="ml-1 opacity-60 hover:opacity-100"
          >
            x
          </button>
        </span>
      )}
      {search.status && (
        <span className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full">
          Status: {search.status}
          <button
            onClick={() =>
              navigate({
                search: (p: Record<string, unknown>) => ({ ...p, status: undefined }),
              })
            }
            className="ml-1 opacity-60 hover:opacity-100"
          >
            x
          </button>
        </span>
      )}
    </div>
  );
}
