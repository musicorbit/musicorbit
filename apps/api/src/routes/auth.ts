import crypto from "node:crypto";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthStatusResponse, AuthUser } from "@musicorbit/shared";
import type { DbContext } from "../db/index.js";
import type { ActivityLogService } from "../services/activityLog.js";
import {
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from "../services/authHelpers.js";

const SESSION_COOKIE_NAME = "musicorbit_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOGIN_MAX_FAILURES = 10;

export interface AuthRouteDeps {
  dbContext: DbContext;
  authEnabled: boolean;
  getDefaultMusicDir: () => string;
  activityLog?: ActivityLogService;
}

const credentialsSchema = z.object({
  username: z
    .string()
    .trim()
    .min(2, "Username must be at least 2 characters")
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/, "Username may only contain letters, numbers, ., _, and -"),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required").max(200),
  newPassword: z.string().min(8, "New password must be at least 8 characters").max(200),
});

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
  const { dbContext, authEnabled, getDefaultMusicDir, activityLog } = deps;
  const { sqlite } = dbContext;

  // Sliding-window brute-force protection for POST /api/auth/login
  const failedAttempts = new Map<string, number[]>();

  const pruneAndCountFailures = (key: string): number => {
    const cutoff = Date.now() - LOGIN_WINDOW_MS;
    const recent = (failedAttempts.get(key) ?? []).filter((ts) => ts > cutoff);
    if (recent.length === 0) {
      failedAttempts.delete(key);
    } else {
      failedAttempts.set(key, recent);
    }
    return recent.length;
  };

  const recordLoginFailure = (key: string): void => {
    const cutoff = Date.now() - LOGIN_WINDOW_MS;
    const recent = (failedAttempts.get(key) ?? []).filter((ts) => ts > cutoff);
    recent.push(Date.now());
    failedAttempts.set(key, recent);
  };

  const getUserCount = (): number => {
    const row = sqlite.prepare("SELECT COUNT(*) AS cnt FROM users").get() as { cnt: number };
    return row.cnt;
  };

  const toAuthUser = (row: {
    id: number;
    username: string;
    role: "admin" | "user";
    musicDir: string | null;
    canUseSoulseek: number | null;
  }): AuthUser => ({
    id: row.id,
    username: row.username,
    role: row.role,
    musicDir: row.musicDir ? path.resolve(row.musicDir) : getDefaultMusicDir(),
    canUseSoulseek: row.role === "admin" || Boolean(row.canUseSoulseek),
  });

  const resolveSession = (
    request: FastifyRequest,
  ): { user: AuthUser; tokenHash: string } | null => {
    const rawToken = readCookie(request.headers.cookie, SESSION_COOKIE_NAME);
    if (!rawToken) return null;
    const tokenHash = hashSessionToken(rawToken);
    const now = Date.now();
    const row = sqlite
      .prepare(
        `
        SELECT
          u.id,
          u.username,
          u.role,
          u.music_dir AS musicDir,
          u.can_use_soulseek AS canUseSoulseek
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > ?
      `,
      )
      .get(tokenHash, now) as
      | {
          id: number;
          username: string;
          role: "admin" | "user";
          musicDir: string | null;
          canUseSoulseek: number | null;
        }
      | undefined;

    if (!row) return null;
    return { user: toAuthUser(row), tokenHash };
  };

  const createSession = (userId: number, request: FastifyRequest, reply: FastifyReply): string => {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashSessionToken(rawToken);
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
    return tokenHash;
  };

  // Attach request.authUser on every /api/* request and enforce session auth when enabled
  app.addHook("onRequest", async (request, reply) => {
    const urlPath = request.url.split("?")[0] ?? request.url;
    if (!urlPath.startsWith("/api/")) return;

    if (!authEnabled) {
      request.authUser = {
        id: 1,
        username: "local",
        role: "admin",
        musicDir: getDefaultMusicDir(),
        canUseSoulseek: true,
      };
      return;
    }

    const session = resolveSession(request);
    if (session) {
      request.authUser = session.user;
      request.authSessionTokenHash = session.tokenHash;
    }

    if (
      urlPath === "/api/health" ||
      urlPath === "/api/auth/status" ||
      urlPath === "/api/auth/setup" ||
      urlPath === "/api/auth/login" ||
      urlPath === "/api/auth/logout"
    ) {
      return;
    }

    if (!session) {
      return reply.code(401).send({ error: "Authentication required" });
    }
  });

  app.get("/api/auth/status", async (request): Promise<AuthStatusResponse> => {
    if (!authEnabled) {
      return {
        authEnabled: false,
        needsSetup: false,
        authenticated: true,
        user: request.authUser ?? null,
      };
    }

    const needsSetup = getUserCount() === 0;
    const session = needsSetup ? null : resolveSession(request);
    return {
      authEnabled: true,
      needsSetup,
      authenticated: Boolean(session),
      user: session?.user ?? null,
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
    const adminMusicDir = getDefaultMusicDir();

    const res = sqlite
      .prepare(
        `
        INSERT INTO users (username, password_hash, role, music_dir, can_use_soulseek, created_at)
        VALUES (?, ?, 'admin', ?, 1, ?)
      `,
      )
      .run(parsed.data.username, passwordHash, adminMusicDir, now);

    const adminId = Number(res.lastInsertRowid);

    // Adopt any pre-existing library rows created before multi-user setup
    if (adminId !== 1) {
      const adoptTx = sqlite.transaction(() => {
        for (const table of [
          "artists",
          "albums",
          "tracks",
          "playlists",
          "import_items",
          "scan_jobs",
        ]) {
          sqlite.prepare(`UPDATE ${table} SET user_id = ? WHERE user_id = 1`).run(adminId);
        }
      });
      adoptTx();
    }

    const user: AuthUser = {
      id: adminId,
      username: parsed.data.username,
      role: "admin",
      musicDir: adminMusicDir,
      canUseSoulseek: true,
    };

    createSession(user.id, request, reply);
    activityLog?.success("system", `Initial admin account "${user.username}" created`, {
      userId: user.id,
      musicDir: adminMusicDir,
    });
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

    const rateKey = `${request.ip}|${parsed.data.username.toLowerCase()}`;
    if (pruneAndCountFailures(rateKey) >= LOGIN_MAX_FAILURES) {
      reply.header("Retry-After", String(Math.ceil(LOGIN_WINDOW_MS / 1000)));
      return reply.code(429).send({
        error: "Too many failed sign-in attempts. Please wait a few minutes and try again.",
      });
    }

    const row = sqlite
      .prepare(
        `
        SELECT
          id,
          username,
          password_hash AS passwordHash,
          role,
          music_dir AS musicDir,
          can_use_soulseek AS canUseSoulseek
        FROM users
        WHERE lower(username) = lower(?)
      `,
      )
      .get(parsed.data.username) as
      | {
          id: number;
          username: string;
          passwordHash: string;
          role: "admin" | "user";
          musicDir: string | null;
          canUseSoulseek: number | null;
        }
      | undefined;

    if (!row || !verifyPassword(parsed.data.password, row.passwordHash)) {
      recordLoginFailure(rateKey);
      return reply.code(401).send({ error: "Invalid username or password." });
    }

    failedAttempts.delete(rateKey);

    // Prune expired sessions opportunistically
    sqlite.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());

    const user = toAuthUser(row);
    createSession(user.id, request, reply);
    return {
      authEnabled,
      needsSetup: false,
      authenticated: true,
      user,
    };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const rawToken = readCookie(request.headers.cookie, SESSION_COOKIE_NAME);
    if (rawToken) {
      sqlite
        .prepare("DELETE FROM sessions WHERE token_hash = ?")
        .run(hashSessionToken(rawToken));
    }
    reply.header("Set-Cookie", buildSetCookieHeader("", 0, isSecureRequest(request)));
    return reply.code(200).send({ ok: true });
  });

  // Self-service password change for any authenticated user (revokes all other active sessions)
  app.post("/api/auth/change-password", async (request, reply) => {
    if (!authEnabled) {
      return reply.code(400).send({ error: "Authentication is disabled." });
    }
    const user = request.authUser;
    if (!user) {
      return reply.code(401).send({ error: "Authentication required" });
    }

    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      const msg = Object.values(parsed.error.flatten().fieldErrors).flat()[0] ?? "Invalid password";
      return reply.code(400).send({ error: msg });
    }

    const row = sqlite
      .prepare("SELECT password_hash AS passwordHash FROM users WHERE id = ?")
      .get(user.id) as { passwordHash: string } | undefined;

    if (!row || !verifyPassword(parsed.data.currentPassword, row.passwordHash)) {
      return reply.code(401).send({ error: "Current password is incorrect." });
    }

    const nextHash = hashPassword(parsed.data.newPassword);
    sqlite.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(nextHash, user.id);

    // Revoke all other sessions for this user while keeping their current session signed in
    if (request.authSessionTokenHash) {
      sqlite
        .prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?")
        .run(user.id, request.authSessionTokenHash);
    }

    activityLog?.info("system", `User "${user.username}" changed their password`, {
      userId: user.id,
    });
    return { ok: true };
  });
}
