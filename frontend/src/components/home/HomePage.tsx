/**
 * Home Dashboard — landing page with stats, recent updates, and quick links.
 */
import { useRows } from "../../hooks/useRows";
import { usePriorities } from "../../hooks/usePriorities";
import { useCurrentUser } from "../../hooks/useCurrentUser";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { Link } from "@tanstack/react-router";
import {
  BarChart3,
  Flag,
  LayoutGrid,
  Sparkles,
  TrendingUp,
  Clock,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";
import { SEMANTIC_STATUS, getDomainColor } from "../ui/tokens";

export function HomePage() {
  const { data: rows = [], isLoading: rowsLoading } = useRows();
  const { data: priorities = [] } = usePriorities();
  const { data: user } = useCurrentUser();
  const { data: metrics } = useQuery({
    queryKey: ["adoption-metrics"],
    queryFn: api.adoptionMetrics,
    staleTime: 60_000,
  });

  // Stats
  const totalInvestments = rows.length;
  const inProgress = rows.filter((r) => r.status === "In Progress").length;
  const completed = rows.filter((r) => r.status === "Completed").length;
  const atRisk = rows.filter((r) => r.status === "Paused").length;
  const activePriorities = priorities.filter((p) => p.status === "active").length;

  // Recent updates (last 7 days)
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const recentlyUpdated = rows
    .filter((r) => new Date(r.updatedAt) >= weekAgo)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 8);

  // My assignments
  const myEmail = user?.email ?? "";
  const myInvestments = rows.filter(
    (r) => r.owners && r.owners.toLowerCase().includes(myEmail.toLowerCase()),
  );

  // Domain breakdown
  const domainCounts: Record<string, number> = {};
  for (const row of rows) {
    domainCounts[row.domain] = (domainCounts[row.domain] || 0) + 1;
  }
  const topDomains = Object.entries(domainCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6);

  if (rowsLoading) {
    return (
      <div className="p-8 text-center text-[#9CA39A] text-sm">Loading dashboard...</div>
    );
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Greeting */}
      <div>
        <h1 className="text-xl font-semibold text-[#1A1A18]">
          Welcome back{user?.name ? `, ${user.name}` : ""}
        </h1>
        <p className="text-sm text-[#6B7068] mt-1">
          Here is an overview of your roadmap
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<LayoutGrid size={18} className="text-amber-600" />}
          label="Total Investments"
          value={totalInvestments}
          bg="bg-amber-50"
        />
        <StatCard
          icon={<TrendingUp size={18} className="text-amber-600" />}
          label="In Progress"
          value={inProgress}
          bg="bg-amber-50"
        />
        <StatCard
          icon={<CheckCircle size={18} className="text-emerald-600" />}
          label="Completed"
          value={completed}
          bg="bg-emerald-50"
        />
        <StatCard
          icon={<Flag size={18} className="text-amber-600" />}
          label="Active Priorities"
          value={activePriorities}
          bg="bg-amber-50"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recently Updated */}
        <div className="border border-[#E5E5E3] rounded-xl bg-white">
          <div className="px-5 py-4 border-b border-[#E5E5E3] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#1A1A18] flex items-center gap-2">
              <Clock size={14} className="text-[#9CA39A]" />
              Recently Updated
            </h2>
            <Link
              to="/roadmap"
              className="text-xs text-amber-600 hover:text-amber-700 font-medium"
            >
              View all
            </Link>
          </div>
          <div className="divide-y divide-[#E5E5E3]/50">
            {recentlyUpdated.length === 0 ? (
              <div className="px-5 py-4 text-sm text-[#9CA39A]">No recent updates</div>
            ) : (
              recentlyUpdated.map((row) => {
                const statusStyle = SEMANTIC_STATUS[row.status ?? "Not Started"];
                return (
                  <Link
                    key={row.id}
                    to="/roadmap"
                    className="flex items-center gap-3 px-5 py-3 hover:bg-[#FAFAF9] transition-colors"
                  >
                    <div
                      className="w-1 h-8 rounded-full shrink-0"
                      style={{ backgroundColor: getDomainColor(row.domain) }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[#1A1A18] truncate">
                        {row.investment}
                      </p>
                      <p className="text-xs text-[#9CA39A]">
                        {row.domain} -- {new Date(row.updatedAt).toLocaleDateString()}
                      </p>
                    </div>
                    {statusStyle && (
                      <span
                        className="text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0"
                        style={{
                          backgroundColor: statusStyle.bg,
                          color: statusStyle.text,
                        }}
                      >
                        {row.status}
                      </span>
                    )}
                  </Link>
                );
              })
            )}
          </div>
        </div>

        {/* My Assignments */}
        <div className="border border-[#E5E5E3] rounded-xl bg-white">
          <div className="px-5 py-4 border-b border-[#E5E5E3]">
            <h2 className="text-sm font-semibold text-[#1A1A18] flex items-center gap-2">
              <BarChart3 size={14} className="text-[#9CA39A]" />
              {myInvestments.length > 0 ? "My Investments" : "Domain Overview"}
            </h2>
          </div>
          {myInvestments.length > 0 ? (
            <div className="divide-y divide-[#E5E5E3]/50">
              {myInvestments.slice(0, 8).map((row) => (
                <Link
                  key={row.id}
                  to="/roadmap"
                  className="flex items-center gap-3 px-5 py-3 hover:bg-[#FAFAF9] transition-colors"
                >
                  <div
                    className="w-1 h-8 rounded-full shrink-0"
                    style={{ backgroundColor: getDomainColor(row.domain) }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-[#1A1A18] truncate">
                      {row.investment}
                    </p>
                    <p className="text-xs text-[#9CA39A]">{row.status ?? "Not Started"}</p>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="p-5 space-y-2">
              {topDomains.map(([domain, count]) => (
                <div key={domain} className="flex items-center gap-3">
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: getDomainColor(domain) }}
                  />
                  <span className="text-sm text-[#1A1A18] flex-1">{domain}</span>
                  <span className="text-sm font-medium text-[#6B7068]">{count}</span>
                </div>
              ))}
              {topDomains.length === 0 && (
                <p className="text-sm text-[#9CA39A]">No investments yet</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <QuickLink to="/roadmap" icon={<LayoutGrid size={16} />} label="Roadmap" />
        <QuickLink to="/priorities" icon={<Flag size={16} />} label="Priorities" />
        <QuickLink to="/intelligence" icon={<Sparkles size={16} />} label="Intelligence" />
        <QuickLink to="/import" icon={<TrendingUp size={16} />} label="Import Data" />
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  bg,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  bg: string;
}) {
  return (
    <div className="border border-[#E5E5E3] rounded-xl bg-white p-4">
      <div className={`inline-flex p-2 rounded-lg ${bg} mb-3`}>{icon}</div>
      <p className="text-2xl font-bold text-[#1A1A18]">{value}</p>
      <p className="text-xs text-[#9CA39A] mt-0.5">{label}</p>
    </div>
  );
}

function QuickLink({
  to,
  icon,
  label,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 px-4 py-3 border border-[#E5E5E3] rounded-lg bg-white hover:bg-[#FAFAF9] transition-colors"
    >
      <span className="text-[#9CA39A]">{icon}</span>
      <span className="text-sm font-medium text-[#1A1A18]">{label}</span>
    </Link>
  );
}
