import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { Readable } from "node:stream";
import { publicConfigFromEnv } from "./config.js";
import { createPodcastStore } from "./podcastStore.js";
import { createSearchCache } from "./searchCache.js";
import {
  fetchEpisodeById,
  fetchPodcastById,
  isAllowedAudioUrl,
  searchPodcasts,
  XiaoyuzhouError
} from "./xiaoyuzhou.js";

const PORT = Number(process.env.PORT || 5173);
const ROOT = resolve(process.cwd(), "public");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

export function createRequestHandler(options = {}) {
  const podcastStore = options.podcastStore ?? createPodcastStore();
  const searchCache = options.searchCache ?? createSearchCache();
  const env = options.env ?? process.env;

  return async function handle(request, response) {
    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    try {
      if (url.pathname === "/api/config") {
        json(response, publicConfigFromEnv(env));
        return;
      }

      if (url.pathname === "/api/search") {
        json(response, await searchPodcasts(url.searchParams.get("q"), { podcastStore, searchCache }));
        return;
      }

      if (await adminRoutes(request, response, url, { podcastStore, searchCache, env })) {
        return;
      }

      const podcastMatch = url.pathname.match(/^\/api\/podcast\/([a-f0-9]{24})$/i);
      if (podcastMatch) {
        const result = await fetchPodcastById(podcastMatch[1]);
        rememberFetchedPodcast(result, podcastStore, searchCache);
        json(response, result);
        return;
      }

      const episodeMatch = url.pathname.match(/^\/api\/episode\/([a-f0-9]{24})$/i);
      if (episodeMatch) {
        json(response, await fetchEpisodeById(episodeMatch[1]));
        return;
      }

      if (url.pathname === "/api/media") {
        await proxyMedia(request, response, url.searchParams.get("url"));
        return;
      }

      staticFile(response, url.pathname);
    } catch (error) {
      json(
        response,
        { error: error.message || "服务器出错了。" },
        error instanceof XiaoyuzhouError ? error.status : 500
      );
    }
  };
}

function json(response, payload, status = 200) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function staticFile(response, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const absolute = normalize(join(ROOT, decodeURIComponent(requested)));
  if (!absolute.startsWith(ROOT) || !existsSync(absolute)) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, { "content-type": TYPES[extname(absolute)] ?? "application/octet-stream" });
  createReadStream(absolute).pipe(response);
}

async function adminRoutes(request, response, url, context) {
  if (!url.pathname.startsWith("/api/admin/podcasts")) {
    return false;
  }

  const auth = authorizeAdmin(request, context.env);
  if (!auth.ok) {
    json(response, { error: auth.message }, auth.status);
    return true;
  }

  const idMatch = url.pathname.match(/^\/api\/admin\/podcasts\/([a-f0-9]{24})$/i);

  if (url.pathname === "/api/admin/podcasts" && request.method === "GET") {
    if (url.searchParams.get("q")) {
      json(response, {
        podcasts: context.podcastStore.searchPodcasts(url.searchParams.get("q"), {
          limit: url.searchParams.get("limit")
        })
      });
      return true;
    }

    json(response, {
      podcasts: context.podcastStore.listPodcasts({
        limit: url.searchParams.get("limit"),
        offset: url.searchParams.get("offset")
      })
    });
    return true;
  }

  if (url.pathname === "/api/admin/podcasts" && request.method === "POST") {
    const payload = await readJson(request);
    const podcast = context.podcastStore.upsertPodcast(payload);
    context.searchCache.clear();
    json(response, { podcast });
    return true;
  }

  if (idMatch && request.method === "GET") {
    const podcast = context.podcastStore.getPodcast(idMatch[1].toLowerCase());
    json(response, podcast ? { podcast } : { error: "节目不存在。" }, podcast ? 200 : 404);
    return true;
  }

  if (idMatch && request.method === "PUT") {
    const existing = context.podcastStore.getPodcast(idMatch[1].toLowerCase());
    if (!existing) {
      json(response, { error: "节目不存在。" }, 404);
      return true;
    }
    const payload = await readJson(request);
    const podcast = context.podcastStore.upsertPodcast({
      ...existing,
      ...payload,
      id: idMatch[1].toLowerCase()
    });
    context.searchCache.clear();
    json(response, { podcast });
    return true;
  }

  if (idMatch && request.method === "DELETE") {
    const deleted = context.podcastStore.deletePodcast(idMatch[1].toLowerCase());
    context.searchCache.clear();
    json(response, { deleted });
    return true;
  }

  json(response, { error: "Not found" }, 404);
  return true;
}

function authorizeAdmin(request, env) {
  if (!env.ADMIN_TOKEN) {
    return { ok: false, status: 503, message: "ADMIN_TOKEN 未配置，管理接口不可用。" };
  }

  const expected = `Bearer ${env.ADMIN_TOKEN}`;
  if (request.headers.authorization !== expected) {
    return { ok: false, status: 401, message: "缺少或无效的管理令牌。" };
  }

  return { ok: true };
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new XiaoyuzhouError("请求体 JSON 无效。", 400);
  }
}

function rememberFetchedPodcast(result, podcastStore, searchCache) {
  if (!result?.podcast || !podcastStore?.upsertPodcast) {
    return;
  }

  try {
    podcastStore.upsertPodcast(result.podcast);
  } catch {
    return;
  }

  try {
    searchCache?.clear?.();
  } catch {
    // Direct fetch remains successful even if persistence cleanup fails.
  }
}

async function proxyMedia(request, response, rawUrl) {
  if (!isAllowedAudioUrl(rawUrl)) {
    throw new XiaoyuzhouError("只允许代理小宇宙公开音频地址。", 400);
  }

  const headers = {
    "user-agent": request.headers["user-agent"] || "Mozilla/5.0",
    accept: "audio/*,*/*;q=0.8"
  };
  if (request.headers.range) {
    headers.range = request.headers.range;
  }

  const upstream = await fetch(rawUrl, { headers });
  response.writeHead(upstream.status, {
    "content-type": upstream.headers.get("content-type") || "audio/mp4",
    "content-length": upstream.headers.get("content-length") || undefined,
    "content-range": upstream.headers.get("content-range") || undefined,
    "accept-ranges": upstream.headers.get("accept-ranges") || "bytes",
    "cache-control": "public, max-age=3600"
  });

  Readable.fromWeb(upstream.body).pipe(response);
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryUrl) {
  const server = createServer(createRequestHandler());
  server.listen(PORT, () => {
    console.log(`Cosmos Desktop Player listening on http://localhost:${PORT}`);
  });
}
