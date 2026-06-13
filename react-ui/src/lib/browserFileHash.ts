export const BROWSER_HASH_UNAVAILABLE_MESSAGE = 'Browser SHA-256 hashing is unavailable';

export function canHashFileSha256(): boolean {
  return typeof globalThis.crypto?.subtle?.digest === 'function';
}

export async function hashFileSha256(file: Pick<File, 'arrayBuffer'>): Promise<string> {
  const digestFn = globalThis.crypto?.subtle?.digest;
  if (typeof digestFn !== 'function') {
    throw new Error(BROWSER_HASH_UNAVAILABLE_MESSAGE);
  }

  const buffer = await file.arrayBuffer();
  const digest = await digestFn.call(globalThis.crypto.subtle, 'SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
