(function initTwitterDownloaderModel(root) {
  'use strict';

  const AVATAR_HINT = /profile_images|\/profile_banners\//i;
  const STATIC_HINT = /abs\.twimg\.com|\/responsive-web\/|\/hashflags\//i;
  const THUMB_HINT = /name=(?:thumb|small|360x360)|:thumb|:small/i;
  const RESERVED = /^(?:home|explore|notifications|messages|i|settings|search|compose|login|signup|tos|privacy|about|help|download|intent|hashtag|communities|jobs|premium|logout|account|oauth|share|embed|widgets|privacy-policy|rules-and-policies)$/i;

  function text(value, limit) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, limit || 500);
  }

  function httpsUrl(value) {
    const raw = String(value || '').trim();
    if (!raw || raw.startsWith('blob:') || raw.startsWith('data:')) return '';
    try {
      const url = new URL(raw, 'https://x.com/');
      if (url.protocol !== 'https:') return '';
      return url.href;
    } catch (_) {
      return '';
    }
  }

  function hostOf(value) {
    try { return new URL(value).hostname.toLowerCase(); } catch (_) { return ''; }
  }

  function isMediaHost(url) {
    const host = hostOf(url);
    if (!host) return false;
    if (host === 'x.com' || host === 'twitter.com' || host === 'www.x.com' || host === 'www.twitter.com' || host === 'api.x.com') return false;
    return /(^|\.)(twimg\.com|pscp\.tv|periscope\.tv)$/i.test(host);
  }

  function allowedMediaUrl(url) {
    const href = httpsUrl(url);
    return href && isMediaHost(href) ? href : '';
  }

  function looksLikeAvatar(url) {
    return AVATAR_HINT.test(String(url || ''));
  }

  function looksLikeThumb(url) {
    return THUMB_HINT.test(String(url || ''));
  }

  function tweetIdOf(value) {
    const raw = text(value, 80);
    if (/^\d{5,25}$/.test(raw)) return raw;
    const href = String(value || '');
    const match = href.match(/\/status(?:es)?\/(\d{5,25})/i);
    return match ? match[1] : '';
  }

  function shortcodeOf(value) {
    return tweetIdOf(value);
  }

  function idOf(value) {
    return tweetIdOf(value) || text(value, 80);
  }

  function unixTime(value) {
    if (!value) return '';
    if (typeof value === 'number' && Number.isFinite(value)) {
      const ms = value > 1e12 ? value : value * 1000;
      try { return new Date(ms).toISOString(); } catch (_) { return ''; }
    }
    const parsed = Date.parse(String(value));
    if (!Number.isFinite(parsed)) return '';
    try { return new Date(parsed).toISOString(); } catch (_) { return ''; }
  }

  function captionText(value) {
    if (!value) return '';
    if (typeof value === 'string') return String(value).replace(/\r/g, '').trim().slice(0, 2000);
    if (typeof value.full_text === 'string') return String(value.full_text).replace(/\r/g, '').trim().slice(0, 2000);
    if (typeof value.text === 'string') return String(value.text).replace(/\r/g, '').trim().slice(0, 2000);
    if (typeof value.note_tweet?.note_tweet_results?.result?.text === 'string') {
      return String(value.note_tweet.note_tweet_results.result.text).replace(/\r/g, '').trim().slice(0, 2000);
    }
    return '';
  }

  function postTitle(caption, id) {
    const line = text(String(caption || '').replace(/https?:\/\/t\.co\/\S+/g, '').split(/\r?\n/)[0], 100);
    const cleaned = line.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
    return cleaned || ('Tweet ' + (id || 'media'));
  }

  function unwrapUser(node) {
    return node?.user_results?.result || node?.user_results || node?.user || node?.core?.user_results?.result || node;
  }

  function authorFrom(node) {
    const user = unwrapUser(node?.core) || unwrapUser(node) || node?.user || {};
    const legacy = user.legacy || user;
    const avatarRaw = legacy.profile_image_url_https || user.avatar?.image_url || user.profile_image_url_https || legacy.profile_image_url;
    const avatar = httpsUrl(String(avatarRaw || '').replace(/_normal(\.[a-z0-9]+)?$/i, '_400x400$1').replace(/_x96(\.[a-z0-9]+)?$/i, '_400x400$1'));
    return {
      id: text(user.rest_id || user.id_str || user.id || legacy.id_str, 80),
      username: text(legacy.screen_name || user.core?.screen_name || user.screen_name || user.username, 80).replace(/^@/, ''),
      displayName: text(legacy.name || user.core?.name || user.name || legacy.screen_name || user.core?.screen_name, 120),
      avatar
    };
  }

  function candidate(url, extra) {
    const href = allowedMediaUrl(url);
    if (!href) return null;
    const width = Math.max(0, Number(extra?.width || extra?.w) || 0);
    const height = Math.max(0, Number(extra?.height || extra?.h) || 0);
    return {
      url: href,
      mime: text(extra?.mime || extra?.content_type || extra?.mime_type, 80),
      width,
      height,
      bitrate: Math.max(0, Number(extra?.bitrate) || 0),
      sizeBytes: Math.max(0, Number(extra?.sizeBytes || extra?.size) || 0),
      source: text(extra?.source, 40) || 'structured',
      backupUrls: []
    };
  }

  function dedupeCandidates(list) {
    const seen = new Set();
    const result = [];
    (Array.isArray(list) ? list : []).forEach((item) => {
      if (!item?.url) return;
      // Keep query (name=orig vs name=large) — path-only keys collapsed size variants.
      let key = item.url;
      try {
        const parsed = new URL(item.url);
        const name = parsed.searchParams.get('name') || parsed.pathname.match(/:(thumb|small|medium|large|orig)$/i)?.[1] || '';
        key = parsed.origin + parsed.pathname + '|name=' + name + '|' + (item.width || 0) + '|' + (item.height || 0) + '|' + (item.bitrate || 0);
      } catch (_) {
        key = item.url.split('#')[0] + '|' + (item.width || 0) + '|' + (item.height || 0) + '|' + (item.bitrate || 0);
      }
      if (seen.has(key)) return;
      seen.add(key);
      result.push(item);
    });
    return result;
  }

  function area(item) {
    return (Number(item?.width) || 0) * (Number(item?.height) || 0);
  }

  function sortImageCandidates(list) {
    return dedupeCandidates(list).sort((a, b) => {
      const aThumb = looksLikeThumb(a.url) || looksLikeAvatar(a.url) ? 1 : 0;
      const bThumb = looksLikeThumb(b.url) || looksLikeAvatar(b.url) ? 1 : 0;
      if (aThumb !== bThumb) return aThumb - bThumb;
      const origRank = (item) => /name=orig|:orig(?:$|\?)/i.test(item.url) ? 1 : 0;
      if (origRank(b) !== origRank(a)) return origRank(b) - origRank(a);
      const sourceRank = (item) => item.source === 'structured' ? 3 : item.source === 'srcset' ? 2 : 1;
      if (sourceRank(b) !== sourceRank(a)) return sourceRank(b) - sourceRank(a);
      if (area(b) !== area(a)) return area(b) - area(a);
      return Math.max(b.width, b.height) - Math.max(a.width, a.height);
    });
  }

  function sortVideoCandidates(list) {
    return dedupeCandidates(list).filter((item) => !/application\/x-mpegurl|\.m3u8(?:$|\?)/i.test(item.mime || item.url)).sort((a, b) => {
      if ((b.bitrate || 0) !== (a.bitrate || 0)) return (b.bitrate || 0) - (a.bitrate || 0);
      if (area(b) !== area(a)) return area(b) - area(a);
      return (b.sizeBytes || 0) - (a.sizeBytes || 0);
    });
  }

  function pickBest(list, kind) {
    const sorted = kind === 'video' ? sortVideoCandidates(list) : sortImageCandidates(list);
    if (!sorted.length) return null;
    return { ...sorted[0], backupUrls: sorted.slice(1).map((item) => item.url).filter(Boolean).slice(0, 12) };
  }

  function origImageUrl(url) {
    const href = allowedMediaUrl(url);
    if (!href) return '';
    try {
      const parsed = new URL(href);
      if (!/(^|\.)pbs\.twimg\.com$/i.test(parsed.hostname)) return href;
      if (/\/(?:media|card_img)\//i.test(parsed.pathname)) {
        parsed.searchParams.set('name', 'orig');
        if (!parsed.searchParams.get('format')) {
          const ext = parsed.pathname.match(/\.(jpe?g|png|webp)$/i);
          parsed.searchParams.set('format', ext ? ext[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg');
        }
        return parsed.href;
      }
      // Video thumbs (ext_tw_video_thumb / amplify_video_thumb / tweet_video_thumb)
      // are already full frames — do not append :orig.
      if (/\/(?:ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb|media_video_thumb)\//i.test(parsed.pathname)) {
        return href;
      }
      if (/:(?:thumb|small|medium|large|orig)$/i.test(parsed.pathname)) {
        return href.replace(/:(?:thumb|small|medium|large|orig)$/i, '') + ':orig';
      }
      return href;
    } catch (_) {
      return href;
    }
  }

  function sizedImageUrl(url, name) {
    const href = allowedMediaUrl(url);
    if (!href || !name) return '';
    try {
      const parsed = new URL(href);
      if (!/(^|\.)pbs\.twimg\.com$/i.test(parsed.hostname)) return '';
      if (/\/(?:media|card_img)\//i.test(parsed.pathname)) {
        parsed.searchParams.set('name', name);
        if (!parsed.searchParams.get('format')) {
          const ext = parsed.pathname.match(/\.(jpe?g|png|webp)$/i);
          parsed.searchParams.set('format', ext ? ext[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg');
        }
        return parsed.href;
      }
      if (/\/(?:ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb|media_video_thumb)\//i.test(parsed.pathname)) {
        return href;
      }
      if (/:(?:thumb|small|medium|large|orig)$/i.test(parsed.pathname)) {
        return href.replace(/:(?:thumb|small|medium|large|orig)$/i, '') + ':' + name;
      }
      return '';
    } catch (_) {
      return '';
    }
  }

  function imageCandidatesFromApi(node, source) {
    const list = [];
    const width = Number(node?.original_info?.width || node?.sizes?.large?.w || node?.sizes?.orig?.w) || 0;
    const height = Number(node?.original_info?.height || node?.sizes?.large?.h || node?.sizes?.orig?.h) || 0;
    const raw = node?.media_url_https || node?.media_url || node?.mediaUrlHttps;
    const sizes = [
      [origImageUrl(raw), width, height],
      [sizedImageUrl(raw, 'large'), width, height],
      [sizedImageUrl(raw, 'medium'), Math.min(width || 1200, 1200), Math.min(height || 1200, 1200)],
      [allowedMediaUrl(raw), width, height]
    ];
    sizes.forEach(([href, w, h]) => {
      if (href) list.push(candidate(href, { width: w, height: h, mime: 'image/jpeg', source: source || 'structured' }));
    });
    ['media_url_https', 'media_url', 'mediaUrlHttps'].forEach((key) => {
      const next = candidate(origImageUrl(node?.[key]) || node?.[key], { width, height, source: source || 'structured' });
      if (next) list.push(next);
    });
    return sortImageCandidates(list.filter(Boolean));
  }

  function videoCandidatesFromApi(node, source) {
    const list = [];
    const variants = node?.video_info?.variants || node?.videoInfo?.variants || [];
    variants.forEach((item) => {
      if (/application\/x-mpegurl|\.m3u8(?:$|\?)/i.test(item?.content_type || item?.url || '')) return;
      const next = candidate(item?.url, {
        mime: item?.content_type || 'video/mp4',
        bitrate: item?.bitrate,
        width: node?.original_info?.width,
        height: node?.original_info?.height,
        source: source || 'structured'
      });
      if (next) list.push(next);
    });
    return sortVideoCandidates(list);
  }

  function mediaTypeOf(node) {
    const type = text(node?.type || node?.media_type).toLowerCase();
    if (type === 'animated_gif' || type === 'gif') return 'gif';
    if (type === 'video') return 'video';
    if (videoCandidatesFromApi(node).length) return type === 'animated_gif' ? 'gif' : 'video';
    return 'image';
  }

  function mediaNodes(legacy) {
    if (!legacy || typeof legacy !== 'object') return [];
    const extended = legacy.extended_entities?.media
      || legacy.extendedEntities?.media
      || legacy.mediaDetails
      || legacy.media_details;
    if (Array.isArray(extended) && extended.length) return extended;
    const entities = legacy.entities?.media || legacy.entity_set?.media;
    if (Array.isArray(entities) && entities.length) return entities;
    return [];
  }

  function cardBindingMap(card) {
    const legacy = card?.legacy || card;
    const raw = legacy?.binding_values || legacy?.bindingValues || card?.binding_values;
    if (!raw) return {};
    if (Array.isArray(raw)) {
      const map = {};
      raw.forEach((item) => {
        if (item?.key) map[item.key] = item.value || item;
      });
      return map;
    }
    if (typeof raw === 'object') return raw;
    return {};
  }

  function cardImageEntry(url, width, height, key) {
    const href = allowedMediaUrl(url);
    if (!href) return null;
    return {
      id_str: 'card-' + text(key || href.slice(-12), 40),
      type: 'photo',
      media_url_https: href,
      original_info: {
        width: Number(width) || 0,
        height: Number(height) || 0
      }
    };
  }

  function cardMediaNodes(tweet) {
    const card = tweet?.card || tweet?.tweet_card || tweet?.legacy?.card;
    if (!card) return [];
    const legacy = card.legacy || card;
    const name = text(legacy.name || card.name, 80).split(':').pop().toLowerCase();
    const bvals = cardBindingMap(card);

    if (name === 'unified_card' || bvals.unified_card) {
      try {
        const raw = bvals.unified_card?.string_value
          || bvals.unified_card?.value?.string_value
          || bvals.unified_card?.stringValue
          || '';
        const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const entities = data?.media_entities || data?.mediaEntities || {};
        const list = Object.values(entities).filter(Boolean);
        if (list.length) return list;
      } catch (_) {}
    }

    // Prefer largest summary / link-preview image (blog cards, articles, etc.).
    const prefixes = ['photo_image_full_size', 'summary_photo_image', 'thumbnail_image'];
    const sizes = ['original', 'x_large', 'large', 'small', ''];
    for (const prefix of prefixes) {
      for (const size of sizes) {
        const key = size ? prefix + '_' + size : prefix;
        const value = bvals[key];
        const image = value?.image_value || value?.imageValue || value;
        const entry = cardImageEntry(image?.url, image?.width, image?.height, key);
        if (entry) return [entry];
      }
    }

    // Last resort: any image_value in binding_values.
    for (const [key, value] of Object.entries(bvals)) {
      const image = value?.image_value || value?.imageValue;
      const entry = cardImageEntry(image?.url, image?.width, image?.height, key);
      if (entry) return [entry];
    }
    return [];
  }

  function tweetResult(node) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
    if (node.tweet) return tweetResult(node.tweet);
    if (node.tweet_results?.result) return tweetResult(node.tweet_results.result);
    if (node.tweetResult?.result) return tweetResult(node.tweetResult.result);
    if (node.tweet_result?.result) return tweetResult(node.tweet_result.result);
    if (node.__typename === 'TweetWithVisibilityResults' && node.tweet) return tweetResult(node.tweet);
    if (node.legacy || node.rest_id || node.id_str) return node;
    return null;
  }

  function unwrapTweet(node) {
    const tweet = tweetResult(node);
    if (!tweet) return null;
    const retweet = tweet.legacy?.retweeted_status_result?.result
      || tweet.retweeted_status_result?.result
      || tweet.legacy?.retweeted_status;
    if (retweet) return tweetResult(retweet) || tweet;
    return tweet;
  }

  function quotedTweet(node) {
    const tweet = tweetResult(node);
    return tweetResult(tweet?.quoted_status_result?.result || tweet?.quoted_status || tweet?.legacy?.quoted_status);
  }

  function isTweetNode(node) {
    const tweet = tweetResult(node);
    if (!tweet) return false;
    const id = tweetIdOf(tweet.rest_id || tweet.legacy?.id_str || tweet.id_str);
    if (!id) return false;
    return Boolean(tweet.legacy || tweet.core || mediaNodes(tweet.legacy).length || cardMediaNodes(tweet).length);
  }

  function makeMediaItem(node, index, source, extras) {
    const type = mediaTypeOf(node);
    let images = imageCandidatesFromApi(node, source);
    // Video/GIF thumbs live on media_url_https even when variants are video-only.
    if ((type === 'video' || type === 'gif') && !images.length) {
      const thumb = allowedMediaUrl(node?.media_url_https || node?.media_url || node?.mediaUrlHttps);
      if (thumb) {
        images = [candidate(thumb, {
          width: Number(node?.original_info?.width) || 0,
          height: Number(node?.original_info?.height) || 0,
          mime: 'image/jpeg',
          source: source || 'structured'
        })].filter(Boolean);
      }
    }
    // Prefer the unmodified thumb URL as poster; size ladders stay in imageCandidates.
    const rawThumb = allowedMediaUrl(node?.media_url_https || node?.media_url || node?.mediaUrlHttps);
    const videos = type === 'video' || type === 'gif' ? videoCandidatesFromApi(node, source) : [];
    const bestImage = pickBest(images, 'image');
    const bestVideo = pickBest(videos, 'video');
    const width = Number(node?.original_info?.width || bestVideo?.width || bestImage?.width) || 0;
    const height = Number(node?.original_info?.height || bestVideo?.height || bestImage?.height) || 0;
    const id = tweetIdOf(node?.id_str || node?.media_key || node?.id) || String(index);
    return {
      id,
      index,
      type,
      width,
      height,
      duration: Number(node?.video_info?.duration_millis || node?.videoInfo?.duration_millis || 0) / 1000 || 0,
      posterUrl: rawThumb || bestImage?.url || '',
      mime: type === 'image' ? (bestImage?.mime || 'image/jpeg') : 'video/mp4',
      imageCandidates: images,
      videoCandidates: videos,
      fromQuote: Boolean(extras?.fromQuote)
    };
  }

  function pageKindOf(media) {
    if (media.length > 1) return 'carousel';
    if (media[0]?.type === 'gif') return 'gif';
    if (media[0]?.type === 'video') return 'video';
    return 'image';
  }

  function makePost(node, extras) {
    const tweet = unwrapTweet(node);
    if (!tweet) return null;
    const legacy = tweet.legacy || tweet;
    const items = mediaNodes(legacy);
    const cardItems = items.length ? [] : cardMediaNodes(tweet);
    const quoted = quotedTweet(tweet);
    const quotedNative = quoted ? mediaNodes(quoted.legacy || quoted) : [];
    const quotedItems = quotedNative.length ? quotedNative : (quoted ? cardMediaNodes(quoted) : []);
    const quotedMediaOnly = items.length === 0 && cardItems.length === 0 && quotedItems.length > 0;
    // Prefer native media, then link-card preview images, then quoted media.
    let media = items.map((item, index) => makeMediaItem(item, index + 1, extras?.source || 'structured'));
    if (!media.length && cardItems.length) {
      media = cardItems.map((item, index) => makeMediaItem(item, index + 1, extras?.source || 'card'));
    }
    if (!media.length && quotedItems.length) {
      media = quotedItems.map((item, index) => makeMediaItem(item, index + 1, extras?.source || 'structured', { fromQuote: true }));
    }
    const quotedMedia = (!quotedMediaOnly && quotedItems.length)
      ? quotedItems.map((item, index) => makeMediaItem(item, index + 1, extras?.source || 'structured', { fromQuote: true }))
          .filter((item) => item.videoCandidates.length || item.imageCandidates.length)
      : [];
    const valid = media.filter((item) => item.videoCandidates.length || item.imageCandidates.length);
    const author = authorFrom(tweet);
    const quotedAuthor = quoted ? authorFrom(quoted) : { id: '', username: '', displayName: '', avatar: '' };
    const id = tweetIdOf(tweet.rest_id || legacy.id_str || tweet.id_str || extras?.shortcode);
    if (!id) return null;
    const note = tweet.note_tweet?.note_tweet_results?.result?.text || '';
    const caption = captionText(note || legacy.full_text || legacy.text);
    const username = author.username || extras?.username || '';
    const pageUrl = extras?.pageUrl || (username
      ? ('https://x.com/' + encodeURIComponent(username) + '/status/' + id)
      : ('https://x.com/i/web/status/' + id));
    return {
      id,
      shortcode: id,
      conversationId: tweetIdOf(legacy.conversation_id_str || id),
      quotedMediaOnly,
      fromCard: cardItems.length > 0 && items.length === 0,
      hasQuote: Boolean(quoted),
      quotedAuthor,
      quotedMedia,
      pageUrl,
      title: postTitle(caption, id),
      caption,
      publishTime: unixTime(legacy.created_at || tweet.created_at),
      kind: valid.length ? pageKindOf(valid) : 'tweet',
      author,
      authors: [author].filter((item) => item.username),
      expectedMediaCount: valid.length,
      media: valid,
      isPartial: !valid.length
    };
  }

  function downloadKey(postId, media) {
    const type = media?.type === 'video' || media?.type === 'gif' ? media.type : 'image';
    if (media?.id) return [postId || '', media.id, type].join(':');
    return [postId || '', Number(media?.index) || 1, type].join(':');
  }

  function padIndex(index, total) {
    const width = Math.max(2, String(Math.max(1, Number(total) || 1)).length);
    return String(Math.max(1, Number(index) || 1)).padStart(width, '0');
  }

  function templateHasIndex(template) {
    return /\{index\}/i.test(String(template || ''));
  }

  function withAutoIndex(filename, index, total, template) {
    if ((Number(total) || 1) <= 1 || templateHasIndex(template)) return filename;
    const raw = String(filename || '');
    const match = raw.match(/\.([a-z0-9]{1,8})$/i);
    const ext = match ? match[0] : '';
    const base = ext ? raw.slice(0, -ext.length) : raw;
    if (new RegExp('[-_ ]0*' + Number(index) + '$').test(base)) return filename;
    return base.replace(/[. ]+$/g, '') + ' - ' + padIndex(index, total) + ext;
  }

  function folderPrefix(prefs, post) {
    const parts = [];
    if (prefs?.folderLayout === 'flat') return '';
    if (prefs?.folderLayout === 'archive') {
      const safe = value => text(value, 80).replace(/[\\/<>:"|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '') || 'unknown';
      return 'Twitter Downloads/@' + safe(post?.author?.username) + '/' +
        safe(String(post?.publishTime || '').slice(0, 10) || 'undated') + '/' + safe(post?.shortcode || post?.id) + '/';
    }
    if (prefs?.creatorFolders && post?.author?.username) parts.push(text(post.author.username, 60));
    if (prefs?.carouselFolders && (post?.media?.length || 0) > 1) parts.push(text(post.shortcode || post.id, 40));
    return parts.length ? ('Twitter Downloads/' + parts.join('/') + '/') : '';
  }

  function collectFromJson(data, into, extras) {
    const posts = into?.posts || new Map();
    const stories = into?.stories || [];
    const creators = into?.creators || [];
    const seen = into?.seen || new WeakSet();
    const extrasSafe = extras || {};
    let count = extrasSafe.count || 0;
    function walk(node, depth) {
      if (count > 8000 || depth > 24 || !node || typeof node !== 'object') return;
      if (seen.has(node)) return;
      seen.add(node);
      count += 1;
      if (Array.isArray(node)) {
        node.forEach((item) => walk(item, depth + 1));
        return;
      }
      if (isTweetNode(node)) {
        const post = makePost(node, extrasSafe);
        if (post) {
          const key = post.shortcode || post.id;
          const previous = posts.get(key);
          const score = (item) => (item?.media?.length || 0) * 10
            + (item?.media || []).reduce((total, media) => total + (media.videoCandidates?.length || 0) * 3 + (media.imageCandidates?.length || 0), 0);
          if (!previous || score(post) > score(previous)) posts.set(key, post);
          if (post.author?.username) creators.push(post.author);
        }
      }
      Object.keys(node).forEach((key) => {
        if (key === 'extended_entities' || key === 'entities' || key === 'quoted_status') return;
        walk(node[key], depth + 1);
      });
    }
    walk(data, 0);
    into.posts = posts;
    into.stories = stories;
    into.creators = creators;
    into.seen = seen;
    into.count = count;
    return into;
  }

  function parseHtmlPayloads(html) {
    const payloads = [];
    const source = String(html || '');
    const patterns = [
      /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi,
      /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/gi
    ];
    patterns.forEach((pattern) => {
      let match;
      while ((match = pattern.exec(source))) {
        try { payloads.push(JSON.parse(match[1])); } catch (_) {}
      }
    });
    return payloads;
  }

  function routeFromUrl(href) {
    let url;
    try { url = new URL(String(href || ''), 'https://x.com/'); } catch (_) { return { kind: 'unsupported', url: String(href || '') }; }
    const host = url.hostname.toLowerCase();
    if (!/(^|\.)x\.com$|(^|\.)twitter\.com$/.test(host)) return { kind: 'unsupported', url: url.href };
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const parts = path.split('/').filter(Boolean);
    if (!parts.length || parts[0] === 'home') return { kind: 'feed', url: url.href };
    if (parts[0] === 'i' && parts[1] === 'web' && parts[2] === 'status' && /^\d{5,25}$/.test(parts[3] || '')) {
      return { kind: 'post', shortcode: parts[3], url: url.href };
    }
    if (parts[0] === 'i' && parts[1] === 'status' && /^\d{5,25}$/.test(parts[2] || '')) {
      return { kind: 'post', shortcode: parts[2], url: url.href };
    }
    const statusIndex = parts.findIndex((part) => part === 'status' || part === 'statuses');
    if (statusIndex >= 0 && /^\d{5,25}$/.test(parts[statusIndex + 1] || '')) {
      return {
        kind: 'post',
        shortcode: parts[statusIndex + 1],
        username: statusIndex > 0 ? decodeURIComponent(parts[0]) : '',
        url: url.href
      };
    }
    if (RESERVED.test(parts[0]) || parts[0] === 'hashtag') return { kind: 'unsupported', url: url.href };
    if (parts.length === 1 || (parts.length === 2 && /^(?:media|videos|likes|with_replies|highlights|articles)$/i.test(parts[1]))) {
      return { kind: 'profile', username: decodeURIComponent(parts[0]), url: url.href };
    }
    return { kind: 'unsupported', url: url.href };
  }

  function snapshotFromCollected(route, collected) {
    const posts = [...(collected.posts || new Map()).values()];
    const creator = route.username
      ? (collected.creators || []).find((item) => item.username?.toLowerCase() === route.username.toLowerCase()) || null
      : collected.creators?.[0] || null;
    if (route.kind === 'post') {
      const post = posts.find((item) => item.shortcode === route.shortcode) || null;
      if (!post) return { kind: 'post', url: route.url, reason: 'unrecognized', post: null, creator, stories: [] };
      const threadPosts = posts.filter(item => !item.quotedMediaOnly && item.media?.length && item.conversationId === post.conversationId &&
        item.author?.username?.toLowerCase() === post.author?.username?.toLowerCase());
      return { kind: 'post', url: route.url, post, threadPosts, creator: post.author || creator, stories: [] };
    }
    if (route.kind === 'profile') {
      return {
        kind: 'profile',
        url: route.url,
        creator: creator || { username: route.username, displayName: route.username, id: '', avatar: '' },
        posts: posts.filter((item) => !route.username || item.author?.username?.toLowerCase() === String(route.username || '').toLowerCase()),
        stories: []
      };
    }
    if (route.kind === 'feed') {
      const post = posts[0] || null;
      return { kind: 'feed', url: route.url, post, creator: post?.author || creator, stories: [] };
    }
    return { kind: 'unsupported', url: route.url, reason: 'unsupported', post: null, creator, stories: [] };
  }

  function isAdEntry(item) {
    if (!item || typeof item !== 'object') return false;
    const id = String(item.entryId || item.id || item.entry_id || '');
    if (/who-to-follow|whoToFollow|who_to_follow/i.test(id)) return true;
    if (/promoted/i.test(id)) return true;
    const content = item.content || item;
    const itemContent = content.itemContent || content.item_content || item.itemContent || item;
    return Boolean(
      item.promotedMetadata || item.promoted_metadata || item.tweetPromotedMetadata
      || content.promotedMetadata || content.promoted_metadata
      || itemContent.promotedMetadata || itemContent.promoted_metadata || itemContent.tweetPromotedMetadata
      || itemContent.promoted
    );
  }

  function filterTimelineAds(payload) {
    let removed = 0;
    const filter = (items) => items.filter((item) => {
      if (!isAdEntry(item)) return true;
      removed += 1;
      return false;
    });
    const visit = (node, depth) => {
      if (!node || typeof node !== 'object' || depth > 24) return;
      if (Array.isArray(node)) {
        for (let index = node.length - 1; index >= 0; index -= 1) {
          if (isAdEntry(node[index])) {
            node.splice(index, 1);
            removed += 1;
          } else visit(node[index], depth + 1);
        }
        return;
      }
      for (const key of Object.keys(node)) {
        const value = node[key];
        if (key === 'entries' && Array.isArray(value)) node[key] = filter(value);
        else if (key === 'instructions' && Array.isArray(value)) value.forEach((item) => visit(item, depth + 1));
        else if (['data', 'home', 'homeTimeline', 'homeLatestTimeline', 'user', 'result', 'timeline', 'timeline_v2', 'timelineResponse'].includes(key)) visit(value, depth + 1);
        else if (value && typeof value === 'object') visit(value, depth + 1);
      }
    };
    visit(payload, 0);
    return removed;
  }

  const api = {
    filterPosts(list, filters = {}) {
      const type = filters.type || 'all';
      const result = list.filter(post => {
        // Text-only tweets never appear — same rule as the feed download button.
        const count = post.media?.length || 0;
        if (!count) return false;
        const date = String(post.publishTime || '').slice(0, 10);
        return (!filters.from || date && date >= filters.from) && (!filters.to || date && date <= filters.to) &&
          (!filters.min || count >= Number(filters.min)) && (!filters.max || count <= Number(filters.max)) &&
          (type === 'all' || post.media?.some(media => media.type === type));
      });
      // Match profile timeline: current page DOM order first, then remaining by time.
      if (!filters.preserveOrder) result.sort((a, b) => {
        const aHas = Number.isFinite(a.timelineIndex);
        const bHas = Number.isFinite(b.timelineIndex);
        if (aHas && bHas && a.timelineIndex !== b.timelineIndex) return a.timelineIndex - b.timelineIndex;
        if (aHas !== bHas) return aHas ? -1 : 1;
        const pin = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
        if (pin) return pin;
        return String(b.publishTime || '').localeCompare(String(a.publishTime || ''))
          || String(b.id || '').localeCompare(String(a.id || ''));
      });
      return filters.limit > 0 ? result.slice(0, Number(filters.limit)) : result;
    },
    filterTimelineAds,
    text,
    httpsUrl,
    allowedMediaUrl,
    isMediaHost,
    looksLikeAvatar,
    looksLikeThumb,
    shortcodeOf,
    tweetIdOf,
    idOf,
    captionText,
    postTitle,
    authorFrom,
    pickBest,
    sortImageCandidates,
    sortVideoCandidates,
    makePost,
    makeMediaItem,
    downloadKey,
    padIndex,
    templateHasIndex,
    withAutoIndex,
    folderPrefix,
    collectFromJson,
    parseHtmlPayloads,
    routeFromUrl,
    snapshotFromCollected,
    origImageUrl,
    sizedImageUrl,
    STATIC_HINT
  };

  root.TwitterDownloaderModel = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
