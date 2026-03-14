import { type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { DetailPanel } from "./DetailPanel";
import { CommandPalette } from "./CommandPalette";
import { ToastContainer } from "./Toast";

export function RootLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen bg-[#FAFAF9] overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-auto">{children}</main>
      <DetailPanel />
      <CommandPalette />
      <ToastContainer />
    </div>
  );
}
