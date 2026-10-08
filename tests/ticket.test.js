"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { LAYERS, Rejected, transition, recordApproval, assertSeparation, missingApprovals, isTagged } =
  require("../src/domain/ticket.js");

const base = () => ({
  id: "471", phase: "intake", branch: null, mergeRequest: null,
  releaseTag: null, approvals: {}, revision: 0, history: [],
});

const approveAll = (t, actor = "a@example") =>
  LAYERS.reduce((acc, l) => recordApproval(acc, l, actor, "now"), t);

test("a phase cannot be skipped", () => {
  assert.throws(() => transition(base(), "merge", "x", "now"), (e) => e.code === "state");
});

test("merge is refused when the merge request does not exist", () => {
  const t = { ...approveAll({ ...base(), phase: "in-review", branch: "rel/1.0" }), mergeRequest: null };
  assert.throws(() => transition(t, "merge", "x", "now"), (e) => e.code === "state");
});

test("merge is refused while any layer is missing", () => {
  const t = { ...base(), phase: "in-review", branch: "rel/1.0", mergeRequest: "mr/9" };
  const partial = LAYERS.slice(0, 4).reduce((a, l) => recordApproval(a, l, "x", "now"), t);
  assert.deepEqual(missingApprovals(partial), ["engineering"]);
  assert.throws(() => transition(partial, "merge", "y", "now"), (e) => e.code === "state");
});

test("the happy path walks every phase and records who did what", () => {
  let t = base();
  t = transition(t, "startDevelopment", "dev", "t1");
  t = transition({ ...t, branch: "rel/1.0" }, "openMergeRequest", "dev", "t2");
  t = approveAll({ ...t, mergeRequest: "mr/9" }, "reviewer@example");
  assert.deepEqual(missingApprovals(t), []);
  t = transition(t, "merge", "dev", "t3");
  assert.equal(t.phase, "merged");
  assert.equal(t.approvals.merged_by, "dev");
  assert.deepEqual(t.history.map((h) => h.action),
    ["startDevelopment", "openMergeRequest", "merge"]);
});

test("deploy needs a release tag, and only a well-formed one", () => {
  const merged = { ...base(), phase: "merged", branch: "rel/1.0", mergeRequest: "mr/9", releaseTag: null };
  assert.throws(() => transition(merged, "deploy", "ops", "now"), (e) => e.code === "state");
  assert.equal(isTagged({ releaseTag: "latest" }), false);
  assert.equal(isTagged({ releaseTag: "v1.2.3" }), true);
  assert.equal(transition({ ...merged, releaseTag: "v1.2.3" }, "deploy", "ops", "now").phase, "deployed");
});

test("approvals only land while the ticket is under review", () => {
  assert.throws(() => recordApproval(base(), "team", "x", "now"), (e) => e.code === "state");
  assert.throws(() => recordApproval({ ...base(), phase: "in-review" }, "finance", "x", "now"),
    (e) => e.code === "unknown-layer");
});

test("the last approver cannot be the merger", () => {
  const t = approveAll({ ...base(), phase: "in-review", mergeRequest: "mr/9" }, "same@example");
  assert.throws(() => assertSeparation(t, "same@example"), (e) => e.code === "duty");
  assert.doesNotThrow(() => assertSeparation(t, "other@example"));
});

test("a transition never mutates the ticket it was given", () => {
  const t = base();
  const next = transition(t, "startDevelopment", "dev", "now");
  assert.equal(t.phase, "intake");
  assert.equal(next.phase, "in-dev");
  assert.notEqual(t, next);
});

test("an unknown action is refused, not ignored", () => {
  assert.throws(() => transition(base(), "deleteProduction", "x", "now"), (e) => e.code === "unknown-action");
});
