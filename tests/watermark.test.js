"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { stamp, parse, evaluate, mark } = require("../src/domain/watermark.js");

const at = (revision) => ({ revision, watermarks: [] });

test("a stamp survives the round trip", () => {
  assert.deepEqual(parse(stamp("deploy", 7)), { action: "deploy", revision: 7 });
  assert.equal(parse("no-separator"), null);
  assert.equal(parse("deploy@x"), null);
});

test("a command computed against the current revision is accepted", () => {
  assert.equal(evaluate(at(7), stamp("deploy", 7)), null);
});

test("the loop breaker: the event a command caused cannot re-issue it", () => {
  const t = mark(at(7), stamp("deploy", 7));
  const afterAdvance = { ...t, revision: 8 };
  assert.match(evaluate(afterAdvance, stamp("deploy", 7)).dropped, /stale/);
  assert.match(evaluate(t, stamp("deploy", 7)).dropped, /duplicate/);
});

test("a retry of the same revision is dropped once it has been applied", () => {
  let t = at(3);
  assert.equal(evaluate(t, stamp("merge", 3)), null);
  t = mark(t, stamp("merge", 3));
  assert.match(evaluate(t, stamp("merge", 3)).dropped, /duplicate/);
  assert.equal(evaluate(t, stamp("deploy", 3)), null);
});

test("garbage is refused rather than run", () => {
  assert.match(evaluate(at(1), "").dropped, /malformed/);
  assert.match(evaluate(at(1), "deploy@").dropped, /malformed/);
});

test("the watermark window stays bounded", () => {
  let t = at(0);
  for (let i = 0; i < 200; i++) t = mark(t, stamp("ping", i));
  assert.equal(t.watermarks.length, 50);
  assert.equal(t.watermarks[49], "ping@199");
});
