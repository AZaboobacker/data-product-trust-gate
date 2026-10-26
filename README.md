# Data Product Trust Gate

TrustGate is a portfolio demo for checking whether a data product's declared metadata meets a simple readiness policy. It includes an editable, animated browser demo and a deterministic Python command-line validator.

The sample scenario is a city-weather data product. All metadata and example records are synthetic. The UI is not connected to Open-Meteo or any other live API.

## Get started: browser demo

No installation or account is needed.

1. Download or clone this repository.
2. Open `index.html` in a modern browser.
3. Edit the owner, description, refresh age, or comma-separated schema fields.
4. Watch the readiness result update as you edit.
5. Select **Issue readiness attestation** to see the checks animate in sequence.

Try these changes:

- Clear the owner to see the result become **BLOCKED**.
- Set refresh age above 24 hours to see **REVIEW**.
- Remove a few schema fields to see the required-fields check fail.
- Restore valid values to return to **READY**.

The attestation reports only whether the metadata shown in the demo passes its sample rules.

## Get started: Python validator

Requirements: Python 3.10 or newer. The validator uses only the Python standard library; no packages or virtual environment are required.

From the repository directory, run one of the sample contracts:

```bash
python3 trustgate.py examples/ready.json
python3 trustgate.py examples/review.json
python3 trustgate.py examples/blocked.json
```

On Windows, use `python` if `python3` is not available:

```powershell
python trustgate.py examples/ready.json
```

To check your own contract, copy an example JSON file and edit it, then pass its path to `trustgate.py`:

```bash
python3 trustgate.py path/to/my-product.json
```

The contract expects `product_id`, `owner`, `description`, `refreshed_at`, and `fields`. `refreshed_at` should be an ISO 8601 timestamp, such as `2026-10-26T12:00:00Z`. The sample policy requires a nonblank owner and description, a refresh within 24 hours, and at least eight named fields.

## Run the tests

```bash
python3 -m unittest discover -s tests -v
```

The tests cover ready, stale, and missing-owner contracts, plus invalid timestamps and missing contract properties.

## What the decision means

- **READY** — all declared metadata checks passed.
- **REVIEW** — freshness is missing, invalid, or older than the sample 24-hour limit, with no blocking metadata failures.
- **BLOCKED** — a required contract property, owner, description, or sufficient field list is missing.

These are demo readiness outcomes, not proof that underlying data is accurate, secure, authorized, or compliant. TrustGate does not authenticate users, grant access, or issue a regulatory or production-data certification. The browser UI and Python validator currently run separately.

## Project layout

```text
index.html              Animated editable browser demo
trustgate.py            Python metadata validator
examples/               Ready, review, and blocked JSON contracts
tests/test_trustgate.py Automated tests
```
