# Justifications

Lightweight log of "why" for choices too small for an ADR. Newest first. Format: `YYYY-MM-DD — choice — reason`.

- 2026-11-05 — Knowledge base under `docs/` rather than a separate top-level dir — keeps it near the code, discoverable from CLAUDE.md.
- 2026-11-05 — npm over pnpm/yarn — already installed, single package, no workspace needs.
- 2026-11-05 — Biome over ESLint+Prettier — one tool, fast, minimal config.
- 2026-11-05 — Native `fetch` over axios — Node >=22, no extra dependency.
- 2026-11-05 — vitest over jest — native ESM/TS, fast.
