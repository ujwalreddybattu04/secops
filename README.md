# Interpolation API

Independent development repository for the Chryselys interpolation project.

Upload screen: https://secops-4g26.onrender.com/  
API documentation: https://secops-4g26.onrender.com/docs

## Current screen

The homepage is a minimal upload screen based on the supplied layout reference:
a slim sidebar, centred heading, rounded CSV picker, Average/Exit selector and
dismissible format note. It uses self-hosted Inter and supports narrow screens,
keyboard navigation, file picking and drag-and-drop.

Choose a CSV, select Average or Exit, and press the arrow to generate. Selection
stays local until that action. The screen sends the original file to /preview
for validation, then to /convert?mode=…&format=json for monthly values.

The result contains an animated curve, keyboard/pointer month inspection, a
year-selectable monthly table, and CSV/PDF downloads. The graph and table use the
same API values, displayed to two decimals. The chart draws those monthly points
directly and respects reduced-motion settings. It does not fit a second curve,
clamp values, or change the calculation.

Changing the file or method clears the previous result and cancels its request.
Requests show progress, permit cancellation, retry a busy service, and display
backend validation errors. Downloads use the same file and method; the backend
calculation version must match the displayed result, and CSV values must also
match before a download starts.

Files this session holds up to five selections in browser memory. New upload
clears the current selection; a reload clears the session list. No projects,
comparison panels, generated explanations, or automatic sample calculation are
shown. The backend calculation and parsing code are unchanged by this UI work.

The existing API and Average/Exit calculations remain available through `/docs`.
Their numerical and validation documentation is in [API.md](API.md). The original
team service is separate: https://yearly-to-monthly-api.onrender.com/docs.

## Run locally

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
uvicorn main:app --reload
```

Open http://127.0.0.1:8000/ for the upload screen or `/docs` for conversion.

Backend checks: `python -m pytest -q`.

Optional real-browser checks (start the local server first):

```sh
python -m pip install playwright
python -m playwright install chromium
python tests/browser_upload.py --url http://127.0.0.1:8000/
python tests/browser_conversion.py --url http://127.0.0.1:8000/
```

Deploy this repository independently using `render.yaml`. Fonts and their
licenses are included. Keep credentials, analyst files, logs and local virtual
environments out of commits. [REVIEW.md](REVIEW.md) and [SCENARIOS.md](SCENARIOS.md)
record earlier development work; their previous workspace UI is no longer served.
