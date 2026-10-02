// Send the preference before the home timeline requests; do not modify page DOM.
(() => {
  const api = typeof browser !== 'undefined' ? browser : chrome;
  let current;
  const publish = (stored) => {
    current = stored;
    window.postMessage({ source: 'twitter-downloader-content', type: 'AD_SETTINGS', hideAds: stored?.['twitter-dl-settings-v1']?.hideAds !== false }, location.origin);
  };
  window.addEventListener('message', (event) => {
    if (event.source === window && event.origin === location.origin && event.data?.source === 'twitter-downloader-page-agent' && event.data.type === 'AD_SETTINGS_REQUEST' && current) publish(current);
  });
  if (typeof browser !== 'undefined') api.storage.local.get('twitter-dl-settings-v1').then(publish).catch(() => {});
  else api.storage.local.get('twitter-dl-settings-v1', publish);
  api.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes['twitter-dl-settings-v1']) publish({ 'twitter-dl-settings-v1': changes['twitter-dl-settings-v1'].newValue }); });
})();
