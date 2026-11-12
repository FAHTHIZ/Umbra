"""Watch every socket opened by browser processes via /proc (Linux).

Records the remote endpoint of each TCP/UDP socket owned by any process whose
executable lives inside the app directory. Anything that is not loopback is a
direct-connection leak (traffic that bypassed the Tor SOCKS proxy).
"""
import ipaddress
import os
import threading
import time


def _parse(path, proto):
    out = {}
    try:
        lines = open(path).read().splitlines()[1:]
    except OSError:
        return out
    for l in lines:
        f = l.split()
        rem, inode = f[2], f[9]
        ip_hex, port_hex = rem.split(":")
        b = bytes.fromhex(ip_hex)
        if len(b) == 4:
            ip = ipaddress.IPv4Address(b[::-1])
        else:
            ip = ipaddress.IPv6Address(b"".join(b[i:i + 4][::-1] for i in range(0, 16, 4)))
        out[inode] = (proto, str(ip), int(port_hex, 16))
    return out


def _is_local(ip):
    a = ipaddress.ip_address(ip)
    if isinstance(a, ipaddress.IPv6Address) and a.ipv4_mapped:
        a = a.ipv4_mapped
    return a.is_loopback or a.is_unspecified


class SockMon:
    """Note: watches *every* process running from app_dir, so stray instances
    left by an earlier crashed run are watched too (which only makes the leak
    tests stricter)."""

    def __init__(self, app_dir, interval=0.02):
        self.app = os.path.realpath(app_dir)
        self.interval = interval
        self.seen = set()
        self.pids = set()
        self._stop = threading.Event()
        self.t = threading.Thread(target=self._run, daemon=True)

    def _browser_pids(self):
        for p in os.listdir("/proc"):
            if p.isdigit():
                try:
                    if os.path.realpath(f"/proc/{p}/exe").startswith(self.app):
                        yield p
                except OSError:
                    pass

    def _scan(self):
        pids = list(self._browser_pids())
        self.pids.update(pids)
        inodes = set()
        for p in pids:
            try:
                for fd in os.listdir(f"/proc/{p}/fd"):
                    try:
                        l = os.readlink(f"/proc/{p}/fd/{fd}")
                    except OSError:
                        continue
                    if l.startswith("socket:["):
                        inodes.add(l[8:-1])
            except OSError:
                pass
        if not inodes:
            return
        table = {}
        for proto in ("tcp", "tcp6", "udp", "udp6"):
            table.update(_parse(f"/proc/net/{proto}", proto))
        for i in inodes:
            if i in table:
                proto, ip, port = table[i]
                if not (ip in ("0.0.0.0", "::") and port == 0):
                    self.seen.add((proto, ip, port))

    def _run(self):
        while not self._stop.is_set():
            self._scan()
            time.sleep(self.interval)

    def start(self):
        self.t.start()
        return self

    def stop(self):
        self._stop.set()
        self.t.join()
        self._scan()

    def leaks(self):
        return sorted(s for s in self.seen if not _is_local(s[1]))
