import { mkdir, readFile, writeFile } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

const SCHEMA_VERSION = "skill-proposals/v1";
const STATUS_SET = new Set(["proposed", "accepted_for_dev", "dismissed"]);

export function createSkillProposalService({ appDir, proposalsPath } = {}) {
  if (!appDir && !proposalsPath) throw new Error("appDir or proposalsPath is required");
  const resolvedPath = proposalsPath || path.join(path.resolve(appDir), "skill-proposals.json");

  async function readStore() {
    try {
      return normalizeStore(JSON.parse(await readFile(resolvedPath, "utf8")));
    } catch (error) {
      if (error.code === "ENOENT") return emptyStore();
      throw error;
    }
  }

  async function writeStore(store) {
    await mkdir(path.dirname(resolvedPath), { recursive: true });
    await writeFile(resolvedPath, `${JSON.stringify(normalizeStore(store), null, 2)}\n`);
  }

  async function listProposals() {
    const store = await readStore();
    return {
      schema_version: SCHEMA_VERSION,
      proposals: [...store.proposals].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      proposals_path: resolvedPath,
    };
  }

  async function createProposal(input = {}) {
    const briefMarkdown = String(input.briefMarkdown || "").trim();
    if (!briefMarkdown) {
      const error = new Error("briefMarkdown is required");
      error.statusCode = 400;
      throw error;
    }

    const now = new Date().toISOString();
    const proposal = normalizeProposal({
      id: createProposalId(now),
      title: normalizeTitle(input.title || titleFromBrief(briefMarkdown)),
      briefMarkdown,
      routerDecision: normalizeRouterDecision(input.routerDecision),
      status: "proposed",
      createdAt: now,
      updatedAt: now,
      createdFrom: input.createdFrom || "unibox",
      matterName: input.matterName || "",
      notes: input.notes || "",
    });

    const store = await readStore();
    store.proposals = [proposal, ...store.proposals.filter((item) => item.id !== proposal.id)];
    await writeStore(store);
    return proposal;
  }

  async function updateProposalStatus(id, status) {
    const normalizedId = String(id || "").trim();
    const normalizedStatus = String(status || "").trim();
    if (!normalizedId) {
      const error = new Error("proposal id is required");
      error.statusCode = 400;
      throw error;
    }
    if (!STATUS_SET.has(normalizedStatus)) {
      const error = new Error("Invalid proposal status");
      error.statusCode = 400;
      throw error;
    }

    const store = await readStore();
    const proposal = store.proposals.find((item) => item.id === normalizedId);
    if (!proposal) {
      const error = new Error("Skill proposal not found");
      error.statusCode = 404;
      throw error;
    }

    proposal.status = normalizedStatus;
    proposal.updatedAt = new Date().toISOString();
    await writeStore(store);
    return proposal;
  }

  return {
    createProposal,
    listProposals,
    proposalsPath: resolvedPath,
    updateProposalStatus,
  };
}

function emptyStore() {
  return {
    schema_version: SCHEMA_VERSION,
    proposals: [],
  };
}

function normalizeStore(value = {}) {
  if (value?.schema_version && value.schema_version !== SCHEMA_VERSION) {
    throw new Error(`Invalid skill proposal schema: ${value.schema_version}`);
  }
  return {
    schema_version: SCHEMA_VERSION,
    proposals: Array.isArray(value.proposals) ? value.proposals.map(normalizeProposal) : [],
  };
}

function normalizeProposal(value = {}) {
  const now = new Date().toISOString();
  const status = STATUS_SET.has(value.status) ? value.status : "proposed";
  return {
    id: String(value.id || createProposalId(value.createdAt || now)),
    title: normalizeTitle(value.title || titleFromBrief(value.briefMarkdown)),
    briefMarkdown: String(value.briefMarkdown || ""),
    routerDecision: normalizeRouterDecision(value.routerDecision),
    status,
    createdAt: String(value.createdAt || now),
    updatedAt: String(value.updatedAt || value.createdAt || now),
    createdFrom: String(value.createdFrom || "unibox"),
    matterName: String(value.matterName || ""),
    notes: String(value.notes || ""),
  };
}

function normalizeRouterDecision(value = {}) {
  if (!value || typeof value !== "object") return {};
  const {
    proposalContext,
    proposalSave,
    ...decision
  } = value;
  return decision;
}

function titleFromBrief(briefMarkdown = "") {
  const heading = String(briefMarkdown || "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith("## "));
  return heading ? heading.replace(/^##\s+/, "") : "Untitled Skill";
}

function normalizeTitle(value) {
  return String(value || "Untitled Skill").replace(/\s+/g, " ").trim().slice(0, 120) || "Untitled Skill";
}

function createProposalId(value) {
  const compactDate = String(value || new Date().toISOString())
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14)
    .padEnd(14, "0");
  return `SKILL-PROP-${compactDate}-${crypto.randomUUID().slice(0, 8)}`;
}
