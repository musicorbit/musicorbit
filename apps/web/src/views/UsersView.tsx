import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  FolderOpen,
  KeyRound,
  Loader2,
  Pencil,
  Radio,
  RefreshCw,
  Shield,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import type { UserSummary } from "@musicorbit/shared";
import { createUser, deleteUser, fetchUsers, updateUser } from "../api/client";
import { useModalAccessibility } from "../hooks/useModalAccessibility";

interface UsersViewProps {
  currentUserId: number | null;
  slskdConfigured: boolean;
}

function generateStrongPassword(): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*";
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function UsersView({ currentUserId, slskdConfigured }: UsersViewProps) {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserSummary | null>(null);
  const [deletingUser, setDeletingUser] = useState<UserSummary | null>(null);
  const [togglingSoulseekId, setTogglingSoulseekId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchUsers();
      setUsers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const adminCount = users.filter((u) => u.role === "admin").length;
  const soulseekCount = users.filter((u) => u.canUseSoulseek).length;
  const totalTracks = users.reduce((sum, u) => sum + u.counts.tracks, 0);

  const handleQuickToggleSoulseek = async (user: UserSummary) => {
    if (user.role === "admin") return;
    setTogglingSoulseekId(user.id);
    setError(null);
    setNotice(null);
    try {
      const updated = await updateUser(user.id, { canUseSoulseek: !user.canUseSoulseek });
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      setNotice(
        `Soulseek access ${updated.canUseSoulseek ? "enabled" : "disabled"} for "${updated.username}".`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update Soulseek permission");
    } finally {
      setTogglingSoulseekId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-50">
            Users &amp; Isolated Libraries
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            Manage accounts, per-user music directories, and Soulseek download permissions. Each
            user sees only their own library, playlists, uploads, and Review Queue.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-45"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>

          <button
            type="button"
            onClick={() => {
              setNotice(null);
              setCreateOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400"
          >
            <UserPlus className="h-4 w-4" />
            Create User
          </button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-[11px] font-medium tracking-wider text-zinc-400 uppercase">Accounts</p>
          <p className="mt-2 text-2xl font-semibold text-zinc-50">{users.length}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-[11px] font-medium tracking-wider text-zinc-400 uppercase">Admins</p>
          <p className="mt-2 text-2xl font-semibold text-amber-400">{adminCount}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-[11px] font-medium tracking-wider text-zinc-400 uppercase">
            Soulseek Allowed
          </p>
          <p className="mt-2 text-2xl font-semibold text-emerald-400">{soulseekCount}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <p className="text-[11px] font-medium tracking-wider text-zinc-400 uppercase">
            Total Tracks
          </p>
          <p className="mt-2 text-2xl font-semibold text-zinc-100">{totalTracks}</p>
        </div>
      </div>

      {/* Security & Routing Info Banner */}
      <div className="flex items-start gap-3 rounded-xl border border-zinc-800/90 bg-zinc-900/40 p-4 text-xs text-zinc-300">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <div className="space-y-1">
          <p className="font-medium text-zinc-100">
            Per-user isolation &amp; password security
          </p>
          <p className="text-zinc-400">
            Passwords are salted per user and hashed with <code>scrypt</code> (never stored in
            plaintext). Browser uploads and authorized Soulseek downloads route automatically into
            the requesting user&apos;s own library folder.
            {!slskdConfigured &&
              " (slskd is currently not configured, so Soulseek UI stays hidden for all accounts.)"}
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 text-xs text-red-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-xs text-emerald-200">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          <span>{notice}</span>
        </div>
      )}

      {/* User List */}
      <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/50">
        {loading && users.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
            Loading users…
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Users className="h-8 w-8 text-zinc-600" />
            <p className="mt-2 text-sm font-medium text-zinc-300">No user accounts found</p>
          </div>
        ) : (
          <div className="divide-y divide-zinc-800/80">
            {users.map((user) => {
              const isSelf = currentUserId === user.id;
              const isLastAdmin = user.role === "admin" && adminCount <= 1;
              const canDelete = !isSelf && !isLastAdmin;

              return (
                <div
                  key={user.id}
                  className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-100">{user.username}</span>
                      {isSelf && (
                        <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-300">
                          You
                        </span>
                      )}
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          user.role === "admin"
                            ? "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30"
                            : "bg-zinc-800 text-zinc-300"
                        }`}
                      >
                        {user.role === "admin" && <Shield className="h-3 w-3" />}
                        {user.role === "admin" ? "Admin" : "User"}
                      </span>

                      {user.role === "admin" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                          <Radio className="h-3 w-3" />
                          Soulseek Always On
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={togglingSoulseekId === user.id}
                          onClick={() => void handleQuickToggleSoulseek(user)}
                          title="Click to toggle Soulseek search & download permission"
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${
                            user.canUseSoulseek
                              ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25"
                              : "bg-zinc-800 text-zinc-400 ring-1 ring-zinc-700/70 hover:bg-zinc-700 hover:text-zinc-200"
                          }`}
                        >
                          <Radio className="h-3 w-3" />
                          {user.canUseSoulseek ? "Soulseek Enabled" : "Soulseek Off"}
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                      <FolderOpen className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                      <span className="truncate font-mono text-[11px]" title={user.musicDir}>
                        {user.musicDir}
                      </span>
                    </div>

                    <p className="text-xs text-zinc-500">
                      {user.counts.albums} {user.counts.albums === 1 ? "album" : "albums"} ·{" "}
                      {user.counts.tracks} {user.counts.tracks === 1 ? "track" : "tracks"} ·{" "}
                      {user.counts.playlists} {user.counts.playlists === 1 ? "playlist" : "playlists"}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setNotice(null);
                        setEditingUser(user);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-amber-500/50 hover:bg-zinc-800 hover:text-amber-300"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      Edit
                    </button>

                    <button
                      type="button"
                      disabled={!canDelete}
                      title={
                        isSelf
                          ? "You cannot delete your own active account"
                          : isLastAdmin
                            ? "Cannot delete the last administrator"
                            : `Delete user ${user.username}`
                      }
                      onClick={() => {
                        setNotice(null);
                        setDeletingUser(user);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-400 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-35"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {createOpen && (
        <CreateUserModal
          onClose={() => setCreateOpen(false)}
          onCreated={(created) => {
            setCreateOpen(false);
            setUsers((prev) => [...prev, created]);
            setNotice(
              `Created user "${created.username}" with isolated library at ${created.musicDir}.`,
            );
          }}
        />
      )}

      {editingUser && (
        <EditUserModal
          user={editingUser}
          isLastAdmin={editingUser.role === "admin" && adminCount <= 1}
          onClose={() => setEditingUser(null)}
          onSaved={(updated, passwordWasReset) => {
            setEditingUser(null);
            setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
            setNotice(
              passwordWasReset
                ? `Updated "${updated.username}" and reset their password (active sessions revoked).`
                : `Updated "${updated.username}".`,
            );
          }}
        />
      )}

      {deletingUser && (
        <DeleteUserModal
          user={deletingUser}
          onClose={() => setDeletingUser(null)}
          onDeleted={(deletedId, username) => {
            setDeletingUser(null);
            setUsers((prev) => prev.filter((u) => u.id !== deletedId));
            setNotice(`Deleted user "${username}". Audio files on disk were preserved.`);
          }}
        />
      )}
    </div>
  );
}

interface CreateUserModalProps {
  onClose: () => void;
  onCreated: (user: UserSummary) => void;
}

function CreateUserModal({ onClose, onCreated }: CreateUserModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalAccessibility(dialogRef, onClose);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<"user" | "admin">("user");
  const [musicDir, setMusicDir] = useState("");
  // Explicit user requirement: default Soulseek access to OFF for new non-admin users
  const [canUseSoulseek, setCanUseSoulseek] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const created = await createUser({
        username: username.trim(),
        password,
        role,
        musicDir: musicDir.trim() || undefined,
        canUseSoulseek: role === "admin" ? true : canUseSoulseek,
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create user");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-user-title"
        tabIndex={-1}
        className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl focus:outline-none"
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30">
              <UserPlus className="h-5 w-5" />
            </div>
            <div>
              <h3 id="create-user-title" className="text-base font-semibold text-zinc-50">
                Create User Account
              </h3>
              <p className="text-xs text-zinc-400">
                Each user gets their own isolated music library, playlists, and uploads.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close create user dialog"
            className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-zinc-300">Username</span>
              <input
                data-autofocus
                type="text"
                required
                minLength={2}
                maxLength={64}
                placeholder="e.g. alex"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-zinc-300">Role</span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as "user" | "admin")}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none"
              >
                <option value="user" className="bg-zinc-900 text-zinc-100">
                  User (own library only)
                </option>
                <option value="admin" className="bg-zinc-900 text-zinc-100">
                  Administrator (full server access)
                </option>
              </select>
            </label>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-300">Initial Password</span>
              <button
                type="button"
                onClick={() => {
                  setPassword(generateStrongPassword());
                  setShowPassword(true);
                }}
                className="text-[11px] font-medium text-amber-400 transition hover:text-amber-300"
              >
                Generate strong password
              </button>
            </div>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                required
                minLength={8}
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 py-2 pr-10 pl-3 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute top-1/2 right-2.5 -translate-y-1/2 text-zinc-400 hover:text-zinc-200"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-[11px] text-zinc-500">
              Hashed immediately with scrypt + unique salt. Users can change their password anytime.
            </p>
          </div>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-zinc-300">
              Library Folder Path <span className="font-normal text-zinc-500">(optional)</span>
            </span>
            <input
              type="text"
              placeholder="Leave blank to auto-create sibling libraries/<username> folder"
              value={musicDir}
              onChange={(e) => setMusicDir(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100 placeholder:font-sans placeholder:text-zinc-500 focus:border-amber-500/60 focus:outline-none"
            />
            <p className="text-[11px] text-zinc-500">
              Must be a separate directory that does not overlap another user&apos;s library.
            </p>
          </label>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5 text-xs text-zinc-200">
            <input
              type="checkbox"
              checked={role === "admin" ? true : canUseSoulseek}
              disabled={role === "admin"}
              onChange={(e) => setCanUseSoulseek(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded accent-amber-500"
            />
            <span>
              <strong className="block font-medium text-zinc-100">
                Allow Soulseek Search &amp; Downloads
              </strong>
              <span className="mt-0.5 block text-zinc-400">
                {role === "admin"
                  ? "Administrators always have Soulseek access when slskd is configured."
                  : "Off by default. When enabled, this user can search Soulseek and downloads will route straight into their private library."}
              </span>
            </span>
          </label>

          <div className="flex items-center justify-end gap-2 border-t border-zinc-800 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-45"
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Create User
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface EditUserModalProps {
  user: UserSummary;
  isLastAdmin: boolean;
  onClose: () => void;
  onSaved: (updated: UserSummary, passwordWasReset: boolean) => void;
}

function EditUserModal({ user, isLastAdmin, onClose, onSaved }: EditUserModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalAccessibility(dialogRef, onClose);

  const [role, setRole] = useState<"user" | "admin">(user.role);
  const [musicDir, setMusicDir] = useState(user.musicDir);
  const [canUseSoulseek, setCanUseSoulseek] = useState(user.canUseSoulseek);
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword && newPassword.length < 8) {
      setError("Reset password must be at least 8 characters long.");
      return;
    }

    setSubmitting(true);
    try {
      const updated = await updateUser(user.id, {
        role,
        musicDir: musicDir.trim() || undefined,
        canUseSoulseek: role === "admin" ? true : canUseSoulseek,
        password: newPassword || undefined,
      });
      onSaved(updated, Boolean(newPassword));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update user");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-user-title"
        tabIndex={-1}
        className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl focus:outline-none"
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <h3 id="edit-user-title" className="text-base font-semibold text-zinc-50">
                Edit User: {user.username}
              </h3>
              <p className="text-xs text-zinc-400">
                Update role, library folder, Soulseek permission, or reset password.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close edit user dialog"
            className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-zinc-300">Role</span>
            <select
              data-autofocus
              value={role}
              disabled={isLastAdmin}
              onChange={(e) => setRole(e.target.value as "user" | "admin")}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none disabled:opacity-50"
            >
              <option value="user" className="bg-zinc-900 text-zinc-100">
                User
              </option>
              <option value="admin" className="bg-zinc-900 text-zinc-100">
                Administrator
              </option>
            </select>
            {isLastAdmin && (
              <p className="text-[11px] text-zinc-500">
                At least one administrator account is required.
              </p>
            )}
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-zinc-300">Library Folder Path</span>
            <input
              type="text"
              required
              value={musicDir}
              onChange={(e) => setMusicDir(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100 focus:border-amber-500/60 focus:outline-none"
            />
          </label>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5 text-xs text-zinc-200">
            <input
              type="checkbox"
              checked={role === "admin" ? true : canUseSoulseek}
              disabled={role === "admin"}
              onChange={(e) => setCanUseSoulseek(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded accent-amber-500"
            />
            <span>
              <strong className="block font-medium text-zinc-100">
                Allow Soulseek Search &amp; Downloads
              </strong>
              <span className="mt-0.5 block text-zinc-400">
                {role === "admin"
                  ? "Administrators always have Soulseek access."
                  : "Controls whether this user can search Soulseek and enqueue downloads."}
              </span>
            </span>
          </label>

          <div className="space-y-1 border-t border-zinc-800/80 pt-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-300">
                Reset Password <span className="font-normal text-zinc-500">(optional)</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setNewPassword(generateStrongPassword());
                  setShowPassword(true);
                }}
                className="text-[11px] font-medium text-amber-400 transition hover:text-amber-300"
              >
                Generate strong password
              </button>
            </div>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Leave blank to keep current password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 py-2 pr-10 pl-3 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute top-1/2 right-2.5 -translate-y-1/2 text-zinc-400 hover:text-zinc-200"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-[11px] text-zinc-500">
              Setting a new password immediately signs out all active sessions for {user.username}.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-zinc-800 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-45"
            >
              {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface DeleteUserModalProps {
  user: UserSummary;
  onClose: () => void;
  onDeleted: (userId: number, username: string) => void;
}

function DeleteUserModal({ user, onClose, onDeleted }: DeleteUserModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalAccessibility(dialogRef, onClose);

  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setDeleting(true);
    setError(null);
    try {
      await deleteUser(user.id);
      onDeleted(user.id, user.username);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete user");
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-user-title"
        tabIndex={-1}
        className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl focus:outline-none"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/15 text-red-400 ring-1 ring-red-500/30">
              <Trash2 className="h-5 w-5" />
            </div>
            <div>
              <h3 id="delete-user-title" className="text-base font-semibold text-zinc-50">
                Delete User &ldquo;{user.username}&rdquo;?
              </h3>
              <p className="text-xs text-zinc-400">Audio files on disk will not be deleted.</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close delete user dialog"
            className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-xs leading-relaxed text-zinc-300">
          This permanently removes <strong>{user.username}</strong>&apos;s login account, playlists (
          {user.counts.playlists}), and MusicOrbit database index ({user.counts.tracks} tracks).
          Their music folder at <code className="text-zinc-200">{user.musicDir}</code> remains
          untouched on disk.
        </p>

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2 border-t border-zinc-800 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2 text-xs font-medium text-zinc-300 transition hover:bg-zinc-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={deleting}
            onClick={() => void handleConfirm()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-red-400 disabled:opacity-45"
          >
            {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Delete Account
          </button>
        </div>
      </div>
    </div>
  );
}
