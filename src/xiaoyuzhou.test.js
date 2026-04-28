import test from "node:test";
import assert from "node:assert/strict";

import {
  extractEpisodeIdsFromSearchHtml,
  extractPodcastIdsFromSearchHtml,
  parseEpisodePage,
  parsePodcastPage,
  sanitizeQuery
} from "./xiaoyuzhou.js";

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
