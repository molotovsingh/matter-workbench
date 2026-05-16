import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeSampleWarnings,
  refreshSkillIdeaSampleLedger,
} from "../frontend/skill-idea-sample-ledger.js";
import {
  getSampleId,
  getSampleState,
} from "../frontend/skill-sample-review.js";

test("refreshSkillIdeaSampleLedger loads ledger samples and selects the requested sample", async () => {
  const session = {
    savedIdea: { id: "idea_1" },
    sampleReview: {
      samples: [],
      ledger: [],
      activeSample: null,
      approved: false,
      stale: false,
      staleReason: "",
    },
  };
  const calls = [];
  const review = await refreshSkillIdeaSampleLedger({
    session,
    selectSampleId: "sample_2",
    listSkillIdeaSamples: async (ideaId) => {
      calls.push(ideaId);
      return {
        samples: [
          { sample_id: "sample_1", version: 1, sample_markdown: "First", state: "current" },
          { sample_id: "sample_2", version: 2, sample_markdown: "Second", state: "approved_current", approved: true },
        ],
      };
    },
  });

  assert.deepEqual(calls, ["idea_1"]);
  assert.equal(review.samples.length, 2);
  assert.equal(getSampleId(review.activeSample), "sample_2");
  assert.equal(review.approved, true);
  assert.equal(review.stale, false);
  assert.equal(session.sampleReview, review);
});

test("refreshSkillIdeaSampleLedger preserves optimistic warnings when persisted sample has none", async () => {
  const session = {
    savedIdea: { id: "idea_2" },
    sampleReview: {
      activeSample: {
        sample_id: "sample_1",
        version: 1,
        sample_markdown: "Draft",
        warnings: ["462 evidence blocks were omitted."],
      },
      samples: [],
      ledger: [],
    },
  };

  const review = await refreshSkillIdeaSampleLedger({
    session,
    selectSampleId: "sample_1",
    listSkillIdeaSamples: async () => ({
      samples: [
        { sample_id: "sample_1", version: 1, sample_markdown: "Draft", warnings: [] },
      ],
    }),
  });

  assert.deepEqual(review.activeSample.warnings, ["462 evidence blocks were omitted."]);
});

test("refreshSkillIdeaSampleLedger falls back to local sample state when ledger read fails", async () => {
  const session = {
    savedIdea: { id: "idea_3" },
    sampleReview: {
      activeSample: {
        sample_id: "sample_stale",
        version: 1,
        sample_markdown: "Old sample",
        state: "approved_stale",
        approved: true,
        current: false,
      },
      samples: [],
      ledger: [],
    },
  };

  const review = await refreshSkillIdeaSampleLedger({
    session,
    listSkillIdeaSamples: async () => {
      throw new Error("offline");
    },
  });

  assert.equal(getSampleState(review.activeSample), "approved_stale");
  assert.equal(review.approved, false);
  assert.equal(review.stale, true);
  assert.equal(review.ledger.length, 0);
});

test("mergeSampleWarnings only carries warnings for the same sample", () => {
  const previous = { sample_id: "sample_1", warnings: ["bounded packet warning"] };

  assert.deepEqual(
    mergeSampleWarnings({ sample_id: "sample_1", warnings: [] }, previous).warnings,
    ["bounded packet warning"],
  );
  assert.deepEqual(
    mergeSampleWarnings({ sample_id: "sample_2", warnings: [] }, previous).warnings,
    [],
  );
  assert.deepEqual(
    mergeSampleWarnings({ sample_id: "sample_1", warnings: ["persisted"] }, previous).warnings,
    ["persisted"],
  );
});
