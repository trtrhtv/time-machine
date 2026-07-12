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
 * Sink is a local newline-delimited file so the validation site works with no
 * external dependencies. Phase 5 swaps this for Supabase (see ROADMAP.md); the
 * form and its state contract do not change when that happens.
 */
export async function joinWaitlist(
  _prev: WaitlistState,
  formData: FormData,
): Promise<WaitlistState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) return { status: "invalid" };

  try {
    const dir = join(process.cwd(), "data");
    await mkdir(dir, { recursive: true });
    const row = JSON.stringify({ email, at: new Date().toISOString() });
    await appendFile(join(dir, "waitlist.local.jsonl"), row + "\n", "utf8");
    return { status: "success" };
  } catch {
    return { status: "error" };
  }
}
