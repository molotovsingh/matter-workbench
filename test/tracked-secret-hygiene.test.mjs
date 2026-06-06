import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const requiresGitWorktree = await isInsideGitWorktree()
  ? false
  : "requires a git checkout";

async function isInsideGitWorktree() {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"]);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

async function isIgnored(pathname) {
  try {
    await execFileAsync("git", ["check-ignore", "--no-index", "-q", pathname]);
    return true;
  } catch (error) {
    if (error?.code === 1) return false;
    throw error;
  }
}

async function listTrackedFiles() {
  const { stdout } = await execFileAsync("git", ["ls-files"]);
  return stdout.split("\n").filter(Boolean);
}

test("tracked files do not contain known local VM credentials", { skip: requiresGitWorktree }, async () => {
  const trackedFiles = await listTrackedFiles();
  const forbiddenPatterns = [
    ["local VM password", new RegExp(["aks", "ingh11"].join(""))],
    ["password placeholder", new RegExp(["choose", "a", "password", "here"].join("-"))],
    ["local VM subnet", /192\.168\.210\./],
  ];
  const matches = [];

  for (const file of trackedFiles) {
    let text = "";
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    for (const [label, pattern] of forbiddenPatterns) {
      if (pattern.test(text)) matches.push(`${file}: ${label}`);
    }
  }

  assert.deepEqual(matches, []);
});

test("tracked files do not include local secret artifact names", { skip: requiresGitWorktree }, async () => {
  const trackedFiles = await listTrackedFiles();
  const allowedTrackedLocalFiles = new Set([".env.example"]);
  const forbiddenPathPatterns = [
    /(^|\/)\.env($|\.)/,
    /(^|\/)\.envrc$/,
    /(^|\/)\.direnv(\/|$)/,
    /(^|\/)\.pgpass$/,
    /(^|\/)\.pg_service\.conf$/,
    /(^|\/)\.psql_history$/,
    /(^|\/)\.psqlrc$/,
    /(^|\/)(id_rsa|id_ed25519|\.netrc|\.pypirc|\.npmrc|\.pnpmrc|\.yarnrc)$/,
    /\.(pem|key|p12|pfx|tfstate|tfvars)$/,
    /(^|\/)(\.aws|\.gcloud|\.azure|\.kube|\.docker|\.terraform|\.pulumi)(\/|$)/,
  ];
  const matches = trackedFiles.filter((file) => {
    if (allowedTrackedLocalFiles.has(file)) return false;
    return forbiddenPathPatterns.some((pattern) => pattern.test(file));
  });

  assert.deepEqual(matches, []);
});

test("local env variants are ignored while the example env remains trackable", { skip: requiresGitWorktree }, async () => {
  assert.equal(await isIgnored(".env"), true);
  assert.equal(await isIgnored(".env.local"), true);
  assert.equal(await isIgnored(".env.shadow"), true);
  assert.equal(await isIgnored(".env.development"), true);
  assert.equal(await isIgnored(".envrc"), true);
  assert.equal(await isIgnored(".direnv/"), true);
  assert.equal(await isIgnored(".env.example"), false);
});

test("repo-local Postgres credential helpers are ignored", { skip: requiresGitWorktree }, async () => {
  assert.equal(await isIgnored(".pgpass"), true);
  assert.equal(await isIgnored(".pg_service.conf"), true);
  assert.equal(await isIgnored(".psql_history"), true);
});

test("repo-local private key material is ignored", { skip: requiresGitWorktree }, async () => {
  assert.equal(await isIgnored(".psqlrc"), true);
  assert.equal(await isIgnored("id_rsa"), true);
  assert.equal(await isIgnored("id_ed25519"), true);
  assert.equal(await isIgnored("deploy.pem"), true);
  assert.equal(await isIgnored("local.key"), true);
  assert.equal(await isIgnored("cert.p12"), true);
  assert.equal(await isIgnored("cert.pfx"), true);
});

test("repo-local cloud credential stores are ignored", { skip: requiresGitWorktree }, async () => {
  assert.equal(await isIgnored(".netrc"), true);
  assert.equal(await isIgnored(".pypirc"), true);
  assert.equal(await isIgnored(".aws/"), true);
  assert.equal(await isIgnored(".gcloud/"), true);
  assert.equal(await isIgnored(".azure/"), true);
  assert.equal(await isIgnored(".kube/"), true);
  assert.equal(await isIgnored(".docker/"), true);
});

test("repo-local infrastructure state is ignored", { skip: requiresGitWorktree }, async () => {
  assert.equal(await isIgnored(".terraform/"), true);
  assert.equal(await isIgnored("terraform.tfstate"), true);
  assert.equal(await isIgnored("terraform.tfstate.backup"), true);
  assert.equal(await isIgnored("secrets.auto.tfvars"), true);
  assert.equal(await isIgnored("local.tfvars"), true);
  assert.equal(await isIgnored(".pulumi/"), true);
});

test("repo-local package manager auth files are ignored", { skip: requiresGitWorktree }, async () => {
  assert.equal(await isIgnored(".npmrc"), true);
  assert.equal(await isIgnored(".pnpmrc"), true);
  assert.equal(await isIgnored(".yarnrc"), true);
});
