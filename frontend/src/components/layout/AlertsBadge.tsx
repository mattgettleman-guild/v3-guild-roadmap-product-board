/**
 * AlertsBadge — notification bell with popover showing active/read alerts.
 * Adapted from v2 AlertsPanel into v3 hook-based architecture.
 */
import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  AlertTriangle,
  Clock,
  XCircle,
  X,
  Check,
  CheckCheck,
  Eye,
  EyeOff,
} from "lucide-react";
import { api } from "../../lib/api";
import { useUIStore } from "../../hooks/useUIStore";

interface Alert {
  type: string;
  severity: string;
  title: string;
  description: string;
  investmentId: string;
  investmentName: string;
  key: string;
}

const SEVERITY_CONFIG: Record<
  string,
  { icon: typeof AlertTriangle; bg: string; text: string; border: string }
> = {
  critical: { icon: XCircle, bg: "bg-red-50", text: "text-red-700", border: "border-red-200" },
  warning: {
    icon: AlertTriangle,
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
  },
  info: { icon: Clock, bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
};

export function AlertsBadge() {
  const [open, setOpen] = useState(false);
  const [showRead, setShowRead] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { selectRow } = useUIStore();
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["alerts"],
    queryFn: api.fetchAlerts,
    refetchInterval: 60000,
  });

  const alerts = data?.alerts ?? [];
  const readAlerts = data?.readAlerts ?? [];

  const dismissMutation = useMutation({
    mutationFn: (keys: string[]) => api.dismissAlerts(keys),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
  });

  const undismissMutation = useMutation({
    mutationFn: (keys: string[]) => api.undismissAlerts(keys),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["alerts"] }),
  });

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const totalCount = alerts.length + readAlerts.length;
  if (totalCount === 0 && !open) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded-lg text-slate-400 hover:text-amber-500 hover:bg-[#2A2A28] transition-colors"
        aria-label={`${alerts.length} alert${alerts.length !== 1 ? "s" : ""}`}
      >
        <Bell size={16} />
        {alerts.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center px-0.5">
            {alerts.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-full top-0 ml-2 w-96 bg-white border border-[#E5E5E3] rounded-xl shadow-xl z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#E5E5E3]">
            <h3 className="text-sm font-semibold text-[#1A1A18]">
              Alerts
              {alerts.length > 0 && (
                <span className="ml-1.5 text-[10px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">
                  {alerts.length} new
                </span>
              )}
            </h3>
            <div className="flex items-center gap-1">
              {alerts.length > 0 && (
                <button
                  onClick={() => dismissMutation.mutate(alerts.map((a) => a.key))}
                  className="p-1.5 rounded hover:bg-slate-100 text-[#9CA39A] hover:text-emerald-600"
                  title="Mark all as read"
                >
                  <CheckCheck size={14} />
                </button>
              )}
              {readAlerts.length > 0 && (
                <button
                  onClick={() => setShowRead((v) => !v)}
                  className={`p-1.5 rounded hover:bg-slate-100 ${
                    showRead ? "text-amber-600" : "text-[#9CA39A] hover:text-[#6B7068]"
                  }`}
                  title={showRead ? "Hide read alerts" : `Show ${readAlerts.length} read`}
                >
                  {showRead ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded hover:bg-slate-100 text-[#9CA39A]"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-[400px] overflow-y-auto divide-y divide-[#E5E5E3]/50">
            {alerts.length === 0 && !showRead && (
              <div className="px-4 py-6 text-center text-sm text-[#9CA39A]">No new alerts</div>
            )}
            {alerts.map((alert) => {
              const config = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.info;
              const Icon = config.icon;
              return (
                <div
                  key={alert.key}
                  className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors flex items-start gap-3 group"
                >
                  <button
                    onClick={() => {
                      selectRow(alert.investmentId);
                      setOpen(false);
                    }}
                    className="flex items-start gap-3 flex-1 min-w-0 cursor-pointer bg-transparent border-none text-left p-0"
                  >
                    <div className={`p-1.5 rounded-lg ${config.bg} shrink-0 mt-0.5`}>
                      <Icon size={14} className={config.text} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-[#1A1A18] truncate">{alert.title}</p>
                      <p className="text-xs text-[#6B7068] mt-0.5">{alert.description}</p>
                    </div>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      dismissMutation.mutate([alert.key]);
                    }}
                    className="p-1 rounded hover:bg-emerald-50 text-[#9CA39A] hover:text-emerald-600 opacity-0 group-hover:opacity-100 shrink-0 mt-1"
                    title="Mark as read"
                  >
                    <Check size={14} />
                  </button>
                </div>
              );
            })}

            {showRead &&
              readAlerts.map((alert) => {
                const config = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.info;
                const Icon = config.icon;
                return (
                  <div
                    key={alert.key}
                    className="w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors flex items-start gap-3 opacity-50 group"
                  >
                    <button
                      onClick={() => {
                        selectRow(alert.investmentId);
                        setOpen(false);
                      }}
                      className="flex items-start gap-3 flex-1 min-w-0 cursor-pointer bg-transparent border-none text-left p-0"
                    >
                      <div className={`p-1.5 rounded-lg ${config.bg} shrink-0 mt-0.5`}>
                        <Icon size={14} className={config.text} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[#1A1A18] truncate">
                          {alert.title}
                        </p>
                        <p className="text-xs text-[#6B7068] mt-0.5">{alert.description}</p>
                      </div>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        undismissMutation.mutate([alert.key]);
                      }}
                      className="p-1 rounded hover:bg-amber-50 text-[#9CA39A] hover:text-amber-600 opacity-0 group-hover:opacity-100 shrink-0 mt-1"
                      title="Mark as unread"
                    >
                      <Bell size={14} />
                    </button>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
