import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const context = vm.createContext({ URL, console });
vm.runInContext(readFileSync(new URL('../content/twitter-model.js', import.meta.url), 'utf8'), context);
const filter = context.TwitterDownloaderModel.filterTimelineAds;

const normal = { entryId: 'tweet-123', content: { itemContent: { tweet_results: { result: { rest_id: '123' } } } } };
const promoted = { entryId: 'promoted-tweet-999', content: { itemContent: { promotedMetadata: { advertiser_name: 'Brand' } } } };
const payload = {
  data: {
    home: {
      home_timeline_urt: {
        instructions: [{ type: 'TimelineAddEntries', entries: [normal, promoted, { entryId: 'who-to-follow-1' }] }]
      }
    }
  }
};

assert.equal(filter(payload), 2);
assert.equal(payload.data.home.home_timeline_urt.instructions[0].entries[0], normal);
assert.equal(payload.data.home.home_timeline_urt.instructions[0].entries.some((item) => item.entryId.startsWith('promoted-')), false);
assert.equal(payload.data.home.home_timeline_urt.instructions[0].entries.some((item) => /who-to-follow/i.test(item.entryId)), false);
assert.equal(filter(payload), 0);

const detail = { data: { tweetResult: { result: { rest_id: '123', legacy: { full_text: 'Promoted mention in an ordinary tweet' } } } } };
assert.equal(filter(detail), 0, 'tweet detail must remain unchanged');

console.log('timeline ad filtering, normal posts and detail isolation passed');
