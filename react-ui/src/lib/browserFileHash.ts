export const BROWSER_HASH_UNAVAILABLE_MESSAGE = 'Browser SHA-256 hashing is unavailable';

export function canHashFileSha256(): boolean {
  return typeof globalThis.crypto?.subtle?.digest === 'function';
}

export async function hashFileSha256(file: Pick<File, 'arrayBuffer'>): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  const digestFn = subtle?.digest;
  if (typeof digestFn !== 'function') {
    throw new Error(BROWSER_HASH_UNAVAILABLE_MESSAGE);
  }

  const buffer = await file.arrayBuffer();
  const digest = await digestFn.call(subtle, 'SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashFilesSha256IfAvailable(files: Array<Pick<File, 'arrayBuffer'>>): Promise<string[] | null> {
  if (!canHashFileSha256()) return null;

  try {
    const hashes: string[] = [];
    for (const file of files) {
      hashes.push(await hashFileSha256(file));
    }
    return hashes;
  } catch (err) {
    if (isBrowserHashingFailure(err)) return null;
    throw err;
  }
}

function isBrowserHashingFailure(err: unknown): boolean {
  if (err instanceof Error && err.message.includes(BROWSER_HASH_UNAVAILABLE_MESSAGE)) return true;
  if (err instanceof TypeError) return true;
  return false;
}
