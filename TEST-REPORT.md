# Verification report

October 11, 2026 · Node 24.19.0

## Passed

- `npm test`: 92 automated offline tests, all passed, no skipped tests.
- Frontend: unconfigured fail-closed state; HTTPS-only endpoint without URL credentials; parent-only validation; explicit server success requirement; no false success for invalid JSON/server error; network/rate-limit errors; no credential forwarding or redirects; accessible markup/date checks.
- Backend: request limits and schema; exact CORS; missing-config rejection; consent and adult-only payload fields; Turnstile action/hostname validation; rate-limit behavior; durable D1 adapter semantics; real SQLite migration and atomic idempotency SQL; protected export and spreadsheet-formula escaping. External services mocked.
- `npm run build`: static production output produced successfully. Backend and private runtime data are excluded from `dist/`.
- Original JPEG opened and visually inspected at 1536 × 864; invitation dates verified.
- Independent source/security review completed separately; no source blockers found.

## Not verified here

- Browser-rendered visual and interaction QA: attempted using Playwright and installed Chromium, but this execution environment blocked Chromium's required local sockets. A permitted retry encountered the same infrastructure restriction. No screenshot is presented as a verified preview.
- `tests/browser-qa.cjs` is provided for a usable local browser environment. It has not completed here. Run it before public launch and inspect both narrow and wide layouts.
- Screen-reader testing, live GitHub Pages deployment, live Cloudflare Worker/D1/Turnstile integration, and live CSV export were not run. No infrastructure was created, no real form was submitted, and no email/SMS was sent.
- Final church-specific logistics, contact/privacy copy, approved data destination, and the exact public URL need owner confirmation.

## Release gate

Keep the unconfigured form closed until the church approves/configures the backend, confirms public copy and privacy handling, and completes one controlled end-to-end test. Source is ready for repository handoff; this is not a claim that a live signup is operating.
