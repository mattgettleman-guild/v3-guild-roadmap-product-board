import { pgTable, uuid, text, boolean, timestamp, jsonb, integer, date, customType, index } from "drizzle-orm/pg-core";

const vector = customType<{ data: number[]; driverParam: string }>({
  dataType() {
    return "vector(1536)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: unknown): number[] {
    return JSON.parse(value as string);
  },
});

export const roadmapRows = pgTable("roadmap_rows", {
  id: uuid("id").primaryKey().defaultRandom(),
  strategicPillar: text("strategic_pillar").notNull().default("Uncategorized"),
  productPriority: text("product_priority").notNull().default("Uncategorized"),
  investment: text("investment").notNull().default("New Investment"),
  description: text("description"),
  metricId: text("metric_id"),
  domain: text("domain").notNull().default("Unknown"),
  subDomain: text("sub_domain"),
  owners: text("owners").array().notNull().default([]),
  timeline: jsonb("timeline").$type<{ start: string; end: string } | null>(),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  themes: jsonb("themes").$type<string[]>().notNull().default([]),
  tactics: jsonb("tactics").$type<Array<{
    id: string;
    name: string;
    description?: string;
    owner?: string;
    status?: string;
    deliveryConfidence?: string;
    tags?: string[];
    themes?: string[];
    timeline?: { start: string; end: string };
    jiraLinks: Array<{
      id: string;
      key: string;
      title: string;
      issueType: "initiative" | "epic";
      url: string;
      jiraAttributes?: Record<string, unknown>;
    }>;
    lastSyncedAt?: string;
    dependency?: {
      isDependency?: boolean;
      id?: string;
      target?: {
        type: "tactic" | "jira" | "freeform";
        tacticRowId?: number;
        tacticId?: string;
        jiraKey?: string;
        jiraUrl?: string;
        jiraTitle?: string;
        freeformText?: string;
      };
      description?: string;
      team?: string;
      neededByDate?: string;
      actualDeliveryDate?: string;
      status?: string;
      criticality?: string;
      notes?: string;
    };
    dependencies?: Array<{
      id: string;
      target?: {
        type: "tactic" | "jira" | "freeform";
        tacticRowId?: number;
        tacticId?: string;
        jiraKey?: string;
        jiraUrl?: string;
        jiraTitle?: string;
        freeformText?: string;
      };
      description?: string;
      team?: string;
      neededByDate?: string;
      actualDeliveryDate?: string;
      status?: string;
      criticality?: string;
      notes?: string;
    }>;
  }>>().notNull().default([]),
  jiraLinks: jsonb("jira_links").$type<Array<{
    id: string;
    key: string;
    title: string;
    issueType: "initiative" | "epic";
    url: string;
    jiraAttributes?: Record<string, unknown>;
  }>>().notNull().default([]),
  status: text("status"),
  cardEmoji: text("card_emoji"),
  cardColor: text("card_color"),
  expectedBenefits: jsonb("expected_benefits").$type<string[]>().notNull().default([]),
  visibility: text("visibility").notNull().default("internal_only"),
  sourceOfTruth: jsonb("source_of_truth").$type<Record<string, string>>().notNull().default({}),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  // V3: FK to product_priorities
  priorityId: uuid("priority_id").references(() => productPriorities.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by").notNull().default("system"),
}, (table) => [
  index("roadmap_rows_strategic_pillar_idx").on(table.strategicPillar),
  index("roadmap_rows_product_priority_idx").on(table.productPriority),
  index("roadmap_rows_domain_idx").on(table.domain),
]);

export const savedViews = pgTable("saved_views", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  audienceTag: text("audience_tag").notNull().default("custom"),
  isShared: boolean("is_shared").notNull().default(true),
  viewMode: text("view_mode").notNull().default("grid"),
  filters: jsonb("filters").$type<Record<string, string>>().notNull().default({}),
  visibleColumns: jsonb("visible_columns").$type<string[]>().notNull().default([]),
  columnOrder: jsonb("column_order").$type<string[]>(),
  groupBy: text("group_by"),
  sortBy: text("sort_by").default("updatedAt"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const metricDefinitions = pgTable("metric_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  unit: text("unit"),
  targetValue: integer("target_value"),
  direction: text("direction").notNull().default("increase"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action").notNull(),
  actor: text("actor").notNull().default("unknown"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("audit_events_entity_type_idx").on(table.entityType),
  index("audit_events_action_idx").on(table.action),
]);

export const changelogEvents = pgTable("changelog_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  investmentId: uuid("investment_id"),
  fieldName: text("field_name").notNull(),
  oldValue: jsonb("old_value"),
  newValue: jsonb("new_value"),
  changeType: text("change_type").notNull(),
  changedBy: text("changed_by").notNull().default("unknown"),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  source: text("source").notNull().default("app"),
  gtmActionNeeded: boolean("gtm_action_needed").notNull().default(false),
  pmNote: text("pm_note"),
  impactLevel: text("impact_level"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  reversedAt: timestamp("reversed_at", { withTimezone: true }),
}, (table) => [
  index("changelog_events_changed_at_idx").on(table.changedAt),
  index("changelog_events_entity_type_idx").on(table.entityType),
  index("changelog_events_entity_id_idx").on(table.entityId),
  index("changelog_events_change_type_idx").on(table.changeType),
  index("changelog_events_investment_id_idx").on(table.investmentId),
]);

export const telemetryEvents = pgTable("telemetry_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  type: text("type").notNull(),
  actor: text("actor").notNull().default("unknown"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const importJobs = pgTable("import_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  fileName: text("file_name").notNull(),
  status: text("status").notNull().default("processing"),
  createdBy: text("created_by").notNull().default("unknown"),
  draftChanges: jsonb("draft_changes").$type<Array<{
    id: string;
    action: "create" | "update";
    status: "pending" | "accepted" | "rejected";
    confidence: number;
    rationale: string;
    sourceRef: string;
    proposed: Record<string, unknown>;
    existingRowId?: string;
  }>>().notNull().default([]),
  committedRowIds: jsonb("committed_row_ids").$type<string[]>().default([]),
  changeJournal: jsonb("change_journal").$type<{ rowId: string; field: string; previousValue: unknown }[]>().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const taxonomy = pgTable("taxonomy", {
  id: integer("id").primaryKey().default(1),
  pillars: jsonb("pillars").$type<string[]>().notNull().default([]),
  priorities: jsonb("priorities").$type<string[]>().notNull().default([]),
  domains: jsonb("domains").$type<string[]>().notNull().default([]),
  owners: jsonb("owners").$type<string[]>().notNull().default([]),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  themes: jsonb("themes").$type<string[]>().notNull().default([]),
  subDomains: jsonb("sub_domains").$type<string[]>().notNull().default([]),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  role: text("role").notNull().default("editor"),
  dismissedAlerts: jsonb("dismissed_alerts").$type<string[]>().default([]),
  digestSubscribed: boolean("digest_subscribed").notNull().default(true),
  lastDigestSentAt: timestamp("last_digest_sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiReports = pgTable("ai_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  reportType: text("report_type").notNull(),
  title: text("title").notNull(),
  parameters: jsonb("parameters").$type<Record<string, unknown>>().notNull().default({}),
  content: jsonb("content").$type<Record<string, unknown>>().notNull().default({}),
  createdBy: text("created_by").notNull().default("unknown"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const magicLinks = pgTable("magic_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  filename: text("filename").notNull(),
  fileSize: integer("file_size").notNull(),
  mimeType: text("mime_type").notNull(),
  storageKey: text("storage_key").notNull(),
  documentType: text("document_type").notNull().default("reference"),
  initiative: text("initiative"),
  timePeriod: text("time_period"),
  timePeriodDate: date("time_period_date"),
  productPriority: text("product_priority"),
  status: text("status").notNull().default("uploading"),
  errorMessage: text("error_message"),
  version: integer("version").notNull().default(1),
  supersededBy: uuid("superseded_by"),
  isArchived: boolean("is_archived").notNull().default(false),
  uploadedBy: text("uploaded_by").notNull().default("unknown"),
  aiContent: jsonb("ai_content").$type<{ summary: string; benefits: string[]; transformations?: Array<{ from: string; to: string; impact: string }>; talkingPoints: { today: string[]; committed: string[] } } | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("documents_initiative_idx").on(table.initiative),
  index("documents_document_type_idx").on(table.documentType),
  index("documents_is_archived_idx").on(table.isArchived),
]);

export const documentChunks = pgTable("document_chunks", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  sectionType: text("section_type"),
  month: text("month"),
  initiative: text("initiative"),
  sequence: integer("sequence").notNull().default(0),
  embedding: vector("embedding"),
  embeddingModel: text("embedding_model"),
  tokenCount: integer("token_count"),
  jiraKeys: jsonb("jira_keys").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiThreads = pgTable("ai_threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull().default("New conversation"),
  createdBy: text("created_by").notNull().default("unknown"),
  contextType: text("context_type"),
  contextId: text("context_id"),
  contextLabel: text("context_label"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiMessages = pgTable("ai_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id").notNull().references(() => aiThreads.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  citations: jsonb("citations").$type<string[]>().notNull().default([]),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdBy: text("created_by").notNull().default("unknown"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const appSettings = pgTable("app_settings", {
  id: integer("id").primaryKey().default(1),
  aiCustomInstructions: text("ai_custom_instructions").notNull().default(""),
  updatedBy: text("updated_by").notNull().default("unknown"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiContextDocuments = pgTable("ai_context_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  filename: text("filename").notNull(),
  fileSize: integer("file_size").notNull().default(0),
  mimeType: text("mime_type").notNull().default("application/octet-stream"),
  storageKey: text("storage_key").notNull(),
  extractedText: text("extracted_text").notNull().default(""),
  status: text("status").notNull().default("processing"),
  errorMessage: text("error_message"),
  uploadedBy: text("uploaded_by").notNull().default("unknown"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// V3: Extended product priorities with brief fields + slug
export const productPriorities = pgTable("product_priorities", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  slug: text("slug").unique(),
  strategicPillar: text("strategic_pillar"),
  domain: text("domain"),
  status: text("status").notNull().default("active"),
  owner: jsonb("owner").$type<string[]>().notNull().default([]),
  commercialWhy: text("commercial_why"),
  briefObjective: text("brief_objective"),
  problemStatement: text("problem_statement"),
  outOfScope: text("out_of_scope"),
  successMetrics: jsonb("success_metrics").$type<Array<{ name: string; target: string; unit: string; direction: string; baseline: string }>>(),
  keyAssumptions: jsonb("key_assumptions").$type<Array<{ assumption: string; riskLevel: "high" | "medium" | "low" }>>(),
  transformations: jsonb("transformations").$type<Array<{ from: string; to: string; impact: string }>>(),
  expectedOutcomes: jsonb("expected_outcomes").$type<string[]>(),
  aiSummary: text("ai_summary"),
  aiGeneratedAt: timestamp("ai_generated_at", { withTimezone: true }),
  aiSourceDocId: uuid("ai_source_doc_id"),
  updatedBy: text("updated_by").notNull().default("system"),
  createdBy: text("created_by").notNull().default("system"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documentLinks = pgTable("document_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id").notNull().references(() => documents.id, { onDelete: "cascade" }),
  rowId: uuid("row_id").notNull().references(() => roadmapRows.id, { onDelete: "cascade" }),
  tacticId: text("tactic_id"),
  linkType: text("link_type").notNull().default("auto-suggested"),
  confidence: integer("confidence"),
  matchReason: text("match_reason"),
  matchLevel: text("match_level").default("investment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
