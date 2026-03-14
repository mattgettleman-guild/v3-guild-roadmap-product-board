import crypto from "node:crypto";
import { eq, desc, and } from "drizzle-orm";
import { db, pool } from "./db.js";
import {
  roadmapRows,
  savedViews,
  metricDefinitions,
  auditEvents,
  telemetryEvents,
  importJobs,
  aiReports,
  taxonomy as taxonomyTable,
  changelogEvents,
} from "./schema.js";
import type {
  AuditEvent,
  ImportJob,
  InvestmentStatus,
  JiraLink,
  MetricDefinition,
  RoadmapRow,
  SavedView,
  Tactic,
  TelemetryEvent,
} from "@roadmap/shared";

export interface StoreShape {
  taxonomy: {
    pillars: string[];
    priorities: string[];
    domains: string[];
    subDomains: string[];
    owners: string[];
    tags: string[];
    themes: string[];
  };
  metrics: MetricDefinition[];
  rows: RoadmapRow[];
  views: SavedView[];
  audits: AuditEvent[];
  imports: ImportJob[];
  telemetry: TelemetryEvent[];
}

const defaultTaxonomy = {
  pillars: [],
  priorities: [],
  domains: [],
  subDomains: [],
  owners: [],
  tags: [],
  themes: [],
};

function ownersArrayToString(arr: string[]): string {
  if (!arr || arr.length === 0) return "Unassigned";
  return arr.join(" / ");
}

function ownersStringToArray(s: string): string[] {
  if (!s || s === "Unassigned") return [];
  return s
    .split(/\s*\/\s*/)
    .map((o) => o.trim())
    .filter(Boolean);
}

function dbRowToRoadmapRow(r: typeof roadmapRows.$inferSelect): RoadmapRow {
  return {
    id: r.id,
    strategicPillar: r.strategicPillar,
    productPriority: r.productPriority,
    investment: r.investment,
    description: r.description ?? undefined,
    metricId: r.metricId ?? undefined,
    tags: ((r as Record<string, unknown>).tags as string[] ?? []) as string[],
    themes: ((r as Record<string, unknown>).themes as string[] ?? []) as string[],
    domain: r.domain,
    subDomain: r.subDomain ?? undefined,
    owners: ownersArrayToString(r.owners),
    timeline: r.timeline ?? undefined,
    tactics: (r.tactics ?? []) as unknown as Tactic[],
    jiraLinks: (r.jiraLinks ?? []) as unknown as JiraLink[],
    status: (r.status as InvestmentStatus) ?? undefined,
    cardEmoji: r.cardEmoji ?? undefined,
    cardColor: r.cardColor ?? undefined,
    expectedBenefits: (r.expectedBenefits ?? []) as string[],
    sourceOfTruth: (r.sourceOfTruth ?? {}) as RoadmapRow["sourceOfTruth"],
    visibility: (r.visibility as RoadmapRow["visibility"]) || "internal_only",
    lastSyncedAt: r.lastSyncedAt?.toISOString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    updatedBy: r.updatedBy,
  };
}

function dbViewToSavedView(v: typeof savedViews.$inferSelect): SavedView {
  return {
    id: v.id,
    name: v.name,
    audienceTag: v.audienceTag,
    isShared: v.isShared,
    viewMode: v.viewMode as SavedView["viewMode"],
    filters: (v.filters ?? {}) as SavedView["filters"],
    visibleColumns: (v.visibleColumns ?? []) as string[],
    columnOrder: (v.columnOrder as string[] | undefined) ?? undefined,
    groupBy: (v.groupBy as SavedView["groupBy"]) ?? undefined,
    sortBy: (v.sortBy as SavedView["sortBy"]) ?? undefined,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

function dbMetricToMetricDef(m: typeof metricDefinitions.$inferSelect): MetricDefinition {
  return {
    id: m.id,
    name: m.name,
    description: m.description ?? undefined,
    unit: m.unit ?? undefined,
    targetValue: m.targetValue ?? undefined,
    direction: m.direction as MetricDefinition["direction"],
    active: m.active,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

function dbAuditToEvent(a: typeof auditEvents.$inferSelect): AuditEvent {
  return {
    id: a.id,
    entityType: a.entityType as AuditEvent["entityType"],
    entityId: a.entityId,
    action: a.action,
    actor: a.actor,
    timestamp: a.timestamp.toISOString(),
    payload: (a.payload ?? {}) as Record<string, unknown>,
  };
}

function dbTelemetryToEvent(t: typeof telemetryEvents.$inferSelect): TelemetryEvent {
  return {
    id: t.id,
    type: t.type,
    actor: t.actor,
    createdAt: t.createdAt.toISOString(),
    payload: (t.payload ?? {}) as Record<string, unknown>,
  };
}

function dbImportToJob(j: typeof importJobs.$inferSelect): ImportJob {
  return {
    id: j.id,
    fileName: j.fileName,
    status: j.status as ImportJob["status"],
    createdBy: j.createdBy,
    draftChanges: (j.draftChanges ?? []) as ImportJob["draftChanges"],
    createdAt: j.createdAt.toISOString(),
    committedRowIds: (j.committedRowIds ?? []) as string[],
    changeJournal: (j.changeJournal ?? []) as ImportJob["changeJournal"],
  };
}

export async function readStore(): Promise<StoreShape> {
  const [taxRows, metricRows, rowData, viewData, auditData, telData, impData] =
    await Promise.all([
      db.select().from(taxonomyTable),
      db.select().from(metricDefinitions),
      db.select().from(roadmapRows),
      db.select().from(savedViews),
      db.select().from(auditEvents),
      db.select().from(telemetryEvents),
      db.select().from(importJobs),
    ]);

  const tax = taxRows[0];
  const taxonomy = tax
    ? {
        pillars: (tax.pillars ?? []) as string[],
        priorities: (tax.priorities ?? []) as string[],
        domains: (tax.domains ?? []) as string[],
        subDomains: ((tax as Record<string, unknown>).subDomains as string[] ?? []) as string[],
        owners: (tax.owners ?? []) as string[],
        tags: ((tax as Record<string, unknown>).tags as string[] ?? []) as string[],
        themes: ((tax as Record<string, unknown>).themes as string[] ?? []) as string[],
      }
    : defaultTaxonomy;

  return {
    taxonomy,
    metrics: metricRows.map(dbMetricToMetricDef),
    rows: rowData.map(dbRowToRoadmapRow),
    views: viewData.map(dbViewToSavedView),
    audits: auditData.map(dbAuditToEvent),
    imports: impData.map(dbImportToJob),
    telemetry: telData.map(dbTelemetryToEvent),
  };
}

export async function updateStore(
  mutator: (draft: StoreShape) => void,
): Promise<StoreShape> {
  const state = await readStore();
  const prevRows = JSON.stringify(state.rows);
  const prevViews = JSON.stringify(state.views);
  const prevMetrics = JSON.stringify(state.metrics);
  const prevTaxonomy = JSON.stringify(state.taxonomy);
  const prevImports = JSON.stringify(state.imports);

  mutator(state);

  const taxonomyChanged = JSON.stringify(state.taxonomy) !== prevTaxonomy;
  const metricsChanged = JSON.stringify(state.metrics) !== prevMetrics;
  const rowsChanged = JSON.stringify(state.rows) !== prevRows;
  const viewsChanged = JSON.stringify(state.views) !== prevViews;
  const importsChanged = JSON.stringify(state.imports) !== prevImports;

  if (!taxonomyChanged && !metricsChanged && !rowsChanged && !viewsChanged && !importsChanged) {
    return state;
  }

  await db.transaction(async (tx) => {
    if (taxonomyChanged) {
      const taxRows = await tx.select().from(taxonomyTable).where(eq(taxonomyTable.id, 1));
      if (taxRows.length === 0) {
        await tx.insert(taxonomyTable).values({
          id: 1,
          pillars: state.taxonomy.pillars,
          priorities: state.taxonomy.priorities,
          domains: state.taxonomy.domains,
          subDomains: state.taxonomy.subDomains,
          owners: state.taxonomy.owners,
          tags: state.taxonomy.tags,
          themes: state.taxonomy.themes,
        } as any);
      } else {
        await tx
          .update(taxonomyTable)
          .set({
            pillars: state.taxonomy.pillars,
            priorities: state.taxonomy.priorities,
            domains: state.taxonomy.domains,
            subDomains: state.taxonomy.subDomains,
            owners: state.taxonomy.owners,
            tags: state.taxonomy.tags,
            themes: state.taxonomy.themes,
          } as any)
          .where(eq(taxonomyTable.id, 1));
      }
    }

    if (metricsChanged) {
      const prevMetricsParsed = JSON.parse(prevMetrics) as MetricDefinition[];
      const prevIds = new Set(prevMetricsParsed.map((m) => m.id));
      const nextIds = new Set(state.metrics.map((m) => m.id));

      for (const id of prevIds) {
        if (!nextIds.has(id)) {
          await tx.delete(metricDefinitions).where(eq(metricDefinitions.id, id));
        }
      }

      for (const m of state.metrics) {
        if (!prevIds.has(m.id)) {
          await tx.insert(metricDefinitions).values({
            id: m.id,
            name: m.name,
            description: m.description ?? null,
            unit: m.unit ?? null,
            targetValue: m.targetValue != null ? Number(m.targetValue) : null,
            direction: m.direction,
            active: m.active,
            createdAt: new Date(m.createdAt),
            updatedAt: new Date(m.updatedAt),
          });
        } else {
          const prev = prevMetricsParsed.find((p) => p.id === m.id);
          if (JSON.stringify(prev) !== JSON.stringify(m)) {
            await tx
              .update(metricDefinitions)
              .set({
                name: m.name,
                description: m.description ?? null,
                unit: m.unit ?? null,
                targetValue: m.targetValue != null ? Number(m.targetValue) : null,
                direction: m.direction,
                active: m.active,
                updatedAt: new Date(m.updatedAt),
              })
              .where(eq(metricDefinitions.id, m.id));
          }
        }
      }
    }

    if (rowsChanged) {
      const prevRowsParsed = JSON.parse(prevRows) as RoadmapRow[];
      const prevIds = new Set(prevRowsParsed.map((r) => r.id));
      const nextIds = new Set(state.rows.map((r) => r.id));

      for (const id of prevIds) {
        if (!nextIds.has(id)) {
          await tx.delete(roadmapRows).where(eq(roadmapRows.id, id));
        }
      }

      for (const row of state.rows) {
        if (!prevIds.has(row.id)) {
          await tx.insert(roadmapRows).values({
            id: row.id,
            strategicPillar: row.strategicPillar,
            productPriority: row.productPriority,
            investment: row.investment,
            description: row.description ?? null,
            metricId: row.metricId ?? null,
            domain: row.domain,
            subDomain: row.subDomain ?? null,
            owners: ownersStringToArray(row.owners),
            timeline: row.timeline ?? null,
            tags: (row.tags ?? []) as any,
            themes: (row.themes ?? []) as any,
            tactics: row.tactics as any,
            jiraLinks: row.jiraLinks as any,
            visibility: row.visibility ?? "internal_only",
            sourceOfTruth: row.sourceOfTruth,
            lastSyncedAt: row.lastSyncedAt ? new Date(row.lastSyncedAt) : null,
            createdAt: new Date(row.createdAt),
            updatedAt: new Date(row.updatedAt),
            updatedBy: row.updatedBy,
          });
        } else {
          const prev = prevRowsParsed.find((p) => p.id === row.id);
          if (JSON.stringify(prev) !== JSON.stringify(row)) {
            await tx
              .update(roadmapRows)
              .set({
                strategicPillar: row.strategicPillar,
                productPriority: row.productPriority,
                investment: row.investment,
                description: row.description ?? null,
                metricId: row.metricId ?? null,
                domain: row.domain,
                subDomain: row.subDomain ?? null,
                owners: ownersStringToArray(row.owners),
                timeline: row.timeline ?? null,
                tags: (row.tags ?? []) as any,
                themes: (row.themes ?? []) as any,
                tactics: row.tactics as any,
                jiraLinks: row.jiraLinks as any,
                visibility: row.visibility ?? "internal_only",
                sourceOfTruth: row.sourceOfTruth,
                lastSyncedAt: row.lastSyncedAt ? new Date(row.lastSyncedAt) : null,
                updatedAt: new Date(row.updatedAt),
                updatedBy: row.updatedBy,
              })
              .where(eq(roadmapRows.id, row.id));
          }
        }
      }
    }

    if (viewsChanged) {
      const prevViewsParsed = JSON.parse(prevViews) as SavedView[];
      const prevIds = new Set(prevViewsParsed.map((v) => v.id));
      const nextIds = new Set(state.views.map((v) => v.id));

      for (const id of prevIds) {
        if (!nextIds.has(id)) {
          await tx.delete(savedViews).where(eq(savedViews.id, id));
        }
      }

      for (const view of state.views) {
        if (!prevIds.has(view.id)) {
          await tx.insert(savedViews).values({
            id: view.id,
            name: view.name,
            audienceTag: view.audienceTag,
            isShared: view.isShared,
            viewMode: view.viewMode,
            filters: view.filters,
            visibleColumns: view.visibleColumns,
            columnOrder: view.columnOrder ?? null,
            groupBy: view.groupBy ?? null,
            sortBy: view.sortBy ?? null,
            createdAt: new Date(view.createdAt),
            updatedAt: new Date(view.updatedAt),
          });
        } else {
          const prev = prevViewsParsed.find((p) => p.id === view.id);
          if (JSON.stringify(prev) !== JSON.stringify(view)) {
            await tx
              .update(savedViews)
              .set({
                name: view.name,
                audienceTag: view.audienceTag,
                isShared: view.isShared,
                viewMode: view.viewMode,
                filters: view.filters,
                visibleColumns: view.visibleColumns,
                columnOrder: view.columnOrder ?? null,
                groupBy: view.groupBy ?? null,
                sortBy: view.sortBy ?? null,
                updatedAt: new Date(view.updatedAt),
              })
              .where(eq(savedViews.id, view.id));
          }
        }
      }
    }

    if (importsChanged) {
      const prevImportsParsed = JSON.parse(prevImports) as ImportJob[];
      const prevIds = new Set(prevImportsParsed.map((j) => j.id));
      const nextIds = new Set(state.imports.map((j) => j.id));

      for (const id of prevIds) {
        if (!nextIds.has(id)) {
          await tx.delete(importJobs).where(eq(importJobs.id, id));
        }
      }

      for (const job of state.imports) {
        if (!prevIds.has(job.id)) {
          await tx.insert(importJobs).values({
            id: job.id,
            fileName: job.fileName,
            status: job.status,
            createdBy: job.createdBy,
            draftChanges: job.draftChanges as any,
            committedRowIds: (job.committedRowIds || []) as any,
            changeJournal: (job.changeJournal || []) as any,
            createdAt: new Date(job.createdAt),
          });
        } else {
          const prev = prevImportsParsed.find((p) => p.id === job.id);
          if (JSON.stringify(prev) !== JSON.stringify(job)) {
            await tx
              .update(importJobs)
              .set({
                fileName: job.fileName,
                status: job.status,
                draftChanges: job.draftChanges as any,
                committedRowIds: (job.committedRowIds || []) as any,
                changeJournal: (job.changeJournal || []) as any,
              })
              .where(eq(importJobs.id, job.id));
          }
        }
      }
    }
  });

  return state;
}

export async function appendAudit(
  event: Omit<AuditEvent, "id" | "timestamp"> & Partial<AuditEvent>,
): Promise<void> {
  await db.insert(auditEvents).values({
    id: event.id || crypto.randomUUID(),
    entityType: event.entityType,
    entityId: event.entityId,
    action: event.action,
    actor: event.actor,
    payload: event.payload ?? {},
    timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
  });
}

export async function insertChangelogEvents(
  events: Array<{
    id: string;
    entityType: string;
    entityId: string;
    investmentId?: string;
    fieldName: string;
    oldValue: unknown;
    newValue: unknown;
    changeType: string;
    changedBy: string;
    changedAt: Date;
    source: string;
    gtmActionNeeded: boolean;
    pmNote?: string;
    impactLevel?: string;
  }>,
): Promise<void> {
  if (events.length === 0) return;
  await db.insert(changelogEvents).values(
    events.map((e) => ({
      id: e.id,
      entityType: e.entityType,
      entityId: e.entityId,
      investmentId: e.investmentId ?? null,
      fieldName: e.fieldName,
      oldValue: e.oldValue,
      newValue: e.newValue,
      changeType: e.changeType,
      changedBy: e.changedBy,
      changedAt: e.changedAt,
      source: e.source,
      gtmActionNeeded: e.gtmActionNeeded,
      pmNote: e.pmNote ?? null,
      impactLevel: e.impactLevel ?? null,
    })),
  );
}

export async function appendTelemetry(
  event: Omit<TelemetryEvent, "id" | "createdAt">,
): Promise<void> {
  await db.insert(telemetryEvents).values({
    id: crypto.randomUUID(),
    type: event.type,
    actor: event.actor,
    payload: event.payload ?? {},
    createdAt: new Date(),
  });
}

export async function listAiReports(reportType?: string, createdBy?: string) {
  const conditions = [];
  if (reportType) conditions.push(eq(aiReports.reportType, reportType));
  if (createdBy) conditions.push(eq(aiReports.createdBy, createdBy));

  let query = db.select().from(aiReports).orderBy(desc(aiReports.createdAt));
  if (conditions.length === 1) {
    return query.where(conditions[0]);
  } else if (conditions.length === 2) {
    return query.where(and(conditions[0], conditions[1]));
  }
  return query;
}

export async function createAiReport(report: {
  reportType: string;
  title: string;
  parameters: Record<string, unknown>;
  content: Record<string, unknown>;
  createdBy: string;
}) {
  const [row] = await db.insert(aiReports).values({
    id: crypto.randomUUID(),
    reportType: report.reportType,
    title: report.title,
    parameters: report.parameters,
    content: report.content,
    createdBy: report.createdBy,
    createdAt: new Date(),
  }).returning();
  return row;
}

export async function deleteAiReport(id: string) {
  const result = await db.delete(aiReports).where(eq(aiReports.id, id)).returning();
  return result.length > 0;
}
