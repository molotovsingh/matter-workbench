export interface CollectedUploadFile {
  file: File;
  relativePath: string;
}

export function collectFilesFromFileList(files: FileList | File[] | null | undefined): CollectedUploadFile[] {
  return Array.from(files ?? [])
    .map((file) => ({
      file,
      relativePath: normalizeBrowserRelativePath(getBrowserRelativePath(file) || file.name),
    }))
    .filter((item) => item.relativePath.length > 0);
}

export async function collectDroppedEntries(entries: FileSystemEntry[]): Promise<CollectedUploadFile[]> {
  const results: CollectedUploadFile[] = [];

  async function walk(entry: FileSystemEntry, prefix: string) {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => {
        (entry as FileSystemFileEntry).file(resolve, reject);
      });
      const relativePath = normalizeBrowserRelativePath(`${prefix}${entry.name}`);
      if (relativePath) results.push({ file, relativePath });
      return;
    }

    if (entry.isDirectory) {
      const nextPrefix = `${prefix}${entry.name}/`;
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      let batch: FileSystemEntry[] = [];

      do {
        batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
          reader.readEntries(resolve, reject);
        });
        for (const child of batch) {
          await walk(child, nextPrefix);
        }
      } while (batch.length > 0);
    }
  }

  for (const entry of entries) {
    await walk(entry, '');
  }

  return results;
}

export function getDroppedFileSystemEntries(dataTransfer: DataTransfer): FileSystemEntry[] {
  return Array.from(dataTransfer.items)
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => entry != null);
}

export function normalizeBrowserRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/').trim();
}

function getBrowserRelativePath(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
}
