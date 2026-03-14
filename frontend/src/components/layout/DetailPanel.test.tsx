import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { RoadmapRow } from "@roadmap/shared";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../hooks/useUIStore", () => ({
  useUIStore: vi.fn(),
}));

vi.mock("../../hooks/useRows", () => ({
  useRows: vi.fn(),
  useUpdateRow: vi.fn(),
}));

// Replace sub-components with minimal stubs so we can focus on DetailPanel logic
vi.mock("../roadmap/TacticsView", () => ({
  TacticsView: ({ tactics }: { tactics: unknown[] }) =>
    createElement("div", { "data-testid": "tactics-view" }, `tactics: ${tactics.length}`),
}));

vi.mock("../roadmap/JiraLinkModal", () => ({
  JiraLinkModal: ({ onClose }: { onClose: () => void }) =>
    createElement("div", { "data-testid": "jira-modal" },
      createElement("button", { onClick: onClose }, "Close modal"),
    ),
}));

import { DetailPanel } from "./DetailPanel";
import { useUIStore } from "../../hooks/useUIStore";
import { useRows, useUpdateRow } from "../../hooks/useRows";

const mockUseUIStore = useUIStore as ReturnType<typeof vi.fn>;
const mockUseRows = useRows as ReturnType<typeof vi.fn>;
const mockUseUpdateRow = useUpdateRow as ReturnType<typeof vi.fn>;

function makeRow(overrides: Partial<RoadmapRow> = {}): RoadmapRow {
  return {
    id: "row-1",
    investment: "My Investment",
    domain: "Engineering",
    strategicPillar: "Growth",
    productPriority: "P1",
    owners: "alice@guild.com",
    status: "In Progress",
    description: "Some description",
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

function setupClosed() {
  mockUseUIStore.mockReturnValue({
    selectedRowId: null,
    detailPanelOpen: false,
    selectRow: mockSelectRow,
  });
  mockUseRows.mockReturnValue({ data: [] });
  mockUseUpdateRow.mockReturnValue({ mutate: mockMutate });
}

function setupOpen(row: RoadmapRow) {
  mockUseUIStore.mockReturnValue({
    selectedRowId: row.id,
    detailPanelOpen: true,
    selectRow: mockSelectRow,
  });
  mockUseRows.mockReturnValue({ data: [row] });
  mockUseUpdateRow.mockReturnValue({ mutate: mockMutate });
}

describe("DetailPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render the panel when detailPanelOpen is false", () => {
    setupClosed();
    const { container } = render(<DetailPanel />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the panel when detailPanelOpen is true and a row is selected", () => {
    setupOpen(makeRow());
    render(<DetailPanel />);
    expect(screen.getByText("Investment Details")).toBeInTheDocument();
  });

  it("does not render when detailPanelOpen is true but selectedRowId does not match any row", () => {
    mockUseUIStore.mockReturnValue({
      selectedRowId: "nonexistent-row",
      detailPanelOpen: true,
      selectRow: mockSelectRow,
    });
    mockUseRows.mockReturnValue({ data: [makeRow({ id: "row-1" })] });
    mockUseUpdateRow.mockReturnValue({ mutate: mockMutate });
    const { container } = render(<DetailPanel />);
    expect(container.firstChild).toBeNull();
  });

  it("displays the investment name from the selected row", () => {
    setupOpen(makeRow({ investment: "Product Analytics Platform" }));
    render(<DetailPanel />);
    expect(screen.getByText("Product Analytics Platform")).toBeInTheDocument();
  });

  it("clicking the X button calls selectRow(null)", () => {
    setupOpen(makeRow());
    render(<DetailPanel />);
    // The close button contains only an SVG (lucide X icon) with no accessible text.
    // It is the first button in the header area.
    const buttons = screen.getAllByRole("button");
    // First button is the close (X) button in the header
    fireEvent.click(buttons[0]);
    expect(mockSelectRow).toHaveBeenCalledWith(null);
  });

  it("clicking an inline text field switches it to edit mode (shows input)", () => {
    setupOpen(makeRow({ investment: "Editable Investment" }));
    render(<DetailPanel />);
    // The investment paragraph is clickable
    const investmentText = screen.getByText("Editable Investment");
    fireEvent.click(investmentText);
    // Input with current value should now be visible
    expect(screen.getByDisplayValue("Editable Investment")).toBeInTheDocument();
  });

  it("pressing Enter in an edited field calls updateRow mutate", () => {
    setupOpen(makeRow({ investment: "Old Investment" }));
    render(<DetailPanel />);

    const investmentText = screen.getByText("Old Investment");
    fireEvent.click(investmentText);

    const input = screen.getByDisplayValue("Old Investment") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "New Investment" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(mockMutate).toHaveBeenCalledWith({
      id: "row-1",
      body: { investment: "New Investment" },
    });
  });

  it("pressing Escape cancels edit without calling mutate", () => {
    setupOpen(makeRow({ investment: "Stable Investment" }));
    render(<DetailPanel />);

    const investmentText = screen.getByText("Stable Investment");
    fireEvent.click(investmentText);

    const input = screen.getByDisplayValue("Stable Investment") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Changed Value" } });
    fireEvent.keyDown(input, { key: "Escape" });

    // mutate should NOT have been called
    expect(mockMutate).not.toHaveBeenCalled();
    // The input should be gone, showing the original text again
    expect(screen.queryByDisplayValue("Changed Value")).not.toBeInTheDocument();
  });

  it("does not call mutate if value did not change on blur", () => {
    setupOpen(makeRow({ investment: "Unchanged" }));
    render(<DetailPanel />);

    fireEvent.click(screen.getByText("Unchanged"));
    const input = screen.getByDisplayValue("Unchanged");
    // Blur without changing value
    fireEvent.blur(input);

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("shows jira link count of 0 when no links are attached", () => {
    setupOpen(makeRow({ jiraLinks: [] }));
    render(<DetailPanel />);
    expect(screen.getByText(/Jira Links \(0\)/i)).toBeInTheDocument();
  });

  it("shows correct jira link count when links are present", () => {
    const jiraLinks = [
      { id: "l1", key: "PROJ-1", title: "Fix bug", issueType: "epic" as const, url: "https://jira/1" },
      { id: "l2", key: "PROJ-2", title: "Add feature", issueType: "epic" as const, url: "https://jira/2" },
    ];
    setupOpen(makeRow({ jiraLinks }));
    render(<DetailPanel />);
    expect(screen.getByText(/Jira Links \(2\)/i)).toBeInTheDocument();
  });

  it("shows the tactics count via TacticsView", () => {
    setupOpen(makeRow({ tactics: [] }));
    render(<DetailPanel />);
    expect(screen.getByTestId("tactics-view")).toBeInTheDocument();
  });

  it("shows the owner field value", () => {
    setupOpen(makeRow({ owners: "bob@guild.com" }));
    render(<DetailPanel />);
    expect(screen.getByText("bob@guild.com")).toBeInTheDocument();
  });

  it("shows tags when the row has tags", () => {
    setupOpen(makeRow({ tags: ["urgent", "q1"] }));
    render(<DetailPanel />);
    expect(screen.getByText("urgent")).toBeInTheDocument();
    expect(screen.getByText("q1")).toBeInTheDocument();
  });
});
