import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildSourcePackets,
  runSourceDescriptors,
  validateAndSortDescriptors,
} from "../source-descriptors-engine.mjs";

async function makeMatterRoot() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "matter-source-index-test-"));
  const root = path.join(tmp, "matter");
  await mkdir(path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted"), { recursive: true });
  await writeFile(path.join(root, "matter.json"), `${JSON.stringify({
    matter_name: "Mehta vs Skyline",
    client_name: "Mehta",
    opposite_party: "Skyline",
    matter_type: "Civil",
    jurisdiction: "India",
    brief_description: "Source index skeleton test matter",
    intakes: [
      {
        intake_id: "INTAKE-01",
        intake_dir: "00_Inbox/Intake 01 - Initial",
      },
    ],
  }, null, 2)}\n`);

  for (const record of extractionRecords()) {
    await writeFile(
      path.join(root, "00_Inbox", "Intake 01 - Initial", "_extracted", `${record.file_id}.json`),
      `${JSON.stringify(record, null, 2)}\n`,
    );
  }
  return root;
}

test("source descriptors engine writes source-index/v1 with fake provider descriptors", async () => {
  const root = await makeMatterRoot();
  const calls = [];

  const result = await runSourceDescriptors({
    matterRoot: root,
    generatedAt: "2026-04-28T10:00:00.000Z",
    provider: async ({ matter, sources, schema }) => {
      calls.push({ matter, sources, schema });
      assert.equal(matter.matter_name, "Mehta vs Skyline");
      assert.equal(schema.properties.sources.type, "array");
      assert.deepEqual(sources.map((source) => source.file_id), ["FILE-0001", "FILE-0002", "FILE-0003"]);
      assert.ok(sources[0].blocks.some((block) => block.citation === "FILE-0001 p1.b1"));
      return { sources: validDescriptors(sources) };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(result.counts.recordsRead, 3);
  assert.equal(result.counts.sourcePackets, 3);
  assert.equal(result.counts.descriptors, 3);
  assert.equal(result.outputPaths.json, "10_Library/Source Index.json");
  assert.deepEqual(result.aiRun, {
    policyVersion: "source-index-skeleton/v1",
    task: "source_description",
    tier: "source_description",
    provider: "fake-provider",
    model: "injected-test-provider",
    maxOutputTokens: null,
    fallback: "none",
  });

  await stat(path.join(root, "10_Library", "Source Index.json"));
  const artifact = JSON.parse(await readFile(path.join(root, "10_Library", "Source Index.json"), "utf8"));
  assert.equal(artifact.schema_version, "source-index/v1");
  assert.equal(artifact.engine_version, "source-descriptors-v1-skeleton");
  assert.equal(artifact.generated_at, "2026-04-28T10:00:00.000Z");
  assert.equal(artifact.source_record_count, 3);
  assert.equal(artifact.sources.length, 3);

  const email = artifact.sources.find((source) => source.file_id === "FILE-0001");
  assert.equal(email.document_type, "email");
  assert.equal(email.document_date, "2026-04-20");
  assert.equal(email.date_basis, "email_header");

  const order = artifact.sources.find((source) => source.file_id === "FILE-0002");
  assert.equal(order.document_type, "court_order");
  assert.equal(order.document_date, "2024-03-03");

  const scan = artifact.sources.find((source) => source.file_id === "FILE-0003");
  assert.equal(scan.document_type, "affidavit");
  assert.equal(scan.document_date, null);
  assert.equal(scan.needs_review, true);
});

test("source descriptors preserve file_id, sha256, and source_path from extraction records", async () => {
  const root = await makeMatterRoot();

  const result = await runSourceDescriptors({
    matterRoot: root,
    provider: async ({ sources }) => ({ sources: validDescriptors(sources) }),
  });

  for (const source of result.sources) {
    const record = extractionRecords().find((item) => item.file_id === source.file_id);
    assert.equal(source.sha256, record.sha256);
    assert.equal(source.source_path, record.source_path);
  }
});

test("source descriptor provider output cannot cite evidence from another file", () => {
  const packets = buildSourcePackets(extractionRecords());
  const descriptors = validDescriptors(packets);
  descriptors[0].evidence = [{ citation: "FILE-0002 p1.b1", reason: "Wrong source file." }];

  assert.throws(
    () => validateAndSortDescriptors({ sources: descriptors }, packets),
    /Evidence citation FILE-0002 p1\.b1 does not belong to FILE-0001/,
  );
});

test("source descriptors reject missing required fields", () => {
  const packets = buildSourcePackets(extractionRecords());
  const descriptors = validDescriptors(packets);
  delete descriptors[0].short_label;

  assert.throws(
    () => validateAndSortDescriptors({ sources: descriptors }, packets),
    /Missing required source field short_label/,
  );
});

test("source descriptor fixture quality check rejects weak email semantic labels", () => {
  const packets = buildSourcePackets(extractionRecords());
  const descriptors = validDescriptors(packets);
  descriptors[0].date_basis = "file_name";
  descriptors[0].display_label = "Email from Sharma to Mehta";

  assert.throws(
    () => assertSyntheticDescriptorQuality(descriptors),
    /FILE-0001 should use date_basis email_header/,
  );
});

test("source descriptor fixture quality check rejects misleading filename dates for unclear scans", () => {
  const packets = buildSourcePackets(extractionRecords());
  const descriptors = validDescriptors(packets);
  descriptors[2].document_date = "2021-01-01";
  descriptors[2].date_basis = "file_name";
  descriptors[2].display_label = "Blurred scan of affidavit dated 1 January 2021";

  assert.throws(
    () => assertSyntheticDescriptorQuality(descriptors),
    /FILE-0003 should not use the filename date/,
  );
});

test("source descriptors reject impossible ISO dates", () => {
  const packets = buildSourcePackets(extractionRecords());
  const descriptors = validDescriptors(packets);
  descriptors[0].document_date = "2004-20-20";

  assert.throws(
    () => validateAndSortDescriptors({ sources: descriptors }, packets),
    /Invalid document_date for FILE-0001/,
  );
});

test("source descriptors reject literal None party fields", () => {
  const packets = buildSourcePackets(extractionRecords());
  const descriptors = validDescriptors(packets);
  descriptors[1].parties.author = "None";

  assert.throws(
    () => validateAndSortDescriptors({ sources: descriptors }, packets),
    /parties\.author should be empty instead of None for FILE-0002/,
  );
});

test("source descriptors engine requires injected provider and does not create network provider", async () => {
  const root = await makeMatterRoot();

  await assert.rejects(
    () => runSourceDescriptors({ matterRoot: root }),
    /sourceDescriptorProvider is required/,
  );
});

function extractionRecords() {
  return [
    extractionRecord({
      fileId: "FILE-0001",
      sha256: "1111111111111111111111111111111111111111111111111111111111111111",
      sourcePath: "00_Inbox/Intake 01 - Initial/By Type/Emails/FILE-0001__inspection-notice.eml",
      blocks: [
        {
          id: "p1.b1",
          type: "heading",
          text: "From: Sharma <sharma@example.invalid>\nTo: Mehta <mehta@example.invalid>\nDate: 20 April 2026\nSubject: Inspection notice",
        },
        {
          id: "p1.b2",
          type: "paragraph",
          text: "Dear Mehta, this confirms the inspection notice was issued after the site visit.",
        },
      ],
    }),
    extractionRecord({
      fileId: "FILE-0002",
      sha256: "2222222222222222222222222222222222222222222222222222222222222222",
      sourcePath: "00_Inbox/Intake 01 - Initial/By Type/PDFs/FILE-0002__delhi-high-court-order.pdf",
      blocks: [
        {
          id: "p1.b1",
          type: "heading",
          text: "IN THE HIGH COURT OF DELHI AT NEW DELHI\nOrder dated 3 March 2024",
        },
        {
          id: "p1.b2",
          type: "paragraph",
          text: "The petition is listed for directions. No final relief is granted at this stage.",
        },
      ],
    }),
    extractionRecord({
      fileId: "FILE-0003",
      sha256: "3333333333333333333333333333333333333333333333333333333333333333",
      sourcePath: "00_Inbox/Intake 01 - Initial/By Type/Images/FILE-0003__2021-01-01-important.png",
      warnings: ["low_ocr_confidence"],
      pageNeedsReview: true,
      pageConfidence: 0.42,
      blocks: [
        {
          id: "p1.b1",
          type: "paragraph",
          text: "Blurred scan. Appears to mention affidavit, but date and deponent are unclear.",
        },
      ],
    }),
  ];
}

function extractionRecord({
  fileId,
  sha256,
  sourcePath,
  blocks,
  warnings = [],
  pageNeedsReview = false,
  pageConfidence = 0.98,
}) {
  return {
    schema_version: "extraction-record/v1",
    file_id: fileId,
    sha256,
    source_path: sourcePath,
    engine: "test-extractor/v1",
    extracted_at: "2026-04-28T10:00:00.000Z",
    language_detected: ["en"],
    page_count: 1,
    warnings,
    pages: [
      {
        page: 1,
        ocr_required: pageNeedsReview,
        confidence_avg: pageConfidence,
        needs_review: pageNeedsReview,
        blocks,
      },
    ],
  };
}

function validDescriptors(packets) {
  return packets.map((packet) => {
    if (packet.file_id === "FILE-0001") {
      return descriptor(packet, {
        display_label: "Email from Sharma to Mehta dated 20 April 2026",
        short_label: "Email dated 20 Apr 2026",
        document_type: "email",
        document_date: "2026-04-20",
        date_basis: "email_header",
        parties: {
          from: "Sharma",
          to: ["Mehta"],
          cc: [],
          author: "",
          court: "",
          judge: "",
          issuing_party: "Sharma",
          recipient_party: "Mehta",
          deponent: "",
          signatory: "",
        },
        confidence: 0.94,
        needs_review: false,
        evidence: [{ citation: "FILE-0001 p1.b1", reason: "Email header gives sender, recipient, and sent date." }],
        warnings: [],
      });
    }
    if (packet.file_id === "FILE-0002") {
      return descriptor(packet, {
        display_label: "Order of the Delhi High Court dated 3 March 2024",
        short_label: "Delhi High Court order dated 3 Mar 2024",
        document_type: "court_order",
        document_date: "2024-03-03",
        date_basis: "court_order_date",
        parties: {
          from: "",
          to: [],
          cc: [],
          author: "",
          court: "Delhi High Court",
          judge: "",
          issuing_party: "Delhi High Court",
          recipient_party: "",
          deponent: "",
          signatory: "",
        },
        confidence: 0.9,
        needs_review: false,
        evidence: [{ citation: "FILE-0002 p1.b1", reason: "Heading identifies court and order date." }],
        warnings: [],
      });
    }
    return descriptor(packet, {
      display_label: "Scanned document, likely affidavit, date unclear",
      short_label: "Unclear scanned affidavit",
      document_type: "affidavit",
      document_date: null,
      date_basis: "unknown",
      parties: {
        from: "",
        to: [],
        cc: [],
        author: "",
        court: "",
        judge: "",
        issuing_party: "",
        recipient_party: "",
        deponent: "",
        signatory: "",
      },
      confidence: 0.5,
      needs_review: true,
      evidence: [{ citation: "FILE-0003 p1.b1", reason: "OCR text weakly suggests affidavit but details are unclear." }],
      warnings: ["low_ocr_confidence"],
    });
  });
}

function descriptor(packet, values) {
  return {
    file_id: packet.file_id,
    sha256: packet.sha256,
    source_path: packet.source_path,
    ...values,
  };
}

function assertSyntheticDescriptorQuality(descriptors) {
  const byFileId = new Map(descriptors.map((descriptor) => [descriptor.file_id, descriptor]));
  const email = byFileId.get("FILE-0001");
  assert.equal(email.document_type, "email", "FILE-0001 should be classified as email");
  assert.equal(email.document_date, "2026-04-20", "FILE-0001 should use the email header date");
  assert.equal(email.date_basis, "email_header", "FILE-0001 should use date_basis email_header");
  assert.match(email.display_label, /20 (Apr|April) 2026/i, "FILE-0001 display_label should include 20 April 2026");

  const order = byFileId.get("FILE-0002");
  assert.equal(order.document_type, "court_order", "FILE-0002 should be classified as court_order");
  assert.equal(order.document_date, "2024-03-03", "FILE-0002 should use the court order date");
  assert.equal(order.date_basis, "court_order_date", "FILE-0002 should use date_basis court_order_date");
  assert.match(order.display_label, /3 (Mar|March) 2024/i, "FILE-0002 display_label should include 3 March 2024");

  const scan = byFileId.get("FILE-0003");
  assert.equal(scan.document_date, null, "FILE-0003 should not use the filename date");
  assert.equal(scan.date_basis, "unknown", "FILE-0003 should use date_basis unknown");
  assert.equal(scan.needs_review, true, "FILE-0003 should need review");
  assert.ok(scan.confidence < 0.7, "FILE-0003 confidence should stay below 0.7");
  assert.doesNotMatch(
    scan.display_label,
    /2021|1 Jan|1 January|January 1/i,
    "FILE-0003 display_label should not include the misleading filename date",
  );
}
