# Shelfie
Skincare app

## Development
Use Node.js 24 or later. Run `npm ci`, configure `DATABASE_URL` in private
environment settings (or ignored `.env.local` for development), run
`npm run db:migrate`, then `npm run dev`.
Checks: `npm test`, `npm run typecheck`, and `npm run build`.
For the mobile photo-flow regression, run `npm run test:photos` with Chromium
installed (`CHROMIUM_PATH` overrides the default `/usr/bin/chromium`). This uses
synthetic images and mocked APIs; it sends no email or vision requests.

Intake at `/intake` collects name, email, and both preferences. Codes expire in
10 minutes, allow five attempts, and are tied to the requesting browser.
Verified sessions last 24 hours. Eligible verified users can continue to `/scan`.

Real delivery requires `EMAIL_PROVIDER_API_KEY` for Resend and `EMAIL_FROM`
with a sender verified in Resend. Missing configuration fails closed.
For local development only, use `SHELFIE_EMAIL_MODE=outbox npm run dev`.
Read the matching private `.data/outbox/*.json` file locally and enter its code.
These ignored files are never served or returned by an API; delete after testing.
Outbox mode is prohibited in production. Never commit credentials.

## PostgreSQL storage and environment settings
Create a persistent PostgreSQL database, for example in Neon or Supabase. In the
provider's connection panel, copy the **pooled PostgreSQL connection string**.
Store the entire value as the server-only environment variable `DATABASE_URL`.
Do not name it `NEXT_PUBLIC_DATABASE_URL`, commit it, or paste it into chat.
For local development, `.env.local` is ignored by Git; hosted settings should
use the provider's secret environment settings. `.env.example` contains names
and blank placeholders only. Keep the same database across app redeploys.

Run `npm run db:migrate` with that environment configured before starting the
app. The migration is transactional and repeatable. It never drops saved data;
the runtime does not create databases, rerun DDL, or fall back to SQLite when
configuration is missing. Hosted connections verify TLS certificates and hostnames
(`sslmode=verify-full`); loopback development/test connections can run without TLS.
Use a provider-supplied CA through the connection settings if your database
requires one. Each Node instance reuses a bounded connection pool, and SQL calls
use parameters and transaction-compatible locks suitable for transaction poolers.

Sessions, verification hashes, normalized photo bytes, analysis drafts, saved
reports, and attempt limits all live in PostgreSQL. The saved report's normalized
email primary key is the durable one-free-report record. Per-email transaction
locks serialize retakes, draft changes and completion across separate server
instances; wrong-code attempts and intake/photo limits are also shared. Reopening
uses the saved report without spending another entitlement. Database failures
fail closed with redacted messages. Email addresses are trimmed and lowercased;
provider-specific aliases are not merged. Provider backups must include the report
records so a database restore also preserves free-report history.

If an older SQLite database contains Shelfie data, stop the old app, retain a
backup of its database, and run `npm run db:import-sqlite -- /path/to/old.sqlite`
against an empty PostgreSQL target before reopening. This command applies the
schema if needed, imports a consistent read-only snapshot, and preserves reports,
used credits, sessions, photo order, drafts and limits. It does not modify the
source or overwrite an occupied target. Conflicts roll back the entire import
rather than choosing a report or resetting credits. SQLite is used only by this
one-time import tool, never by the app runtime.

`npm test` starts a temporary, real PostgreSQL cluster and uses isolated schemas;
all old behavior tests run against PostgreSQL. The test cluster is removed after
the run. To use a separate test database instead, provide
`SHELFIE_TEST_DATABASE_URL` with permission to create/drop isolated test schemas.
The test runner never defaults to the app's `DATABASE_URL`. A non-root user is
needed for the bundled local PostgreSQL binary; root-only CI can supply the
separate test database instead. New tests cover concurrent completion and retakes,
rollback, database uniqueness, shared limits, repeatable schema setup, import
preservation and redacted failures.

Scan, upload, and analysis handlers call `intakeStore().requireEligible(token)`
on the server. Opening the report screen completes a usable saved analysis using
`completeIngredientReport`; it saves the report and consumes eligibility atomically
under a unique email constraint. Intake, verification, failed reads, and retakes
never consume a report. Clients cannot supply report content or completion state.


## Photo capture and quality checks
`/scan` is gated on the server by email verification and free-report eligibility.
The camera button uses the phone's rear-camera file picker when supported;
the upload button supports multiple existing photos. Desktop browsers may use
an ordinary file picker for both. One batch covers one product, up to six photos.
The browser prepares each image as a metadata-free JPEG with a maximum edge of
2400 pixels and a 600,000-byte budget, keeping six photos below the 4,000,000-byte
total upload limit, including multipart metadata. It opens source images up to
20 MiB and asks for a closer shot if the image cannot fit without further loss
of label detail. Server decoding and vision checks remain mandatory.
For curved or long labels, include overlapping sections with the printed
beginning and end visible. Adding an angle keeps earlier photos; Retake replaces
only the chosen photo after its replacement is ready. Canceling keeps the original.
Removal stages changes until the next successful check.

Pending prepared photos are kept in this browser's IndexedDB for up to 24 hours,
scoped to an opaque identifier for the verified browser session. Reload restores
them only after server authorization and only if their base photo revision still
matches. Expired drafts are removed on subsequent draft access; successful checks
clear the pending draft. A different session cannot restore the previous draft.
Storage failure leaves photos usable in memory and asks the user to keep the page
open. Upload failures retain the selection and use plain-language messages even
when the hosting platform returns a non-JSON error page.

Uploads are authorized before reading bytes. Sharp verifies and decodes supported
still images, enforces a 24-megapixel input limit, removes metadata, and rejects
obvious darkness, blur, or inadequate resolution. A mandatory OpenAI vision check
then reviews each photo for readability, glare, cropped text, confidence, product
consistency, and complete coverage across the batch. Partial photos are accepted
only when intact overlapping text establishes complete coverage. Pixel metrics
alone never authorize acceptance. Uncertain or malformed verdicts, service failures,
and absent credentials fail closed. Rejected images are not saved on the server;
the browser retains its pending selection so it can be corrected and retried.

Set `LABEL_READER_API_KEY` securely for OpenAI's API. `LABEL_READER_MODEL` defaults
to `gpt-4.1-mini`, which supports vision and strict JSON schemas. Allow HTTPS to
`api.openai.com`. Submitted photos go to that provider for quality review and
literal ingredient transcription. Product scoring is not built.
The automated tests use provider fixtures, not live model calls.

Accepted normalized photos are stored privately in PostgreSQL, with authenticated
preview endpoints and 24-hour expiry. An email's expired records are purged on its subsequent
photo access, not by a background scheduler. Rejected retakes leave the last
accepted batch intact. Revision checks prevent stale tabs overwriting newer photos;
eligibility is rechecked after async validation before saving. Ten attempts per
email per minute and two concurrent uploads per process bound resource use.
Photo checks and retakes never call the report-completion hook.

## Ingredient analysis
`POST /api/ingredients` accepts only `{ "revision": 1 }`, referring to the current
accepted photo batch. It requires a verified, eligible session. Label text and
preferences cannot be supplied by the client; both modes come from the stored
session. The scan screen's “Show my free report” button reads the ingredients and
then opens `/report`. If reading fails, it stays on the photo screen for a retake.

Two independent OpenAI transcriptions must agree on every ingredient. Both reads
must mark the list complete and certain, with confidence of at least 0.98 for the
whole list and every entry. Server parsing preserves printed order and names,
checks that each parsed entry matches the transcription, and rejects malformed
separators, ambiguous percentages, missing sections, and unreadable text. Model
confidence is a quality signal, not proof of accuracy; disagreement or uncertainty
asks for clearer photos rather than selecting a plausible reading.

The versioned, finite catalog in `src/lib/ingredients/catalog.ts` uses exact names
and explicit aliases only. It is not an exhaustive database or a clinically
reviewed reference. Source links identify the references for ingredient roles and
cautions; the implementation does not fetch those pages at runtime. Unknown names
remain visible with unknown roles and cautions, and the analysis has `needs_review`
status. No fuzzy matching, spelling correction, or inferred ingredient explanation
is used. Expand and review the catalog before a public report launch.

Drying alcohols and fatty alcohols have separate buckets. Fatty alcohols are marked
as moisturizers without a drying flag. Pregnancy/nursing mode flags the catalog's
retinoids, hydroquinone, and high-strength or unknown-strength salicylic acid using
“commonly flagged, check with your doctor.” Salicylic concentration is used only
when printed literally; at or below 2% is not a declaration of suitability.
GLP-1 mode adds general sensitive-skin cautions for scent ingredients, exfoliating
acids, and retinoids without claiming a medication interaction. Both modes use
“commonly flagged, check with your doctor.” Every ingredient receives a
plain-language line; all output is cosmetic information only.

Analysis is saved as an unfinished draft, keyed by photo revision, catalog version,
and server preferences. A repeat request reuses the draft. Successful photo
replacement invalidates it; failed retakes preserve it. Final save rechecks
eligibility and revision after the provider calls. Drafts expire with their photos
and never consume the free report. The automated tests cover parsing, independent
reads, mode rules, authorization, caching, concurrent replacement, and entitlement.

## Report screen and free-report completion
`/report` requires a verified session. Its page GET is read-only: it displays the
email's existing report, opens a ready draft, or returns the user to photo capture.
Opening a ready draft mounts a screen that sends a same-origin `POST /api/report`
with only the saved photo revision. Page prefetches do not consume eligibility.

The completion transaction checks the current photo batch, expiry, server modes,
catalog version, and draft structure before saving. Missing, stale, malformed,
or uncertain analysis cannot complete. Valid transcripts containing unmatched
ingredients can complete, with those names explicitly marked
“couldn't verify — flagged for review” and their roles and cautions left unknown.
The screen lists every ingredient, separates drying and fatty alcohols, marks
fatty alcohols as moisturizers, and shows both mode states and their flags.

The unique email record and transaction make double clicks, retries, and concurrent
verified sessions return the same immutable report. If delivery is interrupted
after a successful save, reopening retrieves it; no additional report is used.
Completed reports persist beyond photo expiry and are accessible only after email
verification. A new session for an email with a completed report can view that
report but cannot start another free scan. Report opening is tested for account
isolation, invalid drafts, stale revisions, language, and restart persistence.
No payment, checkout, subscription trial, or publishing flow is included.


## Cloud runtime and publication
In this Codex cloud environment, start Node with `NODE_USE_ENV_PROXY=1` so API
requests use the supplied HTTPS proxy and its injected secret bindings. For example:
`NODE_USE_ENV_PROXY=1 npm run start`. Never copy proxy placeholders into a hosted
application's secrets; configure actual keys securely in the host's settings.

The app requires a persistent PostgreSQL provider connection before the complete
workflow can run outside the isolated tests. Real email verification also requires
the Resend key and a verified sender. The cloud OpenAI binding alone does not
configure these services or publish a website. This storage step does not publish
to Vercel or change its project settings.
