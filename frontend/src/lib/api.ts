import type {
  ImportDraftChange,
  ImportJob,
  ImportParseHeadersResponse,
  JiraLink,
  MetricDefinition,
  PdfImportResult,
  Priority,
  RoadmapRow,
  SavedView,
  SlideExtraction,
} from "@roadmap/shared";
import type { SlideMatchResult } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE || "";

export interface AiThread {
  id: string;
  title: string;
  createdBy: string;
  contextType: string | null;
  contextId: string | null;
  contextLabel: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiMessage {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  citations: string[];
  metadata: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
}

export interface AiContextDocument {
  id: string;
  filename: string;
  fileSize: number;
  mimeType: string;
  status: string;
  errorMessage: string | null;
  uploadedBy: string;
  createdAt: string;
  textLength: number;
}

export interface KBDocumentAiContent {
  summary: string;
  benefits: string[];
  transformations?: Array<{ from: string; to: string; impact: string }>;
  talkingPoints: {
    today: string[];
    committed: string[];
  };
}

export interface KBDocument {
  id: string;
  filename: string;
  fileSize: number;
  mimeType: string;
  storageKey: string;
  documentType: string;
  initiative: string | null;
  productPriority: string | null;
  timePeriod: string | null;
  timePeriodDate: string | null;
  status: string;
  errorMessage: string | null;
  version: number;
  supersededBy: string | null;
  isArchived: boolean;
  uploadedBy: string;
  aiContent: KBDocumentAiContent | null;
  createdAt: string;
  updatedAt: string;
  chunkCount?: number;
  linkCount?: number;
}

export interface KBDocumentChunk {
  id: string;
  documentId: string;
  content: string;
  sectionType: string | null;
  month: string | null;
  initiative: string | null;
  sequence: number;
  embeddingModel: string | null;
  tokenCount: number | null;
  jiraKeys: string[];
  createdAt: string;
}

export interface KBDocumentLink {
  id: string;
  documentId: string;
  rowId: string;
  tacticId: string | null;
  linkType: string;
  confidence: number | null;
  matchReason: string | null;
  matchLevel: string | null;
}

export interface KBDocumentDetail extends KBDocument {
  chunks: KBDocumentChunk[];
  links: KBDocumentLink[];
}

interface KBSearchResult {
  chunk: {
    id: string;
    documentId: string;
    content: string;
    sectionType: string | null;
    month: string | null;
    initiative: string | null;
    jiraKeys: string[];
    tokenCount: number | null;
  };
  document: {
    id: string;
    filename: string;
    documentType: string;
    initiative: string | null;
    timePeriod: string | null;
  };
  similarity: number;
  combinedScore: number;
}

let onUnauthorized: (() => void) | null = null;

export function setOnUnauthorized(cb: () => void) {
  onUnauthorized = cb;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
    credentials: "include",
    ...init,
  });
  if (res.status === 401) {
    onUnauthorized?.();
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    let errorMsg = `Request failed (${res.status})`;
    try {
      const errorBody = await res.json();
      if (errorBody.error) errorMsg = errorBody.error;
    } catch {}
    throw new Error(errorMsg);
  }
  if (res.status === 204 || res.status === 202) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export const api = {
  // ─── Rows ──────────────────────────────────────────────────────────────────
  listRows: () => request<RoadmapRow[]>("/api/roadmap/rows"),
  createRow: (body: Partial<RoadmapRow>) =>
    request<RoadmapRow>("/api/roadmap/rows", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateRow: (id: string, body: Partial<RoadmapRow>) =>
    request<RoadmapRow>(`/api/roadmap/rows/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteRow: (id: string) =>
    request<void>(`/api/roadmap/rows/${id}`, { method: "DELETE" }),
  moveJiraLink: (rowId: string, body: { jiraLinkId: string; fromTacticId?: string; toTacticId?: string }) =>
    request<RoadmapRow>(`/api/roadmap/rows/${rowId}/move-jira-link`, {
      method: "POST",
      body: JSON.stringify(body),
    }),

  // ─── Taxonomy ──────────────────────────────────────────────────────────────
  listTaxonomy: () =>
    request<{ pillars: string[]; priorities: string[]; domains: string[]; owners: string[]; tags: string[]; themes: string[]; subDomains: string[] }>("/api/taxonomy"),
  listSettings: () =>
    request<{ taxonomy: { pillars: string[]; priorities: string[]; domains: string[]; owners: string[]; tags: string[]; themes: string[]; subDomains: string[] }; metrics: MetricDefinition[] }>(
      "/api/settings",
    ),
  updateTaxonomy: (taxonomy: { pillars: string[]; priorities: string[]; domains: string[]; owners: string[]; tags: string[]; themes: string[]; subDomains: string[] }) =>
    request<void>("/api/taxonomy", {
      method: "PATCH",
      body: JSON.stringify(taxonomy),
    }),

  // ─── Jira ──────────────────────────────────────────────────────────────────
  searchJiraIssues: (q: string) =>
    request<JiraLink[]>(`/api/jira/issues/search?q=${encodeURIComponent(q)}`),

  // ─── Metrics ───────────────────────────────────────────────────────────────
  listMetricDefinitions: () => request<MetricDefinition[]>("/api/settings/metrics"),
  createMetricDefinition: (body: Partial<MetricDefinition>) =>
    request<MetricDefinition>("/api/settings/metrics", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateMetricDefinition: (id: string, body: Partial<MetricDefinition>) =>
    request<MetricDefinition>(`/api/settings/metrics/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteMetricDefinition: (id: string) =>
    request<void>(`/api/settings/metrics/${id}`, { method: "DELETE" }),

  // ─── Views ─────────────────────────────────────────────────────────────────
  listViews: () => request<SavedView[]>("/api/views"),
  createView: (body: Partial<SavedView>) =>
    request<SavedView>("/api/views", { method: "POST", body: JSON.stringify(body) }),
  updateView: (id: string, body: Partial<SavedView>) =>
    request<SavedView>(`/api/views/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteView: (id: string) => request<void>(`/api/views/${id}`, { method: "DELETE" }),

  // ─── AI Q&A ────────────────────────────────────────────────────────────────
  askAi: (question: string, pageContext?: { contextKey: string; label: string; summary: string }) =>
    request<{ answer: string; citations: Array<{ rowId: string; issueKeys: string[] }> }>(
      "/api/ai/qna",
      {
        method: "POST",
        body: JSON.stringify({ question, pageContext }),
      },
    ),

  // ─── Import ────────────────────────────────────────────────────────────────
  listImportJobs: () =>
    request<Array<{
      id: string;
      fileName: string;
      status: string;
      createdAt: string;
      createdBy: string;
      totalChanges: number;
      accepted: number;
      rejected: number;
      pending: number;
      totalTactics: number;
    }>>("/api/import/jobs"),
  parseImportHeaders: async (file: File): Promise<ImportParseHeadersResponse> => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${API_BASE}/api/import/parse-headers`, {
      method: "POST",
      body: fd,
      credentials: "include",
    });
    if (res.status === 401) {
      onUnauthorized?.();
      throw new Error("Unauthorized");
    }
    if (!res.ok) throw new Error(`Header parse failed (${res.status})`);
    return (await res.json()) as ImportParseHeadersResponse;
  },
  uploadImport: async (file: File, headerOverrides?: Record<number, string>): Promise<ImportJob> => {
    const fd = new FormData();
    fd.append("file", file);
    if (headerOverrides && Object.keys(headerOverrides).length > 0) {
      fd.append("headerOverrides", JSON.stringify(headerOverrides));
    }
    const res = await fetch(`${API_BASE}/api/import/jobs`, {
      method: "POST",
      body: fd,
      credentials: "include",
    });
    if (res.status === 401) {
      onUnauthorized?.();
      throw new Error("Unauthorized");
    }
    if (!res.ok) throw new Error(`Import failed (${res.status})`);
    return (await res.json()) as ImportJob;
  },
  parsePasteHeaders: async (text: string): Promise<ImportParseHeadersResponse | null> => {
    const res = await fetch(`${API_BASE}/api/import/paste-headers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      credentials: "include",
    });
    if (res.status === 401) {
      onUnauthorized?.();
      throw new Error("Unauthorized");
    }
    if (!res.ok) return null;
    return (await res.json()) as ImportParseHeadersResponse;
  },
  pasteImport: async (text: string, useAi?: boolean, headerOverrides?: Record<number, string>): Promise<ImportJob> => {
    const res = await fetch(`${API_BASE}/api/import/paste`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, useAi: !!useAi, headerOverrides }),
      credentials: "include",
    });
    if (res.status === 401) {
      onUnauthorized?.();
      throw new Error("Unauthorized");
    }
    if (res.status === 422) {
      const body = await res.json();
      throw new Error(body.error || "Could not parse pasted data");
    }
    if (!res.ok) throw new Error(`Paste import failed (${res.status})`);
    return (await res.json()) as ImportJob;
  },
  getImportDraft: (id: string) => request<ImportDraftChange[]>(`/api/import/jobs/${id}/draft`),
  updateImportDraft: (jobId: string, changeId: string, status: "accepted" | "rejected" | "pending", proposed?: Partial<{ strategicPillar: string; productPriority: string; domain: string }>, tacticActions?: Record<string, string>, extra?: Record<string, unknown>) =>
    request<void>(`/api/import/jobs/${jobId}/draft/${changeId}`, {
      method: "PATCH",
      body: JSON.stringify({ status, ...(proposed ? { proposed } : {}), ...(tacticActions ? { tacticActions } : {}), ...(extra || {}) }),
    }),
  updateImportDraftField: (jobId: string, changeId: string, field: string, value: string) =>
    request<void>(`/api/import/jobs/${jobId}/draft/${changeId}/field`, {
      method: "PATCH",
      body: JSON.stringify({ field, value }),
    }),
  bulkUpdateDraftStatus: (jobId: string, status: "accepted" | "rejected" | "pending") =>
    request<{ updatedCount: number }>(`/api/import/jobs/${jobId}/draft-bulk-status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  commitImport: (id: string) =>
    request<{ committedCount: number }>(`/api/import/jobs/${id}/commit`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  deleteImportJob: (id: string) =>
    request<{ ok: boolean }>(`/api/import/jobs/${id}`, { method: "DELETE" }),
  undoImport: (id: string) =>
    request<{ ok: boolean; removedCount: number }>(`/api/import/jobs/${id}/undo`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  // ─── Audits ────────────────────────────────────────────────────────────────
  listAudits: (filters?: { entityType?: string; action?: string; actor?: string; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    if (filters?.entityType) params.set("entityType", filters.entityType);
    if (filters?.action) params.set("action", filters.action);
    if (filters?.actor) params.set("actor", filters.actor);
    if (filters?.limit) params.set("limit", String(filters.limit));
    if (filters?.offset) params.set("offset", String(filters.offset));
    const qs = params.toString();
    return request<{
      events: Array<{
        id: string;
        entityType: string;
        entityId: string;
        action: string;
        actor: string;
        timestamp: string;
        payload?: Record<string, unknown>;
      }>;
      total: number;
      limit: number;
      offset: number;
    }>(`/api/audits${qs ? `?${qs}` : ""}`);
  },

  // ─── Changelog ─────────────────────────────────────────────────────────────
  listChangelog: (filters?: {
    startDate?: string;
    endDate?: string;
    changeType?: string;
    entityType?: string;
    entityId?: string;
    strategicPillar?: string;
    productPriority?: string;
    domain?: string;
    owner?: string;
    tag?: string;
    theme?: string;
    subDomain?: string;
    visibility?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }) => {
    const params = new URLSearchParams();
    if (filters) {
      for (const [k, v] of Object.entries(filters)) {
        if (v !== undefined && v !== "") params.set(k, String(v));
      }
    }
    const qs = params.toString();
    return request<{
      events: Array<{
        id: string;
        entityType: string;
        entityId: string;
        investmentId: string | null;
        fieldName: string;
        oldValue: unknown;
        newValue: unknown;
        changeType: string;
        changedBy: string;
        changedAt: string;
        source: string;
        gtmActionNeeded: boolean;
        pmNote: string | null;
        impactLevel: string | null;
        investmentName: string | null;
        productPriority: string | null;
        domain: string | null;
        strategicPillar: string | null;
        subDomain: string | null;
      }>;
      total: number;
      limit: number;
      offset: number;
      countsByType: Record<string, number>;
    }>(`/api/changelog${qs ? `?${qs}` : ""}`);
  },
  updateChangelogNote: (id: string, data: { pmNote?: string; gtmActionNeeded?: boolean }) =>
    request<{
      id: string;
      entityType: string;
      entityId: string;
      investmentId: string | null;
      fieldName: string;
      oldValue: unknown;
      newValue: unknown;
      changeType: string;
      changedBy: string;
      changedAt: string;
      source: string;
      gtmActionNeeded: boolean;
      pmNote: string | null;
      impactLevel: string | null;
    }>(`/api/changelog/${id}/note`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteChangelogEvent: (id: string) =>
    request<{ success: boolean }>(`/api/changelog/${id}`, { method: "DELETE" }),
  restoreChangelogEvent: (id: string) =>
    request<{ success: boolean }>(`/api/changelog/${id}/restore`, { method: "PATCH" }),
  listChangelogTrash: () =>
    request<{ events: Array<{
      id: string; entityType: string; entityId: string; investmentId: string | null;
      fieldName: string; oldValue: unknown; newValue: unknown; changeType: string;
      changedBy: string; changedAt: string; source: string; gtmActionNeeded: boolean;
      pmNote: string | null; impactLevel: string | null; deletedAt: string;
      investmentName: string | null; productPriority: string | null; domain: string | null;
      strategicPillar: string | null; subDomain: string | null;
    }> }>("/api/changelog/trash"),
  reverseChangelogEvent: (id: string) =>
    request<{ success: boolean }>(`/api/changelog/${id}/reverse`, { method: "POST" }),
  unreverseChangelogEvent: (id: string) =>
    request<{ success: boolean }>(`/api/changelog/${id}/unreverse`, { method: "PATCH" }),
  listChangelogReversed: () =>
    request<{ events: Array<{
      id: string; entityType: string; entityId: string; investmentId: string | null;
      fieldName: string; oldValue: unknown; newValue: unknown; changeType: string;
      changedBy: string; changedAt: string; source: string; gtmActionNeeded: boolean;
      pmNote: string | null; impactLevel: string | null; reversedAt: string;
      investmentName: string | null; productPriority: string | null; domain: string | null;
      strategicPillar: string | null; subDomain: string | null;
    }> }>("/api/changelog/reversed"),
  generateChangelogAiNote: (eventId: string, existingNote?: string) =>
    request<{ note: string }>(`/api/changelog/${eventId}/ai-note`, {
      method: "POST",
      body: JSON.stringify({ existingNote }),
    }),
  generateChangelogAiSummary: (filters: Record<string, string | undefined>) =>
    request<{ summary: string }>("/api/changelog/ai-summary", {
      method: "POST",
      body: JSON.stringify({ filters }),
    }),
  exportChangelogPdf: async (data: {
    filters: Record<string, string | undefined>;
    filterSummary: string[];
    dateRange: string;
    includeAiSummary: boolean;
    aiSummaryText?: string;
    generatedBy: string;
  }): Promise<Blob> => {
    const res = await fetch(`${API_BASE}/api/changelog/export-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      let errorMsg = `Export failed (${res.status})`;
      try {
        const errorBody = await res.json();
        if (errorBody.error) errorMsg = errorBody.error;
      } catch {}
      throw new Error(errorMsg);
    }
    return res.blob();
  },

  // ─── Alerts ────────────────────────────────────────────────────────────────
  fetchAlerts: () =>
    request<{
      alerts: Array<{
        type: string;
        severity: string;
        title: string;
        description: string;
        investmentId: string;
        investmentName: string;
        key: string;
      }>;
      readAlerts: Array<{
        type: string;
        severity: string;
        title: string;
        description: string;
        investmentId: string;
        investmentName: string;
        key: string;
      }>;
      total: number;
      unreadCount: number;
    }>("/api/alerts"),
  dismissAlerts: (keys: string[]) =>
    request<{ dismissed: string[] }>("/api/alerts/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys }),
    }),
  undismissAlerts: (keys?: string[]) =>
    request<{ dismissed: string[] }>("/api/alerts/undismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys }),
    }),

  // ─── Telemetry ─────────────────────────────────────────────────────────────
  telemetry: (type: string, payload: Record<string, unknown>) =>
    request<void>("/api/telemetry/events", {
      method: "POST",
      body: JSON.stringify({ type, payload, actor: "ui-user" }),
    }),
  adoptionMetrics: () =>
    request<{ weeklyEvents: number; viewSwitches: number; qnaQueries: number; rows: number; views: number; imports: number }>(
      "/api/metrics/adoption",
    ),

  // ─── Jira Accomplishments / Upcoming ───────────────────────────────────────
  fetchAccomplishments: (startDate?: string, endDate?: string) => {
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    const qs = params.toString();
    return request<Array<{
      key: string;
      summary: string;
      issueType: string;
      status: string;
      resolution?: string;
      assignee?: string;
      priority?: string;
      labels: string[];
      components: string[];
      resolvedDate?: string;
      updatedDate?: string;
      createdDate?: string;
      url: string;
    }>>(`/api/jira/accomplishments${qs ? `?${qs}` : ""}`);
  },
  fetchUpcoming: (opts?: { dueDateFrom?: string; dueDateTo?: string; createdFrom?: string; createdTo?: string }) => {
    const params = new URLSearchParams();
    if (opts?.dueDateFrom) params.set("dueDateFrom", opts.dueDateFrom);
    if (opts?.dueDateTo) params.set("dueDateTo", opts.dueDateTo);
    if (opts?.createdFrom) params.set("createdFrom", opts.createdFrom);
    if (opts?.createdTo) params.set("createdTo", opts.createdTo);
    const qs = params.toString();
    return request<Array<{
      key: string;
      summary: string;
      issueType: string;
      status: string;
      assignee?: string;
      priority?: string;
      labels: string[];
      components: string[];
      dueDate?: string;
      updatedDate?: string;
      createdDate?: string;
      url: string;
    }>>(`/api/jira/upcoming${qs ? `?${qs}` : ""}`);
  },
  listJiraUsers: (q?: string) =>
    request<Array<{ accountId: string; displayName: string; emailAddress?: string; avatarUrl?: string; active: boolean }>>(
      `/api/jira/users${q ? `?q=${encodeURIComponent(q)}` : ""}`,
    ),

  // ─── AI ────────────────────────────────────────────────────────────────────
  getAiStatus: () =>
    request<{ available: boolean; message: string }>("/api/ai/status"),
  suggestJiraLinks: (investmentId: string) =>
    request<Array<{ key: string; summary: string; confidence: number; reason: string }>>(
      "/api/ai/suggest-jira-links",
      { method: "POST", body: JSON.stringify({ investmentId }) },
    ),
  autoCategorize: (items: Array<{ name: string; description?: string }>) =>
    request<Array<{ name: string; pillar: string; priority: string; domain: string }>>(
      "/api/ai/auto-categorize",
      { method: "POST", body: JSON.stringify({ items }) },
    ),
  detectDuplicates: (name: string, pillar?: string, priority?: string) =>
    request<Array<{ id: string; name: string; similarity: number; reason: string }>>(
      "/api/ai/detect-duplicates",
      { method: "POST", body: JSON.stringify({ name, pillar, priority }) },
    ),
  generateExecutiveSummary: (scopeType: "pillar" | "priority", scopeName: string, opts?: { tone?: "concise" | "detailed"; audience?: "internal" | "board" }) =>
    request<{ summary: string; highlights: string[]; risks: string[] }>(
      "/api/ai/executive-summary",
      { method: "POST", body: JSON.stringify({ scopeType, scopeName, ...opts }) },
    ),
  generateInvestmentWriteup: (investmentId: string, tone?: "concise" | "detailed") =>
    request<{ writeup: string; status: string; completionEstimate: string; documentsCited: string[] }>(
      "/api/ai/investment-writeup",
      { method: "POST", body: JSON.stringify({ investmentId, tone }) },
    ),
  generateQuarterlyReport: (opts?: { quarter?: string; audience?: "internal" | "board"; pillarFilter?: string }) =>
    request<{ report: string; sections: Array<{ title: string; content: string }>; keyMetrics: string[] }>(
      "/api/ai/quarterly-report",
      { method: "POST", body: JSON.stringify(opts || {}) },
    ),
  generateTacticDescription: (tacticName: string, jiraLinks: Array<{ key: string; title: string; jiraAttributes?: { status?: string; labels?: string[]; components?: string[] } }>) =>
    request<{ description: string }>(
      "/api/ai/tactic-description",
      { method: "POST", body: JSON.stringify({ tacticName, jiraLinks }) },
    ),
  generateInvestmentDescription: (investmentName: string, tactics: Array<{ name: string; description?: string; status?: string; owner?: string; jiraLinks: Array<{ key: string; title: string }> }>, jiraLinks: Array<{ key: string; title: string; jiraAttributes?: { status?: string; labels?: string[]; components?: string[] } }>) =>
    request<{ description: string }>(
      "/api/ai/investment-description",
      { method: "POST", body: JSON.stringify({ investmentName, tactics, jiraLinks }) },
    ),
  listAiReports: (reportType?: string) =>
    request<Array<{ id: string; reportType: string; title: string; parameters: Record<string, unknown>; content: Record<string, unknown>; createdBy: string; createdAt: string }>>(
      `/api/ai/reports${reportType ? `?type=${encodeURIComponent(reportType)}` : ""}`,
    ),
  saveAiReport: (data: { reportType: string; title: string; parameters: Record<string, unknown>; content: Record<string, unknown> }) =>
    request<{ id: string; reportType: string; title: string; parameters: Record<string, unknown>; content: Record<string, unknown>; createdBy: string; createdAt: string }>(
      "/api/ai/reports",
      { method: "POST", body: JSON.stringify(data) },
    ),
  deleteAiReport: (id: string) =>
    request<{ ok: boolean }>(
      `/api/ai/reports/${id}`,
      { method: "DELETE" },
    ),

  // ─── Knowledge Base ────────────────────────────────────────────────────────
  kbListDocuments: (filters?: { type?: string; initiative?: string; productPriority?: string; period?: string; includeArchived?: boolean }) => {
    const params = new URLSearchParams();
    if (filters?.type) params.set("type", filters.type);
    if (filters?.initiative) params.set("initiative", filters.initiative);
    if (filters?.productPriority) params.set("productPriority", filters.productPriority);
    if (filters?.period) params.set("period", filters.period);
    if (filters?.includeArchived) params.set("includeArchived", "true");
    const qs = params.toString();
    return request<KBDocument[]>(`/api/kb/documents${qs ? `?${qs}` : ""}`);
  },
  kbAnalyzeUpload: async (file: File): Promise<{ documentType: string; suggestedInvestments: Array<{ id: string; name: string; confidence: number }>; suggestedPillar?: string; timePeriod: string; summary: string }> => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${API_BASE}/api/kb/analyze-upload`, {
      method: "POST",
      body: fd,
      credentials: "include",
    });
    if (res.status === 401) { onUnauthorized?.(); throw new Error("Unauthorized"); }
    if (res.status === 503) return { documentType: "reference", suggestedInvestments: [], timePeriod: "", summary: "" };
    if (!res.ok) throw new Error(`Analysis failed (${res.status})`);
    return res.json();
  },
  kbUploadDocument: async (file: File, metadata: { documentType: string; initiative?: string; timePeriod?: string; replaceDocumentId?: string; productPriority?: string }): Promise<KBDocument> => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("documentType", metadata.documentType);
    if (metadata.initiative) fd.append("initiative", metadata.initiative);
    if (metadata.timePeriod) fd.append("timePeriod", metadata.timePeriod);
    if (metadata.replaceDocumentId) fd.append("replaceDocumentId", metadata.replaceDocumentId);
    if (metadata.productPriority) fd.append("productPriority", metadata.productPriority);
    const res = await fetch(`${API_BASE}/api/kb/documents`, {
      method: "POST",
      body: fd,
      credentials: "include",
    });
    if (res.status === 401) { onUnauthorized?.(); throw new Error("Unauthorized"); }
    if (!res.ok) throw new Error(`Upload failed (${res.status})`);
    return (await res.json()) as KBDocument;
  },
  kbGetDocument: (id: string) =>
    request<KBDocumentDetail>(`/api/kb/documents/${id}`),
  kbUpdateDocument: (id: string, body: { documentType?: string; initiative?: string; timePeriod?: string }) =>
    request<KBDocument>(`/api/kb/documents/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  kbReprocessDocument: (id: string) =>
    request<{ ok: boolean }>(`/api/kb/documents/${id}/reprocess`, { method: "POST" }),
  kbDeleteDocument: (id: string) =>
    request<{ ok: boolean }>(`/api/kb/documents/${id}`, { method: "DELETE" }),
  kbSearch: (q: string, filters?: { type?: string; initiative?: string; period?: string; limit?: number }) => {
    const params = new URLSearchParams({ q });
    if (filters?.type) params.set("type", filters.type);
    if (filters?.initiative) params.set("initiative", filters.initiative);
    if (filters?.period) params.set("period", filters.period);
    if (filters?.limit) params.set("limit", String(filters.limit));
    return request<KBSearchResult[]>(`/api/kb/search?${params.toString()}`);
  },
  kbAddLink: (documentId: string, rowId: string, tacticId?: string) =>
    request<KBDocumentLink>(`/api/kb/documents/${documentId}/links`, {
      method: "POST",
      body: JSON.stringify({ rowId, tacticId, linkType: "manual" }),
    }),
  kbDeleteLink: (documentId: string, linkId: string) =>
    request<{ ok: boolean }>(`/api/kb/documents/${documentId}/links/${linkId}`, { method: "DELETE" }),
  kbConfirmLink: (documentId: string, linkId: string) =>
    request<KBDocumentLink>(`/api/kb/documents/${documentId}/links/${linkId}/confirm`, { method: "PATCH" }),
  kbDocumentsForRow: (rowId: string) =>
    request<Array<{ link: KBDocumentLink; document: KBDocument | null }>>(`/api/kb/documents-for-row/${rowId}`),
  fetchDocumentsForRow: (rowId: string) =>
    request<Array<{ document: { id: string; filename: string; status: string; documentType: string; productPriority: string | null; aiContent: KBDocumentAiContent | null }; link: { id: string; linkType: string } }>>(`/api/kb/documents-for-row/${rowId}`),
  generatePrioritySummary: (body: {
    priority: string;
    pillar: string;
    investments: Array<{
      investment: string;
      description?: string;
      expectedBenefits?: string[];
      jiraKeys?: string[];
      tactics?: Array<{ name: string; description?: string; status?: string }>;
    }>;
  }) =>
    request<{ summary: string }>("/api/external-roadmap/priority-summary", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  kbExtractDocumentContent: (id: string) =>
    request<KBDocument>(`/api/kb/documents/${id}/extract-content`, { method: "POST" }),
  linkDocumentToRow: (documentId: string, rowId: string) =>
    request<{ id: string }>(`/api/kb/documents/${documentId}/links`, {
      method: "POST",
      body: JSON.stringify({ rowId, linkType: "manual", matchLevel: "investment" }),
    }),
  unlinkDocumentFromRow: (documentId: string, linkId: string) =>
    request<{ ok: boolean }>(`/api/kb/documents/${documentId}/links/${linkId}`, {
      method: "DELETE",
    }),
  kbGetFileUrl: (id: string) => `${API_BASE}/api/kb/documents/${id}/file`,

  // ─── AI Assistant ──────────────────────────────────────────────────────────
  aiListThreads: () => request<AiThread[]>("/api/ai-assistant/threads"),
  aiCreateThread: (body: { title?: string; contextType?: string; contextId?: string; contextLabel?: string }) =>
    request<AiThread>("/api/ai-assistant/threads", { method: "POST", body: JSON.stringify(body) }),
  aiDeleteThread: (id: string) =>
    request<{ ok: boolean }>(`/api/ai-assistant/threads/${id}`, { method: "DELETE" }),
  aiRenameThread: (id: string, title: string) =>
    request<AiThread>(`/api/ai-assistant/threads/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  aiGetMessages: (threadId: string) => request<AiMessage[]>(`/api/ai-assistant/threads/${threadId}/messages`),
  aiSendMessage: (threadId: string, content: string) =>
    request<{ userMessage: AiMessage; assistantMessage: AiMessage }>(
      `/api/ai-assistant/threads/${threadId}/messages`,
      { method: "POST", body: JSON.stringify({ content }) },
    ),
  aiGetInstructions: () => request<{ aiCustomInstructions: string }>("/api/ai-assistant/settings/instructions"),
  aiSetInstructions: (aiCustomInstructions: string) =>
    request<{ ok: boolean }>("/api/ai-assistant/settings/instructions", {
      method: "PUT",
      body: JSON.stringify({ aiCustomInstructions }),
    }),
  aiListContextDocs: () => request<AiContextDocument[]>("/api/ai-assistant/context-documents"),
  aiUploadContextDoc: async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${API_BASE}/api/ai-assistant/context-documents`, {
      method: "POST",
      body: fd,
      credentials: "include",
    });
    if (res.status === 401) { onUnauthorized?.(); throw new Error("Unauthorized"); }
    if (!res.ok) {
      let msg = `Upload failed (${res.status})`;
      try { const b = await res.json(); if (b.error) msg = b.error; } catch {}
      throw new Error(msg);
    }
    return (await res.json()) as AiContextDocument;
  },
  aiDeleteContextDoc: (id: string) =>
    request<{ ok: boolean }>(`/api/ai-assistant/context-documents/${id}`, { method: "DELETE" }),

  // ─── Users / Admin ─────────────────────────────────────────────────────────
  listUsers: () =>
    request<Array<{ id: string; email: string; name: string | null; role: string; createdAt: string; updatedAt: string }>>(
      "/api/users",
    ),
  updateUserRole: (userId: string, role: string) =>
    request<{ id: string; email: string; name: string | null; role: string; createdAt: string; updatedAt: string }>(
      `/api/users/${userId}`,
      { method: "PATCH", body: JSON.stringify({ role }) },
    ),
  getDigestPreferences: () =>
    request<{ digestSubscribed: boolean }>("/api/digest/preferences"),
  updateDigestPreferences: (digestSubscribed: boolean) =>
    request<{ digestSubscribed: boolean }>("/api/digest/preferences", {
      method: "PATCH",
      body: JSON.stringify({ digestSubscribed }),
    }),
  getDigestStats: () =>
    request<{ subscribedCount: string; totalUsers: string; lastRun: string | null }>("/api/admin/digest/stats"),
  sendTestDigest: () =>
    request<{ success: boolean; eventCount: number; sentTo: string }>("/api/admin/digest/send-test", {
      method: "POST",
    }),
  triggerDigest: () =>
    request<{ sent: number; skipped: number; errors: number }>("/api/admin/digest/trigger", {
      method: "POST",
    }),

  // ─── Slide Import ──────────────────────────────────────────────────────────
  uploadSlide: async (file: File): Promise<SlideExtraction> => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${API_BASE}/api/import/slide`, {
      method: "POST",
      body: fd,
      credentials: "include",
    });
    if (res.status === 401) {
      onUnauthorized?.();
      throw new Error("Unauthorized");
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Slide import failed (${res.status})`);
    }
    return (await res.json()) as SlideExtraction;
  },
  checkSlideDuplicates: (params: {
    investmentName: string;
    tacticNames?: string[];
    domain?: string;
    pillar?: string;
  }) =>
    request<SlideMatchResult>("/api/import/slide/check-duplicates", {
      method: "POST",
      body: JSON.stringify(params),
    }),
  commitSlide: (data: SlideExtraction & { mergeIntoRowId?: string; skipTacticNames?: string[] }) =>
    request<{ row: RoadmapRow; metricId?: string; merged?: boolean }>("/api/import/slide/commit", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  parsePdfSlides: (pages: string[]) =>
    request<PdfImportResult>("/api/import/slide/pdf", {
      method: "POST",
      body: JSON.stringify({ pages }),
    }),
  parsePdfPage: (page: string, pageIndex: number) =>
    request<{ pageIndex: number; extraction: SlideExtraction | null }>("/api/import/slide/pdf-page", {
      method: "POST",
      body: JSON.stringify({ page, pageIndex }),
    }),
  batchCommitSlides: (data: {
    extractions: Array<SlideExtraction & { action: "create" | "merge" | "skip"; mergeIntoRowId?: string; skipTacticNames?: string[] }>;
    pageStats?: { totalPages: number; skippedPages: number; errorPages: number; skippedPageNumbers?: number[]; errorPageDetails?: Array<{ page: number; reason: string }> };
  }) =>
    request<{ created: number; merged: number; tacticsAdded: number; metricsCreated: number }>("/api/import/slide/batch-commit", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // ─── Data Export / Admin ───────────────────────────────────────────────────
  exportXlsxData: () =>
    request<{ rows: unknown[]; taxonomy: Record<string, unknown>; metricDefinitions: unknown[] }>(
      "/api/data/export/xlsx",
    ),
  resetAllData: () =>
    request<{ success: boolean; deletedCounts: Record<string, number> }>(
      "/api/admin/reset-all-data",
      { method: "POST", body: JSON.stringify({ confirm: "DELETE_ALL_DATA" }) },
    ),

  // ─── V2 Priorities (name-based) ───────────────────────────────────────────
  fetchPriorities: () =>
    request<Array<{
      id: string;
      name: string;
      strategicPillar: string | null;
      domain: string | null;
      commercialWhy: string | null;
      transformations: Array<{ from: string; to: string; impact: string }> | null;
      expectedOutcomes: string[] | null;
      aiGeneratedAt: string | null;
      updatedBy: string;
      updatedAt: string;
    }>>("/api/priorities"),
  updatePriority: (name: string, body: {
    domain?: string;
    commercialWhy?: string;
    transformations?: Array<{ from: string; to: string; impact: string }>;
    expectedOutcomes?: string[];
  }) =>
    request<{ ok: boolean }>(`/api/priorities/${encodeURIComponent(name)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  generatePriorityFromDB: (name: string) =>
    request<{ commercialWhy: string }>(`/api/priorities/${encodeURIComponent(name)}/generate`, { method: "POST" }),
  syncPriorities: () =>
    request<{ ok: boolean; message: string }>("/api/priorities/sync", { method: "POST" }),
  clearExpectedBenefits: () =>
    request<{ ok: boolean; cleared: number }>("/api/admin/clear-expected-benefits", { method: "POST" }),

  // ─── V3 Priorities (UUID-based) ───────────────────────────────────────────
  listPrioritiesV3: () =>
    request<Priority[]>("/api/priorities/v3"),
  getPriorityById: (id: string) =>
    request<Priority>(`/api/priorities/v3/${id}`),
  createPriority: (body: Partial<Priority>) =>
    request<Priority>("/api/priorities/v3", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updatePriorityById: (id: string, body: Partial<Priority>) =>
    request<Priority>(`/api/priorities/v3/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deletePriority: (id: string) =>
    request<void>(`/api/priorities/v3/${id}`, { method: "DELETE" }),
  generatePrioritySummaryV3: (id: string) =>
    request<{ summary: string }>(`/api/priorities/v3/${id}/generate-summary`, {
      method: "POST",
    }),
};
