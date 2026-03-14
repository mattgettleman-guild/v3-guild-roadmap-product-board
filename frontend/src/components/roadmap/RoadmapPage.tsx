import { RoadmapToolbar } from "./RoadmapToolbar";
import { GridView } from "./GridView";
import { useSearch } from "@tanstack/react-router";

export function RoadmapPage() {
  const search = useSearch({ from: "/roadmap/" });
  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-5 pb-2">
        <h1 className="text-2xl font-bold text-[#1A1A18] tracking-tight">
          Roadmap
        </h1>
      </div>
      <RoadmapToolbar />
      <div className="flex-1 overflow-auto">
        {search.view === "grid" && <GridView />}
        {search.view === "gantt" && (
          <div className="p-8 text-center text-[#9CA39A]">
            Timeline view — coming in Phase 2
          </div>
        )}
        {search.view === "board" && (
          <div className="p-8 text-center text-[#9CA39A]">
            Board view — coming in Phase 2
          </div>
        )}
      </div>
    </div>
  );
}
