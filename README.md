# n8n-social-leadgen-pack

Sixteen n8n workflows that turn social and web activity into qualified, deduped,
scored leads in whichever CRM your client already pays for - with the opt-out,
rate-limit and spend controls an agency needs before it points any of this at a
client's account.

```
                        SOCIAL / WEB SURFACE
   web form   IG DM   FB Lead Ads   LinkedIn inbox   post comments
       |        |          |             |                |
       v        v          v             v                v
  +---------------------------------------------------------------+
  |  TIER 1  CAPTURE          01  02  03  04                       |
  |  normalise -> validate -> dedupe key -> neutral lead object    |
  +---------------------------------------------------------------+
                              |
                              v
  +---------------------------------------------------------------+
  |  TIER 2  ENRICH & SCORE   05  06  07  08                       |
  |  domain enrichment -> rubric score -> merge dupes -> intent    |
  +---------------------------------------------------------------+
                              |
                              v
  +---------------------------------------------------------------+
  |  TIER 3  ENGAGE           09  10  11  12                       |
  |  speed-to-lead -> asset delivery -> follow-up -> review ask    |
  +---------------------------------------------------------------+
                              |
                              v
  +---------------------------------------------------------------+
  |  TIER 4  REPORT           13  14  15                           |
  |  daily digest -> attribution -> content-to-pipeline            |
  +---------------------------------------------------------------+

  ===============================================================
  ||  16  SAFETY RAILS                                         ||
  ||  kill switch . suppression . consent . rate limit . spend ||
  ||  every sending workflow above calls this FIRST            ||
  ===============================================================
                              |
                     CRM  (adapter pattern)
              generic REST . HubSpot . GoHighLevel . Pipedrive
```

![workflows](https://img.shields.io/badge/workflows-16-blue)
![n8n](https://img.shields.io/badge/n8n-1.x-orange)
![tests](https://img.shields.io/badge/tests-66%20unit%20%2B%203994%20structural-green)
![license](https://img.shields.io/badge/license-MIT-lightgrey)

---

## Quick start

Get workflow 01 running in five steps.

1. **Create the database.** `psql "$DATABASE_URL" -f sql/schema.sql`
2. **Import `workflows/16-safety-rails.json`** into n8n, open it, and copy its
   workflow id out of the URL.
3. **Import `workflows/01-form-to-crm-enriched.json`**, open the **Safety Rails**
   node, and paste that id over `REPLACE_WITH_16_SAFETY_RAILS_WORKFLOW_ID`.
4. **Create the credentials** it asks for (Postgres, CRM header auth, Slack) and
   set `CRM_BASE_URL` and `CRM_ADAPTER` as environment variables. Set
   `ENRICHMENT_PROVIDER=none` for now so nothing costs money.
5. **Activate it** and POST a test lead at the production webhook URL:

   ```bash
   curl -X POST "$N8N_WEBHOOK_URL/leadgen/form" \
     -H 'content-type: application/json' \
     -d '{"email":"jane@acme.example","name":"Jane Doe","message":"what does a quote look like","consent":true}'
   ```

   You should see a scored row in `leads`, a record in your CRM, and a Slack
   message. Full detail in [docs/SETUP.md](docs/SETUP.md).

---

## The 16 workflows

### Tier 1 - Capture

| #   | Workflow                  | What it does                                                                        | What it needs                                  |
| --- | ------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------- |
| 01  | `form-to-crm-enriched`    | Web form -> dedupe -> enrich -> score -> CRM upsert -> Slack alert                  | Postgres, CRM, enrichment provider, Slack      |
| 02  | `instagram-dm-qualifier`  | IG DM webhook -> intent classify -> one qualifying question -> tag -> human handoff | Meta app with messaging permission, CRM, Slack |
| 03  | `facebook-lead-ads-sync`  | Lead Ads webhook -> validate -> fetch -> dedupe -> CRM + instant reply              | Meta app, CRM, messaging provider              |
| 04  | `linkedin-inbound-triage` | Inbound export -> classify lead / recruiter / spam / peer -> route each             | LinkedIn export URL, CRM                       |

### Tier 2 - Enrich and score

| #   | Workflow                | What it does                                                                   | What it needs                |
| --- | ----------------------- | ------------------------------------------------------------------------------ | ---------------------------- |
| 05  | `lead-scoring-engine`   | Firmographic + behavioural rubric, writes score, band and reasons back         | Postgres, CRM, Slack         |
| 06  | `domain-enrichment`     | Company size, industry, tech, socials from a domain, cached, provider-agnostic | Any enrichment API (or none) |
| 07  | `dedupe-and-merge`      | Fuzzy match on email / phone / domain, merges without losing history           | Postgres, Slack              |
| 08  | `intent-signal-watcher` | Watches a company watchlist for hiring, funding, tech and leadership signals   | Signals API, CRM, Slack      |

### Tier 3 - Engage

| #   | Workflow                  | What it does                                                                          | What it needs                        |
| --- | ------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------ |
| 09  | `speed-to-lead-responder` | First response on the channel of origin, inside business hours, queued outside them   | SMTP, SMS and DM providers           |
| 10  | `comment-to-dm-bridge`    | Keyword comment -> DM with the asset -> consent logged -> CRM                         | Platform app with comment + DM scope |
| 11  | `followup-sequence`       | Multi-touch, stops on any reply, respects opt-out and quiet hours, caps its own steps | Messaging provider, Postgres         |
| 12  | `review-request`          | Post-delivery review ask, timed, one per customer, enforced in the schema             | Messaging provider, Postgres         |

### Tier 4 - Report and protect

| #   | Workflow                  | What it does                                                                      | What it needs         |
| --- | ------------------------- | --------------------------------------------------------------------------------- | --------------------- |
| 13  | `daily-pipeline-digest`   | New leads, stalled deals and response-time SLA breaches, every morning            | Postgres, Slack, SMTP |
| 14  | `source-attribution`      | UTM and referrer stitched into first-touch and last-touch on every lead           | Postgres, CRM         |
| 15  | `content-to-lead-tracker` | Which post, video or repo actually produced pipeline                              | Postgres, Slack       |
| 16  | `safety-rails`            | Kill switch, suppression, consent, rate limit, spend cap - called by all the rest | Postgres              |

---

## Start here

If you only import three, import these three, in this order:

1. **16 - safety-rails.** Nothing else should run before this exists. It is also
   the fastest thing to demo to a nervous client: one row in a table stops every
   automated message you run for them.
2. **01 - form-to-crm-enriched.** The shortest path to something visibly working.
   It exercises the rails, the dedupe keys, the scoring rubric and the CRM adapter
   in one run, so if it works, most of the pack works.
3. **09 - speed-to-lead-responder.** The one that changes an outcome rather than a
   dashboard. Responding in minutes instead of hours is the highest-leverage
   change most service businesses can make, and it needs no new tooling.

Add **13** next if you are running this for a client. It is the workflow that
makes the work visible every morning, which is what gets a retainer renewed.

---

## The safety rails

Workflow 16 is the reason this pack is not just a folder of demos. Every workflow
that can reach a prospect calls it first, and does nothing until it returns
`allowed: true`.

It checks five things, in this fixed order, and **denies by default** - a missing
field, a failed lookup or an unknown channel all return `allowed: false`:

1. **Kill switch** - one row in `kill_switch` with `scope='global'`. Set it to
   true and every outbound action in the pack stops. Per-channel and per-workflow
   scopes work the same way.
2. **Suppression list** - permanent, and it outranks a fresh opt-in. Re-importing
   a list cannot resurrect a suppressed contact.
3. **Consent** - denies unless `consent_ledger` holds a recognised lawful basis
   with a timestamp, and treats any inbound opt-out keyword in the current message
   as an immediate deny. False-positive guards mean "I'll stop by tomorrow" is not
   read as an opt-out.
4. **Rate limit** - per-channel hourly cap and a global daily cap. Denied, not
   queued: a rate limit that quietly queues is a rate limit that eventually
   floods.
5. **Spend cap** - a daily USD ceiling across every paid API call the pack makes,
   including the estimated cost of the action being requested.

Every decision, allow and deny, lands in `rails_decisions` with a reason. When a
client asks why a message did or did not go out, that is a ten-second SQL query.

Six workflows do not call the rails, and each says so in its own sticky note and
in the workflow's `meta.safety_rails` field: **05, 07, 13, 14, 15** never contact
anyone (they compute, merge, or report), **06** never contacts anyone either but
does spend money, so it writes every paid lookup to the spend ledger the rails
read. **16** is the rails.

The precedence order is deliberate and not configurable - see
[docs/COMPLIANCE.md](docs/COMPLIANCE.md).

---

## What this costs to run

The pack itself is free. What you pay depends entirely on which vendors you plug
in and how much volume you push through, so here are the cost _drivers_ and how
many times each fires - fill in your own unit prices rather than trusting a number
from a README.

| Driver            | Fires              | Multiplier                                       | Controlled by                                                   |
| ----------------- | ------------------ | ------------------------------------------------ | --------------------------------------------------------------- |
| n8n execution     | Every workflow run | ~15-30 nodes per lead across the pack            | Self-host: server cost only. Cloud: your plan's execution quota |
| Enrichment lookup | 01, 06             | Once per **unique** domain per 30 days (cached)  | `ENRICHMENT_PROVIDER=none` disables entirely                    |
| Intent signals    | 08                 | Up to 50 companies per run, 4 runs a day         | Watchlist size, schedule                                        |
| Email send        | 09, 11, 12, 13     | 1 per touch, up to `FOLLOWUP_MAX_STEPS` per lead | Your SMTP provider                                              |
| SMS send          | 09, 11             | 1 per touch, priced per segment                  | Usually the most expensive line                                 |
| Platform DM       | 02, 03, 10         | 1 per qualifying event                           | Meta/TikTok APIs are free; app review is the cost               |
| Postgres          | All                | A few KB per lead                                | Any managed Postgres, smallest tier is plenty to start          |

Two things actually control the bill: `RAILS_DAILY_SPEND_CAP_USD` (a hard ceiling
the rails enforce before every paid action) and the enrichment cache (30 days by
default, and most agencies re-enrich the same domains constantly). Set the cap to
a number you would not mind losing before your first live run.

Costs you should expect that are not API line items: an approved Meta app for the
social capture workflows, and a few hours per client tuning the scoring rubric so
it reflects what that client actually closes.

---

## Compliance

Automated DMs and cold outreach carry platform and legal risk. This pack is for
people who already have a lawful basis to contact the people in their database -
it gives you the controls to stay inside that basis, it cannot create one for you.

Read [docs/COMPLIANCE.md](docs/COMPLIANCE.md) before you activate anything that
sends. It covers what the pack enforces technically, the fixed precedence order,
and pointers on GDPR, CAN-SPAM, CASL, TCPA and platform terms. It is not legal
advice.

---

## Limitations

Stated plainly, because you are going to find these out anyway:

- **Nothing here has been run against live client accounts in this release.** It
  is v1. The logic is unit tested and every workflow is structurally validated,
  but "the JSON is valid and the tests pass" is not the same as "it survived a
  Tuesday in production". Run each workflow manually with test data first.
- **Platform APIs change.** Meta, LinkedIn and TikTok reshape their messaging
  endpoints and permissions regularly. The capture workflows are written so the
  parsing lives in one Code node per workflow, which makes the fix small - but you
  will have to make it.
- **Some social capture needs approved app review.** Workflows 02, 03 and 10
  require an app with the relevant messaging permissions. Without it they are
  scaffolding, not a working pipeline.
- **LinkedIn has no general inbound-message API.** Workflow 04 reads an export you
  produce, on a schedule. There is no supported real-time path, and automating a
  personal account instead is how accounts get restricted.
- **Enrichment quality is your vendor's problem.** The pack normalises whatever
  the provider returns; it cannot make thin data thick.
- **The scoring rubric is a starting point, not a model.** The weights in
  `logic/scoring.js` are reasonable defaults. They are not tuned to your business
  and should be retuned once you have a hundred closed deals to look at.
- **PostgreSQL only.** The SQL uses `jsonb` and partial indexes. Porting to MySQL
  is possible but is not a find-and-replace.
- **Not multi-tenant.** One deployment serves one CRM and one database. Running
  several clients means several deployments, or a fair amount of work.

---

## Contributing

Issues and PRs are welcome, especially new CRM and enrichment adapters.

Before opening a PR:

```bash
python tests/validate_workflows.py     # structural validation of all 16 workflows
node --test "tests/*.test.js"          # unit tests for the shared logic
```

Both must pass. The validator also enforces the rules that keep this repo safe to
publish: credentials must stay `REPLACE_WITH_*` placeholders, no literal external
hostnames outside `.example`, no secret-shaped strings, ASCII-only Code nodes, and
no orphan nodes. It additionally checks that the shared logic pasted into Code
nodes is still byte-identical to `logic/*.js`, so a change to a rubric or a
keyword list cannot silently drift from what the workflows actually run.

If you change logic in `logic/`, update the matching Code node and add a test that
would have failed before your change.

---

Built by SkynetLabs (Waseem Nasir). We install, tune and monitor these for
agencies and service businesses - https://skynetjoe.com - hire on Fiverr
https://fiverr.com/agencies/skynetjoellc - book a call
https://calendly.com/skynetlabs/schedule-a-free-consultation

## License

MIT - see [LICENSE](LICENSE).
