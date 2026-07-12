# Contributing

Thanks for considering a contribution. This project is small on purpose (see [Architecture](docs/ARCHITECTURE.md)) — the bar for a PR is "does this earn its size," not "is this technically correct."

## Setup

```sh
git clone https://github.com/viswesh/jsonl-viewer.git
cd jsonl-viewer
npm ci
npm run dev
```

Requires Node 22+ (matches `.github/workflows/ci.yml`).

## Before opening a PR

Run the same gates CI runs, in this order:

```sh
npm run build && npm run check-size   # typecheck + production build + <50KB gzip gate
npm test                              # unit tests (Vitest)
npm run e2e                           # browser smoke tests (Playwright) — installs Chromium on first run
```

All four must pass. `check-size` is a hard, non-negotiable 50KB gzipped budget — see [docs/ARCHITECTURE.md#bundle-budget](docs/ARCHITECTURE.md#bundle-budget) before adding a dependency.

## Code style

- **No framework, no new runtime dependencies** without a real justification (see the dependency table in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — there are exactly three, each earning its place). If you think you need a fourth, open an issue to discuss before writing the PR.
- **TDD for logic modules.** Anything in `src/core/` or `src/worker/` should have a failing test written first. UI wiring (`src/main.ts`, `src/ui/dropzone.ts`, `src/ui/topbar.ts`) is covered by Playwright end-to-end tests instead, since it's mostly DOM plumbing.
- **Untrusted content stays untrusted.** If you touch anything that renders file-derived strings, read [SECURITY.md](SECURITY.md) first. JSON values render via `textContent`; the only sanctioned `innerHTML` path is `marked` → `DOMPurify.sanitize` → DOM, in `src/ui/detailTranscript.ts`. New rendering paths for untrusted content must go through DOMPurify or use `textContent` — no exceptions, and a PR that adds a new `innerHTML` assignment on file-derived content will be asked to change approach regardless of how unlikely the specific input seems.
- **Match existing patterns.** Small, single-responsibility files; hand-rolled over a library when the library costs more bytes than it saves; no premature abstraction for one caller.

## Adding a new LLM transcript format

If you want JSONL Viewer to recognize another provider's message shape, see [docs/DETECTION.md](docs/DETECTION.md#adding-a-new-format) — it's a self-contained, well-tested piece of the codebase and a good first contribution.

## Reporting bugs / requesting features

Use the issue templates — they ask for exactly what's needed to act on a report (repro `.jsonl` content or steps, expected vs. actual, environment). A tiny reproduction file is worth far more than a description; if you can attach or paste a minimal `.jsonl` snippet that triggers the issue, do that.

**Security issues are the one exception** — see [SECURITY.md](SECURITY.md) for private reporting instead of a public issue.

## Pull request checklist

The PR template mirrors this, but in short:

- [ ] `npm run build && npm run check-size` passes
- [ ] `npm test` passes
- [ ] `npm run e2e` passes
- [ ] New logic has tests written before the implementation (TDD)
- [ ] No new runtime dependency, or a clear justification if there is one
- [ ] No new `innerHTML` on file-derived content without a DOMPurify boundary

Thanks again — even a good bug report with a repro `.jsonl` is a real contribution.
