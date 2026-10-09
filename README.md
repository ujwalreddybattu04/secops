# Interpolation API

Independent development repository for the Chryselys interpolation project.

Upload screen: https://secops-4g26.onrender.com/  
API documentation: https://secops-4g26.onrender.com/docs

## Current screen

The homepage is a minimal upload screen based on the supplied layout reference:
a slim sidebar, centred heading, rounded CSV picker, Average/Exit selector and
dismissible format note. It uses self-hosted Inter and supports narrow screens,
keyboard navigation, file picking and drag-and-drop.

This release is the screen only. A selected CSV stays in browser memory; selecting
it does not send it to the server, validate its rows or generate a result. New
upload clears the current selection. Files selected during the current session
can be selected again from the sidebar; a reload clears that list. The previous
charts, comparison, explanation, scenario and project panels have been removed
from the frontend. The next flow will be added after its requirements are given.

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

Optional real-browser screen checks:

```sh
python -m pip install playwright
python -m playwright install chromium
python tests/browser_upload.py --url http://127.0.0.1:8000/
```

Deploy this repository independently using `render.yaml`. Fonts and their
licenses are included. Keep credentials, analyst files, logs and local virtual
environments out of commits. [REVIEW.md](REVIEW.md) and [SCENARIOS.md](SCENARIOS.md)
record earlier development work; their previous workspace UI is no longer served.
