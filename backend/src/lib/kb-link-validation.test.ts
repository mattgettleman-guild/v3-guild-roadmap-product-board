import { describe, it, expect } from "vitest";
import { validateLinkRequest, type LinkRequest } from "./kb-link-validation.js";

function makeBody(overrides: Partial<LinkRequest> = {}): LinkRequest {
  return {
    rowId: "row-abc-123",
    ...overrides,
  };
}

describe("validateLinkRequest", () => {
  describe("valid requests", () => {
    it("accepts a minimal request with only rowId", () => {
      const result = validateLinkRequest(makeBody());
      expect(result.valid).toBe(true);
    });

    it("accepts a full request with all fields", () => {
      const result = validateLinkRequest(makeBody({ linkType: "manual", matchLevel: "investment" }));
      expect(result.valid).toBe(true);
    });

    it("accepts linkType auto-suggested", () => {
      const result = validateLinkRequest(makeBody({ linkType: "auto-suggested" }));
      expect(result.valid).toBe(true);
    });

    it("accepts linkType confirmed", () => {
      const result = validateLinkRequest(makeBody({ linkType: "confirmed" }));
      expect(result.valid).toBe(true);
    });

    it("accepts matchLevel tactic", () => {
      const result = validateLinkRequest(makeBody({ matchLevel: "tactic" }));
      expect(result.valid).toBe(true);
    });
  });

  describe("missing rowId", () => {
    it("returns invalid when rowId is absent", () => {
      const result = validateLinkRequest({});
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error).toBe("rowId is required");
    });

    it("returns invalid when rowId is an empty string", () => {
      const result = validateLinkRequest(makeBody({ rowId: "" }));
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error).toBe("rowId is required");
    });

    it("returns invalid when rowId is not a string", () => {
      const result = validateLinkRequest(makeBody({ rowId: 42 }));
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error).toBe("rowId is required");
    });
  });

  describe("invalid linkType", () => {
    it("returns invalid for an unrecognised linkType value", () => {
      const result = validateLinkRequest(makeBody({ linkType: "unknown" }));
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error).toBe("Invalid linkType");
    });

    it("returns invalid for linkType with wrong casing", () => {
      const result = validateLinkRequest(makeBody({ linkType: "Manual" }));
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error).toBe("Invalid linkType");
    });
  });

  describe("invalid matchLevel", () => {
    it("returns invalid for an unrecognised matchLevel value", () => {
      const result = validateLinkRequest(makeBody({ matchLevel: "epic" }));
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error).toBe("Invalid matchLevel");
    });

    it("returns invalid for matchLevel with wrong casing", () => {
      const result = validateLinkRequest(makeBody({ matchLevel: "Investment" }));
      expect(result.valid).toBe(false);
      if (!result.valid) expect(result.error).toBe("Invalid matchLevel");
    });
  });
});
