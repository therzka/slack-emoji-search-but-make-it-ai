import assert from "node:assert/strict";
import { rankEmojiMatches, type EmojiTermMatches } from "./ranking";

const termMatches: EmojiTermMatches[] = [
  {
    term: "no-meetings",
    substringMatches: [],
    fuseMatches: [
      "zoom-meeting",
      "bufo-melting",
      "this-meeting-could-have-been-a-fist-fight",
    ],
  },
  {
    term: "meeting-hate",
    substringMatches: [],
    fuseMatches: [
      "meeting-hell",
      "melting-face",
      "melting-hot",
      "melting-face-intensifies",
      "marketing-hat",
    ],
  },
  {
    term: "skip-meeting",
    substringMatches: [],
    fuseMatches: ["this-meeting-could-have-been-a-fist-fight"],
  },
  {
    term: "facepalm",
    substringMatches: ["facepalm", "facepalm-animated", "facepalms"],
    fuseMatches: ["facepalm", "facepalm-animated", "facepalms"],
  },
  {
    term: "eye-roll",
    substringMatches: ["eye-roll", "eye-roll-up", "eye-roll-off"],
    fuseMatches: ["eye-roll", "eye-roll-up", "eye-roll-off"],
  },
];

const ranked = rankEmojiMatches(termMatches, {
  query: "i hate meetings",
  limit: 10,
});

assert.ok(ranked.includes("this-meeting-could-have-been-a-fist-fight"));
assert.ok(ranked.includes("meeting-hell"));
assert.ok(
  ranked.indexOf("this-meeting-could-have-been-a-fist-fight") <
    ranked.indexOf("facepalm"),
);
assert.ok(ranked.indexOf("meeting-hell") < ranked.indexOf("eye-roll"));

console.log("context ranking regression passed");
