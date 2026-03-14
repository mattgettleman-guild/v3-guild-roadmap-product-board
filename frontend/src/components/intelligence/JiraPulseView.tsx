import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle,
  Clock,
  ExternalLink,
  Calendar,
  Loader2,
} from "lucide-react";
import { api } from "../../lib/api";

export function JiraPulseView() {
  const [activeTab, setActiveTab] = useState<"accomplishments" | "upcoming">(
    "accomplishments",
  );
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );

  const accomplishments = useQuery({
    queryKey: ["jira-accomplishments", startDate, endDate],
    queryFn: () => api.fetchAccomplishments(startDate, endDate),
    enabled: activeTab === "accomplishments",
  });

  const upcoming = useQuery({
    queryKey: ["jira-upcoming", startDate, endDate],
    queryFn: () =>
      api.fetchUpcoming({ dueDateFrom: startDate, dueDateTo: endDate }),
    enabled: activeTab === "upcoming",
  });

  const items =
    activeTab === "accomplishments"
      ? accomplishments.data ?? []
      : upcoming.data ?? [];
  const isLoading =
    activeTab === "accomplishments"
      ? accomplishments.isLoading
      : upcoming.isLoading;

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex rounded-lg border border-[#E5E5E3] overflow-hidden">
          <button
            onClick={() => setActiveTab("accomplishments")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium cursor-pointer border-none transition-colors ${
              activeTab === "accomplishments"
                ? "bg-amber-600 text-white"
                : "bg-white text-[#6B7068] hover:bg-[#FAFAF9]"
            }`}
          >
            <CheckCircle size={12} />
            Accomplishments
          </button>
          <button
            onClick={() => setActiveTab("upcoming")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium cursor-pointer border-none transition-colors ${
              activeTab === "upcoming"
                ? "bg-amber-600 text-white"
                : "bg-white text-[#6B7068] hover:bg-[#FAFAF9]"
            }`}
          >
            <Clock size={12} />
            Upcoming
          </button>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-2 py-1 text-xs border border-[#E5E5E3] rounded-lg bg-white text-[#1A1A18]"
          />
          <span className="text-xs text-[#9CA39A]">to</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-2 py-1 text-xs border border-[#E5E5E3] rounded-lg bg-white text-[#1A1A18]"
          />
        </div>
        <div className="flex-1" />
        <span className="text-xs text-[#9CA39A]">{items.length} issues</span>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={20} className="animate-spin text-[#9CA39A]" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12">
          <Calendar size={40} className="mx-auto mb-3 text-[#E5E5E3]" />
          <p className="text-sm text-[#9CA39A]">
            {activeTab === "accomplishments"
              ? "No completed issues in this period."
              : "No upcoming issues in this period."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((issue) => (
            <div
              key={issue.key}
              className="flex items-center gap-3 bg-white border border-[#E5E5E3] rounded-lg px-4 py-3 hover:shadow-sm transition-shadow"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-xs font-mono text-amber-600">
                    {issue.key}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#FAFAF9] text-[#6B7068] border border-[#E5E5E3]">
                    {issue.issueType}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#FAFAF9] text-[#6B7068] border border-[#E5E5E3]">
                    {issue.status}
                  </span>
                </div>
                <p className="text-sm text-[#1A1A18] truncate">
                  {issue.summary}
                </p>
                <div className="flex items-center gap-2 mt-1 text-[10px] text-[#9CA39A]">
                  {issue.assignee && <span>{issue.assignee}</span>}
                  {issue.priority && (
                    <span>&middot; {issue.priority}</span>
                  )}
                  {issue.labels.length > 0 && (
                    <span>&middot; {issue.labels.join(", ")}</span>
                  )}
                </div>
              </div>
              <a
                href={issue.url}
                target="_blank"
                rel="noreferrer"
                className="p-1.5 rounded hover:bg-[#FAFAF9] text-[#9CA39A] hover:text-amber-600 shrink-0"
              >
                <ExternalLink size={12} />
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
