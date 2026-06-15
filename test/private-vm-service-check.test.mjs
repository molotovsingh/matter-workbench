import assert from "node:assert/strict";
import test from "node:test";

import {
  firstPreviewableFilePath,
  parseServiceCheckArgs,
  renderPrivateVmServiceCheck,
  resolveServiceCheckArgs,
  runPrivateVmServiceCheck,
} from "../scripts/private-vm-service-check.mjs";
import { Readable } from "node:stream";

test("private VM service check parses base URL and matter", () => {
  assert.deepEqual(parseServiceCheckArgs(["--base-url", "http://vm:4191/", "--matter", "Atlas"], {}), {
    baseUrl: "http://vm:4191",
    matterName: "Atlas",
    authUsername: "",
    authPassword: "",
    authPasswordStdin: false,
  });
});

test("private VM service check rejects password command arguments", () => {
  assert.throws(
    () => parseServiceCheckArgs(["--auth-username", "operator", "--auth-password", "secret"], {}),
    /does not accept password arguments/i,
  );
});

test("private VM service check accepts protected env credentials", () => {
  assert.deepEqual(parseServiceCheckArgs([], {
    MWB_PRIVATE_VM_BASE_URL: "http://vm:4191/",
    MWB_PRIVATE_BETA_USERNAME: "operator",
    MWB_PRIVATE_BETA_PASSWORD: "secret",
  }), {
    baseUrl: "http://vm:4191",
    matterName: "",
    authUsername: "operator",
    authPassword: "secret",
    authPasswordStdin: false,
  });
});

test("private VM service check can read auth password from stdin", async () => {
  const parsed = parseServiceCheckArgs(["--auth-username", "operator", "--auth-password-stdin"], {});

  assert.equal(parsed.authUsername, "operator");
  assert.equal(parsed.authPassword, "");
  assert.equal(parsed.authPasswordStdin, true);

  const resolved = await resolveServiceCheckArgs(parsed, Readable.from(["secret\n"]));

  assert.equal(resolved.authUsername, "operator");
  assert.equal(resolved.authPassword, "secret");
  assert.equal(resolved.authPasswordStdin, false);
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

test("private VM service check restores the previously active matter after probing another matter", async () => {
  const switchedTo = [];
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(String(url));
    if (parsed.pathname === "/") return htmlResponse("<div>Matter Workbench</div>");
    if (parsed.pathname === "/api/matters") {
      return jsonResponse({
        enabled: true,
        mattersHome: null,
        active: "Client Matter",
        matters: [
          { name: "Probe Matter", matterName: "Probe Matter" },
          { name: "Client Matter", matterName: "Client Matter" },
        ],
      });
    }
    if (parsed.pathname === "/api/switch-matter") {
      assert.equal(init?.method, "POST");
      const body = JSON.parse(init.body);
      switchedTo.push(body.name);
      return jsonResponse({
        tree: {
          children: [
            { kind: "file", path: "matter.json", previewable: true, previewKind: "text" },
          ],
        },
      });
    }
    if (parsed.pathname === "/api/file") return jsonResponse({ content: "{\"matterName\":\"Probe Matter\"}" });
    throw new Error(`Unexpected URL: ${url}`);
  };

  const report = await runPrivateVmServiceCheck({ baseUrl: "http://vm:4191", fetchImpl });

  assert.equal(report.passed, true);
  assert.equal(report.targetMatter, "Probe Matter");
  assert.deepEqual(switchedTo, ["Probe Matter", "Client Matter"]);
});

test("private VM service check does not restore when the probed matter was already active", async () => {
  const switchedTo = [];
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(String(url));
    if (parsed.pathname === "/") return htmlResponse("<div>Matter Workbench</div>");
    if (parsed.pathname === "/api/matters") {
      return jsonResponse({
        enabled: true,
        mattersHome: null,
        active: "Probe Matter",
        matters: [{ name: "Probe Matter", matterName: "Probe Matter" }],
      });
    }
    if (parsed.pathname === "/api/switch-matter") {
      const body = JSON.parse(init.body);
      switchedTo.push(body.name);
      return jsonResponse({
        tree: {
          children: [
            { kind: "file", path: "matter.json", previewable: true, previewKind: "text" },
          ],
        },
      });
    }
    if (parsed.pathname === "/api/file") return jsonResponse({ content: "{\"matterName\":\"Probe Matter\"}" });
    throw new Error(`Unexpected URL: ${url}`);
  };

  const report = await runPrivateVmServiceCheck({ baseUrl: "http://vm:4191", fetchImpl });

  assert.equal(report.passed, true);
  assert.deepEqual(switchedTo, ["Probe Matter"]);
});

test("private VM service check does not restore a stale active matter absent from the matter list", async () => {
  const switchedTo = [];
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(String(url));
    if (parsed.pathname === "/") return htmlResponse("<div>Matter Workbench</div>");
    if (parsed.pathname === "/api/matters") {
      return jsonResponse({
        enabled: true,
        mattersHome: null,
        active: "Runtime DB Write Smoke - stale",
        matters: [{ name: "Client Matter", matterName: "Client Matter" }],
      });
    }
    if (parsed.pathname === "/api/switch-matter") {
      const body = JSON.parse(init.body);
      switchedTo.push(body.name);
      assert.equal(body.name, "Client Matter");
      return jsonResponse({
        tree: {
          children: [
            { kind: "file", path: "matter.json", previewable: true, previewKind: "text" },
          ],
        },
      });
    }
    if (parsed.pathname === "/api/file") return jsonResponse({ content: "{\"matterName\":\"Client Matter\"}" });
    throw new Error(`Unexpected URL: ${url}`);
  };

  const report = await runPrivateVmServiceCheck({ baseUrl: "http://vm:4191", fetchImpl });

  assert.equal(report.passed, true);
  assert.equal(report.warning, "");
  assert.deepEqual(switchedTo, ["Client Matter"]);
});

test("private VM service check tries to restore active matter when the probe switch fails", async () => {
  const switchedTo = [];
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(String(url));
    if (parsed.pathname === "/") return htmlResponse("<div>Matter Workbench</div>");
    if (parsed.pathname === "/api/matters") {
      return jsonResponse({
        enabled: true,
        mattersHome: null,
        active: "Client Matter",
        matters: [
          { name: "Probe Matter", matterName: "Probe Matter" },
          { name: "Client Matter", matterName: "Client Matter" },
        ],
      });
    }
    if (parsed.pathname === "/api/switch-matter") {
      const body = JSON.parse(init.body);
      switchedTo.push(body.name);
      if (body.name === "Probe Matter") {
        throw new Error("switch failed after partial state change");
      }
      return jsonResponse({ tree: { children: [] } });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const report = await runPrivateVmServiceCheck({ baseUrl: "http://vm:4191", fetchImpl });

  assert.equal(report.passed, false);
  assert.match(report.error, /switch failed after partial state change/);
  assert.deepEqual(switchedTo, ["Probe Matter", "Client Matter"]);
});

test("private VM service check logs in when private beta credentials are supplied", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const parsed = new URL(String(url));
    if (parsed.pathname === "/") return htmlResponse("<div>Matter Workbench</div>");
    if (parsed.pathname === "/api/auth/login") {
      assert.equal(init.method, "POST");
      assert.deepEqual(JSON.parse(init.body), { username: "operator", password: "secret" });
      return jsonResponse({ authenticated: true }, 200, { "set-cookie": "mwb_private_beta_session=abc; Path=/; HttpOnly" });
    }
    assert.equal(init.headers?.cookie, "mwb_private_beta_session=abc");
    if (parsed.pathname === "/api/matters") return jsonResponse({ enabled: true, mattersHome: null, matters: [{ name: "Atlas" }] });
    if (parsed.pathname === "/api/switch-matter") return jsonResponse({ tree: { children: [{ kind: "file", path: "note.txt", previewable: true, previewKind: "text" }] } });
    if (parsed.pathname === "/api/file") return jsonResponse({ content: "note" });
    throw new Error(`Unexpected URL: ${url}`);
  };

  const report = await runPrivateVmServiceCheck({
    baseUrl: "http://vm:4191",
    authUsername: "operator",
    authPassword: "secret",
    fetchImpl,
  });

  assert.equal(report.passed, true);
  assert.equal(report.authenticated, true);
  assert.equal(calls.some((call) => call.url.includes("/api/auth/login")), true);
});

test("private VM service check preserves authenticated state when no matters are visible", async () => {
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(String(url));
    if (parsed.pathname === "/") return htmlResponse("<div>Matter Workbench</div>");
    if (parsed.pathname === "/api/auth/login") {
      assert.equal(init.method, "POST");
      return jsonResponse({ authenticated: true }, 200, { "set-cookie": "mwb_private_beta_session=abc; Path=/; HttpOnly" });
    }
    assert.equal(init.headers?.cookie, "mwb_private_beta_session=abc");
    if (parsed.pathname === "/api/matters") return jsonResponse({ enabled: true, mattersHome: null, matters: [] });
    throw new Error(`Unexpected URL: ${url}`);
  };

  const report = await runPrivateVmServiceCheck({
    baseUrl: "http://vm:4191",
    authUsername: "operator",
    authPassword: "secret",
    fetchImpl,
  });

  assert.equal(report.passed, false);
  assert.equal(report.authenticated, true);
  assert.match(report.error, /No matters returned/);
  assert.match(renderPrivateVmServiceCheck(report).join("\n"), /authenticated: yes/);
});

test("private VM service check passes without preview when no lawyer-visible text file exists", async () => {
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
  assert.equal(report.passed, true);
  assert.equal(report.filePreviewReadable, false);
  assert.match(report.warning, /No previewable file/);
  assert.match(renderPrivateVmServiceCheck(report).join("\n"), /passed: yes/);
  assert.match(renderPrivateVmServiceCheck(report).join("\n"), /warning: No previewable file/);
});

test("private VM service check includes available matter names when target matter is missing", async () => {
  const fetchImpl = async (url) => {
    const parsed = new URL(String(url));
    if (parsed.pathname === "/") return htmlResponse("<div>Matter Workbench</div>");
    if (parsed.pathname === "/api/matters") {
      return jsonResponse({
        enabled: true,
        mattersHome: null,
        matters: [
          { name: "Atlas Constuction vs Diptishree" },
          { name: "Bharat Nagpal Vs Gionee India" },
        ],
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const report = await runPrivateVmServiceCheck({
    baseUrl: "http://vm:4191",
    matterName: "Atlas Construction vs Diptishree",
    fetchImpl,
  });

  assert.equal(report.passed, false);
  assert.match(report.error, /Matter not found/);
  assert.deepEqual(report.availableMatterNames, [
    "Atlas Constuction vs Diptishree",
    "Bharat Nagpal Vs Gionee India",
  ]);
  assert.match(renderPrivateVmServiceCheck(report).join("\n"), /available_matter_names: Atlas Constuction vs Diptishree; Bharat Nagpal Vs Gionee India/);
});

test("private VM service check reports network failures as structured evidence", async () => {
  const report = await runPrivateVmServiceCheck({
    baseUrl: "http://172.16.37.128:4191",
    fetchImpl: async () => {
      throw new Error("fetch failed");
    },
  });

  assert.equal(report.passed, false);
  assert.equal(report.rootOk, false);
  assert.match(report.error, /fetch failed/);
  assert.match(renderPrivateVmServiceCheck(report).join("\n"), /error: .*fetch failed/);
});

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function htmlResponse(payload, status = 200) {
  return new Response(payload, {
    status,
    headers: { "content-type": "text/html" },
  });
}
