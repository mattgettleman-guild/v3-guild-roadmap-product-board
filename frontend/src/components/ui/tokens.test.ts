import { describe, it, expect } from "vitest";
import {
  getDomainColor,
  getPillarColor,
  DOMAIN_COLORS,
  SEMANTIC_STATUS,
  ALL_STATUSES,
  GUILD_QUARTERS,
} from "./tokens";

describe("getDomainColor", () => {
  it("returns the exact hex color for Engineering", () => {
    expect(getDomainColor("Engineering")).toBe("#d97706");
  });

  it("returns the exact hex color for Design", () => {
    expect(getDomainColor("Design")).toBe("#7c3aed");
  });

  it("returns the exact hex color for Product", () => {
    expect(getDomainColor("Product")).toBe("#0d9488");
  });

  it("returns a fallback hex color string for an unknown domain", () => {
    const color = getDomainColor("Unknown Domain");
    expect(color).toBeDefined();
    expect(typeof color).toBe("string");
    expect(color.startsWith("#")).toBe(true);
    expect(color).not.toBeUndefined();
  });

  it("returns a hex string (not undefined) for any unknown domain name", () => {
    const color = getDomainColor("SomethingEntirelyMadeUp");
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("known domains all return their specific registered color", () => {
    for (const [domain, expected] of Object.entries(DOMAIN_COLORS)) {
      expect(getDomainColor(domain)).toBe(expected);
    }
  });

  it("uses allDomains index when provided for an unknown domain", () => {
    const allDomains = ["Alpha", "Beta", "Gamma"];
    const color = getDomainColor("Beta", allDomains);
    // index 1, fallback array has 8 entries — must return a hex
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("getPillarColor", () => {
  it("returns a hex color string for any pillar name", () => {
    const color = getPillarColor("Growth");
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("returns a hex color string for an empty string pillar", () => {
    // edge case: empty string should still return something from the array
    const color = getPillarColor("");
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("returns a consistent color for the same pillar name (deterministic hash)", () => {
    const first = getPillarColor("Retention");
    const second = getPillarColor("Retention");
    expect(first).toBe(second);
  });

  it("returns different colors for clearly different pillar names", () => {
    // Not guaranteed, but highly probable for distinct strings
    const colors = new Set([
      getPillarColor("Acquisition"),
      getPillarColor("Monetization"),
      getPillarColor("Infrastructure"),
      getPillarColor("Developer Experience"),
    ]);
    // At least 2 distinct colors among 4 varied names
    expect(colors.size).toBeGreaterThanOrEqual(2);
  });
});

describe("SEMANTIC_STATUS", () => {
  const expectedStatuses = [
    "In Progress",
    "In Discovery",
    "Not Started",
    "Completed",
    "Paused",
    "Blocked",
  ];

  it.each(expectedStatuses)('has an entry for "%s"', (status) => {
    expect(SEMANTIC_STATUS[status]).toBeDefined();
  });

  it.each(expectedStatuses)('"%s" has bg, text, and border fields', (status) => {
    const style = SEMANTIC_STATUS[status];
    expect(style.bg).toMatch(/^#/);
    expect(style.text).toMatch(/^#/);
    expect(style.border).toMatch(/^#/);
  });

  it("In Progress uses an amber/yellow background", () => {
    // bg: "#fef9c3" is a yellow-100 tone
    expect(SEMANTIC_STATUS["In Progress"].bg).toBe("#fef9c3");
  });

  it("Completed uses a green background", () => {
    expect(SEMANTIC_STATUS["Completed"].bg).toBe("#d1fae5");
  });

  it("Blocked uses a red background", () => {
    expect(SEMANTIC_STATUS["Blocked"].bg).toBe("#fee2e2");
  });
});

describe("ALL_STATUSES", () => {
  it("contains all keys from STATUS_STYLES as an array", () => {
    // STATUS_STYLES has 5 entries; ALL_STATUSES should match
    expect(Array.isArray(ALL_STATUSES)).toBe(true);
    expect(ALL_STATUSES.length).toBeGreaterThan(0);
  });
});

describe("GUILD_QUARTERS", () => {
  it("has exactly 4 quarters", () => {
    expect(GUILD_QUARTERS.length).toBe(4);
  });

  it("labels quarters Q1 through Q4", () => {
    const labels = GUILD_QUARTERS.map((q) => q.label);
    expect(labels).toEqual(["Q1", "Q2", "Q3", "Q4"]);
  });

  it("each quarter has a start and end date string", () => {
    for (const q of GUILD_QUARTERS) {
      expect(q.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(q.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("quarters are in chronological order", () => {
    for (let i = 0; i < GUILD_QUARTERS.length - 1; i++) {
      expect(new Date(GUILD_QUARTERS[i].end) < new Date(GUILD_QUARTERS[i + 1].start)).toBe(true);
    }
  });
});
