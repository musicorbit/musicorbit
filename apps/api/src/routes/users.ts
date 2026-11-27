import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { UserSummary } from "@musicorbit/shared";
import type { DbContext } from "../db/index.js";
import type { ActivityLogService } from "../services/activityLog.js";
import { getRequestUser, hashPassword, requireAdmin } from "../services/authHelpers.js";
import { sanitizeLayoutSegment } from "../services/libraryLayout.js";
import type { SettingsService } from "../services/settings.js";

export interface UsersRouteDeps {
  dbContext: DbContext;
  settingsService: SettingsService;
  activityLog?: ActivityLogService;
}

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const createUserBodySchema = z.object({
  username: z
    .string()
    .trim()
    .min(2, "Username must be at least 2 characters")
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/, "Username may only contain letters, numbers, ., _, and -"),
  displayName: z
    .string()
    .trim()
    .max(80, "Display name must be at most 80 characters")
    .nullable()
    .optional(),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  role: z.enum(["admin", "user"]).default("user"),
  musicDir: z.string().trim().max(1000).optional(),
  canUseSoulseek: z.boolean().default(false),
});

const updateUserBodySchema = z.object({
  displayName: z
    .string()
    .trim()
    .max(80, "Display name must be at most 80 characters")
    .nullable()
    .optional(),
  role: z.enum(["admin", "user"]).optional(),
  musicDir: z.string().trim().min(1).max(1000).optional(),
  canUseSoulseek: z.boolean().optional(),
  password: z.string().min(8, "Password must be at least 8 characters").max(200).optional(),
});

function pathsOverlap(a: string, b: string): boolean {
  const resA = path.resolve(a);
  const resB = path.resolve(b);
  if (resA === resB) return true;
  const relAB = path.relative(resA, resB);
  const relBA = path.relative(resB, resA);
  return (
    (relAB !== "" && !relAB.startsWith("..") && !path.isAbsolute(relAB)) ||
    (relBA !== "" && !relBA.startsWith("..") && !path.isAbsolute(relBA))
  );
}

/**
 * Admin-only user management endpoints.
 * Each user gets their own isolated music directory and per-user permissions.
 */
export async function registerUserRoutes(
  app: FastifyInstance,
  deps: UsersRouteDeps,
): Promise<void> {
  const { dbContext, settingsService, activityLog } = deps;
  const { sqlite } = dbContext;

  const loadUserSummary = (userId: number): UserSummary | null => {
    const row = sqlite
      .prepare(
        `
        SELECT
          u.id,
          u.username,
          u.display_name AS displayName,
          u.role,
          u.music_dir AS musicDir,
          u.can_use_soulseek AS canUseSoulseek,
          u.created_at AS createdAt,
          (SELECT COUNT(*) FROM artists ar WHERE ar.user_id = u.id) AS artistCount,
          (SELECT COUNT(*) FROM albums al WHERE al.user_id = u.id) AS albumCount,
          (SELECT COUNT(*) FROM tracks t WHERE t.user_id = u.id) AS trackCount,
          (SELECT COUNT(*) FROM playlists p WHERE p.user_id = u.id) AS playlistCount
        FROM users u
        WHERE u.id = ?
      `,
      )
      .get(userId) as
      | {
          id: number;
          username: string;
          displayName: string | null;
          role: "admin" | "user";
          musicDir: string | null;
          canUseSoulseek: number | null;
          createdAt: number;
          artistCount: number;
          albumCount: number;
          trackCount: number;
          playlistCount: number;
        }
      | undefined;

    if (!row) return null;
    return {
      id: row.id,
      username: row.username,
      displayName: row.displayName?.trim() || null,
      role: row.role,
      musicDir: row.musicDir ? path.resolve(row.musicDir) : settingsService.getMusicDir(),
      canUseSoulseek: row.role === "admin" || Boolean(row.canUseSoulseek),
      createdAt: new Date(row.createdAt).toISOString(),
      counts: {
        artists: row.artistCount,
        albums: row.albumCount,
        tracks: row.trackCount,
        playlists: row.playlistCount,
      },
    };
  };

  const checkDirCollision = (candidateDir: string, excludeUserId?: number): string | null => {
    const users = sqlite
      .prepare("SELECT id, username, music_dir AS musicDir FROM users")
      .all() as Array<{ id: number; username: string; musicDir: string | null }>;
    for (const u of users) {
      if (excludeUserId !== undefined && u.id === excludeUserId) continue;
      const otherDir = u.musicDir ? path.resolve(u.musicDir) : settingsService.getMusicDir();
      if (pathsOverlap(candidateDir, otherDir)) {
        return `Library folder overlaps with user "${u.username}" (${otherDir}). Choose a separate folder for each user.`;
      }
    }
    return null;
  };

  // List all users (Admin only)
  app.get("/api/users", async (request, reply): Promise<UserSummary[]> => {
    if (!requireAdmin(request, reply)) return [];
    const ids = sqlite
      .prepare("SELECT id FROM users ORDER BY created_at ASC, id ASC")
      .all() as Array<{ id: number }>;
    return ids.map((r) => loadUserSummary(r.id)).filter((u): u is UserSummary => u !== null);
  });

  // Create a new user with isolated library folder (Admin only)
  app.post("/api/users", async (request, reply): Promise<UserSummary> => {
    if (!requireAdmin(request, reply)) return reply.send();

    const parsed = createUserBodySchema.safeParse(request.body);
    if (!parsed.success) {
      const msg = Object.values(parsed.error.flatten().fieldErrors).flat()[0] ?? "Invalid user data";
      return reply.code(400).send({ error: msg });
    }

    const existing = sqlite
      .prepare("SELECT id FROM users WHERE lower(username) = lower(?)")
      .get(parsed.data.username) as { id: number } | undefined;
    if (existing) {
      return reply.code(409).send({ error: `Username "${parsed.data.username}" already exists.` });
    }

    // Default each new user to a sibling folder beside the Admin's musicDir (e.g. <parent>/users/<username>)
    // so it NEVER nests inside the Admin's own scanned library folder!
    const safeName = sanitizeLayoutSegment(parsed.data.username, "user");
    const defaultUserDir = path.join(
      path.dirname(settingsService.getMusicDir()),
      "libraries",
      safeName,
    );
    const resolvedDir = parsed.data.musicDir?.trim()
      ? path.resolve(parsed.data.musicDir.trim())
      : path.resolve(defaultUserDir);

    const collision = checkDirCollision(resolvedDir);
    if (collision) {
      return reply.code(400).send({ error: collision });
    }

    try {
      fs.mkdirSync(resolvedDir, { recursive: true });
    } catch (err) {
      return reply.code(400).send({
        error: `Could not create library folder "${resolvedDir}": ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    const now = Date.now();
    const passwordHash = hashPassword(parsed.data.password);
    const canUseSoulseek = parsed.data.role === "admin" ? 1 : parsed.data.canUseSoulseek ? 1 : 0;
    const displayName = parsed.data.displayName?.trim() || null;

    const inserted = sqlite
      .prepare(
        `
        INSERT INTO users (username, display_name, password_hash, role, music_dir, can_use_soulseek, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        parsed.data.username,
        displayName,
        passwordHash,
        parsed.data.role,
        resolvedDir,
        canUseSoulseek,
        now,
      );

    const newId = Number(inserted.lastInsertRowid);
    const summary = loadUserSummary(newId)!;

    activityLog?.success("system", `Created user "${summary.username}" (${summary.role})`, {
      userId: summary.id,
      musicDir: summary.musicDir,
      canUseSoulseek: summary.canUseSoulseek,
    });

    reply.code(201);
    return summary;
  });

  // Update a user's role, library folder, Soulseek access, or reset their password (Admin only)
  app.put("/api/users/:id", async (request, reply): Promise<UserSummary> => {
    if (!requireAdmin(request, reply)) return reply.send();

    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: "Invalid user ID" });
    }
    const parsedBody = updateUserBodySchema.safeParse(request.body);
    if (!parsedBody.success) {
      const msg = Object.values(parsedBody.error.flatten().fieldErrors).flat()[0] ?? "Invalid update";
      return reply.code(400).send({ error: msg });
    }

    const targetId = parsedParams.data.id;
    const existing = sqlite
      .prepare(
        "SELECT id, username, display_name AS displayName, role, music_dir AS musicDir, can_use_soulseek AS canUseSoulseek FROM users WHERE id = ?",
      )
      .get(targetId) as
      | {
          id: number;
          username: string;
          displayName: string | null;
          role: "admin" | "user";
          musicDir: string | null;
          canUseSoulseek: number;
        }
      | undefined;

    if (!existing) {
      return reply.code(404).send({ error: "User not found" });
    }

    const nextRole = parsedBody.data.role ?? existing.role;
    if (existing.role === "admin" && nextRole !== "admin") {
      const adminCount = (
        sqlite.prepare("SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin'").get() as {
          cnt: number;
        }
      ).cnt;
      if (adminCount <= 1) {
        return reply.code(400).send({ error: "Cannot demote the last remaining administrator." });
      }
    }

    let nextMusicDir = existing.musicDir;
    if (parsedBody.data.musicDir !== undefined) {
      const resolved = path.resolve(parsedBody.data.musicDir);
      const collision = checkDirCollision(resolved, targetId);
      if (collision) {
        return reply.code(400).send({ error: collision });
      }
      try {
        fs.mkdirSync(resolved, { recursive: true });
      } catch (err) {
        return reply.code(400).send({
          error: `Could not access library folder "${resolved}": ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      nextMusicDir = resolved;
    }

    const nextSoulseek =
      nextRole === "admin"
        ? 1
        : parsedBody.data.canUseSoulseek !== undefined
          ? parsedBody.data.canUseSoulseek
            ? 1
            : 0
          : existing.canUseSoulseek;

    const nextDisplayName =
      parsedBody.data.displayName !== undefined
        ? parsedBody.data.displayName?.trim() || null
        : existing.displayName;

    if (parsedBody.data.password) {
      const nextHash = hashPassword(parsedBody.data.password);
      sqlite
        .prepare(
          "UPDATE users SET display_name = ?, role = ?, music_dir = ?, can_use_soulseek = ?, password_hash = ? WHERE id = ?",
        )
        .run(nextDisplayName, nextRole, nextMusicDir, nextSoulseek, nextHash, targetId);
      // Immediately invalidate all active sessions for that user on password reset
      sqlite.prepare("DELETE FROM sessions WHERE user_id = ?").run(targetId);
    } else {
      sqlite
        .prepare(
          "UPDATE users SET display_name = ?, role = ?, music_dir = ?, can_use_soulseek = ? WHERE id = ?",
        )
        .run(nextDisplayName, nextRole, nextMusicDir, nextSoulseek, targetId);
    }

    const updated = loadUserSummary(targetId)!;
    activityLog?.info("system", `Updated user "${updated.username}"`, {
      userId: updated.id,
      role: updated.role,
      canUseSoulseek: updated.canUseSoulseek,
      passwordReset: Boolean(parsedBody.data.password),
    });
    return updated;
  });

  // Delete a user account (Admin only; never deletes audio files on disk)
  app.delete("/api/users/:id", async (request, reply) => {
    if (!requireAdmin(request, reply)) return reply.send();

    const parsedParams = idParamSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.code(400).send({ error: "Invalid user ID" });
    }

    const actor = getRequestUser(request);
    const targetId = parsedParams.data.id;
    if (actor.id === targetId) {
      return reply.code(400).send({ error: "You cannot delete your own active account." });
    }

    const existing = sqlite
      .prepare("SELECT id, username, role FROM users WHERE id = ?")
      .get(targetId) as { id: number; username: string; role: "admin" | "user" } | undefined;
    if (!existing) {
      return reply.code(404).send({ error: "User not found" });
    }

    if (existing.role === "admin") {
      const adminCount = (
        sqlite.prepare("SELECT COUNT(*) AS cnt FROM users WHERE role = 'admin'").get() as {
          cnt: number;
        }
      ).cnt;
      if (adminCount <= 1) {
        return reply.code(400).send({ error: "Cannot delete the last remaining administrator." });
      }
    }

    // Delete user's database records inside a transaction (leaves audio files untouched on disk)
    const tx = sqlite.transaction(() => {
      sqlite.prepare("DELETE FROM playlists WHERE user_id = ?").run(targetId);
      sqlite.prepare("DELETE FROM tracks WHERE user_id = ?").run(targetId);
      sqlite.prepare("DELETE FROM albums WHERE user_id = ?").run(targetId);
      sqlite.prepare("DELETE FROM artists WHERE user_id = ?").run(targetId);
      sqlite.prepare("DELETE FROM import_items WHERE user_id = ?").run(targetId);
      sqlite.prepare("DELETE FROM scan_jobs WHERE user_id = ?").run(targetId);
      sqlite.prepare("DELETE FROM user_settings WHERE user_id = ?").run(targetId);
      sqlite.prepare("DELETE FROM download_ownership WHERE user_id = ?").run(targetId);
      sqlite.prepare("DELETE FROM users WHERE id = ?").run(targetId);
    });
    tx();

    activityLog?.warn("system", `Deleted user "${existing.username}" (files on disk preserved)`, {
      deletedUserId: targetId,
    });
    return { deleted: true, id: targetId };
  });
}
