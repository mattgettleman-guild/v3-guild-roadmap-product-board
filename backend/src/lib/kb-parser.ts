import OpenAI from "openai";
import { buildFiscalYearPromptHint, correctMonthYear } from "./kb-time-parser.js";

const JIRA_KEY_REGEX = /\b[A-Z]{2,10}-\d+\b/g;
const MAX_CHUNK_TOKENS = 1000;
const TARGET_CHUNK_TOKENS = 650;
const OVERLAP_TOKENS = 80;
const LIGHTWEIGHT_MODEL = "gpt-4o-mini";

export interface ParsedChunk {
  content: string;
  sectionType?: string;
  month?: string;
  initiative?: string;
  jiraKeys: string[];
  tokenCount: number;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function extractJiraKeys(text: string): string[] {
  const matches = text.match(JIRA_KEY_REGEX);
  return matches ? [...new Set(matches)] : [];
}

export async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(buffer);
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;
  const pages: string[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item: any) => ("str" in item ? item.str : ""))
      .join(" ");
    pages.push(text);
  }

  return pages.join("\n\n");
}

export async function extractTextFromDOCX(buffer: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

function chunkByParagraphs(text: string, initiative?: string): ParsedChunk[] {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 10);
  const chunks: ParsedChunk[] = [];
  let currentChunk = "";

  for (const para of paragraphs) {
    const combined = currentChunk ? `${currentChunk}\n\n${para}` : para;
    const tokens = estimateTokens(combined);

    if (tokens > MAX_CHUNK_TOKENS && currentChunk) {
      const jiraKeys = extractJiraKeys(currentChunk);
      chunks.push({
        content: currentChunk.trim(),
        sectionType: "general",
        initiative,
        jiraKeys,
        tokenCount: estimateTokens(currentChunk),
      });

      const words = currentChunk.split(/\s+/);
      const overlapWords = words.slice(-Math.ceil(OVERLAP_TOKENS));
      currentChunk = overlapWords.join(" ") + "\n\n" + para;
    } else {
      currentChunk = combined;
    }
  }

  if (currentChunk.trim()) {
    chunks.push({
      content: currentChunk.trim(),
      sectionType: "general",
      initiative,
      jiraKeys: extractJiraKeys(currentChunk),
      tokenCount: estimateTokens(currentChunk),
    });
  }

  return splitOversizedChunks(chunks, true);
}

function splitOversizedChunks(chunks: ParsedChunk[], addOverlap = false): ParsedChunk[] {
  const result: ParsedChunk[] = [];
  for (const chunk of chunks) {
    if (chunk.tokenCount <= MAX_CHUNK_TOKENS) {
      result.push(chunk);
    } else {
      const words = chunk.content.split(/\s+/);
      const wordsPerChunk = Math.ceil(TARGET_CHUNK_TOKENS);
      const overlapCount = addOverlap ? Math.ceil(OVERLAP_TOKENS / 1.5) : 0;
      for (let i = 0; i < words.length; i += wordsPerChunk) {
        const slice = words.slice(i, i + wordsPerChunk + overlapCount);
        const text = slice.join(" ");
        result.push({
          content: text,
          sectionType: chunk.sectionType,
          month: chunk.month,
          initiative: chunk.initiative,
          jiraKeys: extractJiraKeys(text),
          tokenCount: estimateTokens(text),
        });
      }
    }
  }
  return result;
}

export async function chunkWithAIStructure(
  text: string,
  documentType: string,
  initiative?: string,
  filename?: string,
): Promise<ParsedChunk[]> {
  if (!process.env.OPENAI_API_KEY) {
    console.warn("No OPENAI_API_KEY, falling back to paragraph chunking");
    return chunkByParagraphs(text, initiative);
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const truncatedText = text.slice(0, 30000);

    const fyHint = filename ? buildFiscalYearPromptHint(filename, truncatedText) : "";

    const prompt =
      documentType === "por"
        ? `Analyze this POR (Product Operating Review) deck text. Return a JSON array of sections. Each section should have: "month" (e.g. "February 2025"), "section_type" (one of: metrics, what_we_did, whats_next, risks, releases, roadmap), and "text" (the section content). Group content by month and section type.${fyHint ? ` ${fyHint}` : ""} Return ONLY valid JSON.`
        : documentType === "brief" || documentType === "product_brief" || documentType === "gtm_brief"
        ? `Analyze this product strategy brief or 2-pager document. Return a JSON array of sections. Each section should have: "section_type" (one of: commercial_why, from_to_table, sell_today, sell_into, vision, delivery_phases, general), and "text" (the section content). Split on logical document sections — "The Commercial Why", "From/To/Commercial Impact" table, "What you can sell today", "What you can sell into", delivery phase tables, etc. Return ONLY valid JSON.`
        : documentType === "release_announcement"
        ? `Analyze this release announcement text. Return a JSON array of entries. Each entry should have: "date" (the announcement date), "section_type" ("releases"), "feature_name" (extracted from header), and "text" (the announcement content).${fyHint ? ` ${fyHint}` : ""} Return ONLY valid JSON.`
        : documentType === "recap"
        ? `Analyze this monthly recap or update document. Return a JSON array of sections. Each section should have: "month" (e.g. "February 2025" if identifiable), "section_type" (one of: highlights, metrics, shipped, in_progress, blockers, next_steps, general), and "text" (the section content).${fyHint ? ` ${fyHint}` : ""} Return ONLY valid JSON.`
        : `Analyze this document and split it into logical sections. Return a JSON array of sections. Each section should have: "section_type" (a short descriptive label for the section, e.g. "overview", "requirements", "goals", "background", "details", "general"), and "text" (the section content). Use the document's own headings and structure to guide the splits. Return ONLY valid JSON.`;

    const response = await client.chat.completions.create({
      model: LIGHTWEIGHT_MODEL,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: truncatedText },
      ],
      temperature: 0.1,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content;
    if (!raw) throw new Error("Empty AI response");

    const parsed = JSON.parse(raw);
    const sections: Array<{ month?: string; date?: string; section_type?: string; text?: string; feature_name?: string }> =
      Array.isArray(parsed) ? parsed : parsed.sections || parsed.entries || [];

    if (!sections.length) {
      return chunkByParagraphs(text, initiative);
    }

    return splitOversizedChunks(
      sections.map((s) => ({
        content: (s.text || "").trim(),
        sectionType: s.section_type || "general",
        month: correctMonthYear(s.month || s.date, filename || "", truncatedText),
        initiative: initiative,
        jiraKeys: extractJiraKeys(s.text || ""),
        tokenCount: estimateTokens(s.text || ""),
      })).filter((c) => c.content.length > 20),
    );
  } catch (err) {
    console.error("AI structure detection failed, falling back to paragraph chunking:", err);
    return chunkByParagraphs(text, initiative);
  }
}

export function chunkStrategyDoc(text: string): ParsedChunk[] {
  const headerRegex = /^(?:#{1,3}\s+|\d+\.\s+|[A-Z][A-Za-z\s]+:)/gm;
  const sections: string[] = [];
  let lastIndex = 0;
  let match;

  const allMatches: { index: number; header: string }[] = [];
  while ((match = headerRegex.exec(text)) !== null) {
    allMatches.push({ index: match.index, header: match[0] });
  }

  if (allMatches.length < 2) {
    return chunkByParagraphs(text);
  }

  for (let i = 0; i < allMatches.length; i++) {
    const end = i + 1 < allMatches.length ? allMatches[i + 1].index : text.length;
    sections.push(text.slice(allMatches[i].index, end));
  }

  return splitOversizedChunks(
    sections
      .filter((s) => s.trim().length > 20)
      .map((s) => ({
        content: s.trim(),
        sectionType: "general",
        jiraKeys: extractJiraKeys(s),
        tokenCount: estimateTokens(s),
      })),
  );
}

export async function parseAndChunkDocument(
  buffer: Buffer,
  mimeType: string,
  documentType: string,
  initiative?: string,
  filename?: string,
): Promise<ParsedChunk[]> {
  let rawText: string;

  if (mimeType === "application/pdf") {
    rawText = await extractTextFromPDF(buffer);
  } else if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword"
  ) {
    rawText = await extractTextFromDOCX(buffer);
  } else {
    rawText = buffer.toString("utf-8");
  }

  if (!rawText || rawText.trim().length < 20) {
    throw new Error("Document contains no extractable text");
  }

  return chunkWithAIStructure(rawText, documentType, initiative, filename);
}
