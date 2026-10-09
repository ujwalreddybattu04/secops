"""Check review claims independently of the UI and existing solver checks."""
from decimal import Decimal, localcontext
import json
from pathlib import Path
import time

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from main import app, yearly_to_monthly, _conversion_capacity
from curve_review import turning_points, sharp_changes, calculation_settings

client = TestClient(app)


def upload(path, content, **params):
    return client.post(path, params=params, files={"file": ("input.csv", content)})


@pytest.mark.parametrize("mode", ["average", "exit"])
def test_review_matches_exports_and_independently_verified_raw_constraints(mode):
    content = b"year,Slow,Moderate,Fast\n" + b"".join(
        f"{i+1},{a},{b},{c}\n".encode() for i, (a, b, c) in enumerate(zip(
            [1,4,10,20,33,48,64,79,92,100], [4,14,30,50,68,82,91,96,99,100],
            [8,25,48,68,83,92,97,99,99.8,100])))
    response = upload("/review", content, mode=mode)
    assert response.status_code == 200
    report = response.json()
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["X-Calculation-Engine"] == report["engine"]["id"]
    source = pd.DataFrame(report["source"]["rows"])
    for method in ["average", "exit"]:
        reviewed = report["methods"][method]
        assert reviewed["rows"] == upload("/convert", content, mode=method, format="json").json()
        raw = yearly_to_monthly(source, method)
        assert all(reviewed["validation"].values())
        for item in reviewed["series"]:
            assert item["first_month_passed"]
            assert item["monthly_min"] == raw[item["column"]].min()
            assert item["monthly_max"] == raw[item["column"]].max()
            if method == "average":
                assert Decimal(item["above_range"]) < Decimal("0.8")
                assert Decimal(item["below_range"]) < Decimal("0.8")
            for index, check in enumerate(item["annual_checks"]):
                block = raw[item["column"]].iloc[index*12:index*12+12]
                with localcontext() as context:
                    context.prec = 800
                    mean = sum((Decimal(str(v)) for v in block), Decimal(0))/12
                    assert Decimal(check["raw_mean"]) == mean
                    actual = mean if method == "average" else Decimal(str(block.iloc[-1]))
                    assert Decimal(check["raw_error"]) == abs(actual-Decimal(str(check["target"])))
                    assert Decimal(check["raw_error"]) < Decimal(check["tolerance"])


@pytest.mark.parametrize("values,expected", [
    ([7,7,7,7], []), ([1,2,3,4], []), ([4,3,2,1], []),
    ([1,2,3,2,1], [("peak",2,2)]),
    ([1,3,3,3,1,1,2], [("peak",1,3),("trough",4,5)]),
    ([-5,-3,-1,-4], [("peak",2,2)]),
    ([1,2,3,3-1e-11,4], []),
])
def test_turns_flat_plateaus_negative_values_and_noise(values, expected):
    points = turning_points(values, [{"month": i+1} for i in range(len(values))])
    assert [(p["kind"],p["index"],p["end_index"]) for p in points] == expected


@pytest.mark.parametrize("scale", [1, 1e100, 1e-100])
def test_sharp_change_rule_is_scale_invariant(scale):
    targets = [v*scale for v in [1,2,3,90,91,92]]
    events, _ = sharp_changes(targets, list(range(2020,2026)))
    assert len(events) == 1
    assert events[0]["kind"] == "sharp_rise"
    assert events[0]["from_year"] == 2022 and events[0]["to_year"] == 2023


def test_record_reports_actual_solver_settings_and_no_fixed_percentage_bounds():
    settings = calculation_settings()
    assert settings["solver"]["solver"] == "OSQP"
    assert settings["solver"]["rho"] == .01
    assert settings["solver"]["eps_abs"] == settings["solver"]["eps_rel"] == 1e-7
    assert settings["average"]["range_penalty_weight"] == .1
    report = upload("/review", b"year,value\n1,1000\n2,5000\n3,10000\n", mode="average").json()
    assert report["methods"]["average"]["series"][0]["input_max"] == 10000
    assert "no fixed" in " ".join(report["limits"])


@pytest.mark.parametrize("content", [
    b"year,value\n1,7\n", b"year,value\n1,0\n",
    b"year,value\n1,-10\n2,20\n3,-30\n", b"year,value\n1,1e308\n2,1e308\n",
    b"year,value\n1,0\n2,100\n3,0\n4,100\n",
])
def test_review_edge_inputs_are_serializable_without_nan_or_infinity(content):
    response = upload("/review", content, mode="average")
    assert response.status_code == 200, response.text
    document = response.json()
    json.dumps(document, allow_nan=False)
    assert document["methods"]["average"]["validation"]["annual_targets"]
    assert document["methods"]["average"]["validation"]["first_month"]


def test_comparison_failure_does_not_discard_successful_selected_method():
    response = upload("/review", b"year,value\n1,-5\n", mode="average")
    assert response.status_code == 200
    assert response.json()["methods"]["exit"]["status"] == "unavailable"
    assert "negative single-year" in response.json()["methods"]["exit"]["detail"]
    assert upload("/review", b"year,value\n1,-5\n", mode="exit").status_code == 400


@pytest.mark.parametrize("content,detail", [
    (b"year,value\n1,1\n2,1e308\n", "too wide"),
    (b"year,value\n1,abc%\n", "numeric"),
    (b"year,value\n1,6\n1,8\n", "Duplicate years"),
    (b"year,value\n1,6\n3,8\n", "consecutive"),
    (b"year,month\n1,6\n", "reserved"),
])
def test_review_preserves_input_and_precision_guards(content, detail):
    response = upload("/review", content, mode="average")
    assert response.status_code == 400
    assert detail in response.json()["detail"]


@pytest.mark.parametrize("mode", ["average", "exit"])
def test_measured_influence_is_actual_resolve_not_an_invented_explanation(mode):
    content = "year,采用率,__proto__\n2022,6,12\n2023,8,16\n2024,12,20\n".encode()
    before = upload("/convert", content, mode=mode, format="json").json()
    response = upload("/influence", content, mode=mode, column="采用率", year=2023, change=1)
    assert response.status_code == 200
    measured = response.json()
    original = pd.DataFrame({"year":[2022,2023,2024],"采用率":[6,8,12]})
    modified = original.copy()
    modified.loc[1,"采用率"] = 9
    raw_before, raw_after = yearly_to_monthly(original,mode), yearly_to_monthly(modified,mode)
    with localcontext() as context:
        context.prec = 800
        expected = [Decimal(str(b))-Decimal(str(a)) for a,b in zip(raw_before["采用率"],raw_after["采用率"])]
    assert list(map(Decimal,measured["monthly_changes"])) == expected
    assert abs(Decimal(measured["largest_monthly_change"])) == max(map(abs,expected))
    assert measured["before_target"] == 8 and measured["after_target"] == 9
    assert upload("/convert",content,mode=mode,format="json").json() == before


@pytest.mark.parametrize("params,detail", [
    ({"column":"absent","year":1,"change":1}, "series"),
    ({"column":"value","year":99,"change":1}, "year"),
    ({"column":"value","year":1,"change":0}, "non-zero"),
    ({"column":"value","year":1,"change":"nan"}, "finite"),
    ({"column":"value","year":1,"change":1e-300}, "too large or too small"),
])
def test_influence_rejects_unsafe_or_irrelevant_edits(params,detail):
    response = upload("/influence",b"year,value\n1,6\n2,8\n",mode="average",**params)
    assert response.status_code == 400
    assert detail in response.json()["detail"]


def test_review_literal_headers_encodings_and_capacity_protections():
    content = "year,__proto__,采用率,$notacommand$\r1,6,10,12\r2,8,14,16\r".encode()
    response = upload("/review",content,mode="average")
    assert response.status_code == 200
    assert response.json()["methods"]["average"]["series"][0]["column"] == "__proto__"
    assert upload("/review","year,Slow – growth\r1,6\r2,8\r".encode("cp1252"),mode="exit").status_code == 200
    assert upload("/review",b"x"*(10*1024*1024+1),mode="average").status_code == 413
    assert upload("/review",content,mode="invalid").status_code == 422
    with _conversion_capacity:
        assert upload("/review",content,mode="average").status_code == 503
        assert upload("/influence",content,mode="average",column="__proto__",year=1,change=1).status_code == 503


def test_review_workload_and_typography_assets():
    content = b"year,a,b,c,d,e\n" + b"".join(f"{i+1},{i+10},{i+20},{i+30},{i+40},{i+50}\n".encode() for i in range(50))
    start = time.perf_counter()
    response = upload("/review",content,mode="average")
    elapsed = time.perf_counter()-start
    assert response.status_code == 200
    assert elapsed < 10  # generous cross-platform regression ceiling, not an SLA
    print(f"50 years × 5 series review, both methods + decimal checks: {elapsed:.3f}s")
    font = client.get("/assets/fonts/InterVariable.woff2")
    assert font.status_code == 200 and font.content.startswith(b"wOF2")
    assert "SIL OPEN FONT LICENSE" in client.get("/assets/fonts/LICENSE.txt").text
    for name in ["review.js","review.css"]:
        assert client.get("/assets/"+name).status_code == 200
