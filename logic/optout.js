/**
 * Opt-out, suppression and consent precedence.
 *
 * Source of truth for the Code nodes in workflows/16-safety-rails.json
 * ("Opt Out Check") and workflows/11-followup-sequence.json ("Check Reply Stop").
 *
 * Precedence is deliberate and is not configurable:
 *   1. kill switch      - operator pulled the plug, nothing goes out
 *   2. suppression list - permanent, survives re-import of a list
 *   3. inbound opt-out  - the contact just said stop, in this message
 *   4. missing lawful basis / no consent record
 *   5. allow
 * The first rule that fires wins. A later "allow" signal never overturns an
 * earlier deny.
 */

// --- parity block: opt-out keywords ---
const OPT_OUT_KEYWORDS = [
  'stop', 'stopall', 'unsubscribe', 'opt out', 'optout', 'opt-out',
  'remove me', 'take me off', 'do not contact', 'dnc', 'cancel', 'quit', 'end'
];
// --- end parity block ---

// Phrases that contain a keyword but are not an opt-out.
const FALSE_POSITIVE_PHRASES = [
  'stop by', 'stop in', 'non stop', 'nonstop', 'one stop', 'stop light',
  'cancel my other', 'end of the month', 'end of month', 'weekend',
  'quit my job', 'front end', 'back end'
];

function normalizeMessage(text) {
  if (typeof text !== 'string') return '';
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * True when an inbound message should be treated as an opt-out request.
 * A bare keyword ("STOP") always counts. Inside a longer sentence we require
 * the keyword not to be part of a known false-positive phrase.
 */
function isOptOutMessage(text) {
  const msg = normalizeMessage(text);
  if (!msg) return false;

  for (let i = 0; i < FALSE_POSITIVE_PHRASES.length; i++) {
    if (msg.indexOf(FALSE_POSITIVE_PHRASES[i]) !== -1) {
      const stripped = msg.split(FALSE_POSITIVE_PHRASES[i]).join(' ');
      return isOptOutMessage(stripped);
    }
  }

  for (let i = 0; i < OPT_OUT_KEYWORDS.length; i++) {
    const kw = OPT_OUT_KEYWORDS[i];
    if (msg === kw) return true;
    if (kw.indexOf(' ') !== -1 && msg.indexOf(kw) !== -1) return true;
    const words = msg.split(' ');
    if (words.length <= 4 && words.indexOf(kw) !== -1) return true;
  }
  return false;
}

/**
 * ctx: {
 *   kill_switch: bool,
 *   suppressed: bool,
 *   inbound_message: string,
 *   consent: { basis: 'consent'|'contract'|'legitimate_interest'|null, recorded_at: iso|null }
 * }
 * Returns { allowed, reason, code }.
 */
function optOutDecision(ctx) {
  const c = ctx || {};

  if (c.kill_switch === true) {
    return { allowed: false, code: 'kill_switch', reason: 'Global kill switch is on.' };
  }
  if (c.suppressed === true) {
    return { allowed: false, code: 'suppressed', reason: 'Contact is on the suppression list.' };
  }
  if (isOptOutMessage(c.inbound_message)) {
    return { allowed: false, code: 'opt_out_request', reason: 'Inbound message is an opt-out request.' };
  }
  const consent = c.consent || {};
  const basis = consent.basis;
  const validBasis = basis === 'consent' || basis === 'contract' || basis === 'legitimate_interest';
  if (!validBasis || !consent.recorded_at) {
    return { allowed: false, code: 'no_lawful_basis', reason: 'No recorded lawful basis for contact.' };
  }
  return { allowed: true, code: 'allow', reason: 'No suppression, opt-out or consent block.' };
}

module.exports = {
  OPT_OUT_KEYWORDS: OPT_OUT_KEYWORDS,
  FALSE_POSITIVE_PHRASES: FALSE_POSITIVE_PHRASES,
  normalizeMessage: normalizeMessage,
  isOptOutMessage: isOptOutMessage,
  optOutDecision: optOutDecision
};
