import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { hashPrivateBetaPassword } from "../services/private-beta-auth-service.mjs";

const preflightPath = new URL("../scripts/private-beta-auth-preflight.mjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);
const checklistPath = new URL("../docs/beta-operator-checklist.md", import.meta.url);
const rcDocsPath = new URL("../docs/private-beta-rc-closure-pack.md", import.meta.url);

function responseJson(body, { status = 200, cookie = "" } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return name.toLowerCase() === "set-cookie" ? cookie : "";
      },
    },
    async text() {
      return JSON.stringify(body);
    },
    async json() {
      return body;
    },
  };
}

async function writeUsersFile({ username = "aks", password = "runtime-secret", disabled = false } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mwb-auth-preflight-users-"));
  const usersFile = path.join(dir, "private-beta-users.json");
  await writeFile(usersFile, `${JSON.stringify({
    schemaVersion: "private-beta-users/v1",
    users: [
      {
        username,
        role: "operator",
        disabled,
        passwordHash: hashPrivateBetaPassword(password),
        createdAt: "2026-06-07T00:00:00.000Z",
        updatedAt: "2026-06-07T00:00:00.000Z",
      },
    ],
  }, null, 2)}\n`, "utf8");
  return usersFile;
}

test("private beta auth preflight verifies configured operator credentials against live auth", async () => {
  const { runPrivateBetaAuthPreflight, renderPrivateBetaAuthPreflight } = await import(preflightPath.href);
  const usersFile = await writeUsersFile();
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    const pathName = new URL(url).pathname;
    if (pathName === "/api/auth/login") {
      assert.deepEqual(JSON.parse(init.body), { username: "aks", password: "runtime-secret" });
      return responseJson(
        { authenticated: true, user: { username: "aks", role: "operator" } },
        { cookie: "mwb_private_beta_session=session-1; Path=/; HttpOnly" },
      );
    }
    if (pathName === "/api/auth/status") {
      assert.equal(init.headers.Cookie, "mwb_private_beta_session=session-1");
      return responseJson({ authenticated: true, user: { username: "aks", role: "operator" } });
    }
    if (pathName === "/api/auth/logout") {
      return responseJson({ authenticated: false });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const result = await runPrivateBetaAuthPreflight({
    baseUrl: "http://127.0.0.1:4191",
    username: "aks",
    password: "runtime-secret",
    usersFile,
    fetchImpl,
  });

  assert.equal(result.success, true);
  assert.equal(result.configuredUser.present, true);
  assert.equal(result.configuredUser.disabled, false);
  assert.equal(result.login.ok, true);
  assert.equal(result.authStatus.ok, true);
  assert.equal(calls.length, 3);

  const rendered = renderPrivateBetaAuthPreflight(result).join("\n");
  assert.match(rendered, /success: yes/);
  assert.doesNotMatch(rendered, /runtime-secret/);
});

test("private beta auth preflight fails clearly when runtime credentials do not authenticate", async () => {
  const { runPrivateBetaAuthPreflight, renderPrivateBetaAuthPreflight } = await import(preflightPath.href);
  const usersFile = await writeUsersFile();
  const fetchImpl = async (url) => {
    if (new URL(url).pathname === "/api/auth/login") {
      return responseJson({ error: "Invalid username or password" }, { status: 401 });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const result = await runPrivateBetaAuthPreflight({
    baseUrl: "http://127.0.0.1:4191",
    username: "aks",
    password: "wrong-runtime-secret",
    usersFile,
    fetchImpl,
  });

  assert.equal(result.success, false);
  assert.equal(result.configuredUser.present, true);
  assert.equal(result.login.ok, false);
  assert.match(result.error, /Invalid username or password/);
  assert.match(result.repairHint, /private-beta:users -- set-password/);

  const rendered = renderPrivateBetaAuthPreflight(result).join("\n");
  assert.match(rendered, /success: no/);
  assert.match(rendered, /set-password/);
  assert.doesNotMatch(rendered, /wrong-runtime-secret/);
});

test("private beta auth preflight parser reads env defaults and CLI overrides", async () => {
  const { parsePrivateBetaAuthPreflightArgs } = await import(preflightPath.href);
  const parsed = parsePrivateBetaAuthPreflightArgs([], {
    MWB_PRIVATE_VM_BASE_URL: "http://vm.local:4191/",
    MWB_PRIVATE_BETA_USERNAME: "operator",
    MWB_PRIVATE_BETA_PASSWORD: "env-secret",
    MWB_PRIVATE_BETA_USERS_FILE: "/secure/users.json",
  });
  assert.equal(parsed.baseUrl, "http://vm.local:4191");
  assert.equal(parsed.username, "operator");
  assert.equal(parsed.password, "env-secret");
  assert.equal(parsed.usersFile, "/secure/users.json");

  const overridden = parsePrivateBetaAuthPreflightArgs([
    "--base-url",
    "http://127.0.0.1:4191",
    "--username",
    "aks",
    "--password",
    "cli-secret",
    "--users-file",
    "/tmp/users.json",
    "--json",
  ], {});
  assert.equal(overridden.baseUrl, "http://127.0.0.1:4191");
  assert.equal(overridden.username, "aks");
  assert.equal(overridden.password, "cli-secret");
  assert.equal(overridden.usersFile, "/tmp/users.json");
  assert.equal(overridden.json, true);
});

test("package and operator docs expose the private beta auth preflight", async () => {
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));
  assert.equal(pkg.scripts["private-beta:auth-preflight"], "node scripts/private-beta-auth-preflight.mjs");

  const checklist = await readFile(checklistPath, "utf8");
  assert.match(checklist, /private-beta:auth-preflight/);
  assert.match(checklist, /set-password/);

  const docs = await readFile(rcDocsPath, "utf8");
  assert.match(docs, /operator auth/i);
  assert.match(docs, /private-beta:auth-preflight/);
});
