import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "../lib/db.js";
import { productPriorities, roadmapRows } from "../lib/schema.js";
import { requireRole } from "../lib/auth.js";

export const prioritiesV3Router = Router();

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function mapRow(row: typeof productPriorities.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug ?? slugify(row.name),
    strategicPillar: row.strategicPillar,
    status: row.status ?? "active",
    owner: row.owner ?? [],
    briefObjective: row.briefObjective,
    problemStatement: row.problemStatement,
    commercialWhy: row.commercialWhy,
    outOfScope: row.outOfScope,
    successMetrics: row.successMetrics,
    keyAssumptions: row.keyAssumptions,
    transformations: row.transformations,
    aiSummary: row.aiSummary,
    aiGeneratedAt: row.aiGeneratedAt?.toISOString() ?? null,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// GET /api/priorities/v3 — list all priorities
prioritiesV3Router.get("/", async (_req, res) => {
  try {
    const rows = await db.select().from(productPriorities);
    res.json(rows.map(mapRow));
  } catch (err) {
    console.error("GET /api/priorities/v3 error:", err);
    res.status(500).json({ error: "Failed to fetch priorities" });
  }
});

// GET /api/priorities/v3/:id — get by UUID
prioritiesV3Router.get("/:id", async (req, res) => {
  try {
    const id = req.params.id as string;
    const [row] = await db.select().from(productPriorities).where(eq(productPriorities.id, id));
    if (!row) return res.status(404).json({ error: "Priority not found" });
    res.json(mapRow(row));
  } catch (err) {
    console.error("GET /api/priorities/v3/:id error:", err);
    res.status(500).json({ error: "Failed to fetch priority" });
  }
});

// POST /api/priorities/v3 — create new priority
const createSchema = z.object({
  name: z.string().min(1),
  strategicPillar: z.string().nullable().optional(),
  status: z.enum(["active", "paused", "complete"]).optional(),
  owner: z.array(z.string()).optional(),
  briefObjective: z.string().nullable().optional(),
  problemStatement: z.string().nullable().optional(),
  commercialWhy: z.string().nullable().optional(),
  outOfScope: z.string().nullable().optional(),
  successMetrics: z.array(z.object({
    name: z.string(), target: z.string(), unit: z.string(), direction: z.string(), baseline: z.string(),
  })).nullable().optional(),
  keyAssumptions: z.array(z.object({
    assumption: z.string(), riskLevel: z.enum(["high", "medium", "low"]),
  })).nullable().optional(),
  transformations: z.array(z.object({
    from: z.string(), to: z.string(), impact: z.string(),
  })).nullable().optional(),
});

prioritiesV3Router.post("/", requireRole("admin", "editor"), async (req, res) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const actor = req.user?.email ?? "unknown";
    const slug = slugify(parsed.data.name);

    const [row] = await db.insert(productPriorities).values({
      name: parsed.data.name,
      slug,
      strategicPillar: parsed.data.strategicPillar ?? null,
      status: parsed.data.status ?? "active",
      owner: parsed.data.owner ?? [],
      briefObjective: parsed.data.briefObjective ?? null,
      problemStatement: parsed.data.problemStatement ?? null,
      commercialWhy: parsed.data.commercialWhy ?? null,
      outOfScope: parsed.data.outOfScope ?? null,
      successMetrics: parsed.data.successMetrics ?? null,
      keyAssumptions: parsed.data.keyAssumptions ?? null,
      transformations: parsed.data.transformations ?? null,
      createdBy: actor,
      updatedBy: actor,
    }).returning();

    res.status(201).json(mapRow(row));
  } catch (err) {
    console.error("POST /api/priorities/v3 error:", err);
    res.status(500).json({ error: "Failed to create priority" });
  }
});

// PATCH /api/priorities/v3/:id — update by UUID
const patchSchema = z.object({
  name: z.string().min(1).optional(),
  strategicPillar: z.string().nullable().optional(),
  status: z.enum(["active", "paused", "complete"]).optional(),
  owner: z.array(z.string()).optional(),
  briefObjective: z.string().nullable().optional(),
  problemStatement: z.string().nullable().optional(),
  commercialWhy: z.string().nullable().optional(),
  outOfScope: z.string().nullable().optional(),
  successMetrics: z.array(z.object({
    name: z.string(), target: z.string(), unit: z.string(), direction: z.string(), baseline: z.string(),
  })).nullable().optional(),
  keyAssumptions: z.array(z.object({
    assumption: z.string(), riskLevel: z.enum(["high", "medium", "low"]),
  })).nullable().optional(),
  transformations: z.array(z.object({
    from: z.string(), to: z.string(), impact: z.string(),
  })).nullable().optional(),
  domain: z.string().nullable().optional(),
  expectedOutcomes: z.array(z.string()).nullable().optional(),
});

prioritiesV3Router.patch("/:id", requireRole("admin", "editor"), async (req, res) => {
  try {
    const id = req.params.id as string;
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const actor = req.user?.email ?? "unknown";
    const updateData: Record<string, unknown> = { ...parsed.data, updatedBy: actor, updatedAt: new Date() };
    if (parsed.data.name) {
      updateData.slug = slugify(parsed.data.name);
    }

    const [row] = await db
      .update(productPriorities)
      .set(updateData)
      .where(eq(productPriorities.id, id))
      .returning();

    if (!row) return res.status(404).json({ error: "Priority not found" });
    res.json(mapRow(row));
  } catch (err) {
    console.error("PATCH /api/priorities/v3/:id error:", err);
    res.status(500).json({ error: "Failed to update priority" });
  }
});

// DELETE /api/priorities/v3/:id
prioritiesV3Router.delete("/:id", requireRole("admin"), async (req, res) => {
  try {
    const id = req.params.id as string;
    const [row] = await db.delete(productPriorities).where(eq(productPriorities.id, id)).returning();
    if (!row) return res.status(404).json({ error: "Priority not found" });
    res.status(204).send();
  } catch (err) {
    console.error("DELETE /api/priorities/v3/:id error:", err);
    res.status(500).json({ error: "Failed to delete priority" });
  }
});

// POST /api/priorities/v3/:id/generate-summary — AI summary stub
prioritiesV3Router.post("/:id/generate-summary", requireRole("admin", "editor"), async (req, res) => {
  try {
    const id = req.params.id as string;
    const [priority] = await db.select().from(productPriorities).where(eq(productPriorities.id, id));
    if (!priority) return res.status(404).json({ error: "Priority not found" });

    const investments = await db.select().from(roadmapRows).where(eq(roadmapRows.productPriority, priority.name));

    // Stub: in production this would call OpenAI
    const summary = `AI summary for "${priority.name}" covering ${investments.length} investment(s). This is a placeholder — connect OpenAI to generate real summaries.`;

    await db
      .update(productPriorities)
      .set({ aiSummary: summary, aiGeneratedAt: new Date(), updatedAt: new Date() })
      .where(eq(productPriorities.id, id));

    res.json({ summary });
  } catch (err) {
    console.error("POST /api/priorities/v3/:id/generate-summary error:", err);
    res.status(500).json({ error: "Failed to generate summary" });
  }
});

// POST /api/priorities/v3/sync — sync from taxonomy (reuse existing behavior)
prioritiesV3Router.post("/sync", requireRole("admin", "editor"), async (req, res) => {
  try {
    // Import the existing sync function from the v2 priorities module
    const { syncPriorityRecords, autoGenerateMissingSummaries } = await import("../lib/priorities.js");
    const actor = req.user?.email ?? "unknown";
    await syncPriorityRecords(actor);
    autoGenerateMissingSummaries().catch((err) => console.error("[Priority Sync v3] bg error:", err));
    res.json({ ok: true, message: "Sync started; summaries generating in background" });
  } catch (err) {
    console.error("POST /api/priorities/v3/sync error:", err);
    res.status(500).json({ error: "Failed to sync priorities" });
  }
});
