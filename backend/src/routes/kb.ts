import { Router } from "express";
import multer from "multer";
import { eq, and, desc, sql, ilike } from "drizzle-orm";
import { db } from "../lib/db.js";
import { documents, documentChunks, documentLinks, roadmapRows } from "../lib/schema.js";
import { uploadToObjectStorage, deleteFromObjectStorage, downloadFromObjectStorage } from "../lib/kb-storage.js";
import { parseTimePeriodToDate } from "../lib/kb-time-parser.js";
import { enqueueDocument, reprocessDocument, reembedAllChunks } from "../lib/kb-processor.js";
import { searchSimilarChunks } from "../lib/kb-embeddings.js";
import { carryForwardLinks } from "../lib/kb-autolink.js";
import { requireAuth, requireRole } from "../lib/auth.js";
import { extractTextFromPDF, extractTextFromDOCX } from "../lib/kb-parser.js";
import { analyzeUploadedDocument, extractDocumentContent } from "../lib/ai-client.js";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const VALID_DOC_TYPES = ["brief", "product_brief", "gtm_brief", "por", "strategy", "recap", "release_announcement", "one_pager", "reference"];

router.post(
  "/analyze-upload",
  requireAuth,
  requireRole("admin", "editor"),
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      if (!process.env.OPENAI_API_KEY) {
        return res.status(503).json({ error: "AI analysis unavailable", aiUnavailable: true });
      }

      const allowedMimes = [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
        "text/plain",
        "text/markdown",
      ];
      const allowedExts = [".pdf", ".docx", ".doc", ".txt", ".md"];
      const ext = (req.file.originalname || "").toLowerCase().match(/\.\w+$/)?.[0] || "";
      if (!allowedMimes.includes(req.file.mimetype) && !allowedExts.includes(ext)) {
        return res.status(400).json({ error: "Unsupported file type. Please upload PDF, DOCX, TXT, or MD files." });
      }

      let text = "";
      const mime = req.file.mimetype;
      if (mime === "application/pdf") {
        text = await extractTextFromPDF(req.file.buffer);
      } else if (
        mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        mime === "application/msword"
      ) {
        text = await extractTextFromDOCX(req.file.buffer);
      } else {
        text = req.file.buffer.toString("utf-8");
      }

      if (!text || text.trim().length < 20) {
        return res.status(400).json({ error: "Could not extract enough text from the document for analysis" });
      }

      const rows = await db.select({
        id: roadmapRows.id,
        investment: roadmapRows.investment,
        strategicPillar: roadmapRows.strategicPillar,
        productPriority: roadmapRows.productPriority,
      }).from(roadmapRows);

      const analysis = await analyzeUploadedDocument(text, req.file.originalname, rows);
      res.json(analysis);
    } catch (err: any) {
      console.error("Analyze upload error:", err);
      res.status(500).json({ error: "Analysis failed" });
    }
  },
);

router.post(
  "/documents",
  requireAuth,
  requireRole("admin", "editor"),
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const { documentType, initiative, timePeriod, replaceDocumentId, productPriority } = req.body;

      if (documentType && !VALID_DOC_TYPES.includes(documentType)) {
        return res.status(400).json({ error: `Invalid document type. Must be one of: ${VALID_DOC_TYPES.join(", ")}` });
      }

      const user = req.user;
      const storageKey = await uploadToObjectStorage(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
      );

      const timePeriodDate = parseTimePeriodToDate(timePeriod);

      let version = 1;
      if (replaceDocumentId) {
        const [oldDoc] = await db
          .select()
          .from(documents)
          .where(eq(documents.id, replaceDocumentId));

        if (oldDoc) {
          version = (oldDoc.version || 1) + 1;
        }
      }

      const [doc] = await db
        .insert(documents)
        .values({
          filename: req.file.originalname,
          fileSize: req.file.size,
          mimeType: req.file.mimetype,
          storageKey,
          documentType: documentType || "reference",
          initiative: initiative || null,
          productPriority: productPriority || null,
          timePeriod: timePeriod || null,
          timePeriodDate,
          status: "uploading",
          version,
          uploadedBy: user?.email || "unknown",
        })
        .returning();

      if (replaceDocumentId) {
        await db
          .update(documents)
          .set({ supersededBy: doc.id, isArchived: true, updatedAt: new Date() })
          .where(eq(documents.id, replaceDocumentId));

        await carryForwardLinks(replaceDocumentId, doc.id);
      }

      enqueueDocument(doc.id);

      res.status(201).json(formatDocument(doc));
    } catch (err: any) {
      console.error("Upload error:", err);
      res.status(500).json({ error: "Upload failed" });
    }
  },
);

router.get("/documents", requireAuth, async (req, res) => {
  try {
    const { type, initiative, productPriority, period, includeArchived } = req.query;

    let query = db.select().from(documents);
    const conditions: any[] = [];

    if (type && typeof type === "string") {
      conditions.push(eq(documents.documentType, type));
    }
    if (initiative && typeof initiative === "string") {
      conditions.push(eq(documents.initiative, initiative));
    }
    if (productPriority && typeof productPriority === "string") {
      conditions.push(eq(documents.productPriority, productPriority));
    }
    if (includeArchived !== "true") {
      conditions.push(eq(documents.isArchived, false));
    }

    if (period && typeof period === "string") {
      if (/^\d{4}-\d{2}$/.test(period)) {
        const start = `${period}-01`;
        const endDate = new Date(parseInt(period.split("-")[0]), parseInt(period.split("-")[1]), 0);
        const end = endDate.toISOString().split("T")[0];
        conditions.push(sql`${documents.timePeriodDate} >= ${start}::date`);
        conditions.push(sql`${documents.timePeriodDate} <= ${end}::date`);
      } else if (/^\d{4}$/.test(period)) {
        conditions.push(sql`${documents.timePeriodDate} >= ${period + "-01-01"}::date`);
        conditions.push(sql`${documents.timePeriodDate} <= ${period + "-12-31"}::date`);
      }
    }

    const result = conditions.length > 0
      ? await db.select().from(documents).where(and(...conditions)).orderBy(desc(documents.createdAt))
      : await db.select().from(documents).orderBy(desc(documents.createdAt));

    const chunkCounts = await db
      .select({
        documentId: documentChunks.documentId,
        count: sql<number>`count(*)::int`,
      })
      .from(documentChunks)
      .groupBy(documentChunks.documentId);

    const linkCounts = await db
      .select({
        documentId: documentLinks.documentId,
        count: sql<number>`count(*)::int`,
      })
      .from(documentLinks)
      .groupBy(documentLinks.documentId);

    const chunkMap = new Map(chunkCounts.map((c) => [c.documentId, c.count]));
    const linkMap = new Map(linkCounts.map((l) => [l.documentId, l.count]));

    const docs = result.map((d) => ({
      ...formatDocument(d),
      chunkCount: chunkMap.get(d.id) || 0,
      linkCount: linkMap.get(d.id) || 0,
    }));

    res.json(docs);
  } catch (err: any) {
    console.error("List documents error:", err);
    res.status(500).json({ error: "Failed to list documents" });
  }
});

router.get("/documents/:id", requireAuth, async (req, res) => {
  try {
    const [doc] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, req.params.id as string));

    if (!doc) return res.status(404).json({ error: "Document not found" });

    const chunks = await db
      .select()
      .from(documentChunks)
      .where(eq(documentChunks.documentId, doc.id))
      .orderBy(documentChunks.sequence);

    const links = await db
      .select()
      .from(documentLinks)
      .where(eq(documentLinks.documentId, doc.id));

    res.json({
      ...formatDocument(doc),
      chunkCount: chunks.length,
      linkCount: links.length,
      chunks: chunks.map(formatChunk),
      links,
    });
  } catch (err: any) {
    console.error("Get document error:", err);
    res.status(500).json({ error: "Failed to get document" });
  }
});

router.patch(
  "/documents/:id",
  requireAuth,
  requireRole("admin", "editor"),
  async (req, res) => {
    try {
      const { documentType, initiative, timePeriod, timePeriodDate: manualDate } = req.body;

      const updates: Record<string, any> = { updatedAt: new Date() };
      if (documentType !== undefined) updates.documentType = documentType;
      if (initiative !== undefined) updates.initiative = initiative || null;
      if (timePeriod !== undefined) {
        updates.timePeriod = timePeriod || null;
        updates.timePeriodDate = manualDate || parseTimePeriodToDate(timePeriod);
      }
      if (manualDate !== undefined && timePeriod === undefined) {
        updates.timePeriodDate = manualDate;
      }

      const [updated] = await db
        .update(documents)
        .set(updates)
        .where(eq(documents.id, req.params.id as string))
        .returning();

      if (!updated) return res.status(404).json({ error: "Document not found" });

      res.json(formatDocument(updated));
    } catch (err: any) {
      console.error("Update document error:", err);
      res.status(500).json({ error: "Failed to update document" });
    }
  },
);

router.delete(
  "/documents/:id",
  requireAuth,
  requireRole("admin", "editor"),
  async (req, res) => {
    try {
      const user = req.user;
      const [doc] = await db
        .select()
        .from(documents)
        .where(eq(documents.id, req.params.id as string));

      if (!doc) return res.status(404).json({ error: "Document not found" });

      const isAdmin = user?.role === "admin";
      const isUploader = user?.email === doc.uploadedBy;
      if (!isAdmin && !isUploader) {
        return res.status(403).json({ error: "Only admins or the original uploader can delete documents" });
      }

      await deleteFromObjectStorage(doc.storageKey);
      await db.delete(documents).where(eq(documents.id, req.params.id as string));

      res.json({ ok: true });
    } catch (err: any) {
      console.error("Delete document error:", err);
      res.status(500).json({ error: "Failed to delete document" });
    }
  },
);

router.get("/documents/:id/file", requireAuth, async (req, res) => {
  try {
    const [doc] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, req.params.id as string));

    if (!doc) return res.status(404).json({ error: "Document not found" });

    const buffer = await downloadFromObjectStorage(doc.storageKey);
    res.setHeader("Content-Type", doc.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${doc.filename}"`);
    res.setHeader("Content-Length", buffer.length.toString());
    res.send(buffer);
  } catch (err: any) {
    console.error("Download document file error:", err);
    res.status(500).json({ error: "Failed to download file" });
  }
});

router.get("/search", requireAuth, async (req, res) => {
  try {
    const { q, type, initiative, period, include_archived, limit } = req.query;

    if (!q || typeof q !== "string") {
      return res.status(400).json({ error: "Query parameter 'q' is required" });
    }

    let periodStart: string | undefined;
    let periodEnd: string | undefined;

    if (period && typeof period === "string") {
      if (/^\d{4}-\d{2}$/.test(period)) {
        periodStart = `${period}-01`;
        const endDate = new Date(parseInt(period.split("-")[0]), parseInt(period.split("-")[1]), 0);
        periodEnd = endDate.toISOString().split("T")[0];
      } else if (/^\d{4}$/.test(period)) {
        periodStart = `${period}-01-01`;
        periodEnd = `${period}-12-31`;
      }
    }

    const results = await searchSimilarChunks({
      query: q,
      limit: limit ? Math.min(parseInt(limit as string, 10), 50) : 10,
      documentType: type as string | undefined,
      initiative: initiative as string | undefined,
      includeArchived: include_archived === "true",
      periodStart,
      periodEnd,
    });

    res.json(
      results.map((r) => ({
        chunk: {
          id: r.chunkId,
          documentId: r.documentId,
          content: r.content,
          sectionType: r.sectionType,
          month: r.month,
          initiative: r.chunkInitiative,
          jiraKeys: r.jiraKeys,
          tokenCount: r.tokenCount,
        },
        document: {
          id: r.documentId,
          filename: r.filename,
          documentType: r.documentType,
          initiative: r.docInitiative,
          timePeriod: r.timePeriod,
        },
        similarity: r.similarity,
        combinedScore: r.combinedScore,
      })),
    );
  } catch (err: any) {
    console.error("Search error:", err);
    res.status(500).json({ error: "Search failed" });
  }
});

router.post(
  "/documents/:id/links",
  requireAuth,
  requireRole("admin", "editor"),
  async (req, res) => {
    try {
      const { rowId, tacticId, linkType } = req.body;
      if (!rowId) return res.status(400).json({ error: "rowId is required" });

      const [link] = await db
        .insert(documentLinks)
        .values({
          documentId: req.params.id as string,
          rowId,
          tacticId: tacticId || null,
          linkType: linkType || "manual",
          confidence: linkType === "manual" ? 100 : undefined,
        })
        .returning();

      res.status(201).json(link);
    } catch (err: any) {
      console.error("Create document link error:", err);
      res.status(500).json({ error: "Failed to create document link" });
    }
  },
);

router.delete(
  "/documents/:id/links/:linkId",
  requireAuth,
  requireRole("admin", "editor"),
  async (req, res) => {
    try {
      await db
        .delete(documentLinks)
        .where(
          and(
            eq(documentLinks.id, req.params.linkId as string),
            eq(documentLinks.documentId, req.params.id as string),
          ),
        );

      res.json({ ok: true });
    } catch (err: any) {
      console.error("Delete document link error:", err);
      res.status(500).json({ error: "Failed to delete document link" });
    }
  },
);

router.patch(
  "/documents/:docId/links/:linkId/confirm",
  requireAuth,
  requireRole("admin", "editor"),
  async (req, res) => {
    try {
      const [updated] = await db
        .update(documentLinks)
        .set({ linkType: "confirmed" })
        .where(
          and(
            eq(documentLinks.id, req.params.linkId as string),
            eq(documentLinks.documentId, req.params.docId as string),
          ),
        )
        .returning();

      if (!updated) return res.status(404).json({ error: "Link not found" });
      res.json(updated);
    } catch (err: any) {
      console.error("Confirm document link error:", err);
      res.status(500).json({ error: "Failed to confirm document link" });
    }
  },
);

router.get("/documents-for-row/:rowId", requireAuth, async (req, res) => {
  try {
    const rowId = req.params.rowId as string;

    // Get investment's productPriority for priority-level doc matching
    const [investment] = await db
      .select({ productPriority: roadmapRows.productPriority })
      .from(roadmapRows)
      .where(eq(roadmapRows.id, rowId));

    // Directly linked docs
    const links = await db
      .select()
      .from(documentLinks)
      .where(eq(documentLinks.rowId, rowId));

    const docIds = [...new Set(links.map((l) => l.documentId))];
    const directDocs = docIds.length > 0
      ? await db
          .select()
          .from(documents)
          .where(sql`${documents.id} IN (${sql.join(docIds.map((id) => sql`${id}::uuid`), sql`, `)})`)
      : [];

    // Priority-level docs (attached at product priority level)
    const priorityDocs = investment?.productPriority
      ? await db
          .select()
          .from(documents)
          .where(
            and(
              eq(documents.productPriority, investment.productPriority),
              eq(documents.isArchived, false),
              eq(documents.status, "ready"),
            ),
          )
      : [];

    const seenDocIds = new Set(docIds);
    const result = [
      ...links.map((link) => {
        const doc = directDocs.find((d) => d.id === link.documentId);
        return { link, document: doc ? formatDocument(doc) : null };
      }),
      ...priorityDocs
        .filter((doc) => !seenDocIds.has(doc.id))
        .map((doc) => ({
          link: {
            id: `priority-${doc.id}`,
            documentId: doc.id,
            rowId,
            tacticId: null,
            linkType: "priority",
            confidence: null,
            matchReason: "Priority-level document",
            matchLevel: "priority",
            createdAt: doc.createdAt,
          },
          document: formatDocument(doc),
        })),
    ];

    res.json(result);
  } catch (err: any) {
    console.error("Get documents for row error:", err);
    res.status(500).json({ error: "Failed to get documents for row" });
  }
});

router.post(
  "/documents/:id/extract-content",
  requireAuth,
  requireRole("admin", "editor"),
  async (req, res) => {
    try {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(503).json({ error: "AI extraction unavailable" });
      }

      const [doc] = await db
        .select()
        .from(documents)
        .where(eq(documents.id, req.params.id as string));

      if (!doc) return res.status(404).json({ error: "Document not found" });

      const chunks = await db
        .select({ content: documentChunks.content })
        .from(documentChunks)
        .where(eq(documentChunks.documentId, doc.id))
        .orderBy(documentChunks.sequence);

      if (!chunks.length) {
        return res.status(400).json({ error: "Document has no processed content" });
      }

      const fullText = chunks.map((c) => c.content).join("\n\n");
      const aiContent = await extractDocumentContent(fullText, doc.filename);

      const [updated] = await db
        .update(documents)
        .set({ aiContent, updatedAt: new Date() })
        .where(eq(documents.id, doc.id))
        .returning();

      res.json(formatDocument(updated));
    } catch (err: any) {
      console.error("Extract content error:", err);
      res.status(500).json({ error: "Content extraction failed" });
    }
  },
);

router.post(
  "/documents/:id/reprocess",
  requireAuth,
  requireRole("admin", "editor"),
  async (req, res) => {
    try {
      const [doc] = await db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.id, req.params.id as string));

      if (!doc) return res.status(404).json({ error: "Document not found" });

      await reprocessDocument(doc.id);
      res.json({ ok: true });
    } catch (err: any) {
      console.error("Reprocess document error:", err);
      res.status(500).json({ error: "Failed to reprocess document" });
    }
  },
);

router.post(
  "/admin/reprocess",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      const allDocs = await db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.isArchived, false));

      for (const doc of allDocs) {
        await reprocessDocument(doc.id);
      }

      res.json({ ok: true, count: allDocs.length });
    } catch (err: any) {
      console.error("Admin reprocess all error:", err);
      res.status(500).json({ error: "Failed to reprocess documents" });
    }
  },
);

router.post(
  "/admin/reembed",
  requireAuth,
  requireRole("admin"),
  async (req, res) => {
    try {
      reembedAllChunks().catch((err) =>
        console.error("Re-embedding failed:", err),
      );
      res.json({ ok: true, message: "Re-embedding started in background" });
    } catch (err: any) {
      console.error("Admin reembed error:", err);
      res.status(500).json({ error: "Failed to start re-embedding" });
    }
  },
);

function formatDocument(d: any) {
  return {
    id: d.id,
    filename: d.filename,
    fileSize: d.fileSize,
    mimeType: d.mimeType,
    storageKey: d.storageKey,
    documentType: d.documentType,
    initiative: d.initiative,
    productPriority: d.productPriority || null,
    timePeriod: d.timePeriod,
    timePeriodDate: d.timePeriodDate,
    status: d.status,
    errorMessage: d.errorMessage,
    version: d.version,
    supersededBy: d.supersededBy,
    isArchived: d.isArchived,
    uploadedBy: d.uploadedBy,
    aiContent: d.aiContent || null,
    createdAt: d.createdAt?.toISOString?.() || d.createdAt,
    updatedAt: d.updatedAt?.toISOString?.() || d.updatedAt,
  };
}

function formatChunk(c: any) {
  return {
    id: c.id,
    documentId: c.documentId,
    content: c.content,
    sectionType: c.sectionType,
    month: c.month,
    initiative: c.initiative,
    sequence: c.sequence,
    embeddingModel: c.embeddingModel,
    tokenCount: c.tokenCount,
    jiraKeys: c.jiraKeys,
    createdAt: c.createdAt?.toISOString?.() || c.createdAt,
  };
}

export default router;
