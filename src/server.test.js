import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { createRequestHandler } from "./server.js";

function createMemoryStore() {
  const records = new Map();
  return {
    searchPodcasts() {
      return [...records.values()];
    },
    listPodcasts() {
      return [...records.values()];
    },
    getPodcast(id) {
      return records.get(id) ?? null;
    },
    upsertPodcast(podcast) {
      const record = { ...podcast, aliases: podcast.aliases ?? [] };
      records.set(podcast.id, record);
      return record;
    },
    deletePodcast(id) {
      return records.delete(id);
    }
  };
}

async function withServer(t, options) {
  const server = createServer(createRequestHandler(options));
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

test("admin podcast routes require bearer token", async (t) => {
  const baseUrl = await withServer(t, {
    podcastStore: createMemoryStore(),
    env: { ADMIN_TOKEN: "secret" }
  });

  const response = await fetch(`${baseUrl}/api/admin/podcasts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: "aaaaaaaaaaaaaaaaaaaaaaaa", title: "忽左忽右" })
  });

  assert.equal(response.status, 401);
});

test("admin podcast routes create, list, get, update, and delete podcasts", async (t) => {
  const baseUrl = await withServer(t, {
    podcastStore: createMemoryStore(),
    env: { ADMIN_TOKEN: "secret" }
  });
  const auth = { authorization: "Bearer secret", "content-type": "application/json" };

  let response = await fetch(`${baseUrl}/api/admin/podcasts`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ id: "aaaaaaaaaaaaaaaaaaaaaaaa", title: "忽左忽右", aliases: ["忽左"] })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).podcast.title, "忽左忽右");

  response = await fetch(`${baseUrl}/api/admin/podcasts`, {
    headers: { authorization: "Bearer secret" }
  });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).podcasts.map((podcast) => podcast.id), ["aaaaaaaaaaaaaaaaaaaaaaaa"]);

  response = await fetch(`${baseUrl}/api/admin/podcasts/aaaaaaaaaaaaaaaaaaaaaaaa`, {
    headers: { authorization: "Bearer secret" }
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).podcast.title, "忽左忽右");

  response = await fetch(`${baseUrl}/api/admin/podcasts/aaaaaaaaaaaaaaaaaaaaaaaa`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ title: "忽左忽右新版", aliases: ["leftright"] })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).podcast.title, "忽左忽右新版");

  response = await fetch(`${baseUrl}/api/admin/podcasts/aaaaaaaaaaaaaaaaaaaaaaaa`, {
    method: "DELETE",
    headers: { authorization: "Bearer secret" }
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).deleted, true);
});

test("admin write routes fail closed when ADMIN_TOKEN is not configured", async (t) => {
  const baseUrl = await withServer(t, {
    podcastStore: createMemoryStore(),
    env: {}
  });

  const response = await fetch(`${baseUrl}/api/admin/podcasts`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer secret" },
    body: JSON.stringify({ id: "aaaaaaaaaaaaaaaaaaaaaaaa", title: "忽左忽右" })
  });

  assert.equal(response.status, 503);
});
