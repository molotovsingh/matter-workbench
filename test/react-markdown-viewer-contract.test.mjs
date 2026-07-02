import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";

const packageJsonPath = new URL("../package.json", import.meta.url);
const markdownViewerPath = new URL("../react-ui/src/components/common/MarkdownViewer.tsx", import.meta.url);
const markdownSafetyPath = new URL("../react-ui/src/lib/markdownSafety.ts", import.meta.url);
const mainContentPath = new URL("../react-ui/src/components/layout/MainContent.tsx", import.meta.url);
const globalCssPath = new URL("../react-ui/src/styles/global.css", import.meta.url);

test("Markdown viewer contract uses the approved safe renderer stack", async () => {
  const pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const viewer = await readFile(markdownViewerPath, "utf8");
  const safety = await readFile(markdownSafetyPath, "utf8");
  const css = await readFile(globalCssPath, "utf8");

  assert.ok(pkg.dependencies["react-markdown"], "react-markdown should be installed");
  assert.ok(pkg.dependencies["remark-gfm"], "remark-gfm should be installed");
  assert.ok(pkg.dependencies["rehype-sanitize"], "rehype-sanitize should be installed");
  assert.equal(pkg.dependencies.marked, undefined, "marked should not be installed for V1 markdown rendering");

  assert.match(viewer, /from 'react-markdown'/);
  assert.match(viewer, /from 'remark-gfm'/);
  assert.match(viewer, /from 'rehype-sanitize'/);
  assert.match(viewer, /skipHtml/);
  assert.match(viewer, /safeMarkdownUrl/);
  assert.match(viewer, /rel="noreferrer noopener"/);
  assert.match(viewer, /<a \{\.\.\.props\} href=\{safeHref\}/);
  assert.doesNotMatch(viewer, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(viewer, /rehypeRaw|rehype-raw/);
  assert.doesNotMatch(safety, /dangerouslySetInnerHTML/);
  assert.match(css, /\.markdown-viewer/);
  assert.match(css, /width: min\(100%, 794px\)/);
  assert.match(css, /margin: 0 auto/);
  assert.match(css, /font-size: 15px/);
  assert.match(css, /\.markdown-viewer p,\n\.markdown-viewer li \{[\s\S]*color: var\(--text\);[\s\S]*font-size: inherit;[\s\S]*line-height: 1\.65;[\s\S]*max-width: none;/);
  assert.match(css, /\.markdown-viewer p \{ text-align: justify; text-justify: inter-word; \}/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /\.markdown-viewer p \{ text-align: left; \}/);
});

test("safeMarkdownUrl rejects dangerous URL schemes", async () => {
  const { safeMarkdownUrl } = await importMarkdownSafety();

  assert.equal(safeMarkdownUrl("javascript:alert(1)"), "");
  assert.equal(safeMarkdownUrl("vbscript:alert(1)"), "");
  assert.equal(safeMarkdownUrl("data:text/html,<script>x</script>"), "");
  assert.equal(safeMarkdownUrl("file:///tmp/secret"), "");
  assert.equal(safeMarkdownUrl("//evil.example/path"), "");
  assert.equal(safeMarkdownUrl("https://example.com"), "https://example.com");
  assert.equal(safeMarkdownUrl("mailto:lawyer@example.com"), "mailto:lawyer@example.com");
  assert.equal(safeMarkdownUrl("#heading"), "#heading");
  assert.equal(safeMarkdownUrl("/workspace/file"), "/workspace/file");
});

test("generic Markdown previews use MarkdownViewer without replacing Case Timeline preview", async () => {
  const mainContent = await readFile(mainContentPath, "utf8");

  assert.match(mainContent, /lazy\(\(\) => import\('\.\.\/common\/MarkdownViewer'\)/);
  assert.match(mainContent, /<Suspense fallback=\{<p className="muted">Rendering Markdown preview…<\/p>\}>/);
  assert.match(mainContent, /const isGenericMarkdown = preview\.type === 'text' && \/\\\.md\$\/i\.test\(preview\.path\) && !isListOfDatesMarkdown/);
  assert.match(mainContent, /<MarkdownViewer content=\{preview\.content \|\| ''\} ariaLabel="Markdown preview" \/>/);
  assert.match(mainContent, /<ListOfDatesMarkdownPreview parsed=\{listOfDates\} \/>/);
  assert.match(mainContent, /preview\.type === 'text' && !isGenericMarkdown/);
});

async function importMarkdownSafety() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mwb-markdown-safety-"));
  const tempFile = path.join(tempDir, "markdownSafety.mjs");
  try {
    const source = await readFile(markdownSafetyPath, "utf8");
    await writeFile(tempFile, transpile(source));
    return await import(`${tempFile}?t=${Date.now()}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
}
