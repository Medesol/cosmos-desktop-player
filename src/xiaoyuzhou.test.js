import test from "node:test";
import assert from "node:assert/strict";

import {
  parseEpisodePage,
  parsePodcastPage,
  sanitizeQuery,
  searchPodcasts
} from "./xiaoyuzhou.js";
import { createSearchCache } from "./searchCache.js";

const SPURS_PODCAST_ID = "65487f03374dace9d5b577a4";
const SPURS_EPISODE_ID = "674e414a0ed328720a110a1d";

const podcastHtml = `
<!doctype html>
<script id="__NEXT_DATA__" type="application/json">
{"props":{"pageProps":{"podcast":{"pid":"p123","title":"马刺进步报告","author":"佚名","brief":"日常陪马刺进步","description":"Go Spurs Go","subscriptionCount":2137,"episodeCount":153,"image":{"picUrl":"https://image.example/show.png"},"latestEpisodePubDate":"2026-04-27T23:20:53.227Z"},"episodes":[{"type":"EPISODE","eid":"e75","pid":"p123","title":"S03E75","duration":5351,"pubDate":"2026-04-27T23:20:53.227Z","image":{"picUrl":"https://image.example/e75.png"},"enclosure":{"url":"https://media.example/e75.m4a"},"playCount":2000,"commentCount":8},{"type":"EPISODE","eid":"e74","pid":"p123","title":"S03E74","duration":5040,"pubDate":"2026-04-25T23:30:00.000Z","media":{"source":{"url":"https://media.example/e74.m4a"}}}]}}}
</script>`;

const episodeHtml = `
<!doctype html>
<meta property="og:audio" content="https://media.example/episode.m4a"/>
<script name="schema:podcast-show" type="application/ld+json">
{"@context":"https://schema.org/","@type":"PodcastEpisode","url":"https://www.xiaoyuzhoufm.com/episode/e1","name":"单集标题","datePublished":"2026-02-13T00:01:00.900Z","timeRequired":"PT24M","associatedMedia":{"@type":"MediaObject","contentUrl":"https://media.example/schema.m4a"},"partOfSeries":{"@type":"PodcastSeries","name":"节目名","url":"https://www.xiaoyuzhoufm.com/podcast/p1"}}
</script>
<script id="__NEXT_DATA__" type="application/json">
{"props":{"pageProps":{"episode":{"eid":"e1","pid":"p1","title":"单集标题","duration":1440,"pubDate":"2026-02-13T00:01:00.900Z","enclosure":{"url":"https://media.example/next.m4a"},"podcast":{"pid":"p1","title":"节目名","image":{"picUrl":"https://image.example/show.png"}}}}}}
</script>`;

test("parsePodcastPage returns show metadata and playable episodes", () => {
  const result = parsePodcastPage(podcastHtml, "p123");

  assert.equal(result.podcast.id, "p123");
  assert.equal(result.podcast.title, "马刺进步报告");
  assert.equal(result.podcast.coverUrl, "https://image.example/show.png");
  assert.equal(result.episodes.length, 2);
  assert.deepEqual(
    result.episodes.map((episode) => [episode.id, episode.audioUrl]),
    [
      ["e75", "https://media.example/e75.m4a"],
      ["e74", "https://media.example/e74.m4a"]
    ]
  );
});

test("parseEpisodePage prefers public enclosure data and includes podcast link", () => {
  const result = parseEpisodePage(episodeHtml, "e1");

  assert.equal(result.episode.id, "e1");
  assert.equal(result.episode.audioUrl, "https://media.example/next.m4a");
  assert.equal(result.podcast.id, "p1");
  assert.equal(result.podcast.title, "节目名");
});

test("sanitizeQuery trims, normalizes whitespace, and rejects unsafe input", () => {
  assert.equal(sanitizeQuery("  马刺   进步 报告  "), "马刺 进步 报告");
  assert.throws(() => sanitizeQuery("   "), /请输入/);
  assert.throws(() => sanitizeQuery("x".repeat(121)), /太长/);
});

test("searchPodcasts does not call external search providers by default", async (t) => {
  const calls = mockFetch(t, async (url) => {
    if (url.pathname === `/podcast/${SPURS_PODCAST_ID}`) {
      return htmlResponse(searchPodcastHtml());
    }
    throw new Error(`unexpected fetch ${url.href}`);
  });

  const result = await searchPodcasts("马刺进步报告");

  assert.deepEqual(
    calls.map((url) => url.hostname),
    ["www.xiaoyuzhoufm.com"]
  );
  assert.equal(result.source, "curated");
  assert.deepEqual(
    result.podcasts.map((podcast) => podcast.id),
    [SPURS_PODCAST_ID]
  );
});

test("searchPodcasts falls back to the built-in default podcast when all search providers miss", async (t) => {
  mockFetch(t, async (url) => {
    if (url.pathname === `/podcast/${SPURS_PODCAST_ID}`) {
      return htmlResponse(searchPodcastHtml());
    }
    throw new Error(`unexpected fetch ${url.href}`);
  });

  const result = await searchPodcasts("马刺进步报告");

  assert.equal(result.source, "curated");
  assert.deepEqual(
    result.podcasts.map((podcast) => podcast.id),
    [SPURS_PODCAST_ID]
  );
});

test("searchPodcasts searches the podcast store for keyword queries", async () => {
  const podcastStore = {
    searchPodcasts(query, options) {
      assert.equal(query, "忽左忽右");
      assert.equal(options.limit, 6);
      return [
        {
          id: "aaaaaaaaaaaaaaaaaaaaaaaa",
          title: "忽左忽右",
          author: "JustPod",
          brief: "从中文世界出发",
          description: "",
          coverUrl: "",
          subscriptionCount: 1,
          episodeCount: 2,
          latestEpisodePubDate: "",
          sourceUrl: "https://www.xiaoyuzhoufm.com/podcast/aaaaaaaaaaaaaaaaaaaaaaaa",
          aliases: ["忽左"]
        }
      ];
    }
  };

  const result = await searchPodcasts("忽左忽右", { podcastStore });

  assert.equal(result.source, "database");
  assert.deepEqual(result.podcasts.map((podcast) => podcast.id), ["aaaaaaaaaaaaaaaaaaaaaaaa"]);
  assert.deepEqual(result.results.map((item) => item.episodes), [[]]);
});

test("searchPodcasts caches keyword database results and clears cache after direct upsert", async () => {
  let searches = 0;
  const cache = createSearchCache({ now: () => 1000 });
  const podcastStore = {
    searchPodcasts() {
      searches += 1;
      return [{ id: "aaaaaaaaaaaaaaaaaaaaaaaa", title: "忽左忽右", sourceUrl: "" }];
    },
    upsertPodcast() {
      cache.clear();
    }
  };

  await searchPodcasts("忽左忽右", { podcastStore, searchCache: cache });
  await searchPodcasts("忽左忽右", { podcastStore, searchCache: cache });
  assert.equal(searches, 1);

  await searchPodcasts(`https://www.xiaoyuzhoufm.com/podcast/${SPURS_PODCAST_ID}`, {
    podcastStore,
    searchCache: cache,
    fetchPodcast: async () => ({
      podcast: { id: SPURS_PODCAST_ID, title: "马刺进步报告", sourceUrl: "" },
      episodes: []
    })
  });

  await searchPodcasts("忽左忽右", { podcastStore, searchCache: cache });
  assert.equal(searches, 2);
});

test("searchPodcasts returns direct podcast result when store upsert fails", async () => {
  const podcastStore = {
    upsertPodcast() {
      throw new Error("database locked");
    }
  };

  const result = await searchPodcasts(`https://www.xiaoyuzhoufm.com/podcast/${SPURS_PODCAST_ID}`, {
    podcastStore,
    fetchPodcast: async () => resolvedPodcast(SPURS_PODCAST_ID)
  });

  assert.equal(result.source, "direct");
  assert.deepEqual(result.podcasts.map((podcast) => podcast.id), [SPURS_PODCAST_ID]);
});

test("searchPodcasts does not treat bare podcast id persistence failures as podcast fetch failures", async () => {
  let episodeFetches = 0;
  const podcastStore = {
    upsertPodcast() {
      throw new Error("database locked");
    }
  };

  const result = await searchPodcasts(SPURS_PODCAST_ID, {
    podcastStore,
    fetchPodcast: async () => resolvedPodcast(SPURS_PODCAST_ID),
    fetchEpisode: async () => {
      episodeFetches += 1;
      return {
        podcast: null,
        episode: { id: SPURS_PODCAST_ID, title: "不应查询的单集" }
      };
    }
  });

  assert.equal(result.source, "direct");
  assert.deepEqual(result.podcasts.map((podcast) => podcast.id), [SPURS_PODCAST_ID]);
  assert.equal(episodeFetches, 0);
});

test("searchPodcasts returns curated result when cache clear fails after upsert", async () => {
  const searchCache = {
    clear() {
      throw new Error("cache clear failed");
    }
  };

  const result = await searchPodcasts("马刺进步报告", {
    podcastStore: {
      upsertPodcast() {}
    },
    searchCache,
    fetchPodcast: async () => resolvedPodcast(SPURS_PODCAST_ID)
  });

  assert.equal(result.source, "curated");
  assert.deepEqual(result.podcasts.map((podcast) => podcast.id), [SPURS_PODCAST_ID]);
});

function mockFetch(t, handler) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (rawUrl) => {
    const url = new URL(String(rawUrl));
    calls.push(url);
    return handler(url);
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  return calls;
}

function htmlResponse(html) {
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" }
  });
}

function searchPodcastHtml() {
  return `
<!doctype html>
<script id="__NEXT_DATA__" type="application/json">
{"props":{"pageProps":{"podcast":{"pid":"${SPURS_PODCAST_ID}","title":"马刺进步报告","author":"佚名","brief":"日常陪马刺进步","description":"Go Spurs Go","subscriptionCount":2146,"episodeCount":153,"image":{"picUrl":"https://image.example/show.png"},"latestEpisodePubDate":"2026-04-27T23:20:53.227Z"},"episodes":[{"type":"EPISODE","eid":"${SPURS_EPISODE_ID}","pid":"${SPURS_PODCAST_ID}","title":"S03E75","duration":5351,"pubDate":"2026-04-27T23:20:53.227Z","image":{"picUrl":"https://image.example/e75.png"},"enclosure":{"url":"https://media.example/e75.m4a"},"playCount":2000,"commentCount":8}]}}}
</script>`;
}

function searchEpisodeHtml() {
  return `
<!doctype html>
<script id="__NEXT_DATA__" type="application/json">
{"props":{"pageProps":{"episode":{"eid":"${SPURS_EPISODE_ID}","pid":"${SPURS_PODCAST_ID}","title":"S03E75","duration":5351,"pubDate":"2026-04-27T23:20:53.227Z","enclosure":{"url":"https://media.example/e75.m4a"},"podcast":{"pid":"${SPURS_PODCAST_ID}","title":"马刺进步报告","image":{"picUrl":"https://image.example/show.png"}}}}}}
</script>`;
}

function resolvedPodcast(id) {
  return {
    podcast: { id, title: "马刺进步报告", sourceUrl: `https://www.xiaoyuzhoufm.com/podcast/${id}` },
    episodes: []
  };
}
