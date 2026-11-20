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
        assert.equal(candidates.length, 40);
        assert.ok(candidates.some(({ name }) => name === "party_40"));
        return ["party_40"];
      },
    },
    (results) =>
      assert.deepEqual(
        results.map(({ keywords }) => keywords[0]),
        ["party_40"],
      ),
  );
});
