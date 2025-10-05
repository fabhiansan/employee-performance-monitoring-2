# Repository Guidelines

## Guidelines
- **NEVER USE MOCKUP DATA OR HARDCODED VALUES** -> Immidiately implement the backend
- **NEVER MAKES A SHORT TERM SOLUTION** -> It will cause the code to be unmaintainable in the long run
- **Less Code = Better Code**
- **THE CODE ARE PEER REVIEWED BY ANOTHER AI Agents Model** -> your reputation is at stake if you do not follow this guideline.

## Project Structure & Module Organization
- `src/` contains the React UI; keep shared logic in `lib/`, UI primitives in `components/`, and domain types in `types/`.
- `src-tauri/` holds the Rust backend with Tauri commands in `commands/`, CSV parsing helpers in `csv_parser/`, and database access in `db/`; run migrations stored in `migrations/`.
- `docs/` stores planning notes and sample CSV fixtures for reference during reviews.
- Keep static assets in `public/` and exclude generated bundles under `src-tauri/target` or `dist/`.

## Build, Test, and Development Commands
- `pnpm install` bootstraps Node dependencies.
- `pnpm tauri dev` compiles Rust, starts Vite, and launches the desktop shell.
- `pnpm dev` runs only the Vite frontend for quick UI iteration.
- `pnpm build` executes `tsc` then emits a production bundle in `dist/`.
- `pnpm lint` enforces the ESLint rules; treat warnings as errors.
- `pnpm tauri build` produces signed desktop bundles in `src-tauri/target/**`.
- Run `cargo test` in `src-tauri/` for Rust unit tests as they are added.

## Coding Style & Naming Conventions
- Use TypeScript with two-space indentation and single quotes for module imports; JSX attributes follow double quotes through JSX.
- Prefer functional React components, PascalCase filenames for components, and snake_case for Rust modules.
- Import types with `import type` and avoid `any`; ESLint will flag violations.
- Run `cargo fmt` and `pnpm lint` before submitting to ensure Rust and TypeScript code stay consistent.

## Testing Guidelines
- No frontend test harness is configured yet; document manual verification steps in PRs until tooling lands.
- For Rust, co-locate `#[cfg(test)]` modules beside the logic they cover and exercise SQLx queries against the temporary pool.
- Keep migrations deterministic; add assertions for new SQL routines and rerun `pnpm tauri dev` to validate startup.

## Commit & Pull Request Guidelines
- Follow Conventional Commits (e.g., `feat: add employee preview filters`) so change logs stay machine-parsable.
- Limit PRs to a single feature or bug fix, describe the UI impact, and reference relevant items in `docs/00-Product-Plan.md`.
- Include screenshots or CLI logs whenever behavior changes import flows or database state.
- Confirm `pnpm lint`, `pnpm build`, and any Rust tests pass before requesting review.

## Data & Environment Notes
- SQLite databases live under the OS app data directory (see README troubleshooting); purge them before altering schemas.
