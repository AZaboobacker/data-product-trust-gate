import json
import unittest
from datetime import datetime, timezone
from pathlib import Path

from trustgate import evaluate

ROOT = Path(__file__).resolve().parents[1]
NOW = datetime(2026, 10, 26, 12, tzinfo=timezone.utc)


class TrustGateTests(unittest.TestCase):
    def load(self, name):
        return json.loads((ROOT / "examples" / f"{name}.json").read_text())

    def test_ready_product_passes(self):
        result = evaluate(self.load("ready"), NOW)
        self.assertEqual(result["decision"], "READY")
        self.assertTrue(all(c["status"] == "PASS" for c in result["checks"]))

    def test_stale_product_requires_review(self):
        result = evaluate(self.load("review"), NOW)
        self.assertEqual(result["decision"], "REVIEW")
        self.assertEqual(result["checks"][3]["status"], "REVIEW")

    def test_missing_owner_blocks(self):
        result = evaluate(self.load("blocked"), NOW)
        self.assertEqual(result["decision"], "BLOCKED")
        self.assertEqual(result["checks"][1]["status"], "FAIL")

    def test_invalid_timestamp_requires_review(self):
        product = self.load("ready")
        product["refreshed_at"] = "not-a-timestamp"
        self.assertEqual(evaluate(product, NOW)["decision"], "REVIEW")

    def test_missing_contract_key_blocks(self):
        product = self.load("ready")
        del product["description"]
        self.assertEqual(evaluate(product, NOW)["decision"], "BLOCKED")


if __name__ == "__main__":
    unittest.main()
