export const getDomain = (url) => {
  try { return new URL(url).hostname.replace('www.', ''); } catch (e) { return 'unknown'; }
};
export const getFavicon = (url) => {
  try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`; } catch (e) { return ''; }
};
export const delay = (ms) => new Promise(r => setTimeout(r, ms));
