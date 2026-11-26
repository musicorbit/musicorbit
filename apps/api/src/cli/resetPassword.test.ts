import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { initDatabase } from "../db/index.js";
import { hashPassword, hashSessionToken, verifyPassword } from "../services/authHelpers.js";
import { resetUserPasswordInDb } from "./resetPassword.js";

describe("Host CLI Password Reset", () => {
  let tmpRoot: string;
  let dbPath: string;

  before(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "musicorbit-resetpw-"));
    dbPath = path.join(tmpRoot, "musicorbit.db");
    const ctx = initDatabase(dbPath);
    const now = Date.now();
    const initialHash = hashPassword("OldAdminPass123!");
    ctx.sqlite
      .prepare(
        "INSERT INTO users (username, password_hash, role, music_dir, can_use_soulseek, created_at) VALUES (?, ?, 'admin', ?, 1, ?)",
      )
      .run("admin", initialHash, tmpRoot, now);

    // Insert 2 active sessions for admin
    ctx.sqlite
      .prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, 1, ?, ?)")
      .run(hashSessionToken("session-a"), now + 60_000, now);
    ctx.sqlite
      .prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, 1, ?, ?)")
      .run(hashSessionToken("session-b"), now + 60_000, now);
    ctx.sqlite.close();
  });

  after(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("resets password with salted scrypt hash, revokes active sessions, and logs the reset", () => {
    const res = resetUserPasswordInDb(dbPath, "ADMIN", "NewRecoveryPass!2026");
    assert.equal(res.username, "admin");
    assert.equal(res.role, "admin");
    assert.equal(res.revokedSessions, 2);

    const ctx = initDatabase(dbPath);
    try {
      const row = ctx.sqlite
        .prepare("SELECT password_hash AS passwordHash FROM users WHERE id = 1")
        .get() as { passwordHash: string };
      assert.ok(row.passwordHash.startsWith("scrypt:"));
      assert.equal(verifyPassword("OldAdminPass123!", row.passwordHash), false);
      assert.equal(verifyPassword("NewRecoveryPass!2026", row.passwordHash), true);

      const remainingSessions = (
        ctx.sqlite.prepare("SELECT COUNT(*) AS cnt FROM sessions WHERE user_id = 1").get() as {
          cnt: number;
        }
      ).cnt;
      assert.equal(remainingSessions, 0);

      const logRow = ctx.sqlite
        .prepare("SELECT message FROM activity_logs ORDER BY id DESC LIMIT 1")
        .get() as { message: string } | undefined;
      assert.ok(logRow?.message.includes("host CLI"));
    } finally {
      ctx.sqlite.close();
    }
  });

  it("rejects short passwords and unknown usernames cleanly", () => {
    assert.throws(() => resetUserPasswordInDb(dbPath, "admin", "short"), /at least 8 characters/);
    assert.throws(() => resetUserPasswordInDb(dbPath, "ghost", "ValidPassword123!"), /not found/);
    assert.throws(
      () => resetUserPasswordInDb(path.join(tmpRoot, "missing.db"), "admin", "ValidPassword123!"),
      /database not found/,
    );
  });
});
