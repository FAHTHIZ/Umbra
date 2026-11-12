

def test_gpg_path_msys_conversion(monkeypatch):
    import tools.umbra_build.verify as v
    monkeypatch.setattr(v, "_MSYS", True)
    monkeypatch.setattr(v.os.path, "abspath", lambda p: p)
    assert v.gpg_path("D:\\a\\Umbra\\x.asc") == "/d/a/Umbra/x.asc"
    monkeypatch.setattr(v, "_MSYS", False)
    assert v.gpg_path("/tmp/x") == "/tmp/x"
