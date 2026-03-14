import Fuse from "fuse.js";
import { db } from "./db.js";
import { roadmapRows, documentLinks, documentChunks } from "./schema.js";
import { eq } from "drizzle-orm";
import type { ParsedChunk } from "./kb-parser.js";

const FUSE_THRESHOLD = 0.4;

interface InvestmentRef {
  rowId: string;
  investment: string;
  jiraKeys: string[];
  tacticNames: string[];
  tacticJiraKeys: Map<string, string[]>;
}

async function loadInvestmentRefs(): Promise<InvestmentRef[]> {
  const rows = await db.select().from(roadmapRows);
  return rows.map((r) => {
    const tactics = (r.tactics as any[]) || [];
    const tacticJiraKeys = new Map<string, string[]>();
    const allTacticKeys: string[] = [];

    for (const t of tactics) {
      const keys = (t.jiraLinks || []).map((l: any) => l.key);
      tacticJiraKeys.set(t.id, keys);
      allTacticKeys.push(...keys);
    }

    const rowJiraKeys = (r.jiraLinks as any[] || []).map((l: any) => l.key);

    return {
      rowId: r.id,
      investment: r.investment,
      jiraKeys: [...rowJiraKeys, ...allTacticKeys],
      tacticNames: tactics.map((t: any) => t.name),
      tacticJiraKeys,
    };
  });
}

interface AutoLinkSuggestion {
  documentId: string;
  rowId: string;
  tacticId?: string;
  linkType: "auto-suggested";
  confidence: number;
  matchReason: string;
  matchLevel: "investment" | "tactic";
}

export async function generateAutoLinks(
  documentId: string,
  chunks: ParsedChunk[],
  documentFilename?: string,
): Promise<void> {
  const refs = await loadInvestmentRefs();
  if (!refs.length) return;

  const allChunkJiraKeys = new Set<string>();
  for (const chunk of chunks) {
    for (const key of chunk.jiraKeys) {
      allChunkJiraKeys.add(key);
    }
  }

  const suggestions = new Map<string, AutoLinkSuggestion>();

  for (const ref of refs) {
    const matchedKeys: string[] = [];
    for (const key of ref.jiraKeys) {
      if (allChunkJiraKeys.has(key)) {
        matchedKeys.push(key);
      }
    }
    if (matchedKeys.length > 0) {
      const existingKey = `${documentId}-${ref.rowId}`;
      const existing = suggestions.get(existingKey);
      if (!existing || existing.confidence < 95) {
        suggestions.set(existingKey, {
          documentId,
          rowId: ref.rowId,
          linkType: "auto-suggested",
          confidence: 95,
          matchReason: `Jira key${matchedKeys.length > 1 ? "s" : ""} ${matchedKeys.slice(0, 5).join(", ")} found in document content, matching this investment's linked Jira issues`,
          matchLevel: "investment",
        });
      }
    }
  }

  const investmentNames = refs.map((r) => ({
    rowId: r.rowId,
    name: r.investment,
  }));

  const fuse = new Fuse(investmentNames, {
    keys: ["name"],
    threshold: FUSE_THRESHOLD,
    includeScore: true,
  });

  if (documentFilename) {
    const cleanName = documentFilename
      .replace(/\.\w+$/, "")
      .replace(/[_\-()]+/g, " ")
      .replace(/\s*\d+\s*$/, "")
      .replace(/\b(POR|por|recap|strategy|release|announcement|announcements|reference|document|doc)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    const filenameParts = [cleanName];
    const words = cleanName.split(/\s+/).filter((w) => w.length > 3);
    filenameParts.push(...words);

    for (const part of filenameParts) {
      if (part.length < 3) continue;
      const results = fuse.search(part);
      for (const result of results.slice(0, 3)) {
        const key = `${documentId}-${result.item.rowId}`;
        if (!suggestions.has(key)) {
          const confidence = Math.round((1 - (result.score || 0.5)) * 100);
          suggestions.set(key, {
            documentId,
            rowId: result.item.rowId,
            linkType: "auto-suggested",
            confidence: Math.min(confidence, 85),
            matchReason: `Document filename "${documentFilename}" fuzzy-matched investment name "${result.item.name}" (search term: "${part}")`,
            matchLevel: "investment",
          });
        }
      }
    }
  }

  const chunkInitiatives = new Set<string>();
  for (const chunk of chunks) {
    if (chunk.initiative) chunkInitiatives.add(chunk.initiative);
    const words = chunk.content.split(/\s+/).slice(0, 50).join(" ");
    if (words.length > 10) {
      const results = fuse.search(words);
      for (const result of results.slice(0, 3)) {
        const key = `${documentId}-${result.item.rowId}`;
        if (!suggestions.has(key)) {
          const confidence = Math.round((1 - (result.score || 0.5)) * 100);
          const sectionLabel = chunk.sectionType && chunk.sectionType !== "general"
            ? ` in "${chunk.sectionType.replace(/_/g, " ")}" section`
            : "";
          const monthLabel = chunk.month ? ` (${chunk.month})` : "";
          suggestions.set(key, {
            documentId,
            rowId: result.item.rowId,
            linkType: "auto-suggested",
            confidence: Math.min(confidence, 80),
            matchReason: `Document content${sectionLabel}${monthLabel} fuzzy-matched investment name "${result.item.name}"`,
            matchLevel: "investment",
          });
        }
      }
    }
  }

  for (const initiative of chunkInitiatives) {
    const results = fuse.search(initiative);
    for (const result of results.slice(0, 2)) {
      const key = `${documentId}-${result.item.rowId}`;
      if (!suggestions.has(key)) {
        const confidence = Math.round((1 - (result.score || 0.5)) * 100);
        suggestions.set(key, {
          documentId,
          rowId: result.item.rowId,
          linkType: "auto-suggested",
          confidence: Math.min(confidence, 85),
          matchReason: `AI-detected initiative "${initiative}" in document structure matched investment name "${result.item.name}"`,
          matchLevel: "investment",
        });
      }
    }
  }

  if (suggestions.size > 0) {
    const values = [...suggestions.values()];
    for (const s of values) {
      await db.insert(documentLinks).values({
        documentId: s.documentId,
        rowId: s.rowId,
        tacticId: s.tacticId,
        linkType: s.linkType,
        confidence: s.confidence,
        matchReason: s.matchReason,
        matchLevel: s.matchLevel,
      });
    }
  }
}

export async function carryForwardLinks(
  oldDocumentId: string,
  newDocumentId: string,
): Promise<void> {
  const existingLinks = await db
    .select()
    .from(documentLinks)
    .where(eq(documentLinks.documentId, oldDocumentId));

  for (const link of existingLinks) {
    await db.insert(documentLinks).values({
      documentId: newDocumentId,
      rowId: link.rowId,
      tacticId: link.tacticId,
      linkType: "auto-suggested",
      confidence: link.confidence,
      matchReason: link.matchReason,
      matchLevel: link.matchLevel,
    });
  }
}
