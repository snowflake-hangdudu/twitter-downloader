const EXT = typeof browser !== 'undefined' ? browser : chrome;
const VERSION = EXT.runtime.getManifest().version;
const CONFIG = globalThis.DOWNLOADER_POPUP_CONFIG || {};
const $ = (id) => document.getElementById(id);

const copy = {
  en: { title: 'X Downloader', statusTwitter: 'X download guide', statusOther: 'Open X first', heading: 'Download from X', leadTwitter: 'Download from the home timeline, tweet pages, or creator profiles.', leadOther: 'Download entries appear on X tweet pages, creator profiles, or beside timeline posts.', stepOpen: 'Browse the home timeline, or open a tweet, GIF, video, or profile', stepEntry: 'Click Download beside a timeline post, or the floating entry on a tweet page', stepDownload: 'Choose items in Current content or Creator, then download', note: 'Home timeline posts support individual downloads. Promoted posts are hidden by default; turn this off in Settings. Tweet pages and profiles have a persistent entry.', open: 'Open X', faq: 'FAQ', privacy: 'Privacy', help: 'Help links', steps: 'Download steps', disclaimer: 'For personal learning only. Follow X’s terms.' },
  'zh-CN': { title: 'Twitter/X视频下载助手', statusTwitter: 'X 下载步骤', statusOther: '请先打开 X', heading: '在 X 页面下载内容', leadTwitter: '首页时间线、推文详情和创作者主页均可下载。', leadOther: '下载入口会显示在 X 推文页、创作者主页或时间线推文旁。', stepOpen: '浏览首页时间线，或打开推文、GIF、视频、创作者主页', stepEntry: '首页点击推文旁“下载”；详情页点击悬浮入口', stepDownload: '在“当前内容”或“创作者”中选择并下载', note: '首页支持逐条下载。默认隐藏推广推，可在设置中关闭；详情页和创作者主页提供常驻入口。', open: '打开 X', faq: '常见问题', privacy: '隐私政策', help: '帮助链接', steps: '下载步骤', disclaimer: '仅供个人学习 · 请遵守 X 使用条款' }
};

function isTwitterUrl(value) {
    try { return /(^|\.)x\.com$|(^|\.)twitter\.com$/i.test(new URL(value).hostname); } catch (_) { return false; }
}
function setText(id, value) { const element = $(id); if (element) element.textContent = value; }

async function init() {
  const themeController = globalThis.DownloaderKit?.theme?.createController({ storageKey: CONFIG.themeKey, fallbackTheme: CONFIG.theme, initialTheme: CONFIG.initialTheme });
  themeController?.attach(document.body);
  try { await globalThis.DownloaderKit?.i18n?.ready; } catch (_) {}
  const language = globalThis.DownloaderKit?.i18n?.language?.() === 'zh-CN' ? 'zh-CN' : 'en';
  const text = copy[language];
  document.documentElement.lang = language;
  setText('app-title', text.title); setText('guide-title', text.heading); setText('step-open', text.stepOpen); setText('step-entry', text.stepEntry); setText('step-download', text.stepDownload); setText('detail-note', text.note); setText('btn-go-site', text.open); setText('disclaimer', text.disclaimer); setText('app-version', 'v' + VERSION);
  document.querySelector('.popup-footer-links')?.setAttribute('aria-label', text.help);
  document.querySelector('.popup-steps')?.setAttribute('aria-label', text.steps);
  const links = document.querySelectorAll('.popup-footer-link');
  if (links[0]) links[0].textContent = text.faq;
  if (links[1]) links[1].textContent = text.privacy;
  let tab;
  try { [tab] = await EXT.tabs.query({ active: true, currentWindow: true }); } catch (_) {}
  const onTwitter = isTwitterUrl(tab?.url);
  setText('page-status', onTwitter ? text.statusTwitter : text.statusOther);
  setText('guide-lead', onTwitter ? text.leadTwitter : text.leadOther);
  $('btn-go-site').hidden = onTwitter;
}
init();
