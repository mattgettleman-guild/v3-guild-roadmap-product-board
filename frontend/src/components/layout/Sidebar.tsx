import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Flag, LayoutGrid, Sparkles, Upload, Settings, ChevronLeft, ChevronRight } from "lucide-react";
import { useUIStore } from "../../hooks/useUIStore";
import { AlertsBadge } from "./AlertsBadge";

const NAV_ITEMS = [
  { to: "/" as const, icon: Home, label: "Home", exact: true },
  { to: "/priorities" as const, icon: Flag, label: "Priorities" },
  { to: "/roadmap" as const, icon: LayoutGrid, label: "Roadmap" },
  { to: "/intelligence" as const, icon: Sparkles, label: "Intelligence" },
  { to: "/import" as const, icon: Upload, label: "Import" },
  { to: "/settings" as const, icon: Settings, label: "Settings" },
];

export function Sidebar() {
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const { location } = useRouterState();

  return (
    <aside
      className={`flex flex-col h-screen bg-[#1A1A18] border-r border-[#2A2A28] transition-all duration-200 ${
        collapsed ? "w-[60px]" : "w-[240px]"
      }`}
    >
      {/* Logo area */}
      <div className="h-14 flex items-center px-4 border-b border-[#2A2A28]">
        {!collapsed && (
          <span className="text-white font-semibold text-sm">Roadmap Hub</span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2 space-y-1">
        {NAV_ITEMS.map(({ to, icon: Icon, label, exact }) => {
          const isActive = exact
            ? location.pathname === to
            : location.pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? "bg-amber-600 text-white"
                  : "text-[#9CA39A] hover:bg-[#2A2A28] hover:text-white"
              }`}
            >
              <Icon size={16} className="shrink-0" />
              {!collapsed && <span>{label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Bottom area: alerts + collapse */}
      <div className="border-t border-[#2A2A28]">
        <div className="px-3 py-2">
          <AlertsBadge />
        </div>
        <button
          onClick={toggleSidebar}
          className="w-full h-10 flex items-center justify-center text-[#9CA39A] hover:text-white transition-colors"
        >
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>
    </aside>
  );
}
