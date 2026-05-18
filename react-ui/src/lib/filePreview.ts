import type { FilePreview } from '../types';

export type ReadTextFilePreview = (path: string) => Promise<{ content: string; ext: string }>;

export async function loadTextFilePreview(
  path: string,
  readTextFile: ReadTextFilePreview,
): Promise<FilePreview> {
  const result = await readTextFile(path);
  return { path, type: 'text', content: result.content, ext: result.ext };
}

export function filePreviewTitle(path: string): string {
  return path.split('/').pop() || path;
}
