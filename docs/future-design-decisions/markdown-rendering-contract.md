# Markdown Rendering Contract

Date: 2026-07-02
Status: Implementation contract draft

## One-Line Decision

Matter Workbench should add one shared React markdown renderer using:

```bash
npm install react-markdown remark-gfm rehype-sanitize
```

Do **not** use `marked` for the main renderer. Do **not** use
`dangerouslySetInnerHTML` for markdown rendering.

## Why This Document Exists

Matter Workbench displays legal documents, Research answers, skill outputs,
notes, generated samples, and previews. Much of that content is markdown. Today,
formatted markdown is either shown as raw text or each feature builds its own
custom view. That creates duplicated UI logic and inconsistent safety behavior.

We need one shared renderer that is:

- safe for AI/user/matter-derived content;
- good at GitHub-Flavored Markdown tables;
- easy for React developers to use correctly;
- hard to accidentally use unsafely;
- styled with Matter Workbench CSS, not Tailwind.

## Summary Recommendation

Use `react-markdown` with `remark-gfm` and `rehype-sanitize`.

Why:

- `react-markdown` renders markdown to React elements, not raw HTML.
- It is safe by default and avoids `dangerouslySetInnerHTML`.
- `remark-gfm` adds tables, task lists, strikethrough, autolinks, and footnotes.
- `rehype-sanitize` is a belt-and-suspenders sanitizer for generated HTML nodes.
- This is safer for a legal app than manually rendering HTML strings.

Official references:

- `react-markdown` README: safe by default, no `dangerouslySetInnerHTML`, supports
  `remark-gfm`: https://github.com/remarkjs/react-markdown
- `marked` warning: Marked does **not** sanitize output HTML; use DOMPurify if
  processing unsafe strings: https://marked.js.org/
- DOMPurify is a strong sanitizer, but using it still requires `innerHTML`, which
  is a footgun for future developers: https://github.com/cure53/DOMPurify

## Explicit Rejection Of The Earlier `marked` Proposal

Do not implement this:

```tsx
import { marked } from 'marked';

marked.setOptions({ gfm: true, sanitize: true });

return <div dangerouslySetInnerHTML={{ __html: marked.parse(content) }} />;
```

Problems:

1. Current `marked` does **not** sanitize output HTML.
2. The `sanitize: true` option is not a reliable security boundary and should not
   be treated as one.
3. `dangerouslySetInnerHTML` creates an easy XSS mistake path.
4. One future developer can accidentally bypass the sanitizer and render unsafe
   HTML.

If a future bundle-size emergency forces `marked`, it must be paired with
`DOMPurify.sanitize(marked.parse(markdown))` inside one locked wrapper. That is
not the recommended V1 path.

## Scope For V1

Implement one shared markdown viewer component for ordinary display surfaces.

V1 should support:

- headings;
- paragraphs;
- bold/italic;
- lists;
- blockquotes;
- inline code;
- fenced code blocks without syntax highlighting;
- links;
- GitHub-Flavored Markdown tables;
- task lists if they appear;
- safe rendering of untrusted markdown.

V1 should **not** support:

- raw HTML embedded in markdown;
- syntax highlighting;
- arbitrary custom HTML attributes;
- Mermaid diagrams;
- iframes;
- embedded scripts;
- user-provided CSS;
- server-side markdown rendering.

## Security Rules

These are mandatory.

1. Do not use `dangerouslySetInnerHTML` for markdown.
2. Do not use `marked` in V1.
3. Do not enable `rehype-raw`.
4. Use `skipHtml` on `ReactMarkdown`.
5. Use `rehype-sanitize`.
6. Links that open a new tab must use `rel="noreferrer noopener"`.
7. Do not allow `javascript:` links.
8. Do not render raw HTML from AI, user, uploaded-file, or skill-output content.
9. Add XSS regression tests before using the component broadly.

## Dependency Change

Add dependencies:

```bash
npm install react-markdown remark-gfm rehype-sanitize
```

Expected `package.json` dependency additions:

```json
{
  "dependencies": {
    "react-markdown": "...",
    "remark-gfm": "...",
    "rehype-sanitize": "..."
  }
}
```

Do not add `marked`, `markdown-it`, `showdown`, `dompurify`, or syntax-highlighting
packages for V1.

## Files To Add

Add these files in the main Workbench repo:

```text
react-ui/src/components/common/MarkdownViewer.tsx
react-ui/src/lib/markdownSafety.ts
```

Optional if styles are large:

```text
react-ui/src/styles/markdown.css
```

But the current app mostly uses `react-ui/src/styles/global.css`, so adding the
CSS there is acceptable.

## Component Contract

### `react-ui/src/components/common/MarkdownViewer.tsx`

Implement this component:

```tsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import { safeMarkdownUrl } from '../../lib/markdownSafety';

export interface MarkdownViewerProps {
  content: string;
  className?: string;
  ariaLabel?: string;
}

export function MarkdownViewer({ content, className = '', ariaLabel }: MarkdownViewerProps) {
  const classes = ['markdown-viewer', className].filter(Boolean).join(' ');

  return (
    <div className={classes} aria-label={ariaLabel}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        skipHtml
        components={{
          a: ({ href, children, ...props }) => {
            const safeHref = safeMarkdownUrl(href || '');
            if (!safeHref) return <span>{children}</span>;
            return (
              <a {...props} href={safeHref} target="_blank" rel="noreferrer noopener">
                {children}
              </a>
            );
          },
        }}
      >
        {content || ''}
      </ReactMarkdown>
    </div>
  );
}
```

Notes for the implementer:

- `skipHtml` means markdown like `<script>alert(1)</script>` is ignored rather
  than rendered as HTML.
- `rehypeSanitize` is included even with `skipHtml` to keep plugin output safe.
- `safeMarkdownUrl` is an extra local guard for links.
- Spread component props before `href`, `target`, and `rel` so the safe URL and
  link isolation values always win if props ever collide.
- If TypeScript complains about the `a` component props, fix types narrowly. Do
  not remove the safety guard.

### `react-ui/src/lib/markdownSafety.ts`

Implement this helper:

```ts
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

export function safeMarkdownUrl(value = ''): string {
  const raw = String(value || '').trim();
  if (!raw) return '';

  // Allow local anchors such as #section.
  if (raw.startsWith('#')) return raw;

  // Block protocol-relative URLs, then allow ordinary relative app paths.
  if (raw.startsWith('//')) return '';
  if (raw.startsWith('/')) return raw;

  try {
    const url = new URL(raw, 'https://matter-workbench.local');
    if (!SAFE_PROTOCOLS.has(url.protocol)) return '';
    return raw;
  } catch {
    return '';
  }
}
```

Do not allow:

```text
javascript:alert(1)
vbscript:...
data:text/html,...
file:///...
//evil.example/path
```

## Styling Contract

Add CSS to `react-ui/src/styles/global.css`.

Use `.markdown-viewer`, not `.prose`. This repo does not use Tailwind Typography.

Suggested first CSS:

```css
/* ─── Markdown viewer ───────────────────────────────────── */
.markdown-viewer {
  color: var(--text);
  line-height: 1.65;
  overflow-wrap: anywhere;
}

.markdown-viewer > :first-child { margin-top: 0; }
.markdown-viewer > :last-child { margin-bottom: 0; }

.markdown-viewer h1,
.markdown-viewer h2,
.markdown-viewer h3,
.markdown-viewer h4 {
  color: var(--text);
  font-family: var(--display-font);
  line-height: 1.25;
  margin: 1.2em 0 0.5em;
}

.markdown-viewer h1 { font-size: 1.55rem; }
.markdown-viewer h2 { font-size: 1.32rem; }
.markdown-viewer h3 { font-size: 1.12rem; }

.markdown-viewer p,
.markdown-viewer ul,
.markdown-viewer ol,
.markdown-viewer blockquote,
.markdown-viewer table,
.markdown-viewer pre {
  margin: 0.75em 0;
}

.markdown-viewer ul,
.markdown-viewer ol {
  padding-left: 1.35rem;
}

.markdown-viewer blockquote {
  border-left: 3px solid var(--border-strong, var(--border));
  padding: 0.2rem 0 0.2rem 0.85rem;
  color: var(--muted);
}

.markdown-viewer code {
  background: var(--code-bg);
  color: var(--code-text);
  border-radius: 4px;
  padding: 0.1rem 0.25rem;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 0.92em;
}

.markdown-viewer pre {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.85rem;
  overflow: auto;
}

.markdown-viewer pre code {
  background: transparent;
  padding: 0;
}

.markdown-viewer table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.95em;
}

.markdown-viewer th,
.markdown-viewer td {
  border: 1px solid var(--border);
  padding: 0.55rem 0.65rem;
  vertical-align: top;
}

.markdown-viewer th {
  background: var(--panel-2);
  color: var(--text);
  font-weight: 650;
}

.markdown-viewer a {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.markdown-viewer input[type="checkbox"] {
  margin-right: 0.35rem;
}
```

If any CSS variable does not exist, use an existing nearby variable from
`global.css`. Do not introduce a new theme system.

## Where To Use It First

Use it narrowly first. Do not convert every markdown surface in one PR.

Recommended first targets:

1. Skill sample output preview, if currently shown as monospace raw markdown.
2. Generic `.md` file previews **except** List of Dates.
3. Research/Copilot answer body only after confirming transcript layout handles
   rendered blocks well.

Do **not** replace these in V1:

- the custom List of Dates / Case Timeline preview in
  `react-ui/src/components/layout/MainContent.tsx`;
- any specialized preview that already converts markdown into legal-specific
  structured UI;
- source-label rendering that intentionally hides raw file handles.

Why: the existing List of Dates preview parses markdown into a legal table and
lawyer-facing source labels. A generic renderer would lose that behavior.

## Implementation Steps

Follow these exactly.

### Step 1 — install dependencies

```bash
npm install react-markdown remark-gfm rehype-sanitize
```

### Step 2 — add `safeMarkdownUrl`

Create:

```text
react-ui/src/lib/markdownSafety.ts
```

Paste the helper from this document.

### Step 3 — add `MarkdownViewer`

Create:

```text
react-ui/src/components/common/MarkdownViewer.tsx
```

Paste the component from this document.

### Step 4 — add CSS

Add `.markdown-viewer` styles to:

```text
react-ui/src/styles/global.css
```

### Step 5 — add tests

Add tests before wiring broadly.

Suggested file:

```text
test/react-markdown-viewer-contract.test.mjs
```

At minimum, this test can be source-level if the existing test setup does not
mount React components. It should read `MarkdownViewer.tsx` and
`markdownSafety.ts` and assert:

- `dangerouslySetInnerHTML` is not present;
- `react-markdown` is imported;
- `remark-gfm` is imported;
- `rehype-sanitize` is imported;
- `skipHtml` is present;
- `safeMarkdownUrl` rejects `javascript:`;
- CSS contains `.markdown-viewer`.

Better test, if simple to add: import `safeMarkdownUrl` directly and assert:

```js
assert.equal(safeMarkdownUrl('javascript:alert(1)'), '');
assert.equal(safeMarkdownUrl('vbscript:alert(1)'), '');
assert.equal(safeMarkdownUrl('data:text/html,<script>x</script>'), '');
assert.equal(safeMarkdownUrl('https://example.com'), 'https://example.com');
assert.equal(safeMarkdownUrl('#heading'), '#heading');
assert.equal(safeMarkdownUrl('/workspace/file'), '/workspace/file');
assert.equal(safeMarkdownUrl('//evil.example'), '');
```

### Step 6 — wire one low-risk surface

Pick one surface. Recommended:

- generic markdown file preview path where `preview.type === 'text'` and extension
  is `.md`, but **not** List of Dates.

In `FilePreview`, add a helper like:

```ts
const isGenericMarkdown = preview.type === 'text'
  && /\.md$/i.test(preview.path)
  && !isListOfDatesMarkdown;
```

Then render:

```tsx
{isGenericMarkdown && (
  <MarkdownViewer content={preview.content || ''} ariaLabel="Markdown preview" />
)}
```

And make sure the existing raw `<pre>` branch excludes `isGenericMarkdown`.

Do not wire skill samples, Copilot answers, or activity pages in the same PR
unless explicitly asked. Keep the first PR small.

### Step 7 — run checks

Run:

```bash
npm test -- test/react-markdown-viewer-contract.test.mjs
npm run ui:typecheck
npm run ui:build
```

If a dependency adds TypeScript friction, fix types. Do not remove safety props.

## Acceptance Criteria

The first implementation is acceptable when:

1. `react-markdown`, `remark-gfm`, and `rehype-sanitize` are installed.
2. `MarkdownViewer` exists and is the only new shared markdown renderer.
3. `MarkdownViewer` does not use `dangerouslySetInnerHTML`.
4. Raw HTML in markdown is skipped/ignored.
5. GFM tables render.
6. Dangerous URLs are blocked by `safeMarkdownUrl`.
7. Generic `.md` preview uses `MarkdownViewer`.
8. List of Dates preview remains unchanged.
9. Tests cover the safety contract.
10. `npm run ui:typecheck` and `npm run ui:build` pass.

## Example Test Cases For Manual Review

Use this markdown as a manual preview sample:

```markdown
# Markdown Safety Smoke

This is **bold**, this is _italic_, and this is `inline code`.

| Date | Event | Source |
| --- | --- | --- |
| 2026-07-02 | Test table rendering | FILE-0001 |

- [x] task item
- normal item

> Blockquote should be styled but harmless.

<script>alert('xss')</script>

<img src=x onerror=alert('xss')>

[good link](https://example.com)
[bad link](javascript:alert('xss'))
```

Expected:

- heading renders;
- table renders;
- task checkbox renders or harmlessly displays;
- script does not execute and does not appear as active HTML;
- image does not execute anything;
- good link works;
- bad link is not clickable.

## Future Enhancements

Do not add these in V1:

- syntax highlighting;
- table-of-contents generation;
- heading anchors;
- copy-code buttons;
- Mermaid diagrams;
- raw HTML support.

If syntax highlighting is later needed, decide separately. Do not add
`highlight.js` or `shiki` until there is a real legal-workflow need.

## Common Mistakes To Avoid

- Do not copy blog examples that use `dangerouslySetInnerHTML`.
- Do not believe `marked` sanitizes output.
- Do not add `rehype-raw` because “HTML is not rendering.” That is intentional.
- Do not use `.prose` unless you also define it; this app has no Tailwind
  Typography.
- Do not convert List of Dates to generic markdown rendering.
- Do not implement multiple markdown renderers in different features.
- Do not add syntax highlighting in the first PR.
- Do not remove `skipHtml` to make raw HTML examples look nicer.
