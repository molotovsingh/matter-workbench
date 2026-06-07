import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  runPrivateBetaUsersCli,
} from "../scripts/private-beta-users.mjs";
import {
  verifyPrivateBetaPassword,
} from "../services/private-beta-auth-service.mjs";

test("private beta users CLI adds, lists, changes password, and disables tester accounts", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-private-beta-users-cli-"));
  const usersFile = path.join(tmp, "users.json");
  const stdout = [];

  await runPrivateBetaUsersCli({
    argv: ["add", "--file", usersFile, "--username", "tester-one", "--role", "tester", "--password", "first-secret"],
    stdout: (line) => stdout.push(line),
  });
  let store = JSON.parse(await readFile(usersFile, "utf8"));
  assert.equal(store.schemaVersion, "private-beta-users/v1");
  assert.equal(store.users.length, 1);
  assert.equal(store.users[0].username, "tester-one");
  assert.equal(store.users[0].role, "tester");
  assert.equal(store.users[0].disabled, false);
  assert.equal(verifyPrivateBetaPassword("first-secret", store.users[0].passwordHash), true);
  assert.doesNotMatch(JSON.stringify(store), /first-secret/);

  await runPrivateBetaUsersCli({
    argv: ["set-password", "--file", usersFile, "--username", "tester-one", "--password", "second-secret"],
    stdout: (line) => stdout.push(line),
  });
  store = JSON.parse(await readFile(usersFile, "utf8"));
  assert.equal(verifyPrivateBetaPassword("second-secret", store.users[0].passwordHash), true);
  assert.equal(verifyPrivateBetaPassword("first-secret", store.users[0].passwordHash), false);

  await runPrivateBetaUsersCli({
    argv: ["disable", "--file", usersFile, "--username", "tester-one"],
    stdout: (line) => stdout.push(line),
  });
  store = JSON.parse(await readFile(usersFile, "utf8"));
  assert.equal(store.users[0].disabled, true);

  await runPrivateBetaUsersCli({
    argv: ["list", "--file", usersFile],
    stdout: (line) => stdout.push(line),
  });
  assert.match(stdout.join("\n"), /tester-one/);
  assert.doesNotMatch(stdout.join("\n"), /second-secret|passwordHash/);
});

test("private beta users CLI refuses to overwrite malformed existing account files", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-private-beta-users-cli-bad-"));
  const usersFile = path.join(tmp, "users.json");
  await writeFile(usersFile, "{not-json", "utf8");
  const stderr = [];

  const exitCode = await runPrivateBetaUsersCli({
    argv: ["add", "--file", usersFile, "--username", "tester-one", "--password", "secret"],
    stdout: () => {},
    stderr: (line) => stderr.push(line),
  });

  assert.equal(exitCode, 1);
  assert.match(stderr.join("\n"), /valid JSON/);
  assert.equal(await readFile(usersFile, "utf8"), "{not-json");
});
