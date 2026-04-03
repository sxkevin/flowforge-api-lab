import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from executor import execute_suite


PREFERRED_PORT = int(os.environ.get("RUNNER_PORT", "8010"))


class Handler(BaseHTTPRequestHandler):
    server_version = "FlowForgePythonRunner/0.1"

    def log_message(self, *_args):
        return

    def send_json(self, status_code, payload):
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self.send_json(200, {
                "status": "ok",
                "runtime": "python",
                "scriptLanguage": "python-with-js-lite-aliases"
            })
        return self.send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/execute-suite":
            return self.send_json(404, {"error": "not found"})

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length).decode("utf-8") if length else "{}"
            payload = json.loads(raw)
            run = execute_suite(
                payload.get("snapshot", {}),
                payload.get("suiteId"),
                payload.get("environmentId"),
                payload.get("trigger", "manual")
            )
            return self.send_json(200, run)
        except Exception as error:
            return self.send_json(400, {"error": str(error)})


def serve():
    port = PREFERRED_PORT
    while True:
        try:
            server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
            break
        except OSError as error:
            if error.errno != 48:
                raise
            if os.environ.get("RUNNER_PORT"):
                raise
            port += 1
            if port > PREFERRED_PORT + 20:
                raise RuntimeError("No available port for python runner")

    print(f"FlowForge Python runner running at http://127.0.0.1:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    serve()
