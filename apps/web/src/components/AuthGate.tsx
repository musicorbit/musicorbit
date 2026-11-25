import { useState } from "react";
import { AlertCircle, Disc3, Eye, EyeOff, Loader2, Lock, ShieldCheck } from "lucide-react";
import type { AuthStatusResponse } from "@musicorbit/shared";
import { loginUser, setupAdmin } from "../api/client";

interface AuthGateProps {
  needsSetup: boolean;
  onAuthenticated: (status: AuthStatusResponse) => void;
}

export function AuthGate({ needsSetup, onAuthenticated }: AuthGateProps) {
  const [username, setUsername] = useState(needsSetup ? "admin" : "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (needsSetup && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      const next = needsSetup
        ? await setupAdmin(username.trim(), password)
        : await loginUser(username.trim(), password);
      onAuthenticated(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-6 text-zinc-100">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/70 p-8 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30">
            <Disc3 className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-50">MusicOrbit</h1>
            <p className="text-xs text-zinc-400">
              {needsSetup ? "First-run admin setup" : "Sign in to your music library"}
            </p>
          </div>
        </div>

        {needsSetup && (
          <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <span>
              Create your administrator account. Any existing music library and playlists will be
              linked to this account automatically. Passwords are salted per user and hashed with{" "}
              <code>scrypt</code> — never stored in plaintext.
            </span>
          </div>
        )}

        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-zinc-400">Username</span>
            <input
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-zinc-400">Password</span>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete={needsSetup ? "new-password" : "current-password"}
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={needsSetup ? "At least 8 characters" : ""}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 py-2.5 pr-10 pl-3.5 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute top-1/2 right-3 -translate-y-1/2 text-zinc-400 hover:text-zinc-200"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>

          {needsSetup && (
            <label className="block space-y-1">
              <span className="text-xs font-medium text-zinc-400">Confirm Password</span>
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 py-2.5 text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none"
              />
            </label>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-45"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Lock className="h-4 w-4" />
            )}
            {needsSetup ? "Create Admin Account" : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}
