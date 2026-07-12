# Roadmap — Local Time Machine (working name)

**Product:** enter any place on Earth → ground-level scene of that exact spot
in different geological epochs. Emotional copy on top, "How accurate is this?"
transparency box on every result (model name, ±100 km, sources) — both, always.

**Locked decisions:** open reconstruction models only (MULLER2022 default,
MERDITH2021 fallback) via GPlates Web Service; **no Scotese PALEOMAP /
PaleoDEM anywhere**. Precompute everything — zero runtime academic-API calls.
~30 curated archetype scenes served statically. Next.js + Vercel + Supabase.
English base with next-intl from day one (Hebrew later as a translation file).

---

## Phase 0 — Validation ✅ in progress

Goal: prove the concept resonates before building the engine.

- [x] Repo init: Next.js (App Router, TS, Tailwind), next-intl, this roadmap.
- [x] **Task 0.2:** run 10 iconic places × 7 epochs (20/66/90/150/250/400/540 Ma)
      through GPlates Web Service → `data/validation/results.json` +
      human-readable `data/validation/RESULTS.md`. Cache-first, polite rate
      limiting, sanity flags for manual cross-check.
      (RESULTS.md reviewed + cross-checked → `data/validation/REVIEW.md`.)
- [x] Validation site: the 10 places, static pages, share buttons, waitlist
      signup. (Design starts only after RESULTS.md review.)

**→ Decision gate:** traction/feedback review before Phase 1.

## Phase 1 — Engine architecture

- Classification function: `(land/ocean, paleo-latitude, epoch) → archetype`.
- Archetype taxonomy: ~30 environment archetypes in one data file
  (`data/archetypes.json`) so iteration is cheap.
- DB schema (Supabase): `grid_cells`, `epochs`, `archetypes`, `scene_assets`.

## Phase 2 — Infrastructure + full precompute

- Global grid × all epochs through GPlates Web Service at build time.
- Cached responses, retries with backoff, polite sequential rate limiting.
- Result: a complete static dataset; the running product never touches GWS.

## Phase 3 — Core product

- Place input with static city-list autocomplete (no geocoding API at runtime).
- Result page: archetype scene + emotional caption + mini-map of the
  paleo-position + interactive epoch navigation (scrubbing between epochs).
- Dynamic OG images for sharing; per-city SEO pages.
- "How accurate is this?" box on every result.

## Phase 4 — Testing

- Edge cases: poles, mid-ocean points, plate boundaries, young crust
  (e.g., Reykjavik before ~20 Ma → "this land didn't exist yet" moment).
- Automated check: zero runtime external calls.
- Mobile polish.

## Phase 5 — Deploy + launch

- Vercel production deploy, analytics, launch checklist.

## Phase 6 — Only if traction

- Future-climate axis (forward in time, not just back).
- Vertical/underground axis (what's beneath you).
- Land-cover ("תכסית") layer per epoch.
- Custom posters (print-on-demand).
- Embeddable widget.

---

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| **Licensing** — accidentally shipping restricted data (Scotese PALEOMAP/PaleoDEM) | Legal exposure, forced takedown | Hard rule: MULLER2022/MERDITH2021 only; license note recorded next to every data artifact; review at each phase gate |
| **GWS instability** — academic service, no SLA | Precompute pipeline stalls | Build-time only + cache every response to `data/cache/`; retries with backoff; pipeline is resumable; zero runtime dependency |
| **Visual credibility** — scenes read as fake/AI-slop, or as overclaiming precision | Loss of trust, ridicule | Curated archetypes (not per-place generation); explicit ±100 km accuracy box; conservative captions; cross-check against ancient-earth |
| **Demand** — nobody cares | Wasted build-out | Phase 0 validation site + decision gate before any engine work |
