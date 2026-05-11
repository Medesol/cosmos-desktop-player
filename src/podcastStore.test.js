import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createPodcastStore, normalizePodcastForStorage, normalizeSearchText } from "./podcastStore.js";

function tempDb(t) {
  const dir = mkdtempSync(join(tmpdir(), "podcast-store-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return join(dir, "podcasts.sqlite");
}

const basePodcast = {
  id: "aaaaaaaaaaaaaaaaaaaaaaaa",
  title: "忽左忽右",
  author: "JustPod",
  brief: "从中文世界出发",
  description: "历史、文化与公共生活",
  coverUrl: "https://image.example/show.jpg",
  subscriptionCount: 120000,
  episodeCount: 300,
  latestEpisodePubDate: "2026-05-01T00:00:00.000Z",
  sourceUrl: "https://www.xiaoyuzhoufm.com/podcast/aaaaaaaaaaaaaaaaaaaaaaaa",
  aliases: ["忽左", "leftright"]
};

test("normalizeSearchText lowercases and removes repeated whitespace", () => {
  assert.equal(normalizeSearchText("  JustPod   忽左忽右  "), "justpod忽左忽右");
});

test("normalizePodcastForStorage validates id and title", () => {
  assert.throws(() => normalizePodcastForStorage({ ...basePodcast, id: "bad" }), /节目 ID/);
  assert.throws(() => normalizePodcastForStorage({ ...basePodcast, title: "   " }), /节目标题/);
  assert.deepEqual(normalizePodcastForStorage(basePodcast).aliases, ["忽左", "leftright"]);
});

test("podcast store creates, gets, updates, lists, and deletes records", (t) => {
  let timestamp = "2026-05-10T00:00:00.000Z";
  const store = createPodcastStore({ dbPath: tempDb(t), now: () => timestamp });
  t.after(() => store.close());

  const created = store.upsertPodcast(basePodcast);
  assert.equal(created.title, "忽左忽右");
  assert.equal(created.createdAt, "2026-05-10T00:00:00.000Z");
  assert.equal(created.updatedAt, "2026-05-10T00:00:00.000Z");

  timestamp = "2026-05-11T00:00:00.000Z";
  const updated = store.upsertPodcast({ ...basePodcast, title: "忽左忽右新版", aliases: ["忽左忽右"] });
  assert.equal(updated.title, "忽左忽右新版");
  assert.equal(updated.createdAt, "2026-05-10T00:00:00.000Z");
  assert.equal(updated.updatedAt, "2026-05-11T00:00:00.000Z");
  assert.deepEqual(updated.aliases, ["忽左忽右"]);

  assert.deepEqual(
    store.listPodcasts({ limit: 10, offset: 0 }).map((podcast) => podcast.id),
    [basePodcast.id]
  );

  assert.equal(store.deletePodcast(basePodcast.id), true);
  assert.equal(store.getPodcast(basePodcast.id), null);
  assert.equal(store.deletePodcast(basePodcast.id), false);
});

test("podcast store clamps list and search limits", (t) => {
  const store = createPodcastStore({ dbPath: tempDb(t) });
  t.after(() => store.close());

  store.upsertPodcast(basePodcast);
  store.upsertPodcast({
    ...basePodcast,
    id: "bbbbbbbbbbbbbbbbbbbbbbbb",
    title: "故事 FM",
    aliases: ["story"]
  });

  assert.equal(store.listPodcasts({ limit: 0 }).length, 1);
  assert.equal(store.searchPodcasts("故事", { limit: 0 }).length, 1);
});

test("podcast store supports in-memory databases", (t) => {
  const store = createPodcastStore({ dbPath: ":memory:" });
  t.after(() => store.close());

  store.upsertPodcast(basePodcast);

  assert.equal(store.getPodcast(basePodcast.id).title, "忽左忽右");
});

test("podcast store searches title, aliases, author, and Chinese substring fallback", (t) => {
  const store = createPodcastStore({ dbPath: tempDb(t) });
  t.after(() => store.close());

  store.upsertPodcast(basePodcast);
  store.upsertPodcast({
    id: "bbbbbbbbbbbbbbbbbbbbbbbb",
    title: "随机波动",
    author: "声动活泼",
    brief: "女性主义播客",
    description: "讨论公共议题",
    aliases: ["stochastic volatility"],
    sourceUrl: "https://www.xiaoyuzhoufm.com/podcast/bbbbbbbbbbbbbbbbbbbbbbbb"
  });

  assert.deepEqual(store.searchPodcasts("忽左").map((podcast) => podcast.id), [basePodcast.id]);
  assert.deepEqual(store.searchPodcasts("leftright").map((podcast) => podcast.id), [basePodcast.id]);
  assert.deepEqual(store.searchPodcasts("声动").map((podcast) => podcast.id), ["bbbbbbbbbbbbbbbbbbbbbbbb"]);
  assert.deepEqual(store.searchPodcasts("stochastic - volatility").map((podcast) => podcast.id), ["bbbbbbbbbbbbbbbbbbbbbbbb"]);
  assert.deepEqual(store.searchPodcasts("不存在的节目").map((podcast) => podcast.id), []);
  assert.deepEqual(store.searchPodcasts("   "), []);
});

test("podcast store refreshes aliases on update and delete", (t) => {
  const store = createPodcastStore({ dbPath: tempDb(t) });
  t.after(() => store.close());

  store.upsertPodcast({ ...basePodcast, aliases: ["oldalias"] });
  assert.deepEqual(store.searchPodcasts("oldalias").map((podcast) => podcast.id), [basePodcast.id]);

  store.upsertPodcast({ ...basePodcast, aliases: ["newalias"] });
  assert.deepEqual(store.searchPodcasts("oldalias").map((podcast) => podcast.id), []);
  assert.deepEqual(store.searchPodcasts("newalias").map((podcast) => podcast.id), [basePodcast.id]);

  assert.equal(store.deletePodcast(basePodcast.id), true);
  assert.deepEqual(store.searchPodcasts("newalias").map((podcast) => podcast.id), []);
});
