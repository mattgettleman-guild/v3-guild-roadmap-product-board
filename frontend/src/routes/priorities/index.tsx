import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { PrioritiesPage } from "../../components/priorities/PrioritiesPage";

const prioritiesSearchSchema = z.object({
  pillar: z.string().optional(),
  status: z.string().optional(),
});

export const Route = createFileRoute("/priorities/")({
  validateSearch: prioritiesSearchSchema,
  component: PrioritiesPage,
});
