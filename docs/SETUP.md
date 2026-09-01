# Setup

You need a running n8n instance (self-hosted or cloud), a PostgreSQL database, and
whatever CRM you already use. Everything else is optional and swappable.

Budget about 40 minutes for workflow 01 end to end if your credentials already
exist, and about half a day to wire all sixteen properly.

---

## 1. Database

```bash
createdb leadgen
psql "$DATABASE_URL" -f sql/schema.sql
```

Every workflow that touches the database uses one Postgres credential named
`Leadgen Postgres` in the exported JSON. Create it once in n8n and n8n will map it
to all sixteen on import.

---

## 2. Environment variables

Set these on the n8n instance (Settings > Variables on cloud, or the process
environment when self-hosting). The workflows read them with `$env.NAME`, so
nothing sensitive is stored inside the workflow JSON.

| Variable                                    | Used by                        | Example                                 | Notes                                             |
| ------------------------------------------- | ------------------------------ | --------------------------------------- | ------------------------------------------------- |
| `CRM_BASE_URL`                              | 01, 02, 03, 04, 05, 08, 10, 14 | `https://api.your-crm.example/v1`       | Base URL of your CRM's REST API                   |
| `CRM_ADAPTER`                               | every CRM mapping node         | `generic`                               | `generic`, `hubspot`, `gohighlevel`, `pipedrive`  |
| `ENRICHMENT_PROVIDER`                       | 06                             | `primary`                               | `primary`, `fallback`, or `none` to disable spend |
| `ENRICHMENT_BASE_URL`                       | 01, 06                         | `https://api.enrichment.example`        | Whatever provider you already pay for             |
| `ENRICHMENT_FALLBACK_URL`                   | 06                             | `https://api.other.example`             | Optional second provider                          |
| `ENRICHMENT_COST_USD`                       | 06                             | `0.02`                                  | Per-lookup cost, fed to the spend ledger          |
| `SIGNALS_BASE_URL`                          | 08                             | `https://api.signals.example`           | Hiring/funding/tech signal source                 |
| `META_GRAPH_BASE_URL`                       | 02, 03                         | `https://graph.facebook.example/v21.0`  | Meta Graph API base                               |
| `MESSAGING_BASE_URL`                        | 03, 09, 10, 11, 12             | `https://api.messaging.example`         | Your sending provider                             |
| `SMS_BASE_URL`                              | 09                             | `https://api.sms.example`               | SMS provider                                      |
| `LINKEDIN_EXPORT_URL`                       | 04                             | `https://files.internal.example/li.csv` | Where your LinkedIn export lands                  |
| `BUSINESS_TIMEZONE`                         | 09, 11                         | `America/New_York`                      | IANA name. Not an offset                          |
| `BUSINESS_START_HOUR` / `BUSINESS_END_HOUR` | 09                             | `9` / `17`                              | Local clock hours                                 |
| `QUIET_START_HOUR` / `QUIET_END_HOUR`       | 11                             | `21` / `8`                              | Wraps midnight                                    |
| `FOLLOWUP_GAP_DAYS` / `FOLLOWUP_MAX_STEPS`  | 11                             | `3` / `4`                               | Hard cap on sequence length                       |
| `COMMENT_KEYWORD`                           | 10                             | `SEND`                                  | The keyword that counts as a request              |
| `ASSET_URL` / `ASSET_DM_TEXT`               | 10                             | `https://your-site.example/guide`       | What the DM delivers                              |
| `REVIEW_URL`                                | 12                             | `https://g.page/r/your-id/review`       | Review destination                                |
| `RAILS_CHANNEL_PER_HOUR`                    | 16                             | `30`                                    | Per-channel hourly send cap                       |
| `RAILS_GLOBAL_PER_DAY`                      | 16                             | `500`                                   | Global daily send cap                             |
| `RAILS_DAILY_SPEND_CAP_USD`                 | 16                             | `25`                                    | Daily spend cap across every paid call            |

---

## 3. Credentials per workflow

Every credential in the exported JSON has a placeholder id of the form
`REPLACE_WITH_YOUR_<SERVICE>_CREDENTIAL_ID`. On import n8n will show them as
missing; create each one once and select it.

| #   | Workflow                | Credentials it needs                                               | Typical cost                      |
| --- | ----------------------- | ------------------------------------------------------------------ | --------------------------------- |
| 01  | form-to-crm-enriched    | Postgres, CRM header auth, Enrichment header auth, Slack           | Enrichment per lookup             |
| 02  | instagram-dm-qualifier  | Postgres, Meta header auth, CRM header auth, Slack                 | Free (Meta API), needs app review |
| 03  | facebook-lead-ads-sync  | Postgres, Meta header auth, CRM header auth, Messaging header auth | Free API, messaging per send      |
| 04  | linkedin-inbound-triage | Postgres, LinkedIn export header auth, CRM header auth             | Free                              |
| 05  | lead-scoring-engine     | Postgres, CRM header auth, Slack                                   | Free                              |
| 06  | domain-enrichment       | Postgres, Enrichment header auth, Enrichment fallback header auth  | Per lookup, cached 30 days        |
| 07  | dedupe-and-merge        | Postgres, Slack                                                    | Free                              |
| 08  | intent-signal-watcher   | Postgres, Signals header auth, CRM header auth, Slack              | Per company scanned               |
| 09  | speed-to-lead-responder | Postgres, SMTP, SMS header auth, Messaging header auth             | Per message                       |
| 10  | comment-to-dm-bridge    | Postgres, Messaging header auth, CRM header auth, Slack            | Free API, needs app review        |
| 11  | followup-sequence       | Postgres, Messaging header auth                                    | Per message                       |
| 12  | review-request          | Postgres, Messaging header auth                                    | Per message                       |
| 13  | daily-pipeline-digest   | Postgres, Slack, SMTP                                              | Free                              |
| 14  | source-attribution      | Postgres, CRM header auth                                          | Free                              |
| 15  | content-to-lead-tracker | Postgres, Slack                                                    | Free                              |
| 16  | safety-rails            | Postgres                                                           | Free                              |

The HTTP nodes all use n8n's generic **Header Auth** credential type. If your
provider wants a query parameter or OAuth2 instead, change the node's
authentication mode - the rest of the workflow does not care.

---

## 4. Import order

Import **16-safety-rails first**. Every other sending workflow calls it by id, and
that id only exists once it has been imported.

1. `16-safety-rails.json` - then copy its workflow id from the URL
2. In every workflow that has a **Safety Rails** node, replace
   `REPLACE_WITH_16_SAFETY_RAILS_WORKFLOW_ID` with that id
3. `05-lead-scoring-engine.json`, `06-domain-enrichment.json`,
   `09-speed-to-lead-responder.json`, `14-source-attribution.json` - the other
   sub-workflows
4. Everything else, in any order

---

## 5. Before you activate anything

- [ ] `sql/schema.sql` has run and `SELECT * FROM kill_switch;` returns the global row
- [ ] Every `REPLACE_WITH_*` string is gone: `grep -r "REPLACE_WITH_" workflows/` returns nothing
- [ ] `python tests/validate_workflows.py` passes on your edited copies
- [ ] You ran workflow 16 manually with a fake request and got `allowed: false` for
      a suppressed contact
- [ ] You ran workflow 01 manually with a test form payload and saw a CRM record
- [ ] `RAILS_DAILY_SPEND_CAP_USD` is set to a number you would not mind losing
- [ ] Someone other than you knows how to set `kill_switch.scope = 'global'` to true

---

## 6. Webhook URLs

Workflows 01, 02, 03 and 10 expose webhooks. n8n gives you two URLs per webhook -
test and production. The production URL only responds while the workflow is
**active**. Point external systems at the production URL, and put a reverse proxy
or n8n's own header auth in front of it: an open webhook that writes to your CRM
will eventually be found and abused.
