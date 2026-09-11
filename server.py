#!/usr/bin/env python3
"""本地服务：托管静态页 + 代理 arXiv / S2（解决浏览器 CORS / 限流）。

用法:
  python server.py
  浏览器打开 http://127.0.0.1:8765
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
# Render 等托管平台会注入 PORT 环境变量；本地默认 8765
PORT = int(os.environ.get("PORT", "8765"))
# 线上必须绑定 0.0.0.0 才能被反向代理访问；本地仅监听 127.0.0.1
HOST = "0.0.0.0" if os.environ.get("PORT") else "127.0.0.1"
UA = "lit-intent-search/1.0 (local prototype)"


def _http_get(url: str, timeout: int = 25) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send(self, code: int, body: bytes, ctype: str = "application/json; charset=utf-8") -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        if path == "/api/health":
            self._send(200, json.dumps({"ok": True}).encode())
            return

        if path == "/api/arxiv":
            q = (qs.get("q") or [""])[0].strip()
            limit = int((qs.get("limit") or ["5"])[0])
            if not q:
                self._send(400, json.dumps({"error": "q required"}).encode())
                return
            url = (
                "https://export.arxiv.org/api/query?"
                + urllib.parse.urlencode(
                    {
                        "search_query": f"all:{q}",
                        "start": 0,
                        "max_results": max(1, min(limit, 20)),
                        "sortBy": "relevance",
                        "sortOrder": "descending",
                    }
                )
            )
            try:
                body = _http_get(url)
                self._send(200, body, "application/atom+xml; charset=utf-8")
            except Exception as e:  # noqa: BLE001
                self._send(502, json.dumps({"error": str(e)}).encode())
            return

        if path == "/api/s2":
            q = (qs.get("q") or [""])[0].strip()
            limit = int((qs.get("limit") or ["5"])[0])
            if not q:
                self._send(400, json.dumps({"error": "q required"}).encode())
                return
            url = (
                "https://api.semanticscholar.org/graph/v1/paper/search?"
                + urllib.parse.urlencode(
                    {
                        "query": q,
                        "limit": max(1, min(limit, 20)),
                        "fields": "title,abstract,year,url,externalIds,citationCount,authors,venue",
                    }
                )
            )
            try:
                body = _http_get(url)
                self._send(200, body)
            except urllib.error.HTTPError as e:
                self._send(e.code, json.dumps({"error": f"S2 HTTP {e.code}"}).encode())
            except Exception as e:  # noqa: BLE001
                self._send(502, json.dumps({"error": str(e)}).encode())
            return

        if path == "/api/translate":
            text = (qs.get("text") or [""])[0].strip()
            if not text:
                self._send(400, json.dumps({"error": "text required"}).encode())
                return
            # 限制长度，避免上游拒绝
            if len(text) > 1500:
                text = text[:1500]
            url = (
                "https://translate.googleapis.com/translate_a/single?"
                + urllib.parse.urlencode(
                    {
                        "client": "dict-chrome-ex",
                        "sl": "en",
                        "tl": "zh-CN",
                        "dt": "t",
                        "q": text,
                    }
                )
            )
            try:
                raw = _http_get(url, timeout=20)
                data = json.loads(raw.decode("utf-8"))
                zh = ""
                if isinstance(data, list) and data and isinstance(data[0], list):
                    parts = []
                    for seg in data[0]:
                        if isinstance(seg, list) and seg and isinstance(seg[0], str):
                            parts.append(seg[0])
                    zh = "".join(parts)
                self._send(200, json.dumps({"zh": zh}, ensure_ascii=False).encode())
            except urllib.error.HTTPError as e:
                self._send(e.code, json.dumps({"error": f"translate HTTP {e.code}"}).encode())
            except Exception as e:  # noqa: BLE001
                self._send(502, json.dumps({"error": str(e)}).encode())
            return

        # 静态文件
        return super().do_GET()


def main() -> None:
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"文献意图检索: http://{HOST}:{PORT}")
    print(f"静态目录: {ROOT}")
    print("Ctrl+C 退出")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")


if __name__ == "__main__":
    main()
