import { createHash, randomBytes } from "node:crypto";

const TOKEN_PREFIX = "mwb_ing_";

export function generateIngestionToken({ randomBytesImpl = randomBytes } = {}) {
  const entropy = randomBytesImpl(32);
  const rawToken = `${TOKEN_PREFIX}${Buffer.from(entropy).toString("base64url")}`;
  return {
    rawToken,
    tokenSha256: hashIngestionToken(rawToken),
    tokenPrefix: rawToken.slice(0, 16),
  };
}

export function hashIngestionToken(rawToken) {
  return createHash("sha256").update(String(rawToken || ""), "utf8").digest("hex");
}
