# V4 One-Way Cutover Authorization

Status: **not authorized**. V4 has no production caller and this document does not create one.

`services/document-intake-extraction/readiness/cutover-authorization.mjs` is the final fail-closed authorization check. It requires:

- the complete acceptance evaluation to be production-ready;
- explicit, non-zero shadow-intake, shadow-page, and soak-duration policy;
- sufficient shadow/soak evidence;
- zero omitted pages, legal-critical divergences, duplicate ready events, unreconciled cost events, and cross-tenant violations;
- zero open soak incidents;
- zero queued or active legacy jobs; and
- distinct approvals for quality, security, operations, product ownership, and cutover authority.

The final shadow and soak minimums are intentionally not hardcoded. The named authorities must approve them before shadow begins; reducing them after observing results invalidates the authorization packet.

## Authorized sequence

1. freeze new legacy intake;
2. verify the legacy queue is drained;
3. activate the V4 versioned caller;
4. verify V4 health, custody, processing, publication, and user-facing state;
5. remove the legacy extraction runtime and configuration; and
6. fix forward only.

There is no long-lived fallback or dual-write escape hatch after activation. Shadow is finite evidence gathering, not a permanent parallel architecture. Any failure before activation aborts the cutover. Any failure after activation is repaired in V4.

Current blockers remain the expanded human quality set, provider administration/quota, production-shaped load, security review, agreed shadow/soak policy, evidence volume, and named approvals.
