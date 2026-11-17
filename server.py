#!/usr/bin/env python3
"""Serve only Lamp Studio assets on loopback; no installs or cloud service."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
import argparse
import subprocess
import sys
import threading
import webbrowser

ROOT = Path(__file__).resolve().parent
class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        name = unquote(urlsplit(path).path).lstrip('/')
        base = ROOT if name.startswith('firmware/') else ROOT / 'app'
        target = (base / (name or 'index.html')).resolve()
        if not target.is_relative_to(base.resolve()):
            return str(ROOT / '__not_found__')
        return str(target)
    def list_directory(self, path):
        self.send_error(403, 'Directory listing disabled')
        return None
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--no-open', action='store_true')
    args = parser.parse_args()
    server = None
    for port in range(args.port, args.port + 1):
        try:
            server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
            break
        except OSError:
            continue
    if server is None:
        raise SystemExit('Lamp Studio port is in use. Open http://localhost:8765 if already running, or close its previous Terminal and restart. A fixed address keeps your audio library available.')
    url = f'http://localhost:{server.server_port}'
    print(f'Lamp Studio: {url}\nKeep this terminal open. Press Control-C to stop.', flush=True)
    if not args.no_open:
        def launch():
            if sys.platform == 'darwin':
                for browser in ('Google Chrome', 'Microsoft Edge'):
                    result = subprocess.run(['open', '-a', browser, url], capture_output=True)
                    if result.returncode == 0:
                        return
            webbrowser.open(url)
        threading.Timer(.3, launch).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
if __name__ == '__main__':
    main()
