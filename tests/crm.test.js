const test = require("node:test");
const assert = require("node:assert");
const {
  toCrmPayload,
  upsertKey,
  splitName,
  CRM_ADAPTERS,
} = require("../logic/crm.js");

const LEAD = {
  email: "jane@acme.example",
  phone: "+1 (415) 555-0134",
  name: "Jane Van Der Berg",
  company: "Acme",
  domain: "acme.example",
  source: "web_form",
  score: 65,
  band: "hot",
  score_reasons: ["has_business_email +15", "requested_call +20"],
  consent_basis: "consent",
};

test("every advertised adapter produces a non-empty payload", () => {
  CRM_ADAPTERS.forEach((a) => {
    const p = toCrmPayload(LEAD, a);
    assert.ok(p && Object.keys(p).length > 0, a + " produced an empty payload");
  });
});

test("an unknown adapter falls back to the generic shape rather than throwing", () => {
  const p = toCrmPayload(LEAD, "some-crm-nobody-has-heard-of");
  assert.equal(p.email, LEAD.email);
  assert.equal(p.score, 65);
});

test("multi-word surnames stay intact when a CRM wants first and last", () => {
  assert.deepEqual(splitName("Jane Van Der Berg"), {
    first: "Jane",
    last: "Van Der Berg",
  });
  assert.deepEqual(splitName("Cher"), { first: "Cher", last: "" });
  assert.deepEqual(splitName(""), { first: "", last: "" });
});

test("HubSpot mapping nests under properties and carries the score reasons", () => {
  const p = toCrmPayload(LEAD, "hubspot");
  assert.equal(p.properties.email, LEAD.email);
  assert.equal(p.properties.firstname, "Jane");
  assert.equal(p.properties.hs_lead_status, "OPEN");
  assert.match(p.properties.lead_score_reasons, /has_business_email/);
});

test("GoHighLevel mapping tags the band and the source", () => {
  const p = toCrmPayload(LEAD, "gohighlevel");
  assert.ok(p.tags.includes("score:hot"));
  assert.ok(p.tags.includes("source:web_form"));
  assert.ok(
    p.customFields.some(
      (f) => f.key === "consent_basis" && f.field_value === "consent",
    ),
  );
});

test("empty fields are dropped, not sent as empty strings", () => {
  const p = toCrmPayload(
    { email: "x@acme.example", company: "", name: null },
    "generic",
  );
  assert.ok(!("company" in p));
  assert.ok(!("name" in p));
});

test("the upsert key is the email everywhere it can be", () => {
  assert.equal(upsertKey(LEAD, "hubspot").idProperty, "email");
  assert.equal(upsertKey(LEAD, "generic").match_on, "email");
  assert.equal(upsertKey({ phone: "4155550134" }, "generic").match_on, "phone");
  assert.equal(upsertKey({}, "generic").value, "");
});

test("mapping never mutates the lead it was given", () => {
  const before = JSON.stringify(LEAD);
  toCrmPayload(LEAD, "gohighlevel");
  toCrmPayload(LEAD, "hubspot");
  assert.equal(JSON.stringify(LEAD), before);
});
