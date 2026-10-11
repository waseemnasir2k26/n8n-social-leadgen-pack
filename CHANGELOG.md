# Changelog

All notable changes to this project are documented in this file.

## [2026.10] - 2026-10-12

- n8n-social-leadgen-pack is a public, MIT-licensed set of sixteen n8n workflows (capture, enrich and score, engage, report) with a safety-rails workflow, shared JS logic, a PostgreSQL schema, docs and a node --test suite.
- Reviewed October 2026: tree re-checked; README external links (skynetjoe.com, Fiverr agency, Calendly) returned HTTP 200. No workflow, logic, SQL or test changes.
- Known gaps from the README's Limitations: not run against live client accounts; workflows 02, 03 and 10 need approved messaging permissions; scoring weights are untuned defaults; PostgreSQL only; not multi-tenant; no CI workflow so npm test runs by hand.
- Release housekeeping only: package version 1.1.0 to 1.2.0; the closing hire paragraph was replaced with the standard Work with SkynetLabs section (Fiverr, Upwork, Calendly).

## [2026.09] - 2026-09-16

- Maintenance review of n8n-social-leadgen-pack — sixteen n8n workflows that turn social and web activity into deduped, scored leads in a client's existing CRM, arranged in four tiers (capture, enrich and score, engage, report) with a sixteenth safety-rails workflow that every sending workflow calls first.
- Contents: `workflows/01…16-*.json`, shared JavaScript logic in `logic/` (CRM mapping, dedupe, business hours, opt-out, scoring), `sql/schema.sql` (PostgreSQL, uses `jsonb` and partial indexes), docs for setup, CRM mapping and compliance, and a test suite wired to `npm test` (node --test over `tests/*.test.js` plus a Python workflow-JSON validator). MIT licensed.
- Status: v1, committed September 2026 in a single commit. Safety rails cover kill switch, suppression list, consent, rate limiting and spend.
- Reviewed September 2026: docs refreshed, CHANGELOG started, package version bumped, versioned as v2026.09. No workflow JSON, logic, SQL or tests changed.
- Known gaps (from the README's own Limitations section): nothing in this release has been run against live client accounts; workflows 02, 03 and 10 need an app with approved messaging permissions or they are scaffolding only; workflow 04 reads a LinkedIn export on a schedule because there is no supported inbound-message API; the scoring weights are untuned defaults; PostgreSQL only; not multi-tenant. Repo-level: no CI workflow, so `npm test` runs only by hand, and no CHANGELOG before this release.
