#!/usr/bin/env python3
"""Structural validator for every workflow in workflows/.

Run: python tests/validate_workflows.py

Checks, in order:
  1.  the file set is exactly 01..16 and each file is valid JSON
  2.  top-level shape: nodes array, connections object, settings object
  3.  every node has id, name, type, typeVersion, position, parameters
  4.  node ids and names are unique inside a workflow
  5.  every name used in connections exists as a node
  6.  no orphans: non-trigger nodes have an inbound edge, triggers have an outbound
      edge (sticky notes are exempt - they are documentation, not flow)
  7.  Code nodes have non-empty ASCII-only jsCode
  8.  IF nodes have at most 2 outputs, Switch outputs match their rule count
  9.  every credential id is a REPLACE_WITH_* placeholder
  10. no literal external hostnames outside the .example TLD and no secret-shaped strings
  11. every workflow either calls 16-safety-rails or carries a written exemption
  12. shared logic pasted into Code nodes is byte-identical to logic/*.js
"""
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WF_DIR = os.path.join(ROOT, "workflows")
LOGIC_DIR = os.path.join(ROOT, "logic")

TRIGGER_TYPES = {
    "n8n-nodes-base.webhook",
    "n8n-nodes-base.scheduleTrigger",
    "n8n-nodes-base.executeWorkflowTrigger",
    "n8n-nodes-base.manualTrigger",
    "n8n-nodes-base.cron",
}
# Sticky notes carry setup instructions and are intentionally unconnected.
FLOWLESS_TYPES = {"n8n-nodes-base.stickyNote"}

REQUIRED_NODE_KEYS = ("id", "name", "type", "typeVersion", "position", "parameters")
RAILS_WORKFLOW_ID = "REPLACE_WITH_16_SAFETY_RAILS_WORKFLOW_ID"
EXEMPTION_PREFIXES = ("Does not call the rails", "Does not gate on the rails", "This IS the rails")

SECRET_PATTERNS = [
    (re.compile(r"\bsk-[A-Za-z0-9]{16,}"), "OpenAI-style secret key"),
    (re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}"), "Slack token"),
    (re.compile(r"\bEAA[A-Za-z0-9]{20,}"), "Meta access token"),
    (re.compile(r"\bAKIA[0-9A-Z]{16}\b"), "AWS access key id"),
    (re.compile(r"\bghp_[A-Za-z0-9]{20,}"), "GitHub token"),
    (re.compile(r"\bBearer\s+[A-Za-z0-9._-]{20,}"), "hardcoded bearer token"),
    (re.compile(r"\b[0-9a-f]{32,}\b"), "long hex string that could be a key"),
    (re.compile(r"\b\+?[0-9]{1,3}[ -]?\(?[0-9]{3}\)?[ -][0-9]{3}[ -][0-9]{4}\b"), "phone number"),
]
# Deterministic node/version uuids are the only long hex-ish values we allow, and
# they are checked separately, so strip them before the secret scan.
UUID_RE = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b")
URL_RE = re.compile(r"https?://([A-Za-z0-9._-]+)")
ALLOWED_HOSTS_SUFFIX = (".example", "example.com", "example.org", "example.net")

PARITY = [
    ("scoring.js", "scoring weights"),
    ("scoring.js", "score bands"),
    ("optout.js", "opt-out keywords"),
    ("hours.js", "hours defaults"),
    ("dedupe.js", "match thresholds"),
    ("crm.js", "crm adapters"),
]

failures = []
checks = 0


def check(condition, message):
    global checks
    checks += 1
    if not condition:
        failures.append(message)
    return bool(condition)


def parity_block(fname, label):
    src = open(os.path.join(LOGIC_DIR, fname), "r", encoding="utf-8").read()
    m = re.search(r"// --- parity block: %s ---\n(.*?)// --- end parity block ---"
                  % re.escape(label), src, re.S)
    if not m:
        return None
    return m.group(1).rstrip("\n")


def node_index(nodes):
    return {n.get("name"): n for n in nodes if isinstance(n, dict)}


def validate_file(path):
    fname = os.path.basename(path)
    raw = open(path, "r", encoding="utf-8").read()

    try:
        wf = json.loads(raw)
    except Exception as exc:  # noqa: BLE001
        check(False, "%s: not valid JSON (%s)" % (fname, exc))
        return None

    if not check(isinstance(wf.get("nodes"), list) and wf["nodes"], "%s: missing nodes array" % fname):
        return None
    check(isinstance(wf.get("connections"), dict), "%s: missing connections object" % fname)
    check(isinstance(wf.get("settings"), dict), "%s: missing settings object" % fname)
    check(isinstance(wf.get("name"), str) and wf["name"].startswith(fname[:-5]),
          "%s: workflow name does not start with the file slug" % fname)

    nodes = wf["nodes"]
    ids, names = set(), set()
    for n in nodes:
        label = "%s: node %r" % (fname, n.get("name", "<unnamed>"))
        for key in REQUIRED_NODE_KEYS:
            check(key in n, "%s missing required key %r" % (label, key))
        check(isinstance(n.get("position"), list) and len(n["position"]) == 2,
              "%s position must be [x, y]" % label)
        check(isinstance(n.get("parameters"), dict), "%s parameters must be an object" % label)
        check(isinstance(n.get("typeVersion"), (int, float)), "%s typeVersion must be numeric" % label)
        check(n.get("id") not in ids, "%s duplicate node id" % label)
        check(n.get("name") not in names, "%s duplicate node name" % label)
        ids.add(n.get("id"))
        names.add(n.get("name"))

        if n.get("type") == "n8n-nodes-base.code":
            js = n.get("parameters", {}).get("jsCode", "")
            check(isinstance(js, str) and js.strip() != "", "%s Code node has empty jsCode" % label)
            if isinstance(js, str):
                non_ascii = [c for c in js if ord(c) > 127]
                check(not non_ascii,
                      "%s jsCode contains non-ASCII characters: %r" % (label, sorted(set(non_ascii))[:5]))
                check("TODO" not in js and "FIXME" not in js, "%s jsCode contains a TODO/FIXME" % label)

        creds = n.get("credentials") or {}
        for cred_type, cred in creds.items():
            check(str(cred.get("id", "")).startswith("REPLACE_WITH_"),
                  "%s credential %s is not a placeholder: %r" % (label, cred_type, cred.get("id")))

    idx = node_index(nodes)

    # connections integrity
    for src, outputs in wf["connections"].items():
        check(src in idx, "%s: connections reference unknown source node %r" % (fname, src))
        main = outputs.get("main", [])
        check(isinstance(main, list), "%s: connections[%r].main must be a list" % (fname, src))
        src_node = idx.get(src, {})
        if src_node.get("type") == "n8n-nodes-base.if":
            check(len(main) <= 2, "%s: IF node %r declares %d outputs" % (fname, src, len(main)))
        if src_node.get("type") == "n8n-nodes-base.switch":
            rules = src_node.get("parameters", {}).get("rules", {}).get("values", [])
            check(len(main) <= len(rules),
                  "%s: Switch %r wires %d outputs but declares %d rules" % (fname, src, len(main), len(rules)))
        for out in main:
            for conn in out:
                check(conn.get("node") in idx,
                      "%s: connection from %r targets unknown node %r" % (fname, src, conn.get("node")))

    inbound = {n["name"]: 0 for n in nodes}
    outbound = {n["name"]: 0 for n in nodes}
    for src, outputs in wf["connections"].items():
        for out in outputs.get("main", []):
            for conn in out:
                if src in outbound:
                    outbound[src] += 1
                if conn.get("node") in inbound:
                    inbound[conn["node"]] += 1

    for n in nodes:
        if n.get("type") in FLOWLESS_TYPES:
            continue
        name = n.get("name")
        if n.get("type") in TRIGGER_TYPES:
            check(outbound[name] > 0, "%s: trigger %r has no outgoing connection" % (fname, name))
        else:
            check(inbound[name] > 0, "%s: node %r is orphaned (no inbound connection)" % (fname, name))
            check(inbound[name] + outbound[name] > 0, "%s: node %r is disconnected" % (fname, name))

    # secrets / hostnames
    scrubbed = UUID_RE.sub("<uuid>", raw)
    for pattern, what in SECRET_PATTERNS:
        m = pattern.search(scrubbed)
        check(m is None, "%s: possible %s found: %r" % (fname, what, m.group(0) if m else ""))
    for host in set(URL_RE.findall(raw)):
        check(host.endswith(ALLOWED_HOSTS_SUFFIX),
              "%s: literal external host %r - use an env var or a .example domain" % (fname, host))

    lowered = raw.lower()
    for banned in ("todo:", "fixme", "lorem ipsum", "coming soon", "placeholder text"):
        check(banned not in lowered, "%s: contains %r" % (fname, banned))

    # safety rails coverage
    calls_rails = any(
        n.get("type") == "n8n-nodes-base.executeWorkflow"
        and n.get("parameters", {}).get("workflowId", {}).get("value") == RAILS_WORKFLOW_ID
        for n in nodes
    )
    note = (wf.get("meta") or {}).get("safety_rails", "")
    check(calls_rails or note.startswith(EXEMPTION_PREFIXES),
          "%s: does not call 16-safety-rails and carries no written exemption" % fname)
    if calls_rails:
        check("Rails Allowed?" in idx, "%s: calls the rails but has no 'Rails Allowed?' gate" % fname)

    return {"file": fname, "nodes": len(nodes), "calls_rails": calls_rails, "raw": raw}


def main():
    expected = ["%02d" % i for i in range(1, 17)]
    files = sorted(f for f in os.listdir(WF_DIR) if f.endswith(".json"))
    check(len(files) == 16, "expected 16 workflow files, found %d" % len(files))
    for prefix in expected:
        check(any(f.startswith(prefix + "-") for f in files), "missing workflow %s-*" % prefix)

    results = []
    for f in files:
        r = validate_file(os.path.join(WF_DIR, f))
        if r:
            results.append(r)

    # parity between logic/*.js and the Code nodes that claim to mirror them
    all_raw = "\n".join(r["raw"] for r in results)
    for fname, label in PARITY:
        block = parity_block(fname, label)
        if not check(block is not None, "logic/%s: parity block %r not found" % (fname, label)):
            continue
        encoded = json.dumps(block)[1:-1]  # same escaping json.dump produced
        check(encoded in all_raw,
              "parity drift: logic/%s block %r is not present verbatim in any workflow" % (fname, label))

    print("n8n-social-leadgen-pack :: workflow validation")
    print("-" * 60)
    for r in results:
        print("  %-34s %2d nodes   rails: %s" % (r["file"], r["nodes"], "calls" if r["calls_rails"] else "exempt"))
    print("-" * 60)
    print("%d workflows, %d assertions" % (len(results), checks))

    if failures:
        print("\nFAILED (%d):" % len(failures))
        for f in failures:
            print("  - %s" % f)
        return 1
    print("PASS - all assertions held")
    return 0


if __name__ == "__main__":
    sys.exit(main())
