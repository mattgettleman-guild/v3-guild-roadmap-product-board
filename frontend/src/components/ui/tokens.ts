/**
 * Shared design tokens — single source of truth for colors, status maps,
 * and Guild fiscal quarters. Import from here instead of defining locally.
 */

// ─── Domain colors ────────────────────────────────────────────────────────────

export const DOMAIN_COLORS: Record<string, string> = {
  Engineering: "#d97706",
  Design: "#7c3aed",
  Product: "#0d9488",
  Marketing: "#db2777",
  Sales: "#2563eb",
  Operations: "#ea580c",
  Finance: "#059669",
  Legal: "#6366f1",
  Support: "#0891b2",
  Platform: "#7c3aed",
  Grow: "#16a34a",
  Navigator: "#0891b2",
  Academy: "#2563eb",
  AI: "#9333ea",
  Analytics: "#0d9488",
  Technology: "#64748b",
  Foundations: "#db2777",
};

const DOMAIN_FALLBACK_COLORS = [
  "#d97706", "#ea580c", "#b45309", "#0891b2",
  "#0d9488", "#2563eb", "#9333ea", "#db2777",
];

export function getDomainColor(domain: string, allDomains?: string[]): string {
  if (DOMAIN_COLORS[domain]) return DOMAIN_COLORS[domain];
  const idx = allDomains ? allDomains.indexOf(domain) : 0;
  let hash = 0;
  for (let i = 0; i < domain.length; i++) {
    hash = domain.charCodeAt(i) + ((hash << 5) - hash);
  }
  return DOMAIN_FALLBACK_COLORS[Math.abs(idx >= 0 ? idx : hash) % DOMAIN_FALLBACK_COLORS.length];
}

// ─── Pillar colors ────────────────────────────────────────────────────────────

const PILLAR_BASE_COLORS = [
  "#d97706", "#ea580c", "#b45309", "#c2410c",
  "#a16207", "#9a3412", "#854d0e",
];

export function getPillarColor(pillar: string): string {
  let hash = 0;
  for (let i = 0; i < pillar.length; i++) {
    hash = pillar.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PILLAR_BASE_COLORS[Math.abs(hash) % PILLAR_BASE_COLORS.length];
}

// ─── Status ───────────────────────────────────────────────────────────────────

/** Keyed by the display string used in RoadmapRow.status */
export interface StatusStyle {
  label: string;
  bg: string;
  text: string;
  dot: string;
  border: string;
}

export const STATUS_STYLES: Record<string, StatusStyle> = {
  "In Progress": {
    label: "In Progress",
    bg: "#fef3c7",
    text: "#b45309",
    dot: "#d97706",
    border: "#fcd34d",
  },
  "In Discovery": {
    label: "In Discovery",
    bg: "#ede9fe",
    text: "#7c3aed",
    dot: "#7c3aed",
    border: "#c4b5fd",
  },
  "Not Started": {
    label: "Not Started",
    bg: "#f1f5f9",
    text: "#64748b",
    dot: "#94a3b8",
    border: "#cbd5e1",
  },
  Completed: {
    label: "Completed",
    bg: "#d1fae5",
    text: "#059669",
    dot: "#059669",
    border: "#6ee7b7",
  },
  Paused: {
    label: "Paused",
    bg: "#fff7ed",
    text: "#c2410c",
    dot: "#ea580c",
    border: "#fdba74",
  },
};

export const ALL_STATUSES = Object.keys(STATUS_STYLES) as Array<keyof typeof STATUS_STYLES>;

// ─── Confidence ───────────────────────────────────────────────────────────────

export const CONFIDENCE_CLASSES: Record<string, string> = {
  high: "bg-emerald-100 text-emerald-700 border-emerald-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  low: "bg-red-100 text-red-700 border-red-200",
};

// ─── Guild fiscal quarters (FY27) ─────────────────────────────────────────────

export const GUILD_QUARTERS = [
  { label: "Q1", start: "2026-02-01", end: "2026-04-30" },
  { label: "Q2", start: "2026-05-01", end: "2026-07-31" },
  { label: "Q3", start: "2026-08-01", end: "2026-10-31" },
  { label: "Q4", start: "2026-11-01", end: "2027-01-31" },
] as const;

// ─── V3 Neutral palette (Notion-feel warm off-white) ──────────────────────────
export const NEUTRALS = {
  bg: "#FAFAF9",
  surface: "#FFFFFF",
  border: "#E5E5E3",
  textPrimary: "#1A1A18",
  textSecondary: "#6B7068",
  textTertiary: "#9CA39A",
} as const;

// ─── V3 Semantic status colors ────────────────────────────────────────────────
export const SEMANTIC_STATUS: Record<string, { bg: string; text: string; border: string }> = {
  "In Progress":    { bg: "#fef9c3", text: "#d97706", border: "#fde68a" },
  "In Discovery":   { bg: "#ede9fe", text: "#7c3aed", border: "#c4b5fd" },
  "Not Started":    { bg: "#f1f5f9", text: "#64748b", border: "#cbd5e1" },
  "Completed":      { bg: "#d1fae5", text: "#059669", border: "#6ee7b7" },
  "Paused":         { bg: "#fff7ed", text: "#ea580c", border: "#fdba74" },
  "Blocked":        { bg: "#fee2e2", text: "#dc2626", border: "#fca5a5" },
};

// ─── Brand color ──────────────────────────────────────────────────────────────
export const BRAND = "#d97706"; // amber-600
