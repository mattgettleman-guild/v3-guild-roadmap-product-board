/**
 * ExternalShareModal — generates a public share link for externally-approved investments.
 */
import { useState } from "react";
import { X, Link2, Copy, Check, Globe, Loader2 } from "lucide-react";
import { api } from "../../lib/api";

const AUDIENCES = [
  { key: "all", label: "All external approved" },
  { key: "exec", label: "Executives" },
  { key: "product", label: "Product Team" },
  { key: "eps", label: "EPS" },
  { key: "sales", label: "Sales / GTM" },
  { key: "employers", label: "Employer Partners" },
];

interface Props {
  onClose: () => void;
}

export function ExternalShareModal({ onClose }: Props) {
  const [audience, setAudience] = useState("all");
  const [loading, setLoading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.createShareToken(audience);
      setShareUrl(result.url);
    } catch {
      setError("Failed to generate link. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-[480px] max-w-[95vw] p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Globe size={18} className="text-amber-600" />
            <h2 className="text-base font-semibold text-[#1A1A18]">Share Roadmap</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[#FAFAF9] text-[#9CA39A]">
            <X size={16} />
          </button>
        </div>

        <p className="text-sm text-[#6B7068] mb-4">
          Generate a public link showing only investments marked as{" "}
          <span className="font-medium text-[#1A1A18]">External Approved</span>.
          No login required to view.
        </p>

        {/* Audience selector */}
        <div className="mb-4">
          <label className="text-xs font-medium text-[#9CA39A] uppercase tracking-wide mb-1.5 block">
            Audience
          </label>
          <div className="grid grid-cols-2 gap-2">
            {AUDIENCES.map((a) => (
              <button
                key={a.key}
                onClick={() => setAudience(a.key)}
                className={`text-left px-3 py-2 text-sm rounded-lg border transition-colors ${
                  audience === a.key
                    ? "border-amber-400 bg-amber-50 text-amber-700 font-medium"
                    : "border-[#E5E5E3] text-[#6B7068] hover:bg-[#FAFAF9]"
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>

        {/* Generate button */}
        {!shareUrl && (
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />}
            {loading ? "Generating…" : "Generate Link"}
          </button>
        )}

        {/* Share URL */}
        {shareUrl && (
          <div className="mt-2">
            <div className="flex items-center gap-2 p-3 bg-[#FAFAF9] border border-[#E5E5E3] rounded-lg">
              <span className="flex-1 text-sm text-[#1A1A18] truncate font-mono">{shareUrl}</span>
              <button
                onClick={handleCopy}
                className="shrink-0 flex items-center gap-1.5 text-sm px-3 py-1.5 bg-white border border-[#E5E5E3] rounded hover:bg-[#F0F0EE] transition-colors"
              >
                {copied ? <Check size={13} className="text-green-600" /> : <Copy size={13} />}
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <p className="text-xs text-[#9CA39A] mt-2">
              Anyone with this link can view the roadmap without logging in.
            </p>
            <button
              onClick={() => { setShareUrl(null); setCopied(false); }}
              className="mt-2 text-xs text-amber-600 hover:text-amber-700"
            >
              Generate another link
            </button>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
