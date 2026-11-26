import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCw,
  Smartphone,
  Trash2,
} from "lucide-react";
import type { SubsonicPasswordResponse } from "@musicorbit/shared";
import {
  fetchSubsonicPassword,
  revokeSubsonicPassword,
  rotateSubsonicPassword,
} from "../api/client";

export function SubsonicConnectCard() {
  const [info, setInfo] = useState<SubsonicPasswordResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [copiedField, setCopiedField] = useState<"url" | "user" | "pass" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const serverUrl = typeof window !== "undefined" ? window.location.origin : "";

  useEffect(() => {
    void fetchSubsonicPassword()
      .then(setInfo)
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Could not load OpenSubsonic settings");
      })
      .finally(() => setLoading(false));
  }, []);

  const copyValue = async (field: "url" | "user" | "pass", value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      window.setTimeout(() => setCopiedField((prev) => (prev === field ? null : prev)), 1800);
    } catch {
      // Clipboard API unavailable on non-HTTPS LAN origins
    }
  };

  const handleGenerate = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await rotateSubsonicPassword();
      setInfo(next);
      setShowPass(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate app password");
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await revokeSubsonicPassword();
      setInfo(next);
      setShowPass(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke app password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4 rounded-2xl border border-zinc-800/80 bg-zinc-900/50 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-base font-semibold text-zinc-100">
            <Smartphone className="h-4 w-4 text-amber-400" />
            Mobile &amp; Desktop Apps (OpenSubsonic API)
          </h3>
          <p className="mt-0.5 text-xs text-zinc-400">
            Connect <strong className="text-zinc-200">Symfonium</strong> (Android),{" "}
            <strong className="text-zinc-200">Amperfy / Arpeggi</strong> (iOS), or{" "}
            <strong className="text-zinc-200">Feishin</strong> directly to MusicOrbit for CarPlay,
            Android Auto, offline downloads, and synced lyrics — no Navidrome needed.
          </p>
        </div>

        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
            info?.configured
              ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
              : "bg-zinc-800 text-zinc-400"
          }`}
        >
          {info?.configured ? "Ready for Subsonic apps" : "App password not generated"}
        </span>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
          Loading connection details…
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/60 px-3.5 py-2.5">
              <p className="text-[11px] font-medium text-zinc-500">Server URL</p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <code className="truncate font-mono text-xs text-zinc-200">{serverUrl}</code>
                <button
                  type="button"
                  onClick={() => void copyValue("url", serverUrl)}
                  aria-label="Copy server URL"
                  className="shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
                >
                  {copiedField === "url" ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/60 px-3.5 py-2.5">
              <p className="text-[11px] font-medium text-zinc-500">Username</p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <code className="truncate font-mono text-xs text-zinc-200">
                  {info?.username ?? "local"}
                </code>
                <button
                  type="button"
                  onClick={() => void copyValue("user", info?.username ?? "local")}
                  aria-label="Copy username"
                  className="shrink-0 rounded p-1 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100"
                >
                  {copiedField === "user" ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800/90 bg-zinc-950/60 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-200">
                  <KeyRound className="h-3.5 w-3.5 text-amber-400" />
                  Subsonic App Password
                </p>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  Dedicated token password for Subsonic clients (keeps your main web login password
                  hashed with one-way <code className="text-zinc-400">scrypt</code>).
                </p>
              </div>
            </div>

            {info?.password ? (
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900/90 px-3 py-2">
                  <code className="truncate font-mono text-xs text-amber-200">
                    {showPass ? info.password : "••••••••••••••••••••••••"}
                  </code>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setShowPass((v) => !v)}
                      aria-label={showPass ? "Hide app password" : "Show app password"}
                      className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                    >
                      {showPass ? (
                        <EyeOff className="h-3.5 w-3.5" />
                      ) : (
                        <Eye className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => void copyValue("pass", info.password!)}
                      aria-label="Copy app password"
                      className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                    >
                      {copiedField === "pass" ? (
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleGenerate()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800 disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
                  Rotate
                </button>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleRevoke()}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs font-medium text-zinc-400 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Revoke
                </button>
              </div>
            ) : info?.configured ? (
              <p className="text-xs text-zinc-400">
                Authentication is disabled (<code className="text-zinc-300">AUTH_ENABLED=false</code>
                ) — Subsonic clients can connect directly with any password.
              </p>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleGenerate()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-amber-400 disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <KeyRound className="h-3.5 w-3.5" />
                )}
                Generate Subsonic App Password
              </button>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              <AlertTriangle className="h-4 w-4 shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          <p className="text-[11px] text-zinc-500">
            In Symfonium, Amperfy, or Feishin, pick <strong className="text-zinc-300">Subsonic / OpenSubsonic</strong>,
            paste the Server URL, your username, and the Subsonic App Password above. Each user only
            sees their own private MusicOrbit library and playlists.
          </p>
        </>
      )}
    </section>
  );
}
