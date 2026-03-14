export interface LinkRequest {
  rowId?: unknown;
  linkType?: unknown;
  matchLevel?: unknown;
}

export function validateLinkRequest(body: LinkRequest): { valid: true } | { valid: false; error: string } {
  if (!body.rowId || typeof body.rowId !== "string") return { valid: false, error: "rowId is required" };
  if (body.linkType && !["manual", "auto-suggested", "confirmed"].includes(body.linkType as string)) return { valid: false, error: "Invalid linkType" };
  if (body.matchLevel && !["investment", "tactic"].includes(body.matchLevel as string)) return { valid: false, error: "Invalid matchLevel" };
  return { valid: true };
}
