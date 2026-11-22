import type { HealthResponse } from "@musicorbit/shared";

/**
 * Thin typed wrapper around fetch for the MusicOrbit API.
 * Uses relative /api paths so Vite's dev proxy and production single-origin
 * deployments work identically without hardcoded hosts.
 */
export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch("/api/health");
  if (!res.ok) {
    throw new Error(`Health check failed with status ${res.status}`);
  }
  return (await res.json()) as HealthResponse;
}
