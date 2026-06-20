# Future Design Decision: Court-Facing Drafts Workbench

Date: 2026-06-20
Status: SME requirement capture / post-Beta-3 planning note

## Why This Exists

Matter Workbench should eventually help a lawyer move from a prepared matter to
court-facing first drafts: petitions, applications, appeals, objections,
replies, affidavits, and other filing papers. This is a major native module,
not a quick custom-skill prompt.

The product promise should be narrow and professionally safe:

```text
Create a reviewable first draft from matter materials and lawyer instructions,
let the lawyer revise and approve it, then preserve the approved copy in Ready
to Send.
```

The module must not imply automatic filing, automatic legal advice, or automatic
court readiness. The lawyer owns the draft and the final decision.

## Relationship To Existing Contracts

This module should inherit the existing product contracts before implementation:

- [Legal Workbench Policy Prompt](legal-workbench-policy-prompt.md) for
  source, uncertainty, model-risk, and court-facing discipline.
- [Native Skill Library Strategy](native-skill-library-strategy.md) because
  court drafting depends on native matter-building blocks, not just freeform
  generation.
- [Chronology / List of Dates](native-skill-chronology-list-of-dates.md)
  because many court papers need a court-facing chronology or synopsis.
- [Artifact Visibility And Dispatch](../contracts/artifact-visibility-and-dispatch.md)
  because working drafts belong in `30_Drafts` and approved send/file copies
  belong behind the `40_Dispatch` / Ready to Send boundary.
- [Source Identity And Labels](../contracts/source-identity-and-labels.md)
  because court-facing documents must use lawyer-facing document labels,
  annexure labels, exhibits, paper-book references, or clean titles rather than
  raw internal source IDs.

## Core Product Shape

The module is a drafting pipeline:

```text
Select filing type
↓
Confirm forum, procedural basis, party role, and relief goal
↓
Check required matter materials and ask missing questions
↓
Create draft plan / section checklist
↓
Generate first draft section-by-section
↓
Show review notes, missing-info warnings, and source-support map
↓
Allow lawyer edits / targeted regeneration / versioning
↓
Lawyer marks approved
↓
Copy approved version to Ready to Send / Dispatch
```

The important product distinction is:

```text
The app may prepare and assist.
The lawyer approves.
Ready to Send means lawyer-approved, not model-approved.
```

## Filing Matrix Complexity

Court-facing drafting is matrix-driven. A filing format can depend on many
variables:

| Axis | Examples / notes |
| --- | --- |
| Filing family | writ petition, supervisory petition, civil application, appeal, SLP/appeal, reply, affidavit |
| Procedural basis | constitutional article, CPC order/rule, statute, tribunal rule, court rule |
| Forum | Supreme Court, High Court, district court, tribunal, authority |
| Local variant | Delhi High Court, Allahabad High Court, Bombay High Court, NCLT bench, etc. |
| Party role | petitioner, respondent, appellant, defendant, applicant, intervener |
| Procedural stage | fresh filing, interim application, reply, rejoinder, amendment, execution, restoration |
| Relief type | final relief, interim relief, stay, injunction, quashing, remand, rejection of plaint, condonation |
| Required sections | synopsis, list of dates, facts, grounds, maintainability, limitation, jurisdiction, prayer |
| Ancillary papers | affidavit, index, memo of parties, annexures, vakalatnama, application for exemption/condonation |
| Formatting expectations | cause title style, margins, numbering, verification, annexure labels, court-specific language |

The product should treat the matrix as a registry, not as prose hidden inside a
prompt.

## User-Provided Seed Examples To Verify

These examples are useful discovery seeds, not verified implementation facts:

| Seed | Initial product meaning | Verification needed |
| --- | --- | --- |
| Article 226, Constitution, Delhi High Court | High Court writ petition family with Delhi-specific format expectations | Delhi High Court rules, filing practice, required sections, ancillary papers |
| Article 227, Allahabad High Court | Supervisory jurisdiction petition family with Allahabad-specific format expectations | Allahabad High Court rules/practice and whether template differs materially from other writ formats |
| Article 132 / SLP / Constitution, Supreme Court | Supreme Court constitutional/appellate/SLP-related filing family | Verify correct constitutional basis and filing form; Article 132 and SLP language must not be conflated without lawyer review |
| Order VII Rule 11, rejection of plaint | Civil procedural application with likely more stable format than writ/SLP families | Forum-specific civil court/High Court original-side expectations and required supporting material |

The matrix discovery process must verify provision labels, current court rules,
and local practice before any preset is treated as product authority.

## Template Versus Drafting Substance

The module has two jobs that must stay separate.

### 1. Template / Format Assembly

Template logic answers:

- Which sections are required?
- What order should sections appear in?
- What ancillary documents are expected?
- What court-facing captions, verification blocks, prayers, and annexure styles
  are normal for this filing family?
- Which parts are fixed boilerplate and which parts are matter-specific?

### 2. Legal / Factual Drafting

Drafting logic answers:

- What facts are relevant and supportable from the matter record?
- What relief is being sought?
- What grounds are available for lawyer review?
- What jurisdiction, maintainability, limitation, or procedural objections must
  be addressed?
- Which facts are unsupported and need user confirmation?

The app should not let a strong template hide weak factual support.

## Matter Context Requirements

Court-facing drafting should require a stronger context packet than ordinary
Copilot answers. Possible inputs:

- matter metadata: parties, roles, forum, stage, user-side, adverse side;
- source index / document inventory with lawyer-facing labels;
- extraction records for relevant pleadings/orders/correspondence;
- List of Dates / chronology, including any court-facing chronology mode;
- existing pleadings, orders, notices, replies, affidavits, and annexures;
- user instructions about desired relief and theory of the case;
- missing-information checklist and user answers.

If the matter context is insufficient, the module should produce a draft plan
or question list, not a confident court-facing draft.

## Review And Approval Lifecycle

The draft lifecycle should be explicit and versioned:

| State | Meaning |
| --- | --- |
| `planned` | Filing type selected; draft plan and missing inputs identified. |
| `first_draft` | Initial draft generated for lawyer review. |
| `in_review` | Lawyer is editing, commenting, or asking for section-level changes. |
| `revised` | A later version exists after edits/regeneration. |
| `approved_by_lawyer` | Lawyer/user explicitly approved this version for dispatch. |
| `ready_to_send` | Approved copy preserved under Ready to Send / `40_Dispatch`. |
| `superseded` | Older draft preserved but not current. |

The app should preserve metadata:

- filing template ID and version;
- matter context snapshot / source index version;
- draft version;
- reviewer approval timestamp;
- unresolved warnings or missing inputs;
- source-support map for important factual assertions;
- dispatch copy path when moved to Ready to Send.

## Section-Level Generation

A first version should avoid one giant generation step where practical. A safer
shape is section-by-section drafting:

| Section type | Drafting posture |
| --- | --- |
| Cause title / memo of parties | Mostly structured data and template rules; should ask questions when party metadata is weak. |
| Synopsis / brief facts | Matter-context heavy; should cite internal support in metadata, not visible raw IDs. |
| List of dates | Should reuse or transform the native chronology rather than recreate from scratch. |
| Jurisdiction / maintainability | High legal-risk; should be conservative and lawyer-review marked. |
| Grounds | High legal-risk; should separate factual grounds from legal characterisation. |
| Interim relief | Requires explicit user/lawyer instruction; do not invent urgency. |
| Prayer | Must reflect requested relief; ask if relief is unclear. |
| Affidavit / verification | Template-heavy but jurisdiction-specific; should not invent deponent facts. |
| Annexure list | Source-index and label dependent; should expose missing labels before finalization. |

## Safety And Professional Responsibility Guardrails

Court-facing drafting is higher-risk than summaries or internal analysis.
Minimum guardrails:

- do not invent facts, dates, parties, case numbers, orders, notices, amounts,
  citations, or procedural steps;
- do not turn uncertain extraction into certainty;
- do not suppress material adverse facts known from the matter record;
- do not fabricate case law or legal citations;
- do not expose raw internal source IDs, hashes, paths, or model/provider traces
  in court-facing text;
- mark unsupported allegations and ask for confirmation;
- preserve a source-support map for internal review;
- require explicit lawyer approval before Ready to Send;
- never auto-file, auto-email, or otherwise dispatch without a separate future
  outbound/filing contract.

Case-law drafting should be especially conservative. The first module version
should prefer user-supplied authorities or lawyer-verified authorities over live
public-web case-law claims.

## Matrix Discovery Plan

There should be two discovery modes, separated by time horizon and risk.

### Phase 1: Preset Matrix Discovery

This is the appropriate first research phase before implementation.

Goal:

```text
Build a curated, versioned registry of supported filing families and forum
variants from reliable sources before the user can select them in the product.
```

Research sources should prefer:

- official court rules;
- official court websites;
- official filing/e-filing manuals;
- statutory text and procedural rules;
- court-approved forms where available;
- lawyer-reviewed internal templates supplied by the operator/user.

Each preset row should record:

| Field | Meaning |
| --- | --- |
| `template_id` | Stable app ID, e.g. `delhi_hc_art_226_writ_petition_v1`. |
| `filing_family` | Writ petition, application, SLP, reply, etc. |
| `forum` | Court/tribunal/authority. |
| `jurisdiction_variant` | Local variant, bench, side, original/appellate, if relevant. |
| `procedural_basis` | Article/order/rule/statute as verified. |
| `required_sections` | Ordered section schema. |
| `ancillary_documents` | Affidavit, index, annexures, applications, etc. |
| `required_user_inputs` | Relief, party role, deponent, impugned order, dates, etc. |
| `source_authorities` | Official URLs/docs and internal template references. |
| `last_verified_on` | Date of verification. |
| `review_status` | Draft, lawyer-reviewed, active, retired. |

Normal users should see simple choices like `Delhi High Court writ petition`,
not a research spreadsheet. Operators can inspect the registry and authority
notes.

### Phase 2: Preset Refresh / Maintenance

Court formats and filing requirements can change. Presets need maintenance:

- periodic operator review;
- stale-template warnings after a defined time;
- retired templates preserved for old drafts;
- explicit template version on every generated draft;
- no silent mutation of old draft templates.

### Phase 3: Real-Time Matrix Discovery — Parked Far Future

Real-time discovery means the user asks for a court/provision not in the preset
registry and the app researches the format live.

This should be parked until much later because it is easy to get wrong. If ever
implemented, it should:

- search only approved source classes, preferably official sources first;
- return a research packet, not an immediate court-facing draft;
- show source URLs, dates, and conflicts to the operator/lawyer;
- require lawyer/operator approval before creating a reusable template;
- avoid treating blogs, random samples, or stale PDFs as authority;
- never move a live-discovered draft to Ready to Send without explicit lawyer
  review and approval.

In short:

```text
Preset matrix = first-class product path.
Real-time matrix discovery = future assisted research path, not a first MVP.
```

## MVP Scope Options

Do not start with every filing family. Pick one narrow slice and make the full
review-to-Ready-to-Send loop excellent.

| Option | Advantages | Risks |
| --- | --- | --- |
| Order VII Rule 11 application | More bounded format; good test of application drafting and source support. | Legal standard still requires careful pleading analysis; forum variants may matter. |
| Article 226 writ petition, Delhi High Court | High user value; exercises full court-facing petition workflow. | High complexity: maintainability, jurisdiction, grounds, relief, annexures, local practice. |
| Article 227 petition, one High Court | Useful supervisory-jurisdiction drafting family. | Must distinguish from Article 226 and local writ practice. |
| Supreme Court SLP/constitutional appellate family | Strong format discipline and high-value output. | Highest risk; exact procedural basis, limitation, synopsis/list of dates, and paper-book expectations require careful verification. |

A good MVP may be:

```text
One filing family + one forum variant + draft plan + first draft + review notes
+ versioning + Ready to Send copy.
```

## Non-Goals For The First Slice

- No automatic e-filing.
- No automatic email/dispatch to court, client, counsel, or clerk.
- No live web case-law generation.
- No unsupported court-format guessing.
- No all-India filing matrix on day one.
- No real-time matrix discovery for normal users.
- No overwriting lawyer edits or dispatched copies.

## Open Questions

1. Which filing family should be the first MVP: Order VII Rule 11, Article 226
   Delhi High Court, Article 227 Allahabad High Court, or Supreme Court
   SLP/constitutional appellate drafting?
2. Should the first output be Markdown only, DOCX, PDF, or Markdown first with
   export later?
3. How much formatting fidelity is required for the first MVP versus content
   completeness and review workflow?
4. What court-facing sections must be mandatory for the first chosen filing
   family?
5. Which facts should come only from matter records, and which may come from
   direct user instructions?
6. Should lawyer-supplied templates be imported into the preset registry before
   public web research?
7. What does `Ready to Send` mean operationally for the target user: final PDF,
   DOCX for clerk/counsel, filing bundle folder, or reviewed draft package?
8. How should annexure labels be assigned, reviewed, and locked before dispatch?
9. Should legal grounds be drafted in first MVP, or should the MVP produce a
   structured draft skeleton plus fact sections first?

## Recommended Next Step

Do not code yet. First, choose one MVP filing family and run a matrix-discovery
session for that family only. The output of that session should be a preset
registry row, required-section schema, review checklist, and sample artifact
plan. Only after that should implementation design begin.
