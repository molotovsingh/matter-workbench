import assert from "node:assert/strict";
import test from "node:test";
import {
  listSlashCommandSuggestions,
  parseDeterministicCommand,
  parseNewSkillModeCommand,
  parseSkillIdeaInput,
} from "../frontend/command-parsing.js";

test("command parser maps exact slash commands and static aliases", () => {
  assert.deepEqual(parseDeterministicCommand("/prepare_matter"), { type: "skill", command: "/prepare_matter" });
  assert.deepEqual(parseDeterministicCommand("prepare matter"), { type: "skill", command: "/prepare_matter" });
  assert.deepEqual(parseDeterministicCommand("prepare this matter"), { type: "skill", command: "/prepare_matter" });
  assert.deepEqual(parseDeterministicCommand("matter prep"), { type: "skill", command: "/prepare_matter" });
  assert.deepEqual(parseDeterministicCommand("setup matter"), { type: "skill", command: "/matter-init" });
  assert.deepEqual(parseDeterministicCommand("/extract"), { type: "skill", command: "/extract" });
  assert.deepEqual(parseDeterministicCommand("extract"), { type: "skill", command: "/extract" });
  assert.deepEqual(parseDeterministicCommand("describe sources"), { type: "skill", command: "/describe_sources" });
  assert.deepEqual(parseDeterministicCommand("source labels"), { type: "skill", command: "/describe_sources" });
  assert.deepEqual(parseDeterministicCommand("/context_preview"), { type: "skill", command: "/context_preview" });
  assert.deepEqual(parseDeterministicCommand("context"), { type: "skill", command: "/context_preview" });
  assert.deepEqual(parseDeterministicCommand("show context"), { type: "skill", command: "/context_preview" });
  assert.deepEqual(parseDeterministicCommand("preview matter context"), { type: "skill", command: "/context_preview" });
  assert.deepEqual(parseDeterministicCommand("/context_search"), { type: "search", command: "/context_search", query: "" });
  assert.deepEqual(parseDeterministicCommand("find in matter"), { type: "search", command: "/context_search", query: "" });
  assert.deepEqual(parseDeterministicCommand("search"), { type: "search", command: "/context_search", query: "" });
  assert.deepEqual(parseDeterministicCommand("find"), { type: "search", command: "/context_search", query: "" });
  assert.deepEqual(parseDeterministicCommand("search payment receipts"), { type: "search", command: "/context_search", query: "payment receipts" });
  assert.deepEqual(parseDeterministicCommand("find legal notice"), { type: "search", command: "/context_search", query: "legal notice" });
  assert.deepEqual(parseDeterministicCommand("list of dates"), { type: "skill", command: "/create_case_timeline" });
  assert.deepEqual(parseDeterministicCommand("create list of dates"), { type: "skill", command: "/create_case_timeline" });
  assert.deepEqual(parseDeterministicCommand("chronology"), { type: "skill", command: "/create_case_timeline" });
  assert.deepEqual(parseDeterministicCommand("doctor"), { type: "skill", command: "/doctor" });
  assert.deepEqual(parseDeterministicCommand("check matter health"), { type: "skill", command: "/doctor" });
  assert.deepEqual(parseDeterministicCommand("open inbox"), { type: "lane", input: "open inbox", lanePath: "00_Inbox" });
  assert.deepEqual(parseDeterministicCommand("open library"), { type: "lane", input: "open library", lanePath: "10_Library" });
  assert.deepEqual(parseDeterministicCommand("show library"), { type: "lane", input: "show library", lanePath: "10_Library" });
  assert.deepEqual(parseDeterministicCommand("open workshop"), { type: "lane", input: "open workshop", lanePath: "20_Workshop" });
  assert.deepEqual(parseDeterministicCommand("open drafts"), { type: "lane", input: "open drafts", lanePath: "30_Drafts" });
  assert.deepEqual(parseDeterministicCommand("show drafts"), { type: "lane", input: "show drafts", lanePath: "30_Drafts" });
  assert.deepEqual(parseDeterministicCommand("open dispatch"), { type: "lane", input: "open dispatch", lanePath: "40_Dispatch" });
  assert.deepEqual(parseDeterministicCommand("show status"), { type: "status" });
  assert.deepEqual(parseDeterministicCommand("status"), { type: "status" });
  assert.deepEqual(parseDeterministicCommand("open skills"), { type: "skills", input: "open skills" });
  assert.deepEqual(parseDeterministicCommand("show skills"), { type: "skills", input: "show skills" });
  assert.deepEqual(parseDeterministicCommand("skills"), { type: "skills", input: "skills" });
});

test("command parser does not fuzzy-match unsupported text", () => {
  assert.equal(parseDeterministicCommand("please extract this"), null);
  assert.equal(parseDeterministicCommand("/describe-sources"), null);
  assert.equal(parseDeterministicCommand("create a list of dates skill"), null);
});

test("new skill mode parser recognizes exact mode openers", () => {
  for (const input of [
    "new skill",
    "create skill",
    "create a skill",
    "make skill",
    "make a skill",
    "design skill",
    "design a skill",
  ]) {
    assert.deepEqual(parseNewSkillModeCommand(input), {
      type: "new_skill_mode",
      input,
    });
  }
  assert.equal(parseNewSkillModeCommand("new skill for limitation"), null);
  assert.equal(parseNewSkillModeCommand("create a skill to check limitation"), null);
});

test("skill idea parser detects explicit proposal phrases only", () => {
  const cases = [
    ["create a new skill for checking limitation", "checking limitation"],
    ["create a new skill to check limitation", "check limitation"],
    ["create a new skill that does one job - checks limitation", "does one job - checks limitation"],
    ["create new skill that checks limitation", "checks limitation"],
    ["create a skill for filing bundles", "filing bundles"],
    ["create a skill to summarize pleadings", "summarize pleadings"],
    ["create a skill that checks limitation", "checks limitation"],
    ["make a new skill for checking limitation", "checking limitation"],
    ["make new skill that checks limitation", "checks limitation"],
    ["make a new skill that summarises the best case pleadings for the lawyer", "summarises the best case pleadings for the lawyer"],
    ["make a skill for extracting prayer clauses", "extracting prayer clauses"],
    ["make a skill that extracts prayer clauses", "extracts prayer clauses"],
    ["new skill bundle exhibits", "bundle exhibits"],
    ["I need a skill that checks limitation", "checks limitation"],
    ["I want a skill that determines the limitation of the matter", "determines the limitation of the matter"],
    ["I want a new skill that determines limitation", "determines limitation"],
    ["I want a skill to determine limitation", "determine limitation"],
    ["I want a new skill to determine limitation", "determine limitation"],
    ["I want a skill for limitation review", "limitation review"],
    ["I want a new skil for limitation review", "limitation review"],
    ["can we make a skill for filing bundles", "filing bundles"],
    ["create a new skil for checking if limitatation is for or against the client", "checking if limitatation is for or against the client"],
    ["build a skill which reviews missing annexures", "reviews missing annexures"],
    ["new skill to compare pleadings", "compare pleadings"],
  ];
  for (const [input, idea] of cases) {
    assert.deepEqual(parseSkillIdeaInput(input), {
      type: "skill_idea",
      text: input,
      idea,
    });
  }
  assert.equal(parseSkillIdeaInput("please extract this"), null);
  assert.equal(parseSkillIdeaInput("list of dates"), null);
});

test("slash command suggestions are explicit and description-backed", () => {
  assert.deepEqual(
    listSlashCommandSuggestions("/").map((suggestion) => suggestion.command),
    ["/matter-init", "/prepare_matter", "/extract", "/describe_sources", "/context_preview", "/context_search", "/create_case_timeline", "/the_story", "/procedural_posture_diagnosis", "/create_mw_listofdates", "/doctor"],
  );
  assert.deepEqual(
    listSlashCommandSuggestions("/prep").map((suggestion) => suggestion.command),
    ["/prepare_matter"],
  );
  assert.deepEqual(
    listSlashCommandSuggestions("/de").map((suggestion) => suggestion.command),
    ["/describe_sources"],
  );
  assert.equal(listSlashCommandSuggestions("chronology").length, 0);
  assert.match(listSlashCommandSuggestions("/create")[0].description, /case timeline/i);
  assert.match(listSlashCommandSuggestions("/context")[0].description, /evidence packet/i);
  assert.match(listSlashCommandSuggestions("/context_s")[0].description, /locally/i);
  assert.deepEqual(
    listSlashCommandSuggestions("/party", [{
      command: "/party_officer_map",
      description: "Map formal party names and officers.",
    }]).map((suggestion) => suggestion.command),
    ["/party_officer_map"],
  );
});
