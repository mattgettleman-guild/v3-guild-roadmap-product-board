import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UIState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  selectedRowId: string | null;
  detailPanelOpen: boolean;
  selectRow: (id: string | null) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () =>
        set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

      selectedRowId: null,
      detailPanelOpen: false,
      selectRow: (id) =>
        set({
          selectedRowId: id,
          detailPanelOpen: id !== null,
        }),
    }),
    {
      name: "roadmap-ui",
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    },
  ),
);
