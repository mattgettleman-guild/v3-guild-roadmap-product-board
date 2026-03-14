import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

// ─── Mock the DB module before importing auth ─────────────────────────────────

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbDelete = vi.fn();

// Chainable query builder stub
function makeChain(resolveValue: unknown) {
  const chain: Record<string, unknown> = {};
  const methods = ["from", "where", "set", "values", "innerJoin"];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  // Make it a thenable so await works
  chain.then = (resolve: (v: unknown) => void) => Promise.resolve(resolveValue).then(resolve);
  return chain;
}

vi.mock("./db.js", () => ({
  db: {
    select: () => mockDbSelect(),
    insert: () => mockDbInsert(),
    update: () => mockDbUpdate(),
    delete: () => mockDbDelete(),
  },
}));

vi.mock("./schema.js", () => ({
  users: { email: "email", id: "id", name: "name", role: "role" },
  sessions: { userId: "userId", token: "token", expiresAt: "expiresAt", id: "id" },
  magicLinks: { email: "email", token: "token", expiresAt: "expiresAt", usedAt: "usedAt", id: "id" },
}));

// Drizzle operators used in auth — just return their argument so we can assert on it
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col, val) => ({ op: "eq", col, val })),
  and: vi.fn((...args) => ({ op: "and", args })),
  gt: vi.fn((col, val) => ({ op: "gt", col, val })),
  isNull: vi.fn((col) => ({ op: "isNull", col })),
}));

import { generateMagicLink, verifyMagicLink, requireAuth } from "./auth.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSelectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  const methods = ["from", "where", "innerJoin"];
  for (const m of methods) {
    chain[m] = vi.fn(() => chain);
  }
  (chain as { then: (r: (v: unknown) => void, j?: (e: unknown) => void) => Promise<unknown> }).then =
    (resolve, _reject) => Promise.resolve(rows).then(resolve);
  return chain;
}

function makeInsertChain() {
  const chain: Record<string, unknown> = {};
  chain.values = vi.fn(() =>
    Promise.resolve(undefined),
  );
  return chain;
}

function makeUpdateChain() {
  const chain: Record<string, unknown> = {};
  chain.set = vi.fn(() => chain);
  chain.where = vi.fn(() => Promise.resolve(undefined));
  return chain;
}

function makeMockReq(overrides: Partial<Request> = {}): Request {
  return {
    path: "/api/roadmap/rows",
    cookies: {},
    ...overrides,
  } as unknown as Request;
}

function makeMockRes(): { res: Response; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const res = { status, json } as unknown as Response;
  return { res, status, json };
}

// ─── generateMagicLink ────────────────────────────────────────────────────────

describe("generateMagicLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure DEV bypass is off for these tests
    process.env.DEV_AUTH_BYPASS = "false";
  });

  it("throws when given a non-guild.com email", async () => {
    await expect(generateMagicLink("user@gmail.com")).rejects.toThrow(
      /Only @guild\.com email addresses are allowed/,
    );
  });

  it("throws for an empty email", async () => {
    await expect(generateMagicLink("")).rejects.toThrow();
  });

  it("throws for an email with no @ symbol", async () => {
    await expect(generateMagicLink("notanemail")).rejects.toThrow();
  });

  it("accepts a guild.com email and returns a token string", async () => {
    // User does not exist yet
    mockDbSelect.mockReturnValue(makeSelectChain([]));
    mockDbInsert.mockReturnValue(makeInsertChain());

    const token = await generateMagicLink("alice@guild.com");

    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  it("normalises the email to lowercase before domain check", async () => {
    mockDbSelect.mockReturnValue(makeSelectChain([]));
    mockDbInsert.mockReturnValue(makeInsertChain());

    // Should NOT throw — upper-case guild.com is still valid
    const token = await generateMagicLink("ALICE@GUILD.COM");
    expect(typeof token).toBe("string");
  });

  it("inserts a new user when the email does not exist", async () => {
    mockDbSelect.mockReturnValue(makeSelectChain([])); // no existing user
    const insertChain = makeInsertChain();
    mockDbInsert.mockReturnValue(insertChain);

    await generateMagicLink("newuser@guild.com");

    // insert was called at least once (user + magic link)
    expect(mockDbInsert).toHaveBeenCalled();
  });

  it("skips user insertion when the user already exists", async () => {
    // First select returns existing user, second returns nothing special
    const existingUser = { id: "u1", email: "existing@guild.com", role: "editor" };
    mockDbSelect.mockReturnValue(makeSelectChain([existingUser]));
    mockDbInsert.mockReturnValue(makeInsertChain());

    await generateMagicLink("existing@guild.com");

    // insert should still be called for the magic link but NOT for the user
    // We verify insert was called (for the magic link), not twice
    expect(mockDbInsert).toHaveBeenCalledTimes(1);
  });
});

// ─── verifyMagicLink ──────────────────────────────────────────────────────────

describe("verifyMagicLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when the token is not found (expired or invalid)", async () => {
    // No matching link
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    await expect(verifyMagicLink("bad-token")).rejects.toThrow(
      /Invalid or expired magic link/,
    );
  });

  it("returns a sessionToken and user when the token is valid", async () => {
    const fakeLink = {
      id: "link-1",
      email: "alice@guild.com",
      token: "valid-token",
      expiresAt: new Date(Date.now() + 60_000),
      usedAt: null,
    };
    const fakeUser = { id: "u1", email: "alice@guild.com", name: "Alice", role: "editor" };

    // First call: get the magic link; second: get the user
    let callCount = 0;
    mockDbSelect.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeSelectChain([fakeLink]);
      return makeSelectChain([fakeUser]);
    });

    const updateChain = makeUpdateChain();
    mockDbUpdate.mockReturnValue(updateChain);
    mockDbInsert.mockReturnValue(makeInsertChain());

    const result = await verifyMagicLink("valid-token");

    expect(typeof result.sessionToken).toBe("string");
    expect(result.sessionToken.length).toBeGreaterThan(0);
    expect(result.user.email).toBe("alice@guild.com");
    expect(result.user.role).toBe("editor");
  });
});

// ─── requireAuth middleware ────────────────────────────────────────────────────

describe("requireAuth middleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure dev bypass is off so we test the real auth path
    process.env.NODE_ENV = "test";
    process.env.DEV_AUTH_BYPASS = "false";
  });

  it("passes through /api/auth/ routes without checking session", async () => {
    const req = makeMockReq({ path: "/api/auth/login" });
    const { res } = makeMockRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith(); // no error argument
  });

  it("passes through /health without checking session", async () => {
    const req = makeMockReq({ path: "/health" });
    const { res } = makeMockRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("passes through /api/connect/ routes without checking session", async () => {
    const req = makeMockReq({ path: "/api/connect/jira" });
    const { res } = makeMockRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("returns 401 when session cookie is missing on a protected route", async () => {
    const req = makeMockReq({ path: "/api/roadmap/rows", cookies: {} });
    const { res, status, json } = makeMockRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: "Authentication required" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when the session token is invalid or expired", async () => {
    // Token present but no matching session in DB
    mockDbSelect.mockReturnValue(makeSelectChain([]));

    const req = makeMockReq({
      path: "/api/roadmap/rows",
      cookies: { session_token: "expired-token" },
    });
    const { res, status, json } = makeMockRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: "Invalid or expired session" });
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches user to req and calls next when session is valid", async () => {
    const fakeUser = { id: "u1", email: "alice@guild.com", name: "Alice", role: "editor" };
    mockDbSelect.mockReturnValue(makeSelectChain([fakeUser]));

    const req = makeMockReq({
      path: "/api/roadmap/rows",
      cookies: { session_token: "valid-session-token" },
    });
    const { res } = makeMockRes();
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((req as Express.Request).user).toEqual(fakeUser);
  });
});
