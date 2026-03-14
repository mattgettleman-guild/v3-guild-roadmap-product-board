import OpenAI from "openai";
import { pool } from "./db.js";
import { computeRecencyWeight } from "./kb-time-parser.js";

const EMBEDDING_MODEL = "text-embedding-3-small";
const BATCH_SIZE = 50;
const MIN_SIMILARITY_THRESHOLD = 0.75;
const MAX_CONTEXT_TOKENS = 6000;

function getClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const client = getClient();
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text.slice(0, 8000),
  });
  return response.data[0].embedding;
}

export async function generateEmbeddingsBatch(
  texts: string[],
): Promise<number[][]> {
  const client = getClient();
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE).map((t) => t.slice(0, 8000));

    try {
      const response = await client.embeddings.create({
        model: EMBEDDING_MODEL,
        input: batch,
      });
      for (const item of response.data) {
        results.push(item.embedding);
      }
    } catch (err: any) {
      if (err?.status === 429) {
        console.warn("Rate limited on embeddings, waiting 5s...");
        await new Promise((r) => setTimeout(r, 5000));
        i -= BATCH_SIZE;
        continue;
      }
      throw err;
    }
  }

  return results;
}

export async function storeChunkEmbeddings(
  chunkIds: string[],
  embeddings: number[][],
): Promise<void> {
  const client = await pool.connect();
  try {
    for (let i = 0; i < chunkIds.length; i++) {
      const vectorStr = `[${embeddings[i].join(",")}]`;
      await client.query(
        `UPDATE document_chunks SET embedding = $1::vector, embedding_model = $2 WHERE id = $3`,
        [vectorStr, EMBEDDING_MODEL, chunkIds[i]],
      );
    }
  } finally {
    client.release();
  }
}

export interface SimilaritySearchOptions {
  query: string;
  limit?: number;
  documentType?: string;
  initiative?: string;
  includeArchived?: boolean;
  periodStart?: string;
  periodEnd?: string;
}

export interface SimilarityResult {
  chunkId: string;
  documentId: string;
  content: string;
  sectionType: string | null;
  month: string | null;
  chunkInitiative: string | null;
  jiraKeys: string[];
  tokenCount: number | null;
  similarity: number;
  filename: string;
  documentType: string;
  docInitiative: string | null;
  timePeriod: string | null;
  timePeriodDate: string | null;
  combinedScore: number;
}

export async function searchSimilarChunks(
  options: SimilaritySearchOptions,
): Promise<SimilarityResult[]> {
  const queryEmbedding = await generateEmbedding(options.query);
  const vectorStr = `[${queryEmbedding.join(",")}]`;
  const limit = Math.min(options.limit || 10, 50);

  let whereClause = "WHERE dc.embedding IS NOT NULL";
  const params: any[] = [vectorStr, limit * 3];
  let paramIndex = 3;

  if (!options.includeArchived) {
    whereClause += " AND d.is_archived = false";
  }

  if (options.documentType) {
    whereClause += ` AND d.document_type = $${paramIndex}`;
    params.push(options.documentType);
    paramIndex++;
  }

  if (options.initiative) {
    whereClause += ` AND (d.initiative = $${paramIndex} OR dc.initiative = $${paramIndex})`;
    params.push(options.initiative);
    paramIndex++;
  }

  if (options.periodStart) {
    whereClause += ` AND d.time_period_date >= $${paramIndex}::date`;
    params.push(options.periodStart);
    paramIndex++;
  }

  if (options.periodEnd) {
    whereClause += ` AND d.time_period_date <= $${paramIndex}::date`;
    params.push(options.periodEnd);
    paramIndex++;
  }

  const sql = `
    SELECT 
      dc.id as chunk_id,
      dc.document_id,
      dc.content,
      dc.section_type,
      dc.month,
      dc.initiative as chunk_initiative,
      dc.jira_keys,
      dc.token_count,
      1 - (dc.embedding <=> $1::vector) as similarity,
      d.filename,
      d.document_type,
      d.initiative as doc_initiative,
      d.time_period,
      d.time_period_date
    FROM document_chunks dc
    JOIN documents d ON dc.document_id = d.id
    ${whereClause}
    ORDER BY dc.embedding <=> $1::vector ASC
    LIMIT $2
  `;

  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);

    const scored: SimilarityResult[] = result.rows
      .filter((r: any) => r.similarity >= MIN_SIMILARITY_THRESHOLD)
      .map((r: any) => {
        const recencyWeight = computeRecencyWeight(r.time_period_date);
        const combinedScore = r.similarity * 0.8 + recencyWeight * 0.2;
        return {
          chunkId: r.chunk_id,
          documentId: r.document_id,
          content: r.content,
          sectionType: r.section_type,
          month: r.month,
          chunkInitiative: r.chunk_initiative,
          jiraKeys: r.jira_keys || [],
          tokenCount: r.token_count,
          similarity: r.similarity,
          filename: r.filename,
          documentType: r.document_type,
          docInitiative: r.doc_initiative,
          timePeriod: r.time_period,
          timePeriodDate: r.time_period_date,
          combinedScore,
        };
      });

    scored.sort((a, b) => b.combinedScore - a.combinedScore);

    let tokenBudget = MAX_CONTEXT_TOKENS;
    const trimmed: SimilarityResult[] = [];
    for (const item of scored) {
      const tokens = item.tokenCount || Math.ceil(item.content.length / 4);
      if (tokenBudget - tokens < 0 && trimmed.length > 0) break;
      tokenBudget -= tokens;
      trimmed.push(item);
    }

    return trimmed.slice(0, limit);
  } finally {
    client.release();
  }
}
