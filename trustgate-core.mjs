export const POLICY_VERSION = "1.1";
export const EVIDENCE_MAX_AGE_MS = 15 * 60 * 1000;
export const CERTIFICATE_TTL_MS = 24 * 60 * 60 * 1000;
export const SOURCE_MAX_AGE_HOURS = 3;
export const DEFAULT_POLICY = Object.freeze({
  id: "balanced-data-product-readiness",
  name: "Balanced data product readiness",
  version: "1.0.0",
  metadata: { requireOwner: true, requireDescription: true, requireSchemaFields: true, minimumSchemaFields: 8, maximumRefreshAgeHours: 24 },
  failureOutcomes: { owner: "BLOCK", description: "BLOCK", schemaFields: "BLOCK", freshness: "REVIEW", requiredEvidence: "BLOCK" },
  requiredEvidence: ["metadata_snapshot", "catalog_source"],
  certificateTtlMinutes: 60,
});

const trim = (value) => String(value ?? "").trim();

export function evaluateMetadata(metadata) {
  const owner = trim(metadata.owner);
  const description = trim(metadata.description);
  const rawAge = trim(metadata.refreshAgeHours);
  const age = rawAge ? Number(rawAge) : Number.NaN;
  const rawFields = Array.isArray(metadata.fields)
    ? metadata.fields
    : String(metadata.fields ?? "").split(",");
  const fields = rawFields.map(trim).filter(Boolean);
  const uniqueFields = new Set(fields.map((field) => field.toLocaleLowerCase()));
  const fieldIssues = [];
  if (fields.length < 8) fieldIssues.push(`Only ${fields.length} distinct field${fields.length === 1 ? "" : "s"}; 8 are required.`);
  if (uniqueFields.size !== fields.length) fieldIssues.push("Duplicate field names are not allowed.");

  const checks = [
    { id: "owner", name: "Accountable owner", status: owner ? "PASS" : "FAIL", evidence: owner ? `Declared: ${owner}` : "An accountable owner is required." },
    { id: "description", name: "Business description", status: description ? "PASS" : "FAIL", evidence: description ? `${description.length} characters; description is present.` : "A consumer-facing description is required." },
    { id: "freshness", name: "Declared freshness", status: Number.isFinite(age) && age >= 0 ? (age <= 24 ? "PASS" : "REVIEW") : "FAIL", evidence: Number.isFinite(age) && age >= 0 ? `Declared refresh age: ${age}h; sample limit: 24h.` : "Enter a valid, non-negative refresh age." },
    { id: "fields", name: "Schema field coverage", status: fieldIssues.length ? "FAIL" : "PASS", evidence: fieldIssues.length ? fieldIssues.join(" ") : `${fields.length} distinct field names declared.` },
  ];
  const decision = checks.some((check) => check.status === "FAIL")
    ? "BLOCKED"
    : checks.some((check) => check.status === "REVIEW")
      ? "REVIEW"
      : "READY";
  return { decision, checks, normalized: { owner, description, refreshAgeHours: age, fields } };
}

function parseUtcTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) return NaN;
  const normalized = value.endsWith("Z") || /[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`;
  return Date.parse(normalized);
}

export function inspectSourceResponse(payload, now = Date.now()) {
  const current = payload?.current;
  const required = ["time", "temperature_2m", "relative_humidity_2m", "precipitation"];
  const missing = required.filter((key) => !Object.hasOwn(current ?? {}, key));
  if (missing.length) throw new Error(`Current response is missing: ${missing.join(", ")}.`);

  const sampleTime = parseUtcTimestamp(current.time);
  if (!Number.isFinite(sampleTime)) throw new Error("The source returned an invalid current-time timestamp.");
  if (!Number.isFinite(current.temperature_2m) || !Number.isFinite(current.relative_humidity_2m)) {
    throw new Error("Temperature and humidity must be numeric in the current response.");
  }
  if (current.precipitation !== null && (!Number.isFinite(current.precipitation) || current.precipitation < 0)) {
    throw new Error("Precipitation must be a non-negative number or null.");
  }
  const ageHours = (now - sampleTime) / 3_600_000;
  if (ageHours < -0.25) throw new Error("The source timestamp is unexpectedly in the future.");
  if (ageHours > SOURCE_MAX_AGE_HOURS) throw new Error(`The source timestamp is ${ageHours.toFixed(1)} hours old; the demo limit is ${SOURCE_MAX_AGE_HOURS} hours.`);

  return {
    pass: true,
    checkedAt: new Date(now).toISOString(),
    endpoint: "Open-Meteo Forecast API",
    location: "New York City, US",
    sampleTime: new Date(sampleTime).toISOString(),
    ageHours: Math.max(0, ageHours),
    values: {
      temperatureC: current.temperature_2m,
      relativeHumidityPct: current.relative_humidity_2m,
      precipitationMm: current.precipitation,
    },
    returnedFields: required,
  };
}

export function hasFreshPassingEvidence(evidence, now = Date.now()) {
  if (!evidence?.pass) return false;
  const checkedAt = Date.parse(evidence.checkedAt);
  const age = now - checkedAt;
  return Number.isFinite(checkedAt) && age >= 0 && age <= EVIDENCE_MAX_AGE_MS;
}

export function canIssueCertificate({ metadataDecision, sourceEvidence, controls, now = Date.now() }) {
  return metadataDecision === "READY"
    && hasFreshPassingEvidence(sourceEvidence, now)
    && Array.isArray(controls)
    && controls.length === 5
    && controls.every((control) => control.declared === true);
}

export function createCertificate({ metadata, checks, sourceEvidence, controls, id, now = Date.now() }) {
  if (!id) throw new Error("A unique certificate ID is required.");
  const issuedAt = new Date(now);
  const expiresAt = new Date(now + CERTIFICATE_TTL_MS);
  return {
    certificate_id: id,
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    policy_version: POLICY_VERSION,
    product: {
      product_id: "weather.city.observations",
      owner: metadata.owner,
      description: metadata.description,
      declared_refresh_age_hours: metadata.refreshAgeHours,
      fields: metadata.fields,
    },
    evidence: {
      metadata_attestation: { status: "READY", checks },
      live_source_verification: sourceEvidence,
      governance_controls: controls,
    },
    scope: "Portfolio-demo readiness only. Metadata is self-declared; governance controls are not independently verified. This is not a regulatory, access, security, or production-data certification.",
  };
}

export function certificateIsCurrent(certificate, now = Date.now()) {
  const expiresAt = Date.parse(certificate?.expires_at ?? "");
  const issuedAt = Date.parse(certificate?.issued_at ?? "");
  return Number.isFinite(expiresAt) && Number.isFinite(issuedAt) && issuedAt <= now && now < expiresAt;
}

export function stableFingerprint(value) {
  const stable = (input) => Array.isArray(input)
    ? `[${input.map(stable).join(",")}]`
    : input && typeof input === "object"
      ? `{${Object.keys(input).sort().map((key) => `${JSON.stringify(key)}:${stable(input[key])}`).join(",")}}`
      : JSON.stringify(input);
  const text = stable(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function evaluatePolicy(metadata, policy, { evidence = {}, now = Date.now() } = {}) {
  const rules = policy.metadata;
  const fields = Array.isArray(metadata.fields) ? metadata.fields.map((x) => String(x).trim()).filter(Boolean) : [];
  const maxAge = Number(rules.maximumRefreshAgeHours);
  const refreshAge = Number(metadata.refreshAgeHours);
  const requiredEvidence = Array.isArray(policy.requiredEvidence) ? policy.requiredEvidence : [];
  const failureOutcomes = policy.failureOutcomes ?? {};
  const checks = [];
  const add = (id, label, ok, detail, outcome = "BLOCK", skipped = false) => {
    const status = skipped ? "PASS" : ok ? "PASS" : outcome === "REVIEW" ? "REVIEW" : "BLOCKED";
    checks.push({ id, label, status, detail, policyOutcome: outcome });
  };
  add("owner", "Accountable owner", !rules.requireOwner || Boolean(String(metadata.owner ?? "").trim()), rules.requireOwner ? (metadata.owner || "Owner is missing") : "Policy does not require an owner", failureOutcomes.owner, !rules.requireOwner);
  add("description", "Business description", !rules.requireDescription || Boolean(String(metadata.description ?? "").trim()), rules.requireDescription ? (metadata.description || "Description is missing") : "Policy does not require a description", failureOutcomes.description, !rules.requireDescription);
  const distinctFields = new Set(fields.map((x) => x.toLocaleLowerCase()));
  const schemaOk = !rules.requireSchemaFields || (distinctFields.size >= Number(rules.minimumSchemaFields) && fields.length === distinctFields.size);
  add("schemaFields", "Schema field coverage", schemaOk, rules.requireSchemaFields ? `${distinctFields.size} distinct fields; minimum ${rules.minimumSchemaFields}${fields.length !== distinctFields.size ? "; duplicate names found" : ""}` : "Policy does not require schema fields", failureOutcomes.schemaFields, !rules.requireSchemaFields);
  const freshnessOk = Number.isFinite(refreshAge) && refreshAge >= 0 && Number.isFinite(maxAge) && refreshAge <= maxAge;
  add("freshness", "Declared freshness", freshnessOk, `Declared ${Number.isFinite(refreshAge) ? refreshAge : "invalid"}h; maximum ${Number.isFinite(maxAge) ? maxAge : "unset"}h`, failureOutcomes.freshness);

  const missingEvidence = requiredEvidence.filter((key) => !evidence[key]?.available);
  add("requiredEvidence", "Required evidence", missingEvidence.length === 0, missingEvidence.length ? `Missing: ${missingEvidence.join(", ")}` : `Present: ${requiredEvidence.join(", ")}`, failureOutcomes.requiredEvidence);
  const statuses = checks.map((x) => x.status);
  const decision = statuses.includes("BLOCKED") ? "BLOCKED" : statuses.includes("REVIEW") ? "REVIEW" : "READY";
  const metadataSnapshot = { ...metadata, fields };
  const checkedAt = new Date(now).toISOString();
  const certificateExpiresAt = new Date(now + Math.max(1, Number(policy.certificateTtlMinutes) || 60) * 60_000).toISOString();
  const policyFingerprint = stableFingerprint(policy);
  const assetFingerprint = stableFingerprint(metadataSnapshot);
  const evaluation = {
    evaluation_id: `TG-${new Date(now).toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    status: decision,
    checked_at: checkedAt,
    expires_at: certificateExpiresAt,
    policy_id: policy.id,
    policy_version: policy.version,
    policy_fingerprint: policyFingerprint,
    asset_fingerprint: assetFingerprint,
    asset: metadataSnapshot,
    checks,
    required_evidence: requiredEvidence,
    evidence,
    reasons: checks.filter((check) => check.status !== "PASS").map((check) => `${check.label}: ${check.detail}`),
  };
  return evaluation;
}

export function evaluationStaleness(evaluation, policy, metadata, now = Date.now()) {
  if (!evaluation) return { stale: true, reason: "No runtime evaluation exists yet." };
  if (evaluation.policy_fingerprint !== stableFingerprint(policy)) return { stale: true, reason: "The active policy changed after this evaluation." };
  if (evaluation.asset_fingerprint !== stableFingerprint({ ...metadata, fields: Array.isArray(metadata.fields) ? metadata.fields : [] })) return { stale: true, reason: "Catalog metadata changed after this evaluation." };
  if (now >= Date.parse(evaluation.expires_at)) return { stale: true, reason: "The evaluation expired; evidence must be checked again." };
  for (const key of evaluation.required_evidence ?? []) {
    const item = evaluation.evidence?.[key];
    if (!item?.available) return { stale: true, reason: `Required evidence "${key}" is no longer available.` };
    if (item.expiresAt && now >= Date.parse(item.expiresAt)) return { stale: true, reason: `Required evidence "${key}" expired.` };
  }
  return { stale: false, reason: "Policy, asset snapshot, and required evidence are current." };
}
