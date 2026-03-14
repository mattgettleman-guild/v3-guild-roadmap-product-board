import crypto from "node:crypto";
import * as XLSX from "xlsx";
import Fuse from "fuse.js";
import type {
  ImportDraftChange, ImportJob, ImportMatchDetails, ImportTacticMatch,
  ImportHeaderMapping, ImportAvailableField, ImportParseHeadersResponse,
  RoadmapRow, Tactic,
} from "@roadmap/shared";

const HEADER_ALIASES: Record<string, string[]> = {
  strategicPillar: ["strategic pillar", "strategicpillar", "pillar", "strategic pillars"],
  productPriority: [
    "product priorities", "product priority", "productpriority", "product priorities (ops reviews)",
    "priority", "ops reviews",
  ],
  investment: ["investment", "investments"],
  leadingIndicators: [
    "leading indicator", "leading indicators", "leadingindicator", "leadingindicators",
    "metric", "metrics", "kpi", "kpis", "leading indicator/metric",
  ],
  tactics: [
    "tactics", "tactics / initiatives", "tactics/initiatives", "tactic", "initiative", "initiatives",
    "tactics / jira initiatives", "tactics / jira initiatives (grs)",
  ],
  description: ["description"],
  domain: ["domain", "domains"],
  subDomain: ["sub-domain", "sub domain", "subdomain", "sub-domains", "sub domains", "subdomains"],
  owners: ["primary owner", "owner", "owners", "assignee", "exec sponsor"],
  startDate: ["start date", "startdate", "start"],
  endDate: ["end date", "enddate", "end", "due date"],
  themes: ["themes", "positioning themes", "theme"],
  tags: ["tags", "tag"],
  confidence: [
    "delivery confidence", "confidence", "delivery confidence / commitment to date",
    "deliveryconfidence",
  ],
  status: ["status"],
  jira: ["jira", "jira links", "jira link", "jira key", "jira keys", "jira issues"],
  depYesNo: [
    "is dependency other product team? (yes/no)", "is dependency", "dependency (y/n)",
    "dependency y/n", "has dependency",
  ],
  depDescription: [
    "dependency description", "dependecy description", "dep description",
  ],
  depTeam: [
    "which team", "dependency team", "dep team",
  ],
  depNeededBy: [
    "needed by date", "needed by", "dep needed by",
  ],
  depActualDelivery: [
    "actual delivery date", "actual delivery", "dep actual delivery",
  ],
  depStatus: [
    "dependency status", "dep status",
  ],
  depCriticality: [
    "criticality", "dependency criticality", "dep criticality",
  ],
  depNotes: [
    "notes", "dependency notes", "dep notes",
  ],
};

const HEADER_PREFIXES: Record<string, string[]> = {
  description: ["description"],
  themes: ["positioning themes", "themes"],
  tags: ["tags"],
  confidence: ["delivery confidence", "confidence"],
  depDescription: ["dependecy description", "dependency description"],
  depTeam: ["which team"],
};

export const AVAILABLE_FIELDS: ImportAvailableField[] = [
  { field: "strategicPillar", label: "Strategic Pillar" },
  { field: "productPriority", label: "Product Priority" },
  { field: "investment", label: "Investment" },
  { field: "leadingIndicators", label: "Leading Indicators / Metrics" },
  { field: "tactics", label: "Tactics" },
  { field: "description", label: "Description" },
  { field: "domain", label: "Domain" },
  { field: "subDomain", label: "Sub-domain" },
  { field: "owners", label: "Owner" },
  { field: "startDate", label: "Start Date" },
  { field: "endDate", label: "End Date" },
  { field: "themes", label: "Themes" },
  { field: "tags", label: "Tags" },
  { field: "confidence", label: "Delivery Confidence" },
  { field: "status", label: "Status" },
  { field: "jira", label: "Jira Keys" },
  { field: "depYesNo", label: "Has Dependency (Y/N)" },
  { field: "depDescription", label: "Dependency Description" },
  { field: "depTeam", label: "Dependency Team" },
  { field: "depNeededBy", label: "Dependency Needed By Date" },
  { field: "depActualDelivery", label: "Dependency Actual Delivery Date" },
  { field: "depStatus", label: "Dependency Status" },
  { field: "depCriticality", label: "Dependency Criticality" },
  { field: "depNotes", label: "Dependency Notes" },
];

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function matchHeader(raw: string): string | null {
  const normalized = raw.trim().toLowerCase().replace(/\r?\n/g, " ");
  if (MONTH_NAMES.includes(normalized)) return null;
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(normalized)) return field;
  }
  for (const [field, prefixes] of Object.entries(HEADER_PREFIXES)) {
    for (const prefix of prefixes) {
      if (normalized.startsWith(prefix)) return field;
    }
  }
  return null;
}

function excelSerialToDate(serial: number): string {
  const epoch = new Date(Date.UTC(1899, 11, 30));
  const ms = epoch.getTime() + serial * 86400000;
  const d = new Date(ms);
  return d.toISOString().split("T")[0];
}

const DATE_FIELDS = new Set(["startDate", "endDate", "depNeededBy", "depActualDelivery"]);

function cellToString(val: any, field?: string): string {
  if (val === null || val === undefined || val === "") return "";
  if (typeof val === "number" && field && DATE_FIELDS.has(field)) {
    if (val > 30000 && val < 100000) {
      return excelSerialToDate(val);
    }
  }
  return String(val).trim();
}

function findHeaderRowIndex(rawRows: any[][]): number {
  for (let i = 0; i < Math.min(rawRows.length, 10); i++) {
    const row = rawRows[i];
    if (!row || !Array.isArray(row)) continue;
    let matchCount = 0;
    for (const cell of row) {
      const s = String(cell ?? "").trim();
      if (s && matchHeader(s)) matchCount++;
    }
    if (matchCount >= 2) return i;
  }
  return 0;
}

function getRawHeaderRow(fileName: string, buffer: Buffer): { headerRow: string[]; headerIdx: number; rawRows: any[][] } {
  const ext = fileName.toLowerCase().split(".").pop();

  if (ext === "csv") {
    const lines = buffer.toString("utf8").split(/\r?\n/).filter(Boolean);
    if (lines.length < 1) return { headerRow: [], headerIdx: 0, rawRows: [] };
    const rawRows = lines.map((line) => parseCsvLine(line));
    const headerIdx = findHeaderRowIndex(rawRows);
    return { headerRow: rawRows[headerIdx].map((h) => String(h).trim()), headerIdx, rawRows };
  }

  if (ext !== "xlsx" && ext !== "xls") {
    throw new Error(`Unsupported file type: .${ext}. Please upload a .csv, .xlsx, or .xls file.`);
  }

  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  if (rawRows.length < 2) return { headerRow: [], headerIdx: 0, rawRows };

  const headerIdx = findHeaderRowIndex(rawRows);
  const headerRow = rawRows[headerIdx].map((h: any) => String(h).trim());
  return { headerRow, headerIdx, rawRows };
}

export function parseHeaders(
  fileName: string,
  buffer: Buffer,
): ImportParseHeadersResponse {
  const { headerRow, headerIdx, rawRows } = getRawHeaderRow(fileName, buffer);

  const mapped: ImportHeaderMapping[] = [];
  const unmapped: ImportHeaderMapping[] = [];

  headerRow.forEach((col, i) => {
    if (!col) return;
    const match = matchHeader(col);
    if (match) {
      mapped.push({ column: col, index: i, mappedTo: match });
    } else {
      if (MONTH_NAMES.includes(col.toLowerCase())) return;
      if (col.toLowerCase() === "comments" || col.toLowerCase() === "q1" || col.toLowerCase() === "q2" || col.toLowerCase() === "q3" || col.toLowerCase() === "q4") return;
      unmapped.push({ column: col, index: i, mappedTo: null });
    }
  });

  const sampleData: Record<number, string[]> = {};
  const dataRows = rawRows.slice(headerIdx + 1);
  for (const entry of unmapped) {
    const samples: string[] = [];
    for (let r = 0; r < Math.min(dataRows.length, 5); r++) {
      const val = String(dataRows[r]?.[entry.index] ?? "").trim();
      if (val) samples.push(val);
    }
    sampleData[entry.index] = samples;
  }

  const sampleRows: string[][] = [];
  for (let r = 0; r < Math.min(dataRows.length, 5); r++) {
    const row = dataRows[r];
    if (!row) continue;
    sampleRows.push(headerRow.map((_, i) => String(row[i] ?? "").trim()));
  }

  return {
    mappedHeaders: mapped,
    unmappedHeaders: unmapped,
    availableFields: AVAILABLE_FIELDS,
    sampleData,
    sampleRows,
    allHeaders: headerRow,
  };
}

function parseFileToRows(
  fileName: string,
  buffer: Buffer,
  headerOverrides?: Record<number, string>,
): { headers: string[]; rows: Record<string, string>[] } {
  const ext = fileName.toLowerCase().split(".").pop();

  if (ext === "csv") {
    return parseCsvToRows(buffer.toString("utf8"), headerOverrides);
  }

  if (ext !== "xlsx" && ext !== "xls") {
    throw new Error(`Unsupported file type: .${ext}. Please upload a .csv, .xlsx, or .xls file.`);
  }

  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

  if (rawRows.length < 2) return { headers: [], rows: [] };

  const headerIdx = findHeaderRowIndex(rawRows);
  const headerRow = rawRows[headerIdx].map((h: any) => String(h).trim());
  const mappedHeaders = headerRow.map((h, i) => {
    if (headerOverrides && headerOverrides[i]) return headerOverrides[i];
    return matchHeader(h) || h.toLowerCase();
  });
  const dataRows = rawRows.slice(headerIdx + 1)
    .filter((row) => row.some((cell: any) => cell !== null && cell !== undefined && String(cell).trim() !== ""))
    .map((row) => {
      const obj: Record<string, string> = {};
      mappedHeaders.forEach((key, i) => {
        obj[key] = cellToString(row[i], key);
      });
      return obj;
    });

  return { headers: mappedHeaders, rows: dataRows };
}

function parseCsvToRows(csv: string, headerOverrides?: Record<number, string>): { headers: string[]; rows: Record<string, string>[] } {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { headers: [], rows: [] };

  const rawRows = lines.map((line) => parseCsvLine(line));
  const headerIdx = findHeaderRowIndex(rawRows);

  const rawHeaders = rawRows[headerIdx];
  const mappedHeaders = rawHeaders.map((h, i) => {
    if (headerOverrides && headerOverrides[i]) return headerOverrides[i];
    return matchHeader(h) || h.trim().toLowerCase();
  });

  const dataRows = rawRows.slice(headerIdx + 1);
  const rows = dataRows.map((cols) => {
    const obj: Record<string, string> = {};
    mappedHeaders.forEach((key, i) => {
      obj[key] = (cols[i] ?? "").trim();
    });
    return obj;
  });

  return { headers: mappedHeaders, rows };
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  return result;
}

function splitCommaList(val: string): string[] {
  if (!val) return [];
  return val.split(",").map((s) => s.trim()).filter(Boolean);
}

function normalizeOwners(val: string): string {
  if (!val || val.toLowerCase() === "unassigned") return "";
  return val.split(/\s*[\/,]\s*/).map((s) => s.trim()).filter(Boolean).join(" / ");
}

function parseJiraKeys(val: string): string[] {
  if (!val) return [];
  const keyPattern = /[A-Z][A-Z0-9]+-\d+/g;
  const matches = val.match(keyPattern);
  return matches || [];
}

function normalizeConfidence(val: string): string | undefined {
  if (!val) return undefined;
  const lower = val.toLowerCase().trim();
  if (lower === "high") return "high";
  if (lower === "medium" || lower === "med") return "medium";
  if (lower === "low") return "low";
  return undefined;
}

function normalizeStatus(val: string): string | undefined {
  if (!val) return undefined;
  const lower = val.toLowerCase().trim();
  if (lower === "not started" || lower === "not_started") return "not_started";
  if (lower === "in discovery" || lower === "in_discovery") return "in_discovery";
  if (lower === "in progress" || lower === "in_progress") return "in_progress";
  if (lower === "paused" || lower === "on hold" || lower === "paused/on hold") return "paused";
  if (lower === "completed" || lower === "done" || lower === "complete") return "completed";
  return undefined;
}

interface TacticDraft {
  name: string;
  description?: string;
  status?: string;
  deliveryConfidence?: string;
  tags?: string[];
  themes?: string[];
  startDate?: string;
  endDate?: string;
  jiraKeys?: string[];
  depDescription?: string;
  depTeam?: string;
  depNeededBy?: string;
  depActualDelivery?: string;
  depStatus?: string;
  depCriticality?: string;
  depNotes?: string;
  hasDep?: boolean;
}

function splitDomainSubDomain(raw: string): { domain: string; subDomain?: string } {
  const sep = raw.includes("→") ? "→" : raw.includes(">") ? ">" : null;
  if (!sep) return { domain: raw.trim() };
  const parts = raw.split(sep, 2);
  const domain = parts[0].trim();
  const subDomain = parts[1]?.trim() || undefined;
  return { domain, subDomain };
}

interface InvestmentGroup {
  pillar: string;
  priority: string;
  investment: string;
  description: string;
  domain: string;
  subDomain?: string;
  owners: string;
  tags: string[];
  themes: string[];
  jiraKeys: string[];
  tactics: TacticDraft[];
  startDate?: string;
  endDate?: string;
  leadingIndicators?: string;
}

export function parseToDrafts(
  fileName: string,
  buffer: Buffer,
  actor: string,
  headerOverrides?: Record<number, string>,
): ImportJob {
  const { rows } = parseFileToRows(fileName, buffer, headerOverrides);

  let currentPillar = "";
  let currentPriority = "";
  let currentInvestment = "";
  let currentDomain = "";
  let currentSubDomain: string | undefined = undefined;
  let currentOwners = "";

  const investmentGroups: Map<string, InvestmentGroup> = new Map();

  for (const row of rows) {
    if (row.strategicPillar) currentPillar = row.strategicPillar;
    if (row.productPriority) currentPriority = row.productPriority;

    const investmentName = (row.investment || "").replace(/^[-–—•·]\s*/, "");
    const tacticName = (row.tactics || "").replace(/^[-–—•·]\s*/, "");

    const isNewInvestmentRow = !!investmentName;

    if (isNewInvestmentRow) {
      if (row.domain) {
        const split = splitDomainSubDomain(row.domain);
        currentDomain = split.domain;
        currentSubDomain = split.subDomain;
      } else {
        currentDomain = "";
        currentSubDomain = undefined;
      }
      if (row.subDomain) currentSubDomain = row.subDomain;
      else if (!row.domain) currentSubDomain = undefined;
      currentOwners = normalizeOwners(row.owners || "");
      currentInvestment = investmentName;
    } else {
      if (row.domain) {
        const split = splitDomainSubDomain(row.domain);
        currentDomain = split.domain;
        currentSubDomain = split.subDomain;
      }
      if (row.subDomain) currentSubDomain = row.subDomain;
      if (row.owners) currentOwners = normalizeOwners(row.owners);
    }

    if (!currentInvestment) continue;

    const groupKey = `${currentPillar}|||${currentPriority}|||${currentInvestment}|||${currentDomain}|||${currentSubDomain || ""}|||${currentOwners}`;

    if (!investmentGroups.has(groupKey)) {
      investmentGroups.set(groupKey, {
        pillar: currentPillar || "Uncategorized",
        priority: currentPriority || "Imported Priority",
        investment: currentInvestment,
        description: row.description || "",
        domain: currentDomain || "",
        subDomain: currentSubDomain,
        owners: currentOwners || "",
        tags: splitCommaList(row.tags),
        themes: splitCommaList(row.themes),
        jiraKeys: parseJiraKeys(row.jira),
        tactics: [],
        startDate: row.startDate,
        endDate: row.endDate,
        leadingIndicators: (row.leadingIndicators || "").trim() || undefined,
      });
    }

    const group = investmentGroups.get(groupKey)!;

    if (tacticName) {
      const hasDep = (row.depYesNo || "").toLowerCase().startsWith("y") ||
        !!(row.depDescription || row.depTeam);

      group.tactics.push({
        name: tacticName,
        description: row.description || undefined,
        status: normalizeStatus(row.status),
        deliveryConfidence: normalizeConfidence(row.confidence),
        tags: splitCommaList(row.tags),
        themes: splitCommaList(row.themes),
        startDate: row.startDate,
        endDate: row.endDate,
        jiraKeys: parseJiraKeys(row.jira),
        hasDep,
        depDescription: row.depDescription || undefined,
        depTeam: row.depTeam || undefined,
        depNeededBy: row.depNeededBy || undefined,
        depActualDelivery: row.depActualDelivery || undefined,
        depStatus: row.depStatus || undefined,
        depCriticality: row.depCriticality || undefined,
        depNotes: row.depNotes || undefined,
      });
    }

    if (investmentName) {
      if (row.description && !group.description) group.description = row.description;
      const rowTags = splitCommaList(row.tags);
      if (rowTags.length > 0 && group.tags.length === 0) group.tags = rowTags;
      const rowThemes = splitCommaList(row.themes);
      if (rowThemes.length > 0 && group.themes.length === 0) group.themes = rowThemes;
      const rowJira = parseJiraKeys(row.jira);
      if (rowJira.length > 0) group.jiraKeys.push(...rowJira);
      if (row.leadingIndicators && !group.leadingIndicators) group.leadingIndicators = row.leadingIndicators.trim();
    }

    if (!group.startDate && row.startDate) group.startDate = row.startDate;
    if (row.endDate) group.endDate = row.endDate;
  }

  const changes: ImportDraftChange[] = [];
  for (const group of investmentGroups.values()) {
    const proposed: Partial<RoadmapRow> = {
      strategicPillar: group.pillar,
      productPriority: group.priority,
      investment: group.investment,
      description: group.description || undefined,
      domain: group.domain,
      subDomain: group.subDomain,
      owners: group.owners,
      tags: group.tags.length > 0 ? group.tags : undefined,
      themes: group.themes.length > 0 ? group.themes : undefined,
      tactics: group.tactics.map((t) => {
        const tactic: any = {
          id: crypto.randomUUID(),
          name: t.name,
          description: t.description,
          status: t.status,
          deliveryConfidence: t.deliveryConfidence,
          tags: t.tags && t.tags.length > 0 ? t.tags : undefined,
          themes: t.themes && t.themes.length > 0 ? t.themes : undefined,
          timeline: t.startDate && t.endDate ? { start: t.startDate, end: t.endDate } : undefined,
          jiraLinks: (t.jiraKeys || []).map((key) => ({
            id: crypto.randomUUID(),
            key,
            title: key,
            issueType: "initiative" as const,
            url: "",
          })),
        };

        if (t.hasDep) {
          tactic.dependencies = [{
            id: crypto.randomUUID(),
            isDependency: true,
            target: t.depDescription ? { type: "freeform", freeformText: t.depDescription } : undefined,
            description: t.depDescription,
            team: t.depTeam,
            neededByDate: t.depNeededBy,
            actualDeliveryDate: t.depActualDelivery,
            status: t.depStatus || undefined,
            criticality: t.depCriticality || undefined,
            notes: t.depNotes,
          }];
        }

        return tactic;
      }),
      jiraLinks: group.jiraKeys.map((key) => ({
        id: crypto.randomUUID(),
        key,
        title: key,
        issueType: "initiative" as const,
        url: "",
      })),
      sourceOfTruth: {
        strategicPillar: "manual",
        productPriority: "manual",
        investment: "manual",
        tactics: "manual",
        jiraLinks: "jira",
      },
    };

    if (group.startDate && group.endDate) {
      proposed.timeline = { start: group.startDate, end: group.endDate };
    }

    changes.push({
      id: crypto.randomUUID(),
      action: "create",
      status: "accepted",
      confidence: scoreConfidence(proposed),
      rationale: `Parsed from ${fileName}. ${group.tactics.length} tactic(s) found.`,
      sourceRef: `${fileName}`,
      proposed,
      leadingIndicators: group.leadingIndicators,
    });
  }

  return {
    id: crypto.randomUUID(),
    fileName,
    status: "ready_for_review",
    createdAt: new Date().toISOString(),
    createdBy: actor,
    draftChanges: changes,
    headerOverrides,
  };
}

export function parsePastedHeaders(
  rawText: string,
): ImportParseHeadersResponse | null {
  const lines = rawText.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;

  const firstLine = lines[0];
  const tabCount = (firstLine.match(/\t/g) || []).length;
  if (tabCount < 2) return null;

  const rawRows = lines.map((line) => line.split("\t"));
  const headerIdx = findHeaderRowIndex(rawRows);
  const headerRow = rawRows[headerIdx].map((h) => h.trim());

  const mapped: ImportHeaderMapping[] = [];
  const unmapped: ImportHeaderMapping[] = [];

  headerRow.forEach((col, i) => {
    if (!col) return;
    const match = matchHeader(col);
    if (match) {
      mapped.push({ column: col, index: i, mappedTo: match });
    } else {
      if (MONTH_NAMES.includes(col.toLowerCase())) return;
      if (["comments", "q1", "q2", "q3", "q4"].includes(col.toLowerCase())) return;
      unmapped.push({ column: col, index: i, mappedTo: null });
    }
  });

  const sampleData: Record<number, string[]> = {};
  const dataRows = rawRows.slice(headerIdx + 1);
  for (const entry of unmapped) {
    const samples: string[] = [];
    for (let r = 0; r < Math.min(dataRows.length, 5); r++) {
      const val = String(dataRows[r]?.[entry.index] ?? "").trim();
      if (val) samples.push(val);
    }
    sampleData[entry.index] = samples;
  }

  const sampleRows: string[][] = [];
  for (let r = 0; r < Math.min(dataRows.length, 5); r++) {
    const row = dataRows[r];
    if (!row) continue;
    sampleRows.push(headerRow.map((_, i) => String(row[i] ?? "").trim()));
  }

  return {
    mappedHeaders: mapped,
    unmappedHeaders: unmapped,
    availableFields: AVAILABLE_FIELDS,
    sampleData,
    sampleRows,
    allHeaders: headerRow,
  };
}

export function parsePastedTextDirect(
  rawText: string,
  actor: string,
  headerOverrides?: Record<number, string>,
): ImportJob | null {
  const lines = rawText.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;

  const firstLine = lines[0];
  const tabCount = (firstLine.match(/\t/g) || []).length;
  if (tabCount < 2) return null;

  const rawRows = lines.map((line) => line.split("\t"));
  const headerIdx = findHeaderRowIndex(rawRows);

  const rawHeaders = rawRows[headerIdx];
  let matchedCount = 0;
  const mappedHeaders = rawHeaders.map((h, i) => {
    if (headerOverrides && headerOverrides[i]) {
      matchedCount++;
      return headerOverrides[i];
    }
    const mapped = matchHeader(h.trim());
    if (mapped) matchedCount++;
    return mapped || h.trim().toLowerCase();
  });

  if (matchedCount < 2) return null;

  const dataRows = rawRows.slice(headerIdx + 1)
    .filter((row) => row.some((cell) => cell.trim() !== ""))
    .map((cols) => {
      const obj: Record<string, string> = {};
      mappedHeaders.forEach((key, i) => {
        obj[key] = (cols[i] ?? "").trim();
      });
      return obj;
    });

  if (dataRows.length === 0) return null;

  return parseToDraftsFromRows(dataRows, "pasted-data.tsv", actor);
}

export function parseToDraftsFromRows(
  rows: Record<string, string>[],
  fileName: string,
  actor: string,
): ImportJob {
  let currentPillar = "";
  let currentPriority = "";
  let currentInvestment = "";
  let currentDomain = "";
  let currentSubDomain: string | undefined = undefined;
  let currentOwners = "";

  const investmentGroups: Map<string, InvestmentGroup> = new Map();

  for (const row of rows) {
    if (row.strategicPillar) currentPillar = row.strategicPillar;
    if (row.productPriority) currentPriority = row.productPriority;

    const investmentName = (row.investment || "").replace(/^[-–—•·]\s*/, "");
    const tacticName = (row.tactics || "").replace(/^[-–—•·]\s*/, "");

    const isNewInvestmentRow = !!investmentName;

    if (isNewInvestmentRow) {
      if (row.domain) {
        const split = splitDomainSubDomain(row.domain);
        currentDomain = split.domain;
        currentSubDomain = split.subDomain;
      } else {
        currentDomain = "";
        currentSubDomain = undefined;
      }
      if (row.subDomain) currentSubDomain = row.subDomain;
      else if (!row.domain) currentSubDomain = undefined;
      currentOwners = normalizeOwners(row.owners || "");
      currentInvestment = investmentName;
    } else {
      if (row.domain) {
        const split = splitDomainSubDomain(row.domain);
        currentDomain = split.domain;
        currentSubDomain = split.subDomain;
      }
      if (row.subDomain) currentSubDomain = row.subDomain;
      if (row.owners) currentOwners = normalizeOwners(row.owners);
    }

    if (!currentInvestment) continue;

    const groupKey = `${currentPillar}|||${currentPriority}|||${currentInvestment}|||${currentDomain}|||${currentSubDomain || ""}|||${currentOwners}`;

    if (!investmentGroups.has(groupKey)) {
      investmentGroups.set(groupKey, {
        pillar: currentPillar || "Uncategorized",
        priority: currentPriority || "Imported Priority",
        investment: currentInvestment,
        description: row.description || "",
        domain: currentDomain || "",
        subDomain: currentSubDomain,
        owners: currentOwners || "",
        tags: splitCommaList(row.tags),
        themes: splitCommaList(row.themes),
        jiraKeys: parseJiraKeys(row.jira),
        tactics: [],
        startDate: row.startDate,
        endDate: row.endDate,
        leadingIndicators: (row.leadingIndicators || "").trim() || undefined,
      });
    }

    const group = investmentGroups.get(groupKey)!;

    if (tacticName) {
      const hasDep = (row.depYesNo || "").toLowerCase().startsWith("y") ||
        !!(row.depDescription || row.depTeam);

      group.tactics.push({
        name: tacticName,
        description: row.description || undefined,
        status: normalizeStatus(row.status),
        deliveryConfidence: normalizeConfidence(row.confidence),
        tags: splitCommaList(row.tags),
        themes: splitCommaList(row.themes),
        startDate: row.startDate,
        endDate: row.endDate,
        jiraKeys: parseJiraKeys(row.jira),
        hasDep,
        depDescription: row.depDescription || undefined,
        depTeam: row.depTeam || undefined,
        depNeededBy: row.depNeededBy || undefined,
        depActualDelivery: row.depActualDelivery || undefined,
        depStatus: row.depStatus || undefined,
        depCriticality: row.depCriticality || undefined,
        depNotes: row.depNotes || undefined,
      });
    }

    if (investmentName) {
      if (row.description && !group.description) group.description = row.description;
      const rowTags = splitCommaList(row.tags);
      if (rowTags.length > 0 && group.tags.length === 0) group.tags = rowTags;
      const rowThemes = splitCommaList(row.themes);
      if (rowThemes.length > 0 && group.themes.length === 0) group.themes = rowThemes;
      const rowJira = parseJiraKeys(row.jira);
      if (rowJira.length > 0) group.jiraKeys.push(...rowJira);
      if (row.leadingIndicators && !group.leadingIndicators) group.leadingIndicators = row.leadingIndicators.trim();
    }

    if (!group.startDate && row.startDate) group.startDate = row.startDate;
    if (row.endDate) group.endDate = row.endDate;
  }

  const changes: ImportDraftChange[] = [];
  for (const group of investmentGroups.values()) {
    const proposed: Partial<RoadmapRow> = {
      strategicPillar: group.pillar,
      productPriority: group.priority,
      investment: group.investment,
      description: group.description || undefined,
      domain: group.domain,
      subDomain: group.subDomain,
      owners: group.owners,
      tags: group.tags.length > 0 ? group.tags : undefined,
      themes: group.themes.length > 0 ? group.themes : undefined,
      tactics: group.tactics.map((t) => {
        const tactic: any = {
          id: crypto.randomUUID(),
          name: t.name,
          description: t.description,
          status: t.status,
          deliveryConfidence: t.deliveryConfidence,
          tags: t.tags && t.tags.length > 0 ? t.tags : undefined,
          themes: t.themes && t.themes.length > 0 ? t.themes : undefined,
          timeline: t.startDate && t.endDate ? { start: t.startDate, end: t.endDate } : undefined,
          jiraLinks: (t.jiraKeys || []).map((key) => ({
            id: crypto.randomUUID(),
            key,
            title: key,
            issueType: "initiative" as const,
            url: "",
          })),
        };

        if (t.hasDep) {
          tactic.dependencies = [{
            id: crypto.randomUUID(),
            isDependency: true,
            target: t.depDescription ? { type: "freeform", freeformText: t.depDescription } : undefined,
            description: t.depDescription,
            team: t.depTeam,
            neededByDate: t.depNeededBy,
            actualDeliveryDate: t.depActualDelivery,
            status: t.depStatus || undefined,
            criticality: t.depCriticality || undefined,
            notes: t.depNotes,
          }];
        }

        return tactic;
      }),
      jiraLinks: group.jiraKeys.map((key) => ({
        id: crypto.randomUUID(),
        key,
        title: key,
        issueType: "initiative" as const,
        url: "",
      })),
      sourceOfTruth: {
        strategicPillar: "manual",
        productPriority: "manual",
        investment: "manual",
        tactics: "manual",
        jiraLinks: "jira",
      },
    };

    if (group.startDate && group.endDate) {
      proposed.timeline = { start: group.startDate, end: group.endDate };
    }

    changes.push({
      id: crypto.randomUUID(),
      action: "create",
      status: "accepted",
      confidence: scoreConfidence(proposed),
      rationale: `Parsed from pasted data. ${group.tactics.length} tactic(s) found.`,
      sourceRef: "paste",
      proposed,
      leadingIndicators: group.leadingIndicators,
    });
  }

  return {
    id: crypto.randomUUID(),
    fileName,
    status: "ready_for_review",
    createdAt: new Date().toISOString(),
    createdBy: actor,
    draftChanges: changes,
  };
}

export function parseToDraftsFromAiRows(
  aiRows: Array<Record<string, string | undefined>>,
  actor: string,
): ImportJob {
  const normalizedRows = aiRows.map((row) => {
    const normalized: Record<string, string> = {};
    for (const [key, val] of Object.entries(row)) {
      const mapped = matchHeader(key) || key;
      normalized[mapped] = val || "";
    }
    return normalized;
  });

  return parseToDraftsFromRows(normalizedRows, "pasted-data-ai.txt", actor);
}

function scoreConfidence(row: Partial<RoadmapRow>): number {
  let score = 0.3;
  if (row.strategicPillar && row.strategicPillar !== "Uncategorized") score += 0.1;
  if (row.productPriority && row.productPriority !== "Imported Priority") score += 0.1;
  if (row.investment && row.investment !== "Imported Investment") score += 0.1;
  if (row.tactics && row.tactics.length > 0) score += 0.1;
  if (row.owners && row.owners !== "Unassigned") score += 0.05;
  if (row.description) score += 0.05;
  if (row.tags && row.tags.length > 0) score += 0.05;
  if (row.themes && row.themes.length > 0) score += 0.05;
  if (row.domain && row.domain !== "Unknown") score += 0.05;
  if (row.jiraLinks && row.jiraLinks.length > 0) score += 0.05;
  return Math.min(0.99, score);
}

const INVESTMENT_MATCH_THRESHOLD = 0.65;
const TACTIC_MATCH_THRESHOLD = 0.7;

interface ExistingTacticEntry {
  tacticId: string;
  tacticName: string;
  rowId: string;
  investmentName: string;
}

export function detectMatchesForDrafts(
  draftChanges: ImportDraftChange[],
  existingRows: RoadmapRow[],
): ImportDraftChange[] {
  if (existingRows.length === 0) return draftChanges;

  const investmentFuse = new Fuse(existingRows, {
    keys: ["investment"],
    threshold: 1 - INVESTMENT_MATCH_THRESHOLD,
    includeScore: true,
    isCaseSensitive: false,
  });

  const allExistingTactics: ExistingTacticEntry[] = [];
  for (const row of existingRows) {
    for (const t of row.tactics) {
      allExistingTactics.push({
        tacticId: t.id,
        tacticName: t.name,
        rowId: row.id,
        investmentName: row.investment,
      });
    }
  }

  const tacticFuse = allExistingTactics.length > 0
    ? new Fuse(allExistingTactics, {
        keys: ["tacticName"],
        threshold: 1 - TACTIC_MATCH_THRESHOLD,
        includeScore: true,
        isCaseSensitive: false,
      })
    : null;

  return draftChanges.map((change) => {
    const investmentName = change.proposed.investment || "";
    if (!investmentName) return change;

    const investmentResults = investmentFuse.search(investmentName);

    let bestInvestmentMatch: { row: RoadmapRow; similarity: number } | null = null;
    for (const result of investmentResults) {
      const similarity = 1 - (result.score ?? 1);
      let boostedSimilarity = similarity;

      if (change.proposed.strategicPillar && result.item.strategicPillar &&
          change.proposed.strategicPillar.toLowerCase() === result.item.strategicPillar.toLowerCase()) {
        boostedSimilarity = Math.min(1, boostedSimilarity + 0.05);
      }
      if (change.proposed.domain && result.item.domain &&
          change.proposed.domain.toLowerCase() === result.item.domain.toLowerCase()) {
        boostedSimilarity = Math.min(1, boostedSimilarity + 0.03);
      }

      if (boostedSimilarity >= INVESTMENT_MATCH_THRESHOLD) {
        if (!bestInvestmentMatch || boostedSimilarity > bestInvestmentMatch.similarity) {
          bestInvestmentMatch = { row: result.item, similarity: boostedSimilarity };
        }
      }
    }

    const draftTactics = (change.proposed.tactics || []) as Tactic[];
    const tacticMatches: ImportTacticMatch[] = [];
    const newTactics: string[] = [];

    if (tacticFuse && draftTactics.length > 0) {
      for (const dt of draftTactics) {
        const tacticResults = tacticFuse.search(dt.name);
        let bestSameInvestmentMatch: { entry: ExistingTacticEntry; similarity: number } | null = null;
        let bestCrossInvestmentMatch: { entry: ExistingTacticEntry; similarity: number } | null = null;

        for (const tr of tacticResults) {
          const sim = 1 - (tr.score ?? 1);
          if (sim >= TACTIC_MATCH_THRESHOLD) {
            const isSameInvestment = bestInvestmentMatch && tr.item.rowId === bestInvestmentMatch.row.id;
            if (isSameInvestment) {
              if (!bestSameInvestmentMatch || sim > bestSameInvestmentMatch.similarity) {
                bestSameInvestmentMatch = { entry: tr.item, similarity: sim };
              }
            } else {
              if (!bestCrossInvestmentMatch || sim > bestCrossInvestmentMatch.similarity) {
                bestCrossInvestmentMatch = { entry: tr.item, similarity: sim };
              }
            }
          }
        }

        if (bestSameInvestmentMatch) {
          tacticMatches.push({
            draftTacticName: dt.name,
            existingTacticId: bestSameInvestmentMatch.entry.tacticId,
            existingTacticName: bestSameInvestmentMatch.entry.tacticName,
            existingRowId: bestSameInvestmentMatch.entry.rowId,
            existingInvestmentName: bestSameInvestmentMatch.entry.investmentName,
            similarity: bestSameInvestmentMatch.similarity,
          });
        } else {
          newTactics.push(dt.name);
          if (bestCrossInvestmentMatch) {
            tacticMatches.push({
              draftTacticName: dt.name,
              existingTacticId: bestCrossInvestmentMatch.entry.tacticId,
              existingTacticName: bestCrossInvestmentMatch.entry.tacticName,
              existingRowId: bestCrossInvestmentMatch.entry.rowId,
              existingInvestmentName: bestCrossInvestmentMatch.entry.investmentName,
              similarity: bestCrossInvestmentMatch.similarity,
            });
          }
        }
      }
    } else {
      for (const dt of draftTactics) {
        newTactics.push(dt.name);
      }
    }

    const matchDetails: ImportMatchDetails = {};
    let action: "create" | "update" = "create";
    let existingRowId: string | undefined;
    let rationale = change.rationale;

    let existingData: Partial<RoadmapRow> | undefined;
    let existingUpdatedBy: string | undefined;
    let existingUpdatedAt: string | undefined;

    if (bestInvestmentMatch) {
      matchDetails.investmentMatch = {
        existingRowId: bestInvestmentMatch.row.id,
        existingName: bestInvestmentMatch.row.investment,
        similarity: Math.round(bestInvestmentMatch.similarity * 100) / 100,
      };
      action = "update";
      existingRowId = bestInvestmentMatch.row.id;

      const matchedRow = bestInvestmentMatch.row;
      existingData = {
        themes: matchedRow.themes,
        tags: matchedRow.tags,
        description: matchedRow.description,
        domain: matchedRow.domain,
        subDomain: matchedRow.subDomain,
        owners: matchedRow.owners,
        timeline: matchedRow.timeline,
        strategicPillar: matchedRow.strategicPillar,
        productPriority: matchedRow.productPriority,
      };
      existingUpdatedBy = matchedRow.updatedBy;
      existingUpdatedAt = matchedRow.updatedAt;

      if (newTactics.length > 0 || draftTactics.length === 0) {
        rationale = `Matched existing investment "${bestInvestmentMatch.row.investment}" (${Math.round(bestInvestmentMatch.similarity * 100)}%). ${newTactics.length} new tactic(s), ${tacticMatches.filter((t) => t.existingRowId === bestInvestmentMatch!.row.id).length} existing.`;
      } else {
        rationale = `Matched existing investment "${bestInvestmentMatch.row.investment}" (${Math.round(bestInvestmentMatch.similarity * 100)}%). All ${tacticMatches.length} tactic(s) already exist — field updates only.`;
      }
    }

    if (tacticMatches.length > 0) {
      matchDetails.tacticMatches = tacticMatches;
    }
    if (newTactics.length > 0) {
      matchDetails.newTactics = newTactics;
    }

    const hasMatchInfo = matchDetails.investmentMatch || (matchDetails.tacticMatches && matchDetails.tacticMatches.length > 0);

    return {
      ...change,
      action,
      existingRowId,
      matchDetails: hasMatchInfo || newTactics.length > 0 ? matchDetails : undefined,
      rationale,
      existingData,
      existingUpdatedBy,
      existingUpdatedAt,
    };
  });
}

export interface SlideMatchResult {
  investmentMatch?: {
    existingRowId: string;
    existingName: string;
    similarity: number;
    existingTacticCount: number;
    domain?: string;
    pillar?: string;
  };
  tacticMatches: Array<{
    draftTacticName: string;
    existingTacticId: string;
    existingTacticName: string;
    existingRowId: string;
    existingInvestmentName: string;
    similarity: number;
    isSameInvestment: boolean;
  }>;
  newTactics: string[];
}

export function detectSlideMatches(
  investmentName: string,
  tacticNames: string[],
  existingRows: RoadmapRow[],
  opts?: { domain?: string; pillar?: string },
): SlideMatchResult {
  const result: SlideMatchResult = { tacticMatches: [], newTactics: [] };
  if (existingRows.length === 0) {
    result.newTactics = [...tacticNames];
    return result;
  }

  const investmentFuse = new Fuse(existingRows, {
    keys: ["investment"],
    threshold: 1 - INVESTMENT_MATCH_THRESHOLD,
    includeScore: true,
    isCaseSensitive: false,
  });

  const investmentResults = investmentFuse.search(investmentName);
  let bestMatch: { row: RoadmapRow; similarity: number } | null = null;

  for (const r of investmentResults) {
    let sim = 1 - (r.score ?? 1);
    if (opts?.pillar && r.item.strategicPillar &&
        opts.pillar.toLowerCase() === r.item.strategicPillar.toLowerCase()) {
      sim = Math.min(1, sim + 0.05);
    }
    if (opts?.domain && r.item.domain &&
        opts.domain.toLowerCase() === r.item.domain.toLowerCase()) {
      sim = Math.min(1, sim + 0.03);
    }
    if (sim >= INVESTMENT_MATCH_THRESHOLD && (!bestMatch || sim > bestMatch.similarity)) {
      bestMatch = { row: r.item, similarity: sim };
    }
  }

  if (bestMatch) {
    result.investmentMatch = {
      existingRowId: bestMatch.row.id,
      existingName: bestMatch.row.investment,
      similarity: Math.round(bestMatch.similarity * 100) / 100,
      existingTacticCount: bestMatch.row.tactics.length,
      domain: bestMatch.row.domain,
      pillar: bestMatch.row.strategicPillar,
    };
  }

  if (tacticNames.length === 0) {
    return result;
  }

  const allExistingTactics: ExistingTacticEntry[] = [];
  for (const row of existingRows) {
    for (const t of row.tactics) {
      allExistingTactics.push({
        tacticId: t.id,
        tacticName: t.name,
        rowId: row.id,
        investmentName: row.investment,
      });
    }
  }

  if (allExistingTactics.length === 0) {
    result.newTactics = [...tacticNames];
    return result;
  }

  const tacticFuse = new Fuse(allExistingTactics, {
    keys: ["tacticName"],
    threshold: 1 - TACTIC_MATCH_THRESHOLD,
    includeScore: true,
    isCaseSensitive: false,
  });

  for (const tName of tacticNames) {
    const tacticResults = tacticFuse.search(tName);
    let bestTacticMatch: { entry: ExistingTacticEntry; similarity: number } | null = null;

    for (const tr of tacticResults) {
      const sim = 1 - (tr.score ?? 1);
      if (sim >= TACTIC_MATCH_THRESHOLD) {
        if (!bestTacticMatch || sim > bestTacticMatch.similarity) {
          bestTacticMatch = { entry: tr.item, similarity: sim };
        }
      }
    }

    if (bestTacticMatch) {
      result.tacticMatches.push({
        draftTacticName: tName,
        existingTacticId: bestTacticMatch.entry.tacticId,
        existingTacticName: bestTacticMatch.entry.tacticName,
        existingRowId: bestTacticMatch.entry.rowId,
        existingInvestmentName: bestTacticMatch.entry.investmentName,
        similarity: bestTacticMatch.similarity,
        isSameInvestment: bestMatch ? bestTacticMatch.entry.rowId === bestMatch.row.id : false,
      });
    } else {
      result.newTactics.push(tName);
    }
  }

  return result;
}
