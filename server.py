#!/usr/bin/env python3
import http.server
import socketserver
import mimetypes

PORT = 8889

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        super().end_headers()

# 确保CSS MIME类型正确
mimetypes.add_type('text/css', '.css')
mimetypes.add_type('application/javascript', '.js')

with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
    print(f"Serving at http://0.0.0.0:{PORT}")
    httpd.serve_forever()
