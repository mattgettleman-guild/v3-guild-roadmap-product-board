import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { RoadmapPage } from "../../components/roadmap/RoadmapPage";

const roadmapSearchSchema = z.object({
  view: z.enum(["grid", "gantt", "board"]).default("grid"),
  groupBy: z.enum(["pillar", "priority", "domain"]).optional(),
  pillar: z.string().optional(),
  priority: z.string().optional(),
  domain: z.string().optional(),
  status: z.string().optional(),
  owner: z.string().optional(),
});

export const Route = createFileRoute("/roadmap/")({
  validateSearch: roadmapSearchSchema,
  component: RoadmapPage,
});
