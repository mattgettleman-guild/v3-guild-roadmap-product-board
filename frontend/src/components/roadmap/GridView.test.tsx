import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { RoadmapRow } from "@roadmap/shared";

// ─── Module mocks (must be at top-level before any imports of the mocked modules) ─

vi.mock("../../hooks/useRows", () => ({
  useRows: vi.fn(),
  useUpdateRow: vi.fn(),
}));

vi.mock("../../hooks/useUIStore", () => ({
  useUIStore: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useSearch: vi.fn(),
  useNavigate: vi.fn(() => vi.fn()),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) =>
    createElement("a", { href: to }, children),
}));

// TanStack Virtual doesn't work well in jsdom — replace with a simple passthrough
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: vi.fn(({ count }: { count: number }) => ({
    getTotalSize: () => count * 40,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, i) => ({
        index: i,
        start: i * 40,
        size: 40,
        key: i,
        lane: 0,
        end: (i + 1) * 40,
        measureElement: undefined,
      })),
  })),
}));

import { createElement } from "react";
import { GridView } from "./GridView";
import { useRows, useUpdateRow } from "../../hooks/useRows";
import { useUIStore } from "../../hooks/useUIStore";
import { useSearch } from "@tanstack/react-router";

const mockUseRows = useRows as ReturnType<typeof vi.fn>;
const mockUseUpdateRow = useUpdateRow as ReturnType<typeof vi.fn>;
const mockUseUIStore = useUIStore as ReturnType<typeof vi.fn>;
const mockUseSearch = useSearch as ReturnType<typeof vi.fn>;

function makeRow(overrides: Partial<RoadmapRow> = {}): RoadmapRow {
  return {
    id: "row-1",
    investment: "Test Investment",
    domain: "Engineering",
    strategicPillar: "Growth",
    productPriority: "P1",
    owners: "alice@guild.com",
    status: "In Progress",
    tactics: [],
    jiraLinks: [],
    tags: [],
    themes: [],
    visibility: "internal_only",
    sourceOfTruth: {},
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    updatedBy: "alice@guild.com",
    expectedBenefits: [],
    ...overrides,
  };
}

const mockSelectRow = vi.fn();
const mockMutate = vi.fn();

function setupMocks(
  rows: RoadmapRow[],
  search: Record<string, string> = {},
  isLoading = false,
) {
  mockUseRows.mockReturnValue({ data: rows, isLoading });
  mockUseUpdateRow.mockReturnValue({ mutate: mockMutate });
  mockUseUIStore.mockReturnValue({ selectRow: mockSelectRow });
  mockUseSearch.mockReturnValue(search);
}

describe("GridView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders investment names from the rows array", () => {
    const rows = [
      makeRow({ id: "r1", investment: "Alpha Initiative" }),
      makeRow({ id: "r2", investment: "Beta Initiative" }),
    ];
    setupMocks(rows);
    render(<GridView />);
    expect(screen.getByText("Alpha Initiative")).toBeInTheDocument();
    expect(screen.getByText("Beta Initiative")).toBeInTheDocument();
  });

  it("shows skeleton rows (loading state) when isLoading is true", () => {
    setupMocks([], {}, true);
    const { container } = render(<GridView />);
    // Loading state renders animated skeleton pulse divs, not a text message
    const skeletonRows = container.querySelectorAll(".animate-pulse");
    expect(skeletonRows.length).toBeGreaterThan(0);
  });

  it('shows "No investments match the active filters" when filtered result is empty', () => {
    const rows = [makeRow({ strategicPillar: "Growth", id: "r1" })];
    setupMocks(rows, { pillar: "Retention" });
    render(<GridView />);
    expect(screen.getByText("No investments match the active filters")).toBeInTheDocument();
  });

  it("filters rows by pillar when search.pillar is set", () => {
    const rows = [
      makeRow({ id: "r1", investment: "Growth Item", strategicPillar: "Growth" }),
      makeRow({ id: "r2", investment: "Retention Item", strategicPillar: "Retention" }),
    ];
    setupMocks(rows, { pillar: "Growth" });
    render(<GridView />);
    expect(screen.getByText("Growth Item")).toBeInTheDocument();
    expect(screen.queryByText("Retention Item")).not.toBeInTheDocument();
  });

  it("filters rows by status when search.status is set", () => {
    const rows = [
      makeRow({ id: "r1", investment: "Active Work", status: "In Progress" }),
      makeRow({ id: "r2", investment: "Done Work", status: "Completed" }),
    ];
    setupMocks(rows, { status: "Completed" });
    render(<GridView />);
    expect(screen.getByText("Done Work")).toBeInTheDocument();
    expect(screen.queryByText("Active Work")).not.toBeInTheDocument();
  });

  it("filters rows by domain when search.domain is set", () => {
    const rows = [
      makeRow({ id: "r1", investment: "Eng Project", domain: "Engineering" }),
      makeRow({ id: "r2", investment: "Design Project", domain: "Design" }),
    ];
    setupMocks(rows, { domain: "Design" });
    render(<GridView />);
    expect(screen.getByText("Design Project")).toBeInTheDocument();
    expect(screen.queryByText("Eng Project")).not.toBeInTheDocument();
  });

  it("clicking a row calls selectRow with the row id", () => {
    const rows = [makeRow({ id: "row-abc", investment: "Clickable Row" })];
    setupMocks(rows);
    render(<GridView />);
    const row = screen.getByText("Clickable Row").closest("tr");
    expect(row).not.toBeNull();
    fireEvent.click(row!);
    expect(mockSelectRow).toHaveBeenCalledWith("row-abc");
  });

  it("double-clicking an investment cell enables inline editing", () => {
    const rows = [makeRow({ id: "r1", investment: "Editable Investment" })];
    setupMocks(rows);
    render(<GridView />);
    const nameSpan = screen.getByText("Editable Investment");
    fireEvent.doubleClick(nameSpan);
    // After double-click, an input should appear in place of the span
    expect(screen.getByDisplayValue("Editable Investment")).toBeInTheDocument();
  });

  it("shows a row count footer", () => {
    const rows = [
      makeRow({ id: "r1", investment: "Item 1" }),
      makeRow({ id: "r2", investment: "Item 2" }),
    ];
    setupMocks(rows);
    render(<GridView />);
    expect(screen.getByText(/2 investments/)).toBeInTheDocument();
  });

  it("shows column headers", () => {
    setupMocks([]);
    render(<GridView />);
    expect(screen.getByText("Investment")).toBeInTheDocument();
    expect(screen.getByText("Domain")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
  });
});
