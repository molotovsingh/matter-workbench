import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createWorkbenchServer } from "../server.mjs";

async function getJson(baseUrl, pathName) {
  const response = await fetch(`${baseUrl}${pathName}`);
  const payload = await response.json();
  assert.equal(response.ok, true, payload.error);
  return payload;
}

async function postJson(baseUrl, pathName, body = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  assert.equal(response.ok, true, payload.error);
  return payload;
}

test("matter workflow routes attach durable job status and expose it through /api/jobs", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-job-api-"));
  const appDir = path.join(tmp, "app");
  const mattersHome = path.join(tmp, "matters");
  const matterRoot = path.join(mattersHome, "Job Matter");
  await mkdir(path.join(appDir), { recursive: true });
  await mkdir(path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "Source Files"), { recursive: true });
  await writeFile(path.join(matterRoot, "00_Inbox", "Intake 01 - Initial", "Source Files", "note.txt"), "Job smoke event.");

  const app = await createWorkbenchServer({
    appDir,
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    jobStatusPath: path.join(tmp, "job-status-ledger.json"),
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    await postJson(baseUrl, "/api/switch-matter", { name: "Job Matter" });

    const init = await postJson(baseUrl, "/api/matter-init", { matterName: "Job Matter", dryRun: false });
    assert.equal(init.job.kind, "intake");
    assert.equal(init.job.status, "succeeded");
    assert.equal(init.job.matterName, "Job Matter");

    const jobs = await getJson(baseUrl, "/api/jobs?matter=Job%20Matter");
    assert.equal(jobs.schema_version, "job-status-ledger/v1");
    assert.equal(jobs.jobs.length, 1);
    assert.equal(jobs.jobs[0].kind, "intake");
    assert.equal(jobs.jobs[0].status, "succeeded");
  } finally {
    app.server.close();
  }
});

test("failed matter workflow calls leave durable failed job evidence", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-job-api-fail-"));
  const appDir = path.join(tmp, "app");
  const mattersHome = path.join(tmp, "matters");
  const matterRoot = path.join(mattersHome, "Broken Job Matter");
  await mkdir(path.join(appDir), { recursive: true });
  await mkdir(path.join(matterRoot), { recursive: true });

  const app = await createWorkbenchServer({
    appDir,
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    jobStatusPath: path.join(tmp, "job-status-ledger.json"),
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    const response = await fetch(`${baseUrl}/api/matter-init`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ matterName: "Broken Job Matter", dryRun: false }),
    });
    assert.equal(response.ok, false);

    const jobs = await getJson(baseUrl, "/api/jobs?status=failed");
    assert.equal(jobs.jobs.length, 1);
    assert.equal(jobs.jobs[0].matterName, "Broken Job Matter");
    assert.equal(jobs.jobs[0].status, "failed");
    assert.match(jobs.jobs[0].errorMessage, /Intake source folder is missing|Source Files/i);
  } finally {
    app.server.close();
  }
});

test("custom skill run route records durable job evidence", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-job-api-skill-"));
  const appDir = path.join(tmp, "app");
  const mattersHome = path.join(tmp, "matters");
  const matterRoot = path.join(mattersHome, "Skill Job Matter");
  await mkdir(appDir, { recursive: true });
  await writeExtractedTextMatter(matterRoot);
  const configurableSkillsPath = path.join(appDir, "configurable-skills.json");
  await writeFile(configurableSkillsPath, `${JSON.stringify({
    schema_version: "configurable-skills/v1",
    skills: [{
      id: "skill_story",
      slash: "/the_story",
      title: "The Story",
      description: "Tell the matter story for internal lawyer review.",
      status: "active",
      version: 1,
      familyId: "skill_story",
      targetLane: "20_Workshop",
      outputArtifact: "20_Workshop/The Story.md",
      matterRequired: true,
      paidProviderCall: true,
      sourceBacked: "required",
      promptConfig: {
        prompt: "Tell the story from the matter record.",
        citationPolicy: "Use raw FILE citations.",
      },
      modelPolicy: {
        task: "configurable_skill_run",
        provider: "openai-direct",
        model: "gpt-5.4",
        policyPromptVersion: "legal-workbench-policy/v1",
      },
      validation: { status: "passed", messages: [], validatedAt: "2026-06-06T00:00:00.000Z" },
      createdAt: "2026-06-06T00:00:00.000Z",
      updatedAt: "2026-06-06T00:00:00.000Z",
    }],
  }, null, 2)}\n`);

  const app = await createWorkbenchServer({
    appDir,
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    configurableSkillsPath,
    configurableSkillRunsPath: path.join(appDir, "configurable-skill-runs.json"),
    configurableSkillRunProvider: async () => "# The Story\n\nSkill client signed the agreement. (FILE-0001 p1.b1)\n",
    jobStatusPath: path.join(tmp, "job-status-ledger.json"),
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    await postJson(baseUrl, "/api/switch-matter", { name: "Skill Job Matter" });

    const result = await postJson(baseUrl, "/api/configurable-skills/run", {
      slash: "/the_story",
      matterName: "Skill Job Matter",
    });

    assert.equal(result.state, "written");
    assert.equal(result.job.kind, "custom_skill");
    assert.equal(result.job.status, "succeeded");
    assert.equal(result.job.matterName, "Skill Job Matter");

    const jobs = await getJson(baseUrl, "/api/jobs?kind=custom_skill");
    assert.equal(jobs.jobs.length, 1);
    assert.equal(jobs.jobs[0].label, "/the_story");
  } finally {
    app.server.close();
  }
});

async function writeExtractedTextMatter(matterRoot) {
  const intakeDir = path.join(matterRoot, "00_Inbox", "Intake 01 - Initial");
  const extractedDir = path.join(intakeDir, "_extracted");
  await mkdir(extractedDir, { recursive: true });
  await writeFile(path.join(matterRoot, "matter.json"), `${JSON.stringify({
    matter_name: "Skill Job Matter",
    client_name: "Skill Client",
    intakes: [{
      intake_id: "INTAKE-01",
      intake_dir: "00_Inbox/Intake 01 - Initial",
    }],
  }, null, 2)}\n`);
  await writeFile(path.join(intakeDir, "File Register.csv"), [
    "file_id,intake_id,source_path,original_path,working_copy_path,category,original_name,sha256,size_bytes,duplicate_of,status,engine_version,notes",
    "FILE-0001,INTAKE-01,source/facts.txt,,00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__facts.txt,Text Notes,facts.txt,aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,25,,unique,test,",
    "",
  ].join("\n"));
  await writeFile(path.join(extractedDir, "FILE-0001.json"), `${JSON.stringify({
    schema_version: "extraction-record/v1",
    file_id: "FILE-0001",
    sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    source_path: "00_Inbox/Intake 01 - Initial/By Type/Text Notes/FILE-0001__facts.txt",
    engine: "text-extract@test",
    extracted_at: "2026-04-28T10:00:00.000Z",
    page_count: 1,
    warnings: [],
    pages: [{
      page: 1,
      needs_review: false,
      blocks: [{
        id: "p1.b1",
        type: "paragraph",
        text: "Agreement was signed on 20 April 2026 by Skill Client and the opposite party.",
      }],
    }],
  }, null, 2)}\n`);
}
