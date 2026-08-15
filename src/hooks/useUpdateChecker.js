import { useCallback, useEffect, useRef, useState } from 'react';
import { getBackendUrl } from '../utils/helpers';

const REPO = 'lewiseinstein15-Tech/jexi-os-';
const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;
export const APK_DOWNLOAD_URL = `https://github.com/${REPO}/releases/latest/download/app-debug.apk`;

// Only APK builds get a version baked in at build time by the CI workflow
// (VITE_APP_VERSION=apk-build-<run number>). Web builds are always served from
// the newest deploy, so they never run update checks or show banners.
const INSTALLED_TAG = (import.meta.env.VITE_APP_VERSION || '').trim();
const ENABLED = Boolean(INSTALLED_TAG);

const buildNumber = (tag) => {
  const m = String(tag || '').match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
};

const formatDate = (iso) => {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
};

/**
 * Auto-update checker for the Android APK.
 *
 * Compares the installed build (baked in at build time) against the newest
 * GitHub Release. Re-checks automatically: on app open, whenever the app gains
 * focus again, and every 10 minutes — so a new build published while the app
 * is closed is noticed the moment it is opened.
 */
export default function useUpdateChecker() {
  const [checking, setChecking] = useState(ENABLED);
  const [latest, setLatest] = useState(null);
  const [error, setError] = useState(null);
  const [dismissed, setDismissed] = useState(() =>
    typeof localStorage !== 'undefined' ? localStorage.getItem('jexi_dismissed_update') || '' : ''
  );
  const latestTagRef = useRef('');

  /** Apply a release payload (from GitHub API or the backend probe). */
  const applyRelease = useCallback((data) => {
    const tag = String((data && data.tag_name) || (data && data.tag) || '');
    if (!tag) return false;
    latestTagRef.current = tag;
    setLatest({
      tag,
      number: buildNumber(tag),
      date: formatDate(data.published_at || data.date),
      notes: data.name || data.notes || '',
    });
    setError(null);
    return true;
  }, []);

  const checkNow = useCallback(async () => {
    if (!ENABLED) {
      setChecking(false);
      return;
    }
    try {
      // 1. GitHub's own API first (no backend needed).
      const res = await fetch(`${LATEST_API}?t=${Date.now()}`, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      if (!applyRelease(await res.json())) throw new Error('GitHub API returned no release tag');
    } catch (e) {
      // 2. B70 fallback — the backend's version probe (server-side GitHub
      // fetch with a proper User-Agent, so the phone's IP rate-limit on
      // api.github.com never hides a new build). Open path, works even when
      // the backend is locked with JEXI_API_KEY.
      try {
        const backend = getBackendUrl();
        if (backend) {
          const res = await fetch(`${backend}/api/update/version`, { cache: 'no-store' });
          if (res.ok) {
            const data = await res.json();
            if (applyRelease(data)) { setChecking(false); return; }
          }
        }
      } catch (e2) { /* fall through to the honest error */ }
      setError(e.message);
    } finally {
      setChecking(false);
    }
  }, [applyRelease]);

  useEffect(() => {
    if (!ENABLED) return;
    checkNow();
    const interval = setInterval(checkNow, 10 * 60 * 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') checkNow();
    };
    const onFocus = () => checkNow();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [checkNow]);

  const installedNumber = buildNumber(INSTALLED_TAG);
  const updateAvailable = ENABLED && latest !== null && installedNumber > 0 && latest.number > installedNumber;

  const dismiss = useCallback(() => {
    const tag = latestTagRef.current || 'yes';
    setDismissed(tag);
    try {
      localStorage.setItem('jexi_dismissed_update', tag);
    } catch {
      /* storage unavailable */
    }
  }, []);

  return {
    enabled: ENABLED,
    installedTag: INSTALLED_TAG,
    installedNumber,
    latest,
    updateAvailable,
    checking,
    error,
    dismissed,
    checkNow,
    dismiss,
  };
}
