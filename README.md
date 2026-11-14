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


## Barcode lookup and single-photo capture
`/scan` offers two options: Open Beauty Facts barcode lookup, or one photo of
one product’s complete ingredient list. Barcode lookup uses the free keyless
`https://world.openbeautyfacts.org/api/v3/product/{EAN-or-UPC}.json` endpoint.
It validates check digits and the returned product code. Missing products,
missing or unusable ingredient lists, and provider outages offer the photo
fallback without consuming credit. Camera scanning uses native BarcodeDetector
when available; typed barcode entry remains available in other browsers.

Lookup results show name, brand and the full ingredient text for the user to
confirm against their exact package and variant. Database data can be outdated.
Only a confirmed, server-stored result can create a draft; client-written
ingredient lists are never accepted. The confirmation is scoped to the verified
session, expires after ten minutes, and uses the current product revision to
prevent another tab overwriting a selection. Reports retain product source,
retrieval time, Open Beauty Facts contributor attribution and an ODbL link.
The lookup never uploads user photos or contributes products to a public database.
No bulk product database is created. Before launch, verify real product coverage
and complete the provider’s API-use registration and reuse requirements.

Apply migration `004_barcode_lookup` with `npm run db:migrate` before deploying
this version. It adds barcode-origin metadata and short-lived lookup storage;
existing photos and completed reports are preserved. New photo submissions and
label readings accept exactly one photo. Legacy multi-photo batches remain in
storage, but the scan UI requires saving a single complete-label photo again.

The browser prepares a metadata-free JPEG (maximum edge 2400 pixels, 600,000-byte
budget). Sharp decodes it, strips metadata, bounds resolution and rejects obvious
darkness or blur. Saving does not call the vision provider or promise readability.
A single OpenAI request reads the saved ingredient photo when the user requests
a report. There is no separate AI quality reviewer, second transcription, or 98%
confidence cutoff. Incomplete or explicitly uncertain text still asks for a retake
instead of guessing. The screen and report explain that automated reading can
make mistakes. Uncertain ingredient explanations remain explicitly unknown.

Set `LABEL_READER_API_KEY` securely; `LABEL_READER_MODEL` optionally overrides the
`gpt-4.1` default. No barcode key is needed. Provider tests use fixtures, not live
vision calls. Successful lookup, photo saving and failed readings never consume
credit; only the existing completed-report transaction does.

Prepared photos remain in the browser’s session-scoped IndexedDB draft for up to
24 hours. Retake replaces the single selected photo, cancellation preserves it,
and upload failures leave it available. Errors appear near the top of the screen.

Rejected checks offer an optional **Share photos for review** button. The button
clearly requests permission to share the selected label photos and error with the
support team; normal uploads do not create review copies. Sharing uses no report
credit and makes no email or vision request. Copies are decoded, stripped of
metadata, limited to six images below 600 KB each and 1600 pixels, and stored
privately for review with a receipt. Users can delete their shared copy. Each
verified email can keep three active review submissions. Copies expire after
24 hours and are purged on the next sharing or private review operation; there
is no background cleanup scheduler. There is no public review-list or image API.

Support can list current consented checks with `node --import tsx scripts/review-photos.ts`
using the private database connection. Supplying one receipt ID exports only that
unexpired check's images to a private temporary directory for inspection. This
does not deliver images into a Codex conversation or create automatic monitoring
or replies. Use the cloud database preload described in saved setup instructions
when running the tool from Codex. Apply migration `002_photo_reviews` before
deploying this feature. The Rotate button reuses an existing photo and preserves
the other selected images; rotated photos still pass the ordinary quality gate.

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

One OpenAI transcription must mark the list complete and readable without guessed
ingredient names. Numeric confidence is retained only as bounded provider
metadata, not a calibrated accuracy threshold. Server parsing preserves names,
order and printed percentages and checks the structured entries against the
transcribed text. Unknown names never receive invented explanations.

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
eligibility and revision after the provider call. Drafts expire with their product selection
and never consume the free report. The automated tests cover parsing, a single
reading, barcode confirmation, mode rules, authorization, caching, concurrent replacement, and entitlement.

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
The optional skin profile offers dry/oily/combination choices, sensitive/acne-prone/
redness/eczema/fragrance-allergy concerns, and a 300-character note. Browser
dictation starts only on an explicit microphone tap where supported; typing and
the phone-keyboard microphone remain available. Shelfie saves text, not audio.
Verified users can edit the profile before completion without a new email code.
The server supplies the profile to analysis, invalidates mismatched drafts, and
saves the profile and deterministic guidance in the immutable report. Earlier
completed reports remain readable. Notes are displayed as supplied, not diagnosed
or interpreted as instructions. Unknown ingredient coverage remains explicit.

Help / Message us is available in the shared footer and beside photo failures.
The form names Paul as the owner and sends name, reply email, message and an
optional sanitized screenshot to `paulschafranick@gmail.com` through Resend.
Messages and delivery state are stored in PostgreSQL for follow-up; there is no
public message-list or screenshot endpoint. Contacting the owner needs no login.
The destination is fixed on the server. Request IDs and Resend idempotency keys
prevent duplicate notifications on retries; failed delivery leaves the message
saved with a retry option and the phone number. There are per-email and global
hourly limits. Messages remain until owner cleanup. The private build check uses
Resend's documented test inbox, not the owner's actual Gmail inbox. Automatic
Gmail monitoring and AI replies are not implemented. Apply migration
`003_profiles_and_help` before deploying these additions.

Run `npm run test:profile-help` for mobile signup/profile, dictation/fallback,
help-dialog, screenshot, retry and focus checks. It uses mocked APIs and does not
send email. The ordinary photo regression remains `npm run test:photos`.

In this Codex cloud environment, start Node with `NODE_USE_ENV_PROXY=1` so API
requests use the supplied HTTPS proxy and its injected secret bindings. For example:
`NODE_USE_ENV_PROXY=1 npm run start`. Never copy proxy placeholders into a hosted
application's secrets; configure actual keys securely in the host's settings.

The app requires a persistent PostgreSQL provider connection before the complete
workflow can run outside the isolated tests. Real email verification also requires
the Resend key and a verified sender. The cloud OpenAI binding alone does not
configure these services or publish a website. This storage step does not publish
to Vercel or change its project settings.
