const state = {
  results: [],
  show: null,
  episodes: [],
  filteredEpisodes: [],
  currentIndex: -1,
  loading: false
};

const els = {
  form: document.querySelector("#searchForm"),
  input: document.querySelector("#searchInput"),
  results: document.querySelector("#results"),
  resultCount: document.querySelector("#resultCount"),
  showPanel: document.querySelector("#showPanel"),
  episodes: document.querySelector("#episodes"),
  episodeCount: document.querySelector("#episodeCount"),
  episodeFilter: document.querySelector("#episodeFilter"),
  audio: document.querySelector("#audio"),
  cover: document.querySelector("#playerCover"),
  nowTitle: document.querySelector("#nowTitle"),
  nowMeta: document.querySelector("#nowMeta"),
  play: document.querySelector("#playBtn"),
  prev: document.querySelector("#prevBtn"),
  next: document.querySelector("#nextBtn"),
  back: document.querySelector("#backBtn"),
  forward: document.querySelector("#forwardBtn"),
  seek: document.querySelector("#seek"),
  currentTime: document.querySelector("#currentTime"),
  duration: document.querySelector("#duration"),
  volume: document.querySelector("#volume"),
  rate: document.querySelector("#rate"),
  autoplay: document.querySelector("#autoplay"),
  official: document.querySelector("#officialLink"),
  icp: document.querySelector("#icpLink"),
  securityRecord: document.querySelector("#securityRecordLink"),
  toast: document.querySelector("#toast")
};

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  await search(els.input.value);
});

els.episodeFilter.addEventListener("input", () => {
  renderEpisodes();
});

els.play.addEventListener("click", () => {
  if (!els.audio.src && state.episodes[0]) {
    playEpisode(0);
    return;
  }
  els.audio.paused ? els.audio.play() : els.audio.pause();
});

els.prev.addEventListener("click", () => playRelative(-1));
els.next.addEventListener("click", () => playRelative(1));
els.back.addEventListener("click", () => jump(-15));
els.forward.addEventListener("click", () => jump(15));
els.volume.addEventListener("input", () => {
  els.audio.volume = Number(els.volume.value);
  localStorage.setItem("volume", els.volume.value);
});
els.rate.addEventListener("change", () => {
  els.audio.playbackRate = Number(els.rate.value);
  localStorage.setItem("rate", els.rate.value);
});
els.seek.addEventListener("input", () => {
  if (Number.isFinite(els.audio.duration)) {
    els.audio.currentTime = (Number(els.seek.value) / 1000) * els.audio.duration;
  }
});

els.audio.addEventListener("play", () => {
  els.play.textContent = "⏸";
  els.play.title = "暂停";
});
els.audio.addEventListener("pause", () => {
  els.play.textContent = "▶";
  els.play.title = "播放";
});
els.audio.addEventListener("timeupdate", updateTimeline);
els.audio.addEventListener("loadedmetadata", updateTimeline);
els.audio.addEventListener("ended", () => {
  if (els.autoplay.checked) playRelative(1);
});
els.audio.addEventListener("error", () => {
  showToast("音频加载失败，已切换本地代理。");
  const current = state.episodes[state.currentIndex];
  if (current && !els.audio.src.includes("/api/media")) {
    els.audio.src = proxyUrl(current.audioUrl);
    els.audio.play().catch(() => {});
  }
});

document.addEventListener("keydown", (event) => {
  if (event.target.matches("input, textarea")) return;
  if (event.code === "Space") {
    event.preventDefault();
    els.play.click();
  }
  if (event.code === "ArrowLeft") jump(-15);
  if (event.code === "ArrowRight") jump(15);
});

restoreSettings();
loadPublicConfig();
search(els.input.value);

async function search(query) {
  setLoading(true);
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(query)}`);
    state.results = data.results || [];
    renderResults();
    if (state.results[0]) {
      selectShow(state.results[0]);
    } else {
      clearShow();
      showToast("没搜到节目，试试直接粘贴小宇宙节目链接。");
    }
  } catch (error) {
    showToast(error.message);
  } finally {
    setLoading(false);
  }
}

function selectShow(result) {
  state.show = result.podcast;
  state.episodes = result.episodes || [];
  state.currentIndex = -1;
  els.episodeFilter.value = "";
  renderResults();
  renderShow();
  renderEpisodes();
}

function clearShow() {
  state.show = null;
  state.episodes = [];
  renderShow();
  renderEpisodes();
}

function renderResults() {
  els.resultCount.textContent = state.results.length;
  els.results.innerHTML = "";
  for (const result of state.results) {
    const podcast = result.podcast;
    const button = document.createElement("button");
    button.className = `result-card ${state.show?.id === podcast.id ? "active" : ""}`;
    button.innerHTML = `
      <img src="${escapeAttr(podcast.coverUrl)}" alt="" />
      <span>
        <strong>${escapeHtml(podcast.title)}</strong>
        <small>${escapeHtml(podcast.author || podcast.brief || "小宇宙节目")}</small>
      </span>
    `;
    button.addEventListener("click", () => selectShow(result));
    els.results.append(button);
  }
}

function renderShow() {
  if (!state.show) {
    els.showPanel.className = "show-panel empty";
    els.showPanel.innerHTML = `
      <div class="cover placeholder"></div>
      <div class="show-copy">
        <div class="skeleton title"></div>
        <div class="skeleton line"></div>
        <div class="skeleton line short"></div>
      </div>
    `;
    return;
  }

  const show = state.show;
  els.showPanel.className = "show-panel";
  els.showPanel.innerHTML = `
    <img class="cover" src="${escapeAttr(show.coverUrl)}" alt="" />
    <div class="show-copy">
      <h2>${escapeHtml(show.title)}</h2>
      <div class="show-meta">
        <span>${escapeHtml(show.author || "佚名")}</span>
        <span>${show.subscriptionCount ? `${formatNumber(show.subscriptionCount)} 订阅` : "公开节目"}</span>
        <span>${show.episodeCount ? `${show.episodeCount} 集` : `${state.episodes.length} 集`}</span>
      </div>
      <p>${escapeHtml(show.description || show.brief || "")}</p>
    </div>
  `;
  els.official.href = show.sourceUrl || "https://www.xiaoyuzhoufm.com";
}

function renderEpisodes() {
  const keyword = els.episodeFilter.value.trim().toLowerCase();
  state.filteredEpisodes = state.episodes.filter((episode) => {
    return !keyword || episode.title.toLowerCase().includes(keyword);
  });
  els.episodeCount.textContent = state.filteredEpisodes.length;
  els.episodes.innerHTML = "";

  if (!state.filteredEpisodes.length) {
    const empty = document.createElement("div");
    empty.className = "episode-empty";
    empty.textContent = state.show ? "没有匹配的单集" : "搜索节目后会显示单集";
    els.episodes.append(empty);
    return;
  }

  for (const episode of state.filteredEpisodes) {
    const index = state.episodes.findIndex((item) => item.id === episode.id);
    const row = document.createElement("article");
    row.className = `episode ${index === state.currentIndex ? "playing" : ""}`;
    row.innerHTML = `
      <button class="episode-play" aria-label="播放">▶</button>
      <img src="${escapeAttr(episode.coverUrl || state.show.coverUrl)}" alt="" />
      <div class="episode-copy">
        <h3>${escapeHtml(episode.title)}</h3>
        <p>${formatDate(episode.pubDate)} · ${formatTime(episode.duration)}${episode.playCount ? ` · ${formatNumber(episode.playCount)} 播放` : ""}</p>
      </div>
      <a class="episode-link" href="${escapeAttr(episode.sourceUrl)}" target="_blank" rel="noreferrer">官网</a>
    `;
    row.querySelector(".episode-play").addEventListener("click", () => playEpisode(index));
    row.addEventListener("dblclick", () => playEpisode(index));
    els.episodes.append(row);
  }
}

function playEpisode(index) {
  const episode = state.episodes[index];
  if (!episode) return;
  state.currentIndex = index;
  els.audio.src = episode.audioUrl;
  els.audio.playbackRate = Number(els.rate.value);
  els.audio.volume = Number(els.volume.value);
  els.cover.src = episode.coverUrl || state.show.coverUrl;
  els.nowTitle.textContent = episode.title;
  els.nowMeta.textContent = `${state.show?.title || episode.podcastTitle || ""} · ${formatTime(episode.duration)}`;
  els.official.href = episode.sourceUrl || state.show?.sourceUrl || "https://www.xiaoyuzhoufm.com";
  localStorage.setItem(
    "lastEpisode",
    JSON.stringify({ showId: state.show?.id, episodeId: episode.id, title: episode.title })
  );
  renderEpisodes();
  els.audio.play().catch(() => showToast("浏览器拦截了自动播放，再点一次播放键。"));
}

function playRelative(offset) {
  if (!state.episodes.length) return;
  const nextIndex = state.currentIndex < 0 ? 0 : state.currentIndex + offset;
  if (nextIndex >= 0 && nextIndex < state.episodes.length) {
    playEpisode(nextIndex);
  }
}

function jump(seconds) {
  if (!Number.isFinite(els.audio.duration)) return;
  els.audio.currentTime = Math.max(0, Math.min(els.audio.duration, els.audio.currentTime + seconds));
}

function updateTimeline() {
  els.currentTime.textContent = formatTime(els.audio.currentTime || 0);
  els.duration.textContent = formatTime(els.audio.duration || 0);
  if (Number.isFinite(els.audio.duration) && els.audio.duration > 0) {
    els.seek.value = Math.round((els.audio.currentTime / els.audio.duration) * 1000);
  } else {
    els.seek.value = 0;
  }
}

async function api(path) {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

async function loadPublicConfig() {
  try {
    const config = await api("/api/config");
    setOptionalLink(els.icp, config.icpText, config.icpUrl);
    setOptionalLink(els.securityRecord, config.securityRecordText, config.securityRecordUrl);
  } catch {
    // Compliance links are optional and should not block the player.
  }
}

function setOptionalLink(element, text, href) {
  if (!text) return;
  element.textContent = text;
  element.href = href || "#";
  element.hidden = false;
}

function restoreSettings() {
  const volume = localStorage.getItem("volume");
  const rate = localStorage.getItem("rate");
  if (volume) els.volume.value = volume;
  if (rate) els.rate.value = rate;
  els.audio.volume = Number(els.volume.value);
  els.audio.playbackRate = Number(els.rate.value);
}

function setLoading(loading) {
  state.loading = loading;
  els.form.classList.toggle("loading", loading);
  els.form.querySelector("button").disabled = loading;
}

function proxyUrl(audioUrl) {
  return `/api/media?url=${encodeURIComponent(audioUrl)}`;
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("show"), 3200);
}

function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN", { notation: "compact" }).format(value);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
