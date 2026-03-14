import crypto from "node:crypto";
import type { RoadmapRow, Tactic, JiraLink, ChangelogChangeType, ChangelogImpactLevel } from "@roadmap/shared";

export interface FieldDiff {
  fieldName: string;
  oldValue: unknown;
  newValue: unknown;
  changeType: ChangelogChangeType;
  impactLevel?: ChangelogImpactLevel;
}

const FIELD_CHANGE_TYPE_MAP: Record<string, ChangelogChangeType> = {
  strategicPillar: "scope_change",
  productPriority: "priority_change",
  investment: "scope_change",
  description: "scope_change",
  metricId: "scope_change",
  tags: "scope_change",
  themes: "scope_change",
  domain: "scope_change",
  subDomain: "scope_change",
  owners: "assignment_change",
  timeline: "date_shift",
  tactics: "scope_change",
  visibility: "scope_change",
};

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj).sort();
  const bKeys = Object.keys(bObj).sort();
  if (aKeys.length !== bKeys.length) return false;
  if (aKeys.some((k, i) => k !== bKeys[i])) return false;
  return aKeys.every((k) => deepEqual(aObj[k], bObj[k]));
}

function computeTimelineShiftWeeks(
  oldTimeline: { start: string; end: string } | null | undefined,
  newTimeline: { start: string; end: string } | null | undefined,
): number {
  if (!oldTimeline || !newTimeline) return 0;
  const oldStart = new Date(oldTimeline.start).getTime();
  const newStart = new Date(newTimeline.start).getTime();
  const oldEnd = new Date(oldTimeline.end).getTime();
  const newEnd = new Date(newTimeline.end).getTime();
  if ([oldStart, oldEnd, newStart, newEnd].some((v) => isNaN(v))) return 0;
  const startShiftMs = Math.abs(newStart - oldStart);
  const endShiftMs = Math.abs(newEnd - oldEnd);
  const maxShiftMs = Math.max(startShiftMs, endShiftMs);
  return maxShiftMs / (7 * 24 * 60 * 60 * 1000);
}

export function computeFieldDiffs(
  oldRow: RoadmapRow,
  patch: Record<string, unknown>,
): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const trackableFields = [
    "strategicPillar", "productPriority", "investment", "description",
    "metricId", "tags", "themes", "domain", "subDomain", "owners", "timeline",
    "visibility",
  ];

  for (const field of trackableFields) {
    if (!(field in patch)) continue;
    const oldVal = (oldRow as unknown as Record<string, unknown>)[field];
    const newVal = patch[field];
    if (deepEqual(oldVal, newVal)) continue;

    const changeType = FIELD_CHANGE_TYPE_MAP[field] || "scope_change";
    let impactLevel: ChangelogImpactLevel | undefined;

    if (field === "timeline") {
      const weeks = computeTimelineShiftWeeks(
        oldVal as { start: string; end: string } | null | undefined,
        newVal as { start: string; end: string } | null | undefined,
      );
      if (weeks >= 2) {
        impactLevel = "high";
      }
    }

    diffs.push({ fieldName: field, oldValue: oldVal, newValue: newVal, changeType, impactLevel });
  }

  return diffs;
}

interface TacticDiffResult {
  entityType: "tactic";
  entityId: string;
  fieldName: string;
  oldValue: unknown;
  newValue: unknown;
  changeType: ChangelogChangeType;
  impactLevel?: ChangelogImpactLevel;
}

const TACTIC_FIELD_CHANGE_TYPE_MAP: Record<string, ChangelogChangeType> = {
  status: "status_change",
  timeline: "date_shift",
  owner: "assignment_change",
  name: "scope_change",
  description: "scope_change",
  deliveryConfidence: "scope_change",
  tags: "scope_change",
  themes: "scope_change",
  visibility: "scope_change",
};

export function computeTacticDiffs(
  oldTactics: Tactic[],
  newTactics: Tactic[],
): TacticDiffResult[] {
  const diffs: TacticDiffResult[] = [];
  const oldMap = new Map(oldTactics.map((t) => [t.id, t]));
  const newMap = new Map(newTactics.map((t) => [t.id, t]));

  for (const [id, newTactic] of newMap) {
    const oldTactic = oldMap.get(id);
    if (!oldTactic) {
      diffs.push({
        entityType: "tactic",
        entityId: id,
        fieldName: "tactic",
        oldValue: null,
        newValue: { id: newTactic.id, name: newTactic.name },
        changeType: "new_item",
      });
      continue;
    }

    const trackedFields = ["status", "timeline", "owner", "name", "description", "deliveryConfidence", "tags", "themes", "visibility"];
    for (const field of trackedFields) {
      const oldVal = (oldTactic as unknown as Record<string, unknown>)[field];
      const newVal = (newTactic as unknown as Record<string, unknown>)[field];
      if (deepEqual(oldVal, newVal)) continue;

      const changeType = TACTIC_FIELD_CHANGE_TYPE_MAP[field] || "scope_change";
      let impactLevel: ChangelogImpactLevel | undefined;

      if (field === "timeline") {
        const weeks = computeTimelineShiftWeeks(
          oldVal as { start: string; end: string } | null | undefined,
          newVal as { start: string; end: string } | null | undefined,
        );
        if (weeks >= 2) impactLevel = "high";
      }

      diffs.push({
        entityType: "tactic",
        entityId: id,
        fieldName: field,
        oldValue: oldVal,
        newValue: newVal,
        changeType,
        impactLevel,
      });
    }
  }

  for (const [id, oldTactic] of oldMap) {
    if (!newMap.has(id)) {
      diffs.push({
        entityType: "tactic",
        entityId: id,
        fieldName: "tactic",
        oldValue: { id: oldTactic.id, name: oldTactic.name },
        newValue: null,
        changeType: "removed_item",
      });
    }
  }

  return diffs;
}

export interface ChangelogInsert {
  id: string;
  entityType: "investment" | "tactic";
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
}

function computeJiraLinkDiffs(
  oldLinks: JiraLink[],
  newLinks: JiraLink[],
): { added: JiraLink[]; removed: JiraLink[] } {
  const oldKeys = new Set(oldLinks.map((l) => l.key));
  const newKeys = new Set(newLinks.map((l) => l.key));
  const added = newLinks.filter((l) => !oldKeys.has(l.key));
  const removed = oldLinks.filter((l) => !newKeys.has(l.key));
  return { added, removed };
}

export function buildChangelogInserts(
  oldRow: RoadmapRow,
  patch: Record<string, unknown>,
  actor: string,
  now: Date = new Date(),
): ChangelogInsert[] {
  const inserts: ChangelogInsert[] = [];

  const fieldDiffs = computeFieldDiffs(oldRow, patch);
  for (const diff of fieldDiffs) {
    inserts.push({
      id: crypto.randomUUID(),
      entityType: "investment",
      entityId: oldRow.id,
      fieldName: diff.fieldName,
      oldValue: diff.oldValue ?? null,
      newValue: diff.newValue ?? null,
      changeType: diff.changeType,
      changedBy: actor,
      changedAt: now,
      source: "app",
      gtmActionNeeded: false,
      impactLevel: diff.impactLevel,
    });
  }

  if ("jiraLinks" in patch && Array.isArray(patch.jiraLinks)) {
    const { added, removed } = computeJiraLinkDiffs(oldRow.jiraLinks || [], patch.jiraLinks as JiraLink[]);
    for (const link of added) {
      inserts.push({
        id: crypto.randomUUID(),
        entityType: "investment",
        entityId: oldRow.id,
        fieldName: "jiraLink",
        oldValue: null,
        newValue: { key: link.key, title: link.title, url: link.url },
        changeType: "scope_change",
        changedBy: actor,
        changedAt: now,
        source: "app",
        gtmActionNeeded: false,
      });
    }
    for (const link of removed) {
      inserts.push({
        id: crypto.randomUUID(),
        entityType: "investment",
        entityId: oldRow.id,
        fieldName: "jiraLink",
        oldValue: { key: link.key, title: link.title, url: link.url },
        newValue: null,
        changeType: "scope_change",
        changedBy: actor,
        changedAt: now,
        source: "app",
        gtmActionNeeded: false,
      });
    }
  }

  if ("tactics" in patch && Array.isArray(patch.tactics)) {
    const tacticDiffs = computeTacticDiffs(oldRow.tactics || [], patch.tactics as Tactic[]);
    for (const diff of tacticDiffs) {
      inserts.push({
        id: crypto.randomUUID(),
        entityType: "tactic",
        entityId: diff.entityId,
        investmentId: oldRow.id,
        fieldName: diff.fieldName,
        oldValue: diff.oldValue ?? null,
        newValue: diff.newValue ?? null,
        changeType: diff.changeType,
        changedBy: actor,
        changedAt: now,
        source: "app",
        gtmActionNeeded: false,
        impactLevel: diff.impactLevel,
      });
    }

    const oldTacticMap = new Map((oldRow.tactics || []).map((t) => [t.id, t]));
    const newTacticMap = new Map((patch.tactics as Tactic[]).map((t) => [t.id, t]));
    for (const [id, newTactic] of newTacticMap) {
      const oldTactic = oldTacticMap.get(id);
      if (!oldTactic) continue;
      const { added, removed } = computeJiraLinkDiffs(oldTactic.jiraLinks || [], newTactic.jiraLinks || []);
      for (const link of added) {
        inserts.push({
          id: crypto.randomUUID(),
          entityType: "tactic",
          entityId: id,
          investmentId: oldRow.id,
          fieldName: "jiraLink",
          oldValue: null,
          newValue: { key: link.key, title: link.title, url: link.url },
          changeType: "scope_change",
          changedBy: actor,
          changedAt: now,
          source: "app",
          gtmActionNeeded: false,
        });
      }
      for (const link of removed) {
        inserts.push({
          id: crypto.randomUUID(),
          entityType: "tactic",
          entityId: id,
          investmentId: oldRow.id,
          fieldName: "jiraLink",
          oldValue: { key: link.key, title: link.title, url: link.url },
          newValue: null,
          changeType: "scope_change",
          changedBy: actor,
          changedAt: now,
          source: "app",
          gtmActionNeeded: false,
        });
      }
    }
  }

  return inserts;
}
