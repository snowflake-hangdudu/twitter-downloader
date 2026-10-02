/**
 * X Downloader -- page data reader (MAIN world).
 * Reads public page state, clones X/Twitter network responses, and
 * falls back to the current tweet DOM. Does not change page behavior.
 */
(function bootTwitterPageAgent() {
  'use strict';
  if (window.__TWITTER_DOWNLOADER_PAGE_AGENT__) return;
  window.__TWITTER_DOWNLOADER_PAGE_AGENT__ = true;
  window.__TWITTER_DOWNLOADER_PAGE_AGENT_VERSION__ = 1;

  const Model = window.TwitterDownloaderModel;
  if (!Model) return;

  const SOURCE = 'twitter-downloader-page-agent';
  const CONTENT_SOURCE = 'twitter-downloader-content';
  const collected = { posts: new Map(), stories: [], creators: [], seen: new WeakSet(), count: 0 };
  const profileCaptures = new Map();
  const scannedScripts = new WeakSet();
  let initialHtmlScanned = false;
  const detailCache = new Map();
  const detailFailures = new Map();
  const resolveQueue = [];
  const resolveControllers = new Set();
  let resolveActive = 0;
  let resolveEpoch = 0;
  let hideFeedAds = false;
  let lastSnapshotJson = '';
  let lastUrl = location.href;
  let scheduled = 0;

  function ingest(data, extra) {
    if (!data) return;
    const route = Model.routeFromUrl(location.href);
    if (route.kind === 'profile') {
      const bag = { posts: new Map() };
      Model.collectFromJson(data, bag, extra || {});
      const key = new URL(location.href).pathname.toLowerCase().replace(/\/$/, '');
      if (!profileCaptures.has(key)) profileCaptures.set(key, new Set());
      for (const post of bag.posts.values()) if (post.author?.username?.toLowerCase() === route.username?.toLowerCase()) profileCaptures.get(key).add(post.id);
      const ids = profileCaptures.get(key);
      while (ids.size > 1000) ids.delete(ids.values().next().value);
      while (profileCaptures.size > 5) profileCaptures.delete(profileCaptures.keys().next().value);
    }
    Model.collectFromJson(data, collected, extra || {});
    while (collected.posts.size > 1000) collected.posts.delete(collected.posts.keys().next().value);
  }

  function parseMaybeJson(value) {
    if (!value) return;
    if (typeof value === 'object') {
      ingest(value);
      return;
    }
    const raw = String(value).trim();
    if (!raw || (raw[0] !== '{' && raw[0] !== '[')) return;
    try { ingest(JSON.parse(raw)); } catch (_) {}
  }

  function scanScripts() {
    const scripts = document.querySelectorAll('script');
    for (const node of scripts) {
      if (scannedScripts.has(node)) continue;
      scannedScripts.add(node);
      const type = String(node.type || '').toLowerCase();
      if (type === 'application/json' || node.id === '__NEXT_DATA__') parseMaybeJson(node.textContent);
    }
    if (!initialHtmlScanned && document.readyState !== 'loading') {
      initialHtmlScanned = true;
      Model.parseHtmlPayloads(document.documentElement?.innerHTML || '').forEach((payload) => ingest(payload));
    }
  }

  function currentTweetArticle() {
    const articles = [...document.querySelectorAll('article[data-testid="tweet"], article')];
    let best = null;
    let bestScore = -1;
    articles.forEach((node) => {
      if (node.closest('#twitter-dl-root')) return;
      const rect = node.getBoundingClientRect();
      if (rect.height < 60 || rect.bottom < 60 || rect.top > window.innerHeight - 40) return;
      const score = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
    });
    return best || document.querySelector('article[data-testid="tweet"]');
  }

  function tweetIdFromDom(root) {
    const scope = root || document;
    const links = scope.querySelectorAll('a[href*="/status/"]');
    for (const link of links) {
      const id = Model.tweetIdOf(link.href);
      if (id) return id;
    }
    return Model.tweetIdOf(location.href);
  }

  function candidatesFromImage(image, source) {
    if (!image) return [];
    const list = [];
    const push = (url, extra) => {
      const href = Model.allowedMediaUrl(url) || Model.origImageUrl(url);
      if (!href || Model.looksLikeAvatar(href) || Model.STATIC_HINT.test(href)) return;
      list.push({
        url: href,
        mime: '',
        width: Number(extra?.width) || image.naturalWidth || 0,
        height: Number(extra?.height) || image.naturalHeight || 0,
        bitrate: 0,
        sizeBytes: 0,
        source: source || 'dom',
        backupUrls: []
      });
    };
    push(image.currentSrc || image.src, {});
    String(image.srcset || '').split(',').forEach((part) => {
      const bits = part.trim().split(/\s+/);
      push(bits[0], { width: parseInt(bits[1], 10) || 0 });
      if (list.length) list[list.length - 1].source = 'srcset';
    });
    return list;
  }

  function domPost(route) {
    const article = currentTweetArticle();
    const root = article?.querySelector('img, video') ? article : document.querySelector('[data-testid="tweetPhoto"], [data-testid="videoPlayer"]')?.closest('article');
    if (!root) return null;
    const shortcode = route.shortcode || tweetIdFromDom(root);
    function isInQuotedRegion(node) {
      let el = node?.parentElement;
      while (el && el !== root) {
        if (el.tagName === 'ARTICLE' && el !== root) return true;
        if (el.getAttribute?.('role') === 'link') {
          const statusLinks = [...el.querySelectorAll('a[href*="/status/"]')];
          if (statusLinks.some((link) => {
            const id = Model.tweetIdOf(link.getAttribute('href') || '');
            return id && id !== shortcode;
          })) return true;
        }
        el = el.parentElement;
      }
      return false;
    }
    const images = [...root.querySelectorAll('img')].filter((image) => {
      if (image.closest('#twitter-dl-root')) return false;
      const href = Model.httpsUrl(image.currentSrc || image.src);
      if (!href || Model.looksLikeAvatar(href) || Model.STATIC_HINT.test(href)) return false;
      const width = image.naturalWidth || image.width || 0;
      const height = image.naturalHeight || image.height || 0;
      if (width && height && width < 80 && height < 80) return false;
      const alt = String(image.alt || '');
      if (/profile|avatar|头像/i.test(alt) && width < 200) return false;
      return true;
    });
    const videos = [...root.querySelectorAll('video')].filter((video) => !video.closest('#twitter-dl-root'));
    const ownVideos = videos.filter((video) => !isInQuotedRegion(video));
    const quoteVideos = videos.filter((video) => isInQuotedRegion(video));
    const useVideos = ownVideos.length ? ownVideos : quoteVideos;
    const ownImages = images.filter((image) => !isInQuotedRegion(image));
    const quoteImages = images.filter((image) => isInQuotedRegion(image));
    const useImages = ownVideos.length || ownImages.length ? ownImages : quoteImages;
    const quotedMediaOnly = !ownVideos.length && !ownImages.some((image) => {
      const href = Model.httpsUrl(image.currentSrc || image.src);
      return href && !Model.looksLikeAvatar(href);
    }) && (quoteVideos.length > 0 || quoteImages.length > 0);
    const media = [];
    const seen = new Set();
    function addMedia(type, node, candidates, poster) {
      const best = Model.pickBest(candidates, type === 'image' ? 'image' : 'video');
      if (!best) return;
      const key = best?.url?.split('?')[0] || type + '-' + media.length;
      if (seen.has(key)) return;
      seen.add(key);
      media.push({
        id: shortcode ? shortcode + '-' + (media.length + 1) : key.slice(-24),
        index: media.length + 1,
        type,
        width: best?.width || node?.videoWidth || node?.naturalWidth || 0,
        height: best?.height || node?.videoHeight || node?.naturalHeight || 0,
        duration: Number(node?.duration) > 0 && Number.isFinite(node.duration) ? node.duration : 0,
        posterUrl: poster || '',
        mime: type === 'image' ? 'image/jpeg' : 'video/mp4',
        imageCandidates: type === 'image' ? Model.sortImageCandidates(candidates) : Model.sortImageCandidates(poster ? [{
          url: poster, mime: 'image/jpeg', width: 0, height: 0, bitrate: 0, sizeBytes: 0, source: 'dom', backupUrls: []
        }] : []),
        videoCandidates: type === 'image' ? [] : Model.sortVideoCandidates(candidates),
        fromQuote: quotedMediaOnly
      });
    }
    useVideos.forEach((video) => {
      const list = [];
      const src = Model.allowedMediaUrl(video.currentSrc || video.src);
      if (src) list.push({ url: src, mime: 'video/mp4', width: video.videoWidth || 0, height: video.videoHeight || 0, bitrate: 0, sizeBytes: 0, source: 'dom', backupUrls: [] });
      video.querySelectorAll('source').forEach((source) => {
        const href = Model.allowedMediaUrl(source.src);
        if (href) list.push({ url: href, mime: source.type || 'video/mp4', width: video.videoWidth || 0, height: video.videoHeight || 0, bitrate: 0, sizeBytes: 0, source: 'dom', backupUrls: [] });
      });
      addMedia(/gif/i.test(video.getAttribute('aria-label') || '') ? 'gif' : 'video', video, list, Model.allowedMediaUrl(video.poster));
    });
    if (!useVideos.length) useImages.forEach((image) => addMedia('image', image, candidatesFromImage(image), Model.origImageUrl(image.currentSrc || image.src)));
    if (!media.length) return null;
    const userLink = root.querySelector('a[href^="/"][role="link"]');
    const username = route.username || Model.text(userLink?.getAttribute('href'), 80).split('/').filter(Boolean)[0] || '';
    const caption = Model.text(root.querySelector('[data-testid="tweetText"]')?.textContent || '', 200);
    return {
      id: shortcode || media[0].id,
      shortcode: shortcode || '',
      pageUrl: location.href,
      title: Model.postTitle(caption, shortcode),
      caption,
      publishTime: '',
      quotedMediaOnly,
      hasQuote: quotedMediaOnly || quoteVideos.length > 0 || quoteImages.length > 0,
      quotedMedia: [],
      isPartial: media.length > 1 && !useVideos.length,
      kind: media.length > 1 ? 'carousel' : media[0].type,
      author: { id: '', username, displayName: username, avatar: '' },
      media
    };
  }

  function mergePost(target, extra) {
    if (!extra) return target;
    if (!target) return extra;
    const byId = new Map((target.media || []).map((item) => [item.id + ':' + item.index, item]));
    (extra.media || []).forEach((item) => {
      const key = item.id + ':' + item.index;
      const previous = byId.get(key);
      if (!previous || (item.videoCandidates?.length || item.imageCandidates?.length || 0) > (previous.videoCandidates?.length || previous.imageCandidates?.length || 0)) {
        byId.set(key, item);
      }
    });
    const media = [...byId.values()].sort((a, b) => (a.index || 0) - (b.index || 0));
    return {
      ...target,
      ...extra,
      media: media.length ? media : target.media,
      author: extra.author?.username ? extra.author : target.author
    };
  }

  function buildSnapshot() {
    const route = Model.routeFromUrl(location.href);
    scanScripts();
    const snapshot = Model.snapshotFromCollected(route, collected);
    if (route.kind === 'profile') {
      const ids = profileCaptures.get(new URL(location.href).pathname.toLowerCase().replace(/\/$/, '')) || new Set();
      snapshot.posts = snapshot.posts.filter(post => ids.has(post.id));
    }
    if ((route.kind === 'post' || route.kind === 'feed') && !snapshot.post) {
      const fallback = domPost(route);
      if (fallback) snapshot.post = fallback;
    } else if (snapshot.post) {
      const fallback = (route.kind === 'feed' || route.kind === 'post') ? domPost(route) : null;
      if (fallback && fallback.shortcode && snapshot.post.shortcode && fallback.shortcode !== snapshot.post.shortcode) {
        if (route.kind === 'feed') snapshot.post = fallback;
      } else if (fallback && (!snapshot.post.media || snapshot.post.media.length < fallback.media.length)) {
        snapshot.post = mergePost(snapshot.post, fallback);
      }
    }
    snapshot.url = location.href;
    return snapshot;
  }

  function emit(force) {
    const payload = buildSnapshot();
    const json = JSON.stringify(payload);
    if (!force && json === lastSnapshotJson && location.href === lastUrl) return;
    lastSnapshotJson = json;
    lastUrl = location.href;
    window.postMessage({ source: SOURCE, version: 1, type: 'SNAPSHOT', payload }, location.origin);
  }

  function queueEmit() {
    if (scheduled) return;
    scheduled = 1;
    setTimeout(() => {
      scheduled = 0;
      emit();
    }, 180);
  }

  function twitterRequest(value) {
    try {
      const url = new URL(String(value || ''), location.href);
      return /(^|\.)x\.com$|(^|\.)twitter\.com$/.test(url.hostname) ? url : null;
    } catch (_) { return null; }
  }

  function installNetworkHooks() {
    const rawJsonParse = JSON.parse;
    JSON.parse = function twitterParse(text, reviver) {
      const data = rawJsonParse.apply(this, arguments);
      if (hideFeedAds && typeof text === 'string' &&
          /HomeTimeline|HomeLatestTimeline|HomeTimeline|SearchTimeline|UserTweets|instructions/i.test(text) &&
          Model.routeFromUrl(location.href).kind === 'feed') {
        Model.filterTimelineAds(data);
      }
      return data;
    };
    const rawFetch = window.fetch;
    if (typeof rawFetch === 'function' && !rawFetch.__twitterDownloaderHook) {
      const hooked = function patchedFetch(input, init) {
        const request = rawFetch.apply(this, arguments).then(async (response) => {
          const url = twitterRequest(input?.url || input);
          if (!hideFeedAds || Model.routeFromUrl(location.href).kind !== 'feed' || !url || !response.ok ||
              !/(?:json|javascript)/i.test(response.headers.get('content-type') || '')) return response;
          try {
            const original = await response.clone().text();
            const data = rawJsonParse(original);
            if (!Model.filterTimelineAds(data)) return response;
            const headers = new Headers(response.headers);
            headers.delete('content-length');
            headers.delete('content-encoding');
            const filtered = new Response(JSON.stringify(data), { status: response.status, statusText: response.statusText, headers });
            Object.defineProperties(filtered, { url: { value: response.url }, redirected: { value: response.redirected }, type: { value: response.type } });
            return filtered;
          } catch (_) { return response; }
        });
        try {
          const url = twitterRequest(input?.url || input);
          if (url) {
            request.then((response) => {
              try {
                const clone = response.clone();
                const type = clone.headers.get('content-type') || '';
                if (/json/i.test(type)) clone.json().then((data) => { ingest(data); queueEmit(); }).catch(() => {});
                else if (/html/i.test(type) && /\/status\//i.test(url.pathname)) {
                  clone.text().then((html) => {
                    Model.parseHtmlPayloads(html).forEach((payload) => ingest(payload));
                    queueEmit();
                  }).catch(() => {});
                }
              } catch (_) {}
            }).catch(() => {});
          }
        } catch (_) {}
        return request;
      };
      hooked.__twitterDownloaderHook = true;
      window.fetch = hooked;
    }
    const transformXHR = (xhr, value) => {
      if (!hideFeedAds || xhr.readyState !== 4 || Model.routeFromUrl(location.href).kind !== 'feed') return value;
      const url = twitterRequest(xhr.__twitterDownloaderUrl);
      if (!url) return value;
      if (xhr.__twitterFilteredOriginal === value) return xhr.__twitterFilteredValue;
      try {
        const data = typeof value === 'string' ? rawJsonParse(value) : rawJsonParse(JSON.stringify(value));
        if (!Model.filterTimelineAds(data)) return value;
        xhr.__twitterFilteredOriginal = value;
        xhr.__twitterFilteredValue = typeof value === 'string' ? JSON.stringify(data) : data;
        return xhr.__twitterFilteredValue;
      } catch (_) { return value; }
    };
    if (!XMLHttpRequest.prototype.__twitterDownloaderHook) {
      for (const name of ['response', 'responseText']) {
        const descriptor = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, name);
        if (!descriptor?.get || !descriptor.configurable) continue;
        Object.defineProperty(XMLHttpRequest.prototype, name, { ...descriptor, get() {
          const value = descriptor.get.call(this);
          if (name === 'response' && this.responseType && this.responseType !== 'json' && this.responseType !== 'text') return value;
          return transformXHR(this, value);
        } });
      }
    }
    const rawOpen = XMLHttpRequest.prototype.open;
    const rawSend = XMLHttpRequest.prototype.send;
    if (!XMLHttpRequest.prototype.__twitterDownloaderHook) {
      XMLHttpRequest.prototype.open = function patchedOpen(method, url) {
        this.__twitterDownloaderUrl = String(url || '');
        this.__twitterFilteredOriginal = undefined;
        this.__twitterFilteredValue = undefined;
        return rawOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function patchedSend() {
        this.addEventListener('load', function onLoad() {
          try {
            const url = twitterRequest(this.__twitterDownloaderUrl);
            if (!url) return;
            parseMaybeJson(this.responseType === 'json' ? this.response : this.responseText);
            queueEmit();
          } catch (_) {}
        });
        return rawSend.apply(this, arguments);
      };
      XMLHttpRequest.prototype.__twitterDownloaderHook = true;
    }
  }

  function permalinkUrl(post) {
    const href = post?.pageUrl || post?.url;
    if (href && /^https:\/\/(?:www\.)?(?:x|twitter)\.com\//i.test(href)) return href;
    const id = post?.shortcode || Model.tweetIdOf(href);
    if (!id) return '';
    const user = post?.author?.username || post?.username;
    return user ? ('https://x.com/' + encodeURIComponent(user) + '/status/' + id) : ('https://x.com/i/web/status/' + id);
  }

  function resolvePost(input) {
    const url = permalinkUrl(input);
    if (!url) return Promise.resolve(null);
    const code = input.shortcode || Model.tweetIdOf(url);
    const captured = [...collected.posts.values()].find((post) => post.shortcode === code && post.media?.length && (!post.expectedMediaCount || post.media.length >= post.expectedMediaCount) && post.media.every((media) => (media.type === 'video' || media.type === 'gif' ? media.videoCandidates : media.imageCandidates)?.length));
    if (captured) return Promise.resolve(captured);
    const cached = detailCache.get(url);
    if (cached && Date.now() - cached.at < 5 * 60 * 1000) return Promise.resolve(cached.post);
    if (cached) detailCache.delete(url);
    if (Date.now() - (detailFailures.get(url) || 0) < 20000) return Promise.resolve(null);
    if (typeof window.fetch !== 'function') return Promise.resolve(null);
    const controller = new AbortController();
    resolveControllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 8000);
    return window.fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const html = await response.text();
      const local = { posts: new Map(), stories: [], creators: [], seen: new WeakSet(), count: 0 };
      Model.parseHtmlPayloads(html).forEach((payload) => {
        Model.collectFromJson(payload, local, { pageUrl: url });
        ingest(payload);
      });
      const route = Model.routeFromUrl(url);
      const snapshot = Model.snapshotFromCollected(route, local.posts.size ? local : collected);
      const post = [snapshot.post, ...local.posts.values()].find((item) => item?.shortcode === route.shortcode) || null;
      if (post) {
        detailCache.set(url, { post, at: Date.now() });
        while (detailCache.size > 30) detailCache.delete(detailCache.keys().next().value);
      }
      queueEmit();
      return post || null;
    }).catch(() => {
      detailFailures.set(url, Date.now());
      return null;
    }).finally(() => { clearTimeout(timeout); resolveControllers.delete(controller); });
  }

  function pumpResolve() {
    while (resolveActive < 2 && resolveQueue.length) {
      const job = resolveQueue.shift();
      if (!job) break;
      resolveActive += 1;
      resolvePost(job.post).then((post) => {
        window.postMessage({
          source: SOURCE,
          type: 'RESOLVE_RESULT',
          epoch: job.epoch,
          requestId: job.requestId,
          post
        }, location.origin);
      }).finally(() => {
        resolveActive -= 1;
        pumpResolve();
      });
    }
  }

  function hookHistory() {
    const wrap = (method) => {
      const raw = history[method];
      if (typeof raw !== 'function' || raw.__twitterDownloaderHook) return;
      const hooked = function patchedHistory() {
        const result = raw.apply(this, arguments);
        queueEmit();
        return result;
      };
      hooked.__twitterDownloaderHook = true;
      history[method] = hooked;
    };
    wrap('pushState');
    wrap('replaceState');
    window.addEventListener('popstate', queueEmit);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== CONTENT_SOURCE) return;
    if (event.data.type === 'AD_SETTINGS') hideFeedAds = event.data.hideAds === true;
    if (event.data.type === 'GET_SNAPSHOT') emit(true);
    if (event.data.type === 'CANCEL_RESOLVE') {
      resolveQueue.length = 0;
      resolveControllers.forEach((controller) => controller.abort());
    }
    if (event.data.type === 'RESOLVE_POSTS') {
      resolveEpoch = Number(event.data.epoch) || resolveEpoch;
      (Array.isArray(event.data.posts) ? event.data.posts : []).forEach((post) => {
        resolveQueue.push({ post, epoch: resolveEpoch, requestId: event.data.requestId || '' });
      });
      pumpResolve();
    }
  });

  const observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => [...mutation.addedNodes, ...mutation.removedNodes].some((item) =>
      item.nodeType === 1 && !item.closest?.('#twitter-dl-root, .x-dl-post-entry') && item.id !== 'twitter-dl-root' && !item.classList?.contains('x-dl-post-entry')))) queueEmit();
  });
  try { observer.observe(document.documentElement, { childList: true, subtree: true }); } catch (_) {}

  installNetworkHooks();
  window.postMessage({ source: SOURCE, type: 'AD_SETTINGS_REQUEST' }, location.origin);
  hookHistory();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => emit(true), { once: true });
  else emit(true);
  setInterval(() => {
    if (location.href !== lastUrl) queueEmit();
  }, 500);
})();
