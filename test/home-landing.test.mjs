import assert from "node:assert/strict";
import test from "node:test";
import {
  renderHomeLandingHtml,
  renderHomeMatterResults,
  timeAwareGreeting,
} from "../frontend/views/home-landing.js";

test("home landing renderer keeps matter discovery on Home", () => {
  const html = renderHomeLandingHtml({
    greeting: "Good afternoon.",
    mattersState: {
      mattersHome: "/tmp/matters",
      resumeMatterName: "Ayesha Vs Japan Airlines",
      matters: [
        { name: "Ayesha Vs Japan Airlines" },
        { name: "Mehta vs Skyline" },
        { name: "Atlas Constuction vs Diptishree" },
        { name: "Bharat Nagpal Vs Gionee India" },
      ],
    },
    recentActivityLines: [
      "18:57:34 [landing] 4 matter(s) available",
    ],
  });

  assert.match(html, /Good afternoon\./);
  assert.match(html, /Continue where you left off/);
  assert.match(html, /Available matters/);
  assert.match(html, /4 total/);
  assert.match(html, /Quick actions/);
  assert.match(html, /Search existing matters/);
  assert.match(html, /18:57:34 \[landing\] 4 matter\(s\) available/);
  assert.match(html, /Show local folder/);
  assert.doesNotMatch(html, /Recent matters/);
});

test("home matter search renderer filters by lawyer-facing fields", () => {
  const list = { innerHTML: "" };
  const meta = { textContent: "" };
  const matters = [
    { name: "Ayesha Vs Japan Airlines", clientName: "Rahul Dwivedi" },
    { name: "Mehta vs Skyline", oppositeParty: "Skyline Builders" },
  ];

  renderHomeMatterResults({ matters, query: "", list, meta });
  assert.equal(list.innerHTML, "");
  assert.equal(meta.textContent, "Type to search 2 matters.");

  renderHomeMatterResults({ matters, query: "skyline", list, meta });
  assert.equal(meta.textContent, "1 of 2 matters");
  assert.match(list.innerHTML, /Mehta vs Skyline/);
  assert.doesNotMatch(list.innerHTML, /Ayesha Vs Japan Airlines/);

  renderHomeMatterResults({ matters, query: "missing", list, meta });
  assert.equal(meta.textContent, "0 of 2 matters");
  assert.match(list.innerHTML, /No matters match "missing"\./);
});

test("time-aware greeting uses broad day periods", () => {
  assert.equal(timeAwareGreeting(new Date("2026-05-16T08:00:00")), "Good morning.");
  assert.equal(timeAwareGreeting(new Date("2026-05-16T14:00:00")), "Good afternoon.");
  assert.equal(timeAwareGreeting(new Date("2026-05-16T20:00:00")), "Good evening.");
});
