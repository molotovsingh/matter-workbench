import assert from "node:assert/strict";
import test from "node:test";
import {
  extractCorpusFingerprintsFromSources,
  normalizeLegalSourceMetadata,
} from "../services/legal-source-metadata.mjs";

test("legal source metadata normalization keeps only bounded provenance fields", () => {
  const metadata = normalizeLegalSourceMetadata({
    provider: "statutes",
    slug: "a2394",
    section: "69A",
    requested_section: "69-A",
    act: "Indian Partnership Act, 1932",
    act_number: "9 of 1932",
    heading: "Penalty for contravention",
    corpus_fingerprint: "corpus-sha256:test",
    built_at: "2026-07-08T02:29:12.998Z",
    last_refreshed: "2026-07-03T11:04:34.725Z",
    ignored: "drop me",
    secret: "token=super-secret",
    provenance: {
      source: {
        name: "India Code",
        tier: "official",
        url: "https://example.test",
        retrieved_at: "2026-07-01",
        ignored: "drop me too",
      },
      authenticity_anchor: {
        status: "matched",
        archive_url: "https://archive.example.test",
        ignored: "drop me three",
      },
      ignored: "drop me four",
    },
  });

  assert.deepEqual(metadata, {
    provider: "statutes",
    slug: "a2394",
    section: "69A",
    requested_section: "69-A",
    act: "Indian Partnership Act, 1932",
    act_number: "9 of 1932",
    heading: "Penalty for contravention",
    corpus_fingerprint: "corpus-sha256:test",
    built_at: "2026-07-08T02:29:12.998Z",
    last_refreshed: "2026-07-03T11:04:34.725Z",
    provenance: {
      source: {
        name: "India Code",
        tier: "official",
        url: "https://example.test",
        retrieved_at: "2026-07-01",
      },
      authenticity_anchor: {
        status: "matched",
        archive_url: "https://archive.example.test",
      },
    },
  });
  assert.equal(Object.hasOwn(metadata, "secret"), false);
  assert.equal(Object.hasOwn(metadata, "ignored"), false);
});

test("legal source metadata normalization redacts and truncates copied metadata", () => {
  const metadata = normalizeLegalSourceMetadata({
    heading: `token=super-secret ${"a".repeat(600)}`,
    corpus_fingerprint: `corpus-sha256:${"b".repeat(300)}`,
  });

  assert.match(metadata.heading, /token=\[redacted-secret\]/);
  assert.doesNotMatch(metadata.heading, /super-secret/);
  assert.equal(metadata.heading.length, 500);
  assert.match(metadata.heading, /…$/);
  assert.equal(metadata.corpus_fingerprint.length, 200);
  assert.match(metadata.corpus_fingerprint, /…$/);
});

test("legal source metadata extracts unique corpus fingerprints in source order", () => {
  assert.deepEqual(extractCorpusFingerprintsFromSources([
    { metadata: { corpus_fingerprint: " corpus-sha256:first " } },
    { metadata: { corpus_fingerprint: "corpus-sha256:first" } },
    { metadata: { corpus_fingerprint: "corpus-sha256:second" } },
    { metadata: { corpus_fingerprint: "" } },
    {},
  ]), ["corpus-sha256:first", "corpus-sha256:second"]);
});
