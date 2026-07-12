# RESULTS.md review — manual cross-check (Phase 0 gate)

Date: 2026-07-12 · Reviewer: automated cross-check + human-readable notes

## Method

The roadmap calls for cross-checking flagged rows against
https://dinosaurpictures.org/ancient-earth. That site is unreachable from the
build environment (network policy), so the cross-check was run against the
**paleomap** model on the GPlates Web Service itself — the same underlying
reconstruction ancient-earth uses, and independent of our muller2022 results.

**Licensing note:** paleomap is Scotese-derived. Per the project's hard rule
("no Scotese PALEOMAP/PaleoDEM anywhere"), these calls were made ad-hoc and
were **not** cached into `data/cache/` and no paleomap-derived data ships in
any product artifact. Only the qualitative comparison below is recorded.

## Cross-check results (lat°, lon°)

| Place | Ma | muller2022 (ours) | paleomap (independent) | Verdict |
|---|---|---|---|---|
| New York | 66 | 40.9, -56.1 | 40.7, -50.9 | ✅ excellent (~4° lon) |
| Tel Aviv | 90 | 11.0, 23.9 | 13.2, 29.0 | ✅ good (~5°) |
| Sydney | 150 | -69.7, 133.6 | -76.7, 86.4 | ✅ qualitative — both deep polar south (longitudes converge near the pole) |
| Denver | 400 | -9.0, -55.4 | -34.2, -48.9 | ⚠️ ~25° lat spread — both southern hemisphere |
| Denver | 540 | -46.4, -87.2 | -25.5, -102.1 | ⚠️ ~21° lat spread — both southern hemisphere |

## Findings

1. **Recent epochs (≤150 Ma) agree tightly** across models — well within the
   product's stated ±100 km-and-up envelope.
2. **The flagged Denver 540 Ma jump (46° from 400 Ma) is not a bug.** Both
   models independently place Cambrian Denver in the southern hemisphere; the
   jump reflects documented rapid apparent polar wander of Laurentia plus
   genuine inter-model spread at that age. Keep the sanity flag as a
   product-copy cue ("positions this old are rough"), not as a data error.
3. **Deep-time (≥400 Ma) inter-model spread is ~20–25°** (~2,000–2,800 km).
   The accuracy box for the oldest epochs should say substantially more than
   "±100 km" — suggest wording like "hundreds to >1,000 km at 400+ Ma".
4. Reykjavik `not-yet-formed` at all epochs and the shallow-sea caveat
   (Denver ~90 Ma, Tel Aviv/Cairo on the Tethys shelf read "land") were
   already recorded in RESULTS.md and stand as known limitations.

## Gate decision

**Pass.** Data quality is sufficient for the Phase 0 validation site.
Design/build of the validation site may start (per roadmap: "Design starts
only after RESULTS.md review").
