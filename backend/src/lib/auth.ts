import crypto from "node:crypto";
import { eq, and, gt, isNull } from "drizzle-orm";
import type { RequestHandler } from "express";
import { db } from "./db.js";
import { users, sessions, magicLinks } from "./schema.js";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email: string; name: string | null; role: string };
    }
  }
}

const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN || "guild.com";

export async function generateMagicLink(email: string): Promise<string> {
  const normalizedEmail = email.toLowerCase().trim();
  const domain = normalizedEmail.split("@")[1];
  if (domain !== ALLOWED_DOMAIN) {
    throw new Error(`Only @${ALLOWED_DOMAIN} email addresses are allowed`);
  }

  const existing = await db
    .select()
    .from(users)
    .where(eq(users.email, normalizedEmail));

  if (existing.length === 0) {
    await db.insert(users).values({
      email: normalizedEmail,
      role: "editor",
    });
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await db.insert(magicLinks).values({
    email: normalizedEmail,
    token,
    expiresAt,
  });

  return token;
}

export async function verifyMagicLink(
  token: string,
): Promise<{ sessionToken: string; user: { id: string; email: string; name: string | null; role: string } }> {
  const [link] = await db
    .select()
    .from(magicLinks)
    .where(
      and(
        eq(magicLinks.token, token),
        gt(magicLinks.expiresAt, new Date()),
        isNull(magicLinks.usedAt),
      ),
    );

  if (!link) {
    throw new Error("Invalid or expired magic link");
  }

  await db
    .update(magicLinks)
    .set({ usedAt: new Date() })
    .where(eq(magicLinks.id, link.id));

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, link.email));

  if (!user) {
    throw new Error("User not found");
  }

  const sessionToken = crypto.randomBytes(32).toString("hex");
  const hashedSessionToken = crypto.createHash("sha256").update(sessionToken).digest("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await db.insert(sessions).values({
    userId: user.id,
    token: hashedSessionToken,
    expiresAt,
  });

  return {
    sessionToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  };
}

export async function getSessionUser(
  token: string,
): Promise<{ id: string; email: string; name: string | null; role: string } | null> {
  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

  const result = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(eq(sessions.token, hashedToken), gt(sessions.expiresAt, new Date())),
    );

  return result[0] ?? null;
}

export async function destroySession(token: string): Promise<void> {
  const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
  await db.delete(sessions).where(eq(sessions.token, hashedToken));
}

const DEV_BYPASS_USER = process.env.NODE_ENV !== "production" && process.env.DEV_AUTH_BYPASS === "true"
  ? { id: "dev-user", email: "dev@guild.com", name: "Dev User", role: "admin" }
  : null;

export const requireAuth: RequestHandler = async (req, res, next) => {
  if (
    req.path === "/health" ||
    req.path.startsWith("/api/auth/") ||
    req.path.startsWith("/api/connect/") ||
    !req.path.startsWith("/api/")
  ) {
    return next();
  }

  if (DEV_BYPASS_USER) {
    req.user = DEV_BYPASS_USER;
    return next();
  }

  const token = req.cookies?.session_token;
  if (!token) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const user = await getSessionUser(token);
  if (!user) {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }

  req.user = user;
  next();
};

export function requireRole(...roles: string[]): RequestHandler {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}
