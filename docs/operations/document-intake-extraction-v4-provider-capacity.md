# V4 Provider Capacity Certification Worksheet

Status: **not certified** (2026-08-24). This is an administration and evidence worksheet, not a quota claim. Never place API keys, access tokens, service-account JSON, or other secrets here.

## Planning target

The 10,000-page P95 objective requires at least 166.7 logical page operations/second before queue, retry, throttling, and safety margin. V4 uses **250 page operations/second** as the provisional aggregate certification target.

| Lane | Pinned capability | Planning allocation | Administrative scope | Production identity | Region | Demonstrated quota | Status |
|---|---|---:|---|---|---|---:|---|
| Primary OCR | Mistral `mistral-ocr-4-1`, document-range adapter | 225 page-op/s | Production workspace: unknown | Unknown | To approve | Not measured | Blocked |
| Selective repair | Google `gemini-3.7-flash`, LOW, page adapter | 25 page-op/s | Billed project: unknown | Unknown | To approve | Not measured | Blocked |
| Optional failover | Textract / Document AI / Azure / local GPU | 0 until benchmarked | Not selected | Not selected | Not selected | Not measured | Not counted |

The 225/25 allocation is conservative planning, not a permanent route share. Reallocate only from measured corpus routing and certify the aggregate again.

## Current administration gaps

- Mistral credentials work, but the production workspace/quota owner and administrative quota evidence are not identified.
- Google credentials work for extraction evidence, but the billed Cloud project and production service identity are not identified; administrative project lookup returned HTTP 401.
- AWS STS succeeds in `ap-southeast-2`, but Service Quotas access is denied. Textract remains optional and does not count toward launch capacity.
- No provider may count toward the SLO based on a vendor peak-rate statement or a locally valid key.

Use only non-secret identifiers in evidence: workspace/account/project ID, workload-identity or role name/ARN, region, endpoint, quota name, and approved limit.

## Per-lane certification packet

Each SLO-counted lane must supply:

1. pinned provider, model, and adapter version;
2. production administrative scope and workload identity identifiers;
3. approved region, regional endpoint, data-residency disposition, and quota name/limit;
4. at least 30 consecutive one-minute windows at representative page/range size;
5. page operations, requests, throttles, failures, latency, retries, and billed/logical cost per window;
6. P05 sustained throughput at or above the allocated target, throttle rate no more than 1%, and failure rate no more than 1%;
7. a forced-throttle drill and provider-outage/failover drill;
8. recovery within 120 seconds with no missing result, duplicate publication, or unowned cost; and
9. evidence from the production identity and region, not a personal developer credential.

The executable evaluator is `services/document-intake-extraction/capacity/provider-quota-certification.mjs`. It deliberately rejects placeholder administration, secret-looking identifiers, thin samples, insufficient P05 throughput, excessive throttling/failures, and incomplete outage recovery.

## Request sequence

1. Identify the Mistral production workspace and quota administrator.
2. Identify/create the billed Google Cloud project, regional posture, and production service identity.
3. Submit quota requests using V3 measured page/range throughput and the 250 page-op/s aggregate target.
4. Run isolated sustained tests through direct object storage, PostgreSQL claims, and burst workers.
5. Export sanitized one-minute observations; retain raw billing/provider request IDs in restricted evidence storage.
6. Run throttle and outage drills, then evaluate all lanes together.
7. Update `V4-QUOTA-001` only after the certificate passes. Tooling tests do not satisfy the gate.
