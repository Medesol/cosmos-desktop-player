import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");

test("landing page centers blog search in an animated cover hero", () => {
  assert.match(html, /<section class="hero"/);
  assert.match(html, /id="searchForm"[\s\S]*id="searchInput"/);
  assert.match(html, /placeholder="[^"]*博客[^"]*"/);
  assert.match(html, /class="cover-river"/);
  assert.match(html, /class="cover-strip/);
});

test("cover backdrop drifts horizontally and honors reduced motion", () => {
  assert.match(css, /@keyframes\s+drift-left/);
  assert.match(css, /@keyframes\s+drift-right/);
  assert.match(css, /\.cover-strip/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test("landing copy avoids prototype wording in the public release", () => {
  assert.match(html, /公开博客与播客搜索/);
  assert.doesNotMatch(html, /第三方网页端|正在整理|视觉层负责吸引|Public blog and podcast search/);
});
