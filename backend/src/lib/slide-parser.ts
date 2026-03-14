import OpenAI from "openai";

const MODEL = "gpt-5";

export interface SlideExtraction {
  investmentName: string;
  productPriority?: string;
  strategicPillar?: string;
  domain: string;
  metrics: SlideMetric[];
  tactics: SlideTactic[];
}

export interface SlideMetric {
  name: string;
  description: string;
  targetValue?: number;
  unit?: string;
  context?: string;
}

export interface SlideTactic {
  name: string;
  description?: string;
  status: string;
  deliveryConfidence?: string;
  startQuarter?: string;
  endQuarter?: string;
}

const STATUS_MAP: Record<string, string> = {
  "not started": "not_started",
  "in progress": "in_progress",
  "in discovery": "in_discovery",
  "paused": "paused",
  "paused/on hold": "paused",
  "paused/on-hold": "paused",
  "on hold": "paused",
  "on deck": "not_started",
  "completed": "completed",
  "complete": "completed",
  "shipped": "completed",
  "continuous": "in_progress",
};

const CONFIDENCE_MAP: Record<string, string> = {
  "high": "high",
  "medium": "medium",
  "low": "low",
};

function normalizeStatus(raw: string): string {
  const key = raw.toLowerCase().trim().replace(/[()]/g, "");
  if (STATUS_MAP[key]) return STATUS_MAP[key];
  for (const [pattern, value] of Object.entries(STATUS_MAP)) {
    if (key.includes(pattern)) return value;
  }
  return "not_started";
}

function normalizeConfidence(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const key = raw.toLowerCase().trim();
  return CONFIDENCE_MAP[key] || undefined;
}

function normalizeQuarter(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const match = raw.match(/Q([1-4])/i);
  return match ? `Q${match[1]}` : undefined;
}

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2000;

async function callVisionWithRetry(client: OpenAI, base64DataUrl: string): Promise<string> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model: MODEL,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: SLIDE_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: base64DataUrl, detail: "auto" },
              },
              {
                type: "text",
                text: "Extract all structured data from this roadmap slide. If this is not a roadmap slide (title page, section divider, etc.), return {\"isRoadmapSlide\": false}.",
              },
            ],
          },
        ],
        max_completion_tokens: 4000,
      });

      const content = response.choices[0]?.message?.content;
      if (content) return content;

      if (attempt < MAX_RETRIES) {
        const delay = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        console.warn(`[slide-parser] Empty AI response on attempt ${attempt}/${MAX_RETRIES}, retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    } catch (err: any) {
      const isRateLimit = err?.status === 429 || err?.code === "rate_limit_exceeded";
      if (attempt < MAX_RETRIES) {
        const delay = isRateLimit
          ? INITIAL_BACKOFF_MS * Math.pow(2, attempt) 
          : INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        console.warn(`[slide-parser] Attempt ${attempt}/${MAX_RETRIES} failed (${isRateLimit ? "rate limit" : err.message}), retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
  throw new Error("No response from AI model after retries");
}

const SLIDE_SYSTEM_PROMPT = `You are an expert at reading executive product roadmap slides and extracting structured data. 
You will be given an image of a roadmap slide. Extract the following information as JSON:

{
  "isRoadmapSlide": true,
  "investmentName": "The product investment name",
  "productPriority": "The product priority (parent grouping), if different from the investment name",
  "strategicPillar": "The high-level strategic pillar or section (e.g., 'Grow', 'Platform', 'Navigator', 'Academy', 'Foundations & AI', 'Technology', 'Analytics')",
  "domain": "The product domain exactly as written (preserve hierarchy like 'Platform>BA', 'Platform>Payment', 'Analytics → Data + Grow')",
  "metrics": [
    {
      "name": "The leading indicator / metric name",
      "description": "The target description (e.g., 'Decrease Benefit Admin Errors by 75%')",
      "targetValue": 75,
      "unit": "%",
      "context": "Any additional context like measurement criteria, sub-targets, or 'Rolls up into...' notes"
    }
  ],
  "tactics": [
    {
      "name": "The tactic name (bold text in tactics column)",
      "description": "The tactic description (smaller/italic text below the name, if any). Include phase labels if the timeline bar has labeled segments (e.g., 'Alpha: Q1, Beta: Q2-Q3, GA: Q4')",
      "status": "The current status value from the Current Status column",
      "deliveryConfidence": "The confidence level based on timeline bar color: green=High, yellow-striped=Medium, gray-striped=Low",
      "startQuarter": "The quarter where the timeline bar starts (Q1, Q2, Q3, or Q4)",
      "endQuarter": "The quarter where the timeline bar ends (Q1, Q2, Q3, or Q4)"
    }
  ]
}

Rules:
- If this is NOT a roadmap slide (e.g., it's a title page, section divider, table of contents, or status definitions page), return: {"isRoadmapSlide": false}
- The slide title often says "Product Priority/Investment:" or "Product Priority:" followed by the name. Sometimes these are two separate lines — "Product Priority:" is the parent grouping and "Product Investment:" is the specific initiative. If they are the same or only one is present, set both fields to the same value.
- The domain is usually labeled "Product Domain:" — preserve it exactly including hierarchy notation like "Platform>BA", "Platform>Payment", "Analytics → Data + Grow".
- Leading Indicators are in the left column and represent metrics/KPIs. Extract each unique one.
- Each row in the Tactics column is a separate tactic. If there's bold text followed by smaller text, the bold is the name and the smaller text is the description.
- For status, use exactly what the "Current Status" column says. Handle variants: "Complete" = "Completed", "On Deck" = "Not Started", "(Continuous)" = "In Progress", "In Progress (in testing)" = "In Progress", "Paused - initial use case change..." = "Paused/On-Hold".
- For confidence, interpret the timeline bar colors: solid green = High, yellow or striped yellow = Medium, gray or striped gray = Low. If you can't determine it, omit the field.
- For quarters, determine which quarter column (Q1-Q4) the bar starts and ends in based on the bar position.
- MULTI-TIMELINE TACTICS: If a single tactic row has multiple labeled segments or phased bars (e.g., Alpha in Q1, Beta in Q2-Q3, GA in Q4), capture the OVERALL start and end quarters spanning the full range, and include the phase labels in the description. If the phases are clearly separate work items with different names, split them into separate tactics.
- Extract ALL tactics visible on the slide, even if they share a leading indicator.
- Return valid JSON only.`;

export async function parseSlideImage(base64DataUrl: string): Promise<SlideExtraction | null> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set.");
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const content = await callVisionWithRetry(client, base64DataUrl);

  const parsed = JSON.parse(content) as {
    isRoadmapSlide?: boolean;
    investmentName?: string;
    productPriority?: string;
    strategicPillar?: string;
    domain?: string;
    metrics?: Array<{
      name?: string;
      description?: string;
      targetValue?: number;
      unit?: string;
      context?: string;
    }>;
    tactics?: Array<{
      name?: string;
      description?: string;
      status?: string;
      deliveryConfidence?: string;
      startQuarter?: string;
      endQuarter?: string;
    }>;
  };

  if (parsed.isRoadmapSlide === false) {
    return null;
  }

  return {
    investmentName: parsed.investmentName || "Untitled Investment",
    productPriority: parsed.productPriority || undefined,
    strategicPillar: parsed.strategicPillar || undefined,
    domain: parsed.domain || "",
    metrics: (parsed.metrics || []).map((m) => ({
      name: m.name || "",
      description: m.description || "",
      targetValue: m.targetValue,
      unit: m.unit,
      context: m.context,
    })),
    tactics: (parsed.tactics || []).map((t) => ({
      name: t.name || "Untitled Tactic",
      description: t.description,
      status: normalizeStatus(t.status || "not started"),
      deliveryConfidence: normalizeConfidence(t.deliveryConfidence),
      startQuarter: normalizeQuarter(t.startQuarter),
      endQuarter: normalizeQuarter(t.endQuarter),
    })),
  };
}
