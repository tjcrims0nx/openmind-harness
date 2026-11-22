"""Serve one Gemini-compatible streaming tool round trip on loopback."""
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

TOOL = "omh-runtime_omh_queue_read"


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        parts = [part for turn in request.get("contents", []) for part in turn.get("parts", [])]
        tool_results = [part["functionResponse"] for part in parts if "functionResponse" in part]
        if tool_results:
            if not any(result["name"] == TOOL for result in tool_results):
                self.send_error(400, "Expected the OMH tool result")
                return
            part = {"text": "Done."}
        else:
            names = {
                function["name"]
                for tool in request.get("tools", [])
                for function in tool.get("functionDeclarations", [])
            }
            if TOOL not in names:
                self.send_error(400, "OMH tool was not registered")
                return
            part = {"functionCall": {"name": TOOL, "args": {"path": "fixture.txt"}}}
        data = {
            "candidates": [{
                "content": {"role": "model", "parts": [part]},
                "finishReason": "STOP",
                "index": 0,
            }],
            "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 3, "totalTokenCount": 13},
        }
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        self.wfile.write(("data: " + json.dumps(data) + "\n\n").encode())


with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
    port_file = Path(sys.argv[1])
    ready = port_file.with_suffix(".tmp")
    ready.write_text(str(server.server_port))
    ready.replace(port_file)
    server.serve_forever()
