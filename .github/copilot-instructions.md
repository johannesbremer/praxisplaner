This is a `TanStack Start` + `Convex` project.

## Required Before Each Commit

- Run `pnpm gen && pnpm lint && pnpm tsc && pnpm format && pnpm test && pnpm build`
- This will make sure, that the code is properly formatted, type-checked, linted, and tested before committing. It will also fix some basic issues automatically.

## Repository Structure

- `.github/instructions/convex.instructions.md`: Instructions for Convex
- `components/ui`: Shadcn UI components
- `convex`: Convex schema and functions
- `src`: Main application code (`components/`,`routes/`, `tests/`, `types/`, etc)
