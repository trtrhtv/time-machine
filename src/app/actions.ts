"use server";

import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export type WaitlistState = { status: "idle" | "success" | "invalid" | "error" };

// Simple, forgiving email shape check — the real gate is the double opt-in
// email we'll send later, not this regex.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Phase 0 waitlist capture.
 *
 * Sink order:
 *  1. Local newline-delimited file — works in dev and any writable host.
 *  2. If the filesystem is read-only (e.g. Vercel serverless), fall back to a
 *     structured server log line so a signup is still recorded, not lost, and
 *     the user still sees success.
 *
 * Phase 5 replaces both with Supabase (see ROADMAP.md). The form and its state
 * contract do not change when that happens.
 */
export async function joinWaitlist(
  _prev: WaitlistState,
  formData: FormData,
): Promise<WaitlistState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) return { status: "invalid" };

  const entry = { email, at: new Date().toISOString() };
  try {
    const dir = join(process.cwd(), "data");
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, "waitlist.local.jsonl"), JSON.stringify(entry) + "\n", "utf8");
  } catch {
    // Read-only FS (serverless) — record to logs so the signal survives.
    console.log("[waitlist]", JSON.stringify(entry));
  }
  return { status: "success" };
}
