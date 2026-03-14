import { eq } from "drizzle-orm";
import { db } from "./db.js";
import { documents, documentChunks, roadmapRows } from "./schema.js";
import { downloadFromObjectStorage } from "./kb-storage.js";
import { parseAndChunkDocument } from "./kb-parser.js";
import { generateEmbeddingsBatch, storeChunkEmbeddings } from "./kb-embeddings.js";
import { generateAutoLinks, carryForwardLinks } from "./kb-autolink.js";
import { extractDocumentContent } from "./ai-client.js";

const processingQueue: string[] = [];
let isProcessing = false;

export function enqueueDocument(documentId: string): void {
  processingQueue.push(documentId);
  if (!isProcessing) {
    processNext();
  }
}

async function processNext(): Promise<void> {
  if (processingQueue.length === 0) {
    isProcessing = false;
    return;
  }

  isProcessing = true;
  const docId = processingQueue.shift()!;

  try {
    await processDocument(docId);
  } catch (err) {
    console.error(`Document processing failed for ${docId}:`, err);
  }

  setImmediate(() => processNext());
}

async function processDocument(documentId: string): Promise<void> {
  const [doc] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, documentId));

  if (!doc) {
    console.error(`Document ${documentId} not found`);
    return;
  }

  await db
    .update(documents)
    .set({ status: "processing", errorMessage: null })
    .where(eq(documents.id, documentId));

  try {
    const buffer = await downloadFromObjectStorage(doc.storageKey);

    const chunks = await parseAndChunkDocument(
      buffer,
      doc.mimeType,
      doc.documentType,
      doc.initiative || undefined,
      doc.filename || undefined,
    );

    if (!chunks.length) {
      throw new Error("No chunks extracted from document");
    }

    const insertedChunks: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const [inserted] = await db
        .insert(documentChunks)
        .values({
          documentId,
          content: chunk.content,
          sectionType: chunk.sectionType,
          month: chunk.month,
          initiative: chunk.initiative,
          sequence: i,
          tokenCount: chunk.tokenCount,
          jiraKeys: chunk.jiraKeys,
        })
        .returning({ id: documentChunks.id });
      insertedChunks.push(inserted.id);
    }

    if (process.env.OPENAI_API_KEY) {
      try {
        const texts = chunks.map((c) => c.content);
        const embeddings = await generateEmbeddingsBatch(texts);
        await storeChunkEmbeddings(insertedChunks, embeddings);
      } catch (embErr) {
        console.warn("Embedding generation failed (non-fatal):", embErr);
      }
    }

    // Priority-level docs (2-pagers / briefs) cover a whole priority area — skip investment-level
    // auto-linking. They surface automatically via the productPriority field match instead.
    if (!doc.productPriority) {
      try {
        await generateAutoLinks(documentId, chunks, doc.filename);
      } catch (linkErr) {
        console.warn("Auto-linking failed (non-fatal):", linkErr);
      }
    }

    // Extract structured AI content before marking ready so it's available immediately
    let aiContent = null;
    if (process.env.OPENAI_API_KEY) {
      try {
        const fullText = chunks.map((c) => c.content).join("\n\n");
        aiContent = await extractDocumentContent(fullText, doc.filename || "");
      } catch (extractErr) {
        console.warn("AI content extraction failed (non-fatal):", extractErr);
      }
    }

    await db
      .update(documents)
      .set({ status: "ready", updatedAt: new Date(), ...(aiContent ? { aiContent } : {}) })
      .where(eq(documents.id, documentId));

    // For priority-level briefs: auto-populate expectedBenefits on investments
    // that have none yet. Investments that already have benefits are left untouched.
    if (doc.productPriority && aiContent?.benefits?.length) {
      try {
        const investments = await db
          .select({ id: roadmapRows.id, expectedBenefits: roadmapRows.expectedBenefits })
          .from(roadmapRows)
          .where(eq(roadmapRows.productPriority, doc.productPriority));

        for (const inv of investments) {
          if (!inv.expectedBenefits || inv.expectedBenefits.length === 0) {
            await db
              .update(roadmapRows)
              .set({ expectedBenefits: aiContent.benefits })
              .where(eq(roadmapRows.id, inv.id));
          }
        }
        console.log(`Auto-populated expectedBenefits for ${investments.filter((i) => !i.expectedBenefits?.length).length} investments under "${doc.productPriority}"`);
      } catch (autoApplyErr) {
        console.warn("Auto-populate expectedBenefits failed (non-fatal):", autoApplyErr);
      }
    }

    console.log(
      `Document ${documentId} processed: ${chunks.length} chunks, ${insertedChunks.length} embedded`,
    );
  } catch (err: any) {
    console.error(`Processing error for ${documentId}:`, err);
    await db
      .update(documents)
      .set({
        status: "error",
        errorMessage: err.message || "Processing failed",
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId));
  }
}

export async function reprocessDocument(documentId: string): Promise<void> {
  await db
    .delete(documentChunks)
    .where(eq(documentChunks.documentId, documentId));

  enqueueDocument(documentId);
}

export async function reembedAllChunks(): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY required for re-embedding");
  }

  const allChunks = await db.select({
    id: documentChunks.id,
    content: documentChunks.content,
  }).from(documentChunks);

  const BATCH = 50;
  for (let i = 0; i < allChunks.length; i += BATCH) {
    const batch = allChunks.slice(i, i + BATCH);
    const texts = batch.map((c) => c.content);
    const ids = batch.map((c) => c.id);
    const embeddings = await generateEmbeddingsBatch(texts);
    await storeChunkEmbeddings(ids, embeddings);
    console.log(`Re-embedded chunks ${i + 1} to ${Math.min(i + BATCH, allChunks.length)} of ${allChunks.length}`);
  }
}
