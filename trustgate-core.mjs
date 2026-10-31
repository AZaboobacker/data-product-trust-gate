export const POLICY_VERSION = "1.1";
export const EVIDENCE_MAX_AGE_MS = 15 * 60 * 1000;
export const CERTIFICATE_TTL_MS = 24 * 60 * 60 * 1000;
export const SOURCE_MAX_AGE_HOURS = 3;

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

export function createCertificate({ metadata, checks, sourceEvidence, controls, id, productId = "weather.city.observations", now = Date.now() }) {
  if (!id) throw new Error("A unique certificate ID is required.");
  const issuedAt = new Date(now);
  const expiresAt = new Date(now + CERTIFICATE_TTL_MS);
  return {
    certificate_id: id,
    issued_at: issuedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    policy_version: POLICY_VERSION,
    product: {
      product_id: productId,
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
