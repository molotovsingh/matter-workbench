export const BROWSER_HASH_UNAVAILABLE_MESSAGE = 'Browser SHA-256 hashing is unavailable';
export const BROWSER_HASH_MAX_TOTAL_BYTES = 64 * 1024 * 1024;

export type BrowserFileHashSkipReason = 'crypto_unavailable' | 'selection_too_large';

export function canHashFileSha256(): boolean {
  return typeof globalThis.crypto?.subtle?.digest === 'function';
}

export function browserFileHashSkipReason(files: BrowserHashFile[]): BrowserFileHashSkipReason | null {
  if (isTooLargeForBrowserHash(files)) return 'selection_too_large';
  if (!canHashFileSha256()) return 'crypto_unavailable';
  return null;
}

type BrowserHashFile = Pick<File, 'arrayBuffer'> & Partial<Pick<File, 'size'>>;

export async function hashFileSha256(file: BrowserHashFile): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  const digestFn = subtle?.digest;
  if (typeof digestFn !== 'function') {
    throw new Error(BROWSER_HASH_UNAVAILABLE_MESSAGE);
  }

  const buffer = await file.arrayBuffer();
  const digest = await digestFn.call(subtle, 'SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashFilesSha256IfAvailable(files: BrowserHashFile[]): Promise<string[] | null> {
  if (browserFileHashSkipReason(files)) return null;

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
  if (err instanceof RangeError) return true;
  return false;
}

function isTooLargeForBrowserHash(files: BrowserHashFile[]): boolean {
  let total = 0;
  for (const file of files) {
    if (typeof file.size !== 'number' || !Number.isFinite(file.size)) continue;
    total += Math.max(0, file.size);
    if (total > BROWSER_HASH_MAX_TOTAL_BYTES) return true;
  }
  return false;
}
