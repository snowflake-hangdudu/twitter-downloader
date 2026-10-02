import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const context = vm.createContext({ globalThis: {}, console, URL, Map, Set, WeakSet, Array, Object, String, Number, Date, Math, JSON, module: { exports: {} } });
context.globalThis = context;
vm.runInContext(readFileSync(path.join(root, 'content', 'twitter-model.js'), 'utf8'), context, { filename: 'twitter-model.js' });
const Model = context.TwitterDownloaderModel;

const photo = {
  rest_id: '1234567890123456789',
  core: { user_results: { result: { rest_id: '9', legacy: { screen_name: 'alice', name: 'Alice', profile_image_url_https: 'https://pbs.twimg.com/profile_images/avatar.jpg' } } } },
  legacy: {
    id_str: '1234567890123456789',
    full_text: 'Hello from a photo\nsecond line https://t.co/abc',
    created_at: 'Wed Oct 10 20:19:24 +0000 2018',
    extended_entities: {
      media: [{
        id_str: '111',
        type: 'photo',
        media_url_https: 'https://pbs.twimg.com/media/ABC.jpg',
        original_info: { width: 1440, height: 1800 }
      }]
    }
  }
};

const video = {
  rest_id: '2222222222222222222',
  core: { user_results: { result: { legacy: { screen_name: 'bob', name: 'Bob' } } } },
  legacy: {
    id_str: '2222222222222222222',
    full_text: 'A video post',
    created_at: 'Wed Oct 10 20:19:24 +0000 2018',
    extended_entities: {
      media: [{
        id_str: '222',
        type: 'video',
        media_url_https: 'https://pbs.twimg.com/media/COVER.jpg',
        original_info: { width: 720, height: 1280 },
        video_info: {
          duration_millis: 15000,
          variants: [
            { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/low.m3u8' },
            { content_type: 'video/mp4', bitrate: 832000, url: 'https://video.twimg.com/low.mp4' },
            { content_type: 'video/mp4', bitrate: 2176000, url: 'https://video.twimg.com/high.mp4' }
          ]
        }
      }]
    }
  }
};

const gif = {
  rest_id: '3333333333333333333',
  core: { user_results: { result: { legacy: { screen_name: 'cara' } } } },
  legacy: {
    id_str: '3333333333333333333',
    full_text: 'A gif',
    extended_entities: {
      media: [{
        id_str: '333',
        type: 'animated_gif',
        media_url_https: 'https://pbs.twimg.com/tweet_video_thumb/GIF.jpg',
        original_info: { width: 480, height: 480 },
        video_info: {
          variants: [{ content_type: 'video/mp4', url: 'https://video.twimg.com/tweet_video/GIF.mp4' }]
        }
      }]
    }
  }
};

const carousel = {
  rest_id: '4444444444444444444',
  core: { user_results: { result: { legacy: { screen_name: 'mix' } } } },
  legacy: {
    id_str: '4444444444444444444',
    full_text: 'Four photos',
    extended_entities: {
      media: Array.from({ length: 4 }, (_, index) => ({
        id_str: '444' + index,
        type: 'photo',
        media_url_https: 'https://pbs.twimg.com/media/slide-' + (index + 1) + '.jpg',
        original_info: { width: 1080, height: 1350 }
      }))
    }
  }
};

function collect(node) {
  return Model.collectFromJson(node, { posts: new Map(), stories: [], creators: [], seen: new WeakSet(), count: 0 });
}

const photoPost = Model.makePost(photo);
assert.equal(photoPost.shortcode, '1234567890123456789');
assert.equal(photoPost.kind, 'image');
assert.equal(photoPost.author.username, 'alice');
assert.equal(photoPost.media[0].type, 'image');
assert.match(photoPost.media[0].imageCandidates[0].url, /name=orig/);
assert.equal(photoPost.title, 'Hello from a photo');

const videoPost = Model.makePost(video);
const modernVideo = structuredClone(video);
modernVideo.core.user_results.result = {
  rest_id: '9', core: { screen_name: 'bob', name: 'Bob' },
  avatar: { image_url: 'https://pbs.twimg.com/profile_images/avatar.jpg' }
};
const modernPost = Model.makePost(modernVideo);
assert.equal(modernPost.author.username, 'bob');
assert.equal(modernPost.author.displayName, 'Bob');
assert.equal(modernPost.author.avatar, 'https://pbs.twimg.com/profile_images/avatar.jpg');
const modernBag = collect({ data: { tweet_results: { result: modernVideo } } });
assert.equal(Model.snapshotFromCollected(Model.routeFromUrl('https://x.com/bob/media'), modernBag).posts[0].media[0].videoCandidates[0].url, 'https://video.twimg.com/high.mp4');
assert.equal(videoPost.kind, 'video');
assert.equal(videoPost.media[0].videoCandidates[0].url, 'https://video.twimg.com/high.mp4');
assert.equal(videoPost.media[0].videoCandidates.some((item) => /\.m3u8/.test(item.url)), false);

const gifPost = Model.makePost(gif);
assert.equal(gifPost.kind, 'gif');
assert.equal(gifPost.media[0].type, 'gif');
assert.equal(gifPost.media[0].videoCandidates[0].url, 'https://video.twimg.com/tweet_video/GIF.mp4');

const carouselPost = Model.makePost(carousel);
assert.equal(carouselPost.kind, 'carousel');
assert.equal(carouselPost.media.length, 4);
assert.equal(carouselPost.media[3].index, 4);

const bag = collect({ data: { tweetResult: { result: photo } } });
assert.equal(bag.posts.get('1234567890123456789').author.username, 'alice');

assert.equal(Model.routeFromUrl('https://x.com/home').kind, 'feed');
assert.equal(Model.routeFromUrl('https://x.com/alice/status/1234567890123456789').kind, 'post');
assert.equal(Model.routeFromUrl('https://x.com/alice/status/1234567890123456789').shortcode, '1234567890123456789');
assert.equal(Model.routeFromUrl('https://x.com/i/web/status/1234567890123456789').kind, 'post');
assert.equal(Model.routeFromUrl('https://x.com/alice').kind, 'profile');
assert.equal(Model.routeFromUrl('https://x.com/alice/media').kind, 'profile');
assert.equal(Model.routeFromUrl('https://x.com/alice/videos').kind, 'profile');
assert.equal(Model.routeFromUrl('https://x.com/alice/likes').kind, 'profile');
assert.equal(Model.routeFromUrl('https://x.com/explore').kind, 'unsupported');
assert.equal(Model.snapshotFromCollected(Model.routeFromUrl('https://x.com/bob/status/99999'), bag).post, null);

// Exercise the actual page-agent snapshot path: profile responses must reach
// the content script with original-image and highest-quality video candidates.
const agentSource = readFileSync(new URL('../content/page-agent.js', import.meta.url), 'utf8');
const snapshotSource = agentSource.slice(agentSource.indexOf('  function buildSnapshot() {'), agentSource.indexOf('  function emit(force) {'));
const profileBag = collect({ data: { tweets: [photo, video, gif] } });
const snapshotContext = vm.createContext({
  Model, URL, profileCaptures: new Map([['/alice/media',new Set(profileBag.posts.keys())],['/bob/media',new Set(profileBag.posts.keys())]]), collected: profileBag, location: { href: 'https://x.com/alice/media' },
  scanScripts() {}, domPost() { throw new Error('Profile must use captured timeline data'); }
});
vm.runInContext(snapshotSource, snapshotContext);
const profileSnapshot = vm.runInContext('buildSnapshot()', snapshotContext);
assert.ok(profileSnapshot.posts.length > 0);
assert.ok(profileSnapshot.posts.some(post => post.media.some(media => media.imageCandidates.some(item => item.url.includes('name=orig')))));
assert.ok(profileSnapshot.posts.every(post => post.author.username === 'alice'));
snapshotContext.location.href = 'https://x.com/bob/media';
const videoSnapshot = vm.runInContext('buildSnapshot()', snapshotContext);
assert.equal(videoSnapshot.posts[0].media[0].videoCandidates[0].url, 'https://video.twimg.com/high.mp4');

const threadRoot = structuredClone(video);
threadRoot.legacy.conversation_id_str = threadRoot.rest_id;
const ownReply = structuredClone(threadRoot);
ownReply.rest_id = ownReply.legacy.id_str = '4444444444444444444';
const foreignReply = structuredClone(ownReply);
foreignReply.rest_id = foreignReply.legacy.id_str = '5555555555555555555';
foreignReply.core.user_results.result.legacy.screen_name = 'other';
const quoteReply = structuredClone(ownReply);
quoteReply.rest_id = quoteReply.legacy.id_str = '6666666666666666666';
delete quoteReply.legacy.extended_entities;
quoteReply.quoted_status_result = {result:photo};
const threadBag = collect({data:{tweets:[threadRoot,ownReply,foreignReply,quoteReply]}});
const threadSnapshot=Model.snapshotFromCollected(Model.routeFromUrl('https://x.com/bob/status/'+threadRoot.rest_id),threadBag);
assert.deepEqual(Array.from(threadSnapshot.threadPosts,post=>post.id),[threadRoot.rest_id,ownReply.rest_id]);

// The capture layer keeps Posts and Media categories separate even when the
// same user's data has already been captured elsewhere in the tab.
const ingestSource=agentSource.slice(agentSource.indexOf('  function ingest('),agentSource.indexOf('  function parseMaybeJson('));
const captureContext=vm.createContext({Model,URL,profileCaptures:new Map(),collected:{posts:new Map()},location:{href:'https://x.com/bob'}});
vm.runInContext(ingestSource,captureContext);
captureContext.ingest({data:{tweet:threadRoot}});
captureContext.location.href='https://x.com/bob/media';
captureContext.ingest({data:{tweets:[ownReply,foreignReply]}});
assert.ok(captureContext.profileCaptures.get('/bob').has(threadRoot.rest_id));
assert.ok(!captureContext.profileCaptures.get('/bob/media').has(threadRoot.rest_id));
assert.ok(captureContext.profileCaptures.get('/bob/media').has(ownReply.rest_id));
assert.ok(!captureContext.profileCaptures.get('/bob/media').has(foreignReply.rest_id));

console.log('twitter parse fixtures, quality pick, carousel order, filename index and routes passed');
