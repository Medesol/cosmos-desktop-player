import test from "node:test";
import assert from "node:assert/strict";

import {
  extractEpisodeIdsFromSearchHtml,
  extractPodcastIdsFromSearchHtml,
  parseEpisodePage,
  parsePodcastPage,
  sanitizeQuery,
  searchPodcasts
} from "./xiaoyuzhou.js";

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

test("search html extraction deduplicates xiaoyuzhou podcast and episode ids", () => {
  const html = `
    <a href="https://www.xiaoyuzhoufm.com/podcast/65487f03374dace9d5b577a4">马刺进步报告</a>
    <a href="https://www.xiaoyuzhoufm.com/podcast/65487f03374dace9d5b577a4?utm=1">duplicate</a>
    <a href="https://www.xiaoyuzhoufm.com/episode/698e62ce66e2c30377471070">episode</a>
  `;

  assert.deepEqual(extractPodcastIdsFromSearchHtml(html), ["65487f03374dace9d5b577a4"]);
  assert.deepEqual(extractEpisodeIdsFromSearchHtml(html), ["698e62ce66e2c30377471070"]);
});

test("sanitizeQuery trims, normalizes whitespace, and rejects unsafe input", () => {
  assert.equal(sanitizeQuery("  马刺   进步 报告  "), "马刺 进步 报告");
  assert.throws(() => sanitizeQuery("   "), /请输入/);
  assert.throws(() => sanitizeQuery("x".repeat(121)), /太长/);
});

test("searchPodcasts tries a fallback search provider when so.com has no xiaoyuzhou links", async (t) => {
  const calls = mockFetch(t, async (url) => {
    if (url.hostname === "www.so.com") {
      return htmlResponse("<title>访问异常页面</title>");
    }
    if (url.hostname === "www.sogou.com") {
      return htmlResponse(
        `<a href="https://www.xiaoyuzhoufm.com/episode/${SPURS_EPISODE_ID}">马刺进步报告</a>`
      );
    }
    if (url.pathname === `/episode/${SPURS_EPISODE_ID}`) {
      return htmlResponse(searchEpisodeHtml());
    }
    if (url.pathname === `/podcast/${SPURS_PODCAST_ID}`) {
      return htmlResponse(searchPodcastHtml());
    }
    throw new Error(`unexpected fetch ${url.href}`);
  });

  const result = await searchPodcasts("马刺进步报告");

  assert.deepEqual(
    calls.map((url) => url.hostname),
    ["www.so.com", "www.sogou.com", "www.xiaoyuzhoufm.com", "www.xiaoyuzhoufm.com"]
  );
  assert.equal(result.source, "sogou.com");
  assert.deepEqual(
    result.podcasts.map((podcast) => podcast.id),
    [SPURS_PODCAST_ID]
  );
});

test("searchPodcasts falls back to the built-in default podcast when all search providers miss", async (t) => {
  mockFetch(t, async (url) => {
    if (url.hostname === "www.so.com" || url.hostname === "www.sogou.com") {
      return htmlResponse("<html><title>no xiaoyuzhou links</title></html>");
    }
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
