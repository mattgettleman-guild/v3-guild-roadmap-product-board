/**
 * DetailPanel — right-side slide-over for viewing/editing investment details.
 * Phase 3 additions: Tactics section, Jira links, link Jira button.
 */
import { useUIStore } from "../../hooks/useUIStore";
import { useRows, useUpdateRow } from "../../hooks/useRows";
import { X, Link2, ExternalLink } from "lucide-react";
import { StatusBadge } from "../ui/StatusBadge";
import { TacticsView } from "../roadmap/TacticsView";
import { JiraLinkModal } from "../roadmap/JiraLinkModal";
import { useState, useRef, useEffect } from "react";

export function DetailPanel() {
  const { selectedRowId, detailPanelOpen, selectRow } = useUIStore();
  const { data: rows } = useRows();
  const updateRow = useUpdateRow();
  const row = rows?.find((r) => r.id === selectedRowId);
  const [showJiraModal, setShowJiraModal] = useState(false);

  // Reset Jira modal when row changes
  useEffect(() => {
    setShowJiraModal(false);
  }, [selectedRowId]);

  if (!detailPanelOpen || !row) return null;

  return (
    <>
      <aside className="w-[480px] h-screen border-l border-[#E5E5E3] bg-white flex flex-col shadow-xl overflow-hidden">
        {/* Header */}
        <div className="h-14 flex items-center justify-between px-5 border-b border-[#E5E5E3]">
          <span className="text-sm font-medium text-[#6B7068]">
            Investment Details
          </span>
          <button
            onClick={() => selectRow(null)}
            className="p-1 rounded hover:bg-slate-100 text-[#9CA39A]"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Investment name */}
          <InlineTextField
            label="Investment"
            value={row.investment}
            onSave={(v) =>
              updateRow.mutate({ id: row.id, body: { investment: v } })
            }
            className="text-lg font-semibold text-[#1A1A18]"
          />

          {/* Status */}
          <div>
            <label className="text-xs font-medium text-[#9CA39A] uppercase tracking-wide">
              Status
            </label>
            <div className="mt-1">
              <StatusSelect
                value={row.status ?? "Not Started"}
                onSave={(v) =>
                  updateRow.mutate({
                    id: row.id,
                    body: { status: v as any },
                  })
                }
              />
            </div>
          </div>

          {/* Domain */}
          <InlineTextField
            label="Domain"
            value={row.domain}
            onSave={(v) =>
              updateRow.mutate({ id: row.id, body: { domain: v } })
            }
          />

          {/* Description */}
          <InlineTextArea
            label="Description"
            value={row.description ?? ""}
            onSave={(v) =>
              updateRow.mutate({ id: row.id, body: { description: v } })
            }
          />

          {/* Priority */}
          <div>
            <label className="text-xs font-medium text-[#9CA39A] uppercase tracking-wide">
              Priority
            </label>
            <p className="mt-1 text-sm text-[#1A1A18]">
              {row.productPriority}
            </p>
          </div>

          {/* Pillar */}
          <div>
            <label className="text-xs font-medium text-[#9CA39A] uppercase tracking-wide">
              Strategic Pillar
            </label>
            <p className="mt-1 text-sm text-[#1A1A18]">
              {row.strategicPillar}
            </p>
          </div>

          {/* Jira Links */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-[#9CA39A] uppercase tracking-wide">
                Jira Links ({row.jiraLinks?.length ?? 0})
              </label>
              <button
                onClick={() => setShowJiraModal(true)}
                className="text-xs text-amber-600 hover:text-amber-700 font-medium flex items-center gap-1"
              >
                <Link2 size={12} />
                Link Jira
              </button>
            </div>
            {row.jiraLinks && row.jiraLinks.length > 0 ? (
              <div className="mt-2 space-y-1">
                {row.jiraLinks.map((link) => (
                  <a
                    key={link.id}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 p-2 rounded-md border border-[#E5E5E3] hover:bg-slate-50 text-sm"
                  >
                    <span className="text-xs font-mono text-amber-600">{link.key}</span>
                    <span className="text-[#1A1A18] truncate flex-1">{link.title}</span>
                    <ExternalLink size={12} className="text-[#9CA39A] shrink-0" />
                  </a>
                ))}
              </div>
            ) : (
              <p className="mt-1 text-sm text-[#9CA39A]">No Jira issues linked</p>
            )}
          </div>

          {/* Tactics */}
          <div>
            <label className="text-xs font-medium text-[#9CA39A] uppercase tracking-wide">
              Tactics ({row.tactics?.length ?? 0})
            </label>
            <div className="mt-2">
              <TacticsView tactics={row.tactics ?? []} />
            </div>
          </div>

          {/* Owner */}
          <InlineTextField
            label="Owner"
            value={row.owners ?? ""}
            onSave={(v) =>
              updateRow.mutate({ id: row.id, body: { owners: v } })
            }
          />

          {/* Tags */}
          {row.tags && row.tags.length > 0 && (
            <div>
              <label className="text-xs font-medium text-[#9CA39A] uppercase tracking-wide">
                Tags
              </label>
              <div className="mt-1 flex flex-wrap gap-1">
                {row.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-xs px-2 py-0.5 bg-slate-100 text-[#6B7068] rounded-full"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Jira Link Modal */}
      {showJiraModal && (
        <JiraLinkModal
          rowId={row.id}
          investmentName={row.investment}
          existingLinks={row.jiraLinks ?? []}
          onClose={() => setShowJiraModal(false)}
        />
      )}
    </>
  );
}

function InlineTextField({
  label,
  value,
  onSave,
  className = "",
}: {
  label: string;
  value: string;
  onSave: (v: string) => void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onSave(draft);
  };

  return (
    <div>
      <label className="text-xs font-medium text-[#9CA39A] uppercase tracking-wide">
        {label}
      </label>
      {editing ? (
        <input
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          className={`mt-1 w-full border-b border-amber-400 outline-none bg-transparent ${className} text-sm text-[#1A1A18] pb-0.5`}
        />
      ) : (
        <p
          onClick={() => setEditing(true)}
          className={`mt-1 cursor-text rounded px-1 -mx-1 hover:bg-slate-50 ${className} text-sm text-[#1A1A18] min-h-[1.5rem]`}
        >
          {value || (
            <span className="text-[#9CA39A]">Click to edit...</span>
          )}
        </p>
      )}
    </div>
  );
}

function InlineTextArea({
  label,
  value,
  onSave,
}: {
  label: string;
  value: string;
  onSave: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);
  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onSave(draft);
  };

  return (
    <div>
      <label className="text-xs font-medium text-[#9CA39A] uppercase tracking-wide">
        {label}
      </label>
      {editing ? (
        <textarea
          ref={ref}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          rows={4}
          className="mt-1 w-full border border-[#E5E5E3] rounded p-2 text-sm text-[#1A1A18] resize-none focus:outline-none focus:border-amber-400"
        />
      ) : (
        <p
          onClick={() => setEditing(true)}
          className="mt-1 cursor-text text-sm text-[#1A1A18] whitespace-pre-wrap hover:bg-slate-50 rounded px-1 -mx-1 min-h-[2rem]"
        >
          {value || (
            <span className="text-[#9CA39A]">Click to add description...</span>
          )}
        </p>
      )}
    </div>
  );
}

const STATUSES = [
  "Not Started",
  "In Discovery",
  "In Progress",
  "Paused",
  "Completed",
];

function StatusSelect({
  value,
  onSave,
}: {
  value: string;
  onSave: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onSave(e.target.value)}
      className="text-sm border border-[#E5E5E3] rounded px-2 py-1 focus:outline-none focus:border-amber-400"
    >
      {STATUSES.map((s) => (
        <option key={s}>{s}</option>
      ))}
    </select>
  );
}
