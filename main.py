"""Yearly-to-monthly CSV API. Run with uvicorn main:app --reload."""

import csv
import hashlib
from importlib.metadata import version
from contextlib import contextmanager
from decimal import Decimal, InvalidOperation
from enum import Enum
from io import StringIO
import math
from pathlib import Path
from threading import BoundedSemaphore
import unicodedata

import pandas as pd
from smoothing import smooth_average, smooth_exit
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import Response, FileResponse
from fastapi.staticfiles import StaticFiles

from outputs import to_csv_response, to_json_response, to_pdf_response


class Mode(str, Enum):
    average = "average"
    exit = "exit"


class OutputFormat(str, Enum):
    csv = "csv"
    json = "json"
    pdf = "pdf"


app = FastAPI(title="Interpolation API")
STATIC_DIR = Path(__file__).parent / "static"
app.mount("/assets", StaticFiles(directory=STATIC_DIR), name="assets")

# Operational limits for the synchronous development service, not model bounds.
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_YEARS = 100
MAX_VALUE_COLUMNS = 20
MAX_MONTHLY_VALUES = 12_000
MAX_HEADER_CHARACTERS = 200
MAX_YEAR_IDENTIFIER = 2**53 - 1
_conversion_capacity = BoundedSemaphore(1)


def _engine_metadata() -> dict:
    dependencies = {name: version(name) for name in ("numpy", "pandas", "scipy", "cvxpy", "osqp")}
    digest = hashlib.sha256()
    for name in ("main.py", "smoothing.py", "outputs.py"):
        digest.update(name.encode())
        digest.update((Path(__file__).parent / name).read_bytes())
    for name, dependency_version in sorted(dependencies.items()):
        digest.update(f"{name}={dependency_version}".encode())
    return {"id": "sha256:" + digest.hexdigest(), "dependencies": dependencies, "display_decimals": 2}


ENGINE_METADATA = _engine_metadata()


class RequestLimitError(ValueError):
    """Reject oversized work before allocating an optimization problem."""


@app.middleware("http")
async def response_protection(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if request.url.path in ("/convert", "/preview"):
        response.headers["Cache-Control"] = "no-store"
    if request.url.path in ("/", "/engine") or request.url.path.startswith("/assets/"):
        response.headers["Cache-Control"] = "no-cache"
    if request.url.path == "/convert" and response.status_code == 200:
        response.headers["X-Calculation-Engine"] = ENGINE_METADATA["id"]
    if request.url.path == "/":
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; connect-src 'self'; object-src 'none'; "
            "base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
        )
    return response


@app.get("/health", include_in_schema=False)
def health() -> dict:
    """Lightweight process readiness; does not run or certify a calculation."""
    return {"status": "ok"}


@app.get("/engine")
def engine() -> dict:
    """Identify the calculation code and dependencies behind saved scenario runs."""
    return ENGINE_METADATA


@contextmanager
def _conversion_slot():
    if not _conversion_capacity.acquire(blocking=False):
        raise HTTPException(
            status_code=503,
            detail="The calculation service is busy. Please retry in a few seconds.",
            headers={"Retry-After": "3"},
        )
    try:
        yield
    finally:
        _conversion_capacity.release()


@app.get("/", include_in_schema=False)
def workspace() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


def yearly_to_monthly(df: pd.DataFrame, mode: Mode | str) -> pd.DataFrame:
    """Validate and expand yearly data without mutating df.

    Value headers retain their spelling after trimming. Header comparisons are
    case-insensitive. Raises ValueError for invalid input.
    """
    mode = Mode(mode)
    data, value_columns = _validated_yearly_frame(df)
    targets = data[value_columns].to_numpy(dtype=float)
    smoother = smooth_average if mode == Mode.average else smooth_exit
    corrected = smoother(targets, value_columns)
    rows = [
        [year, month, *corrected[index * 12 + month - 1].tolist()]
        for index, year in enumerate(data["year"].tolist())
        for month in range(1, 13)
    ]
    return _checked_monthly_frame(rows, value_columns)


def _validated_yearly_frame(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """Share the existing input validation with the analyst's input preview."""
    data = df.copy(deep=True)
    names = [str(column).strip() for column in data.columns]
    keys = [name.casefold() for name in names]
    if "year" not in keys:
        raise ValueError("Missing required 'year' column.")
    if len(names) < 2:
        raise ValueError("At least one numeric value column is required.")
    if any(not name for name in names):
        raise ValueError("Column names must not be empty.")
    if len(set(keys)) != len(keys):
        raise ValueError("Duplicate column names are not allowed (case-insensitive).")
    for name in names:
        if len(name) > MAX_HEADER_CHARACTERS:
            raise ValueError(f"Column names must contain at most {MAX_HEADER_CHARACTERS} characters.")
        if any(unicodedata.category(character) == "Cc" for character in name):
            raise ValueError("Column names must not contain control characters or line breaks.")
        if name.startswith(("=", "+", "-", "@")):
            raise ValueError(
                "Column names must not begin with =, +, -, or @; "
                "rename formula-like headers before exporting to spreadsheets."
            )
    names[keys.index("year")] = "year"
    data.columns = names
    if data.empty:
        raise ValueError("CSV must contain at least one data row.")

    years = []
    for value in data["year"]:
        try:
            number = Decimal(str(value).strip())
            if not number.is_finite() or number != number.to_integral_value():
                raise ValueError
            # Check the Decimal before int(): short exponent notation can encode
            # enormous integers, and JSON/browser identifiers must stay exact.
            if number.copy_abs() > MAX_YEAR_IDENTIFIER:
                raise ValueError
            years.append(int(number))
        except (InvalidOperation, ValueError, OverflowError):
            raise ValueError(
                "'year' must contain non-empty integer values within "
                f"{-MAX_YEAR_IDENTIFIER} to {MAX_YEAR_IDENTIFIER}."
            ) from None
    if len(set(years)) != len(years):
        raise ValueError("Duplicate years are not allowed.")
    ordered_years = sorted(years)
    if any(right - left != 1 for left, right in zip(ordered_years, ordered_years[1:])):
        raise ValueError("Years must be consecutive after sorting.")
    data["year"] = years

    value_columns = [column for column in names if column != "year"]
    for column in value_columns:
        try:
            cleaned = data[column].map(
                lambda value: str(value).strip().removesuffix("%").strip()
            )
            values = pd.to_numeric(cleaned, errors="raise").astype(float)
        except (ValueError, TypeError, OverflowError):
            raise ValueError(
                f"Column '{column}' must contain non-empty finite numeric values."
            ) from None
        if not all(math.isfinite(value) for value in values):
            raise ValueError(
                f"Column '{column}' must contain non-empty finite numeric values."
            )
        data[column] = values

    data = data.sort_values("year").reset_index(drop=True)

    return data, value_columns


def _checked_monthly_frame(rows: list, value_columns: list[str]) -> pd.DataFrame:
    """Reject arithmetic overflow before any output formatter sees the data."""
    result = pd.DataFrame(rows, columns=["year", "month", *value_columns])
    for position, column in enumerate(value_columns, start=2):
        if not all(math.isfinite(value) for value in result.iloc[:, position]):
            raise ValueError(
                f"Column '{column}' produced a non-finite result; input values are too large."
            )
    return result


def _read_csv(content: bytes) -> pd.DataFrame:
    """Read UTF-8 or Windows-1252 CSV, rejecting malformed records and headers."""
    try:
        text = content.decode("utf-8-sig")
    except UnicodeError:
        try:
            text = content.decode("cp1252")
        except UnicodeError:
            raise ValueError(
                "CSV could not be decoded; use UTF-8 or Windows-1252 encoding."
            ) from None
    if not text.strip():
        raise ValueError("CSV must contain at least one data row.")
    if "\x00" in text:
        raise ValueError("CSV contains invalid null characters; use a text CSV file.")
    try:
        records = []
        for row in csv.reader(StringIO(text, newline=""), strict=True):
            if not row:
                continue
            if not records and len(row) > MAX_VALUE_COLUMNS + 1:
                raise RequestLimitError(f"CSV supports at most {MAX_VALUE_COLUMNS} value columns per request.")
            records.append(row)
            if len(records) > MAX_YEARS + 1:
                raise RequestLimitError(f"CSV supports at most {MAX_YEARS} yearly rows per request.")
        if not records:
            raise ValueError("CSV must contain at least one data row.")
        width = len(records[0])
        if any(len(row) != width for row in records[1:]):
            raise ValueError("Every CSV row must have the same number of fields as the header.")
        if (len(records) - 1) * 12 * (width - 1) > MAX_MONTHLY_VALUES:
            raise RequestLimitError(
                f"Request would exceed {MAX_MONTHLY_VALUES:,} monthly values. "
                "Submit fewer value columns while preserving the full year timeline."
            )
        # Read the header as data to prevent pandas from renaming duplicate headers.
        frame = pd.read_csv(
            StringIO(text, newline=""), header=None, dtype=str, keep_default_na=False
        )
        frame.columns = frame.iloc[0].tolist()
        return frame.iloc[1:].reset_index(drop=True)
    except (csv.Error, pd.errors.ParserError, pd.errors.EmptyDataError) as exc:
        raise ValueError(f"CSV could not be parsed: {exc}") from None


def _uploaded_yearly_frame(file: UploadFile) -> pd.DataFrame:
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must have a .csv extension.")
    try:
        content = file.file.read(MAX_UPLOAD_BYTES + 1)
    except OSError:
        raise ValueError("Uploaded CSV could not be read.") from None
    if len(content) > MAX_UPLOAD_BYTES:
        raise RequestLimitError("CSV files must be no larger than 10 MB.")
    return _read_csv(content)


CONVERSION_RESPONSES = {
    200: {
        "content": {"text/csv": {}, "application/json": {}, "application/pdf": {}},
        "description": "Monthly percentages as CSV, JSON, or PDF",
    },
    400: {"description": "Invalid CSV input"},
    413: {"description": "File or calculation workload exceeds service limits"},
    503: {"description": "Calculation capacity is occupied; retry after the indicated delay"},
}


@app.post("/preview", responses={400: {"description": "Invalid CSV input"}, 413: {"description": "Service limits exceeded"}})
def preview(file: UploadFile = File(...)) -> dict:
    """Validate yearly input for the workspace without running an optimizer."""
    try:
        data, columns = _validated_yearly_frame(_uploaded_yearly_frame(file))
    except RequestLimitError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"columns": columns, "rows": data.to_dict(orient="records")}


@app.get("/convert", response_class=Response, responses=CONVERSION_RESPONSES)
@app.post("/convert", response_class=Response, responses=CONVERSION_RESPONSES)
def convert(
    file: UploadFile = File(..., description="UTF-8 or Windows-1252 CSV containing yearly percentages, with or without %"),
    mode: Mode = Query(..., description="Smooth yearly means with a soft range penalty (average), or smooth December targets with a non-negative first month (exit)"),
    format: OutputFormat = Query(OutputFormat.csv, description="Response format"),
) -> Response:
    with _conversion_slot():
        try:
            result = yearly_to_monthly(_uploaded_yearly_frame(file), mode)
        except RequestLimitError as exc:
            raise HTTPException(status_code=413, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if format == OutputFormat.json:
            return to_json_response(result)
        if format == OutputFormat.pdf:
            return to_pdf_response(result, mode.value)
        return to_csv_response(result, mode.value)
