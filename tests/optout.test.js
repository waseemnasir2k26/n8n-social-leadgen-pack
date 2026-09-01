const test = require("node:test");
const assert = require("node:assert");
const { isOptOutMessage, optOutDecision } = require("../logic/optout.js");

const VALID_CONSENT = { basis: "consent", recorded_at: "2026-01-01T00:00:00Z" };

test("bare keywords are opt-outs regardless of case or punctuation", () => {
  ["STOP", "stop", "Stop.", "UNSUBSCRIBE", "opt out", "opt-out", "DNC"].forEach(
    (msg) => {
      assert.equal(isOptOutMessage(msg), true, msg + " should be an opt-out");
    },
  );
});

test("short sentences containing a keyword are opt-outs", () => {
  assert.equal(isOptOutMessage("please remove me from this list"), true);
  assert.equal(isOptOutMessage("do not contact me again"), true);
  assert.equal(isOptOutMessage("unsubscribe me"), true);
});

test("FALSE POSITIVE GUARD: ordinary sentences are not opt-outs", () => {
  [
    "I will stop by the office tomorrow",
    "We are looking for a one stop solution",
    "Can we talk at the end of the month?",
    "I want to cancel my other vendor, not you",
    "This is for our front end team",
    "Have a good weekend",
  ].forEach((msg) => {
    assert.equal(
      isOptOutMessage(msg),
      false,
      msg + " must not be read as an opt-out",
    );
  });
});

test("empty and non-string input is not an opt-out", () => {
  assert.equal(isOptOutMessage(""), false);
  assert.equal(isOptOutMessage(null), false);
  assert.equal(isOptOutMessage(undefined), false);
  assert.equal(isOptOutMessage(42), false);
});

test("PRECEDENCE 1: the kill switch beats everything, including valid consent", () => {
  const d = optOutDecision({
    kill_switch: true,
    suppressed: false,
    inbound_message: "yes please call me",
    consent: VALID_CONSENT,
  });
  assert.equal(d.allowed, false);
  assert.equal(d.code, "kill_switch");
});

test("PRECEDENCE 2: suppression beats a fresh opt-in message", () => {
  const d = optOutDecision({
    kill_switch: false,
    suppressed: true,
    inbound_message: "please send me the pricing",
    consent: VALID_CONSENT,
  });
  assert.equal(d.allowed, false);
  assert.equal(d.code, "suppressed");
});

test("PRECEDENCE 3: an inbound opt-out beats a recorded consent basis", () => {
  const d = optOutDecision({
    kill_switch: false,
    suppressed: false,
    inbound_message: "STOP",
    consent: VALID_CONSENT,
  });
  assert.equal(d.allowed, false);
  assert.equal(d.code, "opt_out_request");
});

test("PRECEDENCE 4: no lawful basis blocks an otherwise clean contact", () => {
  const d = optOutDecision({
    kill_switch: false,
    suppressed: false,
    inbound_message: "hello",
    consent: { basis: null, recorded_at: null },
  });
  assert.equal(d.allowed, false);
  assert.equal(d.code, "no_lawful_basis");
});

test("a consent basis without a timestamp is not a consent record", () => {
  const d = optOutDecision({
    consent: { basis: "consent", recorded_at: null },
  });
  assert.equal(d.allowed, false);
  assert.equal(d.code, "no_lawful_basis");
});

test("an unrecognised basis is rejected rather than trusted", () => {
  const d = optOutDecision({
    consent: {
      basis: "because_we_bought_a_list",
      recorded_at: "2026-01-01T00:00:00Z",
    },
  });
  assert.equal(d.allowed, false);
  assert.equal(d.code, "no_lawful_basis");
});

test("the three accepted lawful bases all pass when nothing else blocks", () => {
  ["consent", "contract", "legitimate_interest"].forEach((basis) => {
    const d = optOutDecision({
      inbound_message: "sounds good",
      consent: { basis, recorded_at: "2026-01-01T00:00:00Z" },
    });
    assert.equal(d.allowed, true, basis + " should be accepted");
    assert.equal(d.code, "allow");
  });
});

test("an empty context denies by default", () => {
  const d = optOutDecision({});
  assert.equal(d.allowed, false);
  assert.equal(d.code, "no_lawful_basis");
  assert.equal(optOutDecision(undefined).allowed, false);
});
