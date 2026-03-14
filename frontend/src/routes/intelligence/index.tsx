import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/intelligence/")({
  component: () => (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-[#1A1A18] mb-2">Intelligence</h1>
      <p className="text-[#6B7068]">AI-powered insights and reports — coming in Phase 2</p>
    </div>
  ),
});
