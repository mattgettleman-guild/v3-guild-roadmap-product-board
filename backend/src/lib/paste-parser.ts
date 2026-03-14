import OpenAI from "openai";

const MODEL = "gpt-5";

export interface ParsedPasteRow {
  strategicPillar?: string;
  productPriority?: string;
  investment?: string;
  tactics?: string;
  description?: string;
  themes?: string;
  tags?: string;
  domain?: string;
  owners?: string;
  confidence?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  jira?: string;
  depYesNo?: string;
  depDescription?: string;
  depTeam?: string;
  depNeededBy?: string;
  depActualDelivery?: string;
  depStatus?: string;
  depCriticality?: string;
}

export async function aiParsePastedText(rawText: string): Promise<ParsedPasteRow[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const client = new OpenAI({ apiKey });

  const response = await client.chat.completions.create({
    model: MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `You are a data extraction assistant. You receive raw pasted text that was copied from a spreadsheet, document, or other source. It may be tab-separated, comma-separated, messy freeform text, or a mix.

Your job: extract structured rows of product roadmap data. Each row represents an investment or tactic.

Output JSON with this exact shape:
{
  "rows": [
    {
      "strategicPillar": "string or empty",
      "productPriority": "string or empty",
      "investment": "string or empty",
      "tactics": "string or empty",
      "description": "string or empty",
      "themes": "comma-separated string or empty",
      "tags": "comma-separated string or empty",
      "domain": "string or empty",
      "owners": "string or empty",
      "confidence": "High/Medium/Low or empty",
      "status": "string or empty",
      "startDate": "date string or empty",
      "endDate": "date string or empty",
      "jira": "Jira keys like PROJ-123 separated by commas, or empty",
      "depYesNo": "Yes/No or empty",
      "depDescription": "string or empty",
      "depTeam": "string or empty",
      "depNeededBy": "date string or empty",
      "depActualDelivery": "date string or empty",
      "depStatus": "string or empty",
      "depCriticality": "string or empty"
    }
  ]
}

Rules:
- If the first row looks like headers, skip it and parse subsequent rows as data
- Preserve hierarchical context: if a row has a pillar but no investment, it sets context for subsequent rows
- Empty cells should be empty strings, not null
- For tab-separated data, columns are separated by \\t characters
- Month columns like "Feb", "Mar", "Apr" with "x" markers indicate timeline — infer startDate/endDate from the earliest and latest marked months
- Fiscal year context: Feb-Apr = Q1, May-Jul = Q2, Aug-Oct = Q3, Nov-Jan = Q4
- If data is messy or freeform, do your best to extract meaningful structured data
- Always return at least an empty rows array`,
      },
      {
        role: "user",
        content: rawText,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;
  if (!content) return [];

  try {
    const parsed = JSON.parse(content);
    return (parsed.rows || []) as ParsedPasteRow[];
  } catch {
    return [];
  }
}
