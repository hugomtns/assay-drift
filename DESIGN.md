# Assay Drift Watch visual system

## Direction

The interface should feel like a calm scientific instrument: light and softly
tinted, with dark ink, a single restrained cobalt accent, and semantic status
colours. It is not a marketing surface or a compliance document. Avoid
gradients, glass effects, decorative cards, and motion that does not explain a
state change.

## Tokens

The global OKLCH token roles live in `src/index.css`:

| Role | Use |
| --- | --- |
| `--color-canvas` | Page background |
| `--color-surface` | Quiet elevated or selected surface |
| `--color-ink` | Primary text and data |
| `--color-muted-ink` | Secondary labels and supporting text |
| `--color-border` | Separators and control boundaries |
| `--color-accent` | Primary action and text selection |
| `--color-focus` | Keyboard focus outline |
| `--color-success` | Low-concern status |
| `--color-warning` | Caution requiring interpretation |
| `--color-danger` | Unreliable or blocking state |

Use status colour with text and an icon or other non-colour cue. Do not use
pure black or white. Chart marks use the accent for the primary series,
success/warning/danger for semantic findings, and muted ink for axes and
secondary series.

## Type, spacing, and borders

Use the system sans-serif stack with a 1.5 default line height. Use tabular
figures for counts, percentages, coordinates, and other comparable numerical
data. Keep body text at 14 px or larger. Aim for prose columns of roughly 70
characters; forms and data may use the full available width.

Use a 4 px spacing rhythm, normally grouping related controls at 8 or 12 px
and sections at 16, 24, or 32 px. Prefer separators and whitespace to nested
cards. Borders are quiet, one-pixel, and use the border token; use rounded
corners only to clarify an interactive control or bounded status.

## Interaction and responsive rules

All keyboard focus uses the global two-pixel focus token outline with a visible
offset. Selection uses the accent with surface-coloured text. Honour
`prefers-reduced-motion`; only animate state changes when motion communicates
something unavailable without it.

At narrow widths, preserve a single reading column, allow long scientific data
to wrap where meaningful, and make wide charts locally scrollable with a clear
affordance. Do not permit page-level horizontal scrolling. Controls retain
usable touch targets, data retains tabular numerals, and scientific qualifiers
stay adjacent to the affected value.
