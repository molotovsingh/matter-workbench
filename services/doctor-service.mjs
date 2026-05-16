import {
  detectLegacyLayout,
  fixLegacyLayout,
} from "./doctor-legacy-layout.mjs";

export { detectLegacyLayout, fixLegacyLayout };

export async function runDoctorScan(matterRoot) {
  const issues = [];
  const legacy = await detectLegacyLayout(matterRoot);
  if (legacy) issues.push(legacy);
  return { issues };
}

export async function runDoctorFix(matterRoot, fixIds) {
  const applied = [];
  const failed = [];
  if (fixIds.includes("legacy-layout")) {
    const detected = await detectLegacyLayout(matterRoot);
    if (detected) {
      try {
        const result = await fixLegacyLayout(matterRoot, detected.evidence);
        applied.push({ id: "legacy-layout", ...result });
      } catch (error) {
        failed.push({ id: "legacy-layout", error: error.message });
      }
    }
  }
  const remaining = (await runDoctorScan(matterRoot)).issues;
  return { applied, failed, remaining };
}
