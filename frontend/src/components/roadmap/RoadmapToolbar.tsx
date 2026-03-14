import { useNavigate, useSearch } from "@tanstack/react-router";
import { useTaxonomy } from "../../hooks/useTaxonomy";
import { SlidersHorizontal, ChevronDown, Share2 } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { ExternalShareModal } from "./ExternalShareModal";

const STATUSES = ["Not Started", "In Discovery", "In Progress", "Paused", "Completed"];
const GROUP_BY_OPTIONS = [
  { key: undefined, label: "None" },
  { key: "pillar", label: "Pillar" },
  { key: "priority", label: "Priority" },
  { key: "domain", label: "Domain" },
] as const;

export function RoadmapToolbar() {
  const search = useSearch({ from: "/roadmap/" });
  const navigate = useNavigate({ from: "/roadmap/" });
  const { data: taxonomy } = useTaxonomy();
  const [showFilters, setShowFilters] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  // Close filter panel on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setShowFilters(false);
      }
    }
    if (showFilters) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showFilters]);

  const setParam = (key: string, value: string | undefined) => {
    navigate({ search: (prev) => ({ ...prev, [key]: value || undefined }) });
  };

  const clearAll = () => {
    navigate({
      search: (prev) => ({
        view: prev.view,
        groupBy: prev.groupBy,
      }),
    });
  };

  const views = [
    { key: "grid" as const, label: "Grid" },
    { key: "gantt" as const, label: "Timeline" },
    { key: "board" as const, label: "Board" },
  ];

  const activeFilters = [
    search.pillar && { key: "pillar", label: `Pillar: ${search.pillar}` },
    search.priority && { key: "priority", label: `Priority: ${search.priority}` },
    search.domain && { key: "domain", label: `Domain: ${search.domain}` },
    search.status && { key: "status", label: `Status: ${search.status}` },
    search.owner && { key: "owner", label: `Owner: ${search.owner}` },
  ].filter(Boolean) as { key: string; label: string }[];

  const activeGroupBy = (search as { groupBy?: string }).groupBy;

  return (
    <>
    <div className="border-b border-[#E5E5E3] bg-white">
      {/* Main toolbar row */}
      <div className="h-12 flex items-center gap-3 px-5">
        {/* View switcher */}
        <div className="flex items-center bg-[#FAFAF9] border border-[#E5E5E3] rounded-md p-0.5">
          {views.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setParam("view", key)}
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

        {/* Divider */}
        <div className="h-5 w-px bg-[#E5E5E3]" />

        {/* GroupBy pills */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-[#9CA39A] mr-1">Group:</span>
          {GROUP_BY_OPTIONS.map((opt) => (
            <button
              key={String(opt.key)}
              onClick={() => setParam("groupBy", opt.key)}
              className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                activeGroupBy === opt.key
                  ? "bg-amber-500 text-white font-medium"
                  : "text-[#6B7068] hover:bg-[#F0F0EE]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Share button */}
        <button
          onClick={() => setShowShareModal(true)}
          className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded border border-[#E5E5E3] text-[#6B7068] hover:bg-[#FAFAF9] transition-colors"
        >
          <Share2 size={14} />
          Share
        </button>

        {/* Filter button */}
        <div className="relative" ref={filterRef}>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`flex items-center gap-1.5 text-sm px-3 py-1.5 rounded border transition-colors ${
              activeFilters.length > 0
                ? "border-amber-400 text-amber-700 bg-amber-50"
                : "border-[#E5E5E3] text-[#6B7068] hover:bg-[#FAFAF9]"
            }`}
          >
            <SlidersHorizontal size={14} />
            Filters
            {activeFilters.length > 0 && (
              <span className="bg-amber-500 text-white rounded-full text-[10px] w-4 h-4 flex items-center justify-center font-medium">
                {activeFilters.length}
              </span>
            )}
            <ChevronDown size={12} className={`transition-transform ${showFilters ? "rotate-180" : ""}`} />
          </button>

          {/* Filter dropdown panel */}
          {showFilters && (
            <div className="absolute right-0 top-10 z-50 bg-white border border-[#E5E5E3] rounded-lg shadow-lg p-4 w-72">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-[#6B7068] uppercase tracking-wide">Filters</span>
                {activeFilters.length > 0 && (
                  <button onClick={clearAll} className="text-xs text-amber-600 hover:text-amber-700">
                    Clear all
                  </button>
                )}
              </div>

              <div className="space-y-3">
                {/* Pillar */}
                <FilterSelect
                  label="Pillar"
                  value={(search.pillar as string) ?? ""}
                  options={taxonomy?.pillars ?? []}
                  onChange={(v) => setParam("pillar", v)}
                />

                {/* Priority */}
                <FilterSelect
                  label="Priority"
                  value={(search.priority as string) ?? ""}
                  options={taxonomy?.priorities ?? []}
                  onChange={(v) => setParam("priority", v)}
                />

                {/* Domain */}
                <FilterSelect
                  label="Domain"
                  value={(search.domain as string) ?? ""}
                  options={taxonomy?.domains ?? []}
                  onChange={(v) => setParam("domain", v)}
                />

                {/* Status */}
                <FilterSelect
                  label="Status"
                  value={(search.status as string) ?? ""}
                  options={STATUSES}
                  onChange={(v) => setParam("status", v)}
                />

                {/* Owner */}
                <FilterSelect
                  label="Owner"
                  value={(search.owner as string) ?? ""}
                  options={taxonomy?.owners ?? []}
                  onChange={(v) => setParam("owner", v)}
                />
              </div>
            </div>
          )}
        </div>

        {/* Active filter pills */}
        {activeFilters.map((f) => (
          <span key={f.key} className="text-xs bg-amber-100 text-amber-700 px-2 py-1 rounded-full flex items-center gap-1">
            {f.label}
            <button
              onClick={() => setParam(f.key, undefined)}
              className="opacity-60 hover:opacity-100 font-medium"
            >
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
    {showShareModal && <ExternalShareModal onClose={() => setShowShareModal(false)} />}
    </>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-xs text-[#9CA39A] mb-0.5 block">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full text-sm border border-[#E5E5E3] rounded px-2 py-1.5 focus:outline-none focus:border-amber-400"
      >
        <option value="">All {label}s</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </div>
  );
}
