import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createWorkbenchServer } from "../server.mjs";
import { createSkillProposalService } from "../services/skill-proposal-service.mjs";

async function requestJson(baseUrl, method, pathName, body) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json();
  return {
    ok: response.ok,
    status: response.status,
    payload,
  };
}

test("skill proposal service persists app-wide proposed skills", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "skill-proposals-service-"));
  const service = createSkillProposalService({ appDir });

  const empty = await service.listProposals();
  assert.equal(empty.schema_version, "skill-proposals/v1");
  assert.deepEqual(empty.proposals, []);

  const first = await service.createProposal({
    briefMarkdown: [
      "## Contradiction Map",
      "",
      "- **Purpose:** Find contradictions across extracted records.",
    ].join("\n"),
    routerDecision: {
      decision: "new_skill",
      confidence: 0.95,
      proposalContext: { briefMarkdown: "ui-only" },
    },
    matterName: "Sharma v Raheja",
  });

  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await service.createProposal({
    briefMarkdown: "## Weak Facts Analysis\n\n- **Purpose:** Rank weak facts.",
    routerDecision: {
      decision: "adjacent_skill",
      confidence: 0.86,
    },
  });

  assert.match(first.id, /^SKILL-PROP-\d{14}-[0-9a-f-]{8}$/);
  assert.equal(first.title, "Contradiction Map");
  assert.equal(first.status, "proposed");
  assert.equal(first.routerDecision.proposalContext, undefined);

  const stored = JSON.parse(await readFile(path.join(appDir, "skill-proposals.json"), "utf8"));
  assert.equal(stored.schema_version, "skill-proposals/v1");
  assert.equal(stored.proposals.length, 2);

  const listed = await service.listProposals();
  assert.equal(listed.proposals[0].id, second.id);
  assert.equal(listed.proposals[1].id, first.id);

  const updated = await service.updateProposalStatus(first.id, "accepted_for_dev");
  assert.equal(updated.status, "accepted_for_dev");
  await assert.rejects(
    () => service.updateProposalStatus(first.id, "runnable"),
    /Invalid proposal status/,
  );
});

test("skill proposal APIs save proposals without mutating the runnable registry", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "skill-proposals-api-"));
  await mkdir(appDir, { recursive: true });
  const registryPath = path.join(process.cwd(), "skills", "registry.json");
  const registryBefore = await readFile(registryPath, "utf8");
  const app = await createWorkbenchServer({
    appDir,
    env: {},
    host: "127.0.0.1",
    port: 0,
    skillRegistryPath: registryPath,
  });

  await new Promise((resolve) => app.server.listen(0, app.host, resolve));
  const address = app.server.address();
  const baseUrl = `http://${address.address}:${address.port}`;

  try {
    const empty = await requestJson(baseUrl, "GET", "/api/skill-proposals");
    assert.equal(empty.ok, true);
    assert.deepEqual(empty.payload.proposals, []);

    const created = await requestJson(baseUrl, "POST", "/api/skill-proposals", {
      briefMarkdown: "## Contradiction Map\n\n- **Purpose:** Find contradictions across records.",
      routerDecision: {
        decision: "new_skill",
        confidence: 0.95,
      },
      matterName: "Smoke Matter",
    });
    assert.equal(created.ok, true);
    assert.match(created.payload.id, /^SKILL-PROP-/);
    assert.equal(created.payload.title, "Contradiction Map");

    const listed = await requestJson(baseUrl, "GET", "/api/skill-proposals");
    assert.equal(listed.ok, true);
    assert.equal(listed.payload.proposals.length, 1);
    assert.equal(listed.payload.proposals[0].id, created.payload.id);

    const updated = await requestJson(
      baseUrl,
      "PATCH",
      `/api/skill-proposals/${encodeURIComponent(created.payload.id)}`,
      { status: "dismissed" },
    );
    assert.equal(updated.ok, true);
    assert.equal(updated.payload.status, "dismissed");

    const invalid = await requestJson(
      baseUrl,
      "PATCH",
      `/api/skill-proposals/${encodeURIComponent(created.payload.id)}`,
      { status: "runnable" },
    );
    assert.equal(invalid.ok, false);
    assert.equal(invalid.status, 400);
    assert.equal(invalid.payload.error, "Invalid proposal status");
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }

  const registryAfter = await readFile(registryPath, "utf8");
  assert.equal(registryAfter, registryBefore);
});
