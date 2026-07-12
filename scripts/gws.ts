/**
 * Minimal, polite client for the GPlates Web Service (https://gws.gplates.org).
 *
 * Rules of engagement with this academic server:
 *  - cache-first: every response is stored in data/cache/, keyed by the full
 *    request URL, so reruns cost ZERO external calls
 *  - sequential requests only, with a fixed delay between live calls
 *  - retries with exponential backoff on network errors / 5xx
 */
import { createHash } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setGlobalDispatcher, EnvHttpProxyAgent } from "undici";

// Honors HTTPS_PROXY / NO_PROXY when set (e.g. sandboxed CI); no-op otherwise.
setGlobalDispatcher(new EnvHttpProxyAgent());

export const GWS_BASE = "https://gws.gplates.org";
const CACHE_DIR = join(process.cwd(), "data", "cache");
const DELAY_MS = 500;
const RETRIES = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CacheEntry {
  url: string;
  fetchedAt: string;
  status: number;
  body: unknown;
}

function cachePath(url: string): string {
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 16);
  // Keep a readable slug so cache files are debuggable by eye.
  const slug = url
    .replace(GWS_BASE, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .slice(0, 80);
  return join(CACHE_DIR, `${slug}_${hash}.json`);
}

export interface GwsResponse {
  status: number;
  body: unknown;
  fromCache: boolean;
}

let lastLiveCall = 0;

/**
 * GET a GWS URL, cache-first. Non-2xx responses are also cached (a stable
 * "model does not cover this time" error should not be re-asked on rerun);
 * pass `noCacheErrors` to force retrying them live.
 */
export async function gwsGet(
  path: string,
  params: Record<string, string | number>,
  opts: { noCacheErrors?: boolean } = {},
): Promise<GwsResponse> {
  const qs = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  const url = `${GWS_BASE}${path}?${qs}`;
  const file = cachePath(url);

  if (existsSync(file)) {
    const entry: CacheEntry = JSON.parse(readFileSync(file, "utf8"));
    if (entry.status < 400 || !opts.noCacheErrors) {
      return { status: entry.status, body: entry.body, fromCache: true };
    }
  }

  mkdirSync(CACHE_DIR, { recursive: true });

  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) {
      const backoff = 2000 * 2 ** (attempt - 1);
      console.warn(`  retry ${attempt}/${RETRIES} in ${backoff}ms — ${lastErr}`);
      await sleep(backoff);
    }
    // Politeness: fixed spacing between live calls, strictly sequential.
    const wait = lastLiveCall + DELAY_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastLiveCall = Date.now();

    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "local-time-machine-validation (build-time, cached)" },
        signal: AbortSignal.timeout(60_000),
      });
      const text = await res.text();
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      if (res.status >= 500) {
        lastErr = `HTTP ${res.status}`;
        continue; // server hiccup — retry
      }
      const entry: CacheEntry = {
        url,
        fetchedAt: new Date().toISOString(),
        status: res.status,
        body,
      };
      writeFileSync(file, JSON.stringify(entry, null, 2));
      return { status: res.status, body, fromCache: false };
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`GWS request failed after ${RETRIES + 1} attempts: ${url}\n  last error: ${lastErr}`);
}
