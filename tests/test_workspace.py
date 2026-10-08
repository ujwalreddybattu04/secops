"""Verify the workspace serves its assets and shares conversion input validation."""
import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_workspace_and_sample_are_served():
    response = client.get("/")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    for asset in ["workspace.css", "workspace.js", "adoption-sample.csv"]:
        assert client.get("/assets/" + asset).status_code == 200
    sample = client.get("/assets/adoption-sample.csv").content
    preview = client.post("/preview", files={"file": ("sample.csv", sample)})
    assert preview.status_code == 200
    assert len(preview.json()["rows"]) == 13
    for mode in ["average", "exit"]:
        result = client.post("/convert", params={"mode": mode, "format": "json"}, files={"file": ("sample.csv", sample)})
        assert result.status_code == 200
        assert len(result.json()) == 156


def test_preview_preserves_names_and_numeric_targets_without_smoothing():
    response = client.post("/preview", files={"file": ("input.csv", " Year ,采用率,$notacommand$\r2023,8%,14\r2022,6,10%".encode())})
    assert response.status_code == 200
    assert response.json() == {"columns": ["采用率", "$notacommand$"], "rows": [
        {"year": 2022, "采用率": 6.0, "$notacommand$": 10.0},
        {"year": 2023, "采用率": 8.0, "$notacommand$": 14.0},
    ]}


@pytest.mark.parametrize("content,detail", [
    (b"year,value\n2022,abc%\n", "numeric"),
    (b"year,value\n2022,6\n2022,8\n", "Duplicate years"),
    (b"year,value\n2022,6\n2024,8\n", "consecutive"),
    (b"year,Value,value\n2022,6,8\n", "Duplicate column"),
    (b"year,value\n", "at least one data row"),
    (b"value\n6\n", "Missing required"),
])
def test_preview_uses_existing_validation(content, detail):
    response = client.post("/preview", files={"file": ("input.csv", content)})
    assert response.status_code == 400
    assert detail in response.json()["detail"]


def test_preview_windows_encoding_and_size_limit():
    response = client.post("/preview", files={"file": ("input.csv", "year,Slow – adoption\r2022,6%\r".encode("cp1252"))})
    assert response.status_code == 200
    assert response.json()["columns"] == ["Slow – adoption"]
    assert client.post("/preview", files={"file": ("input.csv", b"x" * (10 * 1024 * 1024 + 1))}).status_code == 413
    assert client.post("/preview", files={"file": ("input.xlsx", b"year,value\n2022,6\n")}).status_code == 400
