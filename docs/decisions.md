# Decisions

## 2026-08-01 — Runtime dependencies

- `react`, `react-dom` — UI.
- `zustand` — query state; chosen over Context to keep re-renders scoped to the panels that
  change.

## 2026-08-01 — Reference genomes come from LAPIS, not NCBI

LAPIS reports mutation coordinates against its own reference. Sourcing the reference
anywhere else risks a silent coordinate offset in every published number.

## 2026-08-02 — ESLint instead of oxlint for `npm run lint`

The `npm create vite@latest -- --template react-ts` scaffold used during Task 0.1 ships
`oxlint` by default instead of an `eslint.config.js`. Task 0.1's interface contract requires
`npm run lint` to be one of the four standing verification commands, and the plan's tooling
choice is ESLint (flat config) + `eslint-config-prettier`, so `oxlint` was removed and
`eslint`, `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`,
`@eslint/js`, and `globals` were added as dev dependencies instead.

## 2026-08-02 — Deployed to Vercel

Production URL: https://assay-drift.vercel.app (project `assay-drift`, team
`hmmartins-gmailcoms-projects`). Deployed manually by the human via the Vercel dashboard
after the Vercel MCP integration returned a 403 (no project-creation permission on the
connected team) when an agent attempted it directly.
