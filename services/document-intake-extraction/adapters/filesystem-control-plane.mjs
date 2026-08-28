import { open, mkdir, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const STATE_SCHEMA = "document-intake-extraction.control-plane-state/v1";

export class FilesystemControlPlane {
  constructor({ root, clock = () => new Date() } = {}) {
    if (!root) throw new Error("filesystem control-plane root is required");
    this.root = path.resolve(root);
    this.statePath = path.join(this.root, "state.json");
    this.clock = clock;
    this.tail = Promise.resolve();
  }

  async initialize() {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    try {
      await readFile(this.statePath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await atomicWriteJson(this.statePath, initialState(this.clock().toISOString()));
    }
    return this.read();
  }

  async read() {
    await this.initializeIfNeeded();
    const state = JSON.parse(await readFile(this.statePath, "utf8"));
    assertState(state);
    return structuredClone(state);
  }

  async transact(mutator) {
    if (typeof mutator !== "function") throw new Error("control-plane transaction mutator is required");
    const execute = async () => {
      const current = await this.read();
      const next = structuredClone(current);
      const result = await mutator(next);
      next.schemaVersion = STATE_SCHEMA;
      next.revision = current.revision + 1;
      next.updatedAt = this.clock().toISOString();
      await atomicWriteJson(this.statePath, next);
      return structuredClone(result);
    };
    const operation = this.tail.then(execute, execute);
    this.tail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async initializeIfNeeded() {
    try {
      await readFile(this.statePath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await this.initialize();
    }
  }
}

function initialState(now) {
  return {
    schemaVersion: STATE_SCHEMA,
    revision: 0,
    createdAt: now,
    updatedAt: now,
    idempotencyKeys: {},
    intakes: {},
    documents: {},
    blobs: {},
    workUnitByFingerprint: {},
    workUnits: {},
    attempts: [],
    costEvents: [],
    results: {},
    events: [],
  };
}

function assertState(state) {
  if (state?.schemaVersion !== STATE_SCHEMA || !Number.isInteger(state.revision)) {
    throw new Error(`unsupported or corrupt control-plane state at revision ${state?.revision ?? "unknown"}`);
  }
}

async function atomicWriteJson(target, value) {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
}
