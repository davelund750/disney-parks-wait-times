#!/usr/bin/env python3
"""Tell an open Chromium tab to load a URL, via Chromium's DevTools protocol.

Usage: kiosk_navigate.py <debug-port> <tab-id> <url>

Used by kiosk.sh to un-stick a tab that never loaded, the same way pressing
Ctrl+R does by hand. It navigates the existing tab rather than opening a new
one, so the kiosk window stays as it is.

Standard library only, so this is a bare-bones WebSocket client: just enough to
send one command and read the reply.
"""

import base64
import json
import os
import socket
import struct
import sys


def main():
    port, tab_id, url = int(sys.argv[1]), sys.argv[2], sys.argv[3]

    sock = socket.create_connection(("127.0.0.1", port), timeout=5)
    key = base64.b64encode(os.urandom(16)).decode()
    sock.sendall(
        (
            f"GET /devtools/page/{tab_id} HTTP/1.1\r\n"
            f"Host: 127.0.0.1:{port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        ).encode()
    )

    response = b""
    while b"\r\n\r\n" not in response:
        chunk = sock.recv(4096)
        if not chunk:
            sys.exit("connection closed during handshake")
        response += chunk
    status_line = response.split(b"\r\n", 1)[0].decode()
    if " 101 " not in status_line:
        sys.exit(f"handshake failed: {status_line}")
    reply = response.split(b"\r\n\r\n", 1)[1]

    # Clients must send masked frames (RFC 6455).
    message = json.dumps({"id": 1, "method": "Page.navigate", "params": {"url": url}}).encode()
    mask = os.urandom(4)
    header = bytes([0x81])  # final frame, text
    if len(message) < 126:
        header += bytes([0x80 | len(message)])
    else:
        header += bytes([0x80 | 126]) + struct.pack(">H", len(message))
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(message))
    sock.sendall(header + mask + masked)

    # The reply is a small unmasked frame; its JSON payload carries our id.
    while b'"id":1' not in reply:
        chunk = sock.recv(4096)
        if not chunk:
            sys.exit("connection closed before reply")
        reply += chunk
    sock.close()

    payload = reply[reply.index(b"{"):].decode(errors="replace")
    if '"error"' in payload:
        sys.exit(f"navigate failed: {payload}")
    print("navigate sent")


if __name__ == "__main__":
    main()
