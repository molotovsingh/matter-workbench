export const WEIGHTED_FAIR_SCHEDULER_VERSION = "hierarchical-weighted-fair-scheduler/v1";

export function scheduleWeightedFair(tasks = [], {
  tenantShares = {},
  intakeShares = {},
  smallJobThreshold = 4,
  smallJobBoost = 1.5,
} = {}) {
  const groups = buildGroups(tasks, { tenantShares, intakeShares, smallJobThreshold, smallJobBoost });
  const tenantState = new Map();
  const schedule = [];
  let globalVirtualTime = 0;
  while (groups.some((group) => group.tasks.length)) {
    const candidates = groups.filter((group) => group.tasks.length).map((group) => {
      const tenant = tenantState.get(group.tenantId) || { finish: globalVirtualTime };
      const task = group.tasks[0];
      const priorityBoost = clamp(1 + task.priority * 0.05, 0.5, 2);
      const effectiveWeight = task.weight / (group.effectiveShare * priorityBoost);
      const tenantFinish = Math.max(globalVirtualTime, tenant.finish) + effectiveWeight / group.tenantShare;
      const intakeFinish = Math.max(globalVirtualTime, group.finish) + effectiveWeight;
      return { group, task, priorityBoost, tenantFinish, intakeFinish, finish: Math.max(tenantFinish, intakeFinish) };
    });
    candidates.sort((left, right) => (
      left.tenantFinish - right.tenantFinish
      || left.intakeFinish - right.intakeFinish
      || left.task.createdAt.localeCompare(right.task.createdAt)
      || left.task.inputSequence - right.task.inputSequence
    ));
    const chosen = candidates[0];
    chosen.group.tasks.shift();
    chosen.group.finish = chosen.intakeFinish;
    tenantState.set(chosen.group.tenantId, { finish: chosen.tenantFinish });
    globalVirtualTime = Math.min(...Array.from(tenantState.values(), (state) => state.finish));
    schedule.push({
      ...chosen.task.original,
      scheduling: {
        schedulerVersion: WEIGHTED_FAIR_SCHEDULER_VERSION,
        sequence: schedule.length,
        tenantShare: chosen.group.tenantShare,
        intakeShare: chosen.group.intakeShare,
        smallJobBoostApplied: chosen.group.smallJobBoostApplied,
        priorityBoostApplied: chosen.priorityBoost,
        virtualFinish: chosen.finish,
      },
    });
  }
  return schedule;
}

export function admitScheduledTasks(schedule = [], { capacityByCapability = {}, maximumTasks = Infinity } = {}) {
  const used = new Map();
  const admitted = [];
  const deferred = [];
  for (const task of schedule) {
    if (admitted.length >= maximumTasks) {
      deferred.push({ ...task, admissionReason: "worker_slots_exhausted" });
      continue;
    }
    const key = capabilityKey(task.capability);
    const limit = Number(capacityByCapability[key] ?? capacityByCapability[task.capability?.provider] ?? Infinity);
    const consumed = used.get(key) || 0;
    const weight = normalizePositive(task.weight, "task.weight", 1);
    if (Number.isFinite(limit) && consumed + weight > limit) {
      deferred.push({ ...task, admissionReason: "provider_capacity_exhausted" });
      continue;
    }
    used.set(key, consumed + weight);
    admitted.push({ ...task, admissionReason: "admitted" });
  }
  return { admitted, deferred, usedCapacity: Object.fromEntries(used) };
}

function buildGroups(tasks, { tenantShares, intakeShares, smallJobThreshold, smallJobBoost }) {
  const byIntake = new Map();
  for (const [index, task] of tasks.entries()) {
    const tenantId = required(task.tenantId, `tasks[${index}].tenantId`);
    const matterId = required(task.matterId, `tasks[${index}].matterId`);
    const intakeId = required(task.intakeId, `tasks[${index}].intakeId`);
    const taskId = required(task.taskId, `tasks[${index}].taskId`);
    const groupKey = `${tenantId}\u0000${matterId}\u0000${intakeId}`;
    const group = byIntake.get(groupKey) || { tenantId, matterId, intakeId, tasks: [], finish: 0 };
    group.tasks.push({
      original: task,
      taskId,
      inputSequence: index,
      weight: normalizePositive(task.weight, `tasks[${index}].weight`, 1),
      priority: normalizePriority(task.priority),
      createdAt: normalizeDate(task.createdAt),
    });
    byIntake.set(groupKey, group);
  }
  const groups = Array.from(byIntake.values());
  for (const group of groups) {
    group.tasks.sort((left, right) => right.priority - left.priority || left.createdAt.localeCompare(right.createdAt) || left.inputSequence - right.inputSequence);
    group.tenantShare = normalizePositive(tenantShares[group.tenantId], `tenantShares.${group.tenantId}`, 1);
    group.intakeShare = normalizePositive(intakeShares[group.intakeId], `intakeShares.${group.intakeId}`, 1);
    const totalWeight = group.tasks.reduce((sum, task) => sum + task.weight, 0);
    group.smallJobBoostApplied = totalWeight <= smallJobThreshold ? clamp(smallJobBoost, 1, 2) : 1;
    group.effectiveShare = group.intakeShare * group.smallJobBoostApplied;
  }
  return groups;
}

function capabilityKey(capability = {}) {
  return `${String(capability.provider || "")}\u0000${String(capability.model || "")}\u0000${String(capability.adapterVersion || "")}`;
}

function normalizePositive(value, field, fallback) {
  if ((value === undefined || value === null || value === "") && fallback !== undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${field} must be positive`);
  return number;
}

function normalizePriority(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(-100, Math.min(100, Math.trunc(number))) : 0;
}

function normalizeDate(value) {
  const date = new Date(value || 0);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
}

function required(value, field) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function clamp(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return minimum;
  return Math.max(minimum, Math.min(maximum, number));
}
