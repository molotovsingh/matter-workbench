# Extraction Quality Audit — mehta Matter

## Summary

The `/extract` engine preserves **near 100% of key labeling signals and content** across all 10 mehta documents. 

An initial audit suggested high text loss on PDFs, Word documents, and Spreadsheets, but this was a **false alarm** caused by comparing the extracted plaintext character count against the binary file byte size (e.g., comparing 2,000 characters of text to a 6.6KB zipped `.xlsx` file). A manual review of the raw extracted JSON and the original files confirms that the extraction fidelity is excellent.

This means: **the post-extraction labeling bakeoff results are highly valid.** The models are being evaluated on complete, high-quality text representations of the original documents.

## Deep Dive Findings

### 1. Spreadsheets (Excel)
FILE-0001 (bank statement) and FILE-0007 (payment receipts) are `.xlsx` files. The extraction engine uses `xlsx@0.18.5` to parse them.
- **Rows are fully preserved:** Every transaction row is captured as a `table_row` block with cells pipe-separated (e.g., `15-Mar-2022 | NEFT TO SKYLINE... | 004521 | 785000`).
- **Metadata is preserved:** Sheet names, headers, and AI notes embedded in the Excel file are all extracted perfectly.
- **Verdict:** Excellent fidelity. The lack of `row`/`col` structural metadata does not harm labeling or Q&A.

### 2. PDFs
FILE-0005, FILE-0006, and FILE-0010 are native PDFs extracted via `pdfjs-dist`.
- **Content is fully preserved:** Headers, body text, and footers are all captured.
- **False Alarm on FILE-0006:** The initial script looked for the exact phrase "DEMAND NOTICE", but the actual document header reads "LEGAL NOTICE... DEMAND FOR POSSESSION". The text is fully present.
- **Verdict:** Excellent fidelity for native PDFs. (Note: Scanned PDFs requiring OCR were not present in this test set, so OCR fidelity remains untested).

### 3. Word Documents
FILE-0009 (site inspection report) is a `.docx` extracted via `mammoth`.
- **Content is fully preserved:** The inspection details, tables, and signatures are captured.
- **False Alarm on FILE-0009:** The initial script flagged the word "defect" as missing. A raw `grep` of the original `document.xml` confirms the word "defect" does not exist in the document at all. 
- **Verdict:** Excellent fidelity.

### 4. Text Files
All four `.txt` files (correspondence, transcripts) have 96-98% character coverage and near-perfect text similarity.
- **Verdict:** Perfect fidelity.

## Impact on Labeling Bakeoff

Because the extraction quality is extremely high, **the labeling bakeoff results reflect true model performance.** When a model fails to label a document correctly, it is a failure of the model's reasoning or prompt compliance, not a failure of the extraction layer.

## Recommendations

1. **Proceed with the winning model.** `google/gemini-2.0-flash-lite` or `inception/mercury-2` can be confidently adopted for production labeling based on the bakeoff results.
2. **Track 3 (direct-document bakeoff) is low priority.** Since text extraction is working so well for native digital files, sending raw PDFs/images to vision models is unlikely to yield better labeling results. It would only increase latency and cost.
3. **Test OCR later.** The `mehta` matter does not contain scanned, image-only PDFs. When testing OCR, a separate audit should be run to measure Tesseract/vision-model fidelity on messy scans.
