const test = require("node:test");
const assert = require("node:assert");
const {
  scoreLead,
  bandFor,
  isFreeEmail,
  SCORING_WEIGHTS,
} = require("../logic/scoring.js");

test("band boundaries are inclusive at the lower edge", () => {
  assert.equal(bandFor(60), "hot");
  assert.equal(bandFor(59), "warm");
  assert.equal(bandFor(35), "warm");
  assert.equal(bandFor(34), "cold");
  assert.equal(bandFor(15), "cold");
  assert.equal(bandFor(14), "junk");
  assert.equal(bandFor(0), "junk");
});

test("an empty lead scores zero and lands in junk", () => {
  const r = scoreLead({});
  assert.equal(r.score, 0);
  assert.equal(r.band, "junk");
  assert.deepEqual(r.reasons, []);
});

test("null and undefined input do not throw", () => {
  assert.equal(scoreLead(null).score, 0);
  assert.equal(scoreLead(undefined).band, "junk");
});

test("business email plus mid-size company plus call request reaches hot", () => {
  const r = scoreLead({
    email: "ops@acme.example",
    company_size: 120,
    requested_call: true,
  });
  // 15 + 15 + 20 = 50 ... warm, not hot. Explicit so a weight change breaks this test.
  assert.equal(r.score, 50);
  assert.equal(r.band, "warm");
});

test("adding a stated budget tips the same lead into hot", () => {
  const r = scoreLead({
    email: "ops@acme.example",
    company_size: 120,
    requested_call: true,
    budget_amount: 5000,
  });
  assert.equal(r.score, 70);
  assert.equal(r.band, "hot");
});

test("free email domains are penalised and never earn the business-email points", () => {
  const r = scoreLead({ email: "someone@gmail.com", requested_call: true });
  assert.ok(r.reasons.includes("free_email_domain -10"));
  assert.ok(!r.reasons.some((x) => x.startsWith("has_business_email")));
  assert.equal(r.score, 10);
});

test("company size buckets do not stack", () => {
  const r = scoreLead({ company_size: 500 });
  const sizeReasons = r.reasons.filter((x) => x.startsWith("company_size"));
  assert.equal(sizeReasons.length, 1);
  assert.equal(sizeReasons[0], "company_size_200_plus +20");
});

test("company size boundaries pick the right bucket", () => {
  assert.equal(scoreLead({ company_size: 10 }).score, 0);
  assert.ok(
    scoreLead({ company_size: 11 }).reasons.includes("company_size_11_50 +10"),
  );
  assert.ok(
    scoreLead({ company_size: 50 }).reasons.includes("company_size_11_50 +10"),
  );
  assert.ok(
    scoreLead({ company_size: 51 }).reasons.includes("company_size_51_200 +15"),
  );
  assert.ok(
    scoreLead({ company_size: 199 }).reasons.includes(
      "company_size_51_200 +15",
    ),
  );
  assert.ok(
    scoreLead({ company_size: 200 }).reasons.includes(
      "company_size_200_plus +20",
    ),
  );
});

test("timeline scores only inside the 1-30 day window", () => {
  assert.equal(scoreLead({ timeline_days: 0 }).score, 0);
  assert.equal(
    scoreLead({ timeline_days: 30 }).score,
    SCORING_WEIGHTS.timeline_under_30d,
  );
  assert.equal(scoreLead({ timeline_days: 31 }).score, 0);
});

test("score is clamped to 0 even when penalties dominate", () => {
  const r = scoreLead({
    email: "kid@gmail.com",
    is_student: true,
    in_service_area: false,
  });
  assert.equal(r.raw_score, -50);
  assert.equal(r.score, 0);
  assert.equal(r.band, "junk");
});

test("score is clamped to 100 when every positive signal fires", () => {
  const r = scoreLead({
    email: "cmo@acme.example",
    company_size: 900,
    budget_amount: 50000,
    timeline_days: 7,
    requested_call: true,
    replied_within_minutes: 5,
    viewed_competitor_page: true,
  });
  assert.equal(r.raw_score, 110);
  assert.equal(r.score, 100);
  assert.equal(r.band, "hot");
});

test("reply speed boundary is inclusive at 60 minutes", () => {
  assert.ok(
    scoreLead({ replied_within_minutes: 60 }).reasons.includes(
      "replied_within_1h +10",
    ),
  );
  assert.equal(scoreLead({ replied_within_minutes: 61 }).score, 0);
});

test("reasons are auditable strings, one per fired signal", () => {
  const r = scoreLead({ email: "ops@acme.example", requested_call: true });
  assert.deepEqual(r.reasons, ["has_business_email +15", "requested_call +20"]);
});

test("free email detection ignores case and whitespace", () => {
  assert.equal(isFreeEmail("  Someone@GMAIL.com "), true);
  assert.equal(isFreeEmail("ops@acme.example"), false);
  assert.equal(isFreeEmail("not-an-email"), false);
});
