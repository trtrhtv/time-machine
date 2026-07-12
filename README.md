# Local Time Machine (working name)

Enter any place on Earth and see a ground-level scene of what that exact spot
looked like in different geological epochs — *"Your home was an ocean floor
90 million years ago."*

Emotional surface, scientific transparency underneath: every result carries
both the evocative scene **and** an "How accurate is this?" box (reconstruction
model, ±100 km uncertainty, sources).

## Core principles (locked)

- **Precompute everything.** Zero runtime calls to academic APIs. The
  [GPlates Web Service](https://gws.gplates.org) is used at build time only.
- **Open models only.** MULLER2022 (default) or MERDITH2021 via GPlates Web
  Service. No Scotese PALEOMAP / PaleoDEM rasters (restrictive license).
- **~30 curated environment-archetype scenes**, served statically. No runtime
  image generation.
- **English base, i18n-ready.** next-intl from day one; Hebrew arrives later
  as a translation file only.

## Stack

Next.js (App Router, TypeScript, Tailwind) · Vercel · Supabase.

## Status

**Phase 0 — validation.** See [ROADMAP.md](./ROADMAP.md) for the full plan and
`data/validation/RESULTS.md` for the 10-place × 7-epoch validation dataset.

## Development

```bash
npm install
npm run dev          # local dev server
npm run validate     # build-time GPlates validation pipeline (see scripts/)
```

The validation pipeline caches every GPlates Web Service response under
`data/cache/`, so reruns cost zero external calls.

```bash
npm run build        # production build (all place pages prerendered as static)
npm run start        # serve the production build locally
```

## Deploy (Vercel)

The validation site is a standard Next.js App Router app — import the GitHub
repo at [vercel.com/new](https://vercel.com/new) and it auto-detects everything.

- **Framework preset:** Next.js (auto). Build `next build`, install `npm install`.
- **Build settings / env vars:** none required. The GPlates Web Service is used
  at build time by `npm run validate` only; the committed `data/validation/` and
  `data/cache/` outputs are what the site serves, so the running app makes zero
  external calls and needs no secrets.
- **Node:** 20+ (matches `@types/node`).

### Waitlist persistence (read before launch)

The Phase 0 waitlist (`src/app/actions.ts`) writes to a local JSONL file in
dev. On Vercel the filesystem is read-only, so it falls back to a structured
server-log line (`[waitlist] {...}` in the Vercel function logs) — signups are
recorded but not queryable. **Before a real launch, wire Supabase** (Phase 5):
add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` env vars and replace the sink
in `joinWaitlist`. The form and its state contract stay the same.
