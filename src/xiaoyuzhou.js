const XIAOYUZHOU_BASE = "https://www.xiaoyuzhoufm.com";
const ID_PATTERN = "[a-f0-9]{24}";
const SEARCH_PROVIDERS = [
  { name: "so.com", url: "https://www.so.com/s", queryParam: "q" },
  { name: "sogou.com", url: "https://www.sogou.com/web", queryParam: "query" }
];
const CURATED_PODCASTS = [
  {
    id: "65487f03374dace9d5b577a4",
    title: "马刺进步报告",
    aliases: ["马刺进步报告", "spurs progress report"]
  }
];
const REQUEST_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.7"
};

export class XiaoyuzhouError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = "XiaoyuzhouError";
    this.status = status;
  }
}

export function sanitizeQuery(input) {
  const query = String(input ?? "").trim().replace(/\s+/g, " ");
  if (!query) {
    throw new XiaoyuzhouError("请输入节目名、小宇宙链接或 24 位 ID。", 400);
  }
  if (query.length > 120) {
    throw new XiaoyuzhouError("搜索词太长了，换个短一点的关键词试试。", 400);
  }
  return query;
}

export function extractPodcastIdsFromSearchHtml(html) {
  return uniqueMatches(html, new RegExp(`xiaoyuzhoufm\\.com/podcast/(${ID_PATTERN})`, "gi"));
}

export function extractEpisodeIdsFromSearchHtml(html) {
  return uniqueMatches(html, new RegExp(`xiaoyuzhoufm\\.com/episode/(${ID_PATTERN})`, "gi"));
}

export function parsePodcastPage(html, fallbackId) {
  const nextData = extractNextData(html);
  const pageProps = nextData?.props?.pageProps ?? {};
  const rawPodcast = pageProps.podcast ?? pageProps.data?.podcast;
  if (!rawPodcast) {
    throw new XiaoyuzhouError("没有在页面里找到节目数据。", 502);
  }

  const podcast = normalizePodcast(rawPodcast, fallbackId);
  const rawEpisodes = rawPodcast.episodes ?? pageProps.episodes ?? collectEpisodes(pageProps);
  const episodes = rawEpisodes
    .map((episode) => normalizeEpisode(episode, podcast))
    .filter((episode) => episode.audioUrl);

  return {
    podcast,
    episodes,
    sourceUrl: `${XIAOYUZHOU_BASE}/podcast/${podcast.id}`
  };
}

export function parseEpisodePage(html, fallbackId) {
  const nextData = extractNextData(html);
  const pageProps = nextData?.props?.pageProps ?? {};
  const rawEpisode = pageProps.episode ?? pageProps.data?.episode;
  const schemaEpisode = extractEpisodeSchema(html);

  if (!rawEpisode && !schemaEpisode) {
    throw new XiaoyuzhouError("没有在页面里找到单集数据。", 502);
  }

  const rawPodcast = rawEpisode?.podcast ?? schemaPodcastFromEpisode(schemaEpisode);
  const podcast = rawPodcast ? normalizePodcast(rawPodcast, rawEpisode?.pid) : null;
  const episode = normalizeEpisode(
    {
      ...schemaEpisodeToEpisode(schemaEpisode),
      ...rawEpisode
    },
    podcast,
    fallbackId
  );

  if (!episode.audioUrl) {
    episode.audioUrl = extractMetaAudio(html);
  }

  return {
    podcast,
    episode,
    sourceUrl: `${XIAOYUZHOU_BASE}/episode/${episode.id}`
  };
}

export async function fetchPodcastById(id) {
  assertId(id, "节目");
  const html = await fetchText(`${XIAOYUZHOU_BASE}/podcast/${id}`);
  return parsePodcastPage(html, id);
}

export async function fetchEpisodeById(id) {
  assertId(id, "单集");
  const html = await fetchText(`${XIAOYUZHOU_BASE}/episode/${id}`);
  return parseEpisodePage(html, id);
}

export async function searchPodcasts(rawQuery, options = {}) {
  const query = sanitizeQuery(rawQuery);
  const fetchPodcast = options.fetchPodcast ?? fetchPodcastById;
  const fetchEpisode = options.fetchEpisode ?? fetchEpisodeById;
  const direct = parseDirectTarget(query);
  if (direct?.type === "podcast") {
    const result = await fetchPodcast(direct.id);
    return { query, source: "direct", podcasts: [result.podcast], results: [result] };
  }

  if (direct?.type === "episode") {
    const episodeResult = await fetchEpisode(direct.id);
    if (!episodeResult.podcast?.id) {
      return {
        query,
        source: "direct",
        podcasts: [],
        results: [],
        episodes: [episodeResult.episode]
      };
    }
    const result = await fetchPodcast(episodeResult.podcast.id);
    return { query, source: "direct", podcasts: [result.podcast], results: [result] };
  }

  if (direct?.type === "id") {
    try {
      const result = await fetchPodcast(direct.id);
      return { query, source: "direct", podcasts: [result.podcast], results: [result] };
    } catch {
      const episodeResult = await fetchEpisode(direct.id);
      if (!episodeResult.podcast?.id) {
        return { query, source: "direct", podcasts: [], results: [], episodes: [episodeResult.episode] };
      }
      const result = await fetchPodcast(episodeResult.podcast.id);
      return { query, source: "direct", podcasts: [result.podcast], results: [result] };
    }
  }

  const search = await searchPublicProviders(query, options);
  const podcastIds = search.podcastIds;

  for (const episodeId of search.episodeIds.slice(0, 6)) {
    try {
      const result = await fetchEpisode(episodeId);
      if (result.podcast?.id) {
        podcastIds.push(result.podcast.id);
      }
    } catch {
      // Search snippets can be stale. Ignore misses and keep collecting usable hits.
    }
  }

  const ids = [...new Set(podcastIds)].slice(0, options.limit ?? 6);
  const results = [];
  for (const id of ids) {
    try {
      results.push(await fetchPodcast(id));
    } catch {
      // A single stale search result should not sink the whole query.
    }
  }

  if (!results.length) {
    const curated = findCuratedPodcast(query);
    if (curated) {
      const result = await fetchPodcast(curated.id);
      return {
        query,
        source: "curated",
        podcasts: [result.podcast],
        results: [result]
      };
    }
  }

  return {
    query,
    source: search.source,
    podcasts: results.map((result) => result.podcast),
    results
  };
}

export function parseDirectTarget(query) {
  const podcastMatch = query.match(new RegExp(`xiaoyuzhoufm\\.com/podcast/(${ID_PATTERN})`, "i"));
  if (podcastMatch) return { type: "podcast", id: podcastMatch[1].toLowerCase() };

  const episodeMatch = query.match(new RegExp(`xiaoyuzhoufm\\.com/episode/(${ID_PATTERN})`, "i"));
  if (episodeMatch) return { type: "episode", id: episodeMatch[1].toLowerCase() };

  const bareId = query.match(new RegExp(`^${ID_PATTERN}$`, "i"));
  if (bareId) return { type: "id", id: query.toLowerCase() };

  return null;
}

export function isAllowedAudioUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && url.hostname === "media.xyzcdn.net";
  } catch {
    return false;
  }
}

async function searchPublicProviders(query, options = {}) {
  const providers = options.searchProviders ?? SEARCH_PROVIDERS;
  const loadHtml = options.fetchSearchHtml ?? fetchSearchHtml;
  const tried = [];

  for (const provider of providers) {
    tried.push(provider.name);
    try {
      const html = await loadHtml(query, provider);
      const podcastIds = extractPodcastIdsFromSearchHtml(html);
      const episodeIds = extractEpisodeIdsFromSearchHtml(html);
      if (podcastIds.length || episodeIds.length) {
        return { source: provider.name, podcastIds, episodeIds };
      }
    } catch {
      // Public search engines can rate-limit cloud IPs. Keep trying the next one.
    }
  }

  return { source: tried.join(",") || "search", podcastIds: [], episodeIds: [] };
}

async function fetchSearchHtml(query, provider) {
  const url = new URL(provider.url);
  url.searchParams.set(provider.queryParam, `${query} 小宇宙`);
  return fetchText(url);
}

function findCuratedPodcast(query) {
  const normalizedQuery = normalizeForMatching(query);
  return CURATED_PODCASTS.find((podcast) => {
    const names = [podcast.title, ...(podcast.aliases ?? [])];
    return names.some((name) => normalizedQuery.includes(normalizeForMatching(name)));
  });
}

function normalizeForMatching(value) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, "");
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      headers: REQUEST_HEADERS,
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) {
      throw new XiaoyuzhouError(`上游返回 ${response.status}。`, 502);
    }
    return text;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new XiaoyuzhouError("上游请求超时。", 504);
    }
    if (error instanceof XiaoyuzhouError) throw error;
    throw new XiaoyuzhouError(`上游请求失败：${error.message}`, 502);
  } finally {
    clearTimeout(timeout);
  }
}

function extractNextData(html) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(decodeHtmlEntities(match[1]));
  } catch (error) {
    throw new XiaoyuzhouError(`页面数据解析失败：${error.message}`, 502);
  }
}

function extractEpisodeSchema(html) {
  const matches = [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
  for (const match of matches) {
    try {
      const data = JSON.parse(decodeHtmlEntities(match[1]));
      if (data["@type"] === "PodcastEpisode") return data;
    } catch {
      // Non-episode JSON-LD blocks are ignored.
    }
  }
  return null;
}

function schemaEpisodeToEpisode(schema) {
  if (!schema) return {};
  const id = schema.url?.match(new RegExp(`/episode/(${ID_PATTERN})`, "i"))?.[1];
  return {
    eid: id,
    title: schema.name,
    pubDate: schema.datePublished,
    duration: parseIsoDuration(schema.timeRequired),
    enclosure: { url: schema.associatedMedia?.contentUrl }
  };
}

function schemaPodcastFromEpisode(schema) {
  if (!schema?.partOfSeries) return null;
  const id = schema.partOfSeries.url?.match(new RegExp(`/podcast/(${ID_PATTERN})`, "i"))?.[1];
  return {
    pid: id,
    title: schema.partOfSeries.name
  };
}

function extractMetaAudio(html) {
  const match = html.match(/<meta property="og:audio" content="([^"]+)"/);
  return match ? decodeHtmlEntities(match[1]) : "";
}

function collectEpisodes(value, found = []) {
  if (Array.isArray(value)) {
    if (value.some((item) => item?.type === "EPISODE")) {
      found.push(...value.filter((item) => item?.type === "EPISODE"));
    } else {
      value.forEach((item) => collectEpisodes(item, found));
    }
    return found;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((child) => collectEpisodes(child, found));
  }
  return found;
}

function normalizePodcast(podcast, fallbackId = "") {
  const id = podcast.pid ?? podcast.id ?? fallbackId ?? "";
  return {
    id,
    title: podcast.title ?? podcast.name ?? "未命名节目",
    author: podcast.author ?? "",
    brief: podcast.brief ?? "",
    description: stripHtml(podcast.description ?? ""),
    coverUrl: imageUrl(podcast.image),
    subscriptionCount: podcast.subscriptionCount ?? null,
    episodeCount: podcast.episodeCount ?? null,
    latestEpisodePubDate: podcast.latestEpisodePubDate ?? null,
    sourceUrl: id ? `${XIAOYUZHOU_BASE}/podcast/${id}` : ""
  };
}

function normalizeEpisode(episode, podcast, fallbackId = "") {
  const id = episode.eid ?? episode.id ?? fallbackId ?? "";
  const audioUrl =
    episode.enclosure?.url ??
    episode.media?.source?.url ??
    episode.media?.url ??
    episode.associatedMedia?.contentUrl ??
    "";
  return {
    id,
    podcastId: episode.pid ?? podcast?.id ?? "",
    title: episode.title ?? episode.name ?? "未命名单集",
    shownotes: stripHtml(episode.shownotes ?? episode.description ?? ""),
    duration: Number(episode.duration ?? 0),
    pubDate: episode.pubDate ?? episode.datePublished ?? "",
    coverUrl: imageUrl(episode.image) || podcast?.coverUrl || "",
    audioUrl,
    playCount: episode.playCount ?? null,
    commentCount: episode.commentCount ?? null,
    sourceUrl: id ? `${XIAOYUZHOU_BASE}/episode/${id}` : "",
    podcastTitle: podcast?.title ?? episode.podcast?.title ?? ""
  };
}

function imageUrl(image) {
  return (
    image?.largePicUrl ??
    image?.middlePicUrl ??
    image?.smallPicUrl ??
    image?.picUrl ??
    image?.url ??
    ""
  );
}

function parseIsoDuration(value) {
  if (!value) return 0;
  const match = String(value).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const [, hours = 0, minutes = 0, seconds = 0] = match.map((part) => Number(part || 0));
  return hours * 3600 + minutes * 60 + seconds;
}

function stripHtml(value) {
  return decodeHtmlEntities(String(value ?? "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function uniqueMatches(html, regex) {
  const values = [];
  for (const match of String(html).matchAll(regex)) {
    values.push(match[1].toLowerCase());
  }
  return [...new Set(values)];
}

function assertId(id, label) {
  if (!new RegExp(`^${ID_PATTERN}$`, "i").test(id)) {
    throw new XiaoyuzhouError(`${label} ID 格式不对。`, 400);
  }
}
