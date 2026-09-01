/**
 * CRM adapter.
 *
 * Every workflow that writes to a CRM builds a neutral lead object first, then
 * runs it through one mapping function. Swapping CRM means editing this file and
 * the URL/credential on the HTTP node - not rewriting sixteen workflows.
 *
 * Source of truth for the "CRM Adapter Map" Code nodes. See docs/CRM-MAPPING.md.
 */

// --- parity block: crm adapters ---
const CRM_ADAPTERS = ['generic', 'hubspot', 'gohighlevel', 'pipedrive'];
// --- end parity block ---

function nonEmpty(obj) {
  const out = {};
  Object.keys(obj).forEach(function (k) {
    const v = obj[k];
    if (v !== null && v !== undefined && v !== '') out[k] = v;
  });
  return out;
}

function splitName(name) {
  const n = (name || '').trim();
  if (!n) return { first: '', last: '' };
  const parts = n.split(/\s+/);
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

/**
 * lead: neutral shape produced by the capture workflows.
 *   { email, phone, name, company, domain, source, campaign, score, band,
 *     score_reasons[], consent_basis, tags[], notes }
 */
function toCrmPayload(lead, adapter) {
  const l = lead || {};
  const name = splitName(l.name);
  const tags = Array.isArray(l.tags) ? l.tags.slice() : [];
  if (l.band) tags.push('score:' + l.band);
  if (l.source) tags.push('source:' + l.source);

  switch (adapter) {
    case 'hubspot':
      return {
        properties: nonEmpty({
          email: l.email,
          phone: l.phone,
          firstname: name.first,
          lastname: name.last,
          company: l.company,
          website: l.domain ? 'https://' + l.domain : '',
          hs_lead_status: l.band === 'hot' ? 'OPEN' : 'NEW',
          lifecyclestage: 'lead',
          hs_analytics_source_data_1: l.source,
          lead_score_custom: l.score,
          lead_score_reasons: (l.score_reasons || []).join('; ')
        })
      };

    case 'gohighlevel':
      return nonEmpty({
        email: l.email,
        phone: l.phone,
        firstName: name.first,
        lastName: name.last,
        companyName: l.company,
        website: l.domain,
        source: l.source,
        tags: tags,
        customFields: [
          { key: 'lead_score', field_value: String(l.score === undefined ? '' : l.score) },
          { key: 'lead_band', field_value: l.band || '' },
          { key: 'consent_basis', field_value: l.consent_basis || '' }
        ]
      });

    case 'pipedrive':
      return nonEmpty({
        name: l.name,
        email: l.email ? [{ value: l.email, primary: true }] : undefined,
        phone: l.phone ? [{ value: l.phone, primary: true }] : undefined,
        org_name: l.company,
        label: l.band,
        visible_to: '3'
      });

    case 'generic':
    default:
      return nonEmpty({
        email: l.email,
        phone: l.phone,
        name: l.name,
        company: l.company,
        domain: l.domain,
        source: l.source,
        campaign: l.campaign,
        score: l.score,
        band: l.band,
        score_reasons: l.score_reasons,
        consent_basis: l.consent_basis,
        tags: tags,
        notes: l.notes
      });
  }
}

/** Dedupe/upsert key each CRM expects on the write call. */
function upsertKey(lead, adapter) {
  const l = lead || {};
  if (adapter === 'hubspot') return { idProperty: 'email', id: l.email || '' };
  if (adapter === 'gohighlevel') return { locationId: 'REPLACE_WITH_YOUR_CRM_LOCATION_ID', email: l.email || '' };
  if (adapter === 'pipedrive') return { search_term: l.email || l.phone || l.name || '' };
  return { match_on: l.email ? 'email' : (l.phone ? 'phone' : 'name'), value: l.email || l.phone || l.name || '' };
}

module.exports = {
  CRM_ADAPTERS: CRM_ADAPTERS,
  splitName: splitName,
  nonEmpty: nonEmpty,
  toCrmPayload: toCrmPayload,
  upsertKey: upsertKey
};
