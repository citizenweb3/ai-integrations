import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, normalizeEvidence } from "../src";

// T-026BJ — research evidence keeps a Vertex grounding-redirect URL as its
// source instead of nulling it. Pure-function tests; no DB, but the import
// pulls the client in, so close the pool at the end.

after(async () => {
  await closeDb();
});

const REDIRECT =
  "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbC123_token==";
const RAW = "https://www.bode.bio/";

test("grounding-redirect with no recovered citation is kept, not nulled", () => {
  const ev = normalizeEvidence({
    sourceUrl: REDIRECT,
    sourceType: "search_result",
    quoteText: "Bode is a family business founded in 1960.",
    supportType: "supports"
  });
  assert.ok(ev);
  assert.equal(ev.sourceUrl, REDIRECT, "redirect kept as the source");
});

test("a recovered raw citation URL is preferred over the redirect", () => {
  const ev = normalizeEvidence(
    {
      sourceUrl: REDIRECT,
      sourceType: "search_result",
      quoteText: "Founded in 1960.",
      supportType: "supports"
    },
    RAW // citationSourceUrl recovered from grounding metadata
  );
  assert.ok(ev);
  assert.equal(ev.sourceUrl, RAW, "raw citation wins when available");
});

test("a clean primary URL passes through unchanged", () => {
  const ev = normalizeEvidence({
    sourceUrl: "https://acme.com/team",
    sourceType: "search_result",
    quoteText: "Acme team page.",
    supportType: "supports"
  });
  assert.ok(ev);
  assert.equal(ev.sourceUrl, "https://acme.com/team");
});

test("non-http junk URL becomes null but quote-only evidence survives", () => {
  const ev = normalizeEvidence({
    sourceUrl: "ftp://nope",
    sourceType: "search_result",
    quoteText: "Quote with no usable URL.",
    supportType: "supports"
  });
  assert.ok(ev, "evidence kept because it still has a quote");
  assert.equal(ev.sourceUrl, null, "unusable URL dropped to null");
});

test("evidence with neither URL nor quote is dropped entirely", () => {
  const ev = normalizeEvidence({
    sourceType: "search_result",
    supportType: "supports"
  });
  assert.equal(ev, null);
});
