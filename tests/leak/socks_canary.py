"""A logging SOCKS5 server that answers every CONNECT with a canned HTTP page.

It stands in for Tor's SOCKS port so leak tests can run without network
access: every request the browser makes *through the proxy* is recorded with
its address type, which tells us whether DNS was resolved remotely (domain
names, ATYP=3) or locally (raw IPs, ATYP=1/4 -> DNS leak).
"""
import socket
import socketserver
import threading

PAGE = b"""<!doctype html><html><head><title>canary</title>
<link rel="dns-prefetch" href="//prefetch-leak.example">
<link rel="preconnect" href="http://preconnect-leak.example">
</head><body>canary
<img src="http://img-leak.example/x.png">
<script>
try { fetch('http://fetch-leak.example/f'); } catch(e) {}
try { new WebSocket('ws://ws-leak.example/'); } catch(e) {}
try { const pc = new RTCPeerConnection({iceServers:[{urls:'stun:stun-leak.example:3478'}]}); pc.createDataChannel('x'); pc.createOffer().then(o=>pc.setLocalDescription(o)); } catch(e) { document.title='nortc'; }
</script></body></html>"""


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        s = self.request
        s.settimeout(5)
        try:
            head = s.recv(2)
            if len(head) < 2 or head[0] != 5:
                return
            methods = s.recv(head[1])
            user = None
            if 2 in methods:  # username/password: Tor Browser's stream-isolation credentials
                s.sendall(b"\x05\x02")
                ver = s.recv(1)
                ulen = s.recv(1)[0]
                user = s.recv(ulen).decode(errors="replace")
                s.recv(s.recv(1)[0])
                s.sendall(b"\x01\x00")
            else:
                s.sendall(b"\x05\x00")
            req = s.recv(4)
            atyp = req[3]
            if atyp == 1:
                host = socket.inet_ntoa(s.recv(4))
            elif atyp == 3:
                host = s.recv(s.recv(1)[0]).decode()
            elif atyp == 4:
                host = socket.inet_ntop(socket.AF_INET6, s.recv(16))
            else:
                return
            port = int.from_bytes(s.recv(2), "big")
            self.server.log.append({"atyp": atyp, "host": host, "port": port, "user": user})
            s.sendall(b"\x05\x00\x00\x01\x7f\x00\x00\x01\x00\x00")
            s.recv(65536)
            body = PAGE
            s.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: %d\r\nConnection: close\r\n\r\n" % len(body) + body)
        except Exception:
            pass


class Canary(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self):
        super().__init__(("127.0.0.1", 0), Handler)
        self.log = []
        self.port = self.server_address[1]
        self.thread = threading.Thread(target=self.serve_forever, daemon=True)
        self.thread.start()

    def stop(self):
        self.shutdown()
        self.server_close()
