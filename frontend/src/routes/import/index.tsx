import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ImportPage } from "../../components/import/ImportPage";

const importSearchSchema = z.object({
  section: z.enum(["import", "export"]).default("import"),
});

export const Route = createFileRoute("/import/")({
  validateSearch: importSearchSchema,
  component: ImportPage,
});
