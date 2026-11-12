"""Deterministic read/patch/write of Mozilla omni.ja (zip) archives."""
from __future__ import annotations

import io
import zipfile
from typing import Callable, Dict, Optional

FIXED_DATE = (2000, 1, 1, 0, 0, 0)
STORED_EXT = (".png", ".ico", ".jpg", ".jpeg", ".webp", ".woff", ".woff2", ".xpi", ".bin", ".ja")


class Omni:
    """In-memory omni.ja editor that preserves upstream entry order."""

    def __init__(self, path: str):
        self.path = path
        with zipfile.ZipFile(path) as z:
            self.order = [i.filename for i in z.infolist()]
            self.data: Dict[str, bytes] = {n: z.read(n) for n in self.order}
        self.changed: Dict[str, str] = {}

    def read(self, name: str) -> bytes:
        return self.data[name]

    def text(self, name: str) -> str:
        return self.data[name].decode("utf-8")

    def has(self, name: str) -> bool:
        return name in self.data

    def put(self, name: str, content: bytes | str, why: str = "") -> None:
        if isinstance(content, str):
            content = content.encode("utf-8")
        if name not in self.data:
            self.order.append(name)
            self.changed[name] = "added " + why
        elif self.data[name] != content:
            self.changed[name] = "modified " + why
        self.data[name] = content

    def edit_text(self, name: str, fn: Callable[[str], str], why: str = "") -> None:
        self.put(name, fn(self.text(name)), why)

    def names(self, prefix: str = "", suffix: Optional[str] = None):
        return [n for n in self.order if n.startswith(prefix) and (suffix is None or n.endswith(suffix))]

    def save(self, path: Optional[str] = None) -> None:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            for n in self.order:
                info = zipfile.ZipInfo(n, FIXED_DATE)
                info.external_attr = (0o40755 << 16 | 0x10) if n.endswith("/") else (0o100644 << 16)
                comp = zipfile.ZIP_STORED if (n.endswith("/") or n.lower().endswith(STORED_EXT)) else zipfile.ZIP_DEFLATED
                info.compress_type = comp
                z.writestr(info, self.data[n], compress_type=comp, compresslevel=9 if comp == zipfile.ZIP_DEFLATED else None)
        with open(path or self.path, "wb") as f:
            f.write(buf.getvalue())
