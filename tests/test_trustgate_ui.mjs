import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  canIssueCertificate,
  certificateIsCurrent,
  createCertificate,
  evaluateMetadata,
  hasFreshPassingEvidence,
  inspectSourceResponse,
} from "../trustgate-core.mjs";

const now = Date.parse("2026-10-31T16:00:00.000Z");
const ready = {
  owner: "Climate Data Team",
  description: "Hourly weather for the selected city.",
  refreshAgeHours: "2",
  fields: "city, observed_at, temperature_c, humidity_pct, precipitation_mm, wind_speed_kph, weather_code, source",
};
const evidence = { pass: true, checkedAt: new Date(now).toISOString(), values: { temperatureC: 18, relativeHumidityPct: 42, precipitationMm: 0 } };
const controls = ["intended_use", "sensitivity", "access_policy", "lineage", "quality_expectations"].map((control) => ({ control, declared: true }));
const apiPayload = (time = "2026-10-31T15:00") => ({ current: { time, temperature_2m: 18.5, relative_humidity_2m: 42, precipitation: 0 } });
const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const uiScript = await readFile(new URL("../trustgate-ui.mjs", import.meta.url), "utf8");

test("complete metadata is READY", () => {
  assert.equal(evaluateMetadata(ready).decision, "READY");
});

test("over-limit refresh age requires REVIEW", () => {
  assert.equal(evaluateMetadata({ ...ready, refreshAgeHours: "25" }).decision, "REVIEW");
});

test("missing required metadata blocks readiness", () => {
  assert.equal(evaluateMetadata({ ...ready, owner: "" }).decision, "BLOCKED");
});

test("blank and negative refresh ages fail validation", () => {
  assert.equal(evaluateMetadata({ ...ready, refreshAgeHours: "" }).decision, "BLOCKED");
  assert.equal(evaluateMetadata({ ...ready, refreshAgeHours: "-1" }).decision, "BLOCKED");
});

test("duplicate schema fields are rejected case-insensitively", () => {
  const result = evaluateMetadata({ ...ready, fields: "a,b,c,d,e,f,g,source,SOURCE" });
  assert.equal(result.decision, "BLOCKED");
  assert.match(result.checks.find((check) => check.id === "fields").evidence, /Duplicate/);
});

test("current public API payload is accepted and timestamp normalized as UTC", () => {
  const result = inspectSourceResponse(apiPayload(), now);
  assert.equal(result.pass, true);
  assert.equal(result.sampleTime, "2026-10-31T15:00:00.000Z");
  assert.equal(result.values.temperatureC, 18.5);
});

test("source response missing fields is rejected", () => {
  assert.throws(() => inspectSourceResponse({ current: { time: "2026-10-31T15:00" } }, now), /missing/);
});

test("stale and future source timestamps are rejected", () => {
  assert.throws(() => inspectSourceResponse(apiPayload("2026-10-31T12:00"), now), /old/);
  assert.throws(() => inspectSourceResponse(apiPayload("2026-10-31T17:00"), now), /future/);
});

test("source evidence expires after fifteen minutes", () => {
  assert.equal(hasFreshPassingEvidence(evidence, now + 14 * 60_000), true);
  assert.equal(hasFreshPassingEvidence(evidence, now + 16 * 60_000), false);
});

test("certificate cannot issue unless all three evidence layers are ready", () => {
  assert.equal(canIssueCertificate({ metadataDecision: "READY", sourceEvidence: evidence, controls, now }), true);
  assert.equal(canIssueCertificate({ metadataDecision: "REVIEW", sourceEvidence: evidence, controls, now }), false);
  assert.equal(canIssueCertificate({ metadataDecision: "READY", sourceEvidence: { ...evidence, pass: false }, controls, now }), false);
  assert.equal(canIssueCertificate({ metadataDecision: "READY", sourceEvidence: evidence, controls: controls.slice(1), now }), false);
  assert.equal(canIssueCertificate({ metadataDecision: "READY", sourceEvidence: evidence, controls: controls.map((item, index) => index ? item : { ...item, declared: false }), now }), false);
});

test("certificate records policy scope and expires in 24 hours", () => {
  const result = evaluateMetadata(ready);
  const certificate = createCertificate({ metadata: result.normalized, checks: result.checks, sourceEvidence: evidence, controls, id: "TG-TEST", now });
  assert.equal(certificate.certificate_id, "TG-TEST");
  assert.equal(Date.parse(certificate.expires_at) - Date.parse(certificate.issued_at), 24 * 60 * 60_000);
  assert.match(certificate.scope, /not a regulatory/);
  assert.equal(certificateIsCurrent(certificate, now + 23 * 60 * 60_000), true);
  assert.equal(certificateIsCurrent(certificate, now + 24 * 60 * 60_000), false);
});

test("catalog certificates retain the selected catalog asset identity", () => {
  const result = evaluateMetadata(ready);
  const cert = createCertificate({ metadata: result.normalized, checks: result.checks, sourceEvidence: evidence, controls, id: "TG-CATALOG", productId: "sample.claims", now });
  assert.equal(cert.product.product_id, "sample.claims");
});

test("every UI script target exists exactly once in the page", () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual(duplicateIds, []);
  const referencedIds = [...new Set([...uiScript.matchAll(/byId\("([^"]+)"\)/g)].map((match) => match[1]))];
  for (const id of referencedIds) assert.ok(ids.includes(id), `Missing UI target #${id}`);
});

test("UI includes responsive, reduced-motion, and keyboard-focus treatments", () => {
  assert.match(html, /@media\s*\(max-width:\s*620px\)/);
  assert.match(html, /prefers-reduced-motion:\s*reduce/);
  assert.match(html, /:focus-visible/);
  assert.match(html, /<a class="skip" href="#main">/);
});

test("UI exposes a read-only OpenMetadata connection, asset picker, and live recheck", () => {
  for (const id of ["catalog-url", "catalog-token", "catalog-connect", "catalog-asset", "catalog-apply"]) {
    assert.ok(html.includes(`id="${id}"`), `Missing catalog UI control #${id}`);
  }
  assert.match(uiScript, /\/api\/catalog\/connect/);
  assert.match(uiScript, /\/api\/catalog\/asset\?/);
  assert.match(uiScript, /function applyCatalogAsset/);
  assert.match(html, /read-only OpenMetadata integration/i);
});
