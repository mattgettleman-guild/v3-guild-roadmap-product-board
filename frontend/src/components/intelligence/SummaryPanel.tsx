/**
 * SummaryPanel — AI-generated executive summaries, investment writeups, and quarterly reports.
 * Three modes: executive, investment, quarterly.
 */
import { useState } from "react";
import { useRows } from "../../hooks/useRows";
import { useTaxonomy } from "../../hooks/useTaxonomy";
import { Sparkles, Copy, Check, Loader2, Trash2, Clock } from "lucide-react";
import { api } from "../../lib/api";

type Mode = "executive" | "investment" | "quarterly";

interface WriteupHistoryEntry {
  id: string;
  timestamp: string;
  tone: "concise" | "detailed";
  status: string;
  completionEstimate: string;
  writeup: string;
}

const STORAGE_PREFIX = "writeup_history_";

function loadHistory(id: string): WriteupHistoryEntry[] {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${id}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(id: string, entries: WriteupHistoryEntry[]) {
  localStorage.setItem(`${STORAGE_PREFIX}${id}`, JSON.stringify(entries.slice(0, 10)));
}

export function SummaryPanel() {
  const [mode, setMode] = useState<Mode>("executive");

  return (
    <div className="flex flex-col h-full p-5">
      <div className="flex items-center gap-1 mb-5 bg-[#FAFAF9] border border-[#E5E5E3] rounded-lg p-1 w-fit">
        {(["executive", "investment", "quarterly"] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-4 py-1.5 text-sm rounded transition-colors ${
              mode === m ? "bg-white text-[#1A1A18] shadow-sm font-medium" : "text-[#6B7068] hover:text-[#1A1A18]"
            }`}
          >
            {m === "executive" ? "Executive Summary" : m === "investment" ? "Investment Writeup" : "Quarterly Report"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {mode === "executive" && <ExecutiveSummaryMode />}
        {mode === "investment" && <InvestmentWriteupMode />}
        {mode === "quarterly" && <QuarterlyReportMode />}
      </div>
    </div>
  );
}

// ── Executive Summary ──────────────────────────────────────────────────────

function ExecutiveSummaryMode() {
  const { data: taxonomy } = useTaxonomy();
  const [scopeType, setScopeType] = useState<"pillar" | "priority">("pillar");
  const [scopeName, setScopeName] = useState("");
  const [tone, setTone] = useState<"concise" | "detailed">("concise");
  const [audience, setAudience] = useState<"internal" | "board">("internal");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ summary: string; highlights: string[]; risks: string[] } | null>(null);
  const [copied, setCopied] = useState(false);

  const options = scopeType === "pillar" ? (taxonomy?.pillars ?? []) : (taxonomy?.priorities ?? []);

  const handleGenerate = async () => {
    if (!scopeName) return;
    setLoading(true);
    try {
      const r = await api.generateExecutiveSummary(scopeType, scopeName, { tone, audience });
      setResult(r);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-[#9CA39A] block mb-1">Scope</label>
          <select value={scopeType} onChange={(e) => { setScopeType(e.target.value as "pillar" | "priority"); setScopeName(""); }}
            className="w-full text-sm border border-[#E5E5E3] rounded px-2 py-1.5 focus:outline-none focus:border-amber-400">
            <option value="pillar">Strategic Pillar</option>
            <option value="priority">Product Priority</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-[#9CA39A] block mb-1">{scopeType === "pillar" ? "Pillar" : "Priority"}</label>
          <select value={scopeName} onChange={(e) => setScopeName(e.target.value)}
            className="w-full text-sm border border-[#E5E5E3] rounded px-2 py-1.5 focus:outline-none focus:border-amber-400">
            <option value="">Select…</option>
            {options.map((o) => <option key={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-[#9CA39A] block mb-1">Tone</label>
          <select value={tone} onChange={(e) => setTone(e.target.value as "concise" | "detailed")}
            className="w-full text-sm border border-[#E5E5E3] rounded px-2 py-1.5 focus:outline-none focus:border-amber-400">
            <option value="concise">Concise</option>
            <option value="detailed">Detailed</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-[#9CA39A] block mb-1">Audience</label>
          <select value={audience} onChange={(e) => setAudience(e.target.value as "internal" | "board")}
            className="w-full text-sm border border-[#E5E5E3] rounded px-2 py-1.5 focus:outline-none focus:border-amber-400">
            <option value="internal">Internal</option>
            <option value="board">Board</option>
          </select>
        </div>
      </div>

      <button
        onClick={handleGenerate}
        disabled={loading || !scopeName}
        className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
        {loading ? "Generating…" : "Generate Summary"}
      </button>

      {result && (
        <SummaryOutput
          text={result.summary}
          highlights={result.highlights}
          risks={result.risks}
          copied={copied}
          onCopy={() => { navigator.clipboard.writeText(result.summary); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
        />
      )}
    </div>
  );
}

// ── Investment Writeup ────────────────────────────────────────────────────

function InvestmentWriteupMode() {
  const { data: rows = [] } = useRows();
  const [investmentId, setInvestmentId] = useState("");
  const [tone, setTone] = useState<"concise" | "detailed">("concise");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ writeup: string; status: string; completionEstimate: string } | null>(null);
  const [history, setHistory] = useState<WriteupHistoryEntry[]>(investmentId ? loadHistory(investmentId) : []);
  const [copied, setCopied] = useState(false);

  const handleSelect = (id: string) => {
    setInvestmentId(id);
    setHistory(loadHistory(id));
    setResult(null);
  };

  const handleGenerate = async () => {
    if (!investmentId) return;
    setLoading(true);
    try {
      const r = await api.generateInvestmentWriteup(investmentId, tone);
      setResult(r);
      const entry: WriteupHistoryEntry = {
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        tone,
        status: r.status,
        completionEstimate: r.completionEstimate,
        writeup: r.writeup,
      };
      const newHistory = [entry, ...history];
      saveHistory(investmentId, newHistory);
      setHistory(newHistory);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-xs text-[#9CA39A] block mb-1">Investment</label>
          <select value={investmentId} onChange={(e) => handleSelect(e.target.value)}
            className="w-full text-sm border border-[#E5E5E3] rounded px-2 py-1.5 focus:outline-none focus:border-amber-400">
            <option value="">Select investment…</option>
            {rows.map((r) => <option key={r.id} value={r.id}>{r.investment}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-[#9CA39A] block mb-1">Tone</label>
          <select value={tone} onChange={(e) => setTone(e.target.value as "concise" | "detailed")}
            className="w-full text-sm border border-[#E5E5E3] rounded px-2 py-1.5 focus:outline-none focus:border-amber-400">
            <option value="concise">Concise</option>
            <option value="detailed">Detailed</option>
          </select>
        </div>
      </div>

      <button
        onClick={handleGenerate}
        disabled={loading || !investmentId}
        className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
        {loading ? "Generating…" : "Generate Writeup"}
      </button>

      {result && (
        <>
          {result.status && (
            <div className="flex gap-4 text-xs text-[#6B7068]">
              <span>Status: <span className="font-medium text-[#1A1A18]">{result.status}</span></span>
              <span>Completion: <span className="font-medium text-[#1A1A18]">{result.completionEstimate}</span></span>
            </div>
          )}
          <SummaryOutput
            text={result.writeup}
            copied={copied}
            onCopy={() => { navigator.clipboard.writeText(result.writeup); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          />
        </>
      )}

      {history.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-medium text-[#9CA39A] uppercase tracking-wide mb-2">History</h3>
          <div className="space-y-2">
            {history.map((entry) => (
              <div key={entry.id} className="flex items-start gap-3 p-3 border border-[#E5E5E3] rounded-lg">
                <Clock size={13} className="text-[#9CA39A] mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs text-[#6B7068]">
                    <span>{new Date(entry.timestamp).toLocaleDateString()}</span>
                    <span>·</span>
                    <span className="capitalize">{entry.tone}</span>
                    {entry.status && <><span>·</span><span>{entry.status}</span></>}
                  </div>
                  <p className="text-sm text-[#1A1A18] mt-1 line-clamp-2">{entry.writeup}</p>
                </div>
                <button
                  onClick={() => {
                    const updated = history.filter((h) => h.id !== entry.id);
                    saveHistory(investmentId, updated);
                    setHistory(updated);
                  }}
                  className="shrink-0 text-[#9CA39A] hover:text-red-500"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Quarterly Report ──────────────────────────────────────────────────────

function QuarterlyReportMode() {
  const { data: taxonomy } = useTaxonomy();
  const [quarter, setQuarter] = useState("");
  const [audience, setAudience] = useState<"internal" | "board">("internal");
  const [pillarFilter, setPillarFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ report: string; sections: Array<{ title: string; content: string }>; keyMetrics: string[] } | null>(null);
  const [copied, setCopied] = useState(false);

  const currentQuarter = (() => {
    const d = new Date();
    return `Q${Math.ceil((d.getMonth() + 1) / 3)} ${d.getFullYear()}`;
  })();

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const r = await api.generateQuarterlyReport({
        quarter: quarter || currentQuarter,
        audience,
        pillarFilter: pillarFilter || undefined,
      });
      setResult(r);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-[#9CA39A] block mb-1">Quarter</label>
          <input
            value={quarter}
            onChange={(e) => setQuarter(e.target.value)}
            placeholder={currentQuarter}
            className="w-full text-sm border border-[#E5E5E3] rounded px-2 py-1.5 focus:outline-none focus:border-amber-400"
          />
        </div>
        <div>
          <label className="text-xs text-[#9CA39A] block mb-1">Audience</label>
          <select value={audience} onChange={(e) => setAudience(e.target.value as "internal" | "board")}
            className="w-full text-sm border border-[#E5E5E3] rounded px-2 py-1.5 focus:outline-none focus:border-amber-400">
            <option value="internal">Internal</option>
            <option value="board">Board</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-[#9CA39A] block mb-1">Filter by Pillar (optional)</label>
          <select value={pillarFilter} onChange={(e) => setPillarFilter(e.target.value)}
            className="w-full text-sm border border-[#E5E5E3] rounded px-2 py-1.5 focus:outline-none focus:border-amber-400">
            <option value="">All pillars</option>
            {(taxonomy?.pillars ?? []).map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
      </div>

      <button
        onClick={handleGenerate}
        disabled={loading}
        className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
        {loading ? "Generating…" : "Generate Report"}
      </button>

      {result && (
        <>
          {result.sections?.length > 0 && (
            <div className="space-y-3">
              {result.sections.map((s, i) => (
                <div key={i} className="border border-[#E5E5E3] rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-[#1A1A18] mb-1">{s.title}</h3>
                  <p className="text-sm text-[#6B7068] whitespace-pre-wrap">{s.content}</p>
                </div>
              ))}
            </div>
          )}
          {result.keyMetrics?.length > 0 && (
            <div className="border border-[#E5E5E3] rounded-lg p-4">
              <h3 className="text-sm font-semibold text-[#1A1A18] mb-2">Key Metrics</h3>
              <ul className="list-disc list-inside space-y-1">
                {result.keyMetrics.map((m, i) => (
                  <li key={i} className="text-sm text-[#6B7068]">{m}</li>
                ))}
              </ul>
            </div>
          )}
          <SummaryOutput
            text={result.report}
            copied={copied}
            onCopy={() => { navigator.clipboard.writeText(result.report); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          />
        </>
      )}
    </div>
  );
}

// ── Shared output component ────────────────────────────────────────────────

function SummaryOutput({
  text,
  highlights,
  risks,
  copied,
  onCopy,
}: {
  text: string;
  highlights?: string[];
  risks?: string[];
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="border border-[#E5E5E3] rounded-lg p-4 bg-[#FAFAF9]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-[#9CA39A] uppercase tracking-wide">Output</span>
          <button
            onClick={onCopy}
            className="flex items-center gap-1.5 text-xs text-[#6B7068] hover:text-[#1A1A18] border border-[#E5E5E3] rounded px-2 py-1 bg-white"
          >
            {copied ? <Check size={11} className="text-green-600" /> : <Copy size={11} />}
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <p className="text-sm text-[#1A1A18] whitespace-pre-wrap leading-relaxed">{text}</p>
      </div>

      {highlights && highlights.length > 0 && (
        <div className="border border-green-200 bg-green-50 rounded-lg p-3">
          <h4 className="text-xs font-semibold text-green-700 mb-1 uppercase tracking-wide">Highlights</h4>
          <ul className="space-y-0.5">
            {highlights.map((h, i) => <li key={i} className="text-sm text-green-800">• {h}</li>)}
          </ul>
        </div>
      )}

      {risks && risks.length > 0 && (
        <div className="border border-amber-200 bg-amber-50 rounded-lg p-3">
          <h4 className="text-xs font-semibold text-amber-700 mb-1 uppercase tracking-wide">Risks</h4>
          <ul className="space-y-0.5">
            {risks.map((r, i) => <li key={i} className="text-sm text-amber-800">• {r}</li>)}
          </ul>
        </div>
      )}

      <p className="text-[10px] text-[#9CA39A] italic">
        AI-generated content. Review and edit before sharing.
      </p>
    </div>
  );
}
