"""Test server: serves the repo; GET /__hang?on or ?off makes every other
request hang for 30 s, like a weak connection. Usage: python3 scripts/hang-server.py PORT"""
import http.server, time, sys, os
HANG = False
class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        global HANG
        if self.path.startswith("/__hang"):
            HANG = "on" in self.path
            self.send_response(204); self.end_headers(); return
        if HANG: time.sleep(30)
        return super().do_GET()
os.chdir(os.path.join(os.path.dirname(__file__), ".."))
http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
