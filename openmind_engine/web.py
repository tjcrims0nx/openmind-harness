"""Single-session workspace served on device loopback."""
import html
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock
from pathlib import Path
from urllib.parse import parse_qs

from .cli import ProviderError


def serve(session, port):
    conversation_lock = Lock()
    template = Path(__file__).with_name("workspace.html").read_text()

    class Workspace(BaseHTTPRequestHandler):
        def allowed(self):
            return self.headers.get("Host") == f"127.0.0.1:{self.server.server_port}"

        def do_GET(self):
            if not self.allowed() or self.path != "/":
                self.send_error(404)
                return
            turns = []
            for message in session.history:
                speaker = "You" if message["role"] == "user" else "OpenMind"
                turns.append(f'<article><b>{speaker}</b><p>{html.escape(message["content"])}</p></article>')
            page = template.replace("{{model}}", html.escape(session.model)).replace("{{turns}}", "".join(turns))
            body = page.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            origin = f"http://127.0.0.1:{self.server.server_port}"
            if not self.allowed() or self.headers.get("Origin") != origin or self.path != "/chat":
                self.send_error(403)
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 65536:
                    raise ValueError
                fields = parse_qs(self.rfile.read(size).decode(), max_num_fields=1)
                prompt = fields["prompt"][0].strip()
                if not prompt:
                    raise ValueError
            except (ValueError, KeyError):
                self.send_error(400, "Enter a message up to 64 KiB.")
                return
            try:
                with conversation_lock:
                    session.send(prompt)
            except ProviderError as error:
                self.send_error(502, str(error))
                return
            self.send_response(303)
            self.send_header("Location", "/#composer")
            self.end_headers()

    with ThreadingHTTPServer(("127.0.0.1", port), Workspace) as server:
        print(f"OpenMind workspace: http://127.0.0.1:{server.server_port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
    return 0
