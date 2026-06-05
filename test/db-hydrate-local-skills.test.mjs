import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const skillsHydratorPath = new URL("../scripts/db-hydrate-local-skills.mjs", import.meta.url);
const packagePath = new URL("../package.json", import.meta.url);
const dbReadmePath = new URL("../db/README.md", import.meta.url);

test("local skill DB hydrator dry-run plans app-level skill factory rows without work-product bodies", async () => {
  const appDir = await mkdtemp(path.join(os.tmpdir(), "mwb-db-skills-"));

  try {
    await writeSkillStores(appDir);
    const {
      collectLocalSkillHydrationPlan,
      buildLocalSkillHydrationSql,
      renderSkillHydrationReport,
    } = await import(skillsHydratorPath.href);

    const plan = await collectLocalSkillHydrationPlan({ appDir });

    assert.equal(plan.mode, "dry-run");
    assert.equal(plan.databaseWrites, false);
    assert.deepEqual(plan.totals, {
      ideas: 1,
      samples: 1,
      configurableSkills: 1,
      configurableSkillVersions: 1,
      configurableSkillRuns: 1,
      skippedRuns: 1,
      warnings: 1,
    });
    assert.deepEqual(plan.plannedRows, {
      tenants: 1,
      users: 1,
      skillIdeas: 1,
      skillSamples: 1,
      configurableSkills: 1,
      configurableSkillVersions: 1,
      configurableSkillRuns: 1,
    });
    assert.match(plan.warnings[0], /orphan_run/);

    const sql = buildLocalSkillHydrationSql(plan);
    assert.match(sql, /insert into skill_ideas/i);
    assert.match(sql, /insert into skill_samples/i);
    assert.match(sql, /insert into configurable_skills/i);
    assert.match(sql, /insert into configurable_skill_versions/i);
    assert.match(sql, /insert into configurable_skill_runs/i);
    assert.doesNotMatch(sql, /DO NOT STORE THIS SAMPLE BODY/);
    assert.match(sql, /sample_markdown_object_key/i);

    const rendered = renderSkillHydrationReport(plan).join("\n");
    assert.match(rendered, /skill_ideas: 1/);
    assert.match(rendered, /configurable_skill_runs: 1/);
    assert.match(rendered, /skipped_runs: 1/);
  } finally {
    await rm(appDir, { recursive: true, force: true });
  }
});

test("local skill DB hydrator apply, verify, and inspect use psql without leaking secrets", async () => {
  const {
    applyLocalSkillHydrationPlan,
    verifyLocalSkillHydration,
    inspectLocalSkillHydration,
  } = await import(skillsHydratorPath.href);
  const plan = minimalPlan();
  const calls = [];

  const applied = applyLocalSkillHydrationPlan({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    plan,
    spawn: (command, args, options) => {
      calls.push({ command, args, input: options.input });
      return { status: 0, stdout: "COMMIT\n", stderr: "" };
    },
  });

  assert.equal(applied.databaseWrites, true);
  assert.equal(applied.insertedRows.configurableSkillRuns, 1);
  assert.match(calls[0].command, /psql$/);
  assert.doesNotMatch(JSON.stringify(calls), /secret/);

  const verified = verifyLocalSkillHydration({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    plan,
    spawn: () => ({
      status: 0,
      stdout: [
        "skill_ideas|1",
        "skill_samples|1",
        "configurable_skills|1",
        "configurable_skill_versions|1",
        "configurable_skill_runs|1",
        "",
      ].join("\n"),
      stderr: "",
    }),
  });
  assert.equal(verified.matched, true);
  assert.deepEqual(verified.mismatches, []);

  const inspected = inspectLocalSkillHydration({
    databaseUrl: "postgres://mwb_user:secret@db.example/matter_workbench_shadow",
    plan,
    spawn: () => ({
      status: 0,
      stdout: JSON.stringify([
        {
          skill_id: "00000000-0000-5000-8000-000000000001",
          title: "Party Map",
          slash: "/party_map",
          status: "active",
          version_count: 1,
          run_count: 1,
        },
      ]),
      stderr: "",
    }),
  });
  assert.equal(inspected.skills.length, 1);
  assert.equal(inspected.slashQuery, "");
  assert.equal(inspected.skills[0].slash, "/party_map");
});

test("package and database docs expose local skill shadow hydration commands", async () => {
  const pkg = JSON.parse(await readFile(packagePath, "utf8"));

  assert.equal(pkg.scripts["db:skills:hydrate:dry-run"], "node scripts/db-hydrate-local-skills.mjs --dry-run");
  assert.equal(pkg.scripts["db:skills:hydrate"], "node scripts/db-hydrate-local-skills.mjs --apply");
  assert.equal(pkg.scripts["db:skills:hydrate:verify"], "node scripts/db-hydrate-local-skills.mjs --verify");
  assert.equal(pkg.scripts["db:skills:shadow:inspect"], "node scripts/db-hydrate-local-skills.mjs --inspect");
  const readme = await readFile(dbReadmePath, "utf8");
  assert.match(readme, /npm run db:skills:hydrate:dry-run/);
  assert.match(readme, /npm run db:skills:hydrate:verify/);
  assert.match(readme, /npm run db:skills:shadow:inspect/);
});

async function writeSkillStores(appDir) {
  await mkdir(appDir, { recursive: true });
  await writeFile(path.join(appDir, "skill-ideas.json"), `${JSON.stringify({
    schema_version: "skill-ideas/v1",
    ideas: [{
      id: "idea_alpha",
      text: "Build a party map",
      status: "ready_for_review",
      matter: { matterName: "Alpha Matter", folderName: "Alpha Matter" },
      designBrief: { problem: "Map parties" },
      readiness: { ready: true },
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:01:00.000Z",
    }],
  })}\n`);
  await writeFile(path.join(appDir, "skill-samples.json"), `${JSON.stringify({
    schema_version: "skill-samples/v1",
    samples: [{
      id: "sample_alpha",
      ideaId: "idea_alpha",
      version: 1,
      approved: true,
      approvedAt: "2026-05-01T00:02:00.000Z",
      designBriefHash: "hash_alpha",
      sampleMarkdown: "DO NOT STORE THIS SAMPLE BODY",
      warnings: ["review before use"],
      createdAt: "2026-05-01T00:02:00.000Z",
      updatedAt: "2026-05-01T00:02:00.000Z",
    }],
  })}\n`);
  await writeFile(path.join(appDir, "configurable-skills.json"), `${JSON.stringify({
    schema_version: "configurable-skills/v1",
    skills: [{
      id: "skill_alpha",
      slash: "/party_map",
      title: "Party Map",
      description: "Map parties",
      status: "active",
      version: 1,
      sourceIdeaId: "idea_alpha",
      sourceSampleId: "sample_alpha",
      targetLane: "20_Workshop",
      outputArtifact: "20_Workshop/Party Map.md",
      promptConfig: { prompt: "Map parties", citationPolicy: "Cite sources" },
      modelPolicy: { task: "configurable_skill_run", provider: "openai", model: "gpt-5.4" },
      lifecycle: { statusChangedAt: "", statusChangedBy: "", reason: "", previousStatus: "" },
      createdAt: "2026-05-01T00:03:00.000Z",
      updatedAt: "2026-05-01T00:03:00.000Z",
    }],
  })}\n`);
  await writeFile(path.join(appDir, "configurable-skill-runs.json"), `${JSON.stringify({
    schema_version: "configurable-skill-runs/v1",
    runs: [
      {
        id: "run_alpha",
        skillId: "skill_alpha",
        slash: "/party_map",
        title: "Party Map",
        matterName: "Alpha Matter",
        matterFolder: "Alpha Matter",
        status: "succeeded",
        startedAt: "2026-05-01T00:04:00.000Z",
        finishedAt: "2026-05-01T00:05:00.000Z",
        outputPaths: { markdown: "20_Workshop/Party Map.md", json: "20_Workshop/Party Map.json" },
        warnings: [],
        overwrite: "not_needed",
      },
      {
        id: "orphan_run",
        skillId: "missing_skill",
        slash: "/missing",
        title: "Missing",
        status: "succeeded",
        startedAt: "2026-05-01T00:04:00.000Z",
        finishedAt: "2026-05-01T00:05:00.000Z",
      },
    ],
  })}\n`);
}

function minimalPlan() {
  return {
    tenant: { id: "00000000-0000-5000-8000-000000000010", name: "Matter Workbench Local Shadow", type: "internal_test" },
    user: { id: "00000000-0000-5000-8000-000000000011", email: "local-shadow@mwb.local", name: "Local Shadow User" },
    plannedRows: {
      tenants: 1,
      users: 1,
      skillIdeas: 1,
      skillSamples: 1,
      configurableSkills: 1,
      configurableSkillVersions: 1,
      configurableSkillRuns: 1,
    },
    ideas: [{ id: "idea_alpha", text: "Build a party map", status: "ready_for_review", designBrief: {}, readiness: {} }],
    samples: [{ id: "sample_alpha", ideaId: "idea_alpha", version: 1, approved: true, designBriefHash: "hash_alpha", sampleHash: "hash_sample" }],
    skills: [{ id: "00000000-0000-5000-8000-000000000012", localId: "skill_alpha", title: "Party Map", slash: "/party_map", status: "active", versionId: "00000000-0000-5000-8000-000000000013", version: 1, definition: {} }],
    runs: [{ id: "00000000-0000-5000-8000-000000000014", localId: "run_alpha", skillId: "00000000-0000-5000-8000-000000000012", skillVersionId: "00000000-0000-5000-8000-000000000013", status: "succeeded", receipt: {} }],
    warnings: [],
  };
}
