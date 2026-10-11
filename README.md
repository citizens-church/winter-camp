# Citizens Church · Winter Camp 2027

Repo-ready source for a parent-interest landing page. **Not published; submissions are disabled until configured.** The supplied invitation is bundled intact. Date: January 29–31, 2027, Camp Pondo.

## Start here

- No frontend dependencies or bundler required. Node 24+ and Python 3 serve/test it.
- `npm run dev`, then open http://localhost:4173.
- `npm test` runs the offline automated tests (no external requests).
- `npm run build` creates `dist/` with only public frontend files.
- Static paths are relative, so a GitHub Pages project subdirectory works.
- Backend deployment/configuration is separate; see `backend/README.md`.

## Put it in the church repository

1. Copy this source into the intended repository (or a dedicated subdirectory and adjust workflow paths).
2. Review the copy and confirm church-specific age eligibility, pricing, deadlines, transportation, supervision, and contact/privacy information. None of those unconfirmed details are invented here.
3. Decide whether Cloudflare Worker + D1 is the church's approved destination for parent contact data. The included backend is an example implementation, not an already-created service/account.
4. If approved, follow `backend/README.md` to create/configure the private database, spam protection, exact origin allowlist, secrets, and endpoint. No credentials or accounts are included.
5. Set only the public endpoint and Turnstile site key in `config.js`. Never put admin or Turnstile secret keys in that file. With either field empty, the form is visibly closed and cannot claim success.
6. Enable GitHub Pages with source **GitHub Actions**. The included `.github/workflows/pages.yml` deploys only when manually triggered, after tests and build. It does not deploy on import or push.
7. Run a controlled live submission and authorized CSV export. Delete that test record using the church's retention process. Check accessibility, mobile layouts, exact deployed URL, and form errors before sharing.
8. Make a QR code only after the final public URL is verified. No QR or guessed church URL is included.

## What the form does

Collects the adult parent/guardian's name and email, optional phone, one interest choice, and explicit age/contact consent. It does not collect student names, dates of birth, health details, payment, or free-form messages. No records are stored in the static site or repo. Contact details remain in memory in the browser until submission/navigation; no analytics, cookies, or local-storage persistence is added by this site. Once configured, Cloudflare Turnstile loads for spam prevention; review that provider with the church's privacy owner.

The backend stores a submission only after server validation and spam checks. The UI displays success only for an HTTP success with `{ "ok": true }`. Network/server errors retain the user's entered fields. A stable request ID supports retries; editing values after an attempt makes a new ID. An interest submission is explicitly not a reservation or registration. There is no automatic email or SMS sending.

## Editing guide for Claude

- `index.html`: all public copy, sections, fields and FAQs.
- `styles.css`: responsive cream/cobalt/pine/orange visual system from the invite.
- `assets/winter-camp-2027.jpg`: original supplied art. Keep its aspect ratio and accessible equivalent.
- `config.js`: public backend configuration only.
- `form-core.js`: pure validation and network helper.
- `app.js`: form UI, Turnstile integration, status and errors.
- `backend/`: isolated deployable server and database migration.
- `tests/`: automated offline tests and optional browser QA.
- `CONTENT-SOURCES.md`: verified facts versus church details still pending.
- `TEST-REPORT.md`: actual verification and limits.

Do not silently enable submission without a working approved backend, publish contact data, add child-data fields, insert secrets, add unapproved messaging integrations, or replace the Citizens price with Pondo's camp-only published rate. Add church privacy/contact details when confirmed. The wordmark is styled text, not a claimed official logo asset. The illustration comes from the user; verify redistribution rights before public deployment.

## Optional browser QA

`tests/browser-qa.cjs` expects Playwright and a local Chromium installation, plus the server at http://127.0.0.1:4173. Set `CHROMIUM_PATH` when necessary, then run `node tests/browser-qa.cjs`. This is not part of dependency-free `npm test`. It checks 1440, 390 and 320px widths, accordion/anchor behavior, closed form, configured mock validation, failure retention and success reset. All submission requests are intercepted; it never sends parent data to a live endpoint. Screenshots are local ignored QA artifacts, not bundled deliverables.

## Accessibility and privacy review

Semantic landmarks, skip link, heading hierarchy, keyboard focus, native details/summary controls, explicit labels, autocomplete, error associations, live status announcements, reduced-motion support, and disabled unconfigured controls are implemented. Browser and assistive-technology checks still need to run in a usable environment. Before production, confirm the church's contact channel, data retention/deletion policy, vendor disclosures, and staff access process. Use minimal staff access and do not email or publish exported contact lists.
