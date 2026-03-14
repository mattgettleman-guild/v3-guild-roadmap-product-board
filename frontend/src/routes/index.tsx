import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: () => (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-[#1A1A18] mb-2">Welcome back</h1>
      <p className="text-[#6B7068]">Home dashboard — coming in Phase 3</p>
    </div>
  ),
});
