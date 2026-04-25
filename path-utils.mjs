import path from "node:path";

export function toPosix(value) {
  return value.split(path.sep).join("/");
}
