# Assay Drift Watch

A research and educational tool for surveying primer/probe binding-site drift against
circulating pathogen sequences. Not a diagnostic device. Not for clinical decision-making.

## Development

```bash
npm install
npm run dev
```

## Verification

Every task in this project is checked against the same four commands:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Decisions on runtime dependencies and other cross-cutting choices are recorded in
[`docs/decisions.md`](./docs/decisions.md).
