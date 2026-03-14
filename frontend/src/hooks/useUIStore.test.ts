import { describe, it, expect, beforeEach } from "vitest";
import { useUIStore } from "./useUIStore";

// Each test gets a fresh store by resetting state manually
function resetStore() {
  useUIStore.setState({
    sidebarCollapsed: false,
    selectedRowId: null,
    detailPanelOpen: false,
    commandPaletteOpen: false,
  });
}

describe("useUIStore — selectRow", () => {
  beforeEach(resetStore);

  it("sets selectedRowId and opens detailPanel when called with an id", () => {
    useUIStore.getState().selectRow("row-abc");
    const state = useUIStore.getState();
    expect(state.selectedRowId).toBe("row-abc");
    expect(state.detailPanelOpen).toBe(true);
  });

  it("clears selectedRowId and closes detailPanel when called with null", () => {
    useUIStore.getState().selectRow("row-abc");
    useUIStore.getState().selectRow(null);
    const state = useUIStore.getState();
    expect(state.selectedRowId).toBeNull();
    expect(state.detailPanelOpen).toBe(false);
  });

  it("replaces previously selected row", () => {
    useUIStore.getState().selectRow("row-1");
    useUIStore.getState().selectRow("row-2");
    expect(useUIStore.getState().selectedRowId).toBe("row-2");
    expect(useUIStore.getState().detailPanelOpen).toBe(true);
  });
});

describe("useUIStore — toggleCommandPalette", () => {
  beforeEach(resetStore);

  it("opens command palette when it was closed", () => {
    expect(useUIStore.getState().commandPaletteOpen).toBe(false);
    useUIStore.getState().toggleCommandPalette();
    expect(useUIStore.getState().commandPaletteOpen).toBe(true);
  });

  it("closes command palette when it was open", () => {
    useUIStore.getState().toggleCommandPalette();
    useUIStore.getState().toggleCommandPalette();
    expect(useUIStore.getState().commandPaletteOpen).toBe(false);
  });

  it("setCommandPaletteOpen(true) opens regardless of current state", () => {
    useUIStore.getState().setCommandPaletteOpen(true);
    expect(useUIStore.getState().commandPaletteOpen).toBe(true);
  });

  it("setCommandPaletteOpen(false) closes regardless of current state", () => {
    useUIStore.getState().setCommandPaletteOpen(true);
    useUIStore.getState().setCommandPaletteOpen(false);
    expect(useUIStore.getState().commandPaletteOpen).toBe(false);
  });
});

describe("useUIStore — toggleSidebar", () => {
  beforeEach(resetStore);

  it("collapses sidebar when it was expanded", () => {
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarCollapsed).toBe(true);
  });

  it("expands sidebar when it was collapsed", () => {
    useUIStore.getState().toggleSidebar();
    useUIStore.getState().toggleSidebar();
    expect(useUIStore.getState().sidebarCollapsed).toBe(false);
  });
});

describe("useUIStore — localStorage persistence", () => {
  beforeEach(() => {
    resetStore();
    localStorage.clear();
  });

  it("writes sidebarCollapsed to localStorage under roadmap-ui key", () => {
    useUIStore.getState().toggleSidebar();
    const stored = localStorage.getItem("roadmap-ui");
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.state.sidebarCollapsed).toBe(true);
  });

  it("does not persist commandPaletteOpen to localStorage (partialize excludes it)", () => {
    useUIStore.getState().setCommandPaletteOpen(true);
    const stored = localStorage.getItem("roadmap-ui");
    // If no sidebarCollapsed change was made, key may not exist at all,
    // but if it does exist commandPaletteOpen must not be in it
    if (stored) {
      const parsed = JSON.parse(stored);
      expect(parsed.state.commandPaletteOpen).toBeUndefined();
    }
  });

  it("does not persist selectedRowId to localStorage (partialize excludes it)", () => {
    useUIStore.getState().selectRow("row-123");
    const stored = localStorage.getItem("roadmap-ui");
    if (stored) {
      const parsed = JSON.parse(stored);
      expect(parsed.state.selectedRowId).toBeUndefined();
    }
  });
});
