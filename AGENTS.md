# AGENTS.md

This is a `TanStack Start` + `Convex` project.

## Core Rules

- This project is not in production yet. Breaking changes are encouraged.
- Do not add compatibility layers, migration helpers, fallback paths, or legacy-preserving abstractions.
- Design changes as if working from a blank slate.

## Before Implementing

- If requirements are ambiguous, stop and ask a focused question rather than guessing.
- If multiple valid approaches exist, name the tradeoffs briefly and choose the simplest correct one.
- Push back on unnecessary complexity.

## Implementation Standards

- Preserve end-to-end type safety across Convex, server code, and UI.
- Use TypeScript narrowing, inference, and precise types aggressively.
- Do not use `eslint-disable`.
- Do not use `any`, unsafe casts, or non-null assertions.
- Do not paper over issues with minimal local fixes when a broader systemic fix is more correct.
- Broad refactors are allowed when they materially improve correctness, simplicity, or type safety.

## Tests and Validation

Before getting back to me after making changes, run:

```sh
pnpm --silent ci-check
```

Heads up: this will take at least 45s because `eslint` is slow on this large codebase.
Do not claim completion until all commands pass.
If the change affects browser-visible behavior, test it in `$browser-use:browser` before getting back to me.
