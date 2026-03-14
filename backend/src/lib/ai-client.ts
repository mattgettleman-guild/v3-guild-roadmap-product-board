import OpenAI from "openai";
import type { RoadmapRow, MetricDefinition } from "@roadmap/shared";
import { correctMonthYear, buildFiscalYearPromptHint } from "./kb-time-parser.js";

// the newest OpenAI model is "gpt-5" which was released August 7, 2025. do not change this unless explicitly requested by the user
const MODEL = "gpt-5";
const MODEL_MINI = "gpt-4o-mini";

function getClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set. Please configure the OpenAI API key to use AI features.");
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export async function askRoadmapQuestion(
  question: string,
  context: { rows: RoadmapRow[]; metrics: MetricDefinition[] },
  pageContext?: { contextKey?: string; label?: string; summary?: string },
): Promise<{ answer: string; citations: string[] }> {
  try {
    const client = getClient();

    const rowsSummary = context.rows.map((r) => ({
      id: r.id,
      investment: r.investment,
      pillar: r.strategicPillar,
      priority: r.productPriority,
      domain: r.domain,
      owners: r.owners,
      tactics: r.tactics.map((t) => t.name),
      jiraKeys: r.jiraLinks.map((l) => l.key),
      timeline: r.timeline,
    }));

    const metricsSummary = context.metrics.map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      unit: m.unit,
      targetValue: m.targetValue,
      direction: m.direction,
      active: m.active,
    }));

    const response = await client.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 2048,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are an executive roadmap assistant. You answer questions about a product roadmap, citing specific investments, strategic pillars, priorities, domains, owners, and metrics.
${pageContext?.contextKey ? `\nThe user is currently viewing the "${pageContext.label}" page. Context: ${pageContext.summary}. Tailor your response to be relevant to what they're looking at.` : ""}
Respond with JSON: { "answer": "your detailed answer", "citations": ["investment name or pillar or metric referenced"] }

The citations array should contain the names of specific investments, pillars, or metrics you reference in your answer.`,
        },
        {
          role: "user",
          content: `Roadmap data:\n${JSON.stringify(rowsSummary, null, 2)}\n\nMetrics:\n${JSON.stringify(metricsSummary, null, 2)}\n\nQuestion: ${question}`,
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    const refusal = response.choices[0]?.message?.refusal;
    const finishReason = response.choices[0]?.finish_reason;

    if (refusal) {
      console.error("askRoadmapQuestion refusal:", refusal);
      return { answer: "The AI was unable to answer this question. Please try rephrasing.", citations: [] };
    }

    if (!content) {
      console.error("askRoadmapQuestion empty content. finish_reason:", finishReason,
        "usage:", JSON.stringify(response.usage));
      return { answer: "The AI returned an empty response. Please try again or rephrase your question.", citations: [] };
    }

    let parsed: { answer: string; citations: string[] };
    try {
      parsed = JSON.parse(content);
    } catch {
      console.error("askRoadmapQuestion JSON parse error:", content.slice(0, 500));
      return { answer: content, citations: [] };
    }

    return {
      answer: parsed.answer || "No answer provided.",
      citations: Array.isArray(parsed.citations) ? parsed.citations : [],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("OPENAI_API_KEY")) {
      return { answer: message, citations: [] };
    }
    console.error("askRoadmapQuestion error:", message);
    return { answer: `Something went wrong while processing your question. Please try again.`, citations: [] };
  }
}

export async function suggestJiraLinks(
  investment: { name: string; pillar: string; priority: string; domain: string },
  availableIssues: { key: string; summary: string; type: string }[],
): Promise<Array<{ key: string; summary: string; confidence: number; reason: string }>> {
  try {
    const client = getClient();

    if (availableIssues.length === 0) {
      return [];
    }

    const MAX_ISSUES = 200;
    const cappedIssues = availableIssues.slice(0, MAX_ISSUES);
    if (availableIssues.length > MAX_ISSUES) {
      console.warn(`suggestJiraLinks: capped from ${availableIssues.length} to ${MAX_ISSUES} issues`);
    }

    const response = await client.chat.completions.create({
      model: MODEL_MINI,
      max_completion_tokens: 2048,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are an assistant that matches roadmap investments to Jira issues. Given an investment and a list of available Jira issues, return the top 5 most relevant issues with confidence scores (0-1) and a brief reason for the match.

Respond with JSON: { "suggestions": [{ "key": "ISSUE-123", "summary": "issue summary", "confidence": 0.85, "reason": "brief reason" }] }

Rank by relevance. Only include issues with meaningful relevance.`,
        },
        {
          role: "user",
          content: `Investment: ${JSON.stringify(investment)}\n\nAvailable Jira Issues:\n${JSON.stringify(cappedIssues, null, 2)}`,
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return [];

    const parsed = JSON.parse(content) as { suggestions: Array<{ key: string; summary: string; confidence: number; reason: string }> };
    return Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 5) : [];
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("OPENAI_API_KEY")) {
      throw new Error(message);
    }
    console.error("suggestJiraLinks error:", message);
    throw new Error(`AI error: ${message}`);
  }
}

export async function autoCategorize(
  items: Array<{ name: string; description?: string }>,
  existingCategories: { pillars: string[]; priorities: string[]; domains: string[] },
): Promise<Array<{ name: string; pillar: string; priority: string; domain: string }>> {
  try {
    const client = getClient();

    const response = await client.chat.completions.create({
      model: MODEL_MINI,
      max_completion_tokens: 2048,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are an assistant that categorizes roadmap items into existing organizational categories. For each item, suggest the best matching pillar, priority, and domain from the provided existing categories.

Respond with JSON: { "categorized": [{ "name": "item name", "pillar": "suggested pillar", "priority": "suggested priority", "domain": "suggested domain" }] }

Use only values from the existing categories. If no good match exists, use the closest match.`,
        },
        {
          role: "user",
          content: `Items to categorize:\n${JSON.stringify(items, null, 2)}\n\nExisting categories:\n${JSON.stringify(existingCategories, null, 2)}`,
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return [];

    const parsed = JSON.parse(content) as { categorized: Array<{ name: string; pillar: string; priority: string; domain: string }> };
    return Array.isArray(parsed.categorized) ? parsed.categorized : [];
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("OPENAI_API_KEY")) {
      throw new Error(message);
    }
    console.error("autoCategorize error:", message);
    throw new Error(`AI error: ${message}`);
  }
}

export async function detectDuplicates(
  newItem: { name: string; pillar?: string; priority?: string },
  existingItems: Array<{ id: string; name: string; pillar: string; priority: string }>,
): Promise<Array<{ id: string; name: string; similarity: number; reason: string }>> {
  try {
    const client = getClient();

    if (existingItems.length === 0) {
      return [];
    }

    const response = await client.chat.completions.create({
      model: MODEL_MINI,
      max_completion_tokens: 2048,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are an assistant that detects duplicate or very similar roadmap items. Given a new item and a list of existing items, identify potential duplicates with a similarity score (0-1) and a brief reason.

Only return items with similarity above 0.6.

Respond with JSON: { "duplicates": [{ "id": "existing-item-id", "name": "existing item name", "similarity": 0.85, "reason": "brief reason for similarity" }] }`,
        },
        {
          role: "user",
          content: `New item: ${JSON.stringify(newItem)}\n\nExisting items:\n${JSON.stringify(existingItems, null, 2)}`,
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return [];

    const parsed = JSON.parse(content) as { duplicates: Array<{ id: string; name: string; similarity: number; reason: string }> };
    const results = Array.isArray(parsed.duplicates) ? parsed.duplicates : [];
    return results.filter((d) => d.similarity >= 0.6);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("OPENAI_API_KEY")) {
      throw new Error(message);
    }
    console.error("detectDuplicates error:", message);
    throw new Error(`AI error: ${message}`);
  }
}

export interface SummaryContext {
  rows: Array<{
    id: string;
    investment: string;
    pillar: string;
    priority: string;
    domain: string;
    owners: string;
    tactics: Array<{ name: string; status?: string; jiraLinks: Array<{ key: string; title: string; jiraAttributes?: { status?: string } }> }>;
    jiraLinks: Array<{ key: string; title: string; jiraAttributes?: { status?: string } }>;
    timeline?: { start: string; end: string };
  }>;
  metrics?: Array<{ name: string; description?: string; unit?: string; targetValue?: number; direction: string }>;
}

export async function generateExecutiveSummary(
  scope: { type: "pillar" | "priority"; name: string },
  context: SummaryContext,
  options: { tone?: "concise" | "detailed"; audience?: "internal" | "board" } = {},
): Promise<{ summary: string; highlights: string[]; risks: string[] }> {
  try {
    const client = getClient();
    const tone = options.tone || "concise";
    const audience = options.audience || "internal";

    const rowData = context.rows.map((r) => ({
      investment: r.investment,
      pillar: r.pillar,
      priority: r.priority,
      domain: r.domain,
      owners: r.owners,
      tacticCount: r.tactics.length,
      tactics: r.tactics.map((t) => ({
        name: t.name,
        status: t.status || "Unknown",
        linkedIssues: t.jiraLinks.length,
        issueStatuses: t.jiraLinks.map((l) => l.jiraAttributes?.status).filter(Boolean),
      })),
      jiraLinkCount: r.jiraLinks.length,
      jiraStatuses: r.jiraLinks.map((l) => l.jiraAttributes?.status).filter(Boolean),
      timeline: r.timeline,
    }));

    const response = await client.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 4096,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are an executive communications specialist generating ${audience === "board" ? "board-level" : "internal"} summaries for product roadmaps.

Write a ${tone === "detailed" ? "comprehensive, detailed" : "concise, high-level"} executive summary for the ${scope.type} "${scope.name}".

Respond with JSON: {
  "summary": "A well-written narrative paragraph (or two for detailed) summarizing the strategic direction, progress, and outlook",
  "highlights": ["Key accomplishment or positive trend 1", "Key accomplishment 2", ...],
  "risks": ["Risk or concern 1", "Risk or concern 2", ...]
}

Guidelines:
- Use confident, executive-appropriate language
- Reference specific investments and metrics by name
- Quantify progress where possible (e.g., "3 of 5 investments on track")
- Highlights should be concrete achievements or positive signals
- Risks should be actionable concerns, not generic warnings
- For board audience: more strategic framing, less tactical detail
- For internal audience: include tactical specifics and team references`,
        },
        {
          role: "user",
          content: `${scope.type === "pillar" ? "Strategic Pillar" : "Product Priority"}: "${scope.name}"\n\nInvestments under this ${scope.type}:\n${JSON.stringify(rowData, null, 2)}${context.metrics ? `\n\nRelated Metrics:\n${JSON.stringify(context.metrics, null, 2)}` : ""}`,
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return { summary: "No summary generated.", highlights: [], risks: [] };
    }

    const parsed = JSON.parse(content) as { summary: string; highlights: string[]; risks: string[] };
    return {
      summary: parsed.summary || "No summary generated.",
      highlights: Array.isArray(parsed.highlights) ? parsed.highlights : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks : [],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("OPENAI_API_KEY")) throw new Error(message);
    console.error("generateExecutiveSummary error:", message);
    throw new Error(`AI error: ${message}`);
  }
}

export async function generateInvestmentWriteup(
  investment: {
    name: string;
    pillar: string;
    priority: string;
    domain: string;
    owners: string;
    tactics: Array<{ name: string; status?: string; jiraLinks: Array<{ key: string; title: string; jiraAttributes?: { status?: string } }> }>;
    jiraLinks: Array<{ key: string; title: string; jiraAttributes?: { status?: string } }>;
    timeline?: { start: string; end: string };
    relatedDocuments?: Array<{ filename: string; documentType: string; timePeriod?: string; excerpts: string[] }>;
  },
  options: { tone?: "concise" | "detailed" } = {},
): Promise<{ writeup: string; status: string; completionEstimate: string; documentsCited: string[] }> {
  try {
    const client = getClient();
    const tone = options.tone || "concise";

    const tacticData = investment.tactics.map((t) => ({
      name: t.name,
      status: t.status || "Unknown",
      linkedIssues: t.jiraLinks.map((l) => ({
        key: l.key,
        summary: l.title,
        status: l.jiraAttributes?.status || "Unknown",
      })),
    }));

    const jiraData = investment.jiraLinks.map((l) => ({
      key: l.key,
      summary: l.title,
      status: l.jiraAttributes?.status || "Unknown",
    }));

    const docs = investment.relatedDocuments || [];
    const docsSection = docs.length > 0
      ? `\n\nRelated Knowledge Base Documents (${docs.length}):\n${docs.map((d) =>
          `--- ${d.filename} [${d.documentType}]${d.timePeriod ? ` (${d.timePeriod})` : ""} ---\n${d.excerpts.join("\n\n")}`
        ).join("\n\n")}`
      : "";

    const docsGuideline = docs.length > 0
      ? `\n- Reference insights from linked Knowledge Base documents when relevant (POR decks, strategy docs, etc.)
- Include a "documentsCited" array listing filenames of docs you referenced in the write-up`
      : "";

    const response = await client.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 2048,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are an executive communications specialist generating investment status write-ups.

Write a ${tone === "detailed" ? "detailed" : "concise"} status update for the investment "${investment.name}".

Respond with JSON: {
  "writeup": "A paragraph summarizing where this investment stands — what's been done, what's in progress, and what's ahead",
  "status": "On Track | At Risk | Behind | Complete",
  "completionEstimate": "Brief estimate like '~75% complete' or 'Expected Q2 2026'",
  "documentsCited": ["filename1.pdf", "filename2.docx"]
}

Guidelines:
- Pull from tactic completion, Jira issue statuses, and timeline data
- Be specific about what's done and what remains
- Use confident, professional language suitable for stakeholder updates
- The status should reflect the overall health based on the data${docsGuideline}`,
        },
        {
          role: "user",
          content: `Investment: "${investment.name}"
Pillar: ${investment.pillar}
Priority: ${investment.priority}
Domain: ${investment.domain}
Owners: ${investment.owners}
Timeline: ${investment.timeline ? `${investment.timeline.start} to ${investment.timeline.end}` : "Not set"}

Tactics (${tacticData.length}):
${JSON.stringify(tacticData, null, 2)}

Direct Jira Links (${jiraData.length}):
${JSON.stringify(jiraData, null, 2)}${docsSection}`,
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    const refusal = response.choices[0]?.message?.refusal;
    const finishReason = response.choices[0]?.finish_reason;

    if (refusal) {
      console.error("generateInvestmentWriteup refusal:", refusal);
      throw new Error("AI declined to generate write-up. Please try again.");
    }

    if (!content) {
      console.error("generateInvestmentWriteup empty content. finish_reason:", finishReason,
        "usage:", JSON.stringify(response.usage));
      throw new Error("AI returned empty response. The prompt may be too large — try removing some linked documents.");
    }

    let parsed: { writeup: string; status: string; completionEstimate: string; documentsCited?: string[] };
    try {
      parsed = JSON.parse(content);
    } catch (parseErr) {
      console.error("generateInvestmentWriteup JSON parse error:", content.slice(0, 500));
      throw new Error("AI returned invalid response format. Please try again.");
    }

    return {
      writeup: parsed.writeup || "No write-up generated.",
      status: parsed.status || "Unknown",
      completionEstimate: parsed.completionEstimate || "Unknown",
      documentsCited: parsed.documentsCited || [],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("OPENAI_API_KEY")) throw new Error(message);
    console.error("generateInvestmentWriteup error:", message);
    throw new Error(`AI error: ${message}`);
  }
}

export async function generateQuarterlyReport(
  context: SummaryContext,
  options: { quarter?: string; audience?: "internal" | "board" } = {},
): Promise<{ report: string; sections: Array<{ title: string; content: string }>; keyMetrics: string[] }> {
  try {
    const client = getClient();
    const audience = options.audience || "internal";
    const quarter = options.quarter || "Current Quarter";

    const portfolioData = context.rows.map((r) => ({
      investment: r.investment,
      pillar: r.pillar,
      priority: r.priority,
      domain: r.domain,
      owners: r.owners,
      tacticCount: r.tactics.length,
      completedTactics: r.tactics.filter((t) => t.status === "Completed" || t.status === "Done").length,
      jiraLinkCount: r.jiraLinks.length,
      jiraStatuses: r.jiraLinks.map((l) => l.jiraAttributes?.status).filter(Boolean),
      timeline: r.timeline,
    }));

    const pillarGroups: Record<string, number> = {};
    context.rows.forEach((r) => {
      pillarGroups[r.pillar] = (pillarGroups[r.pillar] || 0) + 1;
    });

    const response = await client.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 6144,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are an executive communications specialist creating a ${audience === "board" ? "board-level" : "internal"} quarterly portfolio update.

Generate a comprehensive quarterly report for "${quarter}".

Respond with JSON: {
  "report": "An executive overview paragraph (2-3 sentences) summarizing the quarter's portfolio health and direction",
  "sections": [
    { "title": "Section Title", "content": "Section narrative content" }
  ],
  "keyMetrics": ["Metric highlight 1", "Metric highlight 2", ...]
}

Required sections:
1. "What Shipped" — Completed investments, resolved Jira issues, finished tactics
2. "In Progress" — Active work with progress indicators
3. "At Risk" — Items with timeline concerns, stalled Jira issues, or missing tactics
4. "Looking Ahead" — Upcoming priorities and strategic direction

Guidelines:
- Reference specific investments by name
- Quantify: "X of Y investments on track", "Z tactics completed"
- Group narrative by strategic pillar when possible
- For board audience: focus on strategic outcomes and business impact
- For internal audience: include team-level details and tactical specifics
- keyMetrics should be quantified highlights like "12 investments across 4 pillars"`,
        },
        {
          role: "user",
          content: `Quarter: ${quarter}
Total Investments: ${context.rows.length}
Pillars: ${JSON.stringify(pillarGroups)}

Portfolio Data:
${JSON.stringify(portfolioData, null, 2)}${context.metrics ? `\n\nMetric Definitions:\n${JSON.stringify(context.metrics, null, 2)}` : ""}`,
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return { report: "No report generated.", sections: [], keyMetrics: [] };
    }

    const parsed = JSON.parse(content) as { report: string; sections: Array<{ title: string; content: string }>; keyMetrics: string[] };
    return {
      report: parsed.report || "No report generated.",
      sections: Array.isArray(parsed.sections) ? parsed.sections : [],
      keyMetrics: Array.isArray(parsed.keyMetrics) ? parsed.keyMetrics : [],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("OPENAI_API_KEY")) throw new Error(message);
    console.error("generateQuarterlyReport error:", message);
    throw new Error(`AI error: ${message}`);
  }
}

export interface UploadAnalysis {
  documentType: string;
  suggestedInvestments: Array<{ id: string; name: string; confidence: number }>;
  suggestedPillar: string;
  timePeriod: string;
  summary: string;
}

function detectDocTypeFromFilename(filename: string): string | null {
  const lower = filename.toLowerCase();
  if (/\bpor\b/.test(lower) || lower.includes("product operating review") || lower.includes("operating review") || lower.includes("plan of record")) {
    return "por";
  }
  if (/\bstrateg/i.test(lower) || lower.includes("vision")) return "strategy";
  if (/\brecap\b/.test(lower) || lower.includes("summary") || lower.includes("monthly review")) return "recap";
  if (lower.includes("release") || lower.includes("announcement") || lower.includes("changelog")) return "release_announcement";
  return null;
}

function extractTimePeriodFromText(text: string, filename: string): string {
  const fnLower = filename.toLowerCase();
  const fnFyQ = fnLower.match(/fy\d{2}\s*q[1-4]/i);
  if (fnFyQ) return fnFyQ[0].toUpperCase();
  const fnFy = fnLower.match(/fy\d{2}/i);
  if (fnFy) return fnFy[0].toUpperCase();
  const fnMonth = filename.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2}/i);
  if (fnMonth) return fnMonth[0];

  const sample = text.slice(0, 30000) + " " + text.slice(Math.max(0, text.length - 10000));
  const fyMatch = sample.match(/FY\d{2}\s*Q[1-4]/i);
  if (fyMatch) return fyMatch[0].toUpperCase();
  const monthMatch = sample.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d{2}/i);
  if (monthMatch) return monthMatch[0];
  const fyOnly = sample.match(/FY\d{2}/i);
  if (fyOnly) return fyOnly[0].toUpperCase();
  return "";
}

export async function analyzeUploadedDocument(
  documentText: string,
  filename: string,
  investments: Array<{ id: string; investment: string; strategicPillar: string; productPriority: string }>,
): Promise<UploadAnalysis> {
  try {
    const client = getClient();

    const truncatedText = documentText.slice(0, 24000);

    const investmentList = investments.map((r) => ({
      id: r.id,
      name: r.investment,
      pillar: r.strategicPillar,
      priority: r.productPriority,
    }));

    const pillars = Array.from(new Set(investments.map((r) => r.strategicPillar).filter(Boolean)));

    const filenameDocType = detectDocTypeFromFilename(filename);
    const filenameTimePeriod = extractTimePeriodFromText(documentText, filename);

    const response = await client.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 1024,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a document classification assistant for a product roadmap tool. Analyze the uploaded document's FILENAME and TEXT CONTENT carefully to determine:

1. documentType: One of: "por", "strategy", "recap", "release_announcement", "reference"
   Classification rules (apply IN ORDER — first match wins):
   - If the filename contains "POR" (case-insensitive, as a word), "Plan of Record", "Product Operating Review", or "Operating Review" → MUST be "por"
   - If the content has recurring monthly sections with metrics, accomplishments, releases, roadmap items, risks → "por"
   - If the filename or content focuses on long-term strategy, vision, multi-year planning → "strategy"
   - If the filename or content is a monthly/periodic recap or summary → "recap"
   - If the filename or content is release notes, changelog, or feature announcement → "release_announcement"
   - Otherwise → "reference"
   ${filenameDocType ? `\nBased on filename analysis, this document appears to be: "${filenameDocType}". Use this unless the content strongly contradicts it.` : ""}

2. suggestedInvestments: Which product investments from the provided list this document is most relevant to. Analyze the document content for mentions of product areas, features, or initiatives that match. Return up to 5 matches with confidence 0-1. Only include matches with confidence >= 0.3.

3. suggestedPillar: Which strategic pillar (from the provided list) this document is most relevant to. Look at the document's subject matter and match it to the closest pillar. Return the EXACT pillar name from the list, or empty string if no good match.

4. timePeriod: Extract the primary time period this document covers. Look for:
   - Fiscal year references (e.g. "FY26", "FY26 Q3")
   - Month/year references (e.g. "February 2025", "March 2025")  
   - Date ranges
   IMPORTANT: Fiscal years are offset — FY26 runs from February 1, 2025 to January 31, 2026.
   Return the most specific time period found. Return empty string ONLY if truly no time reference exists.
   ${filenameTimePeriod ? `\nA time period was detected from the text: "${filenameTimePeriod}". Include this in your response if it's accurate.` : ""}

5. summary: A 1-2 sentence summary of what this document covers, mentioning the product area and time frame if apparent.

Respond with JSON: { "documentType": "...", "suggestedInvestments": [{"id": "...", "name": "...", "confidence": 0.0}], "suggestedPillar": "...", "timePeriod": "...", "summary": "..." }`,
        },
        {
          role: "user",
          content: `Filename: "${filename}"

Available strategic pillars: ${JSON.stringify(pillars)}

Available investments:
${JSON.stringify(investmentList, null, 2)}

Document text (excerpt):
${truncatedText}`,
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return { documentType: filenameDocType || "reference", suggestedInvestments: [], suggestedPillar: "", timePeriod: filenameTimePeriod, summary: "" };
    }

    const parsed = JSON.parse(content);
    const validTypes = ["por", "strategy", "recap", "release_announcement", "reference"];
    const aiDocType = validTypes.includes(parsed.documentType) ? parsed.documentType : "reference";
    const finalDocType = filenameDocType || aiDocType;

    const normalizePillar = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    let suggestedPillar = "";
    if (typeof parsed.suggestedPillar === "string" && parsed.suggestedPillar) {
      const exactMatch = pillars.find((p) => p.toLowerCase() === parsed.suggestedPillar.toLowerCase());
      if (exactMatch) {
        suggestedPillar = exactMatch;
      } else {
        const normalizedInput = normalizePillar(parsed.suggestedPillar);
        const fuzzyMatch = pillars.find((p) => normalizePillar(p) === normalizedInput);
        if (fuzzyMatch) suggestedPillar = fuzzyMatch;
      }
    }

    return {
      documentType: finalDocType,
      suggestedInvestments: Array.isArray(parsed.suggestedInvestments)
        ? parsed.suggestedInvestments.filter((s: any) => s.id && s.name && typeof s.confidence === "number")
        : [],
      suggestedPillar,
      timePeriod: correctMonthYear(parsed.timePeriod, filename) || parsed.timePeriod || filenameTimePeriod || "",
      summary: parsed.summary || "",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("OPENAI_API_KEY")) throw new Error(message);
    console.error("analyzeUploadedDocument error:", message);
    throw new Error(`AI error: ${message}`);
  }
}

export async function generateInvestmentDescription(
  investmentName: string,
  tactics: Array<{ name: string; description?: string; status?: string; owner?: string; jiraLinks: Array<{ key: string; title: string }> }>,
  jiraLinks: Array<{ key: string; title: string; jiraAttributes?: { status?: string; labels?: string[]; components?: string[] } }>,
): Promise<{ description: string }> {
  try {
    const client = getClient();

    const tacticsContext = tactics.map((t) => ({
      name: t.name,
      description: t.description || "",
      status: t.status || "not_started",
      owner: t.owner || "",
      jiraKeys: t.jiraLinks.map((l) => l.key),
    }));

    const jiraContext = jiraLinks.map((l) => ({
      key: l.key,
      title: l.title,
      status: l.jiraAttributes?.status || "Unknown",
      labels: l.jiraAttributes?.labels || [],
    }));

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 512,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a product strategist helping write concise investment descriptions for an executive roadmap.

Given an investment name, its tactics (with their descriptions and Jira issues), and any investment-level Jira links, write a brief executive summary with two parts:
1. **What**: A clear, 2-3 sentence explanation of what this investment delivers as a whole.
2. **So What**: A 1-2 sentence explanation of the strategic value to the business or end users.

Combine both parts into a single flowing paragraph. Do NOT use headers or bullet points. Keep it concise (4-5 sentences max). Write in present tense. Focus on outcomes and strategic value, not implementation details.

Respond with JSON: { "description": "..." }`,
        },
        {
          role: "user",
          content: `Investment: "${investmentName}"

Tactics:
${JSON.stringify(tacticsContext, null, 2)}

Investment-level Jira Links:
${JSON.stringify(jiraContext, null, 2)}

Write a concise executive summary combining "what" this investment delivers and "so what" — the strategic value.`,
        },
      ],
    });

    const content = response.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);
    return { description: parsed.description || "" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("OPENAI_API_KEY")) throw new Error(message);
    console.error("generateInvestmentDescription error:", message);
    throw new Error(`AI error: ${message}`);
  }
}

export async function generateTacticDescription(
  tacticName: string,
  jiraLinks: Array<{ key: string; title: string; jiraAttributes?: { status?: string; labels?: string[]; components?: string[] } }>,
): Promise<{ description: string }> {
  try {
    const client = getClient();

    const jiraContext = jiraLinks.map((l) => ({
      key: l.key,
      title: l.title,
      status: l.jiraAttributes?.status || "Unknown",
      labels: l.jiraAttributes?.labels || [],
      components: l.jiraAttributes?.components || [],
    }));

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 512,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are a product strategist helping write concise tactic descriptions for an executive roadmap.

Given a tactic name and its linked Jira issues, write a brief description with two parts:
1. **What**: A clear, 1-2 sentence explanation of what this tactic delivers.
2. **So What**: A 1-2 sentence explanation of the value to end users or the business.

Combine both parts into a single flowing paragraph. Do NOT use headers or bullet points. Keep it concise (3-4 sentences max). Write in present tense. Focus on outcomes, not implementation details.

Respond with JSON: { "description": "..." }`,
        },
        {
          role: "user",
          content: `Tactic: "${tacticName}"

Linked Jira Issues:
${JSON.stringify(jiraContext, null, 2)}

Write a concise description combining "what" this tactic does and "so what" — the value it delivers.`,
        },
      ],
    });

    const content = response.choices[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);
    return { description: parsed.description || "" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("OPENAI_API_KEY")) throw new Error(message);
    console.error("generateTacticDescription error:", message);
    throw new Error(`AI error: ${message}`);
  }
}

export interface AiCitation {
  rowId: string;
  issueKeys: string[];
}

export interface AiAnswer {
  answer: string;
  citations: AiCitation[];
  freshness: string;
}

export async function answerRoadmapQuestion(
  question: string,
  rows: RoadmapRow[],
  metrics: MetricDefinition[] = [],
  pageContext?: { contextKey?: string; label?: string; summary?: string },
): Promise<AiAnswer> {
  try {
    const result = await askRoadmapQuestion(question, { rows, metrics }, pageContext);

    const citedRows = rows.filter((row) =>
      result.citations.some(
        (c) =>
          row.investment.toLowerCase().includes(c.toLowerCase()) ||
          row.strategicPillar.toLowerCase().includes(c.toLowerCase()) ||
          row.productPriority.toLowerCase().includes(c.toLowerCase()) ||
          c.toLowerCase().includes(row.investment.toLowerCase()),
      ),
    );

    const citations: AiCitation[] = citedRows.slice(0, 5).map((row) => ({
      rowId: row.id,
      issueKeys: row.jiraLinks.map((item) => item.key).filter(Boolean),
    }));

    return {
      answer: result.answer,
      citations,
      freshness: new Date().toISOString(),
    };
  } catch {
    return answerRoadmapQuestionFallback(question, rows);
  }
}

function answerRoadmapQuestionFallback(question: string, rows: RoadmapRow[]): AiAnswer {
  const q = question.toLowerCase();
  const matched = rows.filter((row) => {
    if (q.includes("owner")) {
      return row.owners.toLowerCase().includes(extractToken(question) ?? "");
    }
    if (q.includes("pillar")) {
      return row.strategicPillar.toLowerCase().includes(extractToken(question) ?? "");
    }
    if (q.includes("risk")) {
      return row.jiraLinks.some(
        (item) =>
          item.jiraAttributes?.status?.toLowerCase().includes("blocked") ||
          item.jiraAttributes?.status?.toLowerCase().includes("at risk"),
      );
    }
    return (
      row.strategicPillar.toLowerCase().includes(q) ||
      row.productPriority.toLowerCase().includes(q) ||
      row.investment.toLowerCase().includes(q) ||
      row.owners.toLowerCase().includes(q)
    );
  });

  const citations: AiCitation[] = matched.slice(0, 5).map((row) => ({
    rowId: row.id,
    issueKeys: row.jiraLinks.map((item) => item.key).filter(Boolean),
  }));

  const summary =
    matched.length === 0
      ? "No matching roadmap rows found for that question."
      : `Found ${matched.length} matching roadmap rows: ${matched
          .slice(0, 3)
          .map((row) => row.productPriority)
          .join(", ")}${matched.length > 3 ? ", and more." : "."}`;

  return {
    answer: summary,
    citations,
    freshness: new Date().toISOString(),
  };
}

export async function filterForAudience(
  audience: string,
  rows: Array<{ id: string; investment: string; pillar: string; priority: string; domain: string; themes: string[]; description?: string; status?: string }>,
): Promise<{ rowIds: string[]; context: string }> {
  try {
    const client = getClient();

    const audienceProfiles: Record<string, string> = {
      exec: "Executives and C-Suite. They care about: strategic priorities, business outcomes, financial metrics, competitive bets, and cross-product initiatives. Show investments with significant strategic or financial impact.",
      product: "Product and Engineering teams. They care about: all technical detail, tactics, dependencies, confidence levels, and delivery plans. Show all investments.",
      eps: "Employer Partner Services (EPS) teams. They care about: employer-facing tools, EP Portal features, self-service capabilities, approval flows, and reporting. Show investments that directly affect employer partner workflows.",
      sales: "Sales and GTM teams. They care about: new product capabilities, integrations, features that accelerate deals, expand accounts, or differentiate in competitive situations.",
      employers: "Employer Partners (external). They care about: what's coming that directly benefits their employees and HR/benefits team — self-service tools, reporting, budget controls, and experience improvements.",
    };

    const profile = audienceProfiles[audience] || audienceProfiles.exec;

    const summary = rows.map((r) => ({
      id: r.id,
      investment: r.investment,
      pillar: r.pillar,
      domain: r.domain,
      themes: r.themes,
      status: r.status || "Not Started",
    }));

    const response = await client.chat.completions.create({
      model: MODEL_MINI,
      max_completion_tokens: 1024,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are filtering a product roadmap for a specific audience.

Audience: ${profile}

Given the list of investments, select the ones most relevant to this audience.
Also write a 1-2 sentence context message explaining what this filtered view shows.

Respond with JSON: { "rowIds": ["id1", "id2", ...], "context": "..." }

Include at least half the investments unless the audience is very specific. When in doubt, include the investment.`,
        },
        {
          role: "user",
          content: `Investments:\n${JSON.stringify(summary, null, 2)}`,
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return { rowIds: rows.map((r) => r.id), context: "" };

    const parsed = JSON.parse(content) as { rowIds: string[]; context: string };
    return {
      rowIds: Array.isArray(parsed.rowIds) ? parsed.rowIds : rows.map((r) => r.id),
      context: parsed.context || "",
    };
  } catch (err) {
    console.error("filterForAudience error:", err);
    return { rowIds: rows.map((r) => r.id), context: "" };
  }
}

/** Rewrite investment descriptions tailored to a specific audience.
 *  Returns a map of rowId → audience-specific 2-sentence summary.
 *  Batches all rows in a single LLM call to keep cost low.
 */
export async function rewriteCardSummaries(
  audience: string,
  rows: Array<{ id: string; investment: string; description?: string; domain: string; themes: string[]; expectedBenefits?: string[] }>,
): Promise<Record<string, string>> {
  if (rows.length === 0) return {};
  try {
    const client = getClient();

    const audienceProfiles: Record<string, string> = {
      exec: "Executives and C-Suite. They want to know: what business outcome this drives, what strategic bet it represents, and what the risk/reward is. Be concise and outcome-focused.",
      product: "Product and Engineering teams. They want to know: what problem this solves, what the technical approach is, and what it unblocks. Be specific and implementation-aware.",
      eps: "Employer Partner Services (EPS) teams. They want to know: how this improves employer-facing workflows, self-service tools, or reporting. Connect to employer partner outcomes.",
      sales: "Sales and GTM teams. They want to know: how this helps close deals, retain accounts, or differentiate versus competitors. Frame as a capability story.",
      employers: "Employer Partners (external HR/benefits buyers). They want to know: what direct benefit this brings to their employees or admin team. Keep it simple and outcome-focused.",
    };

    const profile = audienceProfiles[audience] || audienceProfiles.exec;

    const payload = rows.map((r) => ({
      id: r.id,
      investment: r.investment,
      description: r.description || "",
      domain: r.domain,
      themes: r.themes,
      expectedBenefits: r.expectedBenefits ?? [],
    }));

    const response = await client.chat.completions.create({
      model: MODEL_MINI,
      max_completion_tokens: 2048,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are rewriting product investment descriptions for a specific audience.

Audience: ${profile}

For each investment, write exactly 2 sentences that explain the investment in terms this audience cares about.
Use the original description, themes, and expected benefits as source material but rewrite for the audience.
Keep each summary under 40 words.

Return JSON: { "summaries": { "<rowId>": "<2-sentence summary>", ... } }`,
        },
        {
          role: "user",
          content: `Investments:\n${JSON.stringify(payload, null, 2)}`,
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) return {};
    const parsed = JSON.parse(content) as { summaries: Record<string, string> };
    return parsed.summaries && typeof parsed.summaries === "object" ? parsed.summaries : {};
  } catch (err) {
    console.error("rewriteCardSummaries error:", err);
    return {};
  }
}

export interface PriorityInvestmentInput {
  investment: string;
  description?: string;
  expectedBenefits?: string[];
  jiraKeys?: string[];
  tactics?: Array<{ name: string; description?: string; status?: string }>;
}

export async function generatePrioritySummary(
  priority: string,
  pillar: string,
  investments: PriorityInvestmentInput[],
): Promise<string> {
  const client = getClient();

  const investmentText = investments
    .map((inv) => {
      const parts = [`- ${inv.investment}`];
      if (inv.description) parts.push(`  Description: ${inv.description}`);
      if (inv.expectedBenefits?.length) parts.push(`  Expected outcomes: ${inv.expectedBenefits.join("; ")}`);
      if (inv.tactics?.length) {
        const tacticNames = inv.tactics.map((t) => t.name).join(", ");
        parts.push(`  Tactics: ${tacticNames}`);
      }
      if (inv.jiraKeys?.length) parts.push(`  Jira: ${inv.jiraKeys.join(", ")}`);
      return parts.join("\n");
    })
    .join("\n\n");

  const response = await client.chat.completions.create({
    model: MODEL_MINI,
    max_completion_tokens: 300,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are writing a "Commercial Why" paragraph for an internal product roadmap.
The paragraph should explain why this product priority area matters to the business — the customer problem it solves, the commercial opportunity, and the transformation it represents.
Write 2–3 sentences. Be specific and concrete. Do not use filler phrases like "in today's landscape".
Return JSON: { "summary": "<paragraph>" }`,
      },
      {
        role: "user",
        content: `Product Priority: ${priority}
Strategic Pillar: ${pillar}

Investments under this priority:
${investmentText}`,
      },
    ],
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) throw new Error("Empty AI response");
  const parsed = JSON.parse(raw) as { summary: string };
  return parsed.summary || "";
}

export interface DocumentContentExtraction {
  summary: string;
  benefits: string[];
  transformations: Array<{ from: string; to: string; impact: string }>;
  talkingPoints: {
    today: string[];
    committed: string[];
  };
}

export async function extractDocumentContent(
  documentText: string,
  filename: string,
): Promise<DocumentContentExtraction> {
  try {
    const client = getClient();
    const truncatedText = documentText.slice(0, 24000);

    const response = await client.chat.completions.create({
      model: MODEL_MINI,
      max_completion_tokens: 1500,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: `You are extracting structured content from a product roadmap strategy brief or 2-pager document.

Extract the following sections if present:
1. summary: The "Commercial Why" or executive narrative — the first 1–2 paragraphs explaining why this area exists commercially. Return as a single string (max 3 sentences).
2. transformations: From a "From / To / Commercial Impact" table — extract ALL three columns for each row. Return as array of objects: { "from": "current state", "to": "future state", "impact": "commercial impact" }. If no such table exists, return [].
3. benefits: From the same "From / To / Commercial Impact" table — extract just the Commercial Impact column as a flat array of strings. If no table, return [].
4. talkingPoints.today: Bullets from a "What you can sell today" or "Currently available capabilities" section. Return as array of strings.
5. talkingPoints.committed: Summary statements from "What you can sell into" or committed delivery phase sections. Return as array of strings (one per phase or key commitment).

If a section is not present in the document, return an empty string or empty array for that field.

Respond with JSON: { "summary": "...", "transformations": [{ "from": "...", "to": "...", "impact": "..." }], "benefits": ["..."], "talkingPoints": { "today": ["..."], "committed": ["..."] } }`,
        },
        {
          role: "user",
          content: `Filename: "${filename}"\n\nDocument:\n${truncatedText}`,
        },
      ],
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return { summary: "", benefits: [], transformations: [], talkingPoints: { today: [], committed: [] } };
    }

    const parsed = JSON.parse(content);
    return {
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      transformations: Array.isArray(parsed.transformations)
        ? parsed.transformations.filter((t: unknown) =>
            t && typeof t === "object" && "from" in (t as object) && "to" in (t as object)
          )
        : [],
      benefits: Array.isArray(parsed.benefits)
        ? parsed.benefits.filter((b: unknown) => typeof b === "string" && (b as string).trim())
        : [],
      talkingPoints: {
        today: Array.isArray(parsed.talkingPoints?.today)
          ? parsed.talkingPoints.today.filter((t: unknown) => typeof t === "string" && (t as string).trim())
          : [],
        committed: Array.isArray(parsed.talkingPoints?.committed)
          ? parsed.talkingPoints.committed.filter((t: unknown) => typeof t === "string" && (t as string).trim())
          : [],
      },
    };
  } catch (err: any) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("OPENAI_API_KEY")) throw new Error(message);
    console.error("extractDocumentContent error:", message);
    return { summary: "", benefits: [], transformations: [], talkingPoints: { today: [], committed: [] } };
  }
}

function extractToken(question: string): string | undefined {
  const afterBy = question.split("by ").at(1);
  if (afterBy) return afterBy.toLowerCase().trim();
  return undefined;
}
