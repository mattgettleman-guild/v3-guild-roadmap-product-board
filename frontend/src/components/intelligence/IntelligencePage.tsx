import { useSearch, useNavigate } from "@tanstack/react-router";
import { AiAssistantView } from "./AiAssistantView";
import { KnowledgeBaseView } from "./KnowledgeBaseView";
import { ChangelogView } from "./ChangelogView";
import { JiraPulseView } from "./JiraPulseView";
import { SummaryPanel } from "./SummaryPanel";

const TABS = [
  { key: "ai", label: "AI Chat" },
  { key: "summary", label: "AI Summaries" },
  { key: "kb", label: "Knowledge Base" },
  { key: "changelog", label: "Changelog" },
  { key: "pulse", label: "Jira Pulse" },
] as const;

export function IntelligencePage() {
  const search = useSearch({ from: "/intelligence/" });
  const navigate = useNavigate({ from: "/intelligence/" });
  const section = (search as { section?: string }).section ?? "ai";

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-5 pb-0">
        <h1 className="text-2xl font-bold text-[#1A1A18] tracking-tight mb-4">
          Intelligence
        </h1>
        <div className="flex border-b border-[#E5E5E3]">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() =>
                navigate({
                  search: (p: Record<string, unknown>) => ({
                    ...p,
                    section: tab.key,
                  }),
                })
              }
              className={`px-4 py-2.5 text-sm border-b-2 -mb-px transition-colors cursor-pointer bg-transparent ${
                section === tab.key
                  ? "border-amber-600 text-amber-600 font-medium"
                  : "border-transparent text-[#6B7068] hover:text-[#1A1A18]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        {section === "ai" && <AiAssistantView />}
        {section === "summary" && <SummaryPanel />}
        {section === "kb" && <KnowledgeBaseView />}
        {section === "changelog" && <ChangelogView />}
        {section === "pulse" && <JiraPulseView />}
      </div>
    </div>
  );
}
