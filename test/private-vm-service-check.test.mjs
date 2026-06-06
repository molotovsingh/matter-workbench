import assert from "node:assert/strict";
import test from "node:test";

import {
  firstPreviewableFilePath,
  parseServiceCheckArgs,
  renderPrivateVmServiceCheck,
  runPrivateVmServiceCheck,
} from "../scripts/private-vm-service-check.mjs";

test("private VM service check parses base URL and matter", () => {
  assert.deepEqual(parseServiceCheckArgs(["--base-url", "http://vm:4191/", "--matter", "Atlas"], {}), {
    baseUrl: "http://vm:4191",
    matterName: "Atlas",
  });
});

test("private VM service check walks nested workspace tree for first text preview", () => {
  const tree = {
    children: [
      { kind: "file", path: "raw.pdf", previewable: false },
      {
        kind: "directory",
        children: [
          { kind: "file", path: "10_Library/Source Index.json", previewable: true, previewKind: "text" },
        ],
      },
    ],
  };
  assert.equal(firstPreviewableFilePath(tree), "10_Library/Source Index.json");
});

test("private VM service check verifies root, matters, workspace, and preview", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push(String(url));
    const parsed = new URL(String(url));
    if (parsed.pathname === "/") return htmlResponse("<div>Matter Workbench</div>");
    if (parsed.pathname === "/api/matters") {
      return jsonResponse({
        enabled: true,
        mattersHome: null,
        matters: [{ name: "Atlas", matterName: "Atlas" }],
      });
    }
    if (parsed.pathname === "/api/switch-matter") {
      assert.equal(init?.method, "POST");
      assert.equal(JSON.parse(init.body).name, "Atlas");
      return jsonResponse({
        tree: {
          children: [
            { kind: "file", path: "10_Library/Source Index.json", previewable: true, previewKind: "text" },
          ],
        },
      });
    }
    if (parsed.pathname === "/api/file") {
      assert.equal(parsed.searchParams.get("matterName"), "Atlas");
      assert.equal(parsed.searchParams.get("path"), "10_Library/Source Index.json");
      return jsonResponse({ content: "{\"sources\":[]}" });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const report = await runPrivateVmServiceCheck({
    baseUrl: "http://vm:4191",
    fetchImpl,
  });

  assert.equal(report.passed, true);
  assert.equal(report.runtimeDbEnabled, true);
  assert.equal(report.mattersHome, null);
  assert.equal(report.matterCount, 1);
  assert.equal(report.targetMatter, "Atlas");
  assert.equal(report.filePreviewReadable, true);
  assert.equal(calls.length, 4);
});

test("private VM service check reports missing previewable file", async () => {
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(String(url));
    if (parsed.pathname === "/") return htmlResponse("<div>Matter Workbench</div>");
    if (parsed.pathname === "/api/matters") return jsonResponse({ enabled: true, mattersHome: null, matters: [{ name: "Atlas" }] });
    if (parsed.pathname === "/api/switch-matter") {
      assert.equal(init?.method, "POST");
      return jsonResponse({ tree: { children: [] } });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const report = await runPrivateVmServiceCheck({ baseUrl: "http://vm:4191", fetchImpl });
  assert.equal(report.passed, false);
  assert.match(report.error, /No previewable file/);
  assert.match(renderPrivateVmServiceCheck(report).join("\n"), /passed: no/);
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function htmlResponse(payload, status = 200) {
  return new Response(payload, {
    status,
    headers: { "content-type": "text/html" },
  });
}
