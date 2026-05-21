# Communication Evidence Ingestion

Date: 2026-05-21
Status: Parked future feature

## Problem

Legal matters often contain communication evidence that is not a neat PDF or
Word document:

- WhatsApp `.txt` exports;
- WhatsApp `.zip` exports with chat text and media;
- screenshots of chats;
- email `.eml` files;
- Outlook `.msg` files;
- email attachments;
- audio/video/media forwarded through messaging apps.

Matter Workbench preserves many of these files today, but only some are
understood as source text. That distinction matters because a lawyer may rely on
messages for notice, admissions, demands, threats, payments, settlement terms,
delivery status, and limitation-triggering dates.

## Current Behavior

Current V1 behavior should stay as-is for now.

### WhatsApp Text Exports

`.txt` exports are treated as `Text Notes`.

They are extracted as plain text, not as structured chat transcripts. The app
does not currently split messages into:

- sender;
- timestamp;
- message body;
- attachment reference;
- deleted/omitted-media marker.

This means simple WhatsApp text can enter Source Labels, List of Dates, and
Copilot, but the app does not yet understand it as conversation evidence.

### WhatsApp Zip Exports

`.zip` files are classified as `Archives`.

They are preserved in intake but skipped during extraction. The app does not
unzip WhatsApp exports today.

### Screenshots And Media

`.jpg`, `.jpeg`, `.png`, and `.heic` are classified as `Images`.

They are preserved and visible as files, but extraction skips them today. No
OCR/vision pass is run on screenshots. Screenshot-only chat evidence is
therefore not read into Source Labels, List of Dates, or Copilot.

Audio, video, and other media are generally preserved but not transcribed or
analyzed.

### Email Files

`.eml` files are supported through `mailparser`.

The extractor reads:

- subject;
- from/to/cc/bcc;
- date;
- message id;
- plain-text body;
- attachment names, sizes, and content types.

Attachments inside `.eml` are listed but not extracted as separate source
documents. Outlook `.msg` files are not supported today.

## Future Direction

Communication evidence should eventually become a specialized ingestion family,
not just generic text extraction.

The future pass should produce structured source records for:

- sender;
- recipient or chat participant;
- timestamp;
- message text;
- attachment/media reference;
- source file and raw citation;
- confidence/parse warnings;
- timezone/date-format uncertainty;
- deleted message or omitted-media markers.

The first goal is not drafting. The first goal is to make communications usable
as reliable source evidence.

## WhatsApp-Specific Future Slice

The first WhatsApp slice should support exported `.txt` and `.zip` bundles.

It should:

- parse common WhatsApp date/time formats;
- split each message into structured rows;
- preserve original line text;
- detect omitted media references;
- link media filenames when present in the export;
- warn when locale/date format is ambiguous;
- produce a readable communication timeline view.

Screenshots should be a fallback path for chat evidence, not the first-class
path when export text is available.

## Email-Specific Future Slice

The first email slice should keep `.eml` support and add:

- extraction of attachments as separate source candidates;
- parent-child linkage between email and attachment;
- better thread/reply-chain handling;
- `.msg` support if beta users supply Outlook exports;
- clear warnings when attachments are mentioned but not available as source
  documents.

The app should not silently treat attachment filenames as proof of attachment
content. If the attachment is not extracted, it should remain a limitation.

## Screenshot / Vision Fallback

Screenshots and image-based chat evidence may need OCR or vision.

That should be a repair/fallback path used when:

- no text export is available;
- the screenshot itself is the evidence;
- image quality is sufficient;
- the app can preserve uncertainty and source references.

Vision output must not overwrite structured chat/email data. It should become an
advisory source extraction with visible confidence and review warnings.

## Non-Goals For Now

- Do not implement WhatsApp parsing today.
- Do not unzip archives today.
- Do not add image OCR/vision for screenshots today.
- Do not extract `.eml` attachments today.
- Do not add `.msg` support today.
- Do not treat communication evidence as lawyer-reviewed unless a future review
  workflow explicitly confirms it.

## Revisit Trigger

Revisit this when beta matters regularly contain communication-heavy evidence,
especially:

- WhatsApp chats used to prove notice/admission/payment/demand;
- screenshots used as primary evidence;
- email attachments missing from the extracted source record;
- Outlook `.msg` files supplied by lawyers;
- media/audio/video that materially affects the matter.

The first implementation should be read-only ingestion and source
understanding, not drafting or court-facing export.
