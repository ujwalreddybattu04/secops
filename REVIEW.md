# Analytics and release review — 8 October 2026

The workspace is suitable for a development pilot with sample or approved test data. It is not yet ready for unrestricted internal company data: access control and reproducible saved runs are still missing. Passing numerical tests does not establish that estimated monthly profiles predict observed uptake.

## Changes made during this review

| Finding | Result |
| --- | --- |
| Conversion could bypass the preview's 10 MB limit and allocate arbitrarily large optimization work | Shared file limits and early row/column/monthly-value checks; HTTP 413 before optimization |
| Concurrent synchronous calculations could compete for the development instance | One active conversion per process; overlapping work receives HTTP 503 with a retry delay; preview/health remain responsive |
| A 10,000-character header reproduced a PDF HTTP 500 | Header length/control-character validation and wrapped PDF legend labels; clear HTTP 400 for unsupported headers |
| A formula-like header such as `=1+1` was emitted unchanged into spreadsheet CSV | Reject formula-leading headers consistently in preview and conversion; retain accepted labels exactly |
| Workspace had no explicit browser response protection or dedicated health endpoint | Workspace CSP, no-sniff/framing headers, no-store analysis responses, and lightweight `/health` |
| Unbounded year integers could exceed JSON/browser precision and trigger expensive integer expansion | Exact identifier range checked in Decimal before conversion to a Python integer; HTTP 400 for unsupported identifiers |

No change was made to `smoothing.py`. Average retains exact mean constraints, the positive first month, the soft range penalty, and magnitude/Decimal accuracy safeguards. Exit retains December constraints and a non-negative first month. PDF label layout changes do not alter plotted coordinates or exported numbers. The team's original repository and service are outside this release.

The development API now has deliberate operational limits: 10 MB, 100 yearly rows, 20 series, and 12,000 generated values. These limits are not value bounds. They apply to HTTP requests; they are not a mathematical restriction on the standalone smoothing functions. Uploaded multipart content is received by the framework before application file checks, so this release does not claim an ingress transfer-size or disk-spooling limit.

## Numerical evidence

An independent Decimal check used fixed seed `20261008`, testing 21 datasets per method: changing signs, sudden swings, zeros, constant values, gentle growth, and absolute values up to 100,000. All returned values were finite; all Average first months were positive and Exit first months were non-negative. Maximum absolute annual target errors were approximately **7.84e-12 for Average means** and **7e-14 for Exit Decembers**. These are measured results on these datasets, not universal error guarantees.

The exact original ten-year adoption data was rechecked without clipping:

| Series | Below its yearly minimum (points) | Above its yearly maximum (points) | First month |
| --- | ---: | ---: | ---: |
| Slow: 1, 4, 10, 20, 33, 48, 64, 79, 92, 100 | 0.1311 | 0.3228 | 1.0000 |
| Moderate: 4, 14, 30, 50, 68, 82, 91, 96, 99, 100 | 0.4230 | 0.0255 | 3.7357 |
| Fast: 8, 25, 48, 68, 83, 92, 97, 99, 99.8, 100 | 0.7251 | 0.0033 | 7.5471 |

Maximum mean error on those adoption curves was **1.34e-14 points**. The `[1, 1e308]` input still failed cleanly at the precision guard. Overshoot remains possible because the range preference is soft; neither monotonicity nor a 0–100 box is promised. Only Average's first month is constrained positive; later negative values are possible. Two-decimal output can display small positive values as `0%` and slightly change annual means.

Local 50-year/five-series runs, including independent verification, took **0.190–0.199 seconds for Average** and **0.024–0.031 seconds for Exit** over three runs. HTTP transfer, cold start, and PDF export are excluded. This is not a production load or latency guarantee.

The regression suite passed **297 tests**. New tests cover actual concurrent HTTP calls, release of capacity after validation/export failures, oversized requests rejected before either solver, accepted workload boundaries, unsafe/long headers, PDF validity/layout warnings, huge year exponents and exact identifier boundaries, security headers, and the shared preview rules. Existing numerical, input encoding, Unicode, output parity, and performance tests remain passing. One existing Starlette/httpx deprecation warning remains.

Desktop, tablet, and mobile browser checks passed for sample/upload input, Average/Exit generation, annual checks, navigation, literal Unicode headers, CSV/PDF downloads, and actionable validation errors. The workspace remains functional under its new CSP. Its request helper honours short HTTP 503 retry delays for two attempts after the initial request; cancellation and the 90-second timeout still apply.

## Next development order

1. **Company identity and project permissions.** Confirm Chryselys' identity provider and data-hosting requirements, then protect both the workspace and all API routes. The public development service currently allows anonymous conversion. Browser headers are not an access-control substitute.
2. **Reproducible project runs.** Save immutable source bytes, source hash, engine version, solver/settings version, method, timestamps, unrounded results, displayed exports, and review notes under the project permissions. The current workspace holds only browser-session state; downloads rerun calculation and there is no saved audit history.
3. **Scenario comparison and approval.** Compare curves and annual targets between saved runs, show changed assumptions, and record who reviewed which run. Do not add simulated review status or imply approval from passing accuracy checks.
4. **Operational release preparation.** Resolve/pin tested dependency versions with an update process, add managed persistence/backup, ingress limits and rate controls, measure realistic concurrent/PDF loads, and select hosting against uptime, region, and recovery requirements. Current per-process capacity protection will not coordinate several workers or service instances.
5. **Domain validation.** Ask analysts to compare monthly estimates with observed or accepted reference data. Separate interpolation assumptions from forecasting accuracy, and determine when monotonicity, launch dates, or first-month anchors are truly required. Conflicting assumptions should be explained rather than silently corrected.

The broad CJK/Latin font support is tested, but every writing system, right-to-left layout, locale, and accessibility assistive technology has not been validated. International readiness requires those checks against the countries and analysts actually served.
