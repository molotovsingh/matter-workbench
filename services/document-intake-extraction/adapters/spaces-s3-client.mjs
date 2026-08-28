import { canonicalPath, EMPTY_PAYLOAD_SHA256, presignUrl, signRequestHeaders } from "./sigv4.mjs";

// Production object-store client for S3-compatible services (DigitalOcean
// Spaces; AWS S3 by construction). Implements exactly the client + presigner
// surface `S3CompatibleObjectStore` consumes, so swapping it for the
// local-disk emulation is a composition choice, not a code change.
//
// Portability note: the store passes `destinationIfNoneMatch` on blob
// promotion. Conditional-destination CopyObject is not portable across
// S3-compatible providers, so this client does not send it; blob keys are
// content-addressed, which makes concurrent promotion last-write-wins
// CONVERGENT (identical bytes), and the store independently verifies the
// promoted blob and treats a lost race as reuse.

export function createSpacesS3Client({
  endpoint,
  region,
  accessKeyId,
  secretAccessKey,
  fetchImpl = fetch,
  clock = () => new Date(),
} = {}) {
  const base = new URL(String(endpoint || ""));
  if (base.protocol !== "https:" && base.hostname !== "127.0.0.1" && base.hostname !== "localhost") {
    throw new Error("S3 endpoint must be HTTPS");
  }
  const normalizedRegion = String(region || "").trim();
  if (!normalizedRegion) throw new Error("S3 client requires a region");
  const keyId = String(accessKeyId || "").trim();
  const secret = String(secretAccessKey || "").trim();
  if (!keyId || !secret) throw new Error("S3 client requires credentials");

  const objectUrl = (bucket, key = "", query = "") => {
    const host = `${bucket}.${base.host}`;
    const path = key ? `/${key.split("/").map(encodeURIComponent).join("/")}` : "/";
    return new URL(`${base.protocol}//${host}${path}${query}`);
  };

  async function send(method, url, { headers = {}, body, payloadSha256 = EMPTY_PAYLOAD_SHA256 } = {}) {
    const signed = signRequestHeaders({
      method,
      url,
      headers,
      payloadSha256,
      accessKeyId: keyId,
      secretAccessKey: secret,
      region: normalizedRegion,
      now: clock(),
    });
    return fetchImpl(url, { method, headers: signed, body });
  }

  async function raiseS3Error(response, fallbackCode) {
    const text = await response.text().catch(() => "");
    const code = (text.match(/<Code>([^<]+)<\/Code>/) || [])[1] || fallbackCode;
    const message = (text.match(/<Message>([^<]+)<\/Message>/) || [])[1] || `S3 request failed with HTTP ${response.status}`;
    const error = new Error(message);
    error.code = code;
    error.statusCode = response.status;
    throw error;
  }

  const client = {
    async headBucket({ bucket }) {
      const response = await send("HEAD", objectUrl(bucket));
      if (!response.ok) {
        const error = new Error(`bucket is not reachable (HTTP ${response.status})`);
        error.code = response.status === 404 ? "NoSuchBucket" : "BucketUnavailable";
        error.statusCode = response.status;
        throw error;
      }
      return {};
    },

    async headObject({ bucket, key, versionId }) {
      const query = versionId ? `?versionId=${encodeURIComponent(versionId)}` : "";
      const response = await send("HEAD", objectUrl(bucket, key, query));
      if (response.status === 404) {
        const error = new Error("object not found");
        error.code = "NoSuchKey";
        error.statusCode = 404;
        throw error;
      }
      if (!response.ok) {
        const error = new Error(`head failed with HTTP ${response.status}`);
        error.code = "HeadFailed";
        error.statusCode = response.status;
        throw error;
      }
      const metadata = {};
      for (const [name, value] of response.headers) {
        if (name.toLowerCase().startsWith("x-amz-meta-")) metadata[name.slice("x-amz-meta-".length)] = value;
      }
      // HEAD bodies are empty by definition; make sure the socket is released.
      await response.body?.cancel?.().catch(() => {});
      return {
        contentLength: Number(response.headers.get("content-length") || 0),
        versionId: response.headers.get("x-amz-version-id") || "",
        metadata,
      };
    },

    async getObject({ bucket, key, versionId }) {
      const query = versionId ? `?versionId=${encodeURIComponent(versionId)}` : "";
      const response = await send("GET", objectUrl(bucket, key, query));
      if (response.status === 404) {
        const error = new Error("object not found");
        error.code = "NoSuchKey";
        error.statusCode = 404;
        throw error;
      }
      if (!response.ok) await raiseS3Error(response, "GetFailed");
      return { body: response.body };
    },

    async copyObject({ sourceBucket, sourceKey, sourceVersionId, destinationBucket, destinationKey, metadata, metadataDirective, serverSideEncryption }) {
      const sourcePath = `/${sourceBucket}${canonicalPath(`/${sourceKey}`)}`;
      const headers = {
        "x-amz-copy-source": sourceVersionId ? `${sourcePath}?versionId=${sourceVersionId}` : sourcePath,
        ...(metadataDirective ? { "x-amz-metadata-directive": metadataDirective } : {}),
        ...(serverSideEncryption ? { "x-amz-server-side-encryption": serverSideEncryption } : {}),
      };
      for (const [name, value] of Object.entries(metadata || {})) {
        headers[`x-amz-meta-${name}`] = value;
      }
      const response = await send("PUT", objectUrl(destinationBucket, destinationKey), { headers });
      if (!response.ok) await raiseS3Error(response, "CopyFailed");
      // S3 CopyObject can return HTTP 200 with an error document in the body.
      const text = await response.text().catch(() => "");
      if (text.includes("<Error>")) {
        const error = new Error((text.match(/<Message>([^<]+)<\/Message>/) || [])[1] || "copy failed after HTTP 200");
        error.code = (text.match(/<Code>([^<]+)<\/Code>/) || [])[1] || "CopyFailed";
        error.statusCode = 500;
        throw error;
      }
      return {};
    },

    async deleteObject({ bucket, key }) {
      const response = await send("DELETE", objectUrl(bucket, key));
      if (!response.ok && response.status !== 404) await raiseS3Error(response, "DeleteFailed");
      await response.body?.cancel?.().catch(() => {});
      return {};
    },
  };

  const presigner = {
    // The signed header set binds the upload's exact byte size and declared
    // headers into the URL: a holder of the URL can upload only this object,
    // at this size, with these headers, until it expires.
    async presignPut({ bucket, key, expiresAt, expectedBytes, requiredHeaders = {} }) {
      const now = clock();
      const expiresSeconds = Math.ceil((new Date(expiresAt).getTime() - now.getTime()) / 1000);
      const url = presignUrl({
        method: "PUT",
        url: objectUrl(bucket, key),
        headers: {
          ...requiredHeaders,
          ...(Number.isFinite(Number(expectedBytes)) && Number(expectedBytes) > 0
            ? { "content-length": String(expectedBytes) }
            : {}),
        },
        expiresSeconds,
        accessKeyId: keyId,
        secretAccessKey: secret,
        region: normalizedRegion,
        now,
      });
      return { url };
    },
  };

  return Object.freeze({ client, presigner });
}
