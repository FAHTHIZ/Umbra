"""Prove the leak detector itself works (so a passing leak test means something)."""
import os
import shutil
import socket
import subprocess
import sys
import time

import pytest

from tests.leak.sockmon import SockMon

pytestmark = pytest.mark.skipif(not sys.platform.startswith("linux"), reason="Linux only")


def test_monitor_detects_direct_outbound_connection(tmp_path):
    srv = socket.socket()
    srv.bind(("0.0.0.0", 0))
    srv.listen(1)
    port = srv.getsockname()[1]
    # A non-loopback local address stands in for "the internet".
    ext_ip = socket.gethostbyname(socket.gethostname())
    if ext_ip.startswith("127."):
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("10.255.255.255", 1))
            ext_ip = s.getsockname()[0]
        finally:
            s.close()
    if ext_ip.startswith("127."):
        pytest.skip("no non-loopback interface")
    fake_app = tmp_path / "app"
    fake_app.mkdir()
    py = fake_app / "python"
    shutil.copy(sys.executable, py)
    os.chmod(py, 0o755)
    mon = SockMon(str(fake_app)).start()
    code = f"import socket,time;s=socket.create_connection(('{ext_ip}',{port}));time.sleep(1.0)"
    p = subprocess.Popen([str(py), "-c", code], env=dict(os.environ, PYTHONHOME=sys.base_prefix,
                                                         PYTHONPATH=os.pathsep.join(sys.path)))
    conn, _ = srv.accept()
    p.wait(10)
    time.sleep(0.1)
    mon.stop()
    conn.close()
    srv.close()
    assert (("tcp", ext_ip, port) in mon.leaks()), f"monitor missed a direct connection: {mon.seen}"
