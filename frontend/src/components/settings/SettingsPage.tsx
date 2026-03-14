import { useState } from "react";
import { useSearch, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Trash2,
  Save,
  Users,
  Sparkles,
  Database,
  Tag,
  BarChart3,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { api } from "../../lib/api";
import { useTaxonomy } from "../../hooks/useTaxonomy";

const TABS = [
  { key: "taxonomy", label: "Taxonomy", icon: Tag },
  { key: "metrics", label: "Metrics", icon: BarChart3 },
  { key: "users", label: "Users", icon: Users },
  { key: "ai", label: "AI Config", icon: Sparkles },
  { key: "system", label: "System", icon: Database },
] as const;

type TaxonomyData = {
  pillars: string[];
  priorities: string[];
  domains: string[];
  owners: string[];
  tags: string[];
  themes: string[];
  subDomains: string[];
};

function TaxonomySection() {
  const { data: taxonomy, isLoading } = useTaxonomy();
  const qc = useQueryClient();
  const updateMutation = useMutation({
    mutationFn: (tax: TaxonomyData) => api.updateTaxonomy(tax),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["taxonomy"] }),
  });

  const [editField, setEditField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  if (isLoading || !taxonomy) {
    return <p className="text-sm text-[#9CA39A]">Loading taxonomy...</p>;
  }

  // Capture as a concrete non-undefined local so inner functions can use it
  const tax: TaxonomyData = {
    pillars: taxonomy.pillars ?? [],
    priorities: taxonomy.priorities ?? [],
    domains: taxonomy.domains ?? [],
    owners: taxonomy.owners ?? [],
    tags: taxonomy.tags ?? [],
    themes: taxonomy.themes ?? [],
    subDomains: taxonomy.subDomains ?? [],
  };

  const fields = [
    { key: "pillars" as const, label: "Strategic Pillars", values: tax.pillars },
    { key: "priorities" as const, label: "Product Priorities", values: tax.priorities },
    { key: "domains" as const, label: "Domains", values: tax.domains },
    { key: "owners" as const, label: "Owners", values: tax.owners },
    { key: "tags" as const, label: "Tags", values: tax.tags },
    { key: "themes" as const, label: "Themes", values: tax.themes },
    { key: "subDomains" as const, label: "Sub-domains", values: tax.subDomains },
  ];

  function addItem(fieldKey: keyof TaxonomyData) {
    if (!editValue.trim()) return;
    const updated: TaxonomyData = {
      ...tax,
      [fieldKey]: [...tax[fieldKey], editValue.trim()],
    };
    updateMutation.mutate(updated);
    setEditValue("");
    setEditField(null);
  }

  function removeItem(fieldKey: keyof TaxonomyData, value: string) {
    const updated: TaxonomyData = {
      ...tax,
      [fieldKey]: tax[fieldKey].filter((v) => v !== value),
    };
    updateMutation.mutate(updated);
  }

  return (
    <div className="space-y-6">
      {fields.map((field) => (
        <div
          key={field.key}
          className="bg-white border border-[#E5E5E3] rounded-xl p-4"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-[#1A1A18]">
              {field.label}
            </h3>
            <button
              onClick={() => {
                setEditField(editField === field.key ? null : field.key);
                setEditValue("");
              }}
              className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 cursor-pointer bg-transparent border-none"
            >
              <Plus size={12} />
              Add
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {field.values.map((v) => (
              <span
                key={v}
                className="flex items-center gap-1 px-2.5 py-1 text-xs text-[#1A1A18] bg-[#FAFAF9] border border-[#E5E5E3] rounded-full group"
              >
                {v}
                <button
                  onClick={() => removeItem(field.key, v)}
                  className="opacity-0 group-hover:opacity-100 text-[#9CA39A] hover:text-red-500 cursor-pointer bg-transparent border-none p-0"
                >
                  <Trash2 size={10} />
                </button>
              </span>
            ))}
            {field.values.length === 0 && (
              <span className="text-xs text-[#9CA39A]">None defined</span>
            )}
          </div>
          {editField === field.key && (
            <div className="flex items-center gap-2 mt-3">
              <input
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addItem(field.key);
                }}
                placeholder={`Add ${field.label.toLowerCase()}...`}
                className="flex-1 px-3 py-1.5 text-sm border border-[#E5E5E3] rounded-lg bg-white text-[#1A1A18]"
                autoFocus
              />
              <button
                onClick={() => addItem(field.key)}
                className="px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-medium hover:bg-amber-700 cursor-pointer border-none"
              >
                Add
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function MetricsSection() {
  const { data: metrics = [], isLoading } = useQuery({
    queryKey: ["metric-definitions"],
    queryFn: api.listMetricDefinitions,
  });
  const qc = useQueryClient();
  const createMutation = useMutation({
    mutationFn: (body: { name: string; direction: "increase" | "decrease" | "maintain" }) =>
      api.createMetricDefinition(body as any),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["metric-definitions"] }),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.deleteMetricDefinition(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["metric-definitions"] }),
  });

  const [newName, setNewName] = useState("");

  if (isLoading) {
    return <p className="text-sm text-[#9CA39A]">Loading metrics...</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New metric name..."
          className="flex-1 px-3 py-2 text-sm border border-[#E5E5E3] rounded-lg bg-white text-[#1A1A18]"
        />
        <button
          onClick={() => {
            if (newName.trim()) {
              createMutation.mutate({
                name: newName.trim(),
                direction: "increase",
              });
              setNewName("");
            }
          }}
          className="px-3 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 cursor-pointer border-none"
        >
          Add Metric
        </button>
      </div>
      {metrics.length === 0 ? (
        <p className="text-sm text-[#9CA39A]">No metric definitions yet.</p>
      ) : (
        <div className="space-y-2">
          {metrics.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-3 bg-white border border-[#E5E5E3] rounded-lg px-4 py-3"
            >
              <div className="flex-1">
                <p className="text-sm font-medium text-[#1A1A18]">{m.name}</p>
                <p className="text-xs text-[#9CA39A]">
                  Direction: {m.direction}
                  {m.unit ? ` | Unit: ${m.unit}` : ""}
                  {m.targetValue ? ` | Target: ${m.targetValue}` : ""}
                </p>
              </div>
              <button
                onClick={() => deleteMutation.mutate(m.id)}
                className="p-1.5 rounded hover:bg-red-50 text-[#9CA39A] hover:text-red-500 cursor-pointer bg-transparent border-none"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UsersSection() {
  const { data: users = [], isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: api.listUsers,
  });
  const qc = useQueryClient();
  const updateRoleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api.updateUserRole(userId, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

  if (isLoading) {
    return <p className="text-sm text-[#9CA39A]">Loading users...</p>;
  }

  return (
    <div className="space-y-2">
      {users.map((user) => (
        <div
          key={user.id}
          className="flex items-center gap-3 bg-white border border-[#E5E5E3] rounded-lg px-4 py-3"
        >
          <div className="flex-1">
            <p className="text-sm font-medium text-[#1A1A18]">
              {user.name || user.email}
            </p>
            <p className="text-xs text-[#9CA39A]">{user.email}</p>
          </div>
          <select
            value={user.role}
            onChange={(e) =>
              updateRoleMutation.mutate({
                userId: user.id,
                role: e.target.value,
              })
            }
            className="text-xs border border-[#E5E5E3] rounded px-2 py-1 text-[#1A1A18]"
          >
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      ))}
      {users.length === 0 && (
        <p className="text-sm text-[#9CA39A]">No users found.</p>
      )}
    </div>
  );
}

function AiConfigSection() {
  const { data } = useQuery({
    queryKey: ["ai-instructions"],
    queryFn: api.aiGetInstructions,
  });
  const [instructions, setInstructions] = useState("");
  const [loaded, setLoaded] = useState(false);

  if (data && !loaded) {
    setInstructions(data.aiCustomInstructions || "");
    setLoaded(true);
  }

  const saveMutation = useMutation({
    mutationFn: () => api.aiSetInstructions(instructions),
  });

  const { data: contextDocs = [] } = useQuery({
    queryKey: ["ai-context-docs"],
    queryFn: api.aiListContextDocs,
  });

  return (
    <div className="space-y-6">
      <div className="bg-white border border-[#E5E5E3] rounded-xl p-4">
        <h3 className="text-sm font-semibold text-[#1A1A18] mb-3">
          Custom Instructions
        </h3>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={8}
          placeholder="Add custom instructions for the AI assistant..."
          className="w-full border border-[#E5E5E3] rounded-lg p-3 text-sm text-[#1A1A18] resize-none"
        />
        <button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-xs font-medium hover:bg-amber-700 cursor-pointer border-none disabled:opacity-50"
        >
          {saveMutation.isPending ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Save size={12} />
          )}
          Save Instructions
        </button>
      </div>

      <div className="bg-white border border-[#E5E5E3] rounded-xl p-4">
        <h3 className="text-sm font-semibold text-[#1A1A18] mb-3">
          Context Documents ({contextDocs.length})
        </h3>
        {contextDocs.length === 0 ? (
          <p className="text-sm text-[#9CA39A]">
            No context documents uploaded.
          </p>
        ) : (
          <div className="space-y-2">
            {contextDocs.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center gap-2 text-sm text-[#1A1A18]"
              >
                <span className="flex-1 truncate">{doc.filename}</span>
                <span className="text-xs text-[#9CA39A]">
                  {(doc.fileSize / 1024).toFixed(0)} KB
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SystemSection() {
  const [resetConfirm, setResetConfirm] = useState(false);
  const resetMutation = useMutation({
    mutationFn: () => api.resetAllData(),
  });

  return (
    <div className="space-y-6">
      <div className="bg-white border border-[#E5E5E3] rounded-xl p-4">
        <h3 className="text-sm font-semibold text-[#1A1A18] mb-3">
          Data Export
        </h3>
        <button
          onClick={async () => {
            const data = await api.exportXlsxData();
            const blob = new Blob([JSON.stringify(data, null, 2)], {
              type: "application/json",
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "roadmap-export.json";
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="flex items-center gap-1.5 px-3 py-2 bg-white border border-[#E5E5E3] rounded-lg text-sm text-[#1A1A18] hover:bg-[#FAFAF9] cursor-pointer"
        >
          <Database size={14} />
          Export All Data (JSON)
        </button>
      </div>

      <div className="bg-white border border-red-200 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-red-700 mb-2 flex items-center gap-1.5">
          <AlertTriangle size={14} />
          Danger Zone
        </h3>
        <p className="text-xs text-[#6B7068] mb-3">
          This will permanently delete all data. This action cannot be
          undone.
        </p>
        {!resetConfirm ? (
          <button
            onClick={() => setResetConfirm(true)}
            className="px-3 py-1.5 bg-red-50 text-red-700 border border-red-200 rounded-lg text-xs font-medium hover:bg-red-100 cursor-pointer"
          >
            Reset All Data
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                resetMutation.mutate();
                setResetConfirm(false);
              }}
              className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700 cursor-pointer border-none"
            >
              Confirm Reset
            </button>
            <button
              onClick={() => setResetConfirm(false)}
              className="px-3 py-1.5 text-xs text-[#6B7068] cursor-pointer bg-transparent border-none"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function SettingsPage() {
  const search = useSearch({ from: "/settings/" });
  const navigate = useNavigate({ from: "/settings/" });
  const section = (search as { section?: string }).section ?? "taxonomy";

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-5 pb-0">
        <h1 className="text-2xl font-bold text-[#1A1A18] tracking-tight mb-4">
          Settings
        </h1>
        <div className="flex border-b border-[#E5E5E3]">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() =>
                navigate({
                  search: (p: Record<string, unknown>) => ({
                    ...p,
                    section: tab.key,
                  }),
                })
              }
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm border-b-2 -mb-px transition-colors cursor-pointer bg-transparent ${
                section === tab.key
                  ? "border-amber-600 text-amber-600 font-medium"
                  : "border-transparent text-[#6B7068] hover:text-[#1A1A18]"
              }`}
            >
              <tab.icon size={14} />
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-auto p-5">
        {section === "taxonomy" && <TaxonomySection />}
        {section === "metrics" && <MetricsSection />}
        {section === "users" && <UsersSection />}
        {section === "ai" && <AiConfigSection />}
        {section === "system" && <SystemSection />}
      </div>
    </div>
  );
}
