import assert from "node:assert/strict";
import test from "node:test";

import {
  buildParallelSearchRequest,
  fetchLegalDevelopments,
  formatLegalDevelopmentsDigest,
  normalizeParallelSearchResults,
  parseProbeArgs,
} from "../scripts/legal-updates-probe.mjs";

test("legal updates probe parses country, days, max, mode, and json flags", () => {
  const options = parseProbeArgs([
    "--country", "United Kingdom",
    "--days", "14",
    "--max", "4",
    "--mode", "advanced",
    "--json",
  ]);

  assert.equal(options.country, "United Kingdom");
  assert.equal(options.days, 14);
  assert.equal(options.maxItems, 4);
  assert.equal(options.mode, "advanced");
  assert.equal(options.json, true);
});

test("legal updates probe builds a Parallel Search request without matter data", () => {
  const body = buildParallelSearchRequest({
    country: "India",
    days: 7,
    maxItems: 5,
    mode: "basic",
  });

  assert.equal(body.mode, "basic");
  assert.equal(body.max_chars_total, 28000);
  assert.match(body.objective, /India/i);
  assert.match(body.objective, /last 7 days/i);
  assert.ok(body.search_queries.length > 3);
  assert.match(body.search_queries.join("\n"), /SCC Online/i);
  assert.match(body.search_queries.join("\n"), /LiveLaw/i);
  assert.doesNotMatch(JSON.stringify(body), /client|active workspace|file path|FILE-\d{4}|Bharat|Atlas|Ayesha/i);
});

test("legal updates probe fetches a wider candidate pool than the display limit", () => {
  const body = buildParallelSearchRequest({
    country: "India",
    days: 7,
    maxItems: 2,
  });

  assert.equal(body.max_chars_total, 28000);
});

test("legal updates probe normalizes Parallel results without fabricating court or date", () => {
  const updates = normalizeParallelSearchResults({
    results: [
      {
        url: "https://example.test/item",
        title: "India court update headline",
        excerpts: ["The court issued a procedural clarification in a pending matter this week.", "Second excerpt."],
      },
    ],
  }, { maxItems: 3 });

  assert.deepEqual(updates, [
    {
      id: "legal-update-1",
      title: "India court update headline",
      source: "parallel_search",
      url: "https://example.test/item",
      date: null,
      court: null,
      category: "Court Procedure",
      summary: "The court issued a procedural clarification in a pending matter this week.",
      citations: ["https://example.test/item"],
      tags: ["public-source"],
    },
  ]);
});

test("legal updates probe turns messy source excerpts into readable TLDR summaries", () => {
  const updates = normalizeParallelSearchResults({
    results: [
      {
        url: "https://www.scconline.com/blog/post/2026/05/11/weekly-legal-developments-india-4-10-may-2026/",
        title: "Top Weekly Legal Developments India: 4 - 10 May 2026 | SCC Times",
        publish_date: "2026-05-11",
        excerpts: [
          "# Top Legal Developments [4 - 10 May 2026] | Police Station cleaning for Bail Condition; EU law push and more HIGH COURT HIGHLIGHTS OF THIS WEEK Read more HERE RTI | No Larger Public Interest; Wife Cannot Use RTI to Access Husband's Income Tax Details in Matrimonial Disputes In Kapil Agarwal v. CPIO Income Tax Officer, Moradabad, 2026 SCC OnLine Del 2276, the Delhi High Court set aside the impugned order, holding that a wife cannot use RTI to access her husband's income details.",
        ],
      },
      {
        url: "https://www.sci.gov.in/collegium-resolutions/",
        title: "Collegium Resolutions | Supreme Court of India | India",
        excerpts: [
          "Collegium Resolutions | Title | View / Download | Statement dated 11th / 12th May 2026 reg. appointment of Advocates as Judges in the High Court at Calcutta | Accessible Version : View (251 KB) Click here to download",
        ],
      },
    ],
  }, { maxItems: 2, days: 14, now: new Date("2026-05-22T10:00:00Z") });

  assert.match(updates[0].summary, /Delhi High Court set aside/i);
  assert.match(updates[0].title, /Delhi High Court:/i);
  assert.equal(updates[0].category, "Family Law");
  assert.doesNotMatch(updates[0].title, /Top Weekly Legal Developments|SCC Times/i);
  assert.doesNotMatch(updates[0].summary, /Top Legal Developments|HIGH COURT HIGHLIGHTS|Read more HERE|\[|\]/i);
  assert.ok(updates[0].summary.length <= 360);
  assert.match(updates[1].summary, /appointment of Advocates as Judges in the High Court at Calcutta/i);
  assert.doesNotMatch(updates[1].summary, /View \/ Download|Accessible Version|download/i);
});

test("legal updates probe drops generic homepages and access-wall snippets", () => {
  const updates = normalizeParallelSearchResults({
    results: [
      {
        url: "https://www.livelaw.in/",
        title: "Supreme Court - High Court - Legal Breaking News | Live Law India",
        excerpts: ["Homepage navigation and unrelated headlines."],
      },
      {
        url: "https://www.livelaw.in/top-stories",
        title: "Top Stories in Supreme Court",
        excerpts: ["IP subscription is detected. Redirecting to register page..."],
      },
      {
        url: "https://www.livelaw.in/high-court/delhi-high-court/delhi-high-court-decides-limitation-issue-2026",
        title: "Delhi High Court decides limitation issue",
        publish_date: "2026-05-20",
        excerpts: ["The court decided a limitation issue in a commercial dispute."],
      },
      {
        url: "https://github.com/example/legal-dataset",
        title: "GitHub - example/legal-dataset",
        publish_date: "2026-05-20",
        excerpts: ["A repository containing court data."],
      },
      {
        url: "https://example.test/old-update",
        title: "Top 20 Indian Legal Developments - 2026-May-12",
        excerpts: ["An old evergreen page."],
      },
      {
        url: "https://www.sci.gov.in/latest-orders/",
        title: "Latest Orders | Supreme Court of India | India",
        excerpts: ["Download App From. Website Policies. Contact Us. Help. Disclaimer."],
      },
      {
        url: "https://fliphtml5.com/home/ncez",
        title: "description: India Legal, ENC's flagship product is a credible news magazine",
        excerpts: ["Enjoying your free trial? Only 9 days left! Upgrade Now."],
      },
      {
        url: "https://example.test/insights/publications/2026/02/old-tax-update",
        title: "Supreme Court Ruling on Old Tax Treaty Issue",
        excerpts: ["An older page with no publish date but a dated URL."],
      },
      {
        url: "https://www.instagram.com/p/example",
        title: "Legal update on Instagram",
        publish_date: "2026-05-20",
        excerpts: ["A social post, not a stable legal source page."],
      },
      {
        url: "https://www.housingwire.com/category/legal",
        title: "Legal News - HousingWire",
        publish_date: "2026-05-15",
        excerpts: ["Legal latest posts about a United States real estate finance merger vote."],
      },
      {
        url: "https://verdictfinder.sci.gov.in/elk_frontend",
        title: "SUPREME COURT OF INDIA - verdictfinder.sci.gov.in",
        publish_date: "2026-05-20",
        excerpts: ["SUPREME COURT OF INDIA Judgments and Orders Home Supreme Court Phrase All Words Any Words LQVBNx Invalid captcha !!"],
      },
      {
        url: "https://www.scconline.com/blog/post/2026/05/17/2026-scc-vol-4-part-1-latest-supreme-court-cases/",
        title: "2026 SCC Vol. 4 Part 1: Key Supreme Court Cases on Arbitration, Civil Procedure Code, Consumer Protection, Income Tax & more",
        publish_date: "2026-05-17",
        excerpts: ["9(2) and 11(6) r/w S."],
      },
      {
        url: "https://www.livelaw.in/high-court/delhi-high-court/delhi-high-court-weekly-round-up-may-11-to-may-17-2026-535099",
        title: "Delhi High Court Weekly Round-Up: May 11 To May 17, 2026",
        publish_date: "2026-05-21",
        excerpts: ["Nupur Thapliyal Delhi High Court Weekly Round-Up: May 11 To May 17, 2026 Citations 2026 LiveLaw (Del) 475 to 2026 LiveLaw (Del) 497 NOMINAL INDEX J & Anr."],
      },
      {
        url: "https://www.barandbench.com/topic/supreme-court-of-india",
        title: "Supreme Court of India - Bar and Bench",
        publish_date: "2026-05-21",
        excerpts: ["Barandbench Subscribe Latest Legal News News Dealstreet Viewpoint Columns Interviews Law School Legal Jobs Supreme Court of India get latest news, breaking news about supreme court of India."],
      },
    ],
  }, { maxItems: 5, days: 7, now: new Date("2026-05-22T10:00:00Z") });

  assert.deepEqual(updates.map((row) => row.title), ["Delhi High Court decides limitation issue"]);
});

test("legal updates probe prefers legal-source results over general-news framing", () => {
  const updates = normalizeParallelSearchResults({
    results: [
      {
        url: "https://www.scconline.com/blog/post/2026/05/11/weekly-legal-developments-india-4-10-may-2026/",
        title: "Top Weekly Legal Developments India: 4 - 10 May 2026 | SCC Times",
        publish_date: "2026-05-11",
        excerpts: [
          "HIGH COURT HIGHLIGHTS OF THIS WEEK The Allahabad High Court, noting the limits on religious practice under Articles 25 and 26, held that no individual can claim a right to use public land as an exclusive or recurring religious space.",
        ],
      },
      {
        url: "https://www.aljazeera.com/features/2026/5/18/hindu-order-runs-india-court-declares-another-medieval-mosque-a-temple",
        title: "‘Hindu order runs India’: Court declares another medieval mosque a temple | Islamophobia News | Al Jazeera",
        publish_date: "2026-05-18",
        excerpts: [
          "In repeat of a familiar pattern, the Madhya Pradesh High Court rules that the historic Kamal Maula mosque is a temple dedicated to a Hindu goddess.",
        ],
      },
    ],
  }, { maxItems: 5, days: 14, now: new Date("2026-05-23T10:00:00Z") });

  assert.deepEqual(updates.map((row) => row.url), [
    "https://www.scconline.com/blog/post/2026/05/11/weekly-legal-developments-india-4-10-may-2026/",
  ]);
  assert.match(updates[0].title, /Allahabad High Court:/i);
  assert.doesNotMatch(updates[0].title, /Top Weekly Legal Developments/i);
});

test("legal updates probe turns weekly round-up titles into legal headlines when the excerpt is useful", () => {
  const updates = normalizeParallelSearchResults({
    results: [
      {
        url: "https://www.livelaw.in/amp/high-court/delhi-high-court/delhi-high-court-weekly-round-up-may-04-to-may-10-2026-533862",
        title: "Delhi High Court Weekly Round-Up: May 04 To May 10, 2026",
        publish_date: "2026-05-12",
        excerpts: [
          "The Delhi High Court has upheld the conviction of a husband, his mother and brother in a case involving an attempt to set a pregnant woman on fire over dowry demands, but reduced their sentence to the period already undergone.",
        ],
      },
    ],
  }, { maxItems: 5, days: 14, now: new Date("2026-05-23T10:00:00Z") });

  assert.match(updates[0].title, /Delhi High Court: upheld the conviction/i);
  assert.equal(updates[0].category, "Criminal Law");
  assert.doesNotMatch(updates[0].title, /Weekly Round-Up/i);
});

test("legal updates probe assigns broad lazy categories for scannability", () => {
  const updates = normalizeParallelSearchResults({
    results: [
      {
        url: "https://www.scconline.com/blog/post/2026/05/11/public-land-religious-use/",
        title: "Top Weekly Legal Developments India: 4 - 10 May 2026 | SCC Times",
        publish_date: "2026-05-11",
        excerpts: [
          "The Allahabad High Court, noting the limits on religious practice under Articles 25 and 26, held that no individual can claim a right to use public land as an exclusive or recurring religious space.",
        ],
      },
      {
        url: "https://www.scconline.com/blog/post/2026/05/12/arbitration-stamp-duty/",
        title: "Supreme Court decides arbitration agreement issue",
        publish_date: "2026-05-12",
        excerpts: [
          "The Supreme Court of India clarified that arbitration clauses in commercial contracts should not be defeated by a curable stamp duty defect.",
        ],
      },
    ],
  }, { maxItems: 5, days: 14, now: new Date("2026-05-23T10:00:00Z") });

  assert.deepEqual(updates.map((row) => row.category), ["Constitutional / Public Law", "Commercial / Arbitration"]);
});

test("legal updates probe calls Parallel Search with x-api-key and formats headline-link output", async () => {
  const requests = [];
  const now = new Date("2026-05-22T10:00:00Z");
  const updates = await fetchLegalDevelopments({
    apiKey: "parallel-test-key",
    country: "India",
    days: 7,
    maxItems: 2,
    now,
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            results: [
              {
                url: "https://example.test/supreme-court",
                title: "Supreme Court of India issues procedural ruling",
                publish_date: "2026-05-21",
                excerpts: ["# Update [<strong>The Supreme Court</strong>](https://example.test) issued a &quot;procedural&quot; clarification this week."],
              },
            ],
          };
        },
      };
    },
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.parallel.ai/v1/search");
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.headers["x-api-key"], "parallel-test-key");
  assert.equal(requests[0].init.headers.authorization, undefined);
  assert.deepEqual(updates.map((row) => row.title), ["Supreme Court of India issues procedural ruling"]);

  const digest = formatLegalDevelopmentsDigest(updates, {
    country: "India",
    days: 7,
    now,
  });
  assert.match(digest, /Here's what happened this week in legal developments: India/i);
  assert.match(digest, /Supreme Court of India issues procedural ruling/);
  assert.doesNotMatch(digest, /Category:/);
  assert.doesNotMatch(digest, /TLDR:/);
  assert.doesNotMatch(digest, /The Supreme Court issued a "procedural" clarification/);
  assert.doesNotMatch(digest, /<strong>|&quot;|\[|\]\(|# Update/);
  assert.doesNotMatch(digest, /2026-05-21/);
  assert.match(digest, /https:\/\/example\.test\/supreme-court/);
});
