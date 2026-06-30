import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";

export function coerceUploadFilePayloadBytes(file = {}) {
  if (Buffer.isBuffer(file.payloadBytes)) return Buffer.from(file.payloadBytes);
  if (file.payloadBytes instanceof Uint8Array) return Buffer.from(file.payloadBytes);
  if (Buffer.isBuffer(file.bytes)) return Buffer.from(file.bytes);
  if (file.bytes instanceof Uint8Array) return Buffer.from(file.bytes);
  if (file.buffer instanceof Uint8Array) return Buffer.from(file.buffer);
  return null;
}

export async function readUploadFilePayloadBytes(file = {}) {
  const bytes = coerceUploadFilePayloadBytes(file);
  if (bytes) return bytes;
  if (file.tempPath) return readFile(file.tempPath);
  throw new Error("Upload file payload is missing.");
}
