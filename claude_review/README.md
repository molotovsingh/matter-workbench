# Matter Workbench — Agent Review Artifacts

This folder holds repeatable agent review outputs. It is **not** a working directory for source code — the main coding agent reads these files and decides whether to keep, move, ignore, or commit them.

- **`quality-pass/`** — engineering-quality reviews (`/quality-pass` skill). `latest.md` is the current report; `<date>-<commit>.md` are immutable per-commit snapshots.
- **`skills-journey/`** — product/UX reviews of the skills user journey (SJ findings). Same `latest.md` + per-commit convention.
- **`INDEX.md`** — chronological run index for all review types mapping timestamps → commits → headline → finding counts → links.
