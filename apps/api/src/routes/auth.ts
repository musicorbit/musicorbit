import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthStatusResponse, AuthUser } from "@musicorbit/shared";
import type { DbContext } from "../db/index.js";

const SESSION_COOKIE_NAME = "musicorbit_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface AuthRouteDeps {
  dbContext: DbContext;
  authEnabled: boolean;
}

const credentialsSchema = z.object({
  username: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/, "Username may only contain letters, numbers, ., _, and -"),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${derived}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt" || !parts[1] || !parts[2]) {
    return false;
  }
  const expected = Buffer.from(parts[2], "hex");
  const actual = crypto.scryptSync(password, parts[1], expected.length);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const key = part.slice(0, eqIdx).trim();
    if (key === name) {
      return decodeURIComponent(part.slice(eqIdx + 1).trim());
    }
  }
  return null;
}

function buildSetCookieHeader(token: string, maxAgeSeconds: number, secure: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function isSecureRequest(request: FastifyRequest): boolean {
  const proto = request.headers["x-forwarded-proto"];
  if (typeof proto === "string" && proto.toLowerCase().includes("https")) {
    return true;
  }
  return request.protocol === "https";
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  deps: AuthRouteDeps,
): Promise<void> {
  const { dbContext, authEnabled } = deps;
  const { sqlite } = dbContext;

  const getUserCount = (): number => {
    const row = sqlite.prepare("SELECT COUNT(*) AS cnt FROM users").get() as { cnt: number };
    return row.cnt;
  };

  const resolveSessionUser = (request: FastifyRequest): AuthUser | null => {
    const rawToken = readCookie(request.headers.cookie, SESSION_COOKIE_NAME);
    if (!rawToken) return null;
    const tokenHash = hashToken(rawToken);
    const now = Date.now();
    const row = sqlite
      .prepare(
        `
        SELECT u.id, u.username, u.role
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > ?
      `,
      )
      .get(tokenHash, now) as { id: number; username: string; role: "admin" | "user" } | undefined;

    return row ?? null;
  };

  const createSession = (userId: number, request: FastifyRequest, reply: FastifyReply): void => {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(rawToken);
    const now = Date.now();
    const expiresAt = now + SESSION_TTL_MS;

    sqlite
      .prepare(
        "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(tokenHash, userId, expiresAt, now);

    reply.header(
      "Set-Cookie",
      buildSetCookieHeader(rawToken, Math.floor(SESSION_TTL_MS / 1000), isSecureRequest(request)),
    );
  };

  // When AUTH_ENABLED=true, protect all /api/* routes except /api/health and /api/auth/*
  if (authEnabled) {
    app.addHook("onRequest", async (request, reply) => {
      const urlPath = request.url.split("?")[0] ?? request.url;
      if (!urlPath.startsWith("/api/")) return;
      if (urlPath === "/api/health" || urlPath.startsWith("/api/auth/")) return;

      const user = resolveSessionUser(request);
      if (!user) {
        return reply.code(401).send({ error: "Authentication required" });
      }
    });
  }

  app.get("/api/auth/status", async (request): Promise<AuthStatusResponse> => {
    if (!authEnabled) {
      return {
        authEnabled: false,
        needsSetup: false,
        authenticated: true,
        user: null,
      };
    }

    const needsSetup = getUserCount() === 0;
    const user = needsSetup ? null : resolveSessionUser(request);
    return {
      authEnabled: true,
      needsSetup,
      authenticated: Boolean(user),
      user,
    };
  });

  // First-run admin setup (only allowed when 0 users exist)
  app.post("/api/auth/setup", async (request, reply): Promise<AuthStatusResponse> => {
    if (getUserCount() > 0) {
      return reply.code(409).send({ error: "Admin account is already set up. Please sign in." });
    }

    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      const msg = Object.values(parsed.error.flatten().fieldErrors).flat()[0] ?? "Invalid input";
      return reply.code(400).send({ error: msg });
    }

    const now = Date.now();
    const passwordHash = hashPassword(parsed.data.password);
    const res = sqlite
      .prepare(
        "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, 'admin', ?)",
      )
      .run(parsed.data.username, passwordHash, now);

    const user: AuthUser = {
      id: Number(res.lastInsertRowid),
      username: parsed.data.username,
      role: "admin",
    };

    createSession(user.id, request, reply);
    reply.code(201);
    return {
      authEnabled,
      needsSetup: false,
      authenticated: true,
      user,
    };
  });

  app.post("/api/auth/login", async (request, reply): Promise<AuthStatusResponse> => {
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Username and password are required." });
    }

    const row = sqlite
      .prepare(
        "SELECT id, username, password_hash AS passwordHash, role FROM users WHERE lower(username) = lower(?)",
      )
      .get(parsed.data.username) as
      | { id: number; username: string; passwordHash: string; role: "admin" | "user" }
      | undefined;

    if (!row || !verifyPassword(parsed.data.password, row.passwordHash)) {
      return reply.code(401).send({ error: "Invalid username or password." });
    }

    // Prune expired sessions opportunistically
    sqlite.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());

    createSession(row.id, request, reply);
    return {
      authEnabled,
      needsSetup: false,
      authenticated: true,
      user: { id: row.id, username: row.username, role: row.role },
    };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const rawToken = readCookie(request.headers.cookie, SESSION_COOKIE_NAME);
    if (rawToken) {
      sqlite.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(rawToken));
    }
    reply.header("Set-Cookie", buildSetCookieHeader("", 0, isSecureRequest(request)));
    return reply.code(200).send({ ok: true });
  });
}
