function t(key, values) {
  return globalThis.DownloaderKit?.i18n?.t?.(key, values) || key;
}

window.DOWNLOADER_POPUP_CONFIG = {
  title: 'X Downloader',
  theme: 'twitter',
  initialTheme: 'default',
  themeKey: 'twitter-dl-theme-v1',
  getInfoType: 'TWITTER_DL_GET_INFO',
  openPanelType: 'TWITTER_DL_OPEN_PANEL',
  faqUrl: 'https://snowflake-hangdudu.github.io/twitter-downloader/faq.html',
  privacyUrl: 'https://snowflake-hangdudu.github.io/twitter-downloader/',
  isSiteUrl(value) {
    try { return /(^|\.)x\.com$|(^|\.)twitter\.com$/i.test(new URL(value).hostname); }
    catch (_) { return false; }
  },
  isContentUrl(value) {
    try {
      const path = new URL(value).pathname.replace(/\/+$/, '') || '/';
      if (/\/status(?:es)?\/\d+/i.test(path) || /^\/home$/i.test(path)) return true;
      return /^\/[A-Za-z0-9._]+(?:\/(?:media|videos|likes|with_replies|highlights|articles))?$/i.test(path);
    } catch (_) { return false; }
  },
  renderReady(info, elements) {
    elements.title.textContent = info.title || 'X';
    const authorName = String(info.author || '').replace(/^@/, '').trim();
    elements.author.textContent = authorName;
    elements.author.dataset.prefix = authorName ? t('authorLabel') + ' · ' : '';
    elements.author.classList.toggle('hidden', !authorName);
    elements.sub.textContent = info.sub || (info.mediaCount ? t('mediaCount', { count: info.mediaCount }) : '');
    if (info.cover && /^https:\/\//i.test(info.cover)) {
      elements.cover.src = info.cover;
      elements.cover.referrerPolicy = 'no-referrer';
      elements.cover.onload = () => {
        elements.cover.classList.remove('hidden');
        elements.coverPh.classList.add('hidden');
      };
      elements.cover.onerror = () => {
        elements.cover.classList.add('hidden');
        elements.coverPh.classList.remove('hidden');
      };
    } else {
      elements.cover.classList.add('hidden');
      elements.coverPh.classList.remove('hidden');
    }
    const tags = elements.qualities;
    if (tags) {
      tags.replaceChildren();
      const labels = Array.isArray(info.qualities) && info.qualities.length ? info.qualities : [];
      if (labels.length) {
        labels.forEach((label, index) => {
          const tag = document.createElement('span');
          tag.className = 'popup-q-tag' + (index === 0 ? ' best' : '');
          tag.textContent = label;
          tags.appendChild(tag);
        });
      } else {
        const tag = document.createElement('span');
        tag.className = 'popup-q-tag';
        tag.textContent = info.mode === 'creator' ? t('profileBatch') : (info.sub || t('currentContent'));
        tags.appendChild(tag);
      }
    }
    const open = document.getElementById('btn-open-panel');
    if (open) open.disabled = false;
  },
  readyTips: [
    'Nothing downloads until you start it',
    'Use the page panel for carousel selection, queue, history, and theme'
  ],
  empty: {
    homeUrl: 'https://x.com/',
    homeLabel: 'Open X'
  },
  error: {}
};
