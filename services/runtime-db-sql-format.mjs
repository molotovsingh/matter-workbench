import { createHash } from "node:crypto";

export function sqlUuid(value) {
  return `${sqlString(value)}::uuid`;
}

export function sqlUuidOrNull(value) {
  return stringValue(value) ? sqlUuid(value) : "null";
}

export function sqlInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.trunc(number)) : "0";
}

export function sqlTextArray(values = []) {
  if (!values.length) return "ARRAY[]::text[]";
  return `ARRAY[${values.map((value) => sqlString(value)).join(", ")}]::text[]`;
}

export function sqlString(value) {
  return `'${String(value ?? "").replaceAll("'", "''")}'`;
}

export function sqlNullableString(value) {
  const text = stringValue(value);
  return text ? sqlString(text) : "null";
}

export function sqlDateOrNull(value) {
  const text = stringValue(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${sqlString(text)}::date` : "null";
}

export function sqlBoolean(value) {
  return value ? "true" : "false";
}

export function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function deterministicUuid(seed) {
  const bytes = createHash("sha256").update(String(seed)).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
