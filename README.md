# Matter Workbench

Standalone local workbench for inspecting and initializing legal matter folders.
This app is intentionally outside any single matter folder. Point it at a matter
with `MATTER_ROOT` when you want server-backed reads and writes.

## Scope

- VS Code-style shell
- One active slash skill: `/matter-init`
- Focus on intake initialization only
- Matter context is read from the current root `matter.json`
- Slash skills are entered in the top command strip
- `Open Folder` uses browser folder access for preview-only inspection
- `Switch Matter` refreshes the current server-backed matter root
- Matter metadata is captured before `/matter-init` runs
- `server.mjs` enables local filesystem writes for the deterministic intake engine
  against the configured server-backed matter root
- The Matter Explorer is backed by the local server and reflects the current
  matter root from disk

## Phase 1 behavior

`/matter-init` is responsible for:

- validating required matter metadata
- confirming the matter scaffold
- previewing `matter.json`
- preserving the original source under `00_Inbox/.../raw_source_files`
- arranging working copies under `00_Inbox/.../arranged_files`
- writing inbox load and normalization logs

The intended skill shape is:

```text
/matter-init
  folder + matter metadata -> preserved raw source -> arranged inbox -> review logs
```

Future document-specific skills should follow the same pattern: explicit verb,
bounded input, deterministic output, and lawyer review before downstream use.

In the UI, the sidebar shows available slash skills. The top command strip is
where the lawyer/operator types the skill, for example `/matter-init`, and runs
it against the open matter.

The Matter Explorer loads the current matter from the local Node server, reads
metadata from `matter.json`, and renders the visible workspace tree. Text files
such as `.md`, `.csv`, `.json`, and `.txt` can be opened directly from the
explorer. After `/matter-init` completes, the explorer refreshes so the operator
can inspect generated paths such as:

- `00_Inbox/Load_0001_Initial/raw_source_files`
- `00_Inbox/Load_0001_Initial/arranged_files`
- `00_Inbox/Load_0001_Initial/Inbox_Loads.csv`
- `00_Inbox/Load_0001_Initial/Inbox_Normalization_Log.csv`

Required metadata:

- Client name
- Matter name
- Opposite party
- Matter type
- Jurisdiction

The brief description is optional.

## Folder loading

For Phase 1, `Open Folder` is browser folder access:

- Click `Open Folder`
- Select a test matter folder
- The workbench scans visible top-level files/folders
- Fill or inspect matter metadata in the inspector

Browser-selected folders are preview-only. The browser can show that selected
folder, but the Node server cannot safely write into it because the server is
bound to its own configured matter root. If `/matter-init` is run while a
browser-selected folder is active, the UI blocks the write instead of applying
that metadata to the wrong matter.

`Switch Matter` refreshes the configured server-backed matter root.

When served through the local Node server, `/matter-init` now runs a deterministic
copy-only intake operation:

- reads source files from `00_Inbox/Load_0001_Initial/Evidence Files`
- hashes every source file with SHA-256
- copies untouched originals into `00_Inbox/Load_0001_Initial/raw_source_files`
- copies working files into `00_Inbox/Load_0001_Initial/arranged_files/<category>`
- classifies files by extension only
- marks exact duplicates by checksum
- writes `Inbox_Loads.csv`, `Inbox_Normalization_Log.csv`, and `matter.json`

The source files are not moved or modified.

If opened as a plain static HTML file, the UI falls back to preview mode because
the browser cannot write to the local filesystem by itself.

## Run locally

```bash
cd /Users/aks/matter_workbench
MATTER_ROOT=/absolute/path/to/matter npm start
```

Then open `http://127.0.0.1:4173/`.

Example:

```bash
cd /Users/aks/matter_workbench
MATTER_ROOT=/Users/aks/case_naveen npm start
```

The deterministic engine can also be run from the terminal:

```bash
MATTER_ROOT=/absolute/path/to/matter npm run matter-init:dry-run
MATTER_ROOT=/absolute/path/to/matter npm run matter-init
```

## Files

- `index.html` - prototype shell
- `styles.css` - visual design
- `app.js` - single-command interaction demo
- `server.mjs` - local server, explorer APIs, and `/api/matter-init` endpoint
- `matter-init-engine.mjs` - deterministic copy-only intake engine
- `package.json` - local run scripts
