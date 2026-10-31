import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen
from unittest.mock import patch

import trustgate_server as app


class OpenMetadataAdapterTests(unittest.TestCase):
    def test_asset_mapping_preserves_evidence_fields(self):
        with patch.object(app, "_api_get", side_effect=[
            {"version": "2.0.7"},
            {"data": [{"id": "t1", "name": "Claims", "fullyQualifiedName": "sample.claims",
                       "description": "Synthetic claims", "owners": [{"name": "team", "displayName": "Claims Team"}],
                       "columns": [{"name": "claim_id"}, {"name": "status"}], "updatedAt": 1790000000000}]},
        ]) as get:
            version, assets = app.list_assets("https://sandbox.open-metadata.org", "safe-test-token")
        self.assertEqual(version, "2.0.7")
        self.assertEqual(assets[0]["fullyQualifiedName"], "sample.claims")
        self.assertEqual(assets[0]["owner"], "Claims Team")
        self.assertEqual(assets[0]["fields"], ["claim_id", "status"])
        self.assertTrue(assets[0]["updatedAt"].endswith("+00:00"))
        self.assertEqual(get.call_count, 2)
        self.assertNotIn("safe-test-token", repr(assets))

    def test_api_get_sends_bearer_token_and_handles_auth_failure(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def read(self): return b'{"version":"2.0.7"}'
        with patch.object(app, "urlopen", return_value=Response()) as open_url:
            self.assertEqual(app._api_get("https://catalog.example", "/api/v1/system/version", "abc"), {"version": "2.0.7"})
            self.assertEqual(open_url.call_args.args[0].get_header("Authorization"), "Bearer abc")
        from urllib.error import HTTPError
        with patch.object(app, "urlopen", side_effect=HTTPError("url", 401, "unauthorized", {}, None)):
            with self.assertRaisesRegex(PermissionError, "valid access token"):
                app._api_get("https://catalog.example", "/api/v1/tables", "bad")

    def test_local_http_connect_flow_never_persists_token(self):
        assets = [{"id": "t1", "name": "Claims", "fullyQualifiedName": "sample.claims", "description": "D", "owner": "Team", "fields": ["id"], "updatedAt": None}]
        with patch.object(app, "list_assets", return_value=("2.0.7", assets)):
            server = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                url = f"http://127.0.0.1:{server.server_port}"
                request = Request(url + "/api/catalog/connect", data=json.dumps({"baseUrl": "https://sandbox.open-metadata.org", "token": "test-token"}).encode(), headers={"Content-Type": "application/json"}, method="POST")
                with urlopen(request) as response:
                    payload = json.load(response)
                self.assertTrue(payload["connected"])
                self.assertEqual(payload["assets"][0]["id"], "t1")
                self.assertNotIn("token", json.dumps(payload).lower())
                with urlopen(url + "/api/catalog/status") as response:
                    self.assertTrue(json.load(response)["connected"])
                with urlopen(url + "/api/health") as response:
                    self.assertTrue(json.load(response)["ok"])
                missing_token = Request(url + "/api/catalog/connect", data=b'{"baseUrl":"https://sandbox.open-metadata.org","token":""}', headers={"Content-Type": "application/json"}, method="POST")
                with self.assertRaises(Exception) as error:
                    urlopen(missing_token)
                self.assertIn("400", str(error.exception))
            finally:
                server.shutdown()
                server.server_close()
                app.connection = None


if __name__ == "__main__":
    unittest.main()
