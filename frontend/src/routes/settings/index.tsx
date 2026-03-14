import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SettingsPage } from "../../components/settings/SettingsPage";

const settingsSearchSchema = z.object({
  section: z
    .enum(["taxonomy", "metrics", "users", "ai", "notifications", "system"])
    .default("taxonomy"),
});

export const Route = createFileRoute("/settings/")({
  validateSearch: settingsSearchSchema,
  component: SettingsPage,
});
