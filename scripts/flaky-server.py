"""Test server: serves the repo with HTTP range support, and (with --flaky)
breaks every third /models/ response halfway through, to test resumable
model downloads. Usage: python3 scripts/flaky-server.py PORT [--flaky]"""
import http.server, os, re, sys

FLAKY = "--flaky" in sys.argv
count = 0


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        global count
        path = self.translate_path(self.path.split("?")[0])
        rng = self.headers.get("Range")
        if "/models/" not in self.path or not os.path.isfile(path):
            return super().do_GET()
        size = os.path.getsize(path)
        start, end = 0, size - 1
        m = rng and re.match(r"bytes=(\d+)-(\d*)", rng)
        if m:
            start = int(m[1])
            end = min(int(m[2]) if m[2] else size - 1, size - 1)
        count += 1
        self.log_message = lambda *a: None
        sys.stderr.write(f"models {'range' if m else 'full'} {start}-{end} #{count}\n")
        self.send_response(206 if m else 200)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Length", str(end - start + 1))
        if m:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        with open(path, "rb") as f:
            f.seek(start)
            remaining = end - start + 1
            cut = remaining // 2 if FLAKY and count % 3 == 0 else None
            sent = 0
            while remaining:
                chunk = f.read(min(65536, remaining))
                if cut is not None and sent + len(chunk) > cut:
                    self.wfile.write(chunk[: cut - sent])
                    self.wfile.flush()
                    self.connection.shutdown(2)  # drop the connection mid-response
                    return
                self.wfile.write(chunk)
                sent += len(chunk)
                remaining -= len(chunk)


http.server.ThreadingHTTPServer(("", int(sys.argv[1])), Handler).serve_forever()
