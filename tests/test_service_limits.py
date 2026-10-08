"""Protect synchronous work and spreadsheet exports without changing equations."""
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from threading import Event
import warnings

from fastapi.testclient import TestClient
from pypdf import PdfReader
import pytest

import main


def send(client, path, content, **params):
    return client.post(path, params=params, files={"file": ("input.csv", content)})


@pytest.mark.parametrize("path", ["/preview", "/convert"])
@pytest.mark.parametrize("case,detail", [
    ("years", "yearly rows"), ("columns", "value columns"), ("cells", "monthly values"),
])
def test_oversized_work_never_reaches_solver(monkeypatch, path, case, detail):
    def unexpected(*args, **kwargs):
        pytest.fail("Oversized input must be rejected before smoothing")
    monkeypatch.setattr(main, "smooth_average", unexpected)
    monkeypatch.setattr(main, "smooth_exit", unexpected)
    if case == "years":
        content = "year,value\n" + "".join(f"{i},6\n" for i in range(1, 102))
    else:
        columns = 21 if case == "columns" else 20
        years = 1 if case == "columns" else 51
        content = "year," + ",".join(f"series{i}" for i in range(columns)) + "\n"
        content += "".join(f"{i}," + ",".join(["6"] * columns) + "\n" for i in range(1, years + 1))
    with TestClient(main.app) as client:
        response = send(client, path, content, mode="average")
    assert response.status_code == 413
    assert detail in response.json()["detail"]


@pytest.mark.parametrize("path", ["/preview", "/convert"])
def test_upload_read_is_bounded_and_size_limit_is_shared(monkeypatch, path):
    monkeypatch.setattr(main, "MAX_UPLOAD_BYTES", 32)
    with TestClient(main.app) as client:
        response = send(client, path, b"x" * 33, mode="exit")
        assert response.status_code == 413
        assert send(client, path, b"year,value\n1,6\n", mode="exit").status_code == 200


@pytest.mark.parametrize("path", ["/preview", "/convert"])
def test_workload_boundary_is_accepted(path):
    # Exactly 12,000 generated numeric values and all 20 allowed series.
    content = "year," + ",".join(f"s{i}" for i in range(20)) + "\n"
    content += "".join(f"{year}," + ",".join(["6"] * 20) + "\n" for year in range(1, 51))
    with TestClient(main.app) as client:
        response = send(client, path, content, mode="average", format="json")
    assert response.status_code == 200
    assert len(response.json()["rows"] if path == "/preview" else response.json()) == (50 if path == "/preview" else 600)


@pytest.mark.parametrize("header", ["=1+1", "+SUM(1)", "-SUM(1)", "@SUM(1)", "x\tname", "x\nname", "X" * 201])
@pytest.mark.parametrize("path", ["/preview", "/convert"])
def test_unsafe_or_unrenderable_headers_return_clear_error(path, header):
    # Quoting must not bypass the shared header checks.
    content = f'year,"{header}"\n1,6\n'
    with TestClient(main.app, raise_server_exceptions=False) as client:
        response = send(client, path, content, mode="average", format="pdf")
    assert response.status_code == 400
    assert "Column names" in response.json()["detail"]


def test_maximum_length_literal_header_still_renders_pdf():
    with warnings.catch_warnings(record=True) as caught, TestClient(main.app) as client:
        warnings.simplefilter("always")
        response = send(client, "/convert", "year," + "X" * 200 + "\n1,6\n", mode="exit", format="pdf")
    assert response.status_code == 200
    assert response.content.startswith(b"%PDF")
    assert PdfReader(BytesIO(response.content)).pages
    assert not any("axes sizes collapsed" in str(item.message) for item in caught)


def test_busy_conversion_rejects_overlap_but_keeps_preview_and_health_available(monkeypatch):
    entered, release = Event(), Event()
    original = main.yearly_to_monthly
    def blocked(*args, **kwargs):
        entered.set()
        assert release.wait(10), "Test did not release the calculation"
        return original(*args, **kwargs)
    monkeypatch.setattr(main, "yearly_to_monthly", blocked)
    with TestClient(main.app) as client, ThreadPoolExecutor(max_workers=1) as pool:
        first = pool.submit(send, client, "/convert", "year,value\n1,6\n", mode="average")
        try:
            assert entered.wait(10)
            response = send(client, "/convert", "year,value\n1,6\n", mode="exit")
            assert response.status_code == 503
            assert response.headers["Retry-After"] == "3"
            assert client.get("/health").json() == {"status": "ok"}
            assert send(client, "/preview", "year,value\n1,6\n").status_code == 200
        finally:
            release.set()
        assert first.result(timeout=10).status_code == 200
        assert send(client, "/convert", "year,value\n1,6\n", mode="exit").status_code == 200


def test_capacity_is_released_after_validation_and_export_errors(monkeypatch):
    with TestClient(main.app, raise_server_exceptions=False) as client:
        assert send(client, "/convert", "year,value\n1,bad\n", mode="average").status_code == 400
        def broken_export(*args, **kwargs):
            raise RuntimeError("simulated renderer failure")
        monkeypatch.setattr(main, "to_pdf_response", broken_export)
        assert send(client, "/convert", "year,value\n1,6\n", mode="average", format="pdf").status_code == 500
        assert send(client, "/convert", "year,value\n1,6\n", mode="average").status_code == 200


def test_security_headers_and_analysis_cache_policy():
    with TestClient(main.app) as client:
        home = client.get("/")
        assert home.headers["x-content-type-options"] == "nosniff"
        assert home.headers["x-frame-options"] == "DENY"
        assert "frame-ancestors 'none'" in home.headers["content-security-policy"]
        for path in ("/preview", "/convert"):
            response = send(client, path, "year,value\n1,6\n", mode="average")
            assert response.headers["cache-control"] == "no-store"
        # Swagger needs its own scripts; the workspace CSP must not break it.
        assert "content-security-policy" not in client.get("/docs").headers


@pytest.mark.parametrize("path", ["/preview", "/convert"])
@pytest.mark.parametrize("year", ["1e5000", "1e999999999", "9007199254740992", "-9007199254740992"])
def test_giant_year_identifiers_are_rejected_before_integer_expansion(path, year):
    with TestClient(main.app, raise_server_exceptions=False) as client:
        response = send(client, path, f"year,value\n{year},6\n", mode="exit")
    assert response.status_code == 400
    assert "integer values within" in response.json()["detail"]


@pytest.mark.parametrize("year", [-9007199254740991, 9007199254740991])
def test_safe_year_identifier_boundary_remains_exact(year):
    with TestClient(main.app) as client:
        content = f"year,value\n{year},6\n"
        preview = send(client, "/preview", content)
        output = send(client, "/convert", content, mode="exit", format="json")
    assert preview.status_code == output.status_code == 200
    assert preview.json()["rows"][0]["year"] == year
    assert output.json()[0]["year"] == year
