# Shelfie scan update — November 14, 2026

Final agreed behavior: Open Beauty Facts barcode lookup, or exactly ONE photo
of the whole ingredient list, read ONCE. No second reading and no matching of
separate photos. The screen and report explain automated reading can make mistakes.

## What changed
- Free, keyless Open Beauty Facts EAN/UPC lookup with check-digit validation.
- Name, brand, ingredient-list confirmation before generating a barcode report.
- Missing products/ingredients and provider failures offer the photo fallback.
- Removed the extra AI photo-quality request and 98% rejection threshold.
- Retakes/gallery upload retained; errors moved near the top.
- Failed reads/lookups preserve the free-report entitlement.
- Source attribution and lookup retrieval time are retained in barcode reports.
- Upgraded Next.js and @next/env from 16.4.0 to 16.4.6 to address reported security advisories.

## Verified
- 51 automated tests passed using isolated PostgreSQL databases.
- TypeScript and the production build passed.
- Production-dependency audit reports zero vulnerabilities.
- One live lookup of the provider's documented barcode 3560070791460 returned
  product information and ingredients. This does not establish general US coverage.

## Still needed before considering this live
- Browser checks could not run: this execution environment blocks Chromium's
  Unix-domain sockets. Test camera permissions/scanning, fallback, retake/upload,
  report generation and error placement on the actual Samsung Fold 6.
- A live vision reading was not exercised; automated provider fixtures were used.
- Connect the actual Shelfie Vercel project. It was not present in the connected
  account's project listing, and the previous hostname could not be resolved there.
- Run `npm ci`, configure existing server-only DATABASE_URL, email configuration
  and LABEL_READER_API_KEY, then run `npm run db:migrate` before deploying.
  Migration 004 adds barcode metadata and short-lived lookup records, preserving
  existing reports. Barcode lookup needs no key.
- Check product coverage with actual target cosmetics. Ingredients/explanations
  remain limited by the existing catalog, with unknown names shown explicitly.
- Complete the API provider's use-registration/reuse requirements before launch.

## Source review
Based on PSchaf7231/Shelfie's deploy/shelfie-preview branch at b87a4ff.
The repository's main branch contains only a README.
These changes have NOT been deployed or merged. Paul approved publishing the
reviewed changes to the existing public GitHub repository on November 14, 2026.
A GitHub review branch and pull request are being prepared. Vercel automatic
builds depend on the actual project’s Git integration; deployment is unconfirmed.
