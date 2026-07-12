# Security

## Threat model

The entire point of this app is that you paste or drop files you would never upload anywhere — logs, LLM transcripts, fine-tune data, anything with sensitive content. That means:

- **The file is untrusted input.** Every byte of it — keys, values, filenames, nested content — is attacker-controlled from the app's point of view, whether or not the actual user is malicious. A malicious `.jsonl` (or a legitimate one containing adversarial content, e.g. a prompt-injection payload inside a transcript) must not be able to execute script, exfiltrate data, or affect anything outside the current tab.
- **Nothing should leave the browser.** There is no server component. No file content, no analytics, no telemetry crosses the network boundary. This is a design invariant, not just a privacy nicety, and it's enforced by the CSP below — not merely claimed in the README.

## What's in place

### No network egress for file content

There is no upload endpoint, no fetch of file content anywhere, and no analytics library wired to file data. The only network request the app makes on its own is fetching the bundled `public/demo.jsonl` sample file.

### Content-Security-Policy

`public/_headers` (served by Cloudflare Pages / any host that honors the `_headers` convention) ships:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'
```

No external origin appears in any directive. `connect-src 'self'` means the app cannot make an outbound request to anywhere but its own origin, even if a bug tried to. `worker-src 'self'` and `script-src 'self'` (no `unsafe-eval`) still permit the app's own module Worker and dynamic `import()` of the lazy syntax-highlighter, since both are same-origin.

A `<meta http-equiv="Content-Security-Policy">` tag in `index.html` mirrors the same directives (minus `frame-ancestors`, which browsers ignore in `<meta>` form) as a fallback for hosts that don't honor `_headers` — so the guarantee holds even if you fork this and deploy it somewhere else without copying that file. Verify it yourself: open devtools → Network/Console on any deployment and confirm no request leaves `self`.

### The sanitization boundary

There is exactly one place in the codebase where untrusted string content becomes `innerHTML`: `src/ui/detailTranscript.ts`, rendering a message's markdown text. The path is:

```
raw file content → marked.parse() → DOMPurify.sanitize() → element.innerHTML
```

Every other rendering path (`src/ui/detailJson.ts`, row previews in `src/main.ts`, the filename in the top bar, the raw-text fallback for unparseable lines) uses `textContent` exclusively — a JSON value can never become markup, by construction, not by convention.

Syntax highlighting (`@speed-highlight/core`) runs *after* this boundary: it operates on the already-sanitized DOM element in place, and never receives or re-emits a raw untrusted string. This is deliberately verified, not just assumed — see the fenced-code-block XSS fixture in `tests/fixtures/xss.jsonl` and its corresponding Playwright test in `e2e/smoke.spec.ts`.

### Tests

- `tests/fixtures/xss.jsonl` contains payloads (`<script>`, `onerror=`, `javascript:` URLs, both bare and inside a markdown code fence) that exercise the sanitization path.
- `src/ui/detailTranscript.test.ts` and `e2e/smoke.spec.ts` assert these payloads never execute (a global `window.__pwned` marker that a successful injection would set stays `undefined`) and that no `<script>` element or live `onerror`/`javascript:` attribute survives into the DOM.
- Both unit and end-to-end tests run in CI on every PR (`.github/workflows/ci.yml`).

## Reporting a vulnerability

If you find a way to break out of the sanitization boundary, exfiltrate data, or otherwise violate the "nothing leaves the browser" guarantee, please **do not open a public issue**. Instead, use [GitHub's private vulnerability reporting](https://github.com/viswesh/jsonl-viewer/security/advisories/new) for this repository, or email the maintainer directly (see the GitHub profile linked from commits).

Please include:
- The `.jsonl` content (or a minimal reproduction) that triggers the issue
- What you observed vs. what should have happened
- Browser/version if it appears environment-specific

You'll get an acknowledgment as soon as possible and credit in the fix, unless you'd prefer otherwise.
