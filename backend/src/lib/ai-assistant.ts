import OpenAI from "openai";
import { db } from "./db.js";
import { roadmapRows, appSettings, aiContextDocuments } from "./schema.js";
import { eq, sql } from "drizzle-orm";
import { fetchUpcomingDeliverables, type JiraUpcomingItem } from "./jira.js";

const MODEL = "gpt-5";

function getClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set. Please configure the OpenAI API key to use AI features.");
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function getCustomInstructions(): Promise<string> {
  try {
    const [settings] = await db.select().from(appSettings).where(eq(appSettings.id, 1));
    return settings?.aiCustomInstructions || "";
  } catch {
    return "";
  }
}

async function getContextDocumentsText(): Promise<string> {
  try {
    const docs = await db
      .select()
      .from(aiContextDocuments)
      .where(eq(aiContextDocuments.status, "ready"));
    if (docs.length === 0) return "";

    const MAX_CONTEXT_CHARS = 200000;
    let totalChars = 0;
    const sections: string[] = [];

    for (const doc of docs) {
      if (!doc.extractedText) continue;
      const remaining = MAX_CONTEXT_CHARS - totalChars;
      if (remaining <= 0) break;
      const text = doc.extractedText.length > remaining
        ? doc.extractedText.slice(0, remaining) + "\n[...truncated]"
        : doc.extractedText;
      sections.push(`### Reference Document: ${doc.filename}\n${text}`);
      totalChars += text.length;
    }

    if (sections.length === 0) return "";
    return "\n\n## Uploaded Reference Documents\n" + sections.join("\n\n---\n\n");
  } catch (err) {
    console.warn("Failed to load AI context documents:", err);
    return "";
  }
}

async function getRoadmapContext(): Promise<string> {
  const rows = await db.select().from(roadmapRows);
  if (rows.length === 0) return "No roadmap data available yet.";

  const summary = rows.map((r) => {
    const tactics = (r.tactics as any[]) || [];
    const jiraLinks = (r.jiraLinks as any[]) || [];
    return {
      investment: r.investment,
      pillar: r.strategicPillar,
      priority: r.productPriority,
      domain: r.domain,
      owners: r.owners,
      tags: r.tags,
      timeline: r.timeline,
      tacticsCount: tactics.length,
      tacticsSummary: tactics.slice(0, 10).map((t: any) => ({
        name: t.name,
        status: t.status || "Unknown",
        deliveryConfidence: t.deliveryConfidence,
      })),
      jiraCount: jiraLinks.length,
    };
  });

  const result = JSON.stringify(summary, null, 2);
  if (result.length > 30000) {
    const condensed = rows.map((r) => ({
      investment: r.investment,
      pillar: r.strategicPillar,
      priority: r.productPriority,
      tacticsCount: ((r.tactics as any[]) || []).length,
      jiraCount: ((r.jiraLinks as any[]) || []).length,
    }));
    return JSON.stringify(condensed, null, 2) + `\n(${rows.length} investments total, condensed for context size)`;
  }
  return result;
}

async function getKBContext(query: string): Promise<string> {
  try {
    const client = getClient();
    const embeddingRes = await client.embeddings.create({
      model: "text-embedding-3-small",
      input: query,
    });
    const queryEmbedding = embeddingRes.data[0].embedding;
    const vectorStr = `[${queryEmbedding.join(",")}]`;

    const results = await db.execute(sql`
      SELECT dc.content, dc.section_type, dc.initiative, d.filename, d.document_type, d.time_period
      FROM document_chunks dc
      JOIN documents d ON d.id = dc.document_id
      WHERE dc.embedding IS NOT NULL AND d.status = 'ready'
      ORDER BY dc.embedding <=> ${vectorStr}::vector
      LIMIT 8
    `);

    if (!results.rows || results.rows.length === 0) return "";

    const chunks = results.rows.map((r: any) =>
      `[${r.filename} (${r.document_type}${r.time_period ? `, ${r.time_period}` : ""})]\n${r.content}`
    );
    return "\n\nRelevant Knowledge Base excerpts:\n" + chunks.join("\n\n---\n\n");
  } catch (err) {
    console.warn("KB vector search failed, continuing without:", err);
    return "";
  }
}

async function getJiraUpcomingContext(): Promise<string> {
  try {
    const items = await fetchUpcomingDeliverables({ maxResults: 200 });
    if (!items || items.length === 0) return "";

    const summary = items.map((item: JiraUpcomingItem) => ({
      key: item.key,
      summary: item.summary,
      type: item.issueType,
      status: item.status,
      assignee: item.assignee || "Unassigned",
      priority: item.priority || "None",
      dueDate: item.dueDate || "No due date",
      labels: item.labels.length > 0 ? item.labels.join(", ") : undefined,
      components: item.components.length > 0 ? item.components.join(", ") : undefined,
    }));

    const result = JSON.stringify(summary, null, 2);
    if (result.length > 30000) {
      const condensed = items.slice(0, 100).map((item: JiraUpcomingItem) => ({
        key: item.key,
        summary: item.summary,
        status: item.status,
        priority: item.priority,
        dueDate: item.dueDate,
      }));
      return JSON.stringify(condensed, null, 2) + `\n(${items.length} total Jira issues, showing top 100 condensed)`;
    }
    return result;
  } catch (err) {
    console.warn("Failed to fetch Jira upcoming for AI context:", err);
    return "";
  }
}

async function getInvestmentContext(investmentId: string): Promise<string> {
  try {
    const [row] = await db.select().from(roadmapRows).where(eq(roadmapRows.id, investmentId));
    if (!row) return "";
    const tactics = (row.tactics as any[]) || [];
    const jiraLinks = (row.jiraLinks as any[]) || [];
    return `\n\nFocused investment: "${row.investment}"
Pillar: ${row.strategicPillar}
Priority: ${row.productPriority}
Domain: ${row.domain}
Owners: ${Array.isArray(row.owners) ? row.owners.join(", ") : row.owners}
Timeline: ${row.timeline ? `${(row.timeline as any).start} to ${(row.timeline as any).end}` : "Not set"}
Tags: ${(row.tags || []).join(", ") || "None"}
Tactics (${tactics.length}):
${tactics.map((t: any) => `  - ${t.name}: status=${t.status || "Unknown"}, confidence=${t.deliveryConfidence || "N/A"}, jira links=${(t.jiraLinks || []).length}`).join("\n")}
Jira links (${jiraLinks.length}):
${jiraLinks.map((l: any) => `  - ${l.key}: ${l.title} (${l.jiraAttributes?.status || "Unknown"})`).join("\n")}`;
  } catch {
    return "";
  }
}

export async function generateAssistantReply(
  conversationHistory: Array<{ role: string; content: string }>,
  context?: { contextType?: string; contextId?: string; contextLabel?: string },
): Promise<{ content: string; citations: string[]; metadata: Record<string, unknown> }> {
  const client = getClient();

  const customInstructions = await getCustomInstructions();
  const contextDocsText = await getContextDocumentsText();
  const latestUserMessage = conversationHistory[conversationHistory.length - 1]?.content || "";

  const [roadmapData, kbContext, jiraUpcoming] = await Promise.all([
    getRoadmapContext(),
    getKBContext(latestUserMessage),
    getJiraUpcomingContext(),
  ]);
  let investmentContext = "";
  if (context?.contextType === "investment" && context.contextId) {
    investmentContext = await getInvestmentContext(context.contextId);
  }

  const FISCAL_YEAR_START_MONTH = parseInt(process.env.FISCAL_YEAR_START_MONTH || "2", 10);
  const monthNames = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const fyStartMonth = monthNames[FISCAL_YEAR_START_MONTH] || "February";
  const fyEndMonth = monthNames[FISCAL_YEAR_START_MONTH === 1 ? 12 : FISCAL_YEAR_START_MONTH - 1] || "January";
  const now = new Date();
  const currentFY = now.getMonth() + 1 >= FISCAL_YEAR_START_MONTH ? now.getFullYear() + 1 : now.getFullYear();

  const systemPrompt = `You are a GTM Roadmap Intelligence Agent embedded in the Executive Roadmap Hub. You help Product, C-Suite, and Go-To-Market stakeholders understand strategic direction, investment progress, and operational details.

${customInstructions ? `## Custom Instructions (from admin)\n${customInstructions}\n` : ""}${contextDocsText}

## Fiscal Year Context
- Current fiscal year: FY${currentFY % 100} (${fyStartMonth} 1, ${currentFY - 1} through ${fyEndMonth} 31, ${currentFY})
- Today's date: ${now.toISOString().slice(0, 10)}
- When citing monthly data from documents, always note which month's section you are referencing

## Data Sources at Your Disposal

### 1. Roadmap Database (live, always available)
The structured roadmap data below is pulled directly from the app's database. It contains:
- **Strategic Pillars** → **Product Priorities** → **Product Investments** → **Tactics** (full hierarchy)
- Each investment has: owners, domain, tags, timeline (start/end dates), metric assignments
- Each tactic has: name, status (not_started/in_discovery/in_progress/paused/completed), delivery confidence (high/medium/low), tags
- **Synced Jira links** on both investments and tactics, including: Jira key, title, issue type (initiative/epic), and Jira attributes (status, assignee, priority, start/end dates, labels, components)

Use this data for: current status, who owns what, what's in progress, timeline queries, tactic counts.

### 2. Jira Upcoming Deliverables (live query, all active initiatives and epics)
A broader view of ALL active Jira initiatives and epics (not just those linked to roadmap investments). This includes items still in progress across the entire Jira instance, with their status, assignee, priority, due dates, labels, and components.

Use this data for: comprehensive Jira status checks, upcoming release dates, assignee lookups, finding items that may not yet be linked to roadmap investments, cross-referencing with roadmap data.

### 3. Knowledge Base (semantic search, queried per question)
Uploaded documents (PORs, strategy decks, monthly recaps, release notes, etc.) are chunked, embedded, and searched semantically against each user question. Relevant excerpts appear below under "Relevant Knowledge Base excerpts."
- Documents may include: Product Operating Reviews (PORs), Corporate Strategy docs, Monthly Recaps, Release Announcements, and other reference materials
- Each excerpt shows its source filename, document type, and time period
- When citing KB content, always reference the specific document name and the month/section

Use this data for: historical context, metrics from POR reports, strategic priorities, what shipped, monthly summaries, cross-initiative context.

### 4. Reference Documents (always in context, uploaded by admin in Settings)
Admin-uploaded reference documents appear above under "Uploaded Reference Documents." These are always included in full (up to the context limit) for every conversation.

Use this data for: persistent reference material, playbooks, style guides, process documentation.

### 5. Investment-Specific Context (when a conversation is focused on one investment)
When the user opens a conversation from a specific investment, detailed data for that investment is included below, with full tactic details and Jira link details.

## Query Protocol
For queries about features, releases, or status, follow this priority:
1. **"What shipped" / releases**: Check Knowledge Base excerpts for release announcements and POR "what we did" sections, cross-reference Jira statuses showing "Done"
2. **"Status/progress"**: Check roadmap data for current tactic statuses and Jira attributes, then KB for latest POR context
3. **"When will X launch"**: Check roadmap timeline and Jira dates; if KB has conflicting dates, note both with a ⚠️ flag (KB/POR takes precedence)
4. **"Strategic priorities"**: Check reference documents and KB for strategy docs
5. **"Who owns"**: Check roadmap data for investment/tactic owners, Jira assignees
6. **"Monthly summary"**: Check KB for monthly recap documents and POR sections

## Response Guidelines
- Lead with a concise answer (2-3 sentences), then provide supporting details
- Be specific and data-driven — reference actual investments, tactics, and Jira statuses by name
- Use bullets, not paragraphs, for detail sections
- When generating executive write-ups or summaries, use professional language suitable for C-suite stakeholders
- Cite Knowledge Base documents when referencing them (e.g., "Per the December section of BenefitAdmin POR...")
- If asked about something not in the available data, say so clearly — do not fabricate
- Format responses with markdown (headers, bullet points, bold for emphasis)
- Default to GTM-friendly summaries unless the user asks for more detail
- When dates conflict between sources, flag both and note which takes precedence

## Current Roadmap Data
${roadmapData}
${jiraUpcoming ? `\n## Jira Upcoming Deliverables (all active initiatives & epics)\n${jiraUpcoming}` : ""}
${investmentContext}${kbContext}`;

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
  ];

  const recentHistory = conversationHistory.slice(-20);
  for (const msg of recentHistory) {
    messages.push({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    });
  }

  const response = await client.chat.completions.create({
    model: MODEL,
    max_completion_tokens: 4096,
    messages,
  });

  const content = response.choices[0]?.message?.content;
  const refusal = response.choices[0]?.message?.refusal;

  if (refusal) {
    console.error("AI assistant refusal:", refusal);
    return { content: "I wasn't able to process that request. Could you try rephrasing?", citations: [], metadata: {} };
  }

  if (!content) {
    console.error("AI assistant empty response. finish_reason:", response.choices[0]?.finish_reason);
    return { content: "I didn't get a response. Please try again.", citations: [], metadata: {} };
  }

  const citations: string[] = [];
  const docRefPattern = /\[([^\]]+\.(pdf|docx|doc|txt|md))/gi;
  let match;
  while ((match = docRefPattern.exec(content)) !== null) {
    if (!citations.includes(match[1])) citations.push(match[1]);
  }

  return { content, citations, metadata: {} };
}
