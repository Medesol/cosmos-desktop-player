import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const PODCAST_ID = "65487f03374dace9d5b577a4";

test("default database search hydrates selected podcast episodes", async () => {
  const app = await loadAppWithFetch(async (path) => {
    if (path === "/api/config") {
      return jsonResponse({});
    }
    if (path.startsWith("/api/search?")) {
      return jsonResponse({
        results: [
          {
            podcast: {
              id: PODCAST_ID,
              title: "马刺进步报告",
              sourceUrl: `https://www.xiaoyuzhoufm.com/podcast/${PODCAST_ID}`
            },
            episodes: []
          }
        ]
      });
    }
    if (path === `/api/podcast/${PODCAST_ID}`) {
      return jsonResponse({
        podcast: {
          id: PODCAST_ID,
          title: "马刺进步报告",
          sourceUrl: `https://www.xiaoyuzhoufm.com/podcast/${PODCAST_ID}`
        },
        episodes: [
          {
            id: "69ff67e0e1eb34a93912ce66",
            title: "S03E82",
            duration: 5191,
            pubDate: "2026-05-09T23:00:00.000Z",
            audioUrl: "https://media.xyzcdn.net/show/e82.m4a",
            sourceUrl: "https://www.xiaoyuzhoufm.com/episode/69ff67e0e1eb34a93912ce66"
          }
        ]
      });
    }
    throw new Error(`unexpected fetch: ${path}`);
  });

  await app.waitForFetch(`/api/podcast/${PODCAST_ID}`);

  assert.ok(app.fetchCalls.includes(`/api/podcast/${PODCAST_ID}`));
  assert.equal(app.elements.episodeCount.textContent, "1");
  assert.match(app.elements.episodes.children.at(-1).innerHTML, /S03E82/);
});

async function loadAppWithFetch(fetchHandler) {
  const elements = createElements();
  const fetchCalls = [];
  const context = {
    console,
    document: createDocument(elements),
    fetch: async (path) => {
      fetchCalls.push(path);
      return fetchHandler(path);
    },
    localStorage: createLocalStorage(),
    setTimeout,
    clearTimeout,
    Intl
  };

  const script = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  vm.runInNewContext(script, context, { filename: "public/app.js" });

  return {
    elements,
    fetchCalls,
    waitForFetch: (path) => waitFor(() => fetchCalls.includes(path))
  };
}

function createElements() {
  const form = new FakeElement("form");
  form.queryResult = new FakeElement("button");
  return {
    form,
    input: Object.assign(new FakeElement("input"), { value: "马刺进步报告" }),
    results: new FakeElement("div"),
    resultCount: new FakeElement("span"),
    showPanel: new FakeElement("section"),
    episodes: new FakeElement("div"),
    episodeCount: new FakeElement("span"),
    episodeFilter: new FakeElement("input"),
    audio: Object.assign(new FakeElement("audio"), { paused: true, play: async () => {}, volume: 1, playbackRate: 1 }),
    cover: new FakeElement("img"),
    nowTitle: new FakeElement("span"),
    nowMeta: new FakeElement("span"),
    play: new FakeElement("button"),
    prev: new FakeElement("button"),
    next: new FakeElement("button"),
    back: new FakeElement("button"),
    forward: new FakeElement("button"),
    seek: new FakeElement("input"),
    currentTime: new FakeElement("span"),
    duration: new FakeElement("span"),
    volume: Object.assign(new FakeElement("input"), { value: "1" }),
    rate: Object.assign(new FakeElement("select"), { value: "1" }),
    autoplay: Object.assign(new FakeElement("input"), { checked: false }),
    official: new FakeElement("a"),
    icp: new FakeElement("a"),
    securityRecord: new FakeElement("a"),
    toast: new FakeElement("div")
  };
}

function createDocument(elements) {
  const selectors = {
    "#searchForm": elements.form,
    "#searchInput": elements.input,
    "#results": elements.results,
    "#resultCount": elements.resultCount,
    "#showPanel": elements.showPanel,
    "#episodes": elements.episodes,
    "#episodeCount": elements.episodeCount,
    "#episodeFilter": elements.episodeFilter,
    "#audio": elements.audio,
    "#playerCover": elements.cover,
    "#nowTitle": elements.nowTitle,
    "#nowMeta": elements.nowMeta,
    "#playBtn": elements.play,
    "#prevBtn": elements.prev,
    "#nextBtn": elements.next,
    "#backBtn": elements.back,
    "#forwardBtn": elements.forward,
    "#seek": elements.seek,
    "#currentTime": elements.currentTime,
    "#duration": elements.duration,
    "#volume": elements.volume,
    "#rate": elements.rate,
    "#autoplay": elements.autoplay,
    "#officialLink": elements.official,
    "#icpLink": elements.icp,
    "#securityRecordLink": elements.securityRecord,
    "#toast": elements.toast
  };
  return {
    querySelector: (selector) => selectors[selector] ?? null,
    createElement: (tagName) => new FakeElement(tagName),
    addEventListener() {}
  };
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.className = "";
    this.hidden = false;
    this.href = "";
    this.src = "";
    this.value = "";
    this._textContent = "";
    this._innerHTML = "";
    this.listeners = new Map();
    this.classList = {
      add: () => {},
      remove: () => {},
      toggle: () => {}
    };
  }

  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }

  get textContent() {
    return this._textContent;
  }

  set textContent(value) {
    this._textContent = String(value);
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    if (this._innerHTML === "") {
      this.children = [];
    }
  }

  append(child) {
    this.children.push(child);
  }

  querySelector() {
    if (!this.queryResult) {
      this.queryResult = new FakeElement("button");
    }
    return this.queryResult;
  }

  matches() {
    return false;
  }
}

function createLocalStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value))
  };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    json: async () => payload
  };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail("condition was not met");
}
