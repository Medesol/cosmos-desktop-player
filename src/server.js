import { createServer } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { Readable } from "node:stream";
import { publicConfigFromEnv } from "./config.js";
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

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  try {
    if (url.pathname === "/api/config") {
      return json(response, publicConfigFromEnv());
    }

    if (url.pathname === "/api/search") {
      return json(response, await searchPodcasts(url.searchParams.get("q")));
    }

    const podcastMatch = url.pathname.match(/^\/api\/podcast\/([a-f0-9]{24})$/i);
    if (podcastMatch) {
      return json(response, await fetchPodcastById(podcastMatch[1]));
    }

    const episodeMatch = url.pathname.match(/^\/api\/episode\/([a-f0-9]{24})$/i);
    if (episodeMatch) {
      return json(response, await fetchEpisodeById(episodeMatch[1]));
    }

    if (url.pathname === "/api/media") {
      return proxyMedia(request, response, url.searchParams.get("url"));
    }

    return staticFile(response, url.pathname);
  } catch (error) {
    return json(
      response,
      { error: error.message || "服务器出错了。" },
      error instanceof XiaoyuzhouError ? error.status : 500
    );
  }
});

server.listen(PORT, () => {
  console.log(`Cosmos Desktop Player listening on http://localhost:${PORT}`);
});

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
