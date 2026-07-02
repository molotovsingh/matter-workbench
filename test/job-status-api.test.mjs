import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createWorkbenchServer } from "../server.mjs";
import { createJobStatusService } from "../services/job-status-service.mjs";
import { hashPrivateBetaPassword } from "../services/private-beta-auth-service.mjs";

async function getJson(baseUrl, pathName) {
  const response = await fetch(`${baseUrl}${pathName}`);
  const payload = await response.json();
  assert.equal(response.ok, true, payload.error);
  return payload;
}

async function getJsonWithHttp(baseUrl, pathName, { cookie = "" } = {}) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    headers: cookie ? { cookie } : {},
  });
  const payload = await response.json();
  return { response, payload };
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

test("source labels route exposes running batch progress through job status", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-job-api-source-progress-"));
  const appDir = path.join(tmp, "app");
  const mattersHome = path.join(tmp, "matters");
  const matterRoot = path.join(mattersHome, "Skill Job Matter");
  await mkdir(appDir, { recursive: true });
  await writeExtractedTextMatter(matterRoot);

  let releaseProvider;
  const providerStarted = new Promise((resolve) => {
    releaseProvider = resolve;
  });
  let continueProvider;
  const providerCanContinue = new Promise((resolve) => {
    continueProvider = resolve;
  });

  const app = await createWorkbenchServer({
    appDir,
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    jobStatusPath: path.join(tmp, "job-status-ledger.json"),
    sourceDescriptorProvider: async ({ sources }) => {
      releaseProvider();
      await providerCanContinue;
      return { sources: sources.map(sourceDescriptorForPacket) };
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    await postJson(baseUrl, "/api/switch-matter", { name: "Skill Job Matter" });

    const sourceLabels = postJson(baseUrl, "/api/describe-sources", { matterName: "Skill Job Matter" });
    let providerReleased = false;
    const releaseProviderOnce = () => {
      if (providerReleased) return;
      providerReleased = true;
      continueProvider();
    };
    try {
      await providerStarted;

      const jobs = await getJson(baseUrl, "/api/jobs?matter=Skill%20Job%20Matter&kind=source_labels");
      releaseProviderOnce();
      assert.equal(jobs.jobs.length, 1);
      assert.equal(jobs.jobs[0].status, "running");
      assert.match(jobs.jobs[0].summary, /Source Labels batch 1\/1 running/);
      assert.equal(jobs.jobs[0].metadata.sourceLabelProgress.stage, "source-labels-batch-start");
      assert.equal(jobs.jobs[0].stages[0].id, "label_pass");
      assert.equal(jobs.jobs[0].stages[0].status, "running");
      assert.match(jobs.jobs[0].stages[0].summary, /Source Labels batch 1\/1 running/);

      const result = await sourceLabels;
      assert.equal(result.job.status, "succeeded");
      assert.equal(result.job.stages[0].id, "label_pass");
      assert.equal(result.job.stages[0].status, "succeeded");
      assert.match(result.job.stages[0].summary, /Source Labels batch 1\/1 complete/);
    } finally {
      releaseProviderOnce();
      await sourceLabels.catch(() => {});
    }
  } finally {
    app.server.close();
  }
});

test("source labels all-batch failure fails the active label stage", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-job-api-source-fail-"));
  const appDir = path.join(tmp, "app");
  const mattersHome = path.join(tmp, "matters");
  const matterRoot = path.join(mattersHome, "Skill Job Matter");
  await mkdir(appDir, { recursive: true });
  await writeExtractedTextMatter(matterRoot);

  const app = await createWorkbenchServer({
    appDir,
    env: {
      MATTERS_HOME: mattersHome,
      SOURCE_DESCRIPTOR_MAX_ATTEMPTS: "1",
    },
    host: "127.0.0.1",
    port: 0,
    jobStatusPath: path.join(tmp, "job-status-ledger.json"),
    sourceDescriptorProvider: async () => {
      const error = new Error("provider returned no usable source labels");
      error.code = "provider.empty_output";
      throw error;
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    await postJson(baseUrl, "/api/switch-matter", { name: "Skill Job Matter" });

    const response = await fetch(`${baseUrl}/api/describe-sources`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ matterName: "Skill Job Matter" }),
    });
    assert.equal(response.ok, false);

    const jobs = await getJson(baseUrl, "/api/jobs?matter=Skill%20Job%20Matter&kind=source_labels");
    assert.equal(jobs.jobs.length, 1);
    assert.equal(jobs.jobs[0].status, "failed");
    assert.equal(jobs.jobs[0].stages[0].id, "label_pass");
    assert.equal(jobs.jobs[0].stages[0].status, "failed");
    assert.equal(jobs.jobs[0].stages[0].failureCode, "source_descriptors.all_batches_failed");
  } finally {
    app.server.close();
  }
});

test("job detail route exposes a native run receipt without work product", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-job-detail-"));
  const appDir = path.join(tmp, "app");
  const jobsPath = path.join(tmp, "job-status-ledger.json");
  await mkdir(appDir, { recursive: true });
  const jobStatusService = createJobStatusService({
    jobsPath,
    idFactory: () => "job_native_receipt_detail",
  });
  const job = await jobStatusService.createJob({
    kind: "posture_diagnosis",
    label: "Diagnose Procedural Posture",
    matterName: "Receipt Matter",
    metadata: {
      skill: {
        slash: "/procedural_posture_diagnosis",
        skillId: "procedural_posture_diagnosis",
      },
    },
  });
  await jobStatusService.updateJobStage(job.id, {
    id: "proposer",
    label: "Propose procedural posture",
    status: "succeeded",
    salvageable: true,
  });
  await jobStatusService.updateJobStage(job.id, {
    id: "finalizer",
    label: "Finalize procedural posture",
    status: "failed",
    failureCode: "provider.invalid_json",
    failureClass: "provider",
    errorMessage: "Unexpected end of JSON input with api_key=sk-native-secret",
  });
  const error = new Error("Unexpected end of JSON input with api_key=sk-native-secret");
  error.code = "provider.invalid_json";
  await jobStatusService.failJob(job.id, error);

  const app = await createWorkbenchServer({
    appDir,
    env: {},
    host: "127.0.0.1",
    port: 0,
    jobStatusPath: jobsPath,
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    const detail = await getJson(baseUrl, `/api/jobs/${job.id}`);
    assert.equal(detail.schema_version, "job-detail/v1");
    assert.equal(detail.job.id, job.id);
    assert.equal(detail.receipt.schema_version, "native-skill-run-receipt/v1");
    assert.equal(detail.receipt.slash, "/procedural_posture_diagnosis");
    assert.equal(detail.receipt.failure.stageId, "finalizer");
    assert.deepEqual(detail.receipt.failure.salvageableStageIds, ["proposer"]);
    assert.equal(detail.receipt.recovery.action, "retry_stage");
    assert.doesNotMatch(JSON.stringify(detail), /sk-native-secret/);

    const malformed = await getJsonWithHttp(baseUrl, "/api/jobs/%E0%A4%A");
    assert.equal(malformed.response.status, 404);
    assert.equal(malformed.payload.code, "job.not_found");
  } finally {
    app.server.close();
  }
});

test("job detail route hides other matter jobs from scoped private beta testers", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-job-detail-auth-"));
  const appDir = path.join(tmp, "app");
  const jobsPath = path.join(tmp, "job-status-ledger.json");
  const usersFile = path.join(tmp, "private-beta-users.json");
  await mkdir(appDir, { recursive: true });
  await writeFile(usersFile, `${JSON.stringify({
    schemaVersion: "private-beta-users/v1",
    users: [{
      username: "tester@example.test",
      role: "tester",
      status: "active",
      passwordHash: hashPrivateBetaPassword("tester-secret", { salt: "job-detail-salt", iterations: 1_000 }),
    }],
  }, null, 2)}\n`, "utf8");
  const jobStatusService = createJobStatusService({ jobsPath });
  const visible = await jobStatusService.createJob({
    id: "job_visible_detail",
    kind: "posture_diagnosis",
    label: "Visible Job",
    matterName: "Visible Matter",
  });
  await jobStatusService.completeJob(visible.id);
  const hidden = await jobStatusService.createJob({
    id: "job_hidden_detail",
    kind: "posture_diagnosis",
    label: "Hidden Job",
    matterName: "Hidden Matter",
  });
  await jobStatusService.completeJob(hidden.id);

  const app = await createWorkbenchServer({
    appDir,
    env: {
      MWB_PRIVATE_BETA_AUTH: "required",
      MWB_PRIVATE_BETA_USERS_FILE: usersFile,
    },
    host: "127.0.0.1",
    port: 0,
    jobStatusPath: jobsPath,
    runtimeMatterIndex: {
      enabled: true,
      listMatterFolders: async () => [{ name: "Visible Matter", folderName: "Visible Matter" }],
      findMatterFolder: async () => null,
    },
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "tester@example.test", password: "tester-secret" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];

    const visibleDetail = await getJsonWithHttp(baseUrl, `/api/jobs/${visible.id}`, { cookie });
    assert.equal(visibleDetail.response.status, 200);
    assert.equal(visibleDetail.payload.job.matterName, "Visible Matter");

    const hiddenDetail = await getJsonWithHttp(baseUrl, `/api/jobs/${hidden.id}`, { cookie });
    assert.equal(hiddenDetail.response.status, 404);
    assert.equal(hiddenDetail.payload.code, "job.not_found");
  } finally {
    app.server.close();
  }
});

test("unified native skill alias runs Matter Story through the native runner", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-native-skill-alias-story-"));
  const appDir = path.join(tmp, "app");
  const mattersHome = path.join(tmp, "matters");
  const matterRoot = path.join(mattersHome, "Skill Job Matter");
  await mkdir(appDir, { recursive: true });
  await writeExtractedTextMatter(matterRoot);
  const configurableSkillsPath = path.join(appDir, "configurable-skills.json");
  await writeFile(configurableSkillsPath, `${JSON.stringify(storySkillCatalog(), null, 2)}\n`);

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

    const result = await postJson(baseUrl, "/api/skill/the_story/run", {
      matterName: "Skill Job Matter",
      overwrite: true,
    });

    assert.equal(result.slash, "/the_story");
    assert.equal(result.job.kind, "custom_skill");
    assert.equal(result.job.metadata.skill.slash, "/the_story");
    assert.equal(result.receipt.slash, "/the_story");
    assert.equal(result.receipt.outputPaths.markdown, "20_Workshop/The Story.md");
    assert.deepEqual(result.job.stages.map((stage) => stage.id), ["sync_matter_summary"]);
  } finally {
    app.server.close();
  }
});

test("unified native skill alias can retry a failed native job", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "mwb-native-skill-alias-retry-"));
  const appDir = path.join(tmp, "app");
  const mattersHome = path.join(tmp, "matters");
  const matterRoot = path.join(mattersHome, "Skill Job Matter");
  await mkdir(appDir, { recursive: true });
  await writeExtractedTextMatter(matterRoot);
  const configurableSkillsPath = path.join(appDir, "configurable-skills.json");
  await writeFile(configurableSkillsPath, `${JSON.stringify(storySkillCatalog(), null, 2)}\n`);
  const jobStatusPath = path.join(tmp, "job-status-ledger.json");
  await writeFile(jobStatusPath, `${JSON.stringify({
    schema_version: "job-status-ledger/v1",
    jobs: [{
      schema_version: "job-status/v1",
      id: "job_failed_story_retry_source",
      kind: "custom_skill",
      label: "The Story",
      matterName: "Skill Job Matter",
      status: "failed",
      startedAt: "2026-06-06T00:00:00.000Z",
      updatedAt: "2026-06-06T00:01:00.000Z",
      finishedAt: "2026-06-06T00:01:00.000Z",
      errorMessage: "Provider returned malformed JSON.",
      errorCode: "provider.invalid_json",
      failureClass: "provider",
      stages: [{
        id: "generate",
        label: "Generate matter story",
        status: "failed",
        startedAt: "2026-06-06T00:00:10.000Z",
        finishedAt: "2026-06-06T00:01:00.000Z",
        failureCode: "provider.invalid_json",
      }],
      metadata: { skill: { slash: "/the_story", skillId: "the_story" } },
    }],
  }, null, 2)}\n`);

  const app = await createWorkbenchServer({
    appDir,
    env: { MATTERS_HOME: mattersHome },
    host: "127.0.0.1",
    port: 0,
    configurableSkillsPath,
    configurableSkillRunsPath: path.join(appDir, "configurable-skill-runs.json"),
    configurableSkillRunProvider: async () => "# The Story\n\nRetried story output. (FILE-0001 p1.b1)\n",
    jobStatusPath,
  });

  await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
  try {
    const baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    await postJson(baseUrl, "/api/switch-matter", { name: "Skill Job Matter" });

    const result = await postJson(baseUrl, "/api/skill/the_story/run", {
      matterName: "Skill Job Matter",
      retryOfJobId: "job_failed_story_retry_source",
      retryStageId: "generate",
      overwrite: true,
    });

    assert.equal(result.job.status, "succeeded");
    assert.equal(result.job.metadata.retry.ofRunId, "job_failed_story_retry_source");
    assert.equal(result.job.metadata.retry.retryStageId, undefined);
    assert.equal(result.receipt.slash, "/the_story");
    const jobs = await getJson(baseUrl, "/api/jobs?kind=custom_skill");
    assert.equal(jobs.jobs.length, 2);
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

function storySkillCatalog() {
  return {
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
  };
}

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

function sourceDescriptorForPacket(packet) {
  return {
    file_id: packet.file_id,
    sha256: packet.sha256,
    source_path: packet.source_path,
    display_label: "Facts note dated 20 April 2026",
    short_label: "Facts note dated 20 Apr 2026",
    document_type: "note",
    document_date: "2026-04-20",
    date_basis: "document_text",
    parties: {
      from: "",
      to: [],
      cc: [],
      author: "",
      court: "",
      judge: "",
      issuing_party: "",
      recipient_party: "",
      deponent: "",
      signatory: "",
    },
    confidence: 0.92,
    needs_review: false,
    evidence: [{ citation: `${packet.file_id} p1.b1`, reason: "Text identifies the source as a facts note." }],
    warnings: [],
  };
}
