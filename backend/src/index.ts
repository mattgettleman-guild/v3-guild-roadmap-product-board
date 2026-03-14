import "dotenv/config";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import multer from "multer";
import PDFDocument from "pdfkit";
import { z } from "zod";
import type { ImportJob, JiraLink, MetricDefinition, RoadmapRow, SavedView, SlideExtraction, Tactic } from "@roadmap/shared";
import { answerRoadmapQuestion, suggestJiraLinks, autoCategorize, detectDuplicates, generateExecutiveSummary, generateInvestmentWriteup, generateQuarterlyReport, generateTacticDescription, generateInvestmentDescription } from "./lib/ai-client.js";
import { parseToDrafts, detectMatchesForDrafts, detectSlideMatches, parseHeaders, parsePastedTextDirect, parsePastedHeaders, parseToDraftsFromAiRows } from "./lib/importer.js";
import { aiParsePastedText } from "./lib/paste-parser.js";
import { parseSlideImage } from "./lib/slide-parser.js";
import { fetchAccomplishments, fetchAttributes, fetchChildren, fetchJiraUsers, fetchUpcomingDeliverables, searchLinkableIssues } from "./lib/jira.js";
import { appendAudit, appendTelemetry, readStore, updateStore, listAiReports, createAiReport, deleteAiReport, insertChangelogEvents } from "./lib/store.js";
import { buildChangelogInserts } from "./lib/changelog.js";
import { db, pool, runMigrations } from "./lib/db.js";
import { users, roadmapRows, metricDefinitions, importJobs, auditEvents, savedViews, telemetryEvents, aiReports, aiThreads, aiMessages, documents, documentChunks, documentLinks, changelogEvents } from "./lib/schema.js";
import { eq } from "drizzle-orm";
import connectRouter from "./lib/connect.js";
import { generateMagicLink, verifyMagicLink, getSessionUser, destroySession, requireAuth, requireRole } from "./lib/auth.js";
import { sendMagicLinkEmail } from "./lib/mailer.js";
import { runWeeklyDigest, sendDigestToUser, fetchDigestEvents, buildDigestHtml } from "./lib/digest.js";
import cron from "node-cron";

import { createProxyMiddleware } from "http-proxy-middleware";
import rateLimit from "express-rate-limit";
import kbRouter from "./routes/kb.js";
import aiAssistantRouter from "./routes/ai-assistant.js";
import { externalRoadmapRouter } from "./routes/external-roadmap.js";
import { prioritiesRouter } from "./routes/priorities.js";
import { syncAndGeneratePriorities } from "./lib/priorities.js";
import { prioritiesV3Router } from "./routes/priorities-v3.js";

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again in a minute." },
});

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many AI requests. Please slow down." },
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again shortly." },
});

const app = express();
app.set("trust proxy", 1);
const upload = multer();
const port = Number(process.env.PORT || 5000);
const VITE_PORT = 5173;

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);

    const allowedOrigins: string[] = [];
    if (process.env.APP_BASE_URL) {
      allowedOrigins.push(process.env.APP_BASE_URL);
    }
    const replitDomain = process.env.REPLIT_DEV_DOMAIN;
    if (replitDomain) {
      allowedOrigins.push(`https://${replitDomain}`);
    }
    if (process.env.NODE_ENV !== "production") {
      allowedOrigins.push(`http://localhost:${VITE_PORT}`);
      allowedOrigins.push(`http://127.0.0.1:${VITE_PORT}`);
      allowedOrigins.push(`http://localhost:${port}`);
      allowedOrigins.push(`http://127.0.0.1:${port}`);
      allowedOrigins.push(`http://0.0.0.0:${port}`);
    }

    const isReplit = origin.endsWith(".replit.dev") || origin.endsWith(".repl.co") || origin.endsWith(".kirk.replit.dev") || origin.endsWith(".replit.app");
    if (allowedOrigins.includes(origin) || isReplit) {
      callback(null, true);
    } else if (allowedOrigins.length === 0 && process.env.NODE_ENV !== "production") {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
}));
app.use((req, res, next) => {
  if (req.path === "/api/import/slide/pdf" || req.path === "/api/import/slide/pdf-page" || req.path === "/api/import/slide/batch-commit") {
    return next();
  }
  express.json({ limit: "10mb" })(req, res, next);
});
app.use(cookieParser());

if (process.env.NODE_ENV === "production") {
  const __filename_static = fileURLToPath(import.meta.url);
  const __dirname_static = path.dirname(__filename_static);
  const distPath = path.resolve(__dirname_static, "../../frontend/dist");
  app.use(express.static(distPath));
}

app.use("/api/", generalLimiter);
app.use("/api/auth/", authLimiter);
app.use("/api/ai", aiLimiter);
app.use("/api/ai-assistant", aiLimiter);

app.get("/api/health", async (_req, res) => {
  try {
    const result = await pool.query("SELECT count(*)::int as cnt FROM roadmap_rows");
    const userResult = await pool.query("SELECT count(*)::int as cnt FROM users");
    res.json({
      status: "ok",
      roadmapRows: result.rows[0]?.cnt ?? 0,
      users: userResult.rows[0]?.cnt ?? 0,
      dbConnected: true,
    });
  } catch (err: any) {
    console.error("GET /api/health error:", err);
    res.json({
      status: "error",
      dbConnected: false,
      error: "Database connection failed",
    });
  }
});

app.use("/api/connect", connectRouter);

app.post("/api/auth/request-link", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "Email is required" });
    }
    const normalized = email.toLowerCase().trim();
    const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN || "guild.com";
    if (!normalized.endsWith(`@${allowedDomain}`)) {
      return res.status(403).json({ error: `Only @${allowedDomain} email addresses are allowed` });
    }
    const token = await generateMagicLink(email);
    const baseUrl = process.env.APP_BASE_URL || `${req.headers["x-forwarded-proto"] || req.protocol}://${req.get("host") || "localhost:5000"}`;
    const magicLinkUrl = `${baseUrl}/api/auth/verify?token=${token}`;
    await sendMagicLinkEmail(normalized, magicLinkUrl);
    res.json({ ok: true, message: "Check your email" });
  } catch (err) {
    console.error("POST /api/auth/request-link error:", err);
    res.status(500).json({ error: "Failed to generate magic link" });
  }
});

app.get("/api/auth/verify", async (req, res) => {
  try {
    const token = String(req.query.token || "");
    if (!token) {
      return res.status(400).json({ error: "Token is required" });
    }
    const result = await verifyMagicLink(token);
    res.cookie("session_token", result.sessionToken, {
      httpOnly: true,
      sameSite: "strict",
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: "/",
    });
    res.redirect("/");
  } catch (err) {
    console.error("GET /api/auth/verify error:", err);
    res.redirect("/?auth_error=invalid_or_expired");
  }
});

app.get("/api/auth/me", async (req, res) => {
  try {
    if (process.env.NODE_ENV !== "production" && process.env.DEV_AUTH_BYPASS === "true") {
      return res.json({ user: { id: "dev-user", email: "dev@guild.com", name: "Dev User", role: "admin" } });
    }
    const token = req.cookies?.session_token;
    if (!token) {
      return res.json({ user: null });
    }
    const user = await getSessionUser(token);
    res.json({ user: user || null });
  } catch (err) {
    console.error("GET /api/auth/me error:", err);
    res.json({ user: null });
  }
});

app.post("/api/auth/logout", async (req, res) => {
  try {
    const token = req.cookies?.session_token;
    if (token) {
      await destroySession(token);
    }
    res.clearCookie("session_token", { path: "/" });
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /api/auth/logout error:", err);
    res.status(500).json({ error: "Failed to logout" });
  }
});

app.use(requireAuth);

app.get("/api/data/export/xlsx", requireRole("admin"), async (_req, res) => {
  try {
    const [rows, taxRows, metrics] = await Promise.all([
      pool.query("SELECT * FROM roadmap_rows ORDER BY strategic_pillar, product_priority, investment"),
      pool.query("SELECT * FROM taxonomy"),
      pool.query("SELECT * FROM metric_definitions"),
    ]);
    const taxonomy = taxRows.rows[0] || { pillars: [], priorities: [], domains: [], owners: [], tags: [], themes: [] };
    res.json({
      rows: rows.rows,
      taxonomy,
      metricDefinitions: metrics.rows,
    });
  } catch (err) {
    console.error("GET /api/data/export/xlsx error:", err);
    res.status(500).json({ error: "Failed to export data" });
  }
});

app.get("/api/data/export", requireRole("admin"), async (_req, res) => {
  try {
    const [rows, taxRows, metrics, views, settings] = await Promise.all([
      pool.query("SELECT * FROM roadmap_rows"),
      pool.query("SELECT * FROM taxonomy"),
      pool.query("SELECT * FROM metric_definitions"),
      pool.query("SELECT * FROM saved_views"),
      pool.query("SELECT * FROM app_settings"),
    ]);
    res.json({
      roadmap_rows: rows.rows,
      taxonomy: taxRows.rows,
      metric_definitions: metrics.rows,
      saved_views: views.rows,
      app_settings: settings.rows,
      exported_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("GET /api/data/export error:", err);
    res.status(500).json({ error: "Failed to export data" });
  }
});

app.post("/api/data/import", requireRole("admin"), async (req, res) => {
  const client = await pool.connect();
  try {
    const data = req.body;
    await client.query("BEGIN");
    let importedRows = 0;
    let importedTaxonomy = 0;
    let importedMetrics = 0;
    let importedViews = 0;
    let importedSettings = 0;

    if (data.roadmap_rows?.length) {
      for (const row of data.roadmap_rows) {
        await client.query(
          `INSERT INTO roadmap_rows (id, strategic_pillar, product_priority, investment, description, metric_id, domain, owners, timeline, tags, tactics, jira_links, visibility, source_of_truth, last_synced_at, created_at, updated_at, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
           ON CONFLICT (id) DO UPDATE SET
             strategic_pillar=EXCLUDED.strategic_pillar, product_priority=EXCLUDED.product_priority,
             investment=EXCLUDED.investment, description=EXCLUDED.description, metric_id=EXCLUDED.metric_id,
             domain=EXCLUDED.domain, owners=EXCLUDED.owners, timeline=EXCLUDED.timeline, tags=EXCLUDED.tags,
             tactics=EXCLUDED.tactics, jira_links=EXCLUDED.jira_links, visibility=EXCLUDED.visibility,
             source_of_truth=EXCLUDED.source_of_truth,
             last_synced_at=EXCLUDED.last_synced_at, updated_at=EXCLUDED.updated_at, updated_by=EXCLUDED.updated_by`,
          [
            row.id, row.strategic_pillar, row.product_priority, row.investment,
            row.description, row.metric_id, row.domain, row.owners,
            row.timeline ? JSON.stringify(row.timeline) : null,
            JSON.stringify(row.tags || []),
            JSON.stringify(row.tactics || []),
            JSON.stringify(row.jira_links || []),
            row.visibility || "internal_only",
            row.source_of_truth ? JSON.stringify(row.source_of_truth) : null,
            row.last_synced_at, row.created_at, row.updated_at, row.updated_by,
          ],
        );
        importedRows++;
      }
    }

    if (data.taxonomy?.length) {
      for (const tax of data.taxonomy) {
        await client.query(
          `INSERT INTO taxonomy (id, pillars, priorities, domains, owners, tags, themes)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (id) DO UPDATE SET
             pillars=EXCLUDED.pillars, priorities=EXCLUDED.priorities,
             domains=EXCLUDED.domains, owners=EXCLUDED.owners, tags=EXCLUDED.tags, themes=EXCLUDED.themes`,
          [tax.id, JSON.stringify(tax.pillars), JSON.stringify(tax.priorities), JSON.stringify(tax.domains), JSON.stringify(tax.owners), JSON.stringify(tax.tags || []), JSON.stringify(tax.themes || [])],
        );
        importedTaxonomy++;
      }
    }

    if (data.metric_definitions?.length) {
      for (const m of data.metric_definitions) {
        await client.query(
          `INSERT INTO metric_definitions (id, name, description, unit, target_value, direction, active, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (id) DO UPDATE SET
             name=EXCLUDED.name, description=EXCLUDED.description, unit=EXCLUDED.unit,
             target_value=EXCLUDED.target_value, direction=EXCLUDED.direction, active=EXCLUDED.active,
             updated_at=EXCLUDED.updated_at`,
          [m.id, m.name, m.description, m.unit, m.target_value, m.direction, m.active, m.created_at, m.updated_at],
        );
        importedMetrics++;
      }
    }

    if (data.saved_views?.length) {
      for (const v of data.saved_views) {
        await client.query(
          `INSERT INTO saved_views (id, name, audience_tag, is_shared, view_mode, filters, visible_columns, column_order, group_by, sort_by, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           ON CONFLICT (id) DO UPDATE SET
             name=EXCLUDED.name, audience_tag=EXCLUDED.audience_tag, is_shared=EXCLUDED.is_shared,
             view_mode=EXCLUDED.view_mode, filters=EXCLUDED.filters, visible_columns=EXCLUDED.visible_columns,
             column_order=EXCLUDED.column_order, group_by=EXCLUDED.group_by, sort_by=EXCLUDED.sort_by,
             updated_at=EXCLUDED.updated_at`,
          [
            v.id, v.name, v.audience_tag, v.is_shared, v.view_mode,
            v.filters ? JSON.stringify(v.filters) : null,
            v.visible_columns ? JSON.stringify(v.visible_columns) : null,
            v.column_order ? JSON.stringify(v.column_order) : null,
            v.group_by ? JSON.stringify(v.group_by) : null,
            v.sort_by ? JSON.stringify(v.sort_by) : null,
            v.created_at, v.updated_at,
          ],
        );
        importedViews++;
      }
    }

    if (data.app_settings?.length) {
      for (const s of data.app_settings) {
        await client.query(
          `INSERT INTO app_settings (id, ai_custom_instructions, updated_by, updated_at)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (id) DO UPDATE SET
             ai_custom_instructions=EXCLUDED.ai_custom_instructions,
             updated_by=EXCLUDED.updated_by, updated_at=EXCLUDED.updated_at`,
          [s.id, s.ai_custom_instructions, s.updated_by, s.updated_at],
        );
        importedSettings++;
      }
    }

    await client.query("COMMIT");
    res.json({
      success: true,
      imported: { rows: importedRows, taxonomy: importedTaxonomy, metrics: importedMetrics, views: importedViews, settings: importedSettings },
    });
    syncAndGeneratePriorities("system");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/data/import error:", err);
    res.status(500).json({ error: "Failed to import data" });
  } finally {
    client.release();
  }
});

app.get("/api/users", requireRole("admin"), async (_req, res) => {
  try {
    const allUsers = await db.select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    }).from(users);
    res.json(allUsers.map((u) => ({
      ...u,
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
    })));
  } catch (err) {
    console.error("GET /api/users error:", err);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

app.patch("/api/users/:id", requireRole("admin"), async (req, res) => {
  try {
    const { role } = req.body;
    if (!role || !["viewer", "editor", "admin"].includes(role)) {
      return res.status(400).json({ error: "Invalid role. Must be viewer, editor, or admin." });
    }
    const [updated] = await db
      .update(users)
      .set({ role, updatedAt: new Date() })
      .where(eq(users.id, req.params.id as string))
      .returning({ id: users.id, email: users.email, name: users.name, role: users.role, createdAt: users.createdAt, updatedAt: users.updatedAt });
    if (!updated) return res.status(404).json({ error: "User not found" });
    res.json({
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  } catch (err) {
    console.error("PATCH /api/users/:id error:", err);
    res.status(500).json({ error: "Failed to update user" });
  }
});

app.get("/api/digest/preferences", requireAuth, async (req, res) => {
  try {
    const email = req.user?.email;
    if (!email) return res.status(401).json({ error: "Authentication required" });
    const result = await pool.query(
      `SELECT digest_subscribed as "digestSubscribed" FROM users WHERE email = $1`,
      [email],
    );
    if (result.rows.length === 0) return res.json({ digestSubscribed: true });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("GET /api/digest/preferences error:", err);
    res.status(500).json({ error: "Failed to fetch digest preferences" });
  }
});

app.patch("/api/digest/preferences", requireAuth, async (req, res) => {
  try {
    const email = req.user?.email;
    if (!email) return res.status(401).json({ error: "Authentication required" });
    const { digestSubscribed } = req.body;
    if (typeof digestSubscribed !== "boolean") {
      return res.status(400).json({ error: "digestSubscribed must be a boolean" });
    }
    await pool.query(
      `UPDATE users SET digest_subscribed = $1, updated_at = NOW() WHERE email = $2`,
      [digestSubscribed, email],
    );
    res.json({ digestSubscribed });
  } catch (err) {
    console.error("PATCH /api/digest/preferences error:", err);
    res.status(500).json({ error: "Failed to update digest preferences" });
  }
});

app.get("/api/admin/digest/stats", requireRole("admin"), async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE digest_subscribed = true) as "subscribedCount",
        COUNT(*) as "totalUsers",
        MAX(last_digest_sent_at) as "lastRun"
       FROM users`,
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("GET /api/admin/digest/stats error:", err);
    res.status(500).json({ error: "Failed to fetch digest stats" });
  }
});

app.post("/api/admin/digest/send-test", requireRole("admin"), async (req, res) => {
  try {
    const user = (req as any).user;
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const events = await fetchDigestEvents(since);
    const appUrl = process.env.APP_BASE_URL || `${req.headers["x-forwarded-proto"] || req.protocol}://${req.get("host") || "localhost:5000"}`;
    await sendDigestToUser(user.email, events, `${appUrl}/#changelog`);
    res.json({ success: true, eventCount: events.length, sentTo: user.email });
  } catch (err) {
    console.error("POST /api/admin/digest/send-test error:", err);
    res.status(500).json({ error: "Failed to send test digest" });
  }
});

app.post("/api/admin/digest/trigger", requireRole("admin"), async (req, res) => {
  try {
    const appUrl = process.env.APP_BASE_URL || `${req.headers["x-forwarded-proto"] || req.protocol}://${req.get("host") || "localhost:5000"}`;
    const result = await runWeeklyDigest(`${appUrl}/#changelog`);
    res.json(result);
  } catch (err) {
    console.error("POST /api/admin/digest/trigger error:", err);
    res.status(500).json({ error: "Failed to trigger digest" });
  }
});

app.use("/api/kb", kbRouter);
app.use("/api/ai-assistant", aiAssistantRouter);
app.use("/api/external-roadmap", externalRoadmapRouter);
app.use("/api/priorities/v3", prioritiesV3Router);
app.use("/api/priorities", prioritiesRouter);

const taxonomyInput = z.object({
  pillars: z.array(z.string().min(1)).min(1),
  priorities: z.array(z.string().min(1)).default([]),
  domains: z.array(z.string().min(1)).default([]),
  subDomains: z.array(z.string().min(1)).default([]),
  owners: z.array(z.string().min(1)).default([]),
  tags: z.array(z.string().min(1)).default([]),
  themes: z.array(z.string().min(1)).default([]),
});

const rowInput = z.object({
  strategicPillar: z.string().default(""),
  productPriority: z.string().default(""),
  investment: z.string().min(1),
  description: z.string().optional(),
  metricId: z.string().optional(),
  tags: z.array(z.string()).default([]),
  themes: z.array(z.string()).default([]),
  domain: z.string().default(""),
  subDomain: z.string().optional(),
  owners: z.string().default(""),
  timeline: z
    .object({
      start: z.string(),
      end: z.string(),
    })
    .optional(),
  tactics: z.array(z.any()).default([]),
  jiraLinks: z.array(z.any()).default([]),
  visibility: z.enum(["external_approved", "internal_only"]).default("internal_only"),
});

const metricInput = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  unit: z.string().optional(),
  targetValue: z.number().optional(),
  direction: z.enum(["increase", "decrease", "maintain"]).default("increase"),
  active: z.boolean().default(true),
});

app.get("/health", (_req, res) => {
  const hasReplitConnector = Boolean(process.env.REPLIT_CONNECTORS_HOSTNAME);
  const hasApiToken = Boolean(process.env.JIRA_EMAIL && process.env.JIRA_API_TOKEN);
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    jiraConfigured: hasReplitConnector || hasApiToken,
    jiraAuthMethod: hasReplitConnector ? "replit_connector" : hasApiToken ? "api_token" : "none",
    database: "postgresql",
  });
});

app.get("/api/taxonomy", async (_req, res) => {
  try {
    const store = await readStore();
    res.json(store.taxonomy);
  } catch (err) {
    console.error("GET /api/taxonomy error:", err);
    res.status(500).json({ error: "Failed to read taxonomy" });
  }
});

app.get("/api/settings", async (_req, res) => {
  try {
    const { taxonomy, metrics } = await readStore();
    res.json({ taxonomy, metrics });
  } catch (err) {
    console.error("GET /api/settings error:", err);
    res.status(500).json({ error: "Failed to read settings" });
  }
});

app.patch("/api/taxonomy", requireRole("admin", "editor"), async (req, res) => {
  try {
    const actor = req.user?.email || "unknown";
    const parsed = taxonomyInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    await updateStore((draft) => {
      draft.taxonomy = {
        pillars: Array.from(new Set(parsed.data.pillars.map((p) => p.trim()))),
        priorities: Array.from(new Set(parsed.data.priorities.map((p) => p.trim()))),
        domains: Array.from(new Set(parsed.data.domains.map((d) => d.trim()))),
        subDomains: Array.from(new Set(parsed.data.subDomains.map((s) => s.trim()))),
        owners: Array.from(new Set(parsed.data.owners.map((o) => o.trim()))),
        tags: Array.from(new Set(parsed.data.tags.map((t) => t.trim()))),
        themes: Array.from(new Set(parsed.data.themes.map((t) => t.trim()))),
      };
    });
    await appendAudit({
      entityType: "view",
      entityId: "taxonomy",
      action: "taxonomy_updated",
      actor,
      payload: parsed.data,
    });
    res.status(204).send();
  } catch (err) {
    console.error("PATCH /api/taxonomy error:", err);
    res.status(500).json({ error: "Failed to update taxonomy" });
  }
});

app.get("/api/settings/metrics", async (_req, res) => {
  try {
    const store = await readStore();
    res.json(store.metrics);
  } catch (err) {
    console.error("GET /api/settings/metrics error:", err);
    res.status(500).json({ error: "Failed to read metrics" });
  }
});

app.post("/api/settings/metrics", requireRole("admin", "editor"), async (req, res) => {
  try {
    const actor = req.user?.email || "unknown";
    const parsed = metricInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const now = new Date().toISOString();
    const metric: MetricDefinition = {
      id: crypto.randomUUID(),
      ...parsed.data,
      createdAt: now,
      updatedAt: now,
    };
    await updateStore((draft) => {
      draft.metrics.unshift(metric);
    });
    await appendAudit({
      entityType: "view",
      entityId: metric.id,
      action: "metric_created",
      actor,
      payload: metric as unknown as Record<string, unknown>,
    });
    res.status(201).json(metric);
  } catch (err) {
    console.error("POST /api/settings/metrics error:", err);
    res.status(500).json({ error: "Failed to create metric" });
  }
});

app.patch("/api/settings/metrics/:id", requireRole("admin", "editor"), async (req, res) => {
  try {
    const actor = req.user?.email || "unknown";
    const parsed = metricInput.partial().extend({ _updatedAt: z.string().optional() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { _updatedAt, ...data } = parsed.data;
    let updated: MetricDefinition | undefined;
    let conflict = false;
    await updateStore((draft) => {
      draft.metrics = draft.metrics.map((metric) => {
        if (metric.id !== req.params.id) return metric;
        if (_updatedAt && metric.updatedAt !== _updatedAt) {
          conflict = true;
          return metric;
        }
        updated = { ...metric, ...data, updatedAt: new Date().toISOString() };
        return updated as MetricDefinition;
      });
    });
    if (conflict) return res.status(409).json({ error: "Conflict: metric was modified. Please refresh and try again." });
    if (!updated) return res.status(404).json({ error: "Metric not found" });
    await appendAudit({
      entityType: "view",
      entityId: updated.id,
      action: "metric_updated",
      actor,
      payload: parsed.data as Record<string, unknown>,
    });
    res.json(updated);
  } catch (err) {
    console.error("PATCH /api/settings/metrics/:id error:", err);
    res.status(500).json({ error: "Failed to update metric" });
  }
});

app.delete("/api/settings/metrics/:id", requireRole("admin", "editor"), async (req, res) => {
  try {
    const actor = req.user?.email || "unknown";
    const prev = await readStore();
    const exists = prev.metrics.some((metric) => metric.id === req.params.id);
    if (!exists) return res.status(404).json({ error: "Metric not found" });
    await updateStore((draft) => {
      draft.metrics = draft.metrics.filter((metric) => metric.id !== req.params.id);
      draft.rows = draft.rows.map((row) =>
        row.metricId === req.params.id ? { ...row, metricId: undefined } : row,
      );
    });
    await appendAudit({
      entityType: "view",
      entityId: req.params.id as string,
      action: "metric_deleted",
      actor,
      payload: {},
    });
    res.status(204).send();
  } catch (err) {
    console.error("DELETE /api/settings/metrics/:id error:", err);
    res.status(500).json({ error: "Failed to delete metric" });
  }
});

app.get("/api/roadmap/rows", async (_req, res) => {
  try {
    const { rows } = await readStore();
    res.json(rows);
  } catch (err) {
    console.error("GET /api/roadmap/rows error:", err);
    res.status(500).json({ error: "Failed to read rows" });
  }
});

app.post("/api/roadmap/rows", requireRole("admin", "editor"), async (req, res) => {
  try {
    const actor = req.user?.email || "unknown";
    const payload = rowInput.safeParse(req.body);
    if (!payload.success) return res.status(400).json({ error: payload.error.flatten() });

    const now = new Date().toISOString();
    const newRow: RoadmapRow = {
      id: crypto.randomUUID(),
      ...payload.data,
      visibility: payload.data.visibility || "internal_only",
      sourceOfTruth: {
        strategicPillar: "manual",
        productPriority: "manual",
        investment: "manual",
        tactics: "manual",
        jiraLinks: "jira",
      },
      createdAt: now,
      updatedAt: now,
      updatedBy: actor,
      lastSyncedAt: now,
    };

    await updateStore((draft) => {
      draft.rows.unshift(newRow);
    });
    await appendAudit({
      entityType: "row",
      entityId: newRow.id,
      action: "created",
      actor,
      payload: newRow as unknown as Record<string, unknown>,
    });
    try {
      await insertChangelogEvents([{
        id: crypto.randomUUID(),
        entityType: "investment",
        entityId: newRow.id,
        fieldName: "investment",
        oldValue: null,
        newValue: { id: newRow.id, name: newRow.investment },
        changeType: "new_item",
        changedBy: actor,
        changedAt: new Date(),
        source: "app",
        gtmActionNeeded: false,
      }]);
    } catch (clErr) {
      console.error("Changelog capture error (non-fatal):", clErr);
    }
    res.status(201).json(newRow);
  } catch (err) {
    console.error("POST /api/roadmap/rows error:", err);
    res.status(500).json({ error: "Failed to create row" });
  }
});

app.delete("/api/roadmap/rows/:id", requireRole("admin", "editor"), async (req, res) => {
  console.log("[DELETE ROW] id:", req.params.id);
  try {
    const actor = req.user?.email || "unknown";
    const rowId = req.params.id;
    let found = false;
    let deletedRow: RoadmapRow | undefined;
    await updateStore((draft) => {
      const idx = draft.rows.findIndex((r) => r.id === rowId);
      console.log("[DELETE ROW] findIndex result:", idx, "total rows:", draft.rows.length);
      if (idx >= 0) {
        found = true;
        deletedRow = draft.rows[idx];
        draft.rows.splice(idx, 1);
      }
    });
    if (!found) return res.status(404).json({ error: "Row not found" });
    await appendAudit({
      entityType: "row",
      entityId: rowId as string,
      action: "deleted",
      actor,
      payload: {},
    });
    try {
      await insertChangelogEvents([{
        id: crypto.randomUUID(),
        entityType: "investment",
        entityId: rowId as string,
        fieldName: "investment",
        oldValue: deletedRow ? { id: deletedRow.id, name: deletedRow.investment } : null,
        newValue: null,
        changeType: "removed_item",
        changedBy: actor,
        changedAt: new Date(),
        source: "app",
        gtmActionNeeded: false,
      }]);
    } catch (clErr) {
      console.error("Changelog capture error (non-fatal):", clErr);
    }
    res.status(204).end();
  } catch (err) {
    console.error("DELETE /api/roadmap/rows/:id error:", err);
    res.status(500).json({ error: "Failed to delete row" });
  }
});

const rowPatchInput = z.object({
  strategicPillar: z.string().optional(),
  productPriority: z.string().optional(),
  investment: z.string().optional(),
  description: z.string().nullable().optional(),
  metricId: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  themes: z.array(z.string()).optional(),
  domain: z.string().optional(),
  subDomain: z.string().nullable().optional(),
  owners: z.string().optional(),
  timeline: z.object({ start: z.string(), end: z.string() }).nullable().optional(),
  visibility: z.enum(["external_approved", "internal_only"]).optional(),
  status: z.enum(["In Progress", "In Discovery", "Not Started", "Completed", "Paused"]).nullable().optional(),
  cardEmoji: z.string().nullable().optional(),
  cardColor: z.string().nullable().optional(),
  expectedBenefits: z.array(z.string()).optional(),
  tactics: z.array(z.any()).optional(),
  jiraLinks: z.array(z.any()).optional(),
  _updatedAt: z.string().optional(),
});

app.patch("/api/roadmap/rows/:id", requireRole("admin", "editor"), async (req, res) => {
  try {
    const parsed = rowPatchInput.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const actor = req.user?.email || "unknown";
    const rowId = req.params.id;
    const { _updatedAt, ...patch } = parsed.data;
    let updated: RoadmapRow | undefined;
    let oldRow: RoadmapRow | undefined;
    let conflict = false;
    await updateStore((draft) => {
      draft.rows = draft.rows.map((row) => {
        if (row.id !== rowId) return row;
        if (_updatedAt && row.updatedAt !== _updatedAt) {
          conflict = true;
          return row;
        }
        oldRow = { ...row, tactics: [...(row.tactics || [])] };
        const next = {
          ...row,
          ...patch,
          updatedAt: new Date().toISOString(),
          updatedBy: actor,
        } as RoadmapRow;
        updated = next;
        return next;
      });
    });
    if (conflict) return res.status(409).json({ error: "Conflict: row was modified by another user. Please refresh and try again." });
    if (!updated) return res.status(404).json({ error: "Row not found" });
    await appendAudit({
      entityType: "row",
      entityId: updated.id,
      action: "updated",
      actor,
      payload: req.body,
    });
    if (oldRow) {
      try {
        const recentNew = await pool.query(
          `SELECT id FROM changelog_events
           WHERE entity_id = $1 AND entity_type = 'investment' AND change_type = 'new_item'
             AND changed_at > NOW() - INTERVAL '30 seconds'
           LIMIT 1`,
          [oldRow.id],
        );
        if (recentNew.rows.length === 0) {
          const changelogInserts = buildChangelogInserts(oldRow, patch, actor);
          await insertChangelogEvents(changelogInserts);
        }
      } catch (clErr) {
        console.error("Changelog capture error (non-fatal):", clErr);
      }
    }
    res.json(updated);
  } catch (err) {
    console.error("PATCH /api/roadmap/rows/:id error:", err);
    res.status(500).json({ error: "Failed to update row" });
  }
});

app.post("/api/roadmap/rows/:id/move-jira-link", requireRole("admin", "editor"), async (req, res) => {
  try {
    const actor = req.user?.email || "unknown";
    const rowId = req.params.id;
    const { jiraLinkId, fromTacticId, toTacticId } = req.body as {
      jiraLinkId: string;
      fromTacticId?: string;
      toTacticId?: string;
    };

    if (!jiraLinkId) return res.status(400).json({ error: "jiraLinkId is required" });

    let updated: RoadmapRow | undefined;
    let error: string | undefined;

    await updateStore((draft) => {
      draft.rows = draft.rows.map((row) => {
        if (row.id !== rowId) return row;

        let link: JiraLink | undefined;

        if (fromTacticId) {
          const tactic = row.tactics.find((t) => t.id === fromTacticId);
          if (!tactic) { error = "Source tactic not found"; return row; }
          const idx = tactic.jiraLinks.findIndex((l) => l.id === jiraLinkId);
          if (idx === -1) { error = "Jira link not found in source tactic"; return row; }
          link = tactic.jiraLinks[idx];
          tactic.jiraLinks.splice(idx, 1);
        } else {
          const idx = row.jiraLinks.findIndex((l) => l.id === jiraLinkId);
          if (idx === -1) { error = "Jira link not found on investment"; return row; }
          link = row.jiraLinks[idx];
          row.jiraLinks.splice(idx, 1);
        }

        if (toTacticId) {
          const tactic = row.tactics.find((t) => t.id === toTacticId);
          if (!tactic) { error = "Target tactic not found"; return row; }
          tactic.jiraLinks.push(link);
        } else {
          row.jiraLinks.push(link);
        }

        row.updatedAt = new Date().toISOString();
        row.updatedBy = actor;
        updated = row;
        return row;
      });
    });

    if (error) return res.status(400).json({ error });
    if (!updated) return res.status(404).json({ error: "Row not found" });

    await appendAudit({
      entityType: "row",
      entityId: updated.id,
      action: "updated",
      actor,
      payload: { moveJiraLink: { jiraLinkId, fromTacticId, toTacticId } },
    });
    try {
      const movedLink = [...(updated.jiraLinks || []), ...(updated.tactics || []).flatMap((t) => t.jiraLinks || [])].find((l) => l.id === jiraLinkId);
      const linkInfo = movedLink ? { key: movedLink.key, title: movedLink.title, url: movedLink.url } : { id: jiraLinkId };
      const fromLabel = fromTacticId ? (updated.tactics.find((t) => t.id === fromTacticId)?.name || fromTacticId) : updated.investment;
      const toLabel = toTacticId ? (updated.tactics.find((t) => t.id === toTacticId)?.name || toTacticId) : updated.investment;
      await insertChangelogEvents([{
        id: crypto.randomUUID(),
        entityType: "investment",
        entityId: updated.id,
        fieldName: "jiraLink",
        oldValue: { ...linkInfo, location: fromLabel },
        newValue: { ...linkInfo, location: toLabel },
        changeType: "scope_change",
        changedBy: actor,
        changedAt: new Date(),
        source: "app",
        gtmActionNeeded: false,
      }]);
    } catch (clErr) {
      console.error("Changelog capture error (non-fatal):", clErr);
    }
    res.json(updated);
  } catch (err) {
    console.error("POST /api/roadmap/rows/:id/move-jira-link error:", err);
    res.status(500).json({ error: "Failed to move Jira link" });
  }
});

app.get("/api/views", async (_req, res) => {
  try {
    const store = await readStore();
    res.json(store.views);
  } catch (err) {
    console.error("GET /api/views error:", err);
    res.status(500).json({ error: "Failed to read views" });
  }
});

app.get("/api/audits", async (req, res) => {
  try {
    const entityType = req.query.entityType ? String(req.query.entityType) : undefined;
    const action = req.query.action ? String(req.query.action) : undefined;
    const actor = req.query.actor ? String(req.query.actor) : undefined;
    const limit = Math.min(parseInt(String(req.query.limit || "50"), 10) || 50, 200);
    const offset = parseInt(String(req.query.offset || "0"), 10) || 0;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;
    if (entityType) { conditions.push(`entity_type = $${paramIdx++}`); params.push(entityType); }
    if (action) { conditions.push(`action = $${paramIdx++}`); params.push(action); }
    if (actor) { conditions.push(`actor = $${paramIdx++}`); params.push(actor); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await pool.query(`SELECT count(*)::int as total FROM audit_events ${where}`, params);
    const total = countResult.rows[0]?.total ?? 0;

    const dataResult = await pool.query(
      `SELECT id, entity_type as "entityType", entity_id as "entityId", action, actor, payload, timestamp
       FROM audit_events ${where}
       ORDER BY timestamp DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limit, offset]
    );

    res.json({ events: dataResult.rows, total, limit, offset });
  } catch (err) {
    console.error("GET /api/audits error:", err);
    res.status(500).json({ error: "Failed to read audits" });
  }
});

interface ChangelogFilters {
  startDate?: string; endDate?: string; changeType?: string;
  entityType?: string; entityId?: string; strategicPillar?: string;
  productPriority?: string; domain?: string; owner?: string;
  tag?: string; theme?: string; status?: string; subDomain?: string;
  visibility?: string;
}

function buildChangelogQuery(filters: ChangelogFilters, includeDeleted = false) {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (!includeDeleted) { conditions.push(`ce.deleted_at IS NULL`); conditions.push(`ce.reversed_at IS NULL`); }
  if (filters.startDate) { conditions.push(`ce.changed_at >= $${paramIdx++}`); params.push(new Date(filters.startDate)); }
  if (filters.endDate) {
    const endOfDay = new Date(filters.endDate);
    endOfDay.setDate(endOfDay.getDate() + 1);
    conditions.push(`ce.changed_at < $${paramIdx++}`);
    params.push(endOfDay);
  }
  if (filters.changeType) { conditions.push(`ce.change_type = $${paramIdx++}`); params.push(filters.changeType); }
  if (filters.entityType) { conditions.push(`ce.entity_type = $${paramIdx++}`); params.push(filters.entityType); }
  if (filters.entityId) { conditions.push(`ce.entity_id = $${paramIdx++}`); params.push(filters.entityId); }

  const joinClause = `LEFT JOIN roadmap_rows rr ON (
    CASE WHEN ce.entity_type = 'investment' THEN ce.entity_id::uuid
         ELSE ce.investment_id END
  ) = rr.id`;
  if (filters.strategicPillar) { conditions.push(`rr.strategic_pillar = $${paramIdx++}`); params.push(filters.strategicPillar); }
  if (filters.productPriority) { conditions.push(`rr.product_priority = $${paramIdx++}`); params.push(filters.productPriority); }
  if (filters.domain) { conditions.push(`rr.domain = $${paramIdx++}`); params.push(filters.domain); }
  if (filters.owner) { conditions.push(`rr.owners @> ARRAY[$${paramIdx++}]`); params.push(filters.owner); }
  if (filters.tag) { conditions.push(`rr.tags @> $${paramIdx++}::jsonb`); params.push(JSON.stringify([filters.tag])); }
  if (filters.theme) { conditions.push(`rr.themes @> $${paramIdx++}::jsonb`); params.push(JSON.stringify([filters.theme])); }
  if (filters.status) {
    conditions.push(`(ce.change_type = 'status_change' AND ce.new_value::text = $${paramIdx++})`);
    params.push(JSON.stringify(filters.status));
  }
  if (filters.subDomain) { conditions.push(`rr.sub_domain = $${paramIdx++}`); params.push(filters.subDomain); }
  if (filters.visibility) {
    const visParam = paramIdx++;
    const visParam2 = paramIdx++;
    conditions.push(`(
      CASE WHEN ce.entity_type = 'tactic' AND ce.entity_id IS NOT NULL
        THEN COALESCE(
          (SELECT t->>'visibility' FROM jsonb_array_elements(rr.tactics) AS t WHERE t->>'id' = ce.entity_id),
          rr.visibility
        ) = $${visParam}
        ELSE rr.visibility = $${visParam2}
      END
    )`);
    params.push(filters.visibility, filters.visibility);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return { joinClause, where, params, paramIdx };
}

function parseChangelogFilters(query: Record<string, unknown>): ChangelogFilters {
  return {
    startDate: query.startDate ? String(query.startDate) : undefined,
    endDate: query.endDate ? String(query.endDate) : undefined,
    changeType: query.changeType ? String(query.changeType) : undefined,
    entityType: query.entityType ? String(query.entityType) : undefined,
    entityId: query.entityId ? String(query.entityId) : undefined,
    strategicPillar: query.strategicPillar ? String(query.strategicPillar) : undefined,
    productPriority: query.productPriority ? String(query.productPriority) : undefined,
    domain: query.domain ? String(query.domain) : undefined,
    owner: query.owner ? String(query.owner) : undefined,
    tag: query.tag ? String(query.tag) : undefined,
    theme: query.theme ? String(query.theme) : undefined,
    status: query.status ? String(query.status) : undefined,
    subDomain: query.subDomain ? String(query.subDomain) : undefined,
    visibility: query.visibility ? String(query.visibility) : undefined,
  };
}

async function fetchAllChangelogEvents(filters: ChangelogFilters) {
  const { joinClause, where, params, paramIdx } = buildChangelogQuery(filters);

  const countResult = await pool.query(
    `SELECT count(*)::int as total FROM changelog_events ce ${joinClause} ${where}`,
    params,
  );
  const total = countResult.rows[0]?.total ?? 0;

  const countsResult = await pool.query(
    `SELECT ce.change_type as "changeType", count(*)::int as count
     FROM changelog_events ce ${joinClause} ${where}
     GROUP BY ce.change_type`,
    params,
  );
  const countsByType: Record<string, number> = {};
  for (const row of countsResult.rows) {
    countsByType[row.changeType] = row.count;
  }

  return { total, countsByType, joinClause, where, params, paramIdx };
}

app.get("/api/changelog", async (req, res) => {
  try {
    const filters = parseChangelogFilters(req.query as Record<string, unknown>);
    const limit = Math.min(parseInt(String(req.query.limit || "50"), 10) || 50, 200);
    const offset = parseInt(String(req.query.offset || "0"), 10) || 0;

    const { total, countsByType, joinClause, where, params, paramIdx } = await fetchAllChangelogEvents(filters);

    const dataResult = await pool.query(
      `SELECT ce.id, ce.entity_type as "entityType", ce.entity_id as "entityId",
              ce.investment_id as "investmentId", ce.field_name as "fieldName",
              ce.old_value as "oldValue", ce.new_value as "newValue",
              ce.change_type as "changeType", ce.changed_by as "changedBy",
              ce.changed_at as "changedAt", ce.source,
              ce.gtm_action_needed as "gtmActionNeeded", ce.pm_note as "pmNote",
              ce.impact_level as "impactLevel",
              rr.investment as "investmentName",
              rr.product_priority as "productPriority",
              rr.domain as "domain",
              rr.strategic_pillar as "strategicPillar",
              rr.sub_domain as "subDomain"
       FROM changelog_events ce ${joinClause} ${where}
       ORDER BY ce.changed_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset],
    );

    res.json({ events: dataResult.rows, total, limit, offset, countsByType });
  } catch (err) {
    console.error("GET /api/changelog error:", err);
    res.status(500).json({ error: "Failed to read changelog" });
  }
});

app.patch("/api/changelog/:id/note", requireRole("admin", "editor"), async (req, res) => {
  try {
    const eventId = req.params.id;
    const { pmNote, gtmActionNeeded } = req.body;

    const updates: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (pmNote !== undefined) {
      updates.push(`pm_note = $${paramIdx++}`);
      params.push(pmNote);
    }
    if (gtmActionNeeded !== undefined) {
      updates.push(`gtm_action_needed = $${paramIdx++}`);
      params.push(!!gtmActionNeeded);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    params.push(eventId);
    const result = await pool.query(
      `UPDATE changelog_events SET ${updates.join(", ")} WHERE id = $${paramIdx++}
       RETURNING id, entity_type as "entityType", entity_id as "entityId",
                 investment_id as "investmentId", field_name as "fieldName",
                 old_value as "oldValue", new_value as "newValue",
                 change_type as "changeType", changed_by as "changedBy",
                 changed_at as "changedAt", source,
                 gtm_action_needed as "gtmActionNeeded", pm_note as "pmNote",
                 impact_level as "impactLevel"`,
      params,
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Changelog event not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("PATCH /api/changelog/:id/note error:", err);
    res.status(500).json({ error: "Failed to update changelog event" });
  }
});

app.post("/api/changelog/:id/ai-note", requireRole("admin", "editor"), async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({ error: "AI features are not configured" });
    }
    const eventId = req.params.id;
    const { existingNote } = req.body as { existingNote?: string };

    const result = await pool.query(
      `SELECT ce.change_type as "changeType", ce.entity_type as "entityType",
              ce.field_name as "fieldName", ce.old_value as "oldValue", ce.new_value as "newValue",
              ce.impact_level as "impactLevel", ce.gtm_action_needed as "gtmActionNeeded",
              rr.investment as "investmentName", rr.domain, rr.strategic_pillar as "strategicPillar",
              rr.owners
       FROM changelog_events ce
       LEFT JOIN roadmap_rows rr ON ce.investment_id = rr.id
       WHERE ce.id = $1`,
      [eventId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Changelog event not found" });
    }

    const evt = result.rows[0] as Record<string, unknown>;
    let changeDescription = `Change type: ${evt.changeType}\nEntity type: ${evt.entityType}`;
    if (evt.investmentName) changeDescription += `\nInvestment: ${evt.investmentName}`;
    if (evt.domain) changeDescription += `\nDomain: ${evt.domain}`;
    if (evt.strategicPillar) changeDescription += `\nStrategic Pillar: ${evt.strategicPillar}`;
    if (evt.owners && Array.isArray(evt.owners) && (evt.owners as string[]).length > 0) changeDescription += `\nOwner: ${(evt.owners as string[]).join(", ")}`;
    if (evt.fieldName) changeDescription += `\nField changed: ${evt.fieldName}`;
    if (evt.oldValue !== null && evt.oldValue !== undefined) changeDescription += `\nPrevious value: ${typeof evt.oldValue === "object" ? JSON.stringify(evt.oldValue) : evt.oldValue}`;
    if (evt.newValue !== null && evt.newValue !== undefined) changeDescription += `\nNew value: ${typeof evt.newValue === "object" ? JSON.stringify(evt.newValue) : evt.newValue}`;
    if (evt.impactLevel) changeDescription += `\nImpact level: ${evt.impactLevel}`;

    const systemPrompt = existingNote
      ? "You are a product operations analyst. Rewrite the existing PM note to be more concise and professional. Preserve the author's original intent and tone. Improve clarity and grammar without changing the meaning. Output ONLY the rewritten note text, 1-2 sentences."
      : "You are a technical writer. Summarize the change in 1-2 factual sentences. Only state what changed. Do not give advice or recommendations.";

    const userPrompt = existingNote
      ? `Rewrite this PM note for the following change:\n\nExisting note: "${existingNote}"\n\nChange details:\n${changeDescription}`
      : `Summarize this change in 1-2 factual sentences:\n\n${changeDescription}`;

    const OpenAI = (await import("openai")).default;
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.5,
      max_tokens: 150,
    });

    const note = completion.choices[0]?.message?.content?.trim() || "Unable to generate note.";
    res.json({ note });
  } catch (err) {
    console.error("POST /api/changelog/:id/ai-note error:", err);
    res.status(500).json({ error: "Failed to generate AI note" });
  }
});

app.delete("/api/changelog/:id", requireRole("admin"), async (req, res) => {
  try {
    const eventId = req.params.id;
    const result = await pool.query(
      `UPDATE changelog_events SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [eventId],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Changelog event not found" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/changelog/:id error:", err);
    res.status(500).json({ error: "Failed to delete changelog event" });
  }
});

app.patch("/api/changelog/:id/restore", requireRole("admin"), async (req, res) => {
  try {
    const eventId = req.params.id;
    const result = await pool.query(
      `UPDATE changelog_events SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL RETURNING id`,
      [eventId],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Changelog event not found in trash" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("PATCH /api/changelog/:id/restore error:", err);
    res.status(500).json({ error: "Failed to restore changelog event" });
  }
});

app.get("/api/changelog/trash", requireRole("admin"), async (req, res) => {
  try {
    const joinClause = `LEFT JOIN roadmap_rows rr ON (
      CASE WHEN ce.entity_type = 'investment' THEN ce.entity_id::uuid
           ELSE ce.investment_id END
    ) = rr.id`;
    const result = await pool.query(
      `SELECT ce.id, ce.entity_type as "entityType", ce.entity_id as "entityId",
              ce.investment_id as "investmentId", ce.field_name as "fieldName",
              ce.old_value as "oldValue", ce.new_value as "newValue",
              ce.change_type as "changeType", ce.changed_by as "changedBy",
              ce.changed_at as "changedAt", ce.source,
              ce.gtm_action_needed as "gtmActionNeeded", ce.pm_note as "pmNote",
              ce.impact_level as "impactLevel", ce.deleted_at as "deletedAt",
              rr.investment as "investmentName",
              rr.product_priority as "productPriority",
              rr.domain as "domain",
              rr.strategic_pillar as "strategicPillar",
              rr.sub_domain as "subDomain"
       FROM changelog_events ce ${joinClause}
       WHERE ce.deleted_at IS NOT NULL
       ORDER BY ce.deleted_at DESC
       LIMIT 200`,
    );
    res.json({ events: result.rows });
  } catch (err) {
    console.error("GET /api/changelog/trash error:", err);
    res.status(500).json({ error: "Failed to read changelog trash" });
  }
});

app.post("/api/changelog/:id/reverse", requireRole("admin"), async (req, res) => {
  try {
    const eventId = req.params.id;
    const actor = req.user?.email || "unknown";
    const evtResult = await pool.query(
      `SELECT id, entity_type as "entityType", entity_id as "entityId",
              investment_id as "investmentId", field_name as "fieldName",
              old_value as "oldValue", new_value as "newValue",
              change_type as "changeType"
       FROM changelog_events WHERE id = $1 AND deleted_at IS NULL AND reversed_at IS NULL`,
      [eventId],
    );
    if (evtResult.rows.length === 0) {
      return res.status(404).json({ error: "Changelog event not found or already reversed" });
    }
    const evt = evtResult.rows[0];

    const REVERTABLE_FIELDS: Record<string, string> = {
      strategicPillar: "strategic_pillar",
      productPriority: "product_priority",
      investment: "investment",
      description: "description",
      domain: "domain",
      subDomain: "sub_domain",
      owners: "owners",
      visibility: "visibility",
      tags: "tags",
      themes: "themes",
      timeline: "timeline",
      status: "status",
      confidence: "confidence",
    };

    const fieldName = evt.fieldName;
    const dbColumn = REVERTABLE_FIELDS[fieldName];

    if (dbColumn && evt.oldValue !== undefined) {
      if (evt.entityType === "investment" && evt.entityId) {
        const oldVal = evt.oldValue;
        const serialized = (typeof oldVal === "object" && oldVal !== null) ? JSON.stringify(oldVal) : oldVal;
        const castSuffix = (Array.isArray(oldVal) || (typeof oldVal === "object" && oldVal !== null)) ? "::jsonb" : "";
        await pool.query(
          `UPDATE roadmap_rows SET ${dbColumn} = $1${castSuffix}, updated_at = NOW(), updated_by = $2 WHERE id = $3`,
          [serialized ?? null, actor, evt.entityId],
        );
      } else if (evt.entityType === "tactic" && evt.investmentId && evt.entityId) {
        const { rows: rowRows } = await pool.query(
          `SELECT tactics FROM roadmap_rows WHERE id = $1`,
          [evt.investmentId],
        );
        if (rowRows.length > 0) {
          const tactics = rowRows[0].tactics || [];
          const tacticIdx = tactics.findIndex((t: Record<string, unknown>) => t.id === evt.entityId);
          if (tacticIdx >= 0 && fieldName in tactics[tacticIdx]) {
            tactics[tacticIdx][fieldName] = evt.oldValue;
            await pool.query(
              `UPDATE roadmap_rows SET tactics = $1::jsonb, updated_at = NOW(), updated_by = $2 WHERE id = $3`,
              [JSON.stringify(tactics), actor, evt.investmentId],
            );
          }
        }
      }
    }

    await pool.query(
      `UPDATE changelog_events SET reversed_at = NOW() WHERE id = $1`,
      [eventId],
    );

    res.json({ success: true });
  } catch (err) {
    console.error("POST /api/changelog/:id/reverse error:", err);
    res.status(500).json({ error: "Failed to reverse change" });
  }
});

app.patch("/api/changelog/:id/unreverse", requireRole("admin"), async (req, res) => {
  try {
    const eventId = req.params.id;
    const result = await pool.query(
      `UPDATE changelog_events SET reversed_at = NULL WHERE id = $1 AND reversed_at IS NOT NULL RETURNING id`,
      [eventId],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Changelog event not found in reversed list" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("PATCH /api/changelog/:id/unreverse error:", err);
    res.status(500).json({ error: "Failed to unreverse changelog event" });
  }
});

app.get("/api/changelog/reversed", requireRole("admin"), async (req, res) => {
  try {
    const joinClause = `LEFT JOIN roadmap_rows rr ON (
      CASE WHEN ce.entity_type = 'investment' THEN ce.entity_id::uuid
           ELSE ce.investment_id END
    ) = rr.id`;
    const result = await pool.query(
      `SELECT ce.id, ce.entity_type as "entityType", ce.entity_id as "entityId",
              ce.investment_id as "investmentId", ce.field_name as "fieldName",
              ce.old_value as "oldValue", ce.new_value as "newValue",
              ce.change_type as "changeType", ce.changed_by as "changedBy",
              ce.changed_at as "changedAt", ce.source,
              ce.gtm_action_needed as "gtmActionNeeded", ce.pm_note as "pmNote",
              ce.impact_level as "impactLevel", ce.reversed_at as "reversedAt",
              rr.investment as "investmentName",
              rr.product_priority as "productPriority",
              rr.domain as "domain",
              rr.strategic_pillar as "strategicPillar",
              rr.sub_domain as "subDomain"
       FROM changelog_events ce ${joinClause}
       WHERE ce.reversed_at IS NOT NULL AND ce.deleted_at IS NULL
       ORDER BY ce.reversed_at DESC
       LIMIT 200`,
    );
    res.json({ events: result.rows });
  } catch (err) {
    console.error("GET /api/changelog/reversed error:", err);
    res.status(500).json({ error: "Failed to read reversed changelog events" });
  }
});

app.post("/api/changelog/ai-summary", requireRole("admin", "editor"), async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(400).json({ error: "AI features are not configured" });
    }
    const filters = parseChangelogFilters(req.body.filters || {});
    const { joinClause, where, params } = buildChangelogQuery(filters);

    const eventsResult = await pool.query(
      `SELECT ce.change_type as "changeType", ce.entity_type as "entityType",
              ce.field_name as "fieldName", ce.old_value as "oldValue", ce.new_value as "newValue",
              ce.pm_note as "pmNote", ce.gtm_action_needed as "gtmActionNeeded",
              ce.changed_at as "changedAt",
              rr.investment as "investmentName", rr.domain, rr.strategic_pillar as "strategicPillar"
       FROM changelog_events ce ${joinClause} ${where}
       ORDER BY ce.changed_at DESC LIMIT 200`,
      params,
    );

    if (eventsResult.rows.length === 0) {
      return res.status(400).json({ error: "No changelog events found for the given filters" });
    }

    const OpenAI = (await import("openai")).default;
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const evtSummaries = eventsResult.rows.slice(0, 100).map((e: Record<string, unknown>) => {
      let line = `- [${e.changeType}] ${e.entityType}: ${e.investmentName || "Unknown"}`;
      if (e.fieldName) line += ` (field: ${e.fieldName})`;
      if (e.oldValue !== null && e.oldValue !== undefined) line += ` from "${typeof e.oldValue === "object" ? JSON.stringify(e.oldValue) : e.oldValue}"`;
      if (e.newValue !== null && e.newValue !== undefined) line += ` to "${typeof e.newValue === "object" ? JSON.stringify(e.newValue) : e.newValue}"`;
      if (e.pmNote) line += ` [PM Note: ${e.pmNote}]`;
      if (e.gtmActionNeeded) line += ` [GTM ACTION NEEDED]`;
      return line;
    });

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a product operations analyst. Write a concise executive summary (2-4 paragraphs) of recent roadmap changes. Focus on strategic themes, timeline shifts, new/removed items, and any items flagged for GTM action. Be specific and reference investment names. Write in professional business language suitable for executives and stakeholders.",
        },
        {
          role: "user",
          content: `Summarize these ${eventsResult.rows.length} roadmap changelog events:\n\n${evtSummaries.join("\n")}`,
        },
      ],
      temperature: 0.5,
      max_tokens: 800,
    });

    const summary = completion.choices[0]?.message?.content || "Unable to generate summary.";
    res.json({ summary });
  } catch (err) {
    console.error("POST /api/changelog/ai-summary error:", err);
    res.status(500).json({ error: "Failed to generate AI summary" });
  }
});

app.post("/api/changelog/export-pdf", async (req, res) => {
  try {
    const {
      filters: rawFilters,
      filterSummary,
      dateRange,
      includeAiSummary,
      aiSummaryText,
      generatedBy,
    } = req.body as {
      filters: Record<string, unknown>;
      filterSummary: string[];
      dateRange: string;
      includeAiSummary: boolean;
      aiSummaryText?: string;
      generatedBy: string;
    };

    const filters = parseChangelogFilters(rawFilters || {});
    const { total, countsByType, joinClause, where, params } = await fetchAllChangelogEvents(filters);

    const eventsResult = await pool.query(
      `SELECT ce.id, ce.entity_type as "entityType", ce.entity_id as "entityId",
              ce.investment_id as "investmentId", ce.field_name as "fieldName",
              ce.old_value as "oldValue", ce.new_value as "newValue",
              ce.change_type as "changeType", ce.changed_by as "changedBy",
              ce.changed_at as "changedAt", ce.source,
              ce.gtm_action_needed as "gtmActionNeeded", ce.pm_note as "pmNote",
              ce.impact_level as "impactLevel",
              rr.investment as "investmentName",
              rr.product_priority as "productPriority",
              rr.domain as "domain",
              rr.strategic_pillar as "strategicPillar"
       FROM changelog_events ce ${joinClause} ${where}
       ORDER BY ce.changed_at DESC`,
      params,
    );
    const events = eventsResult.rows;

    const changeTypeLabels: Record<string, string> = {
      status_change: "STATUS CHANGE", date_shift: "DATE SHIFT", scope_change: "SCOPE CHANGE",
      priority_change: "PRIORITY CHANGE", new_item: "NEW ITEM", removed_item: "DROPPED",
      assignment_change: "REASSIGNMENT",
    };
    const changeTypeColors: Record<string, [number, number, number]> = {
      status_change: [59, 130, 246], date_shift: [249, 115, 22], scope_change: [168, 85, 247],
      priority_change: [245, 158, 11], new_item: [16, 185, 129], removed_item: [239, 68, 68],
      assignment_change: [6, 182, 212],
    };
    const fieldLabels: Record<string, string> = {
      strategicPillar: "Strategic Pillar", productPriority: "Product Priority",
      investment: "Investment Name", description: "Description", domain: "Domain",
      subDomain: "Sub-Domain", owners: "Owners", timeline: "Timeline", status: "Status",
      owner: "Owner", name: "Name", deliveryConfidence: "Confidence", tags: "Tags", themes: "Themes",
    };

    function fmtVal(v: unknown): string {
      if (v === null || v === undefined) return "—";
      if (typeof v === "string") return v || "—";
      if (Array.isArray(v)) return v.length > 0 ? v.join(", ") : "—";
      if (typeof v === "object") {
        const o = v as Record<string, unknown>;
        if ("start" in o && "end" in o) {
          const s = new Date(String(o.start));
          const e = new Date(String(o.end));
          return `${s.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} – ${e.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
        }
        if ("name" in o) return String(o.name);
        return JSON.stringify(v);
      }
      return String(v);
    }

    const doc = new PDFDocument({ size: "LETTER", margins: { top: 50, bottom: 60, left: 50, right: 50 } });
    const buffers: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => buffers.push(chunk));
    const pdfFinished = new Promise<void>((resolve) => doc.on("end", resolve));

    const pageW = 612 - 100;
    const genDateStr = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const footerBase = `Generated by ${generatedBy || "Unknown"} · ${genDateStr} · INTERNAL — Guild Education · guild.com/roadmap`;
    let pageNum = 0;

    function drawFooter() {
      pageNum++;
      doc.fontSize(7).fillColor("#9ca3af")
        .text(`${footerBase}  ·  Page ${pageNum}`, 50, 722, { width: pageW, align: "center" });
    }

    doc.rect(0, 0, 612, 792).fill("#fffbeb");
    doc.fontSize(10).fillColor("#b45309").text("GUILD ROADMAP", 50, 50, { characterSpacing: 3 });
    doc.moveTo(50, 68).lineTo(562, 68).strokeColor("#f59e0b").lineWidth(1).stroke();
    doc.fontSize(24).fillColor("#92400e").text("CHANGELOG EXPORT", 50, 90);
    doc.fontSize(12).fillColor("#78350f").text("Roadmap Changes Summary", 50, 125);
    if (dateRange) {
      doc.fontSize(10).fillColor("#92400e").text(dateRange, 50, 143);
    }

    const totalChanges = total;
    const dateShifts = countsByType.date_shift || 0;
    const newItems = countsByType.new_item || 0;
    const dropped = countsByType.removed_item || 0;

    const statY = 175;
    const statBoxW = (pageW - 30) / 4;
    const statLabels = ["TOTAL CHANGES", "DATE SHIFTS", "NEW ITEMS", "DROPPED"];
    const statValues = [totalChanges, dateShifts, newItems, dropped];
    const statColors: [number, number, number][] = [[180, 83, 9], [249, 115, 22], [16, 185, 129], [239, 68, 68]];

    for (let i = 0; i < 4; i++) {
      const sx = 50 + i * (statBoxW + 10);
      doc.roundedRect(sx, statY, statBoxW, 60, 6).fillAndStroke("#fff7ed", "#fed7aa");
      doc.fontSize(26).fillColor(`#${statColors[i].map(c => c.toString(16).padStart(2, "0")).join("")}`)
        .text(String(statValues[i]), sx, statY + 8, { width: statBoxW, align: "center" });
      doc.fontSize(7).fillColor("#92400e")
        .text(statLabels[i], sx, statY + 40, { width: statBoxW, align: "center" });
    }

    if (filterSummary && filterSummary.length > 0) {
      doc.fontSize(8).fillColor("#b45309").text("ACTIVE FILTERS", 50, statY + 80, { characterSpacing: 2 });
      doc.fontSize(9).fillColor("#78350f").text(filterSummary.join(" · "), 50, statY + 95, { width: pageW });
    }

    drawFooter();

    if (includeAiSummary && aiSummaryText && aiSummaryText.trim()) {
      doc.addPage();
      doc.rect(0, 0, 612, 792).fill("#ffffff");
      doc.roundedRect(50, 50, pageW, 20, 4).fill("#fef3c7");
      doc.fontSize(8).fillColor("#92400e").text("◆  AI-GENERATED SUMMARY", 60, 55, { characterSpacing: 1 });
      doc.fontSize(10).fillColor("#1c1917").text(aiSummaryText, 50, 85, { width: pageW, lineGap: 4 });
      drawFooter();
    }

    type EvtRow = Record<string, unknown>;

    interface PdfEventGroup {
      events: EvtRow[];
      changeTypes: string[];
      primaryChangeType: string;
      itemName: string;
      ctx: string;
      hasGtm: boolean;
      pmNote: string | null;
      time: string;
    }

    function groupPdfEvents(evts: EvtRow[]): PdfEventGroup[] {
      const sorted = [...evts].sort((a, b) => new Date(String(a.changedAt)).getTime() - new Date(String(b.changedAt)).getTime());
      const used = new Set<number>();
      const groups: PdfEventGroup[] = [];
      const typePriority: Record<string, number> = {
        date_shift: 1, removed_item: 2, new_item: 3, status_change: 4,
        priority_change: 5, assignment_change: 6, scope_change: 7,
      };

      for (let i = 0; i < sorted.length; i++) {
        if (used.has(i)) continue;
        const evt = sorted[i];
        const group: EvtRow[] = [evt];
        used.add(i);

        for (let j = i + 1; j < sorted.length; j++) {
          if (used.has(j)) continue;
          const other = sorted[j];
          if (String(other.entityId) !== String(evt.entityId) || String(other.entityType) !== String(evt.entityType)) continue;
          const lastTime = new Date(String(group[group.length - 1].changedAt)).getTime();
          const otherTime = new Date(String(other.changedAt)).getTime();
          if (Math.abs(otherTime - lastTime) <= 5 * 60 * 1000) {
            group.push(other);
            used.add(j);
          }
        }

        const changeTypesSet = new Set(group.map((e) => String(e.changeType)));
        const changeTypes = Array.from(changeTypesSet).sort(
          (a, b) => (typePriority[a] || 99) - (typePriority[b] || 99),
        );
        const latest = group[group.length - 1];
        const noteEvt = group.find((e) => e.pmNote);

        groups.push({
          events: group,
          changeTypes,
          primaryChangeType: changeTypes[0],
          itemName: String(evt.investmentName || "Unknown"),
          ctx: [evt.strategicPillar, evt.domain].filter(Boolean).map(String).join(" · "),
          hasGtm: group.some((e) => e.gtmActionNeeded),
          pmNote: noteEvt ? String(noteEvt.pmNote) : null,
          time: new Date(String(latest.changedAt)).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }),
        });
      }

      return groups.sort((a, b) => new Date(String(b.events[b.events.length - 1].changedAt)).getTime() - new Date(String(a.events[a.events.length - 1].changedAt)).getTime());
    }

    const dayGroups = new Map<string, EvtRow[]>();
    for (const evt of events) {
      const key = new Date(String(evt.changedAt)).toISOString().split("T")[0];
      if (!dayGroups.has(key)) dayGroups.set(key, []);
      dayGroups.get(key)!.push(evt);
    }

    const todayStr = new Date().toISOString().split("T")[0];
    let pageY = 0;

    function startNewPage() {
      doc.addPage();
      doc.rect(0, 0, 612, 792).fill("#ffffff");
      pageY = 50;
    }

    function checkPageBreak(needed: number) {
      if (pageY + needed > 700) {
        drawFooter();
        startNewPage();
      }
    }

    for (const [dayKey, dayEvents] of dayGroups) {
      const dayGrouped = groupPdfEvents(dayEvents);

      if (pageY === 0) {
        startNewPage();
      } else {
        checkPageBreak(80);
      }

      const dayLabel = dayKey === todayStr ? "TODAY" : new Date(dayKey + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).toUpperCase();
      doc.fontSize(10).fillColor("#78350f").text(`${dayLabel}`, 50, pageY, { continued: false });
      const dayLabelW = doc.widthOfString(dayLabel);
      doc.roundedRect(50 + dayLabelW + 8, pageY + 1, 30, 14, 7).fill("#f59e0b");
      doc.fontSize(8).fillColor("#ffffff").text(String(dayGrouped.length), 50 + dayLabelW + 8, pageY + 3, { width: 30, align: "center" });
      doc.moveTo(50, pageY + 20).lineTo(562, pageY + 20).strokeColor("#e7e5e4").lineWidth(0.5).stroke();
      pageY += 30;

      for (const grp of dayGrouped) {
        let estimatedHeight = 8 + 20 + 14 + 12;
        if (grp.ctx) estimatedHeight += 12;
        for (const evt of grp.events) {
          const ct = String(evt.changeType || "");
          estimatedHeight += (ct !== "new_item" && ct !== "removed_item") ? 28 : 14;
        }
        if (grp.pmNote) estimatedHeight += 28;
        checkPageBreak(estimatedHeight);

        const cardStartY = pageY;
        const color = changeTypeColors[grp.primaryChangeType] || [120, 120, 120];
        const colorHex = `#${color.map(c => c.toString(16).padStart(2, "0")).join("")}`;
        doc.roundedRect(50, pageY, pageW, 4, 0).fill(colorHex);
        pageY += 8;

        let badgeX = 56;
        for (const ct of grp.changeTypes) {
          const c = changeTypeColors[ct] || [120, 120, 120];
          const cHex = `#${c.map(v => v.toString(16).padStart(2, "0")).join("")}`;
          const label = changeTypeLabels[ct] || ct.toUpperCase();
          doc.fontSize(7);
          const labelW = doc.widthOfString(label);
          doc.roundedRect(badgeX, pageY, labelW + 10, 14, 3).fill(cHex);
          doc.fontSize(7).fillColor("#ffffff").text(label, badgeX + 5, pageY + 3);
          badgeX += labelW + 14;
        }

        if (grp.hasGtm) {
          doc.roundedRect(badgeX + 4, pageY, 100, 14, 3).fill("#fef2f2");
          doc.fontSize(7).fillColor("#dc2626").text("⚑  GTM ACTION NEEDED", badgeX + 9, pageY + 3);
        }

        doc.fontSize(7).fillColor("#a8a29e").text(grp.time, 460, pageY + 3, { width: 102, align: "right" });
        pageY += 20;

        doc.fontSize(10).fillColor("#1c1917").text(grp.itemName, 56, pageY, { width: pageW - 20 });
        pageY += 14;
        if (grp.ctx) {
          doc.fontSize(7).fillColor("#a8a29e").text(grp.ctx, 56, pageY);
          pageY += 12;
        }

        for (const evt of grp.events) {
          const changeType = String(evt.changeType || "");
          const fieldName = String(evt.fieldName || "");
          const field = fieldLabels[fieldName] || fieldName;

          if (changeType === "new_item") {
            doc.fontSize(9).fillColor("#1c1917").text(`New ${evt.entityType} created`, 56, pageY, { width: pageW - 20 });
            pageY += 14;
          } else if (changeType === "removed_item") {
            doc.fontSize(9).fillColor("#1c1917").text(`${evt.entityType === "tactic" ? "Tactic" : "Investment"} removed`, 56, pageY, { width: pageW - 20 });
            pageY += 14;
          } else {
            doc.fontSize(9).fillColor("#1c1917").text(`${field} updated`, 56, pageY, { width: pageW - 20 });
            pageY += 14;
            const oldStr = fmtVal(evt.oldValue);
            const newStr = fmtVal(evt.newValue);
            if (oldStr !== "—" || newStr !== "—") {
              doc.fontSize(8).fillColor("#dc2626").text(oldStr, 56, pageY, { width: (pageW - 40) / 2, lineBreak: true, strike: true });
              doc.fontSize(8).fillColor("#16a34a").text("→  " + newStr, 56 + (pageW - 40) / 2 + 20, pageY, { width: (pageW - 40) / 2, lineBreak: true, underline: true });
              pageY += 14;
            }
          }
        }

        if (grp.pmNote) {
          doc.roundedRect(56, pageY, pageW - 20, 22, 3).fill("#f5f5f4");
          doc.fontSize(7).fillColor("#78716c").text(`PM Note: ${grp.pmNote}`, 62, pageY + 6, { width: pageW - 32 });
          pageY += 28;
        }

        const cardHeight = pageY - cardStartY;
        doc.roundedRect(50, cardStartY, pageW, cardHeight, 0).lineWidth(0.5).strokeColor("#e7e5e4").stroke();

        pageY += 12;
      }
    }

    drawFooter();
    doc.end();
    await pdfFinished;

    const pdfBuffer = Buffer.concat(buffers);
    const filename = `changelog-export-${new Date().toISOString().split("T")[0]}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error("POST /api/changelog/export-pdf error:", err);
    res.status(500).json({ error: "Failed to generate PDF" });
  }
});

app.get("/api/alerts", async (req, res) => {
  try {
    const store = await readStore();
    const now = new Date();
    const twoWeeks = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const alerts: Array<{ type: string; severity: string; title: string; description: string; investmentId: string; investmentName: string }> = [];

    for (const row of store.rows) {
      const tactics: Tactic[] = row.tactics || [];
      const timeline = row.timeline as { start?: string; end?: string } | null;

      if (timeline?.end) {
        const endDate = new Date(timeline.end);
        if (endDate <= twoWeeks && endDate >= now) {
          const incompleteTactics = tactics.filter((t) => t.status !== "completed");
          if (incompleteTactics.length > 0) {
            alerts.push({
              type: "deadline_approaching",
              severity: "warning",
              title: `${row.investment} deadline in ${Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))} days`,
              description: `${incompleteTactics.length} tactic(s) still incomplete`,
              investmentId: row.id,
              investmentName: row.investment,
            });
          }
        }
      }

      const inProgressNoEnd = tactics.filter((t) => t.status === "in_progress" && !t.timeline?.end);
      if (inProgressNoEnd.length > 0) {
        alerts.push({
          type: "missing_timeline",
          severity: "info",
          title: `${row.investment} has tactics without end dates`,
          description: `${inProgressNoEnd.length} in-progress tactic(s) have no end date`,
          investmentId: row.id,
          investmentName: row.investment,
        });
      }

      const allPaused = tactics.length > 0 && tactics.every((t) => t.status === "paused" || t.status === "not_started");
      const hasDeliveryRisk = tactics.some((t) => t.deliveryConfidence === "low");
      if (allPaused && tactics.length > 0) {
        alerts.push({
          type: "all_stalled",
          severity: "critical",
          title: `All tactics stalled: ${row.investment}`,
          description: `${tactics.length} tactic(s) are paused or not started`,
          investmentId: row.id,
          investmentName: row.investment,
        });
      } else if (hasDeliveryRisk) {
        alerts.push({
          type: "low_confidence",
          severity: "warning",
          title: `Low confidence tactics in ${row.investment}`,
          description: `${tactics.filter((t) => t.deliveryConfidence === "low").length} tactic(s) have low delivery confidence`,
          investmentId: row.id,
          investmentName: row.investment,
        });
      }
    }

    alerts.sort((a, b) => {
      const severityOrder: Record<string, number> = { critical: 0, warning: 1, info: 2 };
      return (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3);
    });

    let dismissedKeys: string[] = [];
    if (req.user?.email) {
      const [userRow] = await db.select({ dismissedAlerts: users.dismissedAlerts }).from(users).where(eq(users.email, req.user.email));
      dismissedKeys = (userRow?.dismissedAlerts as string[]) || [];
    }

    const alertsWithKey = alerts.map((a) => ({ ...a, key: `${a.investmentId}:${a.type}` }));
    const unread = alertsWithKey.filter((a) => !dismissedKeys.includes(a.key));
    const read = alertsWithKey.filter((a) => dismissedKeys.includes(a.key));

    res.json({ alerts: unread, readAlerts: read, total: alertsWithKey.length, unreadCount: unread.length });
  } catch (err) {
    console.error("GET /api/alerts error:", err);
    res.status(500).json({ error: "Failed to compute alerts" });
  }
});

app.post("/api/alerts/dismiss", requireRole("admin", "editor"), async (req, res) => {
  try {
    if (!req.user?.email) return res.status(401).json({ error: "Authentication required" });
    const { keys } = req.body as { keys: string[] };
    if (!Array.isArray(keys) || keys.length === 0) return res.status(400).json({ error: "keys array required" });

    const [userRow] = await db.select({ dismissedAlerts: users.dismissedAlerts }).from(users).where(eq(users.email, req.user.email));
    const existing = (userRow?.dismissedAlerts as string[]) || [];
    const merged = [...new Set([...existing, ...keys])];

    await db.update(users).set({ dismissedAlerts: merged } as any).where(eq(users.email, req.user.email));
    res.json({ dismissed: merged });
  } catch (err) {
    console.error("POST /api/alerts/dismiss error:", err);
    res.status(500).json({ error: "Failed to dismiss alerts" });
  }
});

app.post("/api/alerts/undismiss", requireRole("admin", "editor"), async (req, res) => {
  try {
    if (!req.user?.email) return res.status(401).json({ error: "Authentication required" });
    const { keys } = req.body as { keys?: string[] };

    if (keys && Array.isArray(keys)) {
      const [userRow] = await db.select({ dismissedAlerts: users.dismissedAlerts }).from(users).where(eq(users.email, req.user.email));
      const existing = (userRow?.dismissedAlerts as string[]) || [];
      const filtered = existing.filter((k) => !keys.includes(k));
      await db.update(users).set({ dismissedAlerts: filtered } as any).where(eq(users.email, req.user.email));
      res.json({ dismissed: filtered });
    } else {
      await db.update(users).set({ dismissedAlerts: [] } as any).where(eq(users.email, req.user.email));
      res.json({ dismissed: [] });
    }
  } catch (err) {
    console.error("POST /api/alerts/undismiss error:", err);
    res.status(500).json({ error: "Failed to undismiss alerts" });
  }
});

app.post("/api/views", requireRole("admin", "editor"), async (req, res) => {
  try {
    const body = req.body as Partial<SavedView>;
    const now = new Date().toISOString();
    const view: SavedView = {
      id: crypto.randomUUID(),
      name: body.name || "Untitled View",
      audienceTag: body.audienceTag || "custom",
      isShared: body.isShared ?? true,
      viewMode: body.viewMode || "grid",
      filters: body.filters || {},
      visibleColumns: body.visibleColumns || [
        "strategicPillar",
        "productPriority",
        "investment",
        "tactics",
        "jiraLinks",
      ],
      groupBy: body.groupBy ?? undefined,
      sortBy: body.sortBy || "updatedAt",
      createdAt: now,
      updatedAt: now,
    };
    await updateStore((draft) => {
      draft.views.unshift(view);
    });
    await appendAudit({
      entityType: "view",
      entityId: view.id,
      action: "created",
      actor: "unknown",
      payload: view as unknown as Record<string, unknown>,
    });
    res.status(201).json(view);
  } catch (err) {
    console.error("POST /api/views error:", err);
    res.status(500).json({ error: "Failed to create view" });
  }
});

const viewPatchInput = z.object({
  name: z.string().optional(),
  audienceTag: z.string().optional(),
  isShared: z.boolean().optional(),
  viewMode: z.string().optional(),
  filters: z.record(z.any()).optional(),
  visibleColumns: z.array(z.string()).optional(),
  groupBy: z.string().nullable().optional(),
  sortBy: z.string().optional(),
  _updatedAt: z.string().optional(),
});

app.patch("/api/views/:id", requireRole("admin", "editor"), async (req, res) => {
  try {
    const parsed = viewPatchInput.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid input", details: parsed.error.flatten() });
    }
    const { _updatedAt, ...patch } = parsed.data;
    let updated: SavedView | undefined;
    let conflict = false;
    await updateStore((draft) => {
      draft.views = draft.views.map((view) => {
        if (view.id !== req.params.id) return view;
        if (_updatedAt && view.updatedAt !== _updatedAt) {
          conflict = true;
          return view;
        }
        const next = { ...view, ...patch, updatedAt: new Date().toISOString() } as SavedView;
        updated = next;
        return next;
      });
    });
    if (conflict) return res.status(409).json({ error: "Conflict: view was modified by another user. Please refresh and try again." });
    if (!updated) return res.status(404).json({ error: "View not found" });
    await appendAudit({
      entityType: "view",
      entityId: updated.id,
      action: "updated",
      actor: "unknown",
      payload: patch as Record<string, unknown>,
    });
    res.json(updated);
  } catch (err) {
    console.error("PATCH /api/views/:id error:", err);
    res.status(500).json({ error: "Failed to update view" });
  }
});

app.delete("/api/views/:id", requireRole("admin", "editor"), async (req, res) => {
  try {
    const prevStore = await readStore();
    const prevCount = prevStore.views.length;
    await updateStore((draft) => {
      draft.views = draft.views.filter((view) => view.id !== req.params.id);
    });
    const afterStore = await readStore();
    if (afterStore.views.length === prevCount) {
      return res.status(404).json({ error: "View not found" });
    }
    await appendAudit({
      entityType: "view",
      entityId: req.params.id as string,
      action: "deleted",
      actor: "unknown",
      payload: {},
    });
    res.status(204).send();
  } catch (err) {
    console.error("DELETE /api/views/:id error:", err);
    res.status(500).json({ error: "Failed to delete view" });
  }
});

app.get("/api/jira/issues/search", async (req, res) => {
  const query = String(req.query.q || "");
  const items = await searchLinkableIssues(query);
  res.json(items);
});

app.get("/api/jira/issues/:key/children", async (req, res) => {
  const children = await fetchChildren(req.params.key);
  res.json(children);
});

app.get("/api/jira/issues/:key/attributes", async (req, res) => {
  const attrs = await fetchAttributes(req.params.key);
  res.json(attrs);
});

app.get("/api/jira/users", async (req, res) => {
  const query = String(req.query.q || "");
  const users = await fetchJiraUsers(query);
  res.json(users);
});

app.get("/api/ai/status", (_req, res) => {
  const available = !!process.env.OPENAI_API_KEY;
  res.json({ available, message: available ? "AI features are enabled" : "OpenAI API key is not configured. AI features are disabled." });
});

app.post("/api/ai/qna", async (req, res) => {
  try {
    const question = String(req.body?.question || "");
    const pageContext = req.body?.pageContext as { contextKey?: string; label?: string; summary?: string } | undefined;
    const store = await readStore();
    const answer = await answerRoadmapQuestion(question, store.rows, store.metrics, pageContext);
    await appendTelemetry({
      type: "ai_qna",
      actor: req.user?.email || "unknown",
      payload: { question, answerSize: answer.citations.length },
    });
    res.json(answer);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    console.error("POST /api/ai/qna error:", err);
    if (msg.includes("OPENAI_API_KEY")) {
      return res.status(503).json({ error: "AI features are not configured", aiUnavailable: true });
    }
    res.status(500).json({ error: "Failed to process AI question" });
  }
});

const suggestJiraLinksInput = z.object({
  investmentId: z.string().min(1),
});

app.post("/api/ai/suggest-jira-links", async (req, res) => {
  try {
    const parsed = suggestJiraLinksInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const store = await readStore();
    const row = store.rows.find((r) => r.id === parsed.data.investmentId);
    if (!row) return res.status(404).json({ error: "Investment row not found" });

    const availableIssues = await searchLinkableIssues(row.investment);
    const issues = availableIssues.map((issue) => ({
      key: issue.key,
      summary: issue.title,
      type: issue.issueType,
    }));

    const suggestions = await suggestJiraLinks(
      { name: row.investment, pillar: row.strategicPillar, priority: row.productPriority, domain: row.domain },
      issues,
    );

    res.json(suggestions);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    console.error("POST /api/ai/suggest-jira-links error:", err);
    if (msg.includes("OPENAI_API_KEY")) {
      return res.status(503).json({ error: "AI features are not configured", aiUnavailable: true });
    }
    res.status(500).json({ error: "Failed to suggest Jira links" });
  }
});

const autoCategorizeInput = z.object({
  items: z.array(z.object({
    name: z.string().min(1),
    description: z.string().optional(),
  })).min(1),
});

app.post("/api/ai/auto-categorize", async (req, res) => {
  try {
    const parsed = autoCategorizeInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const store = await readStore();
    const existingCategories = {
      pillars: store.taxonomy.pillars,
      priorities: store.taxonomy.priorities,
      domains: store.taxonomy.domains,
    };

    const results = await autoCategorize(parsed.data.items, existingCategories);
    res.json(results);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    console.error("POST /api/ai/auto-categorize error:", err);
    if (msg.includes("OPENAI_API_KEY")) {
      return res.status(503).json({ error: "AI features are not configured", aiUnavailable: true });
    }
    res.status(500).json({ error: "Failed to auto-categorize items" });
  }
});

const detectDuplicatesInput = z.object({
  name: z.string().min(1),
  pillar: z.string().optional(),
  priority: z.string().optional(),
});

app.post("/api/ai/detect-duplicates", async (req, res) => {
  try {
    const parsed = detectDuplicatesInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const store = await readStore();
    const existingItems = store.rows.map((r) => ({
      id: r.id,
      name: r.investment,
      pillar: r.strategicPillar,
      priority: r.productPriority,
    }));

    const matches = await detectDuplicates(parsed.data, existingItems);
    res.json(matches);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    console.error("POST /api/ai/detect-duplicates error:", err);
    if (msg.includes("OPENAI_API_KEY")) {
      return res.status(503).json({ error: "AI features are not configured", aiUnavailable: true });
    }
    res.status(500).json({ error: "Failed to detect duplicates" });
  }
});

const executiveSummaryInput = z.object({
  scopeType: z.enum(["pillar", "priority"]),
  scopeName: z.string().min(1),
  tone: z.enum(["concise", "detailed"]).optional(),
  audience: z.enum(["internal", "board"]).optional(),
});

app.post("/api/ai/executive-summary", async (req, res) => {
  try {
    const parsed = executiveSummaryInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const store = await readStore();
    const scopeField = parsed.data.scopeType === "pillar" ? "strategicPillar" : "productPriority";
    const matchingRows = store.rows.filter((r) => r[scopeField] === parsed.data.scopeName);

    if (matchingRows.length === 0) {
      return res.status(404).json({ error: `No investments found for ${parsed.data.scopeType} "${parsed.data.scopeName}"` });
    }

    const context = {
      rows: matchingRows.map((r) => ({
        id: r.id,
        investment: r.investment,
        pillar: r.strategicPillar,
        priority: r.productPriority,
        domain: r.domain,
        owners: r.owners,
        tactics: r.tactics.map((t) => ({
          name: t.name,
          status: t.status,
          jiraLinks: t.jiraLinks.map((l) => ({ key: l.key, title: l.title, jiraAttributes: l.jiraAttributes })),
        })),
        jiraLinks: r.jiraLinks.map((l) => ({ key: l.key, title: l.title, jiraAttributes: l.jiraAttributes })),
        timeline: r.timeline,
      })),
      metrics: store.metrics.map((m) => ({
        name: m.name,
        description: m.description,
        unit: m.unit,
        targetValue: m.targetValue,
        direction: m.direction,
      })),
    };

    const result = await generateExecutiveSummary(
      { type: parsed.data.scopeType, name: parsed.data.scopeName },
      context,
      { tone: parsed.data.tone, audience: parsed.data.audience },
    );

    await appendTelemetry({
      type: "ai_executive_summary",
      actor: req.user?.email || "unknown",
      payload: { scopeType: parsed.data.scopeType, scopeName: parsed.data.scopeName, tone: parsed.data.tone, audience: parsed.data.audience },
    });

    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    console.error("POST /api/ai/executive-summary error:", err);
    if (msg.includes("OPENAI_API_KEY")) {
      return res.status(503).json({ error: "AI features are not configured", aiUnavailable: true });
    }
    res.status(500).json({ error: "Failed to generate executive summary" });
  }
});

app.post("/api/ai/investment-writeup", async (req, res) => {
  try {
    const investmentId = req.body?.investmentId;
    const tone = req.body?.tone;
    if (!investmentId || typeof investmentId !== "string") {
      return res.status(400).json({ error: "investmentId is required" });
    }

    const store = await readStore();
    const row = store.rows.find((r) => r.id === investmentId);
    if (!row) return res.status(404).json({ error: "Investment not found" });

    const { documentLinks, documents, documentChunks } = await import("./lib/schema.js");
    const { db } = await import("./lib/db.js");
    const { eq, sql: dsql } = await import("drizzle-orm");

    let relatedDocuments: Array<{ filename: string; documentType: string; timePeriod?: string; excerpts: string[] }> = [];

    try {
      const links = await db.select().from(documentLinks).where(eq(documentLinks.rowId, investmentId));

      if (links.length > 0) {
        const docIds = [...new Set(links.map((l) => l.documentId))];
        const docs = await db.select().from(documents).where(dsql`${documents.id} IN (${dsql.join(docIds.map((id) => dsql`${id}::uuid`), dsql`, `)})`);
        const chunks = await db.select().from(documentChunks).where(dsql`${documentChunks.documentId} IN (${dsql.join(docIds.map((id) => dsql`${id}::uuid`), dsql`, `)})`);

        relatedDocuments = docs
          .filter((d) => d.status === "ready")
          .map((d) => {
            const docChunks = chunks
              .filter((c) => c.documentId === d.id)
              .sort((a, b) => a.sequence - b.sequence)
              .slice(0, 5);
            return {
              filename: d.filename,
              documentType: d.documentType,
              timePeriod: d.timePeriod || undefined,
              excerpts: docChunks.map((c) => c.content.slice(0, 500)),
            };
          });
      }
    } catch (docErr) {
      console.warn("Failed to fetch related documents for writeup, continuing without:", docErr);
    }

    const investment = {
      name: row.investment,
      pillar: row.strategicPillar,
      priority: row.productPriority,
      domain: row.domain,
      owners: row.owners,
      tactics: (row.tactics || []).map((t) => ({
        name: t.name,
        status: t.status,
        jiraLinks: (t.jiraLinks || []).map((l) => ({ key: l.key, title: l.title, jiraAttributes: l.jiraAttributes })),
      })),
      jiraLinks: (row.jiraLinks || []).map((l) => ({ key: l.key, title: l.title, jiraAttributes: l.jiraAttributes })),
      timeline: row.timeline,
      relatedDocuments,
    };

    const result = await generateInvestmentWriteup(investment, { tone });

    await appendTelemetry({
      type: "ai_investment_writeup",
      actor: req.user?.email || "unknown",
      payload: { investmentId, investment: row.investment, tone, documentCount: relatedDocuments.length },
    });

    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    console.error("POST /api/ai/investment-writeup error:", err);
    if (msg.includes("OPENAI_API_KEY")) {
      return res.status(503).json({ error: "AI features are not configured", aiUnavailable: true });
    }
    res.status(500).json({ error: "Failed to generate investment write-up" });
  }
});

const quarterlyReportInput = z.object({
  quarter: z.string().optional(),
  audience: z.enum(["internal", "board"]).optional(),
  pillarFilter: z.string().optional(),
});

app.post("/api/ai/quarterly-report", async (req, res) => {
  try {
    const parsed = quarterlyReportInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const store = await readStore();
    let rows = store.rows;
    if (parsed.data.pillarFilter) {
      rows = rows.filter((r) => r.strategicPillar === parsed.data.pillarFilter);
    }

    if (rows.length === 0) {
      return res.status(404).json({ error: "No investments found for the selected scope" });
    }

    const context = {
      rows: rows.map((r) => ({
        id: r.id,
        investment: r.investment,
        pillar: r.strategicPillar,
        priority: r.productPriority,
        domain: r.domain,
        owners: r.owners,
        tactics: r.tactics.map((t) => ({
          name: t.name,
          status: t.status,
          jiraLinks: t.jiraLinks.map((l) => ({ key: l.key, title: l.title, jiraAttributes: l.jiraAttributes })),
        })),
        jiraLinks: r.jiraLinks.map((l) => ({ key: l.key, title: l.title, jiraAttributes: l.jiraAttributes })),
        timeline: r.timeline,
      })),
      metrics: store.metrics.map((m) => ({
        name: m.name,
        description: m.description,
        unit: m.unit,
        targetValue: m.targetValue,
        direction: m.direction,
      })),
    };

    const result = await generateQuarterlyReport(context, {
      quarter: parsed.data.quarter,
      audience: parsed.data.audience,
    });

    await appendTelemetry({
      type: "ai_quarterly_report",
      actor: req.user?.email || "unknown",
      payload: { quarter: parsed.data.quarter, audience: parsed.data.audience, pillarFilter: parsed.data.pillarFilter, rowCount: rows.length },
    });

    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    console.error("POST /api/ai/quarterly-report error:", err);
    if (msg.includes("OPENAI_API_KEY")) {
      return res.status(503).json({ error: "AI features are not configured", aiUnavailable: true });
    }
    res.status(500).json({ error: "Failed to generate quarterly report" });
  }
});

app.get("/api/ai/reports", requireAuth, async (req, res) => {
  try {
    const reportType = typeof req.query.type === "string" ? req.query.type : undefined;
    const userEmail = req.user?.email || "unknown";
    const reports = await listAiReports(reportType, userEmail);
    res.json(reports);
  } catch (err) {
    console.error("GET /api/ai/reports error:", err);
    res.status(500).json({ error: "Failed to fetch reports" });
  }
});

app.post("/api/ai/tactic-description", async (req, res) => {
  try {
    const { tacticName, jiraLinks } = req.body;
    if (!tacticName || !Array.isArray(jiraLinks) || jiraLinks.length === 0) {
      return res.status(400).json({ error: "tacticName and non-empty jiraLinks array required" });
    }
    const result = await generateTacticDescription(tacticName, jiraLinks);
    res.json(result);
  } catch (err) {
    console.error("POST /api/ai/tactic-description error:", err);
    res.status(500).json({ error: "Failed to generate tactic description" });
  }
});

app.post("/api/ai/investment-description", async (req, res) => {
  try {
    const { investmentName, tactics, jiraLinks } = req.body;
    if (!investmentName) {
      return res.status(400).json({ error: "investmentName is required" });
    }
    const result = await generateInvestmentDescription(
      investmentName,
      tactics || [],
      jiraLinks || [],
    );
    res.json(result);
  } catch (err) {
    console.error("POST /api/ai/investment-description error:", err);
    res.status(500).json({ error: "Failed to generate investment description" });
  }
});

app.post("/api/ai/reports", requireRole("admin", "editor"), async (req, res) => {
  try {
    const { reportType, title, parameters, content } = req.body;
    if (!reportType || !title) {
      return res.status(400).json({ error: "reportType and title are required" });
    }
    const report = await createAiReport({
      reportType,
      title,
      parameters: parameters || {},
      content: content || {},
      createdBy: req.user?.email || "unknown",
    });
    res.status(201).json(report);
  } catch (err) {
    console.error("POST /api/ai/reports error:", err);
    res.status(500).json({ error: "Failed to save report" });
  }
});

app.delete("/api/ai/reports/:id", requireRole("admin", "editor"), async (req, res) => {
  try {
    const deleted = await deleteAiReport(req.params.id as string);
    if (!deleted) return res.status(404).json({ error: "Report not found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/ai/reports/:id error:", err);
    res.status(500).json({ error: "Failed to delete report" });
  }
});

app.post("/api/import/parse-headers", requireRole("admin", "editor"), upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "file is required" });
    const result = parseHeaders(file.originalname, file.buffer);
    res.json(result);
  } catch (err) {
    console.error("POST /api/import/parse-headers error:", err);
    res.status(500).json({ error: "Failed to parse headers" });
  }
});

async function expandTaxonomyFromRows(rows: Array<{ strategicPillar?: string; productPriority?: string; domain?: string; subDomain?: string; owners?: string }>) {
  const newPillars = new Set<string>();
  const newPriorities = new Set<string>();
  const newDomains = new Set<string>();
  const newSubDomains = new Set<string>();
  const newOwners = new Set<string>();

  for (const row of rows) {
    if (row.strategicPillar && row.strategicPillar !== "Uncategorized") newPillars.add(row.strategicPillar.trim());
    if (row.productPriority && row.productPriority !== "Imported Item") newPriorities.add(row.productPriority.trim());
    if (row.domain && row.domain !== "Unknown") newDomains.add(row.domain.trim());
    if (row.subDomain) newSubDomains.add(row.subDomain.trim());
    if (row.owners && row.owners !== "Unassigned") newOwners.add(row.owners.trim());
  }

  if (newPillars.size === 0 && newPriorities.size === 0 && newDomains.size === 0 && newSubDomains.size === 0 && newOwners.size === 0) return;

  await updateStore((draft) => {
    const tax = draft.taxonomy;
    for (const v of newPillars) { if (!tax.pillars.includes(v)) tax.pillars.push(v); }
    for (const v of newPriorities) { if (!tax.priorities.includes(v)) tax.priorities.push(v); }
    for (const v of newDomains) { if (!tax.domains.includes(v)) tax.domains.push(v); }
    for (const v of newSubDomains) { if (!tax.subDomains.includes(v)) tax.subDomains.push(v); }
    for (const v of newOwners) { if (!tax.owners.includes(v)) tax.owners.push(v); }
  });
}

app.post("/api/import/jobs", requireRole("admin", "editor"), upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "file is required" });
    const actor = req.user?.email || "unknown";

    let headerOverrides: Record<number, string> | undefined;
    if (req.body?.headerOverrides) {
      try {
        headerOverrides = typeof req.body.headerOverrides === "string"
          ? JSON.parse(req.body.headerOverrides)
          : req.body.headerOverrides;
      } catch { /* ignore parse errors */ }
    }

    const job = parseToDrafts(file.originalname, file.buffer, actor, headerOverrides);

    const store = await readStore();
    job.draftChanges = detectMatchesForDrafts(job.draftChanges, store.rows);

    await updateStore((draft) => {
      draft.imports.unshift(job);
    });
    await appendAudit({
      entityType: "import",
      entityId: job.id,
      action: "created",
      actor,
      payload: { fileName: file.originalname },
    });
    res.status(201).json(job);
  } catch (err) {
    console.error("POST /api/import/jobs error:", err);
    res.status(500).json({ error: "Failed to create import job" });
  }
});

app.post("/api/import/paste-headers", requireRole("admin", "editor"), express.json({ limit: "2mb" }), async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "text is required" });
    }
    const result = parsePastedHeaders(text);
    if (!result) {
      return res.status(422).json({ error: "Could not detect headers in pasted data" });
    }
    res.json(result);
  } catch (err) {
    console.error("POST /api/import/paste-headers error:", err);
    res.status(500).json({ error: "Failed to parse pasted headers" });
  }
});

app.post("/api/import/paste", requireRole("admin", "editor"), express.json({ limit: "2mb" }), async (req, res) => {
  try {
    req.setTimeout(300000);
    const { text, useAi, headerOverrides } = req.body;
    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "text is required" });
    }

    const actor = req.user?.email || "unknown";
    const overrides: Record<number, string> | undefined = headerOverrides && typeof headerOverrides === "object" && Object.keys(headerOverrides).length > 0
      ? headerOverrides : undefined;

    let job: ImportJob | null = null;

    job = parsePastedTextDirect(text, actor, overrides);

    if (!job && useAi) {
      try {
        const aiRows = await aiParsePastedText(text);
        if (aiRows.length > 0) {
          job = parseToDraftsFromAiRows(aiRows as Record<string, string | undefined>[], actor);
        }
      } catch (aiErr) {
        console.error("AI paste parsing failed:", aiErr);
      }
    }

    if (!job || job.draftChanges.length === 0) {
      return res.status(422).json({ error: "Could not parse any investments or tactics from the pasted data. Try pasting tab-separated data with headers, or enable AI parsing." });
    }

    const store = await readStore();
    job.draftChanges = detectMatchesForDrafts(job.draftChanges, store.rows);

    await updateStore((draft) => {
      draft.imports.unshift(job!);
    });
    await appendAudit({
      entityType: "import",
      entityId: job.id,
      action: "created",
      actor,
      payload: { fileName: job.fileName, source: "paste" },
    });
    res.status(201).json(job);
  } catch (err) {
    console.error("POST /api/import/paste error:", err);
    res.status(500).json({ error: "Failed to parse pasted data" });
  }
});

app.get("/api/import/jobs", async (_req, res) => {
  try {
    const store = await readStore();
    const jobs = store.imports
      .map((j) => ({
        id: j.id,
        fileName: j.fileName,
        status: j.status,
        createdAt: j.createdAt,
        createdBy: j.createdBy,
        totalChanges: j.draftChanges.length,
        accepted: j.draftChanges.filter((c) => c.status === "accepted").length,
        rejected: j.draftChanges.filter((c) => c.status === "rejected").length,
        pending: j.draftChanges.filter((c) => c.status === "pending").length,
        totalTactics: j.draftChanges.reduce((s, c) => s + (c.proposed.tactics?.length || 0), 0),
      }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json(jobs);
  } catch (err) {
    console.error("GET /api/import/jobs error:", err);
    res.status(500).json({ error: "Failed to read import jobs" });
  }
});

app.get("/api/import/jobs/:id", async (req, res) => {
  try {
    const store = await readStore();
    const job = store.imports.find((i) => i.id === req.params.id);
    if (!job) return res.status(404).json({ error: "Import job not found" });
    res.json(job);
  } catch (err) {
    console.error("GET /api/import/jobs/:id error:", err);
    res.status(500).json({ error: "Failed to read import job" });
  }
});

app.delete("/api/import/jobs/:id", requireRole("admin", "editor"), async (req, res) => {
  try {
    const store = await readStore();
    const existing = store.imports.find((i) => i.id === req.params.id);
    if (!existing) return res.status(404).json({ error: "Import job not found" });
    await updateStore((draft) => {
      draft.imports = draft.imports.filter((i) => i.id !== req.params.id);
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/import/jobs/:id error:", err);
    res.status(500).json({ error: "Failed to delete import job" });
  }
});

app.get("/api/import/jobs/:id/draft", async (req, res) => {
  try {
    const store = await readStore();
    const job = store.imports.find((i) => i.id === req.params.id);
    if (!job) return res.status(404).json({ error: "Import job not found" });
    res.json(job.draftChanges);
  } catch (err) {
    console.error("GET /api/import/jobs/:id/draft error:", err);
    res.status(500).json({ error: "Failed to read import draft" });
  }
});

app.patch("/api/import/jobs/:id/draft/:changeId", requireRole("admin", "editor"), async (req, res) => {
  try {
    const status = z.enum(["accepted", "rejected", "pending"]).parse(req.body?.status);
    const rawTacticActions = req.body?.tacticActions as Record<string, string> | undefined;
    const tacticActions = rawTacticActions
      ? Object.fromEntries(
          Object.entries(rawTacticActions).filter(([, v]) => ["add", "move", "skip"].includes(v))
        )
      : undefined;
    const rawFieldActions = req.body?.fieldActions as Record<string, string> | undefined;
    const fieldActions = rawFieldActions
      ? Object.fromEntries(
          Object.entries(rawFieldActions).filter(([, v]) => ["accept", "ignore"].includes(v))
        )
      : undefined;
    let found = false;
    await updateStore((draft) => {
      draft.imports = draft.imports.map((job) => {
        if (job.id !== req.params.id) return job;
        return {
          ...job,
          draftChanges: job.draftChanges.map((change) => {
            if (change.id !== req.params.changeId) return change;
            found = true;
            const updated: any = { ...change, status, proposed: { ...change.proposed, ...req.body?.proposed } };
            if (tacticActions) {
              updated.tacticActions = { ...(change.tacticActions || {}), ...tacticActions };
            }
            if (fieldActions) {
              updated.fieldActions = { ...(change.fieldActions || {}), ...fieldActions };
            }
            if (req.body?.action === "create" && change.action === "update") {
              updated.action = "create";
              updated.existingRowId = undefined;
              updated.matchDetails = {
                ...(change.matchDetails || {}),
                investmentMatch: undefined,
              };
              updated.tacticActions = {};
              const allTacticNames = (change.proposed.tactics || []).map((t: any) => t.name);
              updated.matchDetails.newTactics = allTacticNames;
              updated.matchDetails.tacticMatches = [];
            }
            return updated;
          }),
        };
      });
    });
    if (!found) return res.status(404).json({ error: "Draft change not found" });
    res.status(204).send();
  } catch (err) {
    console.error("PATCH /api/import/jobs/:id/draft/:changeId error:", err);
    res.status(500).json({ error: "Failed to update draft change" });
  }
});

app.patch("/api/import/jobs/:id/draft/:changeId/field", requireRole("admin", "editor"), async (req, res) => {
  try {
    const allowedFields = ["strategicPillar", "productPriority", "domain", "owners"];
    const { field, value } = req.body || {};
    if (!field || typeof field !== "string" || !allowedFields.includes(field)) {
      return res.status(400).json({ error: `Invalid field. Must be one of: ${allowedFields.join(", ")}` });
    }
    if (typeof value !== "string") {
      return res.status(400).json({ error: "Value must be a string" });
    }
    let found = false;
    await updateStore((draft) => {
      draft.imports = draft.imports.map((job) => {
        if (job.id !== req.params.id) return job;
        return {
          ...job,
          draftChanges: job.draftChanges.map((change) => {
            if (change.id !== req.params.changeId) return change;
            found = true;
            return {
              ...change,
              proposed: { ...change.proposed, [field]: value },
            };
          }),
        };
      });
    });
    if (!found) return res.status(404).json({ error: "Draft change not found" });
    res.status(204).send();
  } catch (err) {
    console.error("PATCH /api/import/jobs/:id/draft/:changeId/field error:", err);
    res.status(500).json({ error: "Failed to update draft field" });
  }
});

app.patch("/api/import/jobs/:id/draft-bulk-status", requireRole("admin", "editor"), async (req, res) => {
  try {
    const status = z.enum(["accepted", "rejected", "pending"]).parse(req.body?.status);
    let updatedCount = 0;
    await updateStore((draft) => {
      draft.imports = draft.imports.map((job) => {
        if (job.id !== req.params.id) return job;
        return {
          ...job,
          draftChanges: job.draftChanges.map((change) => {
            if (change.status !== status) {
              updatedCount++;
              return { ...change, status };
            }
            return change;
          }),
        };
      });
    });
    res.json({ updatedCount });
  } catch (err) {
    console.error("PATCH /api/import/jobs/:id/draft-bulk-status error:", err);
    res.status(500).json({ error: "Failed to bulk update draft status" });
  }
});

app.post("/api/import/jobs/:id/commit", requireRole("admin", "editor"), async (req, res) => {
  try {
    const actor = req.user?.email || "unknown";
    let committed = 0;
    let updated = 0;
    let committedJob: ImportJob | undefined;

    await updateStore((draft) => {
      draft.imports = draft.imports.map((job) => {
        if (job.id !== req.params.id) return job;
        committedJob = job;
        const accepted = job.draftChanges.filter((c) => c.status === "accepted");

        const metricMap = new Map<string, string>();
        for (const change of accepted) {
          const li = change.leadingIndicators?.trim();
          if (!li || metricMap.has(li.toLowerCase())) continue;

          const existing = draft.metrics.find(
            (m) => m.name.toLowerCase().trim() === li.toLowerCase()
          );
          if (existing) {
            metricMap.set(li.toLowerCase(), existing.id);
          } else {
            const newMetricId = crypto.randomUUID();
            const metricNow = new Date().toISOString();
            draft.metrics.push({
              id: newMetricId,
              name: li,
              description: "",
              unit: "%",
              direction: "increase",
              active: true,
              createdAt: metricNow,
              updatedAt: metricNow,
            });
            metricMap.set(li.toLowerCase(), newMetricId);
          }
        }

        let createdRowIds: string[] = [];
        const changeJournal: { rowId: string; field: string; previousValue: unknown }[] = [];
        accepted.forEach((change) => {
          const now = new Date().toISOString();
          const metricId = change.leadingIndicators
            ? metricMap.get(change.leadingIndicators.trim().toLowerCase())
            : undefined;

          const tacticActions = change.tacticActions || {};
          const tacticMatches = change.matchDetails?.tacticMatches || [];

          const resolveTactics = (proposedTactics: Tactic[], newTacticNames: string[]): Tactic[] => {
            const resolved: Tactic[] = [];
            for (const pt of proposedTactics) {
              const action = tacticActions[pt.name];
              const isNew = newTacticNames.some((n) => n === pt.name);

              if (isNew && action !== "skip") {
                resolved.push(pt);
              } else if (!isNew) {
                if (action === "add" || action === "move") {
                  resolved.push(pt);
                }
              }
            }
            return resolved;
          };

          const handleMovedTactics = () => {
            for (const [tacticName, action] of Object.entries(tacticActions)) {
              if (action !== "move") continue;
              const match = tacticMatches.find((m) => m.draftTacticName === tacticName);
              if (!match) continue;
              const sourceRowIdx = draft.rows.findIndex((r) => r.id === match.existingRowId);
              if (sourceRowIdx === -1) continue;
              const sourceRow = draft.rows[sourceRowIdx];
              if (match.existingTacticId) {
                sourceRow.tactics = sourceRow.tactics.filter((t) => (t as any).id !== match.existingTacticId);
              } else {
                const idx = sourceRow.tactics.findIndex((t) => t.name === match.existingTacticName);
                if (idx !== -1) sourceRow.tactics.splice(idx, 1);
              }
              sourceRow.updatedAt = now;
              sourceRow.updatedBy = actor;
            }
          };

          if (change.action === "create") {
            const proposedTactics = (change.proposed.tactics || []) as Tactic[];
            const hasMatchDetails = !!change.matchDetails;
            const newTacticNames = change.matchDetails?.newTactics || [];
            const filteredTactics = hasMatchDetails
              ? resolveTactics(proposedTactics, newTacticNames)
              : proposedTactics;

            const newRowId = crypto.randomUUID();
            createdRowIds.push(newRowId);
            draft.rows.unshift({
              id: newRowId,
              strategicPillar: change.proposed.strategicPillar || "Uncategorized",
              productPriority: change.proposed.productPriority || "Imported Item",
              investment: change.proposed.investment || "Imported Investment",
              description: change.proposed.description,
              tags: change.proposed.tags,
              themes: change.proposed.themes,
              tactics: filteredTactics,
              jiraLinks: (change.proposed.jiraLinks || []) as JiraLink[],
              domain: change.proposed.domain || "Unknown",
              subDomain: change.proposed.subDomain,
              owners: change.proposed.owners || "Unassigned",
              timeline: change.proposed.timeline,
              metricId,
              visibility: (change.proposed as Record<string, unknown>).visibility as RoadmapRow["visibility"] || "internal_only",
              sourceOfTruth: change.proposed.sourceOfTruth || {
                strategicPillar: "manual",
                productPriority: "manual",
                investment: "manual",
                tactics: "manual",
                jiraLinks: "jira",
              },
              lastSyncedAt: now,
              createdAt: now,
              updatedAt: now,
              updatedBy: actor,
            });
            handleMovedTactics();
            committed += 1;
          } else if (change.action === "update" && change.existingRowId) {
            const existingRowIdx = draft.rows.findIndex((r) => r.id === change.existingRowId);
            if (existingRowIdx === -1) return;
            const existingRow = draft.rows[existingRowIdx];

            const fa = change.fieldActions || {};
            const shouldApply = (field: string): boolean => {
              if (fa[field] === "ignore") return false;
              return true;
            };

            const snapshot = (field: string, value: unknown) => {
              changeJournal.push({ rowId: existingRow.id, field, previousValue: JSON.parse(JSON.stringify(value ?? null)) });
            };

            if (shouldApply("description") && change.proposed.description !== undefined) {
              snapshot("description", existingRow.description);
              existingRow.description = change.proposed.description;
            }
            if (shouldApply("tags") && change.proposed.tags !== undefined) {
              snapshot("tags", existingRow.tags);
              existingRow.tags = change.proposed.tags;
            }
            if (shouldApply("themes") && change.proposed.themes !== undefined) {
              snapshot("themes", existingRow.themes);
              existingRow.themes = change.proposed.themes;
            }
            if (shouldApply("timeline") && change.proposed.timeline !== undefined) {
              snapshot("timeline", existingRow.timeline);
              existingRow.timeline = change.proposed.timeline;
            }
            if (shouldApply("domain") && change.proposed.domain !== undefined) {
              snapshot("domain", existingRow.domain);
              existingRow.domain = change.proposed.domain;
            }
            if (shouldApply("subDomain") && change.proposed.subDomain !== undefined) {
              snapshot("subDomain", existingRow.subDomain);
              existingRow.subDomain = change.proposed.subDomain;
            }
            if (shouldApply("owners") && change.proposed.owners !== undefined) {
              snapshot("owners", existingRow.owners);
              existingRow.owners = change.proposed.owners;
            }
            if (shouldApply("strategicPillar") && change.proposed.strategicPillar !== undefined) {
              snapshot("strategicPillar", existingRow.strategicPillar);
              existingRow.strategicPillar = change.proposed.strategicPillar;
            }
            if (shouldApply("productPriority") && change.proposed.productPriority !== undefined) {
              snapshot("productPriority", existingRow.productPriority);
              existingRow.productPriority = change.proposed.productPriority;
            }
            if (shouldApply("metricId") && metricId) {
              snapshot("metricId", existingRow.metricId);
              existingRow.metricId = metricId;
            } else if (!existingRow.metricId && metricId) {
              snapshot("metricId", existingRow.metricId);
              existingRow.metricId = metricId;
            }

            snapshot("tactics", JSON.parse(JSON.stringify(existingRow.tactics)));
            const newTacticNames = change.matchDetails?.newTactics || [];
            const proposedTactics = (change.proposed.tactics || []) as Tactic[];
            const tacticsToAdd = resolveTactics(proposedTactics, newTacticNames);
            for (const pt of tacticsToAdd) {
              existingRow.tactics.push(pt);
            }

            handleMovedTactics();

            snapshot("jiraLinks", JSON.parse(JSON.stringify(existingRow.jiraLinks)));
            const proposedJiraLinks = (change.proposed.jiraLinks || []) as JiraLink[];
            for (const jl of proposedJiraLinks) {
              const alreadyLinked = existingRow.jiraLinks.some((ej) => ej.key === jl.key);
              if (!alreadyLinked) {
                existingRow.jiraLinks.push(jl);
              }
            }

            snapshot("updatedAt", existingRow.updatedAt);
            snapshot("updatedBy", existingRow.updatedBy);
            existingRow.updatedAt = now;
            existingRow.updatedBy = actor;
            draft.rows[existingRowIdx] = existingRow;
            updated += 1;
          }
        });
        return { ...job, status: "committed", committedRowIds: createdRowIds, changeJournal };
      });
    });

    if (!committedJob) return res.status(404).json({ error: "Import job not found" });

    const acceptedChanges = committedJob.draftChanges.filter((c) => c.status === "accepted");
    await expandTaxonomyFromRows(acceptedChanges.map((c) => c.proposed));

    await appendAudit({
      entityType: "import",
      entityId: req.params.id as string,
      action: "committed",
      actor,
      payload: { committedCount: committed, updatedCount: updated },
    });
    res.json({ committedCount: committed, updatedCount: updated });
    syncAndGeneratePriorities(actor);
  } catch (err) {
    console.error("POST /api/import/jobs/:id/commit error:", err);
    res.status(500).json({ error: "Failed to commit import" });
  }
});

app.post("/api/import/jobs/:id/undo", requireRole("admin", "editor"), async (req, res) => {
  try {
    const actor = req.user?.email || "unknown";
    let removedCount = 0;
    let found = false;

    let restoredFieldCount = 0;

    await updateStore((draft) => {
      const job = draft.imports.find((j) => j.id === req.params.id);
      if (!job) return;
      if (job.status !== "committed") return;
      found = true;

      const rowIdsToRemove = new Set(job.committedRowIds || []);
      if (rowIdsToRemove.size > 0) {
        const beforeCount = draft.rows.length;
        draft.rows = draft.rows.filter((r) => !rowIdsToRemove.has(r.id));
        removedCount = beforeCount - draft.rows.length;
      }

      const journal = job.changeJournal || [];
      if (journal.length > 0) {
        const rowMap = new Map(draft.rows.map((r) => [r.id, r]));
        for (const entry of journal) {
          const row = rowMap.get(entry.rowId);
          if (!row) continue;
          (row as any)[entry.field] = entry.previousValue;
          restoredFieldCount++;
        }
      }

      job.status = "undone";
    });

    if (!found) return res.status(404).json({ error: "Committed import job not found" });

    await appendAudit({
      entityType: "import",
      entityId: req.params.id as string,
      action: "undone",
      actor,
      payload: { removedCount, restoredFieldCount },
    });

    res.json({ ok: true, removedCount, restoredFieldCount });
  } catch (err) {
    console.error("POST /api/import/jobs/:id/undo error:", err);
    res.status(500).json({ error: "Failed to undo import" });
  }
});

app.get("/api/import/jobs/:id/audit", async (req, res) => {
  try {
    const store = await readStore();
    const audits = store.audits.filter((a) => a.entityType === "import" && a.entityId === req.params.id);
    res.json(audits);
  } catch (err) {
    console.error("GET /api/import/jobs/:id/audit error:", err);
    res.status(500).json({ error: "Failed to read import audits" });
  }
});

const GUILD_QUARTERS: Record<string, { startMonth: number; endMonth: number }> = {
  Q1: { startMonth: 1, endMonth: 3 },
  Q2: { startMonth: 4, endMonth: 6 },
  Q3: { startMonth: 7, endMonth: 9 },
  Q4: { startMonth: 10, endMonth: 0 },
};

function quarterToDate(q: string, type: "start" | "end"): string {
  const qDef = GUILD_QUARTERS[q];
  if (!qDef) return "";
  const year = new Date().getFullYear();
  if (type === "start") {
    return `${year}-${String(qDef.startMonth + 1).padStart(2, "0")}-01`;
  }
  const endYear = q === "Q4" ? year + 1 : year;
  const lastDay = new Date(endYear, qDef.endMonth + 1, 0).getDate();
  return `${endYear}-${String(qDef.endMonth + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}

app.post("/api/import/slide", requireRole("admin", "editor"), upload.single("file"), async (req, res) => {
  try {
    req.setTimeout(300000);
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded" });

    const mimeType = file.mimetype || "image/png";
    const base64 = file.buffer.toString("base64");
    const dataUrl = `data:${mimeType};base64,${base64}`;

    const extraction = await parseSlideImage(dataUrl);
    if (!extraction) {
      return res.status(400).json({ error: "Not a roadmap slide" });
    }
    res.json(extraction);
  } catch (err: any) {
    console.error("POST /api/import/slide error:", err);
    res.status(500).json({ error: "Failed to parse slide image" });
  }
});

app.post("/api/import/slide/pdf-page", requireRole("admin", "editor"), express.json({ limit: "50mb" }), async (req, res) => {
  try {
    req.setTimeout(300000);
    const { page, pageIndex } = req.body as { page: string; pageIndex: number };
    if (!page || typeof page !== "string") {
      return res.status(400).json({ error: "No page image provided" });
    }

    const extraction = await parseSlideImage(page);
    res.json({ pageIndex: pageIndex ?? 0, extraction });
  } catch (err: any) {
    console.error("POST /api/import/slide/pdf-page error:", err);
    res.status(500).json({ error: "Failed to parse slide page" });
  }
});

app.post("/api/import/slide/pdf", requireRole("admin", "editor"), express.json({ limit: "200mb" }), async (req, res) => {
  try {
    req.setTimeout(300000);
    const { pages } = req.body as { pages: string[] };
    if (!pages || !Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ error: "No pages provided" });
    }
    if (pages.length > 50) {
      return res.status(400).json({ error: "Too many pages (max 50)" });
    }

    const results: Array<{ pageIndex: number; extraction: SlideExtraction | null; error?: string }> = [];

    const CONCURRENCY = 3;
    for (let i = 0; i < pages.length; i += CONCURRENCY) {
      const batch = pages.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.allSettled(
        batch.map((dataUrl, batchIdx) => parseSlideImage(dataUrl).then(ext => ({
          pageIndex: i + batchIdx,
          extraction: ext,
        })))
      );
      for (const result of batchResults) {
        if (result.status === "fulfilled") {
          results.push(result.value);
        } else {
          const idx = i + batchResults.indexOf(result);
          results.push({ pageIndex: idx, extraction: null, error: String(result.reason) });
        }
      }
    }

    const extractions = results
      .filter((r) => r.extraction !== null)
      .sort((a, b) => a.pageIndex - b.pageIndex)
      .map((r) => r.extraction!);

    const merged = mergeMultiSlideExtractions(extractions);

    res.json({
      totalPages: pages.length,
      slidesFound: extractions.length,
      skippedPages: pages.length - extractions.length,
      extractions: merged,
    });
  } catch (err: any) {
    console.error("POST /api/import/slide/pdf error:", err);
    res.status(500).json({ error: "Failed to parse PDF slides" });
  }
});

function mergeMultiSlideExtractions(extractions: SlideExtraction[]): SlideExtraction[] {
  const merged: SlideExtraction[] = [];
  const investmentMap = new Map<string, number>();

  for (const ext of extractions) {
    const key = ext.investmentName.toLowerCase().trim();
    const existingIdx = investmentMap.get(key);

    if (existingIdx !== undefined) {
      const existing = merged[existingIdx];
      const existingTacticNames = new Set(existing.tactics.map(t => t.name.toLowerCase().trim()));
      for (const tactic of ext.tactics) {
        if (!existingTacticNames.has(tactic.name.toLowerCase().trim())) {
          existing.tactics.push(tactic);
        }
      }
      const existingMetricNames = new Set(existing.metrics.map(m => m.name.toLowerCase().trim()));
      for (const metric of ext.metrics) {
        if (!existingMetricNames.has(metric.name.toLowerCase().trim())) {
          existing.metrics.push(metric);
        }
      }
      if (!existing.productPriority && ext.productPriority) existing.productPriority = ext.productPriority;
      if (!existing.strategicPillar && ext.strategicPillar) existing.strategicPillar = ext.strategicPillar;
      if (!existing.domain && ext.domain) existing.domain = ext.domain;
    } else {
      investmentMap.set(key, merged.length);
      merged.push({ ...ext, tactics: [...ext.tactics], metrics: [...ext.metrics] });
    }
  }

  return merged;
}

app.post("/api/import/slide/check-duplicates", requireRole("admin", "editor"), async (req, res) => {
  try {
    const { investmentName, tacticNames, domain, pillar } = req.body as {
      investmentName: string;
      tacticNames?: string[];
      domain?: string;
      pillar?: string;
    };
    if (!investmentName) return res.status(400).json({ error: "investmentName is required" });

    const store = await readStore();
    const matches = detectSlideMatches(
      investmentName,
      tacticNames || [],
      store.rows,
      { domain, pillar },
    );
    res.json(matches);
  } catch (err: any) {
    console.error("POST /api/import/slide/check-duplicates error:", err);
    res.status(500).json({ error: "Failed to check duplicates" });
  }
});

const VALID_STATUSES = new Set(["not_started", "in_discovery", "in_progress", "paused", "completed"]);
const VALID_CONFIDENCE = new Set(["high", "medium", "low"]);
const VALID_QUARTERS = new Set(["Q1", "Q2", "Q3", "Q4"]);

app.post("/api/import/slide/commit", requireRole("admin", "editor"), async (req, res) => {
  try {
    const actor = req.user?.email || "unknown";
    const data = req.body as SlideExtraction;

    if (!data.investmentName || !data.investmentName.trim()) {
      return res.status(400).json({ error: "Investment name is required" });
    }

    if (data.tactics) {
      data.tactics = data.tactics.filter((t) => t.name && t.name.trim());
      for (const t of data.tactics) {
        if (!VALID_STATUSES.has(t.status)) t.status = "not_started";
        if (t.deliveryConfidence && !VALID_CONFIDENCE.has(t.deliveryConfidence)) t.deliveryConfidence = undefined;
        if (t.startQuarter && !VALID_QUARTERS.has(t.startQuarter)) t.startQuarter = undefined;
        if (t.endQuarter && !VALID_QUARTERS.has(t.endQuarter)) t.endQuarter = undefined;
      }
    }
    if (data.metrics) {
      data.metrics = data.metrics.filter((m) => m.name && m.name.trim());
    }

    const store = await readStore();

    let metricId: string | undefined;
    const createdMetricIds: string[] = [];
    if (data.metrics && data.metrics.length > 0) {
      for (const metric of data.metrics) {
        if (!metric.name?.trim()) continue;
        const existing = store.metrics.find(
          (m) => m.name.toLowerCase().trim() === metric.name.toLowerCase().trim()
        );
        if (existing) {
          if (!metricId) metricId = existing.id;
          createdMetricIds.push(existing.id);
        } else {
          const newMetricId = crypto.randomUUID();
          const metricNow = new Date().toISOString();
          const newMetric: MetricDefinition = {
            id: newMetricId,
            name: metric.name.trim(),
            description: [metric.description, metric.context].filter(Boolean).join(". "),
            unit: metric.unit || "%",
            targetValue: metric.targetValue != null && !isNaN(Number(metric.targetValue)) ? Math.round(Number(metric.targetValue)) : undefined,
            direction: "increase",
            active: true,
            createdAt: metricNow,
            updatedAt: metricNow,
          };
          if (!metricId) metricId = newMetricId;
          createdMetricIds.push(newMetricId);
          await updateStore((draft) => {
            draft.metrics.push(newMetric);
          });
        }
      }
    }

    const now = new Date().toISOString();
    type TacticStatus = "not_started" | "in_discovery" | "in_progress" | "paused" | "completed";
    type Confidence = "high" | "medium" | "low";
    const tactics: Tactic[] = (data.tactics || []).map((t) => {
      let timeline: { start: string; end: string } | undefined;
      if (t.startQuarter || t.endQuarter) {
        const start = t.startQuarter ? quarterToDate(t.startQuarter, "start") : "";
        const end = t.endQuarter ? quarterToDate(t.endQuarter, "end") : "";
        if (start && end) timeline = { start, end };
      }
      return {
        id: crypto.randomUUID(),
        name: t.name.trim(),
        description: t.description?.trim() || undefined,
        status: (t.status || "not_started") as TacticStatus,
        deliveryConfidence: (t.deliveryConfidence || undefined) as Confidence | undefined,
        jiraLinks: [],
        timeline,
      };
    });

    const mergeIntoRowId = (req.body as any).mergeIntoRowId as string | undefined;
    const skipTacticNames: string[] = (req.body as any).skipTacticNames || [];

    if (mergeIntoRowId) {
      const existingRow = store.rows.find((r) => r.id === mergeIntoRowId);
      if (!existingRow) {
        return res.status(404).json({ error: "Target investment row not found" });
      }

      const existingTacticNamesLower = new Set(existingRow.tactics.map((t) => t.name.toLowerCase().trim()));
      const skipSet = new Set(skipTacticNames.map((n) => n.toLowerCase().trim()));
      const newTactics = tactics.filter(
        (t) => !existingTacticNamesLower.has(t.name.toLowerCase().trim()) && !skipSet.has(t.name.toLowerCase().trim())
      );

      await updateStore((draft) => {
        const row = draft.rows.find((r) => r.id === mergeIntoRowId);
        if (!row) return;
        row.tactics.push(...newTactics);
        if (!row.strategicPillar && data.strategicPillar) row.strategicPillar = data.strategicPillar;
        if (!row.productPriority && data.productPriority) row.productPriority = data.productPriority;
        if (!row.domain && data.domain) {
          const domSplit = data.domain.includes(">") ? data.domain.split(">", 2) : data.domain.includes("→") ? data.domain.split("→", 2) : null;
          if (domSplit) {
            row.domain = domSplit[0].trim();
            if (!row.subDomain) row.subDomain = domSplit[1]?.trim();
          } else {
            row.domain = data.domain;
          }
        }
        if (!row.metricId && metricId) row.metricId = metricId;
        row.updatedAt = now;
        row.updatedBy = actor;
      });

      await appendAudit({
        entityType: "import",
        entityId: mergeIntoRowId,
        action: "slide_import_merge",
        actor,
        payload: {
          investmentName: existingRow.investment,
          mergedTacticsCount: newTactics.length,
          skippedTacticsCount: tactics.length - newTactics.length,
          metricsCount: data.metrics?.length || 0,
        },
      });

      const updatedStore = await readStore();
      const updatedRow = updatedStore.rows.find((r) => r.id === mergeIntoRowId);
      res.json({ row: updatedRow, metricId, createdMetricIds, merged: true });
    } else {
      const newRow: RoadmapRow = {
        id: crypto.randomUUID(),
        strategicPillar: data.strategicPillar || "",
        productPriority: data.productPriority || "",
        investment: data.investmentName,
        domain: (() => {
          const d = data.domain || "";
          const sep = d.includes("→") ? "→" : d.includes(">") ? ">" : null;
          return sep ? d.split(sep, 2)[0].trim() : d;
        })(),
        subDomain: (() => {
          const d = data.domain || "";
          const sep = d.includes("→") ? "→" : d.includes(">") ? ">" : null;
          return sep ? (d.split(sep, 2)[1]?.trim() || undefined) : undefined;
        })(),
        owners: "",
        metricId,
        tactics,
        jiraLinks: [],
        visibility: "internal_only",
        sourceOfTruth: {
          strategicPillar: "manual",
          productPriority: "manual",
          investment: "manual",
          tactics: "manual",
        },
        createdAt: now,
        updatedAt: now,
        updatedBy: actor,
      };

      await updateStore((draft) => {
        draft.rows.unshift(newRow);
      });

      await appendAudit({
        entityType: "import",
        entityId: newRow.id,
        action: "slide_import",
        actor,
        payload: {
          investmentName: data.investmentName,
          tacticsCount: tactics.length,
          metricsCount: data.metrics?.length || 0,
        },
      });

      await expandTaxonomyFromRows([{ strategicPillar: newRow.strategicPillar, productPriority: newRow.productPriority, domain: newRow.domain, subDomain: newRow.subDomain }]);
      res.json({ row: newRow, metricId, createdMetricIds });
    }
  } catch (err: any) {
    console.error("POST /api/import/slide/commit error:", err);
    res.status(500).json({ error: "Failed to commit slide import" });
  }
});

app.post("/api/import/slide/batch-commit", requireRole("admin", "editor"), express.json({ limit: "200mb" }), async (req, res) => {
  try {
    req.setTimeout(300000);
    const actor = req.user?.email || "unknown";
    const { extractions, pageStats } = req.body as {
      extractions: Array<SlideExtraction & {
        action: "create" | "merge" | "skip";
        mergeIntoRowId?: string;
        skipTacticNames?: string[];
      }>;
      pageStats?: { totalPages: number; skippedPages: number; errorPages: number; skippedPageNumbers?: number[]; errorPageDetails?: Array<{ page: number; reason: string }> };
    };

    if (!extractions || !Array.isArray(extractions)) {
      return res.status(400).json({ error: "extractions array is required" });
    }

    for (const ext of extractions) {
      if (ext.action === "skip") continue;
      if (!ext.investmentName?.trim()) {
        return res.status(400).json({ error: "Each extraction must have an investmentName" });
      }
      if (ext.action === "merge" && !ext.mergeIntoRowId) {
        return res.status(400).json({ error: `Merge action for "${ext.investmentName}" requires mergeIntoRowId` });
      }
      if (!["create", "merge", "skip"].includes(ext.action)) {
        return res.status(400).json({ error: `Invalid action "${ext.action}" for "${ext.investmentName}"` });
      }
    }

    const toProcess = extractions.filter(e => e.action !== "skip");
    let created = 0;
    let merged = 0;
    let tacticsAdded = 0;
    let metricsCreated = 0;

    await updateStore((draft) => {
      const metricMap = new Map<string, string>();
      for (const ext of toProcess) {
        for (const metric of (ext.metrics || [])) {
          if (!metric.name?.trim()) continue;
          const key = metric.name.toLowerCase().trim();
          if (metricMap.has(key)) continue;
          const existing = draft.metrics.find(m => m.name.toLowerCase().trim() === key);
          if (existing) {
            metricMap.set(key, existing.id);
          } else {
            const newMetricId = crypto.randomUUID();
            const metricNow = new Date().toISOString();
            draft.metrics.push({
              id: newMetricId,
              name: metric.name.trim(),
              description: [metric.description, metric.context].filter(Boolean).join(". "),
              unit: metric.unit || "%",
              targetValue: metric.targetValue != null && !isNaN(Number(metric.targetValue)) ? Math.round(Number(metric.targetValue)) : undefined,
              direction: "increase",
              active: true,
              createdAt: metricNow,
              updatedAt: metricNow,
            });
            metricMap.set(key, newMetricId);
            metricsCreated++;
          }
        }
      }

      const now = new Date().toISOString();
      type TacticStatus = "not_started" | "in_discovery" | "in_progress" | "paused" | "completed";
      type Confidence = "high" | "medium" | "low";

      for (const ext of toProcess) {
        const firstMetricKey = ext.metrics?.[0]?.name?.toLowerCase().trim();
        const metricId = firstMetricKey ? metricMap.get(firstMetricKey) : undefined;

        const tactics: Tactic[] = (ext.tactics || []).filter(t => t.name?.trim()).map((t) => {
          let timeline: { start: string; end: string } | undefined;
          if (t.startQuarter || t.endQuarter) {
            const start = t.startQuarter ? quarterToDate(t.startQuarter, "start") : "";
            const end = t.endQuarter ? quarterToDate(t.endQuarter, "end") : "";
            if (start && end) timeline = { start, end };
          }
          if (!VALID_STATUSES.has(t.status)) t.status = "not_started";
          if (t.deliveryConfidence && !VALID_CONFIDENCE.has(t.deliveryConfidence)) t.deliveryConfidence = undefined;
          return {
            id: crypto.randomUUID(),
            name: t.name.trim(),
            description: t.description?.trim() || undefined,
            status: (t.status || "not_started") as TacticStatus,
            deliveryConfidence: (t.deliveryConfidence || undefined) as Confidence | undefined,
            jiraLinks: [],
            timeline,
          };
        });

        if (ext.action === "merge" && ext.mergeIntoRowId) {
          const row = draft.rows.find(r => r.id === ext.mergeIntoRowId);
          if (!row) continue;
          const existingNames = new Set(row.tactics.map(t => t.name.toLowerCase().trim()));
          const skipSet = new Set((ext.skipTacticNames || []).map(n => n.toLowerCase().trim()));
          const newTactics = tactics.filter(t =>
            !existingNames.has(t.name.toLowerCase().trim()) &&
            !skipSet.has(t.name.toLowerCase().trim())
          );
          row.tactics.push(...newTactics);
          if (!row.strategicPillar && ext.strategicPillar) row.strategicPillar = ext.strategicPillar;
          if (!row.productPriority && ext.productPriority) row.productPriority = ext.productPriority;
          if (!row.domain && ext.domain) {
            const dSep = ext.domain.includes("→") ? "→" : ext.domain.includes(">") ? ">" : null;
            if (dSep) {
              row.domain = ext.domain.split(dSep, 2)[0].trim();
              if (!row.subDomain) row.subDomain = ext.domain.split(dSep, 2)[1]?.trim();
            } else {
              row.domain = ext.domain;
            }
          }
          if (!row.metricId && metricId) row.metricId = metricId;
          row.updatedAt = now;
          row.updatedBy = actor;
          tacticsAdded += newTactics.length;
          merged++;
        } else {
          const dRaw = ext.domain || "";
          const dSep2 = dRaw.includes("→") ? "→" : dRaw.includes(">") ? ">" : null;
          const newRow: RoadmapRow = {
            id: crypto.randomUUID(),
            strategicPillar: ext.strategicPillar || "",
            productPriority: ext.productPriority || "",
            investment: ext.investmentName,
            domain: dSep2 ? dRaw.split(dSep2, 2)[0].trim() : dRaw,
            subDomain: dSep2 ? (dRaw.split(dSep2, 2)[1]?.trim() || undefined) : undefined,
            owners: "",
            metricId,
            tactics,
            jiraLinks: [],
            visibility: "internal_only",
            sourceOfTruth: {
              strategicPillar: "manual",
              productPriority: "manual",
              investment: "manual",
              tactics: "manual",
            },
            createdAt: now,
            updatedAt: now,
            updatedBy: actor,
          };
          draft.rows.unshift(newRow);
          tacticsAdded += tactics.length;
          created++;
        }
      }
    });

    await expandTaxonomyFromRows(toProcess.map((e) => {
      const d = e.domain || "";
      const sep = d.includes("→") ? "→" : d.includes(">") ? ">" : null;
      return {
        strategicPillar: e.strategicPillar,
        productPriority: e.productPriority,
        domain: sep ? d.split(sep, 2)[0].trim() : d,
        subDomain: sep ? (d.split(sep, 2)[1]?.trim() || undefined) : undefined,
      };
    }));

    await appendAudit({
      entityType: "import",
      entityId: "batch",
      action: "slide_batch_import",
      actor,
      payload: { created, merged, tacticsAdded, metricsCreated, totalExtractions: toProcess.length, ...(pageStats ? { totalPages: pageStats.totalPages, skippedPages: pageStats.skippedPages, errorPages: pageStats.errorPages, skippedPageNumbers: pageStats.skippedPageNumbers, errorPageDetails: pageStats.errorPageDetails } : {}) },
    });

    res.json({ created, merged, tacticsAdded, metricsCreated });
    syncAndGeneratePriorities(actor);
  } catch (err: any) {
    console.error("POST /api/import/slide/batch-commit error:", err);
    res.status(500).json({ error: "Failed to batch commit slides" });
  }
});

app.get("/api/jira/upcoming", async (req, res) => {
  try {
    const maxResults = req.query.maxResults ? Number(req.query.maxResults) : undefined;
    const dueDateFrom = req.query.dueDateFrom as string | undefined;
    const dueDateTo = req.query.dueDateTo as string | undefined;
    const createdFrom = req.query.createdFrom as string | undefined;
    const createdTo = req.query.createdTo as string | undefined;
    const results = await fetchUpcomingDeliverables({ maxResults, dueDateFrom, dueDateTo, createdFrom, createdTo });
    res.json(results);
  } catch (err) {
    console.error("Upcoming deliverables fetch error:", err);
    res.status(500).json({ error: "Failed to fetch upcoming deliverables" });
  }
});

app.get("/api/jira/accomplishments", async (req, res) => {
  try {
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;
    const maxResults = req.query.maxResults ? Number(req.query.maxResults) : undefined;
    const results = await fetchAccomplishments({ startDate, endDate, maxResults });
    res.json(results);
  } catch (err) {
    console.error("Accomplishments fetch error:", err);
    res.status(500).json({ error: "Failed to fetch accomplishments" });
  }
});

app.post("/api/telemetry/events", async (req, res) => {
  try {
    await appendTelemetry({
      type: String(req.body?.type || "unknown"),
      actor: String(req.body?.actor || "unknown"),
      payload: req.body?.payload ?? {},
    });
    res.status(202).send();
  } catch (err) {
    console.error("POST /api/telemetry/events error:", err);
    res.status(500).json({ error: "Failed to record telemetry" });
  }
});

app.get("/api/metrics/adoption", async (_req, res) => {
  try {
    const store = await readStore();
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const weeklyEvents = store.telemetry.filter(
      (event) => new Date(event.createdAt).getTime() >= since,
    );
    const viewSwitches = weeklyEvents.filter((e) => e.type === "view_switch").length;
    const qnaQueries = weeklyEvents.filter((e) => e.type === "ai_qna").length;
    res.json({
      weeklyEvents: weeklyEvents.length,
      viewSwitches,
      qnaQueries,
      rows: store.rows.length,
      views: store.views.length,
      imports: store.imports.length,
    });
  } catch (err) {
    console.error("GET /api/metrics/adoption error:", err);
    res.status(500).json({ error: "Failed to read adoption metrics" });
  }
});

let jiraSyncInterval: "off" | "hourly" | "daily" = "off";
let jiraSyncTimer: ReturnType<typeof setInterval> | null = null;
let jiraSyncLastRun: string | null = null;
let jiraSyncLastResult: "success" | "error" | null = null;
let jiraSyncLastError: string | null = null;
let jiraSyncInProgress = false;

const SYNC_INTERVALS: Record<string, number> = {
  hourly: 60 * 60 * 1000,
  daily: 24 * 60 * 60 * 1000,
};

async function syncAllJiraLinks(): Promise<void> {
  if (jiraSyncInProgress) return;
  jiraSyncInProgress = true;
  console.log("[Jira Sync] Starting sync...");
  try {
    const store = await readStore();
    let synced = 0;
    for (const row of store.rows) {
      const allLinks = [
        ...row.jiraLinks,
        ...row.tactics.flatMap((t) => t.jiraLinks),
      ];
      if (allLinks.length === 0) continue;

      for (const link of allLinks) {
        try {
          const attrs = await fetchAttributes(link.key);
          link.jiraAttributes = attrs;
          synced++;
        } catch (err) {
          console.error(`[Jira Sync] Failed to sync ${link.key}:`, (err as Error).message);
        }
      }

      await updateStore((draft) => {
        draft.rows = draft.rows.map((r) => {
          if (r.id !== row.id) return r;
          return {
            ...r,
            jiraLinks: row.jiraLinks,
            tactics: row.tactics,
            lastSyncedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        });
      });
    }
    jiraSyncLastRun = new Date().toISOString();
    jiraSyncLastResult = "success";
    jiraSyncLastError = null;
    console.log(`[Jira Sync] Completed. Synced ${synced} links.`);
  } catch (err) {
    jiraSyncLastRun = new Date().toISOString();
    jiraSyncLastResult = "error";
    jiraSyncLastError = (err as Error).message;
    console.error("[Jira Sync] Failed:", (err as Error).message);
  } finally {
    jiraSyncInProgress = false;
  }
}

function applySyncInterval(interval: "off" | "hourly" | "daily"): void {
  if (jiraSyncTimer) {
    clearInterval(jiraSyncTimer);
    jiraSyncTimer = null;
  }
  jiraSyncInterval = interval;
  if (interval !== "off") {
    const ms = SYNC_INTERVALS[interval];
    jiraSyncTimer = setInterval(() => {
      syncAllJiraLinks().catch((err) => console.error("[Jira Sync] Interval error:", err));
    }, ms);
    console.log(`[Jira Sync] Scheduled every ${interval} (${ms}ms)`);
  } else {
    console.log("[Jira Sync] Sync disabled");
  }
}

app.get("/api/settings/jira-sync-config", (_req, res) => {
  res.json({ interval: jiraSyncInterval });
});

app.post("/api/settings/jira-sync-config", requireRole("admin"), (req, res) => {
  const { interval } = req.body as { interval?: string };
  if (!interval || !["off", "hourly", "daily"].includes(interval)) {
    return res.status(400).json({ error: "interval must be one of: off, hourly, daily" });
  }
  applySyncInterval(interval as "off" | "hourly" | "daily");
  res.json({ interval: jiraSyncInterval });
});

app.get("/api/settings/jira-sync-status", (_req, res) => {
  res.json({
    interval: jiraSyncInterval,
    inProgress: jiraSyncInProgress,
    lastRun: jiraSyncLastRun,
    lastResult: jiraSyncLastResult,
    lastError: jiraSyncLastError,
  });
});

if (process.env.NODE_ENV === "production") {
  const __filename_fall = fileURLToPath(import.meta.url);
  const __dirname_fall = path.dirname(__filename_fall);
  const distPathFall = path.resolve(__dirname_fall, "../../frontend/dist");
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    res.sendFile(path.join(distPathFall, "index.html"));
  });
} else {
  app.use(
    createProxyMiddleware({
      target: `http://localhost:${VITE_PORT}`,
      changeOrigin: true,
      ws: true,
    }),
  );
}

async function ensureAiReportsTable() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS ai_reports (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      report_type TEXT NOT NULL,
      title TEXT NOT NULL,
      parameters JSONB NOT NULL DEFAULT '{}',
      content JSONB NOT NULL DEFAULT '{}',
      created_by TEXT NOT NULL DEFAULT 'unknown',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  } catch (err) {
    console.error("Failed to ensure ai_reports table:", err);
  }
}

async function ensureAiTables() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS ai_threads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title TEXT NOT NULL DEFAULT 'New conversation',
      created_by TEXT NOT NULL DEFAULT 'unknown',
      context_type TEXT,
      context_id TEXT,
      context_label TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ai_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      thread_id UUID NOT NULL REFERENCES ai_threads(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      citations JSONB NOT NULL DEFAULT '[]',
      metadata JSONB NOT NULL DEFAULT '{}',
      created_by TEXT NOT NULL DEFAULT 'unknown',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY DEFAULT 1,
      ai_custom_instructions TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT 'unknown',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await pool.query(`INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ai_context_documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      filename TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      storage_key TEXT NOT NULL,
      extracted_text TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'processing',
      error_message TEXT,
      uploaded_by TEXT NOT NULL DEFAULT 'unknown',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  } catch (err) {
    console.error("Failed to ensure AI tables:", err);
  }
}

ensureAiReportsTable();
ensureAiTables();

async function ensureDefaultAdmin() {
  try {
    const adminEmail = "matt.gettleman@guild.com";
    const result = await pool.query("SELECT id, role FROM users WHERE email = $1", [adminEmail]);
    if (result.rows.length > 0 && result.rows[0].role !== "admin") {
      await pool.query("UPDATE users SET role = 'admin', updated_at = NOW() WHERE email = $1", [adminEmail]);
      console.log(`Promoted ${adminEmail} to admin`);
    }
  } catch (err) {
    console.error("Failed to ensure default admin:", err);
  }
}
ensureDefaultAdmin();

async function autoSeedIfEmpty() {
  try {
    const countResult = await pool.query("SELECT COUNT(*) as cnt FROM roadmap_rows");
    const count = parseInt(countResult.rows[0].cnt, 10);
    if (count > 0) {
      console.log(`[Auto-Seed] Database already has ${count} rows, skipping seed.`);
      return;
    }
    console.log("[Auto-Seed] Database is empty, importing seed data...");
    const { SEED_DATA } = await import("./seed-data.js");
    const data = SEED_DATA as any;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let importedRows = 0;
      if (data.roadmap_rows?.length) {
        for (const row of data.roadmap_rows) {
          await client.query(
            `INSERT INTO roadmap_rows (id, strategic_pillar, product_priority, investment, description, metric_id, domain, owners, timeline, tags, tactics, jira_links, source_of_truth, last_synced_at, created_at, updated_at, updated_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
             ON CONFLICT (id) DO NOTHING`,
            [
              row.id, row.strategic_pillar, row.product_priority, row.investment,
              row.description, row.metric_id, row.domain, row.owners,
              row.timeline ? JSON.stringify(row.timeline) : null,
              JSON.stringify(row.tags || []),
              JSON.stringify(row.tactics || []),
              JSON.stringify(row.jira_links || []),
              row.source_of_truth ? JSON.stringify(row.source_of_truth) : null,
              row.last_synced_at, row.created_at, row.updated_at, row.updated_by,
            ],
          );
          importedRows++;
        }
      }
      if (data.taxonomy?.length) {
        for (const tax of data.taxonomy) {
          await client.query(
            `INSERT INTO taxonomy (id, pillars, priorities, domains, owners, tags, themes)
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (id) DO NOTHING`,
            [tax.id, JSON.stringify(tax.pillars), JSON.stringify(tax.priorities), JSON.stringify(tax.domains), JSON.stringify(tax.owners), JSON.stringify(tax.tags || []), JSON.stringify(tax.themes || [])],
          );
        }
      }
      if (data.metric_definitions?.length) {
        for (const m of data.metric_definitions) {
          await client.query(
            `INSERT INTO metric_definitions (id, name, description, unit, target_value, direction, active, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (id) DO NOTHING`,
            [m.id, m.name, m.description, m.unit, m.target_value, m.direction, m.active, m.created_at, m.updated_at],
          );
        }
      }
      if (data.saved_views?.length) {
        for (const v of data.saved_views) {
          await client.query(
            `INSERT INTO saved_views (id, name, audience_tag, is_shared, view_mode, filters, visible_columns, column_order, group_by, sort_by, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
             ON CONFLICT (id) DO NOTHING`,
            [
              v.id, v.name, v.audience_tag, v.is_shared, v.view_mode,
              v.filters ? JSON.stringify(v.filters) : null,
              v.visible_columns ? JSON.stringify(v.visible_columns) : null,
              v.column_order ? JSON.stringify(v.column_order) : null,
              v.group_by ? JSON.stringify(v.group_by) : null,
              v.sort_by ? JSON.stringify(v.sort_by) : null,
              v.created_at, v.updated_at,
            ],
          );
        }
      }
      if (data.app_settings?.length) {
        for (const s of data.app_settings) {
          await client.query(
            `INSERT INTO app_settings (id, ai_custom_instructions, updated_by, updated_at)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (id) DO NOTHING`,
            [s.id, s.ai_custom_instructions, s.updated_by, s.updated_at],
          );
        }
      }
      await client.query("COMMIT");
      console.log(`[Auto-Seed] Imported ${importedRows} roadmap rows + taxonomy/metrics/views/settings`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[Auto-Seed] Failed:", err);
  }
}
// Auto-seed disabled — data is managed via the Import feature
// autoSeedIfEmpty();

if (process.env.NODE_ENV === "production") {
  pool.query(`CREATE INDEX IF NOT EXISTS doc_chunks_embedding_hnsw_idx ON document_chunks USING hnsw (embedding vector_cosine_ops)`)
    .then(() => console.log("[Startup] pgvector HNSW index ensured"))
    .catch((err) => console.warn("[Startup] HNSW index creation skipped:", err?.message));
}

// One-time cleanup: clear expectedBenefits that were auto-populated from brief docs
app.post("/api/admin/clear-expected-benefits", requireRole("admin"), async (req, res) => {
  try {
    const result = await pool.query(`UPDATE roadmap_rows SET expected_benefits = '[]'::jsonb WHERE expected_benefits != '[]'::jsonb`);
    res.json({ ok: true, cleared: result.rowCount ?? 0 });
  } catch (err) {
    console.error("POST /api/admin/clear-expected-benefits error:", err);
    res.status(500).json({ error: "Failed to clear expected benefits" });
  }
});

app.post("/api/admin/reset-all-data", requireRole("admin"), async (req, res) => {
  try {
    const { confirm } = req.body;
    if (confirm !== "DELETE_ALL_DATA") {
      return res.status(400).json({ error: "Must send { confirm: \"DELETE_ALL_DATA\" } to proceed" });
    }
    const actor = req.user?.email || "unknown";
    const counts: Record<string, number> = {};
    await db.transaction(async (tx) => {
      const tables = [
        { name: "document_links", table: documentLinks },
        { name: "document_chunks", table: documentChunks },
        { name: "documents", table: documents },
        { name: "ai_messages", table: aiMessages },
        { name: "ai_threads", table: aiThreads },
        { name: "ai_reports", table: aiReports },
        { name: "import_jobs", table: importJobs },
        { name: "telemetry_events", table: telemetryEvents },
        { name: "audit_events", table: auditEvents },
        { name: "saved_views", table: savedViews },
        { name: "metric_definitions", table: metricDefinitions },
        { name: "roadmap_rows", table: roadmapRows },
      ];
      for (const { name, table } of tables) {
        const result = await tx.delete(table).returning();
        counts[name] = result.length;
      }
    });
    console.log(`[Admin] Data reset by ${actor}:`, counts);
    res.json({ success: true, deletedCounts: counts });
  } catch (err) {
    console.error("POST /api/admin/reset-all-data error:", err);
    res.status(500).json({ error: "Failed to reset data" });
  }
});

runMigrations()
  .catch((err) => {
    console.warn("Migration warning (non-fatal):", err.message);
  })
  .then(() => {
    app.listen(port, "0.0.0.0", () => {
      console.log(`Roadmap API listening on :${port} (${process.env.NODE_ENV || "development"})`);

      cron.schedule("0 8 * * 1", async () => {
        console.log("[CRON] Running weekly changelog digest...");
        try {
          const appUrl = process.env.APP_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN || "localhost:5000"}`;
          await runWeeklyDigest(`${appUrl}/#changelog`);
        } catch (err) {
          console.error("[CRON] Weekly digest failed:", err);
        }
      }, { timezone: "America/Denver" });
      console.log("[CRON] Weekly digest scheduled: Mondays at 8:00 AM MT");
    });
  })
  .catch((err) => {
    console.error("Failed to run migrations, exiting:", err);
    process.exit(1);
  });
