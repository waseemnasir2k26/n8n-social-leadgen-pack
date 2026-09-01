/**
 * Identity matching for leads.
 *
 * Source of truth for the matching logic pasted into the Code nodes of
 * workflows/07-dedupe-and-merge.json ("Build Match Keys", "Find Duplicate Pairs")
 * and the "Dedupe Key" node in workflows/01-form-to-crm-enriched.json.
 *
 * Design rule: an exact match on a strong identifier (normalised email, phone,
 * or a non-free company domain plus a similar name) is a merge. Everything else
 * is a "review" - we never auto-merge on name similarity alone, because merging
 * two real people is unrecoverable and a missed merge is not.
 */

const { FREE_EMAIL_DOMAINS, emailDomain } = require('./scoring.js');

// --- parity block: match thresholds ---
const MATCH_THRESHOLDS = { merge: 0.9, review: 0.6 };
// --- end parity block ---

function normalizeEmail(email) {
  if (typeof email !== 'string') return '';
  let e = email.trim().toLowerCase();
  if (e.indexOf('@') === -1) return '';
  let local = e.slice(0, e.lastIndexOf('@'));
  const domain = e.slice(e.lastIndexOf('@') + 1);
  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);
  // Dots are insignificant on Google-hosted mail only. Do not strip elsewhere.
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.split('.').join('');
  }
  if (!local || !domain) return '';
  return local + '@' + (domain === 'googlemail.com' ? 'gmail.com' : domain);
}

/** Last 10 digits, which is what actually identifies a subscriber line. */
function normalizePhone(phone) {
  if (phone === null || phone === undefined) return '';
  const digits = String(phone).replace(/[^0-9]/g, '');
  if (digits.length < 7) return '';
  return digits.slice(-10);
}

function normalizeDomain(value) {
  if (typeof value !== 'string') return '';
  let d = value.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').replace(/^www\./, '');
  d = d.split('/')[0].split('?')[0].split(':')[0];
  if (d.indexOf('.') === -1) return '';
  return d;
}

function companyDomain(lead) {
  const l = lead || {};
  const explicit = normalizeDomain(l.domain || l.website || '');
  if (explicit) return explicit;
  const d = emailDomain(l.email || '');
  if (d && FREE_EMAIL_DOMAINS.indexOf(d) === -1) return d;
  return '';
}

function normalizeName(name) {
  if (typeof name !== 'string') return '';
  return name.trim().toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = [];
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

function nameSimilarity(a, b) {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const max = Math.max(x.length, y.length);
  return 1 - levenshtein(x, y) / max;
}

function matchKeys(lead) {
  const l = lead || {};
  return {
    email_key: normalizeEmail(l.email || ''),
    phone_key: normalizePhone(l.phone || ''),
    domain_key: companyDomain(l),
    name_key: normalizeName(l.name || l.full_name || '')
  };
}

/**
 * Returns { score, decision, evidence[] }.
 * decision is one of 'merge' | 'review' | 'distinct'.
 */
function matchScore(a, b) {
  const ka = matchKeys(a);
  const kb = matchKeys(b);
  const evidence = [];
  let score = 0;

  if (ka.email_key && ka.email_key === kb.email_key) {
    score = Math.max(score, 1);
    evidence.push('email_exact');
  }
  if (ka.phone_key && ka.phone_key === kb.phone_key) {
    score = Math.max(score, 0.95);
    evidence.push('phone_exact');
  }

  const nameSim = nameSimilarity(ka.name_key, kb.name_key);
  if (ka.domain_key && ka.domain_key === kb.domain_key) {
    evidence.push('domain_exact');
    if (nameSim >= 0.85) {
      score = Math.max(score, 0.9);
      evidence.push('name_similar_' + nameSim.toFixed(2));
    } else {
      // Same employer, different person. Colleagues are not duplicates.
      score = Math.max(score, 0.45);
    }
  } else if (nameSim >= 0.92) {
    // Name alone never reaches the merge threshold on purpose.
    score = Math.max(score, 0.6);
    evidence.push('name_only_' + nameSim.toFixed(2));
  }

  let decision = 'distinct';
  if (score >= MATCH_THRESHOLDS.merge) decision = 'merge';
  else if (score >= MATCH_THRESHOLDS.review) decision = 'review';

  return { score: Number(score.toFixed(3)), decision: decision, evidence: evidence };
}

/**
 * Field-level merge. The surviving record keeps the oldest created_at and the
 * richest non-empty value per field; both source ids are retained so nothing
 * about the history is lost.
 */
function mergeLeads(primary, secondary) {
  const out = Object.assign({}, secondary, {});
  Object.keys(primary || {}).forEach(function (k) {
    const v = primary[k];
    if (v !== null && v !== undefined && v !== '') out[k] = v;
  });
  const created = [primary && primary.created_at, secondary && secondary.created_at]
    .filter(Boolean).sort();
  if (created.length) out.created_at = created[0];
  out.merged_from = []
    .concat(primary && primary.merged_from ? primary.merged_from : [])
    .concat(secondary && secondary.merged_from ? secondary.merged_from : [])
    .concat(secondary && secondary.id ? [secondary.id] : [])
    .filter(function (v, i, arr) { return arr.indexOf(v) === i; });
  return out;
}

module.exports = {
  MATCH_THRESHOLDS: MATCH_THRESHOLDS,
  normalizeEmail: normalizeEmail,
  normalizePhone: normalizePhone,
  normalizeDomain: normalizeDomain,
  companyDomain: companyDomain,
  normalizeName: normalizeName,
  nameSimilarity: nameSimilarity,
  matchKeys: matchKeys,
  matchScore: matchScore,
  mergeLeads: mergeLeads
};
