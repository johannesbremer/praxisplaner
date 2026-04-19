This is a `TanStack Start` + `Convex` project.

## Before You Start

- Understand that this project is not yet deployed to production and we are free to make breaking changes in favour of simplicity and correctness and don't need to worry about any kind of data migration.

## Before You Get Back To ME

- Run the `Verify CI checks don't fail.` tool and fix all issues that come up. It may take a little while, because eslint is slow on our large codebase.

## Repository Structure

- `components/ui`: Shadcn UI components
- `convex`: Convex schema and functions
- `src`: Main application code (`components/`,`routes/`, `tests/`, `types/`, etc)

## Notes

- Please don't take shortcuts like `eslint-disable`. We have chosen this structure to enable e2e type safety from the DB (Convex) to the UI (TanStack Form). Fully leverage this by using modern TypeScript features and type narrowing etc like a TypeScript Wizard would.
