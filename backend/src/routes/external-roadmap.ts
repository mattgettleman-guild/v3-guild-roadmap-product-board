import { Router } from "express";
import { z } from "zod";
import { readStore } from "../lib/store.js";
import { filterForAudience, rewriteCardSummaries, generatePrioritySummary } from "../lib/ai-client.js";

export const externalRoadmapRouter = Router();

const audienceInput = z.object({
  audience: z.enum(["exec", "product", "eps", "sales", "employers"]),
});

externalRoadmapRouter.post("/audience-view", async (req, res) => {
  try {
    const parsed = audienceInput.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid audience" });
    }

    const store = await readStore();
    const summary = store.rows.map((r) => ({
      id: r.id,
      investment: r.investment,
      pillar: r.strategicPillar,
      priority: r.productPriority,
      domain: r.domain,
      themes: r.themes ?? [],
      description: r.description,
      status: r.status,
    }));

    const result = await filterForAudience(parsed.data.audience, summary);
    res.json(result);
  } catch (err) {
    console.error("POST /external-roadmap/audience-view error:", err);
    res.status(500).json({ error: "Failed to generate audience view" });
  }
});

externalRoadmapRouter.post("/card-summaries", async (req, res) => {
  try {
    const parsed = audienceInput.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid audience" });
    }

    const store = await readStore();
    const payload = store.rows.map((r) => ({
      id: r.id,
      investment: r.investment,
      description: r.description,
      domain: r.domain,
      themes: r.themes ?? [],
      expectedBenefits: (r.expectedBenefits ?? []) as string[],
    }));

    const summaries = await rewriteCardSummaries(parsed.data.audience, payload);
    res.json({ summaries });
  } catch (err) {
    console.error("POST /external-roadmap/card-summaries error:", err);
    res.status(500).json({ error: "Failed to generate card summaries" });
  }
});

const prioritySummaryInput = z.object({
  priority: z.string().min(1),
  pillar: z.string().default(""),
  investments: z.array(z.object({
    investment: z.string(),
    description: z.string().optional(),
    expectedBenefits: z.array(z.string()).optional(),
    jiraKeys: z.array(z.string()).optional(),
    tactics: z.array(z.object({
      name: z.string(),
      description: z.string().optional(),
      status: z.string().optional(),
    })).optional(),
  })),
});

externalRoadmapRouter.post("/priority-summary", async (req, res) => {
  try {
    const parsed = prioritySummaryInput.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const { priority, pillar, investments } = parsed.data;
    const summary = await generatePrioritySummary(priority, pillar, investments);
    res.json({ summary });
  } catch (err) {
    console.error("POST /external-roadmap/priority-summary error:", err);
    res.status(500).json({ error: "Failed to generate priority summary" });
  }
});
