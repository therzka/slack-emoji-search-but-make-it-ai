import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { searchEmojis } from "./utils";

test("the shortlist finds acronyms, exact names and a common idiom without sending ignored items or file paths", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "emoji-search-"));
  t.after(() => rm(directory, { recursive: true }));
  const data = join(directory, "emojis");
  await mkdir(data);
  await writeFile(
    join(data, "emojis.json"),
    JSON.stringify({
      approved: "private/approved.png",
      rocket_launch: "rocket.png",
      ignore_rocket: "ignore.png",
      big_rocket_01: "frame.png",
      shipping_box: "box.png",
    }),
  );
  await writeFile(
    join(data, "aliases.json"),
    JSON.stringify({ approved: ["lgtm"] }),
  );

  for (const [query, expected] of [
    ["lgtm", "approved"],
    [":rocket_launch:", "rocket_launch"],
    ["ship it", "rocket_launch"],
  ]) {
    let checks = 0;
    await searchEmojis(
      directory,
      query,
      {
        mode: "jev",
        apiKey: "test-key",
        ignoreList: ["ignore"],
        judge: async (_query, candidates) => {
          checks++;
          const names = candidates.map(({ name }) => name);
          assert.ok(names.includes(expected), `${query}: ${names.join(", ")}`);
          assert.ok(
            !names.includes("ignore_rocket") &&
              !names.includes("big_rocket_01"),
          );
          assert.ok(!JSON.stringify(candidates).includes(".png"));
          return [expected];
        },
      },
      (results) =>
        assert.deepEqual(
          results.map(({ keywords }) => keywords[0]),
          [expected],
        ),
    );
    assert.equal(checks, 1);
  }

  const updates: unknown[] = [];
  await searchEmojis(
    directory,
    "ship it",
    {
      mode: "jev",
      apiKey: "test-key",
      judge: async () => [],
    },
    (results) => updates.push(results),
  );
  assert.deepEqual(
    updates,
    [[]],
    "never display unverified local results in Jev mode",
  );

  await searchEmojis(
    directory,
    "zqxwv",
    {
      mode: "jev",
      apiKey: "test-key",
      judge: async () => assert.fail("empty shortlist should not call Jev"),
    },
    (results) => assert.deepEqual(results, []),
  );
});

test("a single search term can fill the wider Jev shortlist without changing local search", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "emoji-search-"));
  t.after(() => rm(directory, { recursive: true }));
  const data = join(directory, "emojis");
  await mkdir(data);
  await writeFile(
    join(data, "emojis.json"),
    JSON.stringify(
      Object.fromEntries(
        Array.from({ length: 45 }, (_, i) => [`party_${i + 1}`, "party.png"]),
      ),
    ),
  );
  await writeFile(join(data, "aliases.json"), "{}");

  await searchEmojis(directory, "party", { mode: "local" }, (results) => {
    assert.equal(results.length, 5);
  });

  await searchEmojis(
    directory,
    "party",
    {
      mode: "jev",
      apiKey: "test-key",
      judge: async (_query, candidates) => {
        assert.equal(candidates.length, 45);
        assert.ok(candidates.some(({ name }) => name === "party_45"));
        return ["party_45"];
      },
    },
    (results) =>
      assert.deepEqual(
        results.map(({ keywords }) => keywords[0]),
        ["party_45"],
      ),
  );
});

test("diagnostics preserve the shortlist and scores even when Jev rejects every match", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "emoji-search-"));
  t.after(() => rm(directory, { recursive: true }));
  await mkdir(join(directory, "emojis"));
  await writeFile(
    join(directory, "emojis", "emojis.json"),
    JSON.stringify({
      "bufo-heart": "heart.png",
    }),
  );
  await writeFile(join(directory, "emojis", "aliases.json"), "{}");
  let diagnostic: { name: string; score: number | null }[] = [];
  await searchEmojis(
    directory,
    "bufo loves you",
    {
      mode: "jev",
      apiKey: "test-key",
      onDiagnostics: (value) => {
        diagnostic = value;
      },
      judge: async (_query, candidates, options) => {
        options.onDecisions?.(
          candidates.map(({ name }) => ({ name, score: 0.42 })),
        );
        return [];
      },
    },
    (results) => assert.deepEqual(results, []),
  );
  assert.deepEqual(diagnostic, [{ name: "bufo-heart", score: 0.42 }]);
});

test("multi-word queries with inflections and concepts surface matching emojis past 40 same-prefix entries", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "emoji-search-"));
  t.after(() => rm(directory, { recursive: true }));
  const data = join(directory, "emojis");
  await mkdir(data);
  const filler = Object.fromEntries(
    Array.from({ length: 50 }, (_, i) => [`bufo_filler_${i + 1}`, "bufo.png"]),
  );
  await writeFile(
    join(data, "emojis.json"),
    JSON.stringify({
      ...filler,
      loves: "loves.png",
      bufo_love: "bufo_love.png",
      bufo_heart: "bufo_heart.png",
      bufo_hug: "bufo_hug.png",
    }),
  );
  await writeFile(join(data, "aliases.json"), "{}");

  await searchEmojis(
    directory,
    "bufo loves you",
    {
      mode: "jev",
      apiKey: "test-key",
      judge: async (_query, candidates) => {
        const names = candidates.map(({ name }) => name);
        assert.ok(names.includes("bufo_love"), `missing bufo_love in ${names}`);
        assert.ok(
          names.includes("bufo_heart"),
          `missing bufo_heart in ${names}`,
        );
        assert.ok(names.includes("bufo_hug"), `missing bufo_hug in ${names}`);
        return ["bufo_love", "bufo_heart", "bufo_hug"];
      },
    },
    (results) =>
      assert.deepEqual(
        results.map(({ keywords }) => keywords[0]),
        ["bufo_love", "bufo_heart", "bufo_hug"],
      ),
  );
});
