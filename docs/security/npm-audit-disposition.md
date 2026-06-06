# npm Audit Disposition

Status: current private beta disposition

Generated from:

```bash
npm audit --omit=dev --json
```

## xlsx

Severity: high

Current package: `xlsx@0.18.5`

Advisories:

- Prototype Pollution in SheetJS (`GHSA-4r6h-8v6p-xvw6`)
- SheetJS Regular Expression Denial of Service (`GHSA-5pgg-2g8v-p4x9`)

npm currently reports `fixAvailable: false` for the installed npm package line.

Disposition for private beta:

- accepted only for private, trusted-operator beta use;
- not acceptable as an unresolved risk for public hosted access;
- spreadsheet parsing remains a narrow intake/extraction helper, not a public
  unauthenticated upload parser;
- revisit before any broader user access, public ingress, or cloud deployment;
- preferred future direction is to replace or isolate spreadsheet parsing behind
  stricter file-size limits, timeout controls, and a safer parser/runtime.

This disposition is not a claim that the vulnerability is harmless. It is a
temporary private-beta risk acceptance because the current app is not publicly
exposed and npm does not offer a direct package upgrade fix.
