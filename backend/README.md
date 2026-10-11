# Optional parent-interest backend

This is an **undeployed source package**, not a connected live service. The static site can be previewed without it. A real form must remain disabled until its endpoint and public Turnstile site key are deliberately configured and verified.

There is no email delivery, webhook, third-party CRM, payment, enrollment, or reservation. A successful response means the adult's contact record was acknowledged by Cloudflare D1. It does not mean a camp place is confirmed or that anyone has contacted the parent.

## Architecture and data

- `worker.mjs`: dependency-free Cloudflare Worker with `POST /interest` and bearer-authenticated `GET /admin/export`.
- `migrations/0001_parent_interest.sql`: private D1 table and index.
- `wrangler.example.toml`: inert example. No account, active route, actual database ID, or credentials are provided.
- `.dev.vars.example`: placeholders only. Placeholder secrets are rejected, and missing storage, rate-limit, or Turnstile configuration fails closed.
- `../tests/backend.test.mjs`: isolated synthetic data, mocked fetch/rate limiter, and a real in-memory SQLite database. No requests leave the machine.

Stored contact data is parent/guardian name, email, optional phone, the two-choice interest value, server receipt/consent timestamp, and consent-copy version. Technical fields are a server-generated record UUID, client submission UUID, and a one-way request fingerprint used for exact retries. No child names, ages, dates of birth, school records, health information, IPs, free-text answers, Turnstile tokens, or browser timestamps are stored in D1. Unknown payload keys are rejected rather than silently collected.

The application does not log personal data or exception details. Cloudflare still processes normal request metadata and Turnstile browser signals; disabling Worker observability does not promise the absence of provider access/security logs. Review account access, region/jurisdiction settings, logging, retention, and Cloudflare's terms/privacy information before a real launch. D1 and the downloaded CSV must remain private to authorized camp administrators. Do not put exported records, secrets, databases, or this backend directory in the static site's public build output.

## Frontend contract

Use HTTPS in production. The frontend sends JSON to the configured API's exact `/interest` route, with `credentials: 'omit'`. The browser's Origin must exactly match `ALLOWED_ORIGIN`, including scheme and nondefault port, without a trailing slash. No wildcard, origin list, cookies, query-string data, or authentication header is accepted for the form.

```json
{
  "parentName": "Synthetic Parent",
  "email": "parent@example.test",
  "phone": "",
  "interest": "interested",
  "consent": true,
  "website": "",
  "startedAt": 1791691190000,
  "turnstileToken": "TOKEN_FROM_THE_WIDGET",
  "submissionId": "8e565105-207f-4b75-a343-417bdc0adfb5"
}
```

That example is synthetic; generate current values in the browser:

- `parentName`: nonempty trimmed adult name, at most 120 UTF-16 code units. No control characters.
- `email`: at most 254 characters before trimming, ordinary ASCII email syntax with valid domain labels and a local part of at most 64 characters. Internationalized email addresses are not supported by this starter validator. This validates syntax, not deliverability or ownership.
- `phone`: optional string, at most 32 characters, allowing digits, `+`, `-`, `.`, spaces and parentheses. This does not verify ownership.
- `interest`: exactly `interested` or `questions`.
- `consent`: boolean `true`, from an unchecked-by-default consent checkbox for camp-related contact.
- `website`: required empty honeypot string. Hide it accessibly without prompting legitimate users.
- `startedAt`: integer epoch milliseconds set when the form opens. Must be 1 second to 48 hours before server time. This is only a weak spam signal; it is not trusted authorization. A badly skewed client clock or very old tab may need correcting/refreshing.
- `turnstileToken`: current token from a widget with action `winter-camp-interest`, at most 2048 characters. Verification must match the exact frontend hostname and action.
- `submissionId`: cryptographically random UUID v4 created with `crypto.randomUUID()` for this submission. Keep it in memory across network retries. Refresh the Turnstile token for every retry; tokens are single-use. If a person deliberately changes submitted details, start a new submission UUID.

The complete request is capped at 8192 bytes while streaming, even if Content-Length is absent or misleading. UTF-8 JSON is required. The server independently validates every field.

Only HTTP 200 with exactly `{ "ok": true }` is success. Every other response is failure, with a generic `{ "ok": false, "error": "…" }`. Do not clear fields or show a sent state until the success response. Do not claim enrollment or confirmation of a place.

Failure categories: `400` invalid data or verification; `403` origin denied; `409` submission UUID reused for different data; `413` too large; `415` wrong encoding/type; `429` rate limit; `503` missing configuration or unavailable verification/storage. After a failure, preserve parent-entered values in memory and provide a clear retry path. Do not put contact details in localStorage, URLs, analytics, or public page state.

### Idempotency and uncertain outcomes

The single SQL statement inserts once per submission UUID. A retry with the same UUID and same normalized parent contact fields/interest returns the same generic success without creating or changing a record. The request fingerprint excludes transient token, startedAt, and server timestamp. Changed data under an existing UUID returns a generic conflict and never exposes stored values.

A lost response or connection can occur after D1 commits. The frontend should retain the UUID and obtain a fresh Turnstile token before retrying. This prevents duplicate rows for that attempt. Reloading the page, using another device, or starting a new UUID can still create a duplicate contact. The backend deliberately does not expose an email-exists lookup.

The stored consent version is `winter-camp-interest-v1`. Before launch, align the visible checkbox/privacy text with that version. Suggested narrow purpose: “I’m a parent or guardian and agree to be contacted about this winter camp using the details above.” Do not silently extend it to general marketing. Version changes must be recorded in code and retained with the corresponding approved consent text.

## Account setup, deliberately left undone

These steps create paid/provider resources and persistent access. The owner or authorized operator must complete the account, billing, access and deployment decisions. No resources or secrets were created and no deployment was performed while preparing this package.

1. Review Cloudflare's current Workers, D1, Turnstile, account and pricing terms. Select an authorized account with restricted administrator access. Obtain launch/privacy approval and decide retention before collecting real records.
2. Use a supported official Wrangler installation (the rate-limiting binding requires Wrangler 4.36.0 or newer). Copy `wrangler.example.toml` to the ignored `wrangler.toml`. Replace the example site origin with the exact final frontend origin.
3. Create a private D1 database, put its actual ID into the copied config, and apply `migrations/0001_parent_interest.sql` using the normal D1 migrations workflow. Keep production and staging databases separate.
4. Configure the `INTEREST_RATE_LIMITER` binding with an unused namespace in this account. The supplied example is 10 attempts per 60 seconds per salted IP/category. That is a starting limit for a small camp form, not a universal recommendation.
5. Create a Turnstile widget restricted to the final frontend hostname. Use its public site key in the frontend only; configure its secret as `TURNSTILE_SECRET` in Worker secrets. Use action `winter-camp-interest`. Never put the secret in config.js or a public build.
6. Configure independent random, high-entropy secrets of at least 32 characters for `RATE_LIMIT_SALT` and `ADMIN_TOKEN` using the authorized secret-management flow. Keep ADMIN_TOKEN out of browser code, chat, URLs, source control, analytics and screenshots. The code rejects the shipped `REPLACE_…` placeholders.
7. Bind a reviewed HTTPS custom domain/route to the Worker. The template disables workers.dev and preview URLs and deliberately contains no active route. Do not enable live collection merely by copying example files.
8. Update the frontend's endpoint and public site key through its own documented configuration. Restrict its Content Security Policy to that endpoint and Cloudflare's supported Turnstile sources. Review the public privacy copy and consent again against actual operations.
9. Test a staging deployment with only invented adult records. Verify both successful storage and a protected CSV export; check wrong origin, missing token, invalid data, duplicate UUID, changed-payload UUID conflict, unavailable storage, and token expiry. Only enable production after staging evidence and owner approval.

For local Worker development, copy `.dev.vars.example` to ignored `.dev.vars`, replace placeholders, and use local D1 migrations. Local request fixtures need the synthetic `CF-Connecting-IP` header because Cloudflare normally supplies it at the edge. Never copy that development assumption into a different public hosting stack. A local end-to-end Turnstile test needs a dedicated permitted development widget whose Siteverify hostname/action matches; the offline unit tests avoid external verification entirely. Never weaken the production verifier or add a bypass switch to make a demo succeed.

## Protected administrator export

The only read endpoint is `GET /admin/export`, using `Authorization: Bearer <ADMIN_TOKEN>` over HTTPS. It accepts no Origin header and has no CORS allowance, browser login, cookies, or public dashboard. Use a trusted administrator-side HTTP client with the token loaded from a secure store, not from a URL or command history. The shared token is a minimal starter control, not user-specific authentication or an audit trail; consider a reviewed identity-aware access layer before wider use.

A successful response is a no-store CSV attachment containing adult contact records, receipt time and consent version. Spreadsheet-formula prefixes are escaped and quoted. Exports above 10,000 records are rejected instead of silently truncated; use a separately authorized private D1 export/retention workflow for larger datasets. Do not forward CSVs or add sharing permissions without the owner's authorization. Once downloaded, protect and remove CSV files according to the same retention policy as the database.

## Security and operational limits

- CORS is a browser safeguard, not identity proof. An off-browser attacker can forge Origin. Server-side Turnstile and rate limiting remain required.
- The Cloudflare rate binding is per-location/eventually consistent, not a precise global abuse counter. Anonymous IP-based limits can affect families sharing school/mobile networks and can be evaded with distributed traffic. Watch aggregate, non-personal failure metrics and tune protection conservatively.
- Honeypot and elapsed time are weak bot signals. Turnstile's availability and correct hostname configuration affect genuine parents too; provide honest failure text.
- No transactional email, automatic camp outreach, backup policy, retention automation, deletion UI, spam review UI, duplicate-contact resolution, or guardian identity verification is included. Assign an owner to review/export records and respond separately.
- No real endpoint, secrets, Cloudflare resources, provider integration, billing, live CAPTCHA challenge, or internet-facing deployment was tested. Passing unit tests is not production certification.
- Define a short, justified retention period before launch, communicate it in the site privacy text, and implement an approved deletion routine in the real account. Consider backup/time-travel retention too. Do not promise automated deletion while it is not implemented.
- Keep a protected recovery plan and restrict account access. Restore/backup behavior and provider outages depend on the eventual account settings, not this source package.

## Offline verification

From the project root, use Node.js 24 or a supported Node version with the built-in `node:sqlite` module:

```sh
node --test tests/backend.test.mjs
node --check backend/worker.mjs
```

Tests exercise the real migration and SQL in memory, exact retry behavior, collision safety, bounded JSON handling, origin/method restrictions, configuration failures, secret placeholders, Turnstile hostname/action, rate binding failures, durable-ack waiting, protected export and CSV formula protection. All fixture contacts are synthetic.

## Implementation references

- [D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/)
- [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Turnstile server-side verification](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Turnstile hostname management](https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/)
- [Workers rate-limit binding and its accuracy limits](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
