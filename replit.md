# Phish Intake Analyzer

A mobile-first tool for triaging suspicious SMS messages and raw email headers, extracting defanged indicators, explaining risk signals, and copying an analyst-ready incident report.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/phish-intake-analyzer run dev` — run the web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Optional secret: `VIRUSTOTAL_API_KEY` or `GOOGLE_SAFE_BROWSING_API_KEY` enables URL reputation lookups. Without either, the analyzer clearly reports that it is using local indicators only.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/phish-intake-analyzer/src` — React and Tailwind interface
- `artifacts/api-server/src/lib/phishing-analysis.ts` — parsing, alignment, scoring, reputation lookups, and guarded short-link resolution
- `artifacts/api-server/src/routes/analysis.ts` — analysis and provider-status endpoints
- `lib/api-spec/openapi.yaml` — API contract source of truth

## Architecture decisions

- Analyses are transient; message contents and reports are not persisted.
- SPF, DKIM, and DMARC results are parsed from the supplied email headers; the app does not perform DNS authentication checks.
- Redirect requests are limited to recognized shorteners, use `HEAD`, cap hops, block non-public DNS results, and pin requests to validated addresses.
- Reputation lookups are optional and only apply to extracted URLs. A local heuristic score is never presented as proof that a message is safe.

## Product

Users can analyze pasted SMS or email/`.eml` input, inspect authentication and link findings, review a 0–100 risk breakdown, and copy a Markdown incident ticket.

## User preferences

The analyzer is designed for mobile screens and uses Node.js/Express, React, and Tailwind CSS.

## Gotchas

After editing the API contract, regenerate the client and validation schemas with the codegen command above.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
