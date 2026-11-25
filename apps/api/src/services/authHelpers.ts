import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthUser } from "@musicorbit/shared";

const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 } as const;
const SCRYPT_KEYLEN = 64;

declare module "fastify" {
  interface FastifyRequest {
    authUser?: AuthUser;
    authSessionTokenHash?: string;
  }
}

/**
 * Hashes a plaintext password using Node's native scrypt KDF with a unique 128-bit
 * cryptographic random salt per password. Plaintext passwords are NEVER stored.
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS).toString("hex");
  return `scrypt:${salt}:${derived}`;
}

/**
 * Constant-time password verification against a stored scrypt hash.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt" || !parts[1] || !parts[2]) {
    return false;
  }
  const expected = Buffer.from(parts[2], "hex");
  if (expected.length === 0) return false;
  const actual = crypto.scryptSync(password, parts[1], expected.length, SCRYPT_OPTIONS);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

/**
 * Hashes a random session cookie token using SHA-256 so raw tokens are never stored in SQLite.
 */
export function hashSessionToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Returns the authenticated user attached to the request (or the synthetic local admin
 * when AUTH_ENABLED=false in dev/test mode).
 */
export function getRequestUser(request: FastifyRequest): AuthUser {
  if (!request.authUser) {
    throw new Error("Request authUser context is missing");
  }
  return request.authUser;
}

/**
 * Guard helper for admin-only endpoints. Sends 403 Forbidden and returns null for non-admins.
 */
export function requireAdmin(request: FastifyRequest, reply: FastifyReply): AuthUser | null {
  const user = getRequestUser(request);
  if (user.role !== "admin") {
    void reply.code(403).send({ error: "Administrator privileges required." });
    return null;
  }
  return user;
}

/**
 * Guard helper for Soulseek / slskd endpoints. Admins always have access;
 * regular users require explicit admin opt-in (`canUseSoulseek`).
 */
export function requireSoulseekAccess(
  request: FastifyRequest,
  reply: FastifyReply,
): AuthUser | null {
  const user = getRequestUser(request);
  if (user.role === "admin" || user.canUseSoulseek) {
    return user;
  }
  void reply.code(403).send({
    error: "Soulseek access is not enabled for your account. Ask an administrator to enable it.",
  });
  return null;
}
