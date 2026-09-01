# The CRM adapter pattern

Sixteen workflows, one place that knows what your CRM's fields are called.

## Why not just use the HubSpot node?

Because the pack would then be a HubSpot pack. Agencies run whatever the client
already bought - HubSpot for one, GoHighLevel for the next, Pipedrive, Zoho, a
Airtable base someone calls a CRM. Every workflow here builds the same neutral
lead object and hands it to one mapping node, so swapping CRM is a config change
instead of a rewrite.

## The two pieces

Every CRM write in this pack is exactly two nodes:

```
[ CRM Adapter Map ]  ->  [ CRM Upsert ]
   Code node               HTTP Request node
   logic/crm.js            $env.CRM_BASE_URL + header auth credential
```

**CRM Adapter Map** turns the neutral lead into the body your CRM expects.
**CRM Upsert** posts it. Nothing else in the workflow knows a CRM exists.

## The neutral lead object

Every capture workflow produces this shape. Add fields freely; the mappers ignore
what they do not recognise.

```js
{
  email: 'jane@acme.example',
  phone: '+14155550134',
  name: 'Jane Doe',
  company: 'Acme',
  domain: 'acme.example',
  source: 'instagram_dm',        // which workflow captured it
  campaign: 'spring-guide',
  score: 65,                     // set by 05
  band: 'hot',                   // hot | warm | cold | junk
  score_reasons: ['has_business_email +15', 'requested_call +20'],
  consent_basis: 'consent',      // consent | contract | legitimate_interest
  consent_recorded_at: '2026-09-01T10:04:00Z',
  tags: ['inbound'],
  notes: 'Asked about pricing for 3 locations'
}
```

## Mapping notes: HubSpot

`toCrmPayload(lead, 'hubspot')` nests everything under `properties`, because that
is what the CRM objects API expects.

| Neutral field   | HubSpot property         | Note                                                                              |
| --------------- | ------------------------ | --------------------------------------------------------------------------------- |
| `email`         | `email`                  | Also the upsert key (`idProperty=email`)                                          |
| `name`          | `firstname` + `lastname` | Split on the first space; multi-word surnames stay whole                          |
| `company`       | `company`                | On the contact, not the associated company object                                 |
| `band`          | `hs_lead_status`         | `hot` maps to `OPEN`, everything else to `NEW`                                    |
| `score`         | `lead_score_custom`      | **Create this custom property first** - HubSpot's own `hubspotscore` is read-only |
| `score_reasons` | `lead_score_reasons`     | Joined with `; ` into a single-line text property                                 |

Endpoint: `POST /crm/v3/objects/contacts` (or the batch upsert). Set
`CRM_BASE_URL=https://api.hubapi.example/crm/v3` and use a private app token in
the header auth credential as `Authorization: Bearer <token>`.

Gotcha: HubSpot rejects unknown properties with a 400 that names the property.
Create every custom property before the first run, or the whole batch fails.

## Mapping notes: GoHighLevel

`toCrmPayload(lead, 'gohighlevel')` is flat, and uses tags rather than custom
properties wherever it can - tags are free, custom fields need creating.

| Neutral field                    | GHL field                | Note                                                                                   |
| -------------------------------- | ------------------------ | -------------------------------------------------------------------------------------- |
| `name`                           | `firstName` + `lastName` | Same split                                                                             |
| `company`                        | `companyName`            |                                                                                        |
| `band`, `source`                 | `tags[]`                 | Emitted as `score:hot`, `source:instagram_dm`                                          |
| `score`, `band`, `consent_basis` | `customFields[]`         | Keys `lead_score`, `lead_band`, `consent_basis` - create them in the sub-account first |

Endpoint: `POST /contacts/upsert`. GHL is location-scoped: `upsertKey()` returns a
`locationId` placeholder you must replace with the sub-account id, and the API
version header (`Version: 2021-07-28`) belongs in the header auth credential.

Gotcha: GHL upserts on email **within a location**. The same contact in two
sub-accounts is two contacts, and that is correct - do not try to merge across
clients.

## Mapping notes: Pipedrive

Pipedrive splits people and organisations, so the mapper emits a person payload
with `org_name` and lets Pipedrive create or match the organisation. Custom fields
are addressed by hash key, not name, so `score` is not mapped by default - add it
by putting your field's hash into the `pipedrive` branch of `logic/crm.js`.

## Adding a CRM

1. Add its name to `CRM_ADAPTERS` in `logic/crm.js`
2. Add a `case` to `toCrmPayload` and, if the upsert key differs, to `upsertKey`
3. Add assertions to `tests/crm.test.js` - the existing tests loop over
   `CRM_ADAPTERS`, so a new adapter that returns an empty payload fails immediately
4. Paste the updated function body into the **CRM Adapter Map** Code nodes, or
   re-run `python tests/validate_workflows.py` to catch the drift
5. Set `CRM_ADAPTER` to the new name and point `CRM_BASE_URL` at its API

## Same pattern, enrichment providers

`06-domain-enrichment` uses the identical idea: a **Select Provider** switch, one
HTTP node per provider, and a single **Normalize Provider Response** node that
maps every vendor's shape onto one contract (`company`, `domain`, `company_size`,
`industry`, `country`, `tech[]`, `socials{}`). The scoring rubric only ever sees
the normalised shape, so changing vendor cannot silently change your scores.
Setting `ENRICHMENT_PROVIDER=none` makes the pack run with no enrichment spend at
all.
