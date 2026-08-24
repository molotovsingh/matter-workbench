import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export async function listPdfImages({ pdfPath, command = "pdfimages", execFileImpl = execFile } = {}) {
  if (!pdfPath) throw new Error("pdf path is required");
  let stdout;
  try {
    ({ stdout } = await execFileImpl(command, ["-list", pdfPath], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30_000,
    }));
  } catch (error) {
    return {
      available: false,
      errorCategory: classifyError(error),
      pages: {},
    };
  }
  return {
    available: true,
    errorCategory: "",
    pages: parsePdfImagesList(stdout),
  };
}

export function parsePdfImagesList(value) {
  const pages = {};
  for (const line of String(value || "").split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 5 || !/^\d+$/.test(columns[0]) || !/^\d+$/.test(columns[1])) continue;
    const page = Number(columns[0]);
    const type = String(columns[2] || "");
    const width = Number(columns[3]) || 0;
    const height = Number(columns[4]) || 0;
    const pixels = Math.max(0, width * height);
    const target = pages[page] || { imageCount: 0, maximumImagePixels: 0, images: [] };
    if (type === "image") {
      target.imageCount += 1;
      target.maximumImagePixels = Math.max(target.maximumImagePixels, pixels);
      target.images.push({ width, height, pixels });
    }
    pages[page] = target;
  }
  return pages;
}

export function classifyPageImages(pageImages, { minimumLargeImagePixels = 250_000 } = {}) {
  const images = Array.isArray(pageImages?.images) ? pageImages.images : [];
  return {
    imageCount: Number(pageImages?.imageCount) || 0,
    largeImageCount: images.filter((image) => Number(image.pixels) >= minimumLargeImagePixels).length,
    maximumImagePixels: Number(pageImages?.maximumImagePixels) || 0,
  };
}

function classifyError(error) {
  if (error?.code === "ENOENT") return "pdfimages_unavailable";
  if (error?.killed || error?.signal || error?.code === "ETIMEDOUT") return "pdfimages_timeout";
  return "pdfimages_failed";
}
