import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { hashPrivateBetaPassword, verifyPrivateBetaPassword } from "../services/private-beta-auth-service.mjs";
import { createPrivateBetaUsersService } from "../services/private-beta-users-service.mjs";

test("private beta users service manages tester access without exposing password hashes", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-private-beta-users-service-"));
  const usersFile = path.join(tmp, "users.json");
  const service = createPrivateBetaUsersService({
    usersFile,
    now: () => "2026-06-11T08:00:00.000Z",
    generatePassword: () => "temp-test-password",
  });

  const created = await service.addTester({
    username: "shivangi@lawzeus.com",
    displayName: "Shivangi",
  });

  assert.equal(created.user.username, "shivangi@lawzeus.com");
  assert.equal(created.user.role, "tester");
  assert.equal(created.user.disabled, false);
  assert.equal(created.temporaryPassword, "temp-test-password");
  assert.doesNotMatch(JSON.stringify(created), /passwordHash/);

  const store = JSON.parse(await readFile(usersFile, "utf8"));
  assert.equal(verifyPrivateBetaPassword("temp-test-password", store.users[0].passwordHash), true);
  const mode = (await stat(usersFile)).mode & 0o777;
  assert.equal(mode, 0o600);

  const listed = await service.listUsers();
  assert.equal(listed.users.length, 1);
  assert.deepEqual(listed.users[0], created.user);
  assert.doesNotMatch(JSON.stringify(listed), /passwordHash|temp-test-password/);

  const reset = await service.resetPassword("shivangi@lawzeus.com");
  assert.equal(reset.temporaryPassword, "temp-test-password");
  assert.equal(reset.user.username, "shivangi@lawzeus.com");
  assert.doesNotMatch(JSON.stringify(reset), /passwordHash/);

  const disabled = await service.setUserDisabled("shivangi@lawzeus.com", true);
  assert.equal(disabled.user.disabled, true);

  const enabled = await service.setUserDisabled("shivangi@lawzeus.com", false);
  assert.equal(enabled.user.disabled, false);
});

test("private beta users service preserves the last superuser account", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-private-beta-users-service-last-superuser-"));
  const usersFile = path.join(tmp, "users.json");
  await writeFile(usersFile, `${JSON.stringify({
    schemaVersion: "private-beta-users/v1",
    users: [
      {
        username: "aksingh",
        displayName: "AK Singh",
        role: "superuser",
        disabled: false,
        passwordHash: hashPrivateBetaPassword("secret", { salt: "last-superuser", iterations: 1_000 }),
        createdAt: "2026-06-11T07:00:00.000Z",
        updatedAt: "2026-06-11T07:00:00.000Z",
      },
    ],
  }, null, 2)}\n`, "utf8");
  const service = createPrivateBetaUsersService({ usersFile });

  await assert.rejects(
    () => service.setUserDisabled("aksingh", true),
    /Cannot disable the last active superuser/,
  );
});
