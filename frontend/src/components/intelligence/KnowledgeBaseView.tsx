import { useState, useMemo } from "react";
import {
  Upload,
  Search,
  FileText,
  Trash2,
  ExternalLink,
  Filter,
  RefreshCw,
  Link as LinkIcon,
  Loader2,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type KBDocument } from "../../lib/api";

const DOC_TYPE_LABELS: Record<string, string> = {
  por: "POR Deck",
  strategy: "Strategy Doc",
  recap: "Monthly Recap",
  release_announcement: "Release Announcement",
  reference: "Reference",
};

const STATUS_COLORS: Record<string, string> = {
  ready: "bg-emerald-100 text-emerald-700",
  processing: "bg-amber-100 text-amber-700",
  uploading: "bg-blue-100 text-blue-700",
  error: "bg-red-100 text-red-700",
};

export function KnowledgeBaseView() {
  const qc = useQueryClient();
  const [filterType, setFilterType] = useState("");
  const [filterInitiative, setFilterInitiative] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ["kb-documents", filterType, filterInitiative],
    queryFn: () =>
      api.kbListDocuments({
        type: filterType || undefined,
        initiative: filterInitiative || undefined,
      }),
  });

  const searchResults = useQuery({
    queryKey: ["kb-search", searchQuery],
    queryFn: () => api.kbSearch(searchQuery),
    enabled: showSearch && searchQuery.length > 2,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.kbDeleteDocument(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["kb-documents"] }),
  });

  const reprocessMutation = useMutation({
    mutationFn: (id: string) => api.kbReprocessDocument(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["kb-documents"] }),
  });

  const [uploading, setUploading] = useState(false);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await api.kbUploadDocument(file, { documentType: "reference" });
      qc.invalidateQueries({ queryKey: ["kb-documents"] });
    } catch {}
    setUploading(false);
    e.target.value = "";
  }

  const docTypes = useMemo(
    () => [...new Set(documents.map((d) => d.documentType))].sort(),
    [documents],
  );

  const initiatives = useMemo(
    () =>
      [
        ...new Set(
          documents.map((d) => d.initiative).filter(Boolean) as string[],
        ),
      ].sort(),
    [documents],
  );

  return (
    <div className="p-5 space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-1.5 px-3 py-2 bg-amber-600 text-white rounded-lg text-xs font-medium hover:bg-amber-700 cursor-pointer transition-colors">
          <Upload size={12} />
          Upload Document
          <input
            type="file"
            className="hidden"
            onChange={handleUpload}
            accept=".pdf,.docx,.txt,.md"
          />
        </label>
        {uploading && (
          <span className="text-xs text-[#9CA39A] flex items-center gap-1">
            <Loader2 size={12} className="animate-spin" /> Uploading...
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={() => setShowSearch((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
            showSearch
              ? "bg-amber-50 text-amber-700 border border-amber-300"
              : "text-[#6B7068] border border-[#E5E5E3] bg-white hover:bg-[#FAFAF9]"
          }`}
        >
          <Search size={12} />
          Search
        </button>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="px-3 py-1.5 text-xs border border-[#E5E5E3] rounded-lg bg-white text-[#1A1A18]"
        >
          <option value="">All Types</option>
          {docTypes.map((t) => (
            <option key={t} value={t}>
              {DOC_TYPE_LABELS[t] || t}
            </option>
          ))}
        </select>
        <select
          value={filterInitiative}
          onChange={(e) => setFilterInitiative(e.target.value)}
          className="px-3 py-1.5 text-xs border border-[#E5E5E3] rounded-lg bg-white text-[#1A1A18]"
        >
          <option value="">All Initiatives</option>
          {initiatives.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
      </div>

      {/* Search */}
      {showSearch && (
        <div className="bg-white border border-[#E5E5E3] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Search size={14} className="text-[#9CA39A]" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search across all documents..."
              className="flex-1 bg-transparent border-none outline-none text-sm text-[#1A1A18] placeholder:text-[#9CA39A]"
              autoFocus
            />
          </div>
          {searchResults.data && searchResults.data.length > 0 && (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {searchResults.data.map((r, i) => (
                <div
                  key={i}
                  className="border border-[#E5E5E3] rounded-lg p-3"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <FileText size={12} className="text-[#9CA39A]" />
                    <span className="text-xs font-medium text-[#1A1A18]">
                      {r.document.filename}
                    </span>
                    <span className="text-[10px] text-[#9CA39A]">
                      {Math.round(r.similarity * 100)}% match
                    </span>
                  </div>
                  <p className="text-xs text-[#6B7068] line-clamp-2">
                    {r.chunk.content}
                  </p>
                </div>
              ))}
            </div>
          )}
          {searchResults.data && searchResults.data.length === 0 && searchQuery.length > 2 && (
            <p className="text-xs text-[#9CA39A] text-center py-2">
              No results found
            </p>
          )}
        </div>
      )}

      {/* Document list */}
      {isLoading ? (
        <p className="text-sm text-[#9CA39A]">Loading documents...</p>
      ) : documents.length === 0 ? (
        <div className="text-center py-12">
          <FileText size={40} className="mx-auto mb-3 text-[#E5E5E3]" />
          <p className="text-sm text-[#9CA39A]">
            No documents yet. Upload your first document above.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center gap-3 bg-white border border-[#E5E5E3] rounded-lg px-4 py-3 hover:shadow-sm transition-shadow group"
            >
              <FileText size={16} className="text-[#9CA39A] shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[#1A1A18] truncate">
                    {doc.filename}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${STATUS_COLORS[doc.status] || "bg-[#FAFAF9] text-[#9CA39A]"}`}
                  >
                    {doc.status}
                  </span>
                  <span className="text-[10px] text-[#9CA39A] bg-[#FAFAF9] px-1.5 py-0.5 rounded-full">
                    {DOC_TYPE_LABELS[doc.documentType] || doc.documentType}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-0.5 text-[11px] text-[#9CA39A]">
                  {doc.initiative && <span>{doc.initiative}</span>}
                  {doc.timePeriod && <span>{doc.timePeriod}</span>}
                  <span>
                    {(doc.fileSize / 1024).toFixed(0)} KB
                  </span>
                  {doc.chunkCount !== undefined && (
                    <span>{doc.chunkCount} chunks</span>
                  )}
                  {doc.linkCount !== undefined && doc.linkCount > 0 && (
                    <span className="flex items-center gap-0.5">
                      <LinkIcon size={9} />
                      {doc.linkCount} linked
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <a
                  href={api.kbGetFileUrl(doc.id)}
                  target="_blank"
                  rel="noreferrer"
                  className="p-1.5 rounded hover:bg-[#FAFAF9] text-[#9CA39A] hover:text-[#1A1A18]"
                >
                  <ExternalLink size={12} />
                </a>
                <button
                  onClick={() => reprocessMutation.mutate(doc.id)}
                  className="p-1.5 rounded hover:bg-[#FAFAF9] text-[#9CA39A] hover:text-amber-600 cursor-pointer bg-transparent border-none"
                >
                  <RefreshCw size={12} />
                </button>
                <button
                  onClick={() => deleteMutation.mutate(doc.id)}
                  className="p-1.5 rounded hover:bg-red-50 text-[#9CA39A] hover:text-red-500 cursor-pointer bg-transparent border-none"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
