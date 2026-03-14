import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { IntelligencePage } from "../../components/intelligence/IntelligencePage";

const intelligenceSearchSchema = z.object({
  section: z.enum(["ai", "kb", "changelog", "pulse"]).default("ai"),
});

export const Route = createFileRoute("/intelligence/")({
  validateSearch: intelligenceSearchSchema,
  component: IntelligencePage,
});
