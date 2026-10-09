# Interpolation API

FastAPI converts each yearly percentage row into 12 monthly rows and returns CSV, JSON, or a PDF with a trend chart and table.

This repository is an independent development copy of the yearly-to-monthly API for building Chryselys analyst features step by step. Average and Exit calculations are preserved from the source snapshot.

Deploy this repository as a separate service named `secops` using `render.yaml`. Use the new service's URL for development and testing.

Development API: https://secops-4g26.onrender.com/docs

Analyst workspace: https://secops-4g26.onrender.com/

## Analyst workspace

The root page serves a responsive interface from `static/`, without a separate frontend build or third-party chart scripts. It opens with an explicitly labeled 13-year sample that can be replaced with an uploaded CSV.

- Upload and preview yearly input, using the same validation as conversion. Both endpoints accept files up to 10 MB.
- Choose Average or Exit and generate monthly values through the existing `/convert` endpoint.
- Inspect chart values with a pointer or arrow keys, toggle series, and show annual targets. Average markers sit at year midpoints as reference targets; they are not additional curve constraints. Exit markers sit in December.
- New results and scenario switches draw the axes first, then reveal curves and target markers together from left to right in about 1.3 seconds. Charts below the viewport wait until visible. Reduced-motion preferences show the complete chart immediately, and pointer/keyboard inspection completes any ongoing reveal. Animation does not alter calculated values or exports.
- Review monthly data by year, inspect source inputs, and download input, CSV, or PDF files.
- Monthly table cells highlight values outside each series' yearly input range. The calculation engine verifies its constraints before returning results.
- Keep the original input as a baseline; create a named alternative and edit its yearly targets. Generate both under one method and calculation fingerprint, then compare solid/dashed curves and monthly percentage-point differences.
- Save a portable `.interpolation.json` project file with the original CSV, assumptions, current result snapshots, timestamps, engine fingerprints, and up to five previous alternative assumption revisions. Open it to validate the inputs and recalculate both scenarios with the current engine.

`POST /preview` validates and sorts yearly data without invoking the optimizer. The calculations and existing conversion formats are unchanged. `GET /engine` identifies the calculation code/dependency versions; successful `/convert` responses carry the same `X-Calculation-Engine` fingerprint. Scenario exports check that version against the displayed result.

Projects remain in browser memory until downloaded. There is no automatic recovery after a page reload, shared server project storage, or team login. Project JSON contains readable analyst data; the original-input checksum detects changes, not authorship or permission. Imported historical output snapshots never bypass recalculation. See [SCENARIOS.md](SCENARIOS.md) for the workflow and limits.

After starting the local server, optional real-browser scenario checks can be run separately:

```sh
python -m pip install playwright
python -m playwright install chromium
python tests/browser_scenarios.py --url http://127.0.0.1:8000/
python tests/browser_chart_motion.py --url http://127.0.0.1:8000/
```

See [REVIEW.md](REVIEW.md) for the measured analytics checks, service hardening, remaining release gaps, and next development order.

The team's existing service at https://yearly-to-monthly-api.onrender.com/docs remains the existing backend; this repository does not deploy to it.

Do not include local virtual environments, logs, credentials, or analyst documents in commits. The bundled font and its license are included because PDF generation requires them.

## Run locally (Python 3.10+)

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
uvicorn main:app --reload
```

On macOS/Linux, activate with `source .venv/bin/activate`.
Open http://127.0.0.1:8000/ for the analyst workspace, or http://127.0.0.1:8000/docs and use **POST /convert**.
Upload the CSV and select **mode** and **format**.

## Input and calculations

```csv
year,value
2022,6%
2023,8%
2024,12%
```

An optional trailing percent sign is accepted in every value column. `6` and `6%` both mean six percent, while `0.06` means 0.06 percent. Whitespace around the number and percent sign is ignored.

- **average:** minimize squared monthly second differences plus a squared-hinge penalty for leaving each column's own yearly minimum/maximum. `RANGE_PENALTY_WEIGHT = 0.1` controls this tradeoff; higher values discourage excursions more strongly. Nonnegative slack variables implement the penalty. Extrema are computed independently per column in normalized units. Yearly means and positive M1 remain hard constraints; there are no hard range bounds or percentage-specific restrictions.
- **exit:** minimize squared monthly second differences across the entire timeline, with every December fixed to its yearly target and the first month constrained to be non-negative. Jan-Nov of the first year are solved together with all later months. Exit has no soft-range penalty and no positive-epsilon first-month floor. A single non-negative yearly target produces a flat year; a negative single-year target returns HTTP 400 because the flat fallback conflicts with the non-negative first-month rule.

With only two Exit targets, 2022=6% and 2023=8%, the minimum-curvature solution is a straight line: January 2022 is 4.17%, December 2022 is 6%, January 2023 is 6.17%, and December 2023 is 8%. With more years, all anchors influence the curve, so the monthly increments can vary.
Calculations keep full floating-point precision. Only output formatting rounds to two decimal places, removing .00 from whole numbers: `6%`, `6.10%`, `8.17%`.
In average mode, the mean constraint holds on unrounded values within floating-point tolerance; the displayed two-decimal values can have a slightly different mean. Exit pins December to the original numeric target before formatting.

Exit solves `min sum((x[t+1] - 2*x[t] + x[t-1])**2)` subject to `x[12*i+11] == yearly[i]` and `x[0] >= 0` (zero-based indices). Two distinct December positions determine the slope and remove the curvature objective's linear ambiguity. The guard applies only to the first month: other months can be negative, and overshoot beyond the yearly range is possible. For example, targets 0.01%, 80%, 100% produce an approximately zero first month but later dip to about -8.47%. Equal adjacent December targets do not necessarily make the intervening months flat when other years change; a completely constant non-negative series is flat.

Average's first month has a hard positive lower limit: `epsilon = max(1e-6, 0.01 * max(data_max, 0))`, independently per value column. This is a first-month anchor only, not a range constraint for the entire curve. The absolute floor handles zero and negative maxima. Positive constants above epsilon stay flat; zero, negative, or extremely small constant targets require optimization to preserve their means while starting positive. Later months can be negative. Scaling invariance holds when the absolute floor is inactive; it deliberately does not hold below that floor.

The soft-range behavior is restored alongside the precision safeguards below. It discourages rather than prohibits excursions: maximum-target years remain valid and small overshoot is possible even with gentle data. The algorithm does not guarantee monotonicity or confine all excursions to sharp jumps. Raw M1 is positive; unchanged two-decimal formatting can display tiny positive values as `0%`.

Average's first-month epsilon is retained from the written specification. Sparse operators and squared-hinge slack variables are reused across columns. Only numerical roundoff is corrected; every returned year's mean is independently verified in raw units using Decimal. Average's equations and precision verification are unchanged by the new Exit method.

For the review example, set Y10=98 and append Y11-Y13=100 in the input. The API never alters or appends source targets. This deliberately lowers Moderate/Fast from Y9 99/99.8 to Y10 98.

Multiple percentage columns are processed independently. Headers are trimmed and compared case-insensitively; value names retain their trimmed spelling and original order. Output begins with integer `year` and `month` columns, sorted by year then month.

## Output formats

The required `mode` query parameter is `average` or `exit`.
The optional `format` query parameter is `csv` (default), `json`, or `pdf`.

| Format | Content type | Response |
| --- | --- | --- |
| csv | text/csv | Download named monthly_<mode>.csv |
| json | application/json | Array of monthly objects directly in the body |
| pdf | application/pdf | Download named monthly_<mode>.pdf |

All three formats show the same percentage strings. JSON keeps year and month as integers. Example for a single-year 6% input:

```json
[
  {"year": 2022, "month": 1, "value": "6%"},
  {"year": 2022, "month": 2, "value": "6%"}
]
```

PDF reports include a continuous line for each value column and a table containing all monthly rows. Chart points use unrounded data and equally spaced monthly positions across years. Long tables continue across pages with repeated headers; wide tables are split into column groups.

CSV/PDF preserve a value column named `month` after the generated month column. Because JSON object keys must be unique, JSON aliases that value column to `month_value`, appending another `_value` if that name already exists.

## Example requests

Use the included `yearly.csv`. On Windows PowerShell, use `curl.exe`.

```sh
curl -X POST "http://127.0.0.1:8000/convert?mode=average" -F "file=@yearly.csv" -o monthly_average.csv
curl -X POST "http://127.0.0.1:8000/convert?mode=exit&format=json" -F "file=@yearly.csv"
curl -X POST "http://127.0.0.1:8000/convert?mode=exit&format=pdf" -F "file=@yearly.csv" -o monthly_exit.pdf
```

Replace the local base URL with the separate secops service URL to use the hosted development API.
GET /convert is also supported with the same multipart file body and query parameters. Use POST in Swagger and browser clients, which generally cannot send file bodies with GET. Opening the conversion URL alone does not supply a file.

## Validation

Invalid input returns HTTP 400 with a clear JSON `detail`, regardless of output format:

- Wrong file extension, unreadable content, unsupported text encoding, malformed CSV, or null characters.
- Missing year column, missing value columns, empty or duplicate headers, or no data rows.
- Empty, nonnumeric, NaN, or infinite values (including malformed percentage strings such as abc% or 6%%).
- Non-integer years, duplicate years, or gaps between years after sorting.

Year identifiers must fit the exact JSON/browser integer range, from -9,007,199,254,740,991 through 9,007,199,254,740,991. The Decimal range check runs before integer conversion, so compact exponents cannot allocate enormous year integers. Ordinary calendar and relative years retain their existing behaviour.

UTF-8 (with or without a BOM) and Windows-1252 CSV files are supported, including Excel exports with Windows-encoded punctuation in column names. Uppercase .CSV extensions are supported. Finite absolute values and percentages are accepted without a 0-100 restriction, subject to each mode's calculation and accuracy constraints.
Missing required request parameters or invalid mode/format values return HTTP 422.

Both preview and conversion enforce operational limits: 10 MB per file, 100 yearly rows, 20 value columns, and 12,000 generated numeric values (years × 12 × value columns). Exceeding a limit returns HTTP 413 before optimizer construction. To reduce a wide request, submit fewer columns while retaining every year: splitting the timeline changes a global smoothing result. These limits protect this synchronous development service; they do not bound percentages or change either equation.

Column names may contain at most 200 characters and no embedded control characters or line breaks. Headers beginning with `=`, `+`, `-`, or `@` are rejected with HTTP 400 to avoid exporting spreadsheet formulas. Rename those headers; Unicode and literal mathematical punctuation within ordinary labels remain supported. Long PDF legend labels wrap without changing table headers.

One conversion, including PDF generation, runs at a time per server process. Overlapping requests receive HTTP 503 with `Retry-After: 3`, rather than starting additional optimizers. The browser honours short retry delays for up to two retries, with cancellation and its existing timeout. Capacity is released even after errors. Preview and health requests remain available. This is capacity protection, not authentication, rate limiting, or a distributed job queue.

`GET /health` returns `{"status":"ok"}` when the process can serve requests. It does not run the optimizer or certify the quality of a particular curve. Conversion and preview responses use `Cache-Control: no-store`; the workspace also sets a content security policy and framing protection.

## Tests and code

```sh
python -m pytest -q
```

- `main.yearly_to_monthly(df, mode)`: pure conversion and validation; returns a numeric DataFrame without modifying the input.
- `smoothing.smooth_average` and `smooth_exit`: independent column optimizations using shared sparse curvature operators and OSQP settings.
- `outputs.formatted_monthly(df)`: shared percentage formatting.
- `outputs.to_csv_response`, `to_json_response`, `to_pdf_response`: format-specific response builders.
- `outputs.build_pdf(df, mode)`: independently testable in-memory PDF generation.
- `outputs.build_trend_chart(df)`: plots all monthly numeric values without smoothing, randomization, or rounding.

Tests cover the existing validation cases, both calculation modes, multiple columns, backward-compatible numeric inputs, matching CSV/JSON/PDF values, chart data, PDF pagination, download headers, and Swagger dropdowns. Exit tests also compare against independent minimum-curvature equations, verify December anchors, first-month non-negativity, precision guards, and a 50-year/five-column timing check. pypdf is used to inspect PDF table text and embedded charts in tests.

## Render deployment

The public development repository is https://github.com/ujwalreddybattu04/secops.
The included render.yaml defines a free Python web service. The .python-version file selects Python 3.12.

- Build: `python -m pip install -r requirements.txt && python -m pytest -q`
- Start: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Health check: `/health`

For a new deployment, connect the repository through Render's **New > Blueprint** flow and deploy render.yaml. Keep main.py, outputs.py, requirements.txt, render.yaml, and .python-version at the repository root, with tests/ beside them.

The service runs independently of your computer. The free instance sleeps after 15 idle minutes and automatically wakes on the next request, which can take about a minute.
See https://render.com/docs/deploy-fastapi and https://render.com/docs/free.

## Robustness and Unicode fonts

Every calculated monthly value is checked for finiteness before formatting.
Arithmetic overflow returns HTTP 400 naming the affected column.
Both modes scale each column internally for numerical stability and reject non-finite calculated results.

Chart text is literal: dollar signs and backslashes are not interpreted as
LaTeX or mathematical expressions. Charts and PDF tables both use the bundled
API Unicode Sans font, derived from Noto Sans CJK SC. It includes Chinese,
Japanese, Korean, Latin, Greek, and Cyrillic glyphs from the source font.
See fonts/README.md and fonts/LICENSE.txt for provenance and licensing.
The font is bundled with the application; no server-installed font is required.
Keep the fonts/ directory when copying or deploying this project.

Value cells still require numeric percentages. Non-Latin text is supported in
headers; a nonnumeric value such as 六% is still invalid. Coverage is limited
to the bundled font's repertoire, not every Unicode script or emoji.

For characters absent from the CJK font, both renderers use Matplotlib's bundled DejaVu Sans as a fallback, including accented Greek. PDF font runs are escaped as literal text before rendering.

All API outputs retain percentage formatting. The query parameters are `mode` and `format`; there is no units selector.

## Precision safeguards

Before constructing the optimizer, each column's largest/smallest nonzero absolute yearly target ratio is checked against `MAX_SAFE_MAGNITUDE_RATIO = 1e12`. Wider ranges fail the whole request with HTTP 400 naming the column. Zero values are excluded from the ratio. This is a conservative precision guard, not a proof that every smaller ratio is numerically safe.

Every returned Average column, including single-year and constant fast paths, is independently checked after rescaling using Decimal arithmetic at 800-digit precision. Each year's relative mean error must be less than 1e-6, with a denominator floor of 1e-6 (equivalent to an absolute tolerance of 1e-12 near zero). Only tiny raw-unit equality residuals can be refined, by adjusting one small-magnitude month other than M1; the complete result must still pass verification. Unverifiable or non-finite output raises a named error instead of returning silently incorrect data. This check applies before two-decimal percentage display formatting.

Exit reuses the same magnitude-ratio guard and scaling. Normalized December and first-month solver residuals must be within 1e-8 before roundoff cleanup. December values are then assigned the original targets exactly, and every returned column is independently checked for finiteness, non-negative M1, and December accuracy using the same Decimal precision and tolerance as Average. Single-year and constant return paths also pass these checks.

## Curve review: trust and explainability

The workspace separates tasks into five views:

1. **Input** — upload a CSV, inspect the validated yearly targets, and choose
   Average or Exit. A short 6% example explains each method's meaning.
2. **Results** — explore the monthly graph and table, then download CSV or PDF.
3. **Compare** — calculate Average and Exit together from the same input.
4. **Explain** — inspect changes, read plain-language calculation explanations,
   and optionally open the one-target influence experiment.
5. **Record** — check annual constraints and download calculation settings and
   validation results.

Only one view is visible at a time. Moving between views does not edit input or
start a calculation. After generating a result, the workspace opens Results.
Comparison, explanation and record analysis share one explicitly requested
review; use the action button in any of those views to prepare it. Ordinary
CSV/JSON/PDF conversion pays no additional review solve cost. Neither smoothing
algorithm is changed by the organization of these views.

- **Explain** flags sharp yearly changes and turning points in yearly
  targets and raw monthly values. Select a flag to inspect its month on the main
  graph. Each series has its own findings and explanations of its annual
  constraint, curvature objective, first-month minimum and optional soft range.
- **Compare** runs Average and Exit on identical input under one engine
  version. It shows both full-timeline curves and a selectable year's monthly
  values and differences. This is separate from baseline/alternative comparison.
  An unavailable comparison method is explained without discarding the selected
  method's valid result.
- **Record** includes finite-value, raw annual-constraint and
  first-month checks, per-year errors and tolerances, display-rounding errors,
  solver configuration, package versions, detection rules and engine fingerprint.
  It can be downloaded as JSON and is included in **Save project** after review.
- **Test one target's influence** performs a temporary one-target perturbation.
  It reports the actual largest monthly response from re-solving that series,
  keeping all other yearly targets fixed. This never applies an edit to the
  project. Data-dependent ranges and first-month floors are recalculated with
  the changed target. It is a model sensitivity experiment, not causal attribution, a
  derivative, or a forecast of how a real business will respond.

`POST /review?mode=average|exit` accepts the same CSV upload and returns a review
document for both methods. A selected-method error retains the existing HTTP 400
behavior. `POST /influence?mode=...&column=...&year=...&change=...` returns a measured
one-target response; `change` is in the same numeric units as the input (percentage
points for percentage data). Both endpoints share upload/workload limits,
precision guards, the conversion capacity slot and no-store cache policy.

A sharp-change flag requires a yearly change of at least 25% of that column's
input span and twice its median non-zero yearly change. With only one change,
this relative-outlier rule cannot flag it as unusual. Turning-point detection
groups flat plateaus and ignores changes below a relative numerical noise floor.
These are transparent descriptive heuristics, not statistical significance,
forecast confidence or a guarantee of continuous mathematical differentiability.
Records include total event counts and up to 200 events per kind per series.

Project schema version 1 remains backward compatible. Optional review snapshots,
influence experiments and workspace display settings, including the selected
view, are saved. On reopen,
monthly results and previously requested reviews are recalculated; imported
pass/fail flags and output snapshots never bypass verification. Historical
influence snapshots remain in the downloaded archive but are not presented as
current measurements on reopening. These are portable local files, not server
storage, user accounts, shared permissions or an approval audit trail.

The workspace uses self-hosted Inter Variable with its bundled license; see
`static/fonts/README.md`. It has keyboard-operated workflow tabs, literal-text
rendering, responsive tables and the existing reduced-motion chart behavior.

Backend tests: `python -m pytest -q`. Optional real-browser review regression:
`python tests/browser_curve_review.py --url http://127.0.0.1:8000/` after installing
Playwright and its Chromium browser as described in `tests/browser_scenarios.py`.
The organization regression is `python tests/browser_organization.py --url
http://127.0.0.1:8000/`; it also checks visible pointer interactions, navigation
without extra solves, input paging, saved views, and method changes.
