import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const importSearchSchema = z.object({
  section: z.enum(["import", "export"]).default("import"),
});

export const Route = createFileRoute("/import/")({
  validateSearch: importSearchSchema,
  component: () => (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-[#1A1A18] mb-2">Import</h1>
      <p className="text-[#6B7068]">
        CSV, slide, and paste import tools -- coming in Phase 3
      </p>
    </div>
  ),
});
