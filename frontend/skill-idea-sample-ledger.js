import {
  applyActiveSampleState,
  ensureSampleReview,
  getLedgerSamples,
  getSampleId,
  getSampleWarnings,
  normalizeUiSample,
} from "./skill-sample-review.js";

export async function refreshSkillIdeaSampleLedger({
  session,
  listSkillIdeaSamples,
  selectSampleId = "",
} = {}) {
  const idea = session?.savedIdea;
  const sampleReview = ensureSampleReview(session || {});
  if (!idea?.id) return sampleReview;

  const preferredId = selectSampleId || getSampleId(sampleReview.activeSample);
  try {
    const payload = await listSkillIdeaSamples(idea.id);
    const ledger = Array.isArray(payload.samples) ? payload.samples.map(normalizeUiSample) : [];
    sampleReview.ledger = ledger;
    sampleReview.samples = ledger;
    if (ledger.length) {
      const selected = mergeSampleWarnings(
        ledger.find((sample) => getSampleId(sample) === preferredId) || ledger.at(-1),
        sampleReview.activeSample,
      );
      applyActiveSampleState(sampleReview, selected);
    }
    session.sampleReview = sampleReview;
  } catch {
    const ledger = getLedgerSamples(sampleReview);
    sampleReview.ledger = ledger;
    if (sampleReview.activeSample) {
      applyActiveSampleState(sampleReview, sampleReview.activeSample);
    }
    session.sampleReview = sampleReview;
  }
  return sampleReview;
}

export function mergeSampleWarnings(nextSample, previousSample) {
  if (!nextSample) return nextSample;
  if (getSampleWarnings(nextSample).length) return nextSample;
  if (getSampleId(nextSample) !== getSampleId(previousSample)) return nextSample;
  const previousWarnings = getSampleWarnings(previousSample);
  return previousWarnings.length ? { ...nextSample, warnings: previousWarnings } : nextSample;
}
