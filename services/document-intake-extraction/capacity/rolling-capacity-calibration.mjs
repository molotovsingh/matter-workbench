const CALIBRATION_SCHEMA = "document-intake-extraction.capacity-calibration/v1";

export class RollingCapacityCalibration {
  constructor({ maximumSamplesPerKey = 200 } = {}) {
    this.maximumSamplesPerKey = Math.max(10, Math.trunc(maximumSamplesPerKey));
    this.corpora = new Map();
    this.providers = new Map();
  }

  recordCorpus({ workloadClass = "default", bytes, pages, ocrPages = pages, repairPages = 0 } = {}) {
    const normalizedBytes = positiveNumber(bytes, "bytes");
    const normalizedPages = positiveNumber(pages, "pages");
    const sample = {
      pagesPerByte: normalizedPages / normalizedBytes,
      ocrShare: clamp(Number(ocrPages) / normalizedPages, 0, 1),
      repairShare: clamp(Number(repairPages) / normalizedPages, 0, 1),
    };
    pushSample(this.corpora, String(workloadClass || "default"), sample, this.maximumSamplesPerKey);
    return sample;
  }

  recordProvider({ provider, model, adapterVersion, pageOperations, durationMs, outcome = "success", throttled = false } = {}) {
    const key = providerKey({ provider, model, adapterVersion });
    const operations = positiveNumber(pageOperations, "pageOperations");
    const milliseconds = positiveNumber(durationMs, "durationMs");
    const normalizedOutcome = throttled ? "throttled" : normalizeOutcome(outcome);
    const sample = {
      pageOperationsPerSecond: operations / (milliseconds / 1000),
      latencyMsPerOperation: milliseconds / operations,
      outcome: normalizedOutcome,
      throttled: normalizedOutcome === "throttled",
    };
    pushSample(this.providers, key, sample, this.maximumSamplesPerKey);
    return sample;
  }

  estimateCorpus(workloadClass = "default", fallback = {}) {
    const samples = this.corpora.get(String(workloadClass || "default")) || [];
    const densities = samples.map((sample) => sample.pagesPerByte);
    const ocrShares = samples.map((sample) => sample.ocrShare);
    const repairShares = samples.map((sample) => sample.repairShare);
    const medianDensity = quantile(densities, 0.5, positiveNumber(fallback.pagesPerByte, "fallback.pagesPerByte", 1 / (256 * 1024)));
    return {
      sampleCount: samples.length,
      pagesPerByte: {
        low: quantile(densities, 0.1, medianDensity * 0.5),
        median: medianDensity,
        high: quantile(densities, 0.9, medianDensity * 2),
      },
      ocrShare: quantile(ocrShares, 0.5, finiteFallback(fallback.ocrShare, 1)),
      repairShare: quantile(repairShares, 0.8, finiteFallback(fallback.repairShare, 0.05)),
    };
  }

  estimateProvider(capability, fallback = {}) {
    const samples = this.providers.get(providerKey(capability)) || [];
    const successful = samples.filter((sample) => sampleOutcome(sample) === "success");
    const throughputs = successful.map((sample) => sample.pageOperationsPerSecond);
    const latencies = successful.map((sample) => sample.latencyMsPerOperation);
    const throttleRate = samples.length ? samples.filter((sample) => sampleOutcome(sample) === "throttled").length / samples.length : finiteFallback(fallback.throttleRate, 0);
    const failureRate = samples.length ? samples.filter((sample) => sampleOutcome(sample) === "failed").length / samples.length : finiteFallback(fallback.failureRate, 0);
    const medianThroughput = quantile(throughputs, 0.5, positiveNumber(fallback.pageOperationsPerSecond, "fallback.pageOperationsPerSecond", 1));
    return {
      sampleCount: samples.length,
      successfulSampleCount: successful.length,
      pageOperationsPerSecond: {
        conservative: quantile(throughputs, 0.1, medianThroughput * 0.5),
        median: medianThroughput,
        optimistic: quantile(throughputs, 0.9, medianThroughput * 1.25),
      },
      latencyMsPerOperation: {
        median: quantile(latencies, 0.5, 1000 / medianThroughput),
        p95: quantile(latencies, 0.95, 2000 / medianThroughput),
      },
      throttleRate,
      failureRate,
    };
  }

  snapshot() {
    return {
      schemaVersion: CALIBRATION_SCHEMA,
      maximumSamplesPerKey: this.maximumSamplesPerKey,
      corpora: Object.fromEntries(Array.from(this.corpora.entries()).map(([key, samples]) => [key, structuredClone(samples)])),
      providers: Object.fromEntries(Array.from(this.providers.entries()).map(([key, samples]) => [key, structuredClone(samples)])),
    };
  }

  static fromSnapshot(snapshot = {}) {
    if (snapshot.schemaVersion !== CALIBRATION_SCHEMA) throw new Error("unsupported capacity calibration snapshot");
    const model = new RollingCapacityCalibration({ maximumSamplesPerKey: snapshot.maximumSamplesPerKey });
    for (const [key, samples] of Object.entries(snapshot.corpora || {})) model.corpora.set(key, structuredClone(samples));
    for (const [key, samples] of Object.entries(snapshot.providers || {})) model.providers.set(key, structuredClone(samples));
    return model;
  }
}

export function providerKey({ provider, model, adapterVersion } = {}) {
  const values = [provider, model, adapterVersion].map((value) => String(value || "").trim());
  if (values.some((value) => !value)) throw new Error("provider, model, and adapterVersion are required for capacity calibration");
  return values.join("\u0000");
}

function normalizeOutcome(value) {
  const outcome = String(value || "success");
  if (!["success", "failed", "throttled"].includes(outcome)) throw new Error("provider capacity outcome is invalid");
  return outcome;
}

function sampleOutcome(sample = {}) {
  if (sample.outcome) return normalizeOutcome(sample.outcome);
  return sample.throttled ? "throttled" : "success";
}

function pushSample(map, key, sample, maximum) {
  const samples = map.get(key) || [];
  samples.push(sample);
  if (samples.length > maximum) samples.splice(0, samples.length - maximum);
  map.set(key, samples);
}

function quantile(values, probability, fallback) {
  if (!values.length) return fallback;
  const sorted = values.slice().sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function positiveNumber(value, field, fallback) {
  if ((value === undefined || value === null || value === "") && fallback !== undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${field} must be positive`);
  return number;
}

function finiteFallback(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum, maximum) {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}
