import { Router } from "express";
import { z } from "zod";
import { eq, isNull } from "drizzle-orm";
import { db } from "../lib/db.js";
import { roadmapRows, productPriorities } from "../lib/schema.js";
import { generatePrioritySummary } from "../lib/ai-client.js";
import { requireRole } from "../lib/auth.js";
import { syncPriorityRecords, autoGenerateMissingSummaries } from "../lib/priorities.js";

export const prioritiesRouter = Router();

// GET /api/priorities — list all
prioritiesRouter.get("/", async (_req, res) => {
  try {
    const rows = await db.select().from(productPriorities);
    res.json(rows);
  } catch (err) {
    console.error("GET /api/priorities error:", err);
    res.status(500).json({ error: "Failed to fetch priorities" });
  }
});

// POST /api/priorities/sync — upsert records + generate missing summaries in background
prioritiesRouter.post("/sync", requireRole("admin", "editor"), async (req, res) => {
  try {
    const actor = req.user?.email ?? "unknown";
    await syncPriorityRecords(actor);
    autoGenerateMissingSummaries().catch((err) => console.error("[Priority Sync] bg error:", err));
    res.json({ ok: true, message: "Sync started; summaries generating in background" });
  } catch (err) {
    console.error("POST /api/priorities/sync error:", err);
    res.status(500).json({ error: "Failed to sync priorities" });
  }
});

// POST /api/priorities/:name/generate — generate + persist summary for one priority
prioritiesRouter.post("/:name/generate", requireRole("admin", "editor"), async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name as string);
    // Upsert the record so generate works even before sync has run
    await db
      .insert(productPriorities)
      .values({ name, updatedBy: req.user?.email ?? "unknown" })
      .onConflictDoNothing();
    const existing = await db.select().from(productPriorities).where(eq(productPriorities.name, name));
    const p = existing[0];

    const investments = await db
      .select()
      .from(roadmapRows)
      .where(eq(roadmapRows.productPriority, name));

    const investmentInputs = investments.map((r) => ({
      investment: r.investment,
      description: r.description ?? undefined,
      expectedBenefits: (r.expectedBenefits as string[]) ?? [],
      jiraKeys: ((r.jiraLinks as Array<{ key: string }>) ?? []).map((j) => j.key).filter(Boolean),
      tactics: ((r.tactics as Array<{ name: string; description?: string; status?: string }>) ?? []).map(
        (t) => ({ name: t.name, description: t.description, status: t.status }),
      ),
    }));

    const summary = await generatePrioritySummary(name, p.strategicPillar ?? "", investmentInputs);
    await db
      .update(productPriorities)
      .set({
        commercialWhy: summary,
        aiGeneratedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: req.user?.email ?? "unknown",
      })
      .where(eq(productPriorities.name, name));

    res.json({ commercialWhy: summary });
  } catch (err) {
    console.error("POST /api/priorities/:name/generate error:", err);
    res.status(500).json({ error: "Failed to generate priority summary" });
  }
});

// PATCH /api/priorities/:name — update stored metadata
const patchSchema = z.object({
  domain: z.string().optional(),
  commercialWhy: z.string().optional(),
  transformations: z.array(z.object({ from: z.string(), to: z.string(), impact: z.string() })).optional(),
  expectedOutcomes: z.array(z.string()).optional(),
});

prioritiesRouter.patch("/:name", requireRole("admin", "editor"), async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name as string);
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const actor = req.user?.email ?? "unknown";
    await db
      .insert(productPriorities)
      .values({ name, ...parsed.data, updatedBy: actor })
      .onConflictDoUpdate({
        target: productPriorities.name,
        set: { ...parsed.data, updatedBy: actor, updatedAt: new Date() },
      });
    res.json({ ok: true });
  } catch (err) {
    console.error("PATCH /api/priorities/:name error:", err);
    res.status(500).json({ error: "Failed to update priority" });
  }
});
