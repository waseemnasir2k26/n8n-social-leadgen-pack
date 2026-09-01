# Compliance

**This is not legal advice.** It is a description of what the pack does and does
not do, so you can have a useful conversation with someone qualified.

## Read this first

Automated DMs, automated follow-up and cold outreach carry real platform risk and
real legal risk. Platforms restrict and ban accounts for unsolicited messaging,
and several jurisdictions attach financial penalties to unsolicited commercial
contact. **This pack is built for people who already have a lawful basis to
contact the people in their database.** It gives you the controls to stay inside
that basis. It cannot create one, and it will not stop you doing something you
should not do - it will only make it obvious in the audit trail afterwards.

If you bought a list, this pack is not the tool that makes emailing it acceptable.

## What the pack enforces technically

| Control                     | Where                          | What it actually does                                                                |
| --------------------------- | ------------------------------ | ------------------------------------------------------------------------------------ |
| Kill switch                 | `16` + `kill_switch` table     | One row set to true stops every outbound action in the pack                          |
| Suppression list            | `16` + `suppression_list`      | Permanent. Outranks a fresh opt-in message                                           |
| Inbound opt-out detection   | `16`, `11` (`logic/optout.js`) | Keyword detection with false-positive guards ("I'll stop by" is not an opt-out)      |
| Lawful basis check          | `16`                           | Denies when there is no `consent_ledger` row with a recognised basis and a timestamp |
| Consent evidence            | `10` + `consent_ledger`        | Stores the exact comment text, post id and keyword that triggered a DM               |
| Rate limits                 | `16`                           | Per-channel hourly cap and global daily cap, denied not queued                       |
| Spend cap                   | `16` + `spend_ledger`          | Daily USD cap across every paid API call                                             |
| Quiet hours                 | `11` (`logic/hours.js`)        | Timezone-aware, wraps midnight, defers rather than sends                             |
| Business hours              | `09`                           | Out-of-hours first responses are queued, not fired at 03:00                          |
| Sequence cap                | `11`                           | Hard maximum step count. A sequence that cannot end is a complaint generator         |
| Stop on reply               | `11`                           | Any reply cancels every remaining step, not just the next one                        |
| One review ask per customer | `12` + unique constraint       | Enforced by the database, not by a Code node                                         |
| Decision audit trail        | `16` + `rails_decisions`       | Every allow and deny logged with a reason                                            |

## Precedence, and why it is not configurable

`logic/optout.js` implements one fixed order:

1. kill switch
2. suppression list
3. inbound opt-out in this message
4. missing or invalid lawful basis
5. allow

The first rule that fires wins, and a later "allow" signal never overturns an
earlier deny. This is deliberate: every real-world failure in outbound automation
is some variant of a positive signal outranking a negative one.

## Pointers, not a compliance programme

- **GDPR / UK GDPR** - you need a lawful basis before you contact someone, and you
  need to be able to evidence it. `consent_ledger` is designed for exactly that:
  basis, timestamp, evidence payload, and a `withdrawn_at` that records withdrawal
  without deleting the history. Data subject access and erasure requests are your
  process to build; the schema keeps everything about one person reachable by
  identifier so it is possible.
- **CAN-SPAM (US, email)** - commercial email needs a working opt-out, a physical
  postal address, and honest headers and subject lines. The pack handles the
  opt-out mechanics; the address and the copy are in your templates, which the
  pack does not write for you.
- **CASL (Canada)** - stricter than CAN-SPAM: you generally need express or
  implied consent _before_ the first message, and implied consent expires.
  `consent_ledger.recorded_at` is what you would use to age it out.
- **TCPA (US, SMS and calls)** - SMS marketing has its own consent standard and
  its own quiet-hours expectations. The quiet-hours control exists partly for
  this; the consent standard is on you.
- **Platform terms** - Meta, LinkedIn and TikTok each restrict automated
  messaging independently of any law. Workflows 02, 03 and 10 need an approved app
  with the relevant permissions. Scraping or automating a personal account instead
  is how accounts get restricted.

## Things this pack deliberately does not do

- It does not scrape social platforms for contact details.
- It does not send unsolicited DMs. `10-comment-to-dm-bridge` only messages
  someone who commented a keyword, and stores that comment as the consent record.
- It does not auto-merge two records on name similarity alone.
- It does not queue a rate-limited send for later. A denied action is denied.
- It does not ship any outreach copy. What you say is a legal surface, and it is
  yours.

## If a client asks "why did that message go out?"

```sql
SELECT decided_at, workflow, channel, purpose, allowed, code, reason
FROM rails_decisions
WHERE identifier = 'jane@acme.example'
ORDER BY decided_at DESC;

SELECT recorded_at, basis, source, evidence
FROM consent_ledger
WHERE identifier = 'jane@acme.example'
ORDER BY recorded_at DESC;
```

Being able to answer that question in ten seconds is most of what separates an
agency that keeps its clients from one that does not.
