export function collectFilesFromDataTransfer(dataTransfer) {
  const entries = [];
  const items = dataTransfer.items;
  if (!items) return Promise.resolve([]);
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item.kind === "file") {
      const entry = typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null;
      if (entry) entries.push(entry);
    }
  }
  return Promise.all(entries.map((entry) => walkFileSystemEntry(entry, ""))).then((results) => results.flat());
}

function walkFileSystemEntry(entry, prefix) {
  return new Promise((resolve, reject) => {
    if (entry.isFile) {
      entry.file((file) => {
        const relativePath = prefix ? `${prefix}/${file.name}` : file.name;
        resolve([{ file, relativePath }]);
      }, reject);
      return;
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      const collected = [];
      const readBatch = () => {
        reader.readEntries(async (batch) => {
          if (!batch.length) {
            const nested = await Promise.all(
              collected.map((child) => walkFileSystemEntry(child, prefix ? `${prefix}/${entry.name}` : entry.name)),
            );
            resolve(nested.flat());
            return;
          }
          collected.push(...batch);
          readBatch();
        }, reject);
      };
      readBatch();
      return;
    }
    resolve([]);
  });
}

export async function hashFile(file) {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function collectFilesFromInput(input) {
  const result = [];
  const files = Array.from(input.files || []);
  for (const file of files) {
    const raw = file.webkitRelativePath || file.name;
    const parts = raw.split("/");
    const relativePath = parts.length > 1 ? parts.slice(1).join("/") : parts[0];
    result.push({ file, relativePath });
  }
  return result;
}
