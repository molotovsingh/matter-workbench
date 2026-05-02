# Matter Workbench

Standalone local workbench for inspecting and initializing legal matter folders.
This app is intentionally outside any single matter folder. Point it at a matter
with `MATTER_ROOT` when you want server-backed reads and writes.

## Architecture Map

For the current codebase map, lifecycle diagram, provider paths, persistent
artifacts, and eval tooling, see
[docs/codebase-diagram.md](docs/codebase-diagram.md).

## Scope

- VS Code-style shell
- One active slash skill: `/matter-init`
- Focus on intake initialization only
- One matter per server process, pinned by `MATTER_ROOT` at startup
- Matter context is read from that root's `matter.json`
- Slash skills are entered in the top command strip
- Matter metadata is captured before `/matter-init` runs
- `server.mjs` enables local filesystem writes for the deterministic intake engine
- The Matter Explorer reflects the current matter root from disk

## Phase 1 behavior

`/matter-init` is responsible for:

- validating required matter metadata
- confirming the matter scaffold
- previewing `matter.json`
- preserving the originals under `00_Inbox/.../Originals`
- arranging working copies under `00_Inbox/.../By Type`
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

- `00_Inbox/Intake 01 - Initial/Originals`
- `00_Inbox/Intake 01 - Initial/By Type`
- `00_Inbox/Intake 01 - Initial/Intake Log.csv`
- `00_Inbox/Intake 01 - Initial/File Register.csv`

Required metadata:

- Client name
- Matter name
- Opposite party
- Matter type
- Jurisdiction

The brief description is optional.

## Folder loading

The active matter is whichever folder you point `MATTER_ROOT` at when starting
the server, or whatever you select from the in-app Matters list. The Matter
Explorer reads that folder and renders its tree. Fill or inspect matter
metadata in the inspector, then run `/matter-init`.

## Adding more files later

Real matters keep accumulating documents — client emails, opposite-party
productions, etc. With a matter loaded, click `+ Add Files` above the workspace
tree to upload another batch. Each batch becomes its own folder under
`00_Inbox/`:

```
Naveen vs Mohit/
  00_Inbox/
    Intake 01 - Initial/                 (first batch — contains its own
                                          Source Files, Originals, By Type,
                                          File Register.csv, Intake Log.csv)
    Intake 02 - 2026-05-08 client email/ (second batch with optional label)
    Intake 03 - 2026-05-15/               (third batch, no label)
  matter.json                             (intakes: [...] array)
```

`FILE-NNNN` ids continue across batches (so you'll see FILE-0051 in Intake 02
if Intake 01 had 50 files). Files whose SHA-256 already appears in a prior
batch are recorded in the new batch's `File Register.csv` with
`status: duplicate-of-prior-intake` and `duplicate_of: FILE-0001`, but not
re-copied to that batch's `Originals/` or `By Type/` — the original
preservation remains in the prior batch.

When served through the local Node server, `/matter-init` runs a deterministic
copy-only intake operation:

- copies loose top-level matter files into `00_Inbox/Intake 01 - Initial/Source Files`
  when they are not already staged there
- reads source files from `00_Inbox/Intake 01 - Initial/Source Files`
- hashes every source file with SHA-256
- copies untouched originals into `00_Inbox/Intake 01 - Initial/Originals`
- copies working files into `00_Inbox/Intake 01 - Initial/By Type/<category>`
- classifies files by extension only (`PDFs`, `Word Documents`, `Spreadsheets`, `Images`, `Emails`, `Archives`, `Text Notes`, `Needs Review`)
- marks exact duplicates by checksum
- writes `Intake Log.csv`, `File Register.csv`, and `matter.json`

The source files are not moved or modified.
After intake exists, the Matter Explorer hides loose top-level source files that
already have staged copies in the Inbox, keeping the workspace focused on the
structured intake tree.

## Run locally

```bash
cd /Users/aks/matter_workbench
npm start
```

Then open `http://127.0.0.1:4173/`. On first launch the app asks where your
matters should live and creates that folder for you. Use **+ New Matter** in
the sidebar to create a matter, or pick an existing one from the **Matters**
list.

## Switching matters

The sidebar shows every matter under your matters home. Click any entry in the
**Matters** list to switch to it. The workspace tree, metadata, and breadcrumb
update in place — no server restart required. Use **+ New Matter** to add
another.

## Developer fallback: pinning a single matter at startup

For scripted runs or when iterating on a specific case folder, point the server
at one matter root with the `MATTER_ROOT` environment variable:

```bash
MATTER_ROOT=/Users/aks/case_naveen npm start
```

The same engine can also be invoked directly from the terminal without the UI:

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
