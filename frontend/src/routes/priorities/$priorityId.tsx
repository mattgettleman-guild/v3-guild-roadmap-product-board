import { createFileRoute } from "@tanstack/react-router";
import { PriorityBriefPage } from "../../components/priorities/PriorityBriefPage";

export const Route = createFileRoute("/priorities/$priorityId")({
  component: PriorityBriefPage,
});
