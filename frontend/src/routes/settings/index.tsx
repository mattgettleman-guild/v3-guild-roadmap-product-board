import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/settings/")({
  component: () => (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-[#1A1A18] mb-2">Settings</h1>
      <p className="text-[#6B7068]">Taxonomy, user management, and integrations — coming in Phase 2</p>
    </div>
  ),
});
