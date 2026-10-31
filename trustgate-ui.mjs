import {
  canIssueCertificate,
  certificateIsCurrent,
  createCertificate,
  evaluateMetadata,
  hasFreshPassingEvidence,
  inspectSourceResponse,
} from "./trustgate-core.mjs";

const byId = (id) => document.getElementById(id);
const controls = [...document.querySelectorAll("#controls input[type=checkbox]")];
const initial = {
  owner: "Climate Data Team",
  description: "Hourly weather data for a selected city, including temperature, humidity, and precipitation.",
  refreshAgeHours: "2",
  fields: "city, observed_at, temperature_c, humidity_pct, precipitation_mm, wind_speed_kph, weather_code, source",
};
const scenarios = {
  ready: initial,
  review: { ...initial, refreshAgeHours: "36" },
  blocked: { ...initial, owner: "", fields: "city, observed_at, temperature_c" },
};
let sourceEvidence = null;
let certificate = null;
let metadataResult;
let animationToken = 0;

function readMetadata() {
  return {
    owner: byId("owner").value,
    description: byId("description").value,
    refreshAgeHours: byId("age").value,
    fields: byId("fields").value,
  };
}

function readControls() {
  return controls.map((checkbox) => ({
    control: checkbox.value,
    declared: checkbox.checked,
    label: checkbox.closest("label").textContent.trim(),
  }));
}

function renderChecks(checks) {
  const list = byId("checks");
  const fragment = document.createDocumentFragment();
  for (const check of checks) {
    const row = document.createElement("li");
    row.className = `check-row ${check.status.toLowerCase()}`;
    row.dataset.checkId = check.id;
    const icon = document.createElement("span");
    icon.className = "check-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = check.status === "PASS" ? "✓" : check.status === "REVIEW" ? "!" : "×";
    const copy = document.createElement("div");
    const name = document.createElement("div");
    name.className = "check-name";
    name.textContent = check.name;
    const evidence = document.createElement("div");
    evidence.className = "check-evidence";
    evidence.textContent = check.evidence;
    copy.append(name, evidence);
    const status = document.createElement("span");
    status.className = "check-status";
    status.textContent = check.status;
    row.append(icon, copy, status);
    fragment.append(row);
  }
  list.replaceChildren(fragment);
}

function setPill(id, value) {
  const node = byId(id);
  const tone = value === "ISSUED" ? "READY" : value === "EXPIRED" ? "REVIEW" : value;
  node.className = `pill${["READY", "REVIEW", "BLOCKED", "FAIL"].includes(tone) ? ` ${tone}` : ""}`;
  node.textContent = value;
}

function setSourcePresentation({ status, title, text, details = "" }) {
  const result = byId("source-result");
  result.className = `source-result${status === "READY" ? " READY" : status === "REVIEW" ? " REVIEW" : status === "FAIL" ? " FAIL" : ""}`;
  byId("source-title").textContent = title;
  byId("source-text").textContent = text;
  byId("source-details").textContent = details;
  const badge = byId("source-badge");
  badge.textContent = status === "READY" ? "Verified" : status === "REVIEW" ? "Needs review" : status === "FAIL" ? "Failed" : status;
  setPill("layer-source", status === "READY" ? "PASS" : status === "FAIL" ? "FAIL" : status === "REVIEW" ? "REVIEW" : "NOT RUN");
}

function updateEligibility() {
  const ready = canIssueCertificate({
    metadataDecision: metadataResult.decision,
    sourceEvidence,
    controls: readControls(),
  });
  byId("issue").disabled = !ready;
  if (sourceEvidence?.pass && !hasFreshPassingEvidence(sourceEvidence)) {
    byId("source-badge").textContent = "Check expired";
    setPill("layer-source", "REVIEW");
    byId("source-result").className = "source-result REVIEW";
    byId("source-title").textContent = "Source evidence needs refreshing";
    byId("source-text").textContent = "This evidence is older than 15 minutes. Run the live source check again before issuing a certificate.";
  }
  return ready;
}

function invalidateCertificate() {
  const hadCertificate = Boolean(certificate);
  certificate = null;
  byId("download").disabled = true;
  byId("cert-panel").className = "cert-panel";
  byId("cert-title").textContent = "No current certificate";
  byId("cert-text").textContent = hadCertificate
    ? "This certificate was invalidated by a metadata or control change. Re-run checks and issue a new one."
    : "Run the live source check and meet the decision rule to create a certificate.";
  byId("cert-id").textContent = "";
  setPill("layer-cert", "NOT ISSUED");
  updateEligibility();
}

function renderMetadata() {
  animationToken += 1;
  metadataResult = evaluateMetadata(readMetadata());
  renderChecks(metadataResult.checks);
  const { decision } = metadataResult;
  const summary = byId("meta-summary");
  summary.className = `meta-summary ${decision}`;
  byId("summary-icon").textContent = decision === "READY" ? "✓" : decision === "REVIEW" ? "!" : "×";
  byId("meta-title").textContent = `Metadata attestation: ${decision}`;
  byId("meta-text").textContent = decision === "READY"
    ? "All sample metadata rules pass."
    : decision === "REVIEW"
      ? "The product has no blocking gaps, but freshness needs attention."
      : "Resolve the blocking metadata gaps to continue.";
  byId("meta-state").className = `summary-state ${decision}`;
  byId("meta-state").textContent = decision;
  setPill("layer-meta", decision);
  byId("age").setAttribute("aria-invalid", String(!Number.isFinite(Number(byId("age").value)) || Number(byId("age").value) < 0));
  invalidateCertificate();
}

function setScenario(name) {
  const scenario = scenarios[name];
  if (!scenario) return;
  byId("owner").value = scenario.owner;
  byId("description").value = scenario.description;
  byId("age").value = scenario.refreshAgeHours;
  byId("fields").value = scenario.fields;
  controls.forEach((checkbox) => { checkbox.checked = true; });
  sourceEvidence = null;
  setSourcePresentation({ status: "NOT RUN", title: "Waiting for a live check", text: "Scenario changed. Run a fresh live source check before issuing a certificate." });
  renderMetadata();
}

async function runAnimatedChecks() {
  const button = byId("run-meta");
  const token = ++animationToken;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  const rows = [...document.querySelectorAll("#checks .check-row")];
  for (const row of rows) {
    if (token !== animationToken) break;
    row.classList.add("checking");
    const spinner = document.createElement("span");
    spinner.className = "spin";
    spinner.setAttribute("aria-hidden", "true");
    spinner.textContent = "◌";
    row.querySelector(".check-icon").replaceChildren(spinner);
    row.querySelector(".check-status").textContent = "CHECKING";
    await new Promise((resolve) => setTimeout(resolve, 260));
  }
  if (token === animationToken) renderMetadata();
  button.disabled = false;
  button.removeAttribute("aria-busy");
}

async function checkLiveSource() {
  const button = byId("check-source");
  button.disabled = true;
  button.innerHTML = '<span class="spin" aria-hidden="true">◌</span> Checking source…';
  setSourcePresentation({ status: "CHECKING", title: "Requesting current conditions", text: "Contacting the public Open-Meteo endpoint…" });
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({
      latitude: "40.7128",
      longitude: "-74.0060",
      current: "temperature_2m,relative_humidity_2m,precipitation",
      timezone: "UTC",
      forecast_days: "1",
    });
    const response = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`The endpoint returned HTTP ${response.status}.`);
    const payload = await response.json();
    sourceEvidence = inspectSourceResponse(payload);
    const v = sourceEvidence.values;
    const details = `${v.temperatureC}°C  ·  ${v.relativeHumidityPct}% RH  ·  ${v.precipitationMm ?? "—"} mm precipitation`;
    setSourcePresentation({
      status: "READY",
      title: "Current source response verified",
      text: `HTTP ${response.status}. Required current fields are present and the sample timestamp is recent. This confirms response availability and shape—not the correctness of the full dataset.`,
      details: `${sourceEvidence.sampleTime} UTC  ·  ${details}`,
    });
  } catch (error) {
    sourceEvidence = { pass: false, checkedAt: new Date().toISOString(), error: error instanceof Error ? error.message : "Unknown source error" };
    setSourcePresentation({
      status: "FAIL",
      title: "Live source verification failed",
      text: `${sourceEvidence.error} Metadata results remain available, but source evidence is not passing.`,
    });
  } finally {
    button.disabled = false;
    button.innerHTML = '<span aria-hidden="true">↻</span> Check live source';
    updateEligibility();
  }
}

function issueCertificate() {
  if (!updateEligibility()) return;
  const { normalized, checks } = metadataResult;
  certificate = createCertificate({
    metadata: normalized,
    checks,
    sourceEvidence,
    controls: readControls(),
    id: `TG-${crypto.randomUUID().toUpperCase()}`,
  });
  byId("cert-panel").className = "cert-panel READY";
  byId("cert-title").textContent = "Readiness certificate issued";
  byId("cert-text").textContent = `Valid for 24 hours. Expires ${new Date(certificate.expires_at).toLocaleString()}. This is a scoped demo record, not an independent audit.`;
  byId("cert-id").textContent = certificate.certificate_id;
  byId("download").disabled = false;
  setPill("layer-cert", "ISSUED");
}

function downloadCertificate() {
  if (!certificate || !certificateIsCurrent(certificate)) {
    byId("download").disabled = true;
    return;
  }
  const blob = new Blob([`${JSON.stringify(certificate, null, 2)}\n`], { type: "application/json" });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = `${certificate.certificate_id.toLowerCase()}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

for (const id of ["owner", "description", "age", "fields"]) byId(id).addEventListener("input", renderMetadata);
controls.forEach((checkbox) => checkbox.addEventListener("change", invalidateCertificate));
byId("run-meta").addEventListener("click", runAnimatedChecks);
byId("check-source").addEventListener("click", checkLiveSource);
byId("issue").addEventListener("click", issueCertificate);
byId("download").addEventListener("click", downloadCertificate);
byId("reset").addEventListener("click", () => setScenario("ready"));
document.querySelectorAll("[data-preset]").forEach((button) => button.addEventListener("click", () => setScenario(button.dataset.preset)));

renderMetadata();
window.setInterval(() => {
  updateEligibility();
  if (certificate && !certificateIsCurrent(certificate)) {
    certificate = null;
    byId("download").disabled = true;
    byId("cert-panel").className = "cert-panel REVIEW";
    byId("cert-title").textContent = "Certificate expired";
    byId("cert-text").textContent = "Issue a new certificate after refreshing source evidence.";
    byId("cert-id").textContent = "";
    setPill("layer-cert", "EXPIRED");
  }
}, 30_000);
