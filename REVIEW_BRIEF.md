# Shelfie review brief for Grokbot

Prepared: 2026-10-16. This is a source snapshot for an independent review, not a published site or a production-readiness certification.

## Review request
Please give a candid review of this existing project. Start by describing what it actually does today. Identify confirmed defects, unmet requirements, and material assumptions, ranked by severity, with file paths and line numbers where possible. Suggest focused fixes in the current codebase. Distinguish evidence from speculation. Do not rewrite the project or add features as part of this review.

Assess whether this foundation can be completed in place, and explain any concrete reason a different architecture would be necessary. Prioritize correctness, cosmetic-information wording, user experience, privacy, database integrity, and useful tests. Do not judge an unconfigured service as if credentials were present.

## Product goal
Shelfie is a mobile-first skincare web app. A person photographs product ingredient labels and gets a plain-English explanation. The original whole-shelf concept also includes comparisons between products to identify possible clashes.

## What is implemented
- Next.js 16.4.0, React 19.3, TypeScript, Node.js 24 or later.
- A quiet navy (#0a1128), warm gold and ivory interface, Cormorant Garamond headlines and Jost body text, with bundled fonts and a navy/gold app icon.
- A simple front page and name/email intake before scanning, with visible Pregnancy & nursing and GLP-1 sensitive-skin toggles.
- Six-digit email verification, browser-bound expiring sessions, code-attempt limits, and a Resend delivery adapter. A private development-only outbox is prohibited in production.
- Camera/file-picker and phone upload paths for one product, allowing up to six overlapping label photos.
- Server-side image decoding and metadata stripping, darkness/blur checks, and mandatory OpenAI vision review for readability and completeness. Uncertain reads fail closed and ask for a clearer photo.
- Two independent OpenAI label transcriptions that must agree, a conservative ingredient parser, and exact/explicit-alias matching against a finite versioned local ingredient catalog.
- Plain-English explanations, separate drying-alcohol and fatty-alcohol sections, pregnancy/nursing and sensitive-skin flags, and explicit unknown entries.
- An authenticated report screen. Unknown ingredients say "couldn't verify — flagged for review." Fatty alcohols are identified as moisturizers.
- PostgreSQL storage for sessions, photos, analysis drafts, limits and completed reports. Transaction locks and the normalized email primary key enforce one completed free report per email across instances. Reopening retrieves the saved report.
- Repeatable schema migration and a read-only SQLite-to-PostgreSQL import tool that preserves existing data and refuses to overwrite an occupied target.

## Rules to preserve
1. The first report is free. No credit card before the report, checkout, or trial-to-cancel flow.
2. Name and email come before a scan; email verification is required before photo upload.
3. One completed free report per email, enforced on the server. Failed scans, uncertain transcriptions, draft generation and retakes do not spend it. Completing the report as its screen opens does. Retries return the same saved report.
4. Never invent unreadable label text or missing ingredient information.
5. Keep drying alcohols (such as ethanol, denatured alcohol and isopropyl alcohol) separate from fatty alcohols (such as cetyl, cetearyl and stearyl alcohol).
6. Both mode preferences affect the analysis. Mode flags use "commonly flagged, check with your doctor." Pregnancy and nursing guidance can differ. GLP-1 mode uses general sensitive-skin cautions, not inferred medication interactions.
7. Cosmetic information only — not medical advice. No diagnosis, treatment, cure, guaranteed result, or "safe/unsafe" product verdict.
8. Keep the existing navy/gold/ivory look and fonts. No pink or purple gradients.

## Current boundaries and pending work
- The current scan/report flow covers ONE product. Multi-product shelf management and product-to-product clash checks are not implemented. The original full product vision is therefore not complete.
- Product scoring is not implemented. Payment, checkout and subscription flows are intentionally absent.
- The ingredient catalog is finite, not exhaustive or clinically reviewed. Its reference links were included as sources, but this is not a claim that each current source page or every rule has received independent expert validation. Unknowns must remain unknown. Review the catalog and the concentration-dependent pregnancy rules carefully before public use.
- Model confidence and two agreeing transcriptions are signals, not a guarantee that an image was read correctly. Review how conservative parsing, completeness checks and uncertainty handling work together.
- A persistent hosted PostgreSQL database is not connected in this workspace. DATABASE_URL still needs configuring and the schema migration must run against that database.
- Real email sending is not configured here. EMAIL_PROVIDER_API_KEY and EMAIL_FROM still need setting. The current adapter is for Resend; sending through GoHighLevel would require an integration. An existing receiving inbox can be used as a test recipient.
- An OpenAI vision credential is configured in the working environment; no credential value is included in this packet.
- No Vercel publication has been performed or authorized for this step. Do not assume there is a shareable hosted preview.
- Photo expiry is enforced at access and expired data is cleaned up during the relevant email's photo access, not by a background scheduler. Review retention behavior, including after report completion.
- The source snapshot includes workspace work that is not all committed or pushed to GitHub. A bare repository link may not contain the current implementation.

## Validation recorded during the storage build
- All 37 tests passed: the 28 existing behavior tests plus 9 PostgreSQL/import tests.
- TypeScript checks and the production build passed.
- Real PostgreSQL tests cover separate connection pools, concurrent report completion and retakes, uniqueness, transaction rollback, shared limits, repeated migrations, source-preserving import and redacted failures.
- A production HTTP check confirmed saved reports and the used-credit record persisted after stopping and restarting the app process, and a second verified browser retrieved the same report.
- Earlier live OpenAI checks used synthetic labels. Browser checks covered the mobile interface and separate alcohol/mode sections.
These are recorded results from the build sessions, not a new independent audit performed while packaging this export.

## Running a review locally
Use Node.js 24 or later and a non-root account for the bundled temporary PostgreSQL test server.

    npm ci
    npm test
    npm run build
    npm run typecheck

Tests automatically start real temporary PostgreSQL and use isolated schemas. Root-only environments can supply SHELFIE_TEST_DATABASE_URL pointing to a separate test database with schema creation/deletion permissions. The tests do not default to the app's DATABASE_URL. Provider calls in the automated tests use fixtures rather than live credentials.

To run the full app, configure server-only DATABASE_URL, EMAIL_PROVIDER_API_KEY, EMAIL_FROM and LABEL_READER_API_KEY in private settings, then run npm run db:migrate and npm run dev. See README.md for the development outbox and the optional legacy import. Never supply private keys in the review conversation.

## Suggested review order
1. src/lib/intake.ts, src/lib/postgres.ts and migrations/001_initial.sql: authorization, transaction boundaries, email normalization, concurrent operations and saved-report ownership.
2. src/app/api/*: input handling, authorization before upload/provider calls, asynchronous rechecks and response behavior.
3. src/lib/photo-quality.ts, src/lib/label-reader.ts and src/lib/ingredients/*: photo acceptance, literal transcription, parser coverage, unknowns, alcohol classification and mode language.
4. src/app/report/page.tsx and src/components/report-*.tsx: completion timing, interrupted requests, reopening and report wording.
5. src/components/intake-form.tsx, src/components/photo-capture.tsx and src/app/globals.css: mobile usability, accessibility and failure recovery.
6. tests/* and scripts/*: meaningful coverage, migration/import behavior and remaining gaps.

## Packet contents
The ZIP includes the full application source, configuration, dependency lockfile, migrations, scripts, tests, this review brief and two screenshots made with synthetic test data. The single text file contains the same text source files and this brief, including the dependency lockfile; use it when Grokbot cannot read a ZIP. Its file boundary markers preserve the original paths. Screenshots are in the ZIP's review-screenshots folder.

Excluded: credentials and private environment files, uploaded photos, email outbox messages and codes, database files, Git history/configuration, node_modules, generated builds, temporary review scripts and private cloud settings. .env.example is included with blank values only.
