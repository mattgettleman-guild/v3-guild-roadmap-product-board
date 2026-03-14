export type FieldSource = "manual" | "jira" | "derived";

export interface JiraAttributes {
  labels: string[];
  status?: string;
  assignee?: string;
  priority?: string;
  startDate?: string;
  endDate?: string;
  components: string[];
  customFields: Record<string, string | number | boolean | null>;
}

export interface RoadmapChildItem {
  key: string;
  title: string;
  type: "epic" | "story";
  url: string;
}

export interface TimelineRange {
  start: string;
  end: string;
}

export interface MetricDefinition {
  id: string;
  name: string;
  description?: string;
  unit?: string;
  targetValue?: number;
  direction: "increase" | "decrease" | "maintain";
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type TacticStatus = "not_started" | "in_discovery" | "in_progress" | "paused" | "completed";
export type ConfidenceLevel = "high" | "medium" | "low";
export type DependencyStatus = "not_started" | "on_track" | "watching" | "off_track" | "blocked" | "cancelled";
export type DependencyCriticality = "blocker" | "critical" | "important" | "nice_to_have";

export type DependencyTargetType = "tactic" | "jira" | "freeform";

export interface DependencyTarget {
  type: DependencyTargetType;
  tacticRowId?: number;
  tacticId?: string;
  jiraKey?: string;
  jiraUrl?: string;
  jiraTitle?: string;
  freeformText?: string;
}

export interface TacticDependency {
  id: string;
  isDependency?: boolean;
  target?: DependencyTarget;
  description?: string;
  team?: string;
  neededByDate?: string;
  actualDeliveryDate?: string;
  status?: DependencyStatus;
  criticality?: DependencyCriticality;
  notes?: string;
}

export type VisibilityLevel = "external_approved" | "internal_only";

export interface Tactic {
  id: string;
  name: string;
  description?: string;
  owner?: string;
  status?: TacticStatus;
  deliveryConfidence?: ConfidenceLevel;
  tags?: string[];
  themes?: string[];
  timeline?: TimelineRange;
  jiraLinks: JiraLink[];
  lastSyncedAt?: string;
  dependency?: TacticDependency;
  dependencies?: TacticDependency[];
  visibility?: VisibilityLevel;
}

export interface JiraLink {
  id: string;
  key: string;
  title: string;
  issueType: "initiative" | "epic";
  url: string;
  jiraAttributes?: JiraAttributes;
}

export type InvestmentStatus = "In Progress" | "In Discovery" | "Not Started" | "Completed" | "Paused";

export interface RoadmapRow {
  id: string;
  strategicPillar: string;
  productPriority: string;
  investment: string;
  description?: string;
  metricId?: string;
  tags?: string[];
  themes?: string[];
  tactics: Tactic[];
  jiraLinks: JiraLink[];
  domain: string;
  subDomain?: string;
  owners: string;
  timeline?: TimelineRange;
  status?: InvestmentStatus;
  cardEmoji?: string;
  cardColor?: string;
  expectedBenefits?: string[];
  visibility: VisibilityLevel;
  sourceOfTruth: Record<string, FieldSource>;
  lastSyncedAt?: string;
  priorityId?: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export interface SavedView {
  id: string;
  name: string;
  audienceTag: string;
  isShared: boolean;
  viewMode: "grid" | "gantt";
  filters: {
    pillar?: string;
    priority?: string;
    domain?: string;
    subDomain?: string;
    owner?: string;
    tag?: string;
    theme?: string;
    investment?: string;
    jiraIssueType?: "initiative" | "epic";
    visibility?: VisibilityLevel;
  };
  visibleColumns: string[];
  columnOrder?: string[];
  groupBy?: "pillar" | "priority" | "domain" | null;
  sortBy?: "updatedAt" | "strategicPillar" | "productPriority";
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  id: string;
  entityType: "row" | "view" | "import";
  entityId: string;
  action: string;
  actor: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export type ChangelogChangeType =
  | "status_change"
  | "date_shift"
  | "scope_change"
  | "priority_change"
  | "new_item"
  | "removed_item"
  | "assignment_change";

export type ChangelogImpactLevel = "high" | "medium" | "low";

export interface ChangelogEvent {
  id: string;
  entityType: "investment" | "tactic";
  entityId: string;
  investmentId?: string;
  fieldName: string;
  oldValue: unknown;
  newValue: unknown;
  changeType: ChangelogChangeType;
  changedBy: string;
  changedAt: string;
  source: "app" | "jira";
  gtmActionNeeded: boolean;
  pmNote?: string;
  impactLevel?: ChangelogImpactLevel;
}

export interface ImportTacticMatch {
  draftTacticName: string;
  existingTacticId: string;
  existingTacticName: string;
  existingRowId: string;
  existingInvestmentName: string;
  similarity: number;
}

export interface ImportMatchDetails {
  investmentMatch?: {
    existingRowId: string;
    existingName: string;
    similarity: number;
  };
  tacticMatches?: ImportTacticMatch[];
  newTactics?: string[];
}

export type TacticResolution = "add" | "move" | "skip";

export interface ImportDraftChange {
  id: string;
  action: "create" | "update";
  status: "pending" | "accepted" | "rejected";
  confidence: number;
  rationale: string;
  sourceRef: string;
  proposed: Partial<RoadmapRow>;
  existingRowId?: string;
  matchDetails?: ImportMatchDetails;
  leadingIndicators?: string;
  tacticActions?: Record<string, TacticResolution>;
  existingData?: Partial<RoadmapRow>;
  fieldActions?: Record<string, "accept" | "ignore">;
  existingUpdatedBy?: string;
  existingUpdatedAt?: string;
}

export interface ImportFieldSnapshot {
  rowId: string;
  field: string;
  previousValue: unknown;
}

export interface ImportJob {
  id: string;
  fileName: string;
  status: "processing" | "ready_for_review" | "committed" | "undone";
  createdAt: string;
  createdBy: string;
  draftChanges: ImportDraftChange[];
  headerOverrides?: Record<number, string>;
  committedRowIds?: string[];
  changeJournal?: ImportFieldSnapshot[];
}

export interface ImportHeaderMapping {
  column: string;
  index: number;
  mappedTo: string | null;
}

export interface ImportAvailableField {
  field: string;
  label: string;
}

export interface ImportParseHeadersResponse {
  mappedHeaders: ImportHeaderMapping[];
  unmappedHeaders: ImportHeaderMapping[];
  availableFields: ImportAvailableField[];
  sampleData?: Record<number, string[]>;
  sampleRows?: string[][];
  allHeaders?: string[];
}

export interface TelemetryEvent {
  id: string;
  type: string;
  actor: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

export type DocumentType = "por" | "strategy" | "recap" | "release_announcement" | "reference";
export type DocumentStatus = "uploading" | "processing" | "ready" | "error";
export type DocumentLinkType = "manual" | "auto-suggested" | "confirmed";
export type ChunkSectionType = "metrics" | "what_we_did" | "whats_next" | "risks" | "releases" | "roadmap" | "general";

export interface KBDocument {
  id: string;
  filename: string;
  fileSize: number;
  mimeType: string;
  storageKey: string;
  documentType: DocumentType;
  initiative?: string;
  timePeriod?: string;
  timePeriodDate?: string;
  status: DocumentStatus;
  errorMessage?: string;
  version: number;
  supersededBy?: string;
  isArchived: boolean;
  uploadedBy: string;
  createdAt: string;
  updatedAt: string;
  chunkCount?: number;
  linkCount?: number;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  sectionType?: ChunkSectionType;
  month?: string;
  initiative?: string;
  sequence: number;
  embeddingModel?: string;
  tokenCount?: number;
  jiraKeys: string[];
  createdAt: string;
}

export interface DocumentLink {
  id: string;
  documentId: string;
  rowId: string;
  tacticId?: string;
  linkType: DocumentLinkType;
  confidence?: number;
  createdAt: string;
}

export interface SearchResult {
  chunk: DocumentChunk;
  document: KBDocument;
  similarity: number;
  combinedScore: number;
}

export interface SlideExtraction {
  investmentName: string;
  domain: string;
  strategicPillar?: string;
  productPriority?: string;
  metrics: SlideMetric[];
  tactics: SlideTactic[];
}

export interface PdfImportResult {
  totalPages: number;
  slidesFound: number;
  skippedPages: number;
  extractions: SlideExtraction[];
}

export interface SlideMetric {
  name: string;
  description: string;
  targetValue?: number;
  unit?: string;
  context?: string;
}

export interface SlideTactic {
  name: string;
  description?: string;
  status: string;
  deliveryConfidence?: string;
  startQuarter?: string;
  endQuarter?: string;
}

// ─── V3: Priority type (UUID-based product priorities with brief fields) ──────

export interface Priority {
  id: string;
  name: string;
  slug: string;
  strategicPillar: string | null;
  status: "active" | "paused" | "complete";
  owner: string[];
  // Brief fields
  briefObjective: string | null;
  problemStatement: string | null;
  commercialWhy: string | null;
  outOfScope: string | null;
  successMetrics: Array<{ name: string; target: string; unit: string; direction: string; baseline: string }> | null;
  keyAssumptions: Array<{ assumption: string; riskLevel: "high" | "medium" | "low" }> | null;
  transformations: Array<{ from: string; to: string; impact: string }> | null;
  // AI
  aiSummary: string | null;
  aiGeneratedAt: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}
