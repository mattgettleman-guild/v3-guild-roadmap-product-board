import { useState, useEffect, useRef, useMemo } from "react";
import {
  Search,
  X,
  ArrowRight,
  Briefcase,
  Target,
  Link as LinkIcon,
  LayoutGrid,
  GanttChart,
  Columns3,
  Flag,
  Sparkles,
  Upload,
  Settings,
  Home,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useRows } from "../../hooks/useRows";
import { useUIStore } from "../../hooks/useUIStore";

interface SearchResult {
  id: string;
  type: "investment" | "tactic" | "jira" | "action";
  label: string;
  secondary?: string;
  rowId?: string;
  tacticId?: string;
  action?: () => void;
}

function fuzzyMatch(text: string, query: string): boolean {
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  return lower.includes(q);
}

export function CommandPalette() {
  const { commandPaletteOpen, setCommandPaletteOpen, selectRow } =
    useUIStore();
  const { data: rows = [] } = useRows();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [commandPaletteOpen]);

  // Global Cmd+K listener
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [commandPaletteOpen, setCommandPaletteOpen]);

  const quickActions: SearchResult[] = useMemo(
    () => [
      {
        id: "nav-home",
        type: "action",
        label: "Go to Home",
        action: () => navigate({ to: "/" }),
      },
      {
        id: "nav-roadmap",
        type: "action",
        label: "Go to Roadmap",
        action: () => navigate({ to: "/roadmap/" }),
      },
      {
        id: "nav-roadmap-gantt",
        type: "action",
        label: "Go to Timeline View",
        action: () =>
          navigate({ to: "/roadmap/", search: { view: "gantt" } }),
      },
      {
        id: "nav-roadmap-board",
        type: "action",
        label: "Go to Board View",
        action: () =>
          navigate({ to: "/roadmap/", search: { view: "board" } }),
      },
      {
        id: "nav-priorities",
        type: "action",
        label: "Go to Priorities",
        action: () => navigate({ to: "/priorities/" }),
      },
      {
        id: "nav-intelligence",
        type: "action",
        label: "Go to Intelligence",
        action: () => navigate({ to: "/intelligence/" }),
      },
      {
        id: "nav-import",
        type: "action",
        label: "Go to Import",
        action: () => navigate({ to: "/import/" }),
      },
      {
        id: "nav-settings",
        type: "action",
        label: "Go to Settings",
        action: () => navigate({ to: "/settings/" }),
      },
    ],
    [navigate],
  );

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return quickActions;

    const matches: SearchResult[] = [];

    // Match quick actions
    for (const action of quickActions) {
      if (fuzzyMatch(action.label, q)) {
        matches.push(action);
      }
    }

    // Match investments
    for (const row of rows) {
      if (
        fuzzyMatch(row.investment, q) ||
        fuzzyMatch(row.strategicPillar, q) ||
        fuzzyMatch(row.productPriority, q) ||
        fuzzyMatch(row.domain, q)
      ) {
        matches.push({
          id: `inv-${row.id}`,
          type: "investment",
          label: row.investment,
          secondary: [row.strategicPillar, row.domain]
            .filter(Boolean)
            .join(" \u00b7 "),
          rowId: row.id,
        });
      }

      for (const tactic of row.tactics) {
        if (
          fuzzyMatch(tactic.name, q) ||
          (tactic.owner && fuzzyMatch(tactic.owner, q))
        ) {
          matches.push({
            id: `tac-${tactic.id}`,
            type: "tactic",
            label: tactic.name,
            secondary: row.investment,
            rowId: row.id,
            tacticId: tactic.id,
          });
        }

        for (const jl of tactic.jiraLinks) {
          if (fuzzyMatch(jl.key, q) || fuzzyMatch(jl.title, q)) {
            matches.push({
              id: `jira-tac-${jl.id}`,
              type: "jira",
              label: `${jl.key} \u2014 ${jl.title}`,
              secondary: `${row.investment} \u203a ${tactic.name}`,
              rowId: row.id,
              tacticId: tactic.id,
            });
          }
        }
      }

      for (const jl of row.jiraLinks) {
        if (fuzzyMatch(jl.key, q) || fuzzyMatch(jl.title, q)) {
          matches.push({
            id: `jira-inv-${jl.id}`,
            type: "jira",
            label: `${jl.key} \u2014 ${jl.title}`,
            secondary: row.investment,
            rowId: row.id,
          });
        }
      }
    }

    return matches.slice(0, 50);
  }, [query, rows, quickActions]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  function handleSelect(result: SearchResult) {
    if (result.action) {
      result.action();
    } else if (result.rowId) {
      selectRow(result.rowId);
    }
    setCommandPaletteOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && results[selectedIndex]) {
      e.preventDefault();
      handleSelect(results[selectedIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setCommandPaletteOpen(false);
    }
  }

  useEffect(() => {
    const el = listRef.current?.querySelector(
      `[data-index="${selectedIndex}"]`,
    );
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const iconForType = (type: SearchResult["type"]) => {
    switch (type) {
      case "investment":
        return <Briefcase size={14} className="text-amber-600 shrink-0" />;
      case "tactic":
        return <Target size={14} className="text-emerald-600 shrink-0" />;
      case "jira":
        return <LinkIcon size={14} className="text-blue-600 shrink-0" />;
      case "action":
        return <ArrowRight size={14} className="text-amber-600 shrink-0" />;
    }
  };

  if (!commandPaletteOpen) return null;

  // Group results
  const grouped: Record<string, SearchResult[]> = {};
  for (const r of results) {
    const key =
      r.type === "action"
        ? "Quick Actions"
        : r.type === "investment"
          ? "Investments"
          : r.type === "tactic"
            ? "Tactics"
            : "Jira Links";
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(r);
  }

  let flatIndex = -1;

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-start justify-center pt-[15vh]"
      onClick={() => setCommandPaletteOpen(false)}
    >
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-[min(560px,90vw)] bg-white border border-[#E5E5E3] rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[#E5E5E3]">
          <Search size={18} className="text-[#9CA39A] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search investments, tactics, Jira keys..."
            className="flex-1 bg-transparent border-none outline-none text-sm text-[#1A1A18] placeholder:text-[#9CA39A]"
          />
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium text-[#9CA39A] bg-[#FAFAF9] border border-[#E5E5E3] rounded">
            ESC
          </kbd>
          <button
            onClick={() => setCommandPaletteOpen(false)}
            aria-label="Close search"
            className="w-6 h-6 rounded flex items-center justify-center text-[#9CA39A] hover:text-[#1A1A18] hover:bg-[#FAFAF9] transition-colors cursor-pointer border-none bg-transparent"
          >
            <X size={14} />
          </button>
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
          {results.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-[#9CA39A]">
              No results found for &ldquo;{query}&rdquo;
            </div>
          )}

          {Object.entries(grouped).map(([groupName, items]) => (
            <div key={groupName}>
              <div className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#9CA39A] bg-[#FAFAF9]/50 sticky top-0">
                {groupName}
              </div>
              {items.map((result) => {
                flatIndex++;
                const idx = flatIndex;
                const isSelected = idx === selectedIndex;
                return (
                  <button
                    key={result.id}
                    data-index={idx}
                    onClick={() => handleSelect(result)}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left border-none cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-amber-50 text-[#1A1A18]"
                        : "bg-transparent text-[#1A1A18] hover:bg-[#FAFAF9]"
                    }`}
                  >
                    {iconForType(result.type)}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        {result.label}
                      </div>
                      {result.secondary && (
                        <div className="text-xs text-[#9CA39A] truncate">
                          {result.secondary}
                        </div>
                      )}
                    </div>
                    {isSelected && (
                      <ArrowRight
                        size={14}
                        className="text-amber-600 shrink-0"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-4 px-4 py-2 border-t border-[#E5E5E3] bg-[#FAFAF9]/50 text-[11px] text-[#9CA39A]">
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-white border border-[#E5E5E3] rounded text-[10px]">
              \u2191\u2193
            </kbd>{" "}
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-white border border-[#E5E5E3] rounded text-[10px]">
              \u21b5
            </kbd>{" "}
            open
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-white border border-[#E5E5E3] rounded text-[10px]">
              esc
            </kbd>{" "}
            close
          </span>
        </div>
      </div>
    </div>
  );
}
