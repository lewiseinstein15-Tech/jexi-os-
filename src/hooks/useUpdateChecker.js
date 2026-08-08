import { useCallback, useEffect, useRef, useState } from 'react';

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

  const checkNow = useCallback(async () => {
    if (!ENABLED) {
      setChecking(false);
      return;
    }
    try {
      const res = await fetch(`${LATEST_API}?t=${Date.now()}`, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) throw new Error(`GitHub API ${res.status}`);
      const data = await res.json();
      const tag = data.tag_name || '';
      latestTagRef.current = tag;
      setLatest({
        tag,
        number: buildNumber(tag),
        date: formatDate(data.published_at),
        notes: data.name || '',
      });
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setChecking(false);
    }
  }, []);

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
