# Web App Agent Instructions

## Docs sync

The documentation page at `src/app/docs/page.tsx` is the public-facing version of the CLI documentation in `packages/cli/README.md`. When either file changes, the other must be updated to match.

- CLI README is the source of truth for commands, schemas, flags, and behavior.
- The docs page reformats that content for the web (cards, tables, code blocks with copy buttons, sidebar nav).
- Any new CLI feature, flag, or schema change in `packages/cli/README.md` must be reflected in `src/app/docs/page.tsx`.
- Any copy or structure improvement made to the docs page should be back-ported to the CLI README when it affects accuracy.

Always keep both in sync.
