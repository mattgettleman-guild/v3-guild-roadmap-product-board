/**
 * TacticsView — mini-card list of tactics for an investment, shown in DetailPanel.
 * Displays tactic name, status, owner, confidence, and Jira link count.
 */
import { useState } from "react";
import { ChevronDown, ChevronRight, Link2, ExternalLink } from "lucide-react";
import type { Tactic } from "@roadmap/shared";
import { SEMANTIC_STATUS, CONFIDENCE_CLASSES } from "../ui/tokens";

interface Props {
  tactics: Tactic[];
}

const TACTIC_STATUS_MAP: Record<string, { label: string; bg: string; text: string }> = {
  not_started: { label: "Not Started", bg: "#f1f5f9", text: "#64748b" },
  in_discovery: { label: "Discovery", bg: "#ede9fe", text: "#7c3aed" },
  in_progress: { label: "In Progress", bg: "#fef9c3", text: "#d97706" },
  paused: { label: "Paused", bg: "#fff7ed", text: "#ea580c" },
  completed: { label: "Done", bg: "#d1fae5", text: "#059669" },
};

export function TacticsView({ tactics }: Props) {
  if (tactics.length === 0) {
    return (
      <p className="text-sm text-[#9CA39A] italic">No tactics defined</p>
    );
  }

  return (
    <div className="space-y-2">
      {tactics.map((tactic) => (
        <TacticCard key={tactic.id} tactic={tactic} />
      ))}
    </div>
  );
}

function TacticCard({ tactic }: { tactic: Tactic }) {
  const [expanded, setExpanded] = useState(false);
  const statusInfo = TACTIC_STATUS_MAP[tactic.status || "not_started"] || TACTIC_STATUS_MAP.not_started;
  const jiraCount = tactic.jiraLinks?.length ?? 0;
  const confClass = tactic.deliveryConfidence
    ? CONFIDENCE_CLASSES[tactic.deliveryConfidence] ?? ""
    : "";

  return (
    <div className="border border-[#E5E5E3] rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#FAFAF9] transition-colors"
      >
        {expanded ? (
          <ChevronDown size={12} className="text-[#9CA39A] shrink-0" />
        ) : (
          <ChevronRight size={12} className="text-[#9CA39A] shrink-0" />
        )}
        <span className="text-sm font-medium text-[#1A1A18] flex-1 truncate">
          {tactic.name}
        </span>
        <span
          className="text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0"
          style={{ backgroundColor: statusInfo.bg, color: statusInfo.text }}
        >
          {statusInfo.label}
        </span>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-2 border-t border-[#E5E5E3]/50">
          {tactic.description && (
            <p className="text-xs text-[#6B7068] whitespace-pre-wrap">{tactic.description}</p>
          )}

          <div className="flex flex-wrap gap-2 text-xs">
            {tactic.owner && (
              <span className="text-[#6B7068]">
                Owner: <strong className="text-[#1A1A18]">{tactic.owner}</strong>
              </span>
            )}
            {tactic.deliveryConfidence && (
              <span
                className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${confClass}`}
              >
                {tactic.deliveryConfidence}
              </span>
            )}
          </div>

          {/* Timeline */}
          {tactic.timeline && (tactic.timeline.start || tactic.timeline.end) && (
            <p className="text-xs text-[#9CA39A]">
              {tactic.timeline.start} {tactic.timeline.start && tactic.timeline.end ? " to " : ""}{" "}
              {tactic.timeline.end}
            </p>
          )}

          {/* Jira links */}
          {jiraCount > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA39A]">
                Jira ({jiraCount})
              </p>
              {tactic.jiraLinks.map((link) => (
                <a
                  key={link.id}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-xs text-amber-600 hover:text-amber-700"
                >
                  <Link2 size={10} className="shrink-0" />
                  <span className="font-mono">{link.key}</span>
                  <span className="text-[#6B7068] truncate flex-1">{link.title}</span>
                  <ExternalLink size={10} className="shrink-0 text-[#9CA39A]" />
                </a>
              ))}
            </div>
          )}

          {/* Tags */}
          {tactic.tags && tactic.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tactic.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-[10px] px-1.5 py-0.5 bg-[#FAFAF9] border border-[#E5E5E3] text-[#6B7068] rounded"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
