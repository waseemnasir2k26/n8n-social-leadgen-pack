const test = require("node:test");
const assert = require("node:assert");
const {
  normalizeEmail,
  normalizePhone,
  normalizeDomain,
  companyDomain,
  nameSimilarity,
  matchScore,
  mergeLeads,
  MATCH_THRESHOLDS,
} = require("../logic/dedupe.js");

test("email normalisation strips plus tags everywhere", () => {
  assert.equal(normalizeEmail("Jane+leads@Acme.Example"), "jane@acme.example");
});

test("email normalisation strips dots on Google mail only", () => {
  assert.equal(normalizeEmail("jo.hn.doe@gmail.com"), "johndoe@gmail.com");
  assert.equal(normalizeEmail("jo.hn.doe@googlemail.com"), "johndoe@gmail.com");
  // Dots ARE significant at most providers. Stripping them here would merge strangers.
  assert.equal(
    normalizeEmail("jo.hn.doe@acme.example"),
    "jo.hn.doe@acme.example",
  );
});

test("email normalisation rejects junk instead of guessing", () => {
  assert.equal(normalizeEmail("not-an-email"), "");
  assert.equal(normalizeEmail(""), "");
  assert.equal(normalizeEmail(null), "");
  assert.equal(normalizeEmail("@acme.example"), "");
});

test("phone normalisation keeps the last ten digits across formats", () => {
  assert.equal(normalizePhone("+1 (415) 555-0134"), "4155550134");
  assert.equal(normalizePhone("001-415-555-0134"), "4155550134");
  assert.equal(normalizePhone("415.555.0134"), "4155550134");
  assert.equal(normalizePhone("12345"), "");
  assert.equal(normalizePhone(null), "");
});

test("domain normalisation strips scheme, www, path and port", () => {
  assert.equal(
    normalizeDomain("https://www.Acme.example/pricing?x=1"),
    "acme.example",
  );
  assert.equal(normalizeDomain("acme.example:8443"), "acme.example");
  assert.equal(normalizeDomain("localhost"), "");
});

test("company domain falls back to a business email domain but never a free one", () => {
  assert.equal(companyDomain({ email: "jane@acme.example" }), "acme.example");
  assert.equal(companyDomain({ email: "jane@gmail.com" }), "");
  assert.equal(
    companyDomain({ domain: "https://acme.example", email: "jane@gmail.com" }),
    "acme.example",
  );
});

test("TRUE POSITIVE: same email is an unconditional merge", () => {
  const r = matchScore(
    { email: "Jane+x@acme.example", name: "Jane Doe" },
    { email: "jane@acme.example", name: "J. Doe" },
  );
  assert.equal(r.decision, "merge");
  assert.ok(r.evidence.includes("email_exact"));
});

test("TRUE POSITIVE: same phone in different formats is a merge", () => {
  const r = matchScore(
    { phone: "+1 (415) 555-0134", name: "Jane Doe" },
    { phone: "415-555-0134", name: "Jane D" },
  );
  assert.equal(r.decision, "merge");
  assert.ok(r.score >= MATCH_THRESHOLDS.merge);
});

test("TRUE POSITIVE: same company domain plus a near-identical name merges", () => {
  const r = matchScore(
    { domain: "acme.example", name: "Jonathan Smith" },
    { domain: "www.acme.example", name: "Jonathan Smyth" },
  );
  assert.equal(r.decision, "merge");
  assert.ok(r.evidence.includes("domain_exact"));
});

test("FALSE POSITIVE GUARD: colleagues at one company are not duplicates", () => {
  const r = matchScore(
    { domain: "acme.example", name: "Jane Doe", email: "jane@acme.example" },
    { domain: "acme.example", name: "Bob Smith", email: "bob@acme.example" },
  );
  assert.equal(r.decision, "distinct");
});

test("FALSE POSITIVE GUARD: two people sharing a common name never auto-merge", () => {
  const r = matchScore(
    { name: "John Smith", email: "john.smith@one.example" },
    { name: "John Smith", email: "jsmith@other.example" },
  );
  assert.equal(r.decision, "review");
  assert.ok(
    r.score < MATCH_THRESHOLDS.merge,
    "name similarity alone must stay below the merge line",
  );
});

test("FALSE POSITIVE GUARD: free-email domain collisions are not company matches", () => {
  const r = matchScore(
    { email: "jane@gmail.com", name: "Jane Doe" },
    { email: "bob@gmail.com", name: "Bob Jones" },
  );
  assert.equal(r.decision, "distinct");
  assert.deepEqual(r.evidence, []);
});

test("FALSE POSITIVE GUARD: empty records never match each other", () => {
  assert.equal(matchScore({}, {}).decision, "distinct");
  assert.equal(matchScore({ email: "" }, { email: "" }).decision, "distinct");
});

test("name similarity is a ratio, not a boolean", () => {
  assert.equal(nameSimilarity("Jane Doe", "jane doe"), 1);
  assert.ok(nameSimilarity("Jane Doe", "Jane Doh") > 0.8);
  assert.ok(nameSimilarity("Jane Doe", "Kwame Mensah") < 0.4);
  assert.equal(nameSimilarity("", "Jane Doe"), 0);
});

test("merging keeps the oldest created_at and loses no source ids", () => {
  const primary = {
    id: 1,
    email: "jane@acme.example",
    name: "Jane Doe",
    company: "",
    created_at: "2026-02-01T00:00:00Z",
  };
  const secondary = {
    id: 2,
    email: "",
    name: "J Doe",
    company: "Acme",
    created_at: "2026-01-01T00:00:00Z",
  };
  const merged = mergeLeads(primary, secondary);
  assert.equal(merged.email, "jane@acme.example");
  assert.equal(
    merged.company,
    "Acme",
    "a non-empty value must never be overwritten with an empty one",
  );
  assert.equal(merged.created_at, "2026-01-01T00:00:00Z");
  assert.deepEqual(merged.merged_from, [2]);
});
