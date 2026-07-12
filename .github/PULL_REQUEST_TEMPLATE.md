## What this changes

<!-- One or two sentences: what does this PR do, and why. -->

## Checklist

- [ ] `npm run build && npm run check-size` passes (production build + <50KB gzip budget)
- [ ] `npm test` passes
- [ ] `npm run e2e` passes
- [ ] New logic (`src/core/`, `src/worker/`) has tests written before the implementation
- [ ] No new runtime dependency, or justified below if there is one
- [ ] No new `innerHTML` on file-derived content without a DOMPurify boundary (see [SECURITY.md](../SECURITY.md))

## New dependency? (delete this section if not applicable)

<!-- Name, gzipped size added, and why the three existing runtime deps
(marked, dompurify, @speed-highlight/core) don't already cover this. -->
