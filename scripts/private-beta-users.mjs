import { mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  hashPrivateBetaPassword,
  readPrivateBetaUsersFile,
} from "../services/private-beta-auth-service.mjs";
import { writeFileAtomic } from "../shared/atomic-file.mjs";

const SCHEMA_VERSION = "private-beta-users/v1";

export async function runPrivateBetaUsersCli({
  argv = process.argv.slice(2),
  stdin = process.stdin,
  stdout = (line) => console.log(line),
  stderr = (line) => console.error(line),
} = {}) {
  try {
    const { command, options } = parseArgs(argv);
    if (!command || command === "help" || options.help) {
      stdout(usage());
      return 0;
    }
    if (command === "list") {
      await listUsers(options, stdout);
      return 0;
    }
    if (command === "add") {
      await addUser(options, stdin, stdout);
      return 0;
    }
    if (command === "set-password") {
      await setPassword(options, stdin, stdout);
      return 0;
    }
    if (command === "disable" || command === "enable") {
      await setDisabled(options, command === "disable", stdout);
      return 0;
    }
    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    stderr(error.message);
    return 1;
  }
}

async function listUsers(options, stdout) {
  const storePath = requireOption(options, "file");
  const store = await readStore(storePath);
  if (!store.users.length) {
    stdout("No private beta tester accounts configured.");
    return;
  }
  for (const user of store.users) {
    const state = user.disabled ? "disabled" : "active";
    stdout(`${user.username}\t${user.role || "tester"}\t${state}`);
  }
}

async function addUser(options, stdin, stdout) {
  const storePath = requireOption(options, "file");
  const username = normalizeUsername(requireOption(options, "username"));
  const password = await readPassword(options, stdin);
  const role = normalizeRole(options.role);
  const displayName = String(options["display-name"] || "").trim();
  const now = new Date().toISOString();
  const store = await readStore(storePath);
  const existing = findUser(store, username);
  const nextUser = {
    username,
    displayName,
    role,
    disabled: false,
    passwordHash: hashPrivateBetaPassword(password),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  if (existing) {
    Object.assign(existing, nextUser);
    stdout(`Updated private beta account: ${username}`);
  } else {
    store.users.push(nextUser);
    stdout(`Added private beta account: ${username}`);
  }
  await writeStore(storePath, store);
}

async function setPassword(options, stdin, stdout) {
  const storePath = requireOption(options, "file");
  const username = normalizeUsername(requireOption(options, "username"));
  const password = await readPassword(options, stdin);
  const store = await readStore(storePath);
  const user = findUser(store, username);
  if (!user) throw new Error(`No private beta account found for ${username}.`);
  user.passwordHash = hashPrivateBetaPassword(password);
  user.updatedAt = new Date().toISOString();
  await writeStore(storePath, store);
  stdout(`Updated private beta password: ${username}`);
}

async function setDisabled(options, disabled, stdout) {
  const storePath = requireOption(options, "file");
  const username = normalizeUsername(requireOption(options, "username"));
  const store = await readStore(storePath);
  const user = findUser(store, username);
  if (!user) throw new Error(`No private beta account found for ${username}.`);
  user.disabled = disabled;
  user.updatedAt = new Date().toISOString();
  await writeStore(storePath, store);
  stdout(`${disabled ? "Disabled" : "Enabled"} private beta account: ${username}`);
}

async function readStore(storePath) {
  const expandedPath = expandHomePath(storePath);
  let rawText;
  try {
    rawText = await readFile(expandedPath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return { schemaVersion: SCHEMA_VERSION, users: [] };
    throw error;
  }
  const users = readPrivateBetaUsersFile(expandedPath);
  const raw = JSON.parse(rawText);
  return {
    schemaVersion: SCHEMA_VERSION,
    users: raw.users.map((user, index) => ({
      ...user,
      username: users[index].username,
      role: users[index].role,
      disabled: users[index].disabled,
    })),
  };
}

async function writeStore(storePath, store) {
  const expandedPath = expandHomePath(storePath);
  await mkdir(path.dirname(expandedPath), { recursive: true });
  await writeFileAtomic(expandedPath, `${JSON.stringify(normalizeStoreForWrite(store), null, 2)}\n`, { encoding: "utf8" });
}

function normalizeStoreForWrite(store) {
  return {
    schemaVersion: SCHEMA_VERSION,
    users: store.users
      .map((user) => ({
        username: normalizeUsername(user.username),
        displayName: String(user.displayName || "").trim(),
        role: normalizeRole(user.role),
        disabled: Boolean(user.disabled),
        passwordHash: String(user.passwordHash || ""),
        createdAt: String(user.createdAt || ""),
        updatedAt: String(user.updatedAt || ""),
      }))
      .sort((left, right) => left.username.localeCompare(right.username)),
  };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    if (key === "password-stdin" || key === "help") {
      options[key] = true;
      continue;
    }
    if (key === "password") {
      throw new Error("Use --password-stdin. Password values must not be supplied through command arguments.");
    }
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    options[key] = value;
    index += 1;
  }
  return { command, options };
}

async function readPassword(options, stdin) {
  if (options["password-stdin"]) {
    const chunks = [];
    for await (const chunk of stdin) chunks.push(Buffer.from(chunk));
    const password = Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
    if (!password) throw new Error("Password from stdin is empty.");
    return password;
  }
  throw new Error("Password is required. Use --password-stdin.");
}

function findUser(store, username) {
  const key = username.toLowerCase();
  return store.users.find((user) => String(user.username || "").trim().toLowerCase() === key) || null;
}

function requireOption(options, key) {
  const value = String(options[key] || "").trim();
  if (!value) throw new Error(`Missing required --${key}.`);
  return value;
}

function normalizeUsername(username) {
  const value = String(username || "").trim();
  if (!value) throw new Error("Username is required.");
  if (!/^[A-Za-z0-9._@-]{2,80}$/.test(value)) {
    throw new Error("Username may use letters, numbers, dot, underscore, dash, or @, and must be 2-80 characters.");
  }
  return value;
}

function normalizeRole(role) {
  const normalized = String(role || "tester").trim().toLowerCase();
  if (["operator", "tester"].includes(normalized)) return normalized;
  throw new Error("Role must be operator or tester.");
}

function expandHomePath(filePath) {
  const value = String(filePath || "").trim();
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/private-beta-users.mjs list --file <users.json>",
    "  node scripts/private-beta-users.mjs add --file <users.json> --username <name> --password-stdin [--role tester|operator]",
    "  node scripts/private-beta-users.mjs set-password --file <users.json> --username <name> --password-stdin",
    "  node scripts/private-beta-users.mjs disable --file <users.json> --username <name>",
    "  node scripts/private-beta-users.mjs enable --file <users.json> --username <name>",
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const exitCode = await runPrivateBetaUsersCli();
  process.exitCode = exitCode;
}
