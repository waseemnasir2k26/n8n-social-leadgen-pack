/**
 * Lead scoring rubric.
 *
 * Source of truth for the scoring logic pasted into the "Score Lead" Code nodes
 * in workflows/01-form-to-crm-enriched.json and workflows/05-lead-scoring-engine.json.
 * Keep SCORING_WEIGHTS and SCORE_BANDS byte-identical in both places -
 * tests/validate_workflows.py asserts that parity.
 */

// --- parity block: scoring weights ---
const SCORING_WEIGHTS = {
  has_business_email: 15,
  company_size_11_50: 10,
  company_size_51_200: 15,
  company_size_200_plus: 20,
  budget_stated: 20,
  timeline_under_30d: 15,
  requested_call: 20,
  replied_within_1h: 10,
  competitor_page_view: 10,
  free_email_domain: -10,
  student_or_jobseeker: -25,
  outside_service_area: -15
};
// --- end parity block ---

// --- parity block: score bands ---
const SCORE_BANDS = [
  { name: 'hot', min: 60 },
  { name: 'warm', min: 35 },
  { name: 'cold', min: 15 },
  { name: 'junk', min: 0 }
];
// --- end parity block ---

const FREE_EMAIL_DOMAINS = [
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com',
  'aol.com', 'icloud.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com'
];

function emailDomain(email) {
  if (typeof email !== 'string') return '';
  const at = email.lastIndexOf('@');
  if (at < 1 || at === email.length - 1) return '';
  return email.slice(at + 1).trim().toLowerCase();
}

function isFreeEmail(email) {
  const d = emailDomain(email);
  return d !== '' && FREE_EMAIL_DOMAINS.indexOf(d) !== -1;
}

function bandFor(score) {
  for (let i = 0; i < SCORE_BANDS.length; i++) {
    if (score >= SCORE_BANDS[i].min) return SCORE_BANDS[i].name;
  }
  return 'junk';
}

/**
 * Score a normalised lead object.
 * Returns { score, band, reasons } where score is clamped to 0..100 and
 * reasons is an ordered list of "<signal> <signed points>" strings.
 */
function scoreLead(lead) {
  const l = lead || {};
  const reasons = [];
  let raw = 0;

  function add(signal) {
    const pts = SCORING_WEIGHTS[signal];
    if (typeof pts !== 'number') return;
    raw += pts;
    reasons.push(signal + ' ' + (pts > 0 ? '+' : '') + pts);
  }

  const email = typeof l.email === 'string' ? l.email.trim().toLowerCase() : '';
  const free = isFreeEmail(email);
  if (email && !free) add('has_business_email');
  if (free) add('free_email_domain');

  const size = Number(l.company_size);
  if (Number.isFinite(size)) {
    if (size >= 200) add('company_size_200_plus');
    else if (size >= 51) add('company_size_51_200');
    else if (size >= 11) add('company_size_11_50');
  }

  if (l.budget_stated === true || Number(l.budget_amount) > 0) add('budget_stated');

  const days = Number(l.timeline_days);
  if (Number.isFinite(days) && days > 0 && days <= 30) add('timeline_under_30d');

  if (l.requested_call === true) add('requested_call');
  if (l.replied_within_minutes !== undefined && Number(l.replied_within_minutes) <= 60) {
    add('replied_within_1h');
  }
  if (l.viewed_competitor_page === true) add('competitor_page_view');
  if (l.is_student === true || l.is_jobseeker === true) add('student_or_jobseeker');
  if (l.in_service_area === false) add('outside_service_area');

  const score = Math.max(0, Math.min(100, raw));
  return { score: score, band: bandFor(score), reasons: reasons, raw_score: raw };
}

module.exports = {
  SCORING_WEIGHTS: SCORING_WEIGHTS,
  SCORE_BANDS: SCORE_BANDS,
  FREE_EMAIL_DOMAINS: FREE_EMAIL_DOMAINS,
  emailDomain: emailDomain,
  isFreeEmail: isFreeEmail,
  bandFor: bandFor,
  scoreLead: scoreLead
};
