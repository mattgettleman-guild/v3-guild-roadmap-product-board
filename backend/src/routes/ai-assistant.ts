import { Router } from "express";
import multer from "multer";
import { db } from "../lib/db.js";
import { aiThreads, aiMessages, appSettings, aiContextDocuments, roadmapRows, documents, documentChunks } from "../lib/schema.js";
import { eq, desc, asc, sql } from "drizzle-orm";
import { requireAuth, requireRole } from "../lib/auth.js";
import { uploadToObjectStorage } from "../lib/kb-storage.js";

const upload = multer();

const router = Router();

router.get("/threads", requireAuth, async (req, res) => {
  try {
    const threads = await db
      .select()
      .from(aiThreads)
      .orderBy(desc(aiThreads.updatedAt));
    res.json(threads);
  } catch (err) {
    console.error("GET /threads error:", err);
    res.status(500).json({ error: "Failed to list threads" });
  }
});

router.post("/threads", requireAuth, async (req, res) => {
  try {
    const { title, contextType, contextId, contextLabel } = req.body;
    const [thread] = await db
      .insert(aiThreads)
      .values({
        title: title || "New conversation",
        createdBy: req.user?.email || "unknown",
        contextType: contextType || null,
        contextId: contextId || null,
        contextLabel: contextLabel || null,
      })
      .returning();
    res.json(thread);
  } catch (err) {
    console.error("POST /threads error:", err);
    res.status(500).json({ error: "Failed to create thread" });
  }
});

router.patch("/threads/:id", requireAuth, async (req, res) => {
  try {
    const { title } = req.body;
    const [thread] = await db
      .update(aiThreads)
      .set({ title, updatedAt: new Date() })
      .where(eq(aiThreads.id, req.params.id as string))
      .returning();
    if (!thread) return res.status(404).json({ error: "Thread not found" });
    res.json(thread);
  } catch (err) {
    console.error("PATCH /threads/:id error:", err);
    res.status(500).json({ error: "Failed to update thread" });
  }
});

router.delete("/threads/:id", requireAuth, async (req, res) => {
  try {
    await db.delete(aiThreads).where(eq(aiThreads.id, req.params.id as string));
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /threads/:id error:", err);
    res.status(500).json({ error: "Failed to delete thread" });
  }
});

router.get("/threads/:id/messages", requireAuth, async (req, res) => {
  try {
    const messages = await db
      .select()
      .from(aiMessages)
      .where(eq(aiMessages.threadId, req.params.id as string))
      .orderBy(asc(aiMessages.createdAt));
    res.json(messages);
  } catch (err) {
    console.error("GET /threads/:id/messages error:", err);
    res.status(500).json({ error: "Failed to list messages" });
  }
});

router.post("/threads/:id/messages", requireAuth, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content || typeof content !== "string") {
      return res.status(400).json({ error: "content is required" });
    }

    const threadId = req.params.id as string;
    const userEmail = req.user?.email || "unknown";

    const [thread] = await db.select().from(aiThreads).where(eq(aiThreads.id, threadId));
    if (!thread) return res.status(404).json({ error: "Thread not found" });

    const [userMsg] = await db
      .insert(aiMessages)
      .values({ threadId, role: "user", content, createdBy: userEmail })
      .returning();

    const priorMessages = await db
      .select({ role: aiMessages.role, content: aiMessages.content })
      .from(aiMessages)
      .where(eq(aiMessages.threadId, threadId))
      .orderBy(asc(aiMessages.createdAt));

    const { generateAssistantReply } = await import("../lib/ai-assistant.js");

    const reply = await generateAssistantReply(priorMessages, {
      contextType: thread.contextType || undefined,
      contextId: thread.contextId || undefined,
      contextLabel: thread.contextLabel || undefined,
    });

    const [assistantMsg] = await db
      .insert(aiMessages)
      .values({
        threadId,
        role: "assistant",
        content: reply.content,
        citations: reply.citations || [],
        metadata: reply.metadata || {},
        createdBy: "assistant",
      })
      .returning();

    const isFirstExchange = priorMessages.length <= 2;
    if (isFirstExchange && thread.title === "New conversation") {
      const autoTitle = content.length > 60 ? content.slice(0, 57) + "..." : content;
      await db
        .update(aiThreads)
        .set({ title: autoTitle, updatedAt: new Date() })
        .where(eq(aiThreads.id, threadId));
    } else {
      await db
        .update(aiThreads)
        .set({ updatedAt: new Date() })
        .where(eq(aiThreads.id, threadId));
    }

    res.json({ userMessage: userMsg, assistantMessage: assistantMsg });
  } catch (err: any) {
    console.error("POST /threads/:id/messages error:", err);
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("OPENAI_API_KEY")) {
      return res.status(503).json({ error: "AI features are not configured", aiUnavailable: true });
    }
    res.status(500).json({ error: "Failed to send message" });
  }
});

router.get("/settings/instructions", requireAuth, async (_req, res) => {
  try {
    const [settings] = await db.select().from(appSettings).where(eq(appSettings.id, 1));
    res.json({ aiCustomInstructions: settings?.aiCustomInstructions || "" });
  } catch (err) {
    console.error("GET /settings/instructions error:", err);
    res.status(500).json({ error: "Failed to get instructions" });
  }
});

router.put("/settings/instructions", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    const { aiCustomInstructions } = req.body;
    if (typeof aiCustomInstructions !== "string") {
      return res.status(400).json({ error: "aiCustomInstructions must be a string" });
    }
    await db
      .update(appSettings)
      .set({
        aiCustomInstructions,
        updatedBy: req.user?.email || "unknown",
        updatedAt: new Date(),
      })
      .where(eq(appSettings.id, 1));
    res.json({ ok: true });
  } catch (err) {
    console.error("PUT /settings/instructions error:", err);
    res.status(500).json({ error: "Failed to save instructions" });
  }
});

router.get("/context-documents", requireAuth, async (_req, res) => {
  try {
    const docs = await db
      .select()
      .from(aiContextDocuments)
      .orderBy(desc(aiContextDocuments.createdAt));
    const sanitized = docs.map((d) => ({
      id: d.id,
      filename: d.filename,
      fileSize: d.fileSize,
      mimeType: d.mimeType,
      status: d.status,
      errorMessage: d.errorMessage,
      uploadedBy: d.uploadedBy,
      createdAt: d.createdAt,
      textLength: d.extractedText?.length || 0,
    }));
    res.json(sanitized);
  } catch (err) {
    console.error("GET /context-documents error:", err);
    res.status(500).json({ error: "Failed to list context documents" });
  }
});

router.post("/context-documents", requireAuth, requireRole("admin"), upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No file uploaded" });

    const allowedTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
      "text/markdown",
    ];
    if (!allowedTypes.includes(file.mimetype) && !file.originalname.match(/\.(pdf|docx|txt|md)$/i)) {
      return res.status(400).json({ error: "Only PDF, DOCX, TXT, and MD files are supported" });
    }

    const storageKey = await uploadToObjectStorage(file.buffer, file.originalname, file.mimetype);

    const [doc] = await db
      .insert(aiContextDocuments)
      .values({
        filename: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        storageKey,
        uploadedBy: req.user?.email || "unknown",
        status: "processing",
      })
      .returning();

    processContextDocument(doc.id, file.buffer, file.originalname, file.mimetype);

    res.json({
      id: doc.id,
      filename: doc.filename,
      fileSize: doc.fileSize,
      mimeType: doc.mimeType,
      status: doc.status,
      uploadedBy: doc.uploadedBy,
      createdAt: doc.createdAt,
      textLength: 0,
    });
  } catch (err) {
    console.error("POST /context-documents error:", err);
    res.status(500).json({ error: "Failed to upload context document" });
  }
});

router.delete("/context-documents/:id", requireAuth, requireRole("admin"), async (req, res) => {
  try {
    await db.delete(aiContextDocuments).where(eq(aiContextDocuments.id, req.params.id as string));
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /context-documents/:id error:", err);
    res.status(500).json({ error: "Failed to delete context document" });
  }
});

async function processContextDocument(id: string, buffer: Buffer, filename: string, mimeType: string) {
  try {
    let text = "";

    if (mimeType === "application/pdf" || filename.endsWith(".pdf")) {
      const { extractTextFromPDF } = await import("../lib/kb-parser.js");
      text = await extractTextFromPDF(buffer);
    } else if (
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      filename.endsWith(".docx")
    ) {
      const { extractTextFromDOCX } = await import("../lib/kb-parser.js");
      text = await extractTextFromDOCX(buffer);
    } else {
      text = buffer.toString("utf-8");
    }

    await db
      .update(aiContextDocuments)
      .set({ extractedText: text, status: "ready" })
      .where(eq(aiContextDocuments.id, id));

    console.log(`AI context document processed: ${filename} (${text.length} chars)`);
  } catch (err: any) {
    console.error(`Failed to process AI context document ${filename}:`, err);
    await db
      .update(aiContextDocuments)
      .set({ status: "error", errorMessage: err?.message || "Processing failed" })
      .where(eq(aiContextDocuments.id, id));
  }
}

export default router;
