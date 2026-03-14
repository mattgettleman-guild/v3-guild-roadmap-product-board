/**
 * JiraLinkModal — search and link Jira issues to an investment.
 * Shown inside DetailPanel when the user clicks "Link Jira".
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Search, Link2, Loader2, X, Sparkles, ExternalLink } from "lucide-react";
import { api } from "../../lib/api";
import type { JiraLink } from "@roadmap/shared";

interface Props {
  rowId: string;
  investmentName: string;
  existingLinks: JiraLink[];
  onClose: () => void;
}

export function JiraLinkModal({ rowId, investmentName, existingLinks, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const qc = useQueryClient();

  // Manual search
  const { data: searchResults = [], isFetching: searching } = useQuery({
    queryKey: ["jira-search", searchTerm],
    queryFn: () => api.searchJiraIssues(searchTerm),
    enabled: searchTerm.length >= 2,
  });

  // AI suggestions
  const {
    data: suggestions = [],
    isFetching: suggestionsLoading,
    refetch: fetchSuggestions,
  } = useQuery({
    queryKey: ["jira-suggestions", rowId],
    queryFn: () => api.suggestJiraLinks(rowId),
    enabled: false,
  });

  const existingKeys = new Set(existingLinks.map((l) => l.key));

  function handleSearch() {
    if (query.trim().length >= 2) {
      setSearchTerm(query.trim());
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-[520px] max-h-[600px] flex flex-col border border-[#E5E5E3]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E5E3]">
          <div>
            <h3 className="text-sm font-semibold text-[#1A1A18]">Link Jira Issues</h3>
            <p className="text-xs text-[#9CA39A] mt-0.5">{investmentName}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[#FAFAF9] text-[#9CA39A] transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 py-3 border-b border-[#E5E5E3]">
          <div className="flex gap-2">
            <div className="flex-1 flex items-center border border-[#E5E5E3] rounded-lg px-3 py-1.5 focus-within:border-amber-400">
              <Search size={14} className="text-[#9CA39A] shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="Search by key or summary..."
                className="flex-1 ml-2 text-sm outline-none bg-transparent text-[#1A1A18] placeholder-[#9CA39A]"
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={query.trim().length < 2}
              className="px-3 py-1.5 bg-amber-600 text-white text-sm rounded-lg hover:bg-amber-700 disabled:opacity-50"
            >
              Search
            </button>
          </div>
          <button
            onClick={() => fetchSuggestions()}
            disabled={suggestionsLoading}
            className="mt-2 flex items-center gap-1.5 text-xs text-amber-600 hover:text-amber-700 font-medium"
          >
            {suggestionsLoading ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Sparkles size={12} />
            )}
            AI suggest linked issues
          </button>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {/* AI Suggestions */}
          {suggestions.length > 0 && (
            <div className="px-5 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA39A] mb-2">
                AI Suggestions
              </p>
              <div className="space-y-1">
                {suggestions.map((s) => (
                  <SuggestionRow
                    key={s.key}
                    jiraKey={s.key}
                    summary={s.summary}
                    confidence={s.confidence}
                    reason={s.reason}
                    linked={existingKeys.has(s.key)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Search results */}
          {searchTerm && (
            <div className="px-5 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA39A] mb-2">
                Search Results
              </p>
              {searching ? (
                <div className="flex items-center gap-2 py-4 text-sm text-[#9CA39A]">
                  <Loader2 size={14} className="animate-spin" />
                  Searching...
                </div>
              ) : searchResults.length === 0 ? (
                <p className="py-4 text-sm text-[#9CA39A]">No results found</p>
              ) : (
                <div className="space-y-1">
                  {searchResults.map((issue) => (
                    <div
                      key={issue.key}
                      className="flex items-center justify-between p-2 rounded-md hover:bg-[#FAFAF9] transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono text-amber-600">{issue.key}</span>
                          <span className="text-xs text-[#9CA39A]">{issue.issueType}</span>
                        </div>
                        <p className="text-sm text-[#1A1A18] truncate">{issue.title}</p>
                      </div>
                      {existingKeys.has(issue.key) ? (
                        <span className="text-xs text-emerald-600 font-medium px-2">Linked</span>
                      ) : (
                        <button className="p-1 rounded hover:bg-amber-50 text-[#9CA39A] hover:text-amber-600">
                          <Link2 size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Existing links */}
          {existingLinks.length > 0 && (
            <div className="px-5 py-3 border-t border-[#E5E5E3]/50">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9CA39A] mb-2">
                Currently Linked ({existingLinks.length})
              </p>
              <div className="space-y-1">
                {existingLinks.map((link) => (
                  <div
                    key={link.id}
                    className="flex items-center justify-between p-2 rounded-md bg-emerald-50/50"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-amber-600">{link.key}</span>
                        <span className="text-xs text-[#9CA39A]">{link.issueType}</span>
                      </div>
                      <p className="text-sm text-[#1A1A18] truncate">{link.title}</p>
                    </div>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1 text-[#9CA39A] hover:text-amber-600"
                    >
                      <ExternalLink size={12} />
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SuggestionRow({
  jiraKey,
  summary,
  confidence,
  reason,
  linked,
}: {
  jiraKey: string;
  summary: string;
  confidence: number;
  reason: string;
  linked: boolean;
}) {
  const confPct = Math.round(confidence * 100);
  const confColor =
    confPct >= 80
      ? "text-emerald-600 bg-emerald-50"
      : confPct >= 50
        ? "text-amber-600 bg-amber-50"
        : "text-red-600 bg-red-50";

  return (
    <div className="flex items-center justify-between p-2 rounded-md hover:bg-[#FAFAF9] transition-colors">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-amber-600">{jiraKey}</span>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${confColor}`}>
            {confPct}%
          </span>
        </div>
        <p className="text-sm text-[#1A1A18] truncate">{summary}</p>
        <p className="text-xs text-[#9CA39A] truncate">{reason}</p>
      </div>
      {linked ? (
        <span className="text-xs text-emerald-600 font-medium px-2">Linked</span>
      ) : (
        <button className="p-1 rounded hover:bg-amber-50 text-[#9CA39A] hover:text-amber-600">
          <Link2 size={14} />
        </button>
      )}
    </div>
  );
}
