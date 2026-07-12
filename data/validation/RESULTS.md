# Validation results — 10 places × 7 epochs

> **STATUS: NOT YET RUN — blocked on network access, not on code.**
>
> This session's sandbox has an allowlist network policy that blocks
> `gws.gplates.org` (proxy answers 403 to CONNECT). The full pipeline is
> built, typechecked, and ready:
>
> ```bash
> npm run validate
> ```
>
> It probes the live service first (model list → MULLER2022, fallback
> MERDITH2021; response shapes verified with real calls) before running the
> 10 × 7 loop, caches every response under `data/cache/`, runs sequentially
> with 500 ms spacing and exponential-backoff retries, and then overwrites
> this file with the real results table.
>
> **To unblock:** allow the domain `gws.gplates.org` in the Claude Code
> environment's network policy (environment settings → network access), or
> run `npm run validate` on any machine with normal internet access and
> commit the generated `data/cache/`, `results.json`, and this file.

## What the table will contain

| Place | Ma | Paleo-position | Env | Band | Archetype | Notes |
|---|---|---|---|---|---|---|
| *(10 places × 7 epochs = 70 rows, produced by `scripts/validate.ts`)* | | | | | | |

Sanity flags are added automatically: >45° jumps between consecutive epochs,
and the Reykjavik young-crust expectation (should be "not yet formed" before
~20 Ma).
