import fs from "node:fs";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { hashPassword } from "../services/authHelpers.js";

export interface ResetPasswordResult {
  id: number;
  username: string;
  role: string;
  revokedSessions: number;
}

/**
 * Resets a user's password directly in MusicOrbit's SQLite database using the
 * same salted scrypt KDF as the web API and immediately revokes all active
 * sessions for that user.
 */
export function resetUserPasswordInDb(
  dbPath: string,
  username: string,
  newPassword: string,
): ResetPasswordResult {
  const trimmedUsername = username.trim();
  if (!trimmedUsername) {
    throw new Error("Username is required.");
  }
  if (newPassword.length < 8) {
    throw new Error("Password must be at least 8 characters long.");
  }
  if (newPassword.length > 200) {
    throw new Error("Password must be 200 characters or fewer.");
  }
  if (!fs.existsSync(dbPath)) {
    throw new Error(
      `MusicOrbit database not found at "${dbPath}". Check DATA_DIR in your .env or environment.`,
    );
  }

  const sqlite = new Database(dbPath);
  try {
    sqlite.pragma("foreign_keys = ON");

    const tableExists = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'")
      .get() as { name: string } | undefined;
    if (!tableExists) {
      throw new Error(`No users table found in "${dbPath}". Has MusicOrbit been initialized?`);
    }

    const user = sqlite
      .prepare("SELECT id, username, role FROM users WHERE lower(username) = lower(?)")
      .get(trimmedUsername) as { id: number; username: string; role: string } | undefined;

    if (!user) {
      const existingUsers = sqlite
        .prepare("SELECT username, role FROM users ORDER BY id ASC")
        .all() as Array<{ username: string; role: string }>;
      const list =
        existingUsers.length > 0
          ? ` Available accounts: ${existingUsers.map((u) => `${u.username} (${u.role})`).join(", ")}.`
          : " No accounts exist yet — open MusicOrbit in your browser to run first-time Admin Setup.";
      throw new Error(`User "${trimmedUsername}" not found.${list}`);
    }

    const passwordHash = hashPassword(newPassword);
    let revokedSessions = 0;

    const tx = sqlite.transaction(() => {
      sqlite.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, user.id);
      const delRes = sqlite.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
      revokedSessions = delRes.changes;

      const logsExist = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'activity_logs'")
        .get();
      if (logsExist) {
        sqlite
          .prepare(
            "INSERT INTO activity_logs (level, category, message, details_json, created_at) VALUES (?, ?, ?, ?, ?)",
          )
          .run(
            "warn",
            "system",
            `Password reset via host CLI for "${user.username}"`,
            JSON.stringify({ userId: user.id, revokedSessions }),
            Date.now(),
          );
      }
    });
    tx();

    return {
      id: user.id,
      username: user.username,
      role: user.role,
      revokedSessions,
    };
  } finally {
    sqlite.close();
  }
}

let pipedLines: string[] | null = null;
let pipedLineIndex = 0;

async function readPipedLine(): Promise<string> {
  if (pipedLines === null) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    pipedLines = Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
  }
  return pipedLines[pipedLineIndex++] ?? "";
}

function promptVisible(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return readPipedLine().then((line) => line.trim());
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function promptHidden(question: string): Promise<string> {
  // Non-TTY fallback (piped input)
  if (!process.stdin.isTTY) {
    return readPipedLine();
  }

  return new Promise((resolve, reject) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let value = "";
    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(Boolean(wasRaw));
      stdin.pause();
    };

    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (ch === "\u0003") {
          // Ctrl+C
          cleanup();
          process.stdout.write("\n");
          reject(new Error("Cancelled."));
          return;
        }
        if (ch === "\u007f" || ch === "\b") {
          if (value.length > 0) {
            value = value.slice(0, -1);
          }
          continue;
        }
        value += ch;
      }
    };

    stdin.on("data", onData);
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  if (args.includes("-h") || args.includes("--help")) {
    console.log("Usage: npm run reset-password -- [username]");
    console.log("Interactively resets a MusicOrbit user password (salted scrypt) and revokes sessions.");
    process.exit(0);
  }

  if (args.length > 1) {
    console.error(
      "Error: Do not pass the password on the command line (it would be saved in shell history).",
    );
    console.error("Usage: npm run reset-password -- <username>");
    process.exit(1);
  }

  const { config } = await import("../config.js");
  console.log(`MusicOrbit Password Reset (database: ${config.dbPath})\n`);

  const username = args[0]?.trim() || (await promptVisible("Username to reset: "));
  if (!username) {
    console.error("Error: Username is required.");
    process.exit(1);
  }

  const newPassword = await promptHidden("New password (min 8 chars, hidden): ");
  if (newPassword.length < 8) {
    console.error("Error: Password must be at least 8 characters long.");
    process.exit(1);
  }

  const confirmPassword = await promptHidden("Confirm new password (hidden): ");
  if (newPassword !== confirmPassword) {
    console.error("Error: Passwords do not match.");
    process.exit(1);
  }

  const result = resetUserPasswordInDb(config.dbPath, username, newPassword);
  console.log(
    `\n✓ Password updated for "${result.username}" (${result.role}) using salted scrypt.`,
  );
  console.log(
    `  Revoked ${result.revokedSessions} active ${result.revokedSessions === 1 ? "session" : "sessions"}. You can now sign in with the new password.`,
  );
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]);

if (isEntryPoint) {
  main().catch((err: unknown) => {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
