import { evaluateMetadata, evaluatePolicy, evaluationStaleness, hasFreshPassingEvidence, inspectSourceResponse, stableFingerprint } from "./trustgate-core.mjs";

const $ = (id) => document.getElementById(id);
const evidenceChecks = [...document.querySelectorAll("#evidence-options input")];
const INITIAL_METADATA = {
  owner: "Climate Data Team",
  description: "Hourly weather data for a selected city, including temperature, humidity, and precipitation.",
  refreshAgeHours: "2",
  fields: "city, observed_at, temperature_c, humidity_pct, precipitation_mm, wind_speed_kph, weather_code, source",
};
const POLICY_KEY = "trustgate.activePolicy.v2";
let status = { mode: "demo", catalog: "Synthetic demo catalog", readOnly: true };
let policies = [];
let policy;
let mockAssets = [];
let openMetadataAssets = [];
let mockAsset;
let omAsset;
let targetSource = "mock";
let selectedAsset = null;
let sourceEvidence = null;
let evaluation = null;
let decisionCertificate = null;
let catalogChanged = false;
let animationToken = 0;

async function requestJson(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (HTTP ${response.status}).`);
  return payload;
}

function readMetadata() {
  const fields = $("fields").value.split(",").map((value) => value.trim()).filter(Boolean);
  return {
    product_id: selectedAsset?.product_id || selectedAsset?.fullyQualifiedName || "weather.city.observations",
    name: selectedAsset?.name || "City Weather Observations",
    owner: $("owner").value.trim(),
    description: $("description").value.trim(),
    refreshAgeHours: $("age").value,
    fields,
    source: selectedAsset?.source || (targetSource === "mock" ? "TrustGate synthetic catalog" : "OpenMetadata"),
    fullyQualifiedName: selectedAsset?.fullyQualifiedName || "weather.city.observations",
    updatedAt: selectedAsset?.updatedAt || "",
  };
}

function setPill(id, value) {
  const node = $(id);
  const tone = value === "ISSUED" ? "READY" : value === "EXPIRED" || value === "STALE" ? "REVIEW" : value;
  node.className = `pill${["READY", "REVIEW", "BLOCKED", "FAIL"].includes(tone) ? ` ${tone}` : ""}`;
  node.textContent = value;
}

function setSourcePresentation({ status: resultStatus, title, text, details = "" }) {
  const result = $("source-result");
  result.className = `source-result${resultStatus === "READY" ? " READY" : resultStatus === "REVIEW" ? " REVIEW" : resultStatus === "FAIL" ? " FAIL" : ""}`;
  $("source-title").textContent = title;
  $("source-text").textContent = text;
  $("source-details").textContent = details;
  $("source-badge").textContent = resultStatus === "READY" ? "Verified" : resultStatus === "FAIL" ? "Failed" : resultStatus;
  setPill("layer-source", resultStatus === "READY" ? "PASS" : resultStatus === "FAIL" ? "FAIL" : resultStatus === "REVIEW" ? "REVIEW" : "NOT RUN");
  renderCertificateAvailability();
}

function renderMetadataChecks(checks) {
  const list = $("checks");
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
    const label = document.createElement("div");
    label.className = "check-name";
    label.textContent = check.name;
    const detail = document.createElement("div");
    detail.className = "check-evidence";
    detail.textContent = check.evidence;
    copy.append(label, detail);
    const state = document.createElement("span");
    state.className = "check-status";
    state.textContent = check.status;
    row.append(icon, copy, state);
    fragment.append(row);
  }
  list.replaceChildren(fragment);
}

function renderMetadata() {
  animationToken += 1;
  const result = evaluateMetadata({ ...readMetadata(), fields: $("fields").value });
  renderMetadataChecks(result.checks);
  const { decision } = result;
  $("meta-summary").className = `meta-summary ${decision}`;
  $("summary-icon").textContent = decision === "READY" ? "✓" : decision === "REVIEW" ? "!" : "×";
  $("meta-title").textContent = `Metadata attestation: ${decision}`;
  $("meta-text").textContent = decision === "READY" ? "All sample metadata rules pass." : decision === "REVIEW" ? "The metadata is complete, but freshness needs attention." : "Resolve the blocking metadata gaps to continue.";
  $("meta-state").className = `summary-state ${decision}`;
  $("meta-state").textContent = decision;
  setPill("layer-meta", decision);
  $("age").setAttribute("aria-invalid", String(!Number.isFinite(Number($("age").value)) || Number($("age").value) < 0));
  renderEvaluation();
}

function renderEvaluation() {
  const currentMetadata = readMetadata();
  const stale = evaluationStaleness(evaluation, policy, currentMetadata);
  const banner = $("evaluation-banner");
  if (!evaluation) {
    banner.className = "evaluation-banner";
    $("evaluation-title").textContent = "No runtime evaluation yet";
    $("evaluation-message").textContent = "Choose a catalog source, then evaluate the current asset against the active policy.";
    $("evaluation-time").textContent = "Not evaluated";
    $("evaluation-id").textContent = "";
    $("policy-checks").replaceChildren();
    $("decision-reasons").innerHTML = "<li>Runtime evaluation has not been run.</li>";
    setPill("layer-cert", "NOT ISSUED");
    renderCertificateAvailability();
    return;
  }
  const shownStatus = stale.stale ? "STALE" : evaluation.status;
  banner.className = `evaluation-banner ${shownStatus}`;
  $("evaluation-title").textContent = stale.stale ? "Previous decision is stale" : `${evaluation.status}: ${policy.name}`;
  $("evaluation-message").textContent = stale.stale ? stale.reason : `Re-evaluate by ${new Date(evaluation.expires_at).toLocaleString()} to refresh the runtime decision.`;
  $("evaluation-time").textContent = new Date(evaluation.checked_at).toLocaleString();
  $("evaluation-id").textContent = evaluation.evaluation_id;
  const fragment = document.createDocumentFragment();
  for (const check of evaluation.checks) {
    const row = document.createElement("li");
    row.className = `check-row ${check.status === "BLOCKED" ? "fail" : check.status.toLowerCase()}`;
    const icon = document.createElement("span"); icon.className = "check-icon"; icon.textContent = check.status === "PASS" ? "✓" : check.status === "REVIEW" ? "!" : "×";
    const copy = document.createElement("div"); const label = document.createElement("div"); label.className = "check-name"; label.textContent = check.label;
    const detail = document.createElement("div"); detail.className = "check-evidence"; detail.textContent = check.detail; copy.append(label, detail);
    const badge = document.createElement("span"); badge.className = "check-status"; badge.textContent = check.status;
    row.append(icon, copy, badge); fragment.append(row);
  }
  $("policy-checks").replaceChildren(fragment);
  const reasons = evaluation.reasons.length ? evaluation.reasons : ["Every required check passed under the active policy."];
  const reasonNodes = reasons.map((reason) => { const li = document.createElement("li"); li.textContent = reason; return li; });
  $("decision-reasons").replaceChildren(...reasonNodes);
  setPill("layer-cert", stale.stale ? "STALE" : evaluation.status);
  renderCertificateAvailability();
}

function buildEvidence() {
  const freshSource = hasFreshPassingEvidence(sourceEvidence);
  const omSelected = targetSource === "openmetadata" && selectedAsset?.source === "OpenMetadata";
  const ttl = Math.max(1, Number(policy?.certificateTtlMinutes) || 60) * 60_000;
  const expiresAt = new Date(Date.now() + ttl).toISOString();
  return {
    metadata_snapshot: { available: true, source: "TrustGate runtime snapshot", capturedAt: new Date().toISOString(), expiresAt },
    catalog_source: { available: Boolean(selectedAsset), source: selectedAsset?.source || "No catalog asset loaded", assetId: selectedAsset?.fullyQualifiedName || "", capturedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() },
    openmetadata_read_only: { available: omSelected, source: omSelected ? "OpenMetadata read-only API" : "Not an OpenMetadata-selected asset", assetId: omSelected ? selectedAsset.fullyQualifiedName : "", capturedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() },
    live_source_check: { available: freshSource, source: sourceEvidence?.endpoint || "Open-Meteo", capturedAt: sourceEvidence?.checkedAt || "", expiresAt: sourceEvidence?.checkedAt ? new Date(Date.parse(sourceEvidence.checkedAt) + 15 * 60_000).toISOString() : "" },
  };
}

function evaluateRuntime() {
  const metadata = readMetadata();
  const evidence = buildEvidence();
  evaluation = evaluatePolicy(metadata, policy, { evidence });
  decisionCertificate = null;
  $("cert-panel").className = "cert-panel";
  $("cert-title").textContent = evaluation.status === "READY" ? "Current decision is certificate-eligible" : "No readiness certificate issued";
  $("cert-text").textContent = evaluation.status === "READY" ? "This time-stamped result is valid only under the active policy and evidence window." : "A certificate is issued only for a READY decision with all required evidence.";
  $("cert-id").textContent = "";
  renderEvaluation();
}

function renderCertificateAvailability() {
  const current = evaluation && !evaluationStaleness(evaluation, policy, readMetadata()).stale && evaluation.status === "READY";
  $("download-certificate").disabled = !current || !decisionCertificate;
  $("download-trace").disabled = !current;
}

function applyPolicyToForm() {
  $("policy-name").value = policy.name;
  $("policy-version").textContent = `v${policy.version}`;
  $("require-owner").checked = policy.metadata.requireOwner;
  $("require-description").checked = policy.metadata.requireDescription;
  $("require-schema").checked = policy.metadata.requireSchemaFields;
  $("minimum-fields").value = policy.metadata.minimumSchemaFields;
  $("maximum-age").value = policy.metadata.maximumRefreshAgeHours;
  for (const [key, selectId] of Object.entries({ owner: "outcome-owner", description: "outcome-description", schemaFields: "outcome-schemaFields", freshness: "outcome-freshness", requiredEvidence: "outcome-requiredEvidence" })) $(selectId).value = policy.failureOutcomes[key];
  evidenceChecks.forEach((input) => { input.checked = policy.requiredEvidence.includes(input.value); });
  $("certificate-ttl").value = policy.certificateTtlMinutes;
  $("policy-dirty").textContent = "Policy unchanged";
}

function readPolicyForm() {
  const next = structuredClone(policy);
  next.name = $("policy-name").value.trim() || "Untitled policy";
  next.metadata = {
    requireOwner: $("require-owner").checked,
    requireDescription: $("require-description").checked,
    requireSchemaFields: $("require-schema").checked,
    minimumSchemaFields: Math.max(0, Number($("minimum-fields").value) || 0),
    maximumRefreshAgeHours: Math.max(0, Number($("maximum-age").value) || 0),
  };
  next.failureOutcomes = {
    owner: $("outcome-owner").value,
    description: $("outcome-description").value,
    schemaFields: $("outcome-schemaFields").value,
    freshness: $("outcome-freshness").value,
    requiredEvidence: $("outcome-requiredEvidence").value,
  };
  next.requiredEvidence = evidenceChecks.filter((input) => input.checked).map((input) => input.value);
  next.certificateTtlMinutes = Math.max(1, Number($("certificate-ttl").value) || 1);
  return next;
}

function incrementVersion(version) {
  const parts = String(version || "1.0.0").split(".").map((x) => Number(x) || 0);
  parts[2] += 1;
  return parts.join(".");
}

function applyPolicy() {
  const next = readPolicyForm();
  if (!Number.isFinite(next.metadata.minimumSchemaFields) || !Number.isFinite(next.metadata.maximumRefreshAgeHours)) return;
  next.version = incrementVersion(policy.version);
  policy = next;
  localStorage.setItem(POLICY_KEY, JSON.stringify(policy));
  applyPolicyToForm();
  $("policy-dirty").textContent = "Saved locally · new policy version";
  renderEvaluation();
}

function setPolicyById(id) {
  const chosen = policies.find((item) => item.id === id);
  if (!chosen) return;
  policy = structuredClone(chosen);
  localStorage.setItem(POLICY_KEY, JSON.stringify(policy));
  applyPolicyToForm();
  renderEvaluation();
}

function resetPolicy() {
  const baseline = policies[0];
  if (!baseline) return;
  localStorage.removeItem(POLICY_KEY);
  policy = structuredClone(baseline);
  applyPolicyToForm();
  renderEvaluation();
}

function selectOptions(select, assets, placeholder) {
  select.replaceChildren();
  if (!assets.length) {
    const option = document.createElement("option"); option.value = ""; option.textContent = placeholder; select.append(option); return;
  }
  for (const asset of assets) {
    const option = document.createElement("option");
    option.value = asset.id || asset.fullyQualifiedName;
    option.textContent = asset.name || asset.fullyQualifiedName || asset.id;
    select.append(option);
  }
}

async function refreshCatalog() {
  $("refresh-catalog").disabled = true;
  $("refresh-indicator").textContent = "Refreshing…";
  try {
    const mock = await requestJson("/api/assets?source=mock");
    mockAssets = mock.assets || [];
    selectOptions($("mock-asset"), mockAssets, "No synthetic assets found");
    mockAsset = mockAssets.find((asset) => asset.id === $("mock-asset").value) || mockAssets[0];
    renderCompare();
    if (status.mode === "connected") {
      const om = await requestJson("/api/assets?source=openmetadata");
      openMetadataAssets = om.assets || [];
      selectOptions($("om-asset"), openMetadataAssets, "No tables visible to this token");
      $("om-asset").disabled = !openMetadataAssets.length;
      $("use-openmetadata").disabled = !openMetadataAssets.length;
      omAsset = openMetadataAssets.find((asset) => asset.id === $("om-asset").value || asset.fullyQualifiedName === $("om-asset").value) || openMetadataAssets[0];
      renderCompare();
      $("refresh-indicator").textContent = `${openMetadataAssets.length} assets loaded`;
    } else {
      $("om-asset").disabled = true;
      $("use-openmetadata").disabled = true;
      $("refresh-indicator").textContent = "Demo catalog loaded";
    }
    if (!selectedAsset) useAsset("mock", mockAsset, false);
  } catch (error) {
    $("refresh-indicator").textContent = "Refresh failed";
    $("mode-description").textContent = error.message;
  } finally {
    $("refresh-catalog").disabled = false;
  }
}

function compareSide(node, title, asset, fallback) {
  node.replaceChildren();
  const heading = document.createElement("h3"); heading.textContent = title; node.append(heading);
  if (!asset) { const p = document.createElement("p"); p.className = "subtle"; p.textContent = fallback; node.append(p); return; }
  const name = document.createElement("div"); name.className = "compare-asset"; name.textContent = asset.name || asset.fullyQualifiedName; node.append(name);
  const origin = document.createElement("div"); origin.className = "compare-origin"; origin.textContent = `${asset.source} · ${asset.sourceType || "asset"} · ${asset.fullyQualifiedName || asset.id}`; node.append(origin);
  const fields = [
    ["Owner", asset.owner || "Not set"],
    ["Description", asset.description || "Not set"],
    ["Fields", (asset.fields || []).join(", ") || "No schema fields"],
    ["Refresh age", asset.refreshAgeHours === "" || asset.refreshAgeHours == null ? "Unavailable" : `${asset.refreshAgeHours}h`],
    ["Updated", asset.updatedAt || "Not provided"],
    ["Evidence", (asset.sourceEvidence || []).join(" · ") || "Catalog record"],
  ];
  for (const [labelText, valueText] of fields) {
    const row = document.createElement("div"); row.className = "compare-row";
    const label = document.createElement("span"); label.textContent = labelText;
    const value = document.createElement("span"); value.textContent = valueText;
    row.append(label, value); node.append(row);
  }
}

function renderCompare() {
  compareSide($("mock-compare"), "Synthetic catalog", mockAsset, "No mock asset selected.");
  compareSide($("om-compare"), "OpenMetadata", omAsset, status.mode === "connected" ? "No OpenMetadata asset selected." : "Connected mode is off. Configure the local server to compare catalog assets.");
}

function useAsset(source, asset, refreshForm = true) {
  if (!asset) return;
  targetSource = source;
  selectedAsset = asset;
  catalogChanged = false;
  if (refreshForm) {
    $("owner").value = asset.owner || "";
    $("description").value = asset.description || "";
    $("age").value = asset.refreshAgeHours ?? "";
    $("fields").value = (asset.fields || []).join(", ");
  }
  renderMetadata();
}

function downloadJson(filename, content) {
  const blob = new Blob([`${JSON.stringify(content, null, 2)}\n`], { type: "application/json" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a"); anchor.href = href; anchor.download = filename; document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function issueDecisionCertificate() {
  if (!evaluation || evaluation.status !== "READY" || evaluationStaleness(evaluation, policy, readMetadata()).stale) return;
  decisionCertificate = {
    certificate_type: "TrustGate runtime decision record",
    certificate_id: evaluation.evaluation_id,
    decision: evaluation.status,
    policy: { id: policy.id, name: policy.name, version: policy.version, fingerprint: evaluation.policy_fingerprint },
    asset: { id: evaluation.asset.product_id, fingerprint: evaluation.asset_fingerprint, source: selectedAsset?.source || evaluation.asset.source },
    checked_at: evaluation.checked_at,
    valid_until: evaluation.expires_at,
    evidence: evaluation.evidence,
    scope: "Time-stamped portfolio-demo decision. Not a permanent certification, production control, security approval, access grant, or regulatory certification.",
  };
  $("cert-panel").className = "cert-panel READY";
  $("cert-title").textContent = "Runtime decision certificate issued";
  $("cert-text").textContent = `Valid under policy ${policy.version} until ${new Date(evaluation.expires_at).toLocaleString()}. Any policy, asset, or evidence change makes it stale.`;
  $("cert-id").textContent = evaluation.evaluation_id;
  renderCertificateAvailability();
}

async function runAnimatedChecks() {
  const button = $("run-meta"); const token = ++animationToken; button.disabled = true;
  const rows = [...document.querySelectorAll("#checks .check-row")];
  for (const row of rows) {
    if (token !== animationToken) break;
    row.classList.add("checking"); row.querySelector(".check-status").textContent = "CHECKING";
    await new Promise((resolve) => setTimeout(resolve, 240));
  }
  renderMetadata(); button.disabled = false;
}

async function checkLiveSource() {
  const button = $("check-source"); button.disabled = true; button.textContent = "Checking live source…";
  setSourcePresentation({ status: "CHECKING", title: "Requesting current conditions", text: "Contacting the public Open-Meteo endpoint…" });
  try {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.search = new URLSearchParams({ latitude: "40.7128", longitude: "-74.0060", current: "temperature_2m,relative_humidity_2m,precipitation", timezone: "UTC", forecast_days: "1" });
    const response = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`The endpoint returned HTTP ${response.status}.`);
    sourceEvidence = inspectSourceResponse(await response.json());
    setSourcePresentation({ status: "READY", title: "Current source response verified", text: `HTTP ${response.status}. Current fields are present and timestamp is recent; this is source-response evidence only.`, details: `${sourceEvidence.sampleTime} UTC · ${sourceEvidence.values.temperatureC}°C · ${sourceEvidence.values.relativeHumidityPct}% RH` });
  } catch (error) {
    sourceEvidence = { pass: false, checkedAt: new Date().toISOString(), error: error.message || "Unknown source error" };
    setSourcePresentation({ status: "FAIL", title: "Live source verification failed", text: `${sourceEvidence.error} It will not count as passing evidence.` });
  } finally { button.disabled = false; button.textContent = "↻ Check live source"; renderEvaluation(); }
}

async function init() {
  try {
    status = await requestJson("/api/status");
    const connected = status.mode === "connected";
    $("mode-banner").className = `mode-banner${connected ? " connected" : ""}`;
    $("mode-title").textContent = connected ? "Connected catalog mode · read-only" : "Demo mode · synthetic catalog";
    $("mode-label").textContent = connected ? "OPENMETADATA CONNECTED" : "DEMO MODE";
    $("mode-description").textContent = connected ? "OpenMetadata is queried by the local server. Credentials stay server-side; requests are read-only." : "No catalog credentials are configured. Use synthetic examples or configure a local OpenMetadata URL and token.";
    const received = await requestJson("/api/policies"); policies = received;
    $("policy-library").replaceChildren(...policies.map((item) => { const option = document.createElement("option"); option.value = item.id; option.textContent = item.name; return option; }));
    const saved = localStorage.getItem(POLICY_KEY);
    try { policy = saved ? JSON.parse(saved) : structuredClone(policies[0]); } catch { policy = structuredClone(policies[0]); }
    applyPolicyToForm();
    await refreshCatalog();
  } catch (error) {
    $("mode-title").textContent = "Local TrustGate server required";
    $("mode-description").textContent = `${error.message} Start the app with python3 app.py.`;
    $("mode-label").textContent = "SERVER ERROR";
  }
}

for (const id of ["owner", "description", "age", "fields"]) $(id).addEventListener("input", renderMetadata);
$("run-meta").addEventListener("click", runAnimatedChecks);
$("reset").addEventListener("click", () => useAsset("mock", mockAssets[0]));
$("check-source").addEventListener("click", checkLiveSource);
$("evaluate-runtime").addEventListener("click", evaluateRuntime);
$("download-certificate").addEventListener("click", () => { if (decisionCertificate) downloadJson(`${evaluation.evaluation_id.toLowerCase()}-certificate.json`, decisionCertificate); });
$("download-trace").addEventListener("click", () => { if (evaluation && !evaluationStaleness(evaluation, policy, readMetadata()).stale) downloadJson(`${evaluation.evaluation_id.toLowerCase()}-decision-trace.json`, { trace_type: "TrustGate decision trace", exported_at: new Date().toISOString(), active_policy: policy, runtime_evaluation: evaluation, certificate: decisionCertificate }); });
$("mock-asset").addEventListener("change", () => { mockAsset = mockAssets.find((asset) => asset.id === $("mock-asset").value); renderCompare(); });
$("om-asset").addEventListener("change", () => { omAsset = openMetadataAssets.find((asset) => asset.id === $("om-asset").value || asset.fullyQualifiedName === $("om-asset").value); renderCompare(); });
$("use-openmetadata").addEventListener("click", () => useAsset("openmetadata", omAsset));
$("refresh-catalog").addEventListener("click", refreshCatalog);
$("apply-policy").addEventListener("click", applyPolicy);
$("reset-policy").addEventListener("click", resetPolicy);
$("policy-library").addEventListener("change", () => setPolicyById($("policy-library").value));
for (const input of document.querySelectorAll("#policy-name,#require-owner,#require-description,#require-schema,#minimum-fields,#maximum-age,#outcome-owner,#outcome-description,#outcome-schemaFields,#outcome-freshness,#outcome-requiredEvidence,#certificate-ttl,#evidence-options input")) input.addEventListener("input", () => { $("policy-dirty").textContent = "Unsaved edits · apply to activate"; });
for (const input of document.querySelectorAll("#policy-name,#require-owner,#require-description,#require-schema,#minimum-fields,#maximum-age,#outcome-owner,#outcome-description,#outcome-schemaFields,#outcome-freshness,#outcome-requiredEvidence,#certificate-ttl,#evidence-options input")) input.addEventListener("change", () => { $("policy-dirty").textContent = "Unsaved edits · apply to activate"; });
window.setInterval(async () => {
  if (status.mode !== "connected" || targetSource !== "openmetadata" || !selectedAsset?.fullyQualifiedName) return;
  try {
    const fresh = await requestJson(`/api/assets?source=openmetadata&id=${encodeURIComponent(selectedAsset.fullyQualifiedName)}`);
    const next = fresh.asset;
    if (next && stableFingerprint(next) !== stableFingerprint(selectedAsset)) {
      omAsset = next; selectedAsset = next; openMetadataAssets = openMetadataAssets.map((asset) => asset.fullyQualifiedName === next.fullyQualifiedName ? next : asset);
      catalogChanged = true; $("refresh-indicator").textContent = "Catalog changed · reload asset"; renderCompare(); renderEvaluation();
    }
  } catch { /* Keep last snapshot visible; manual refresh surfaces connection errors. */ }
}, 30_000);
window.setInterval(() => { renderEvaluation(); }, 15_000);
init();
