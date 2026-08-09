import { useCallback, useState } from 'react';
import { installAndroidUpdate, isNativeAndroid } from '../utils/updateInstaller';

/**
 * Drives the in-app APK update flow.
 *
 * phase:
 *   idle         — nothing happening
 *   downloading  — streaming the APK (progress 0–99, or -1 if size unknown)
 *   installing   — writing to storage / opening the package installer
 *   done         — installer launched (user just taps INSTALL in the system dialog)
 *   error        — something failed (see `error`)
 */
export default function useApkInstaller() {
  const [phase, setPhase] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);
  const isAndroid = isNativeAndroid();

  const start = useCallback(async () => {
    setError(null);
    setPhase('downloading');
    setProgress(0);
    try {
      await installAndroidUpdate({
        onProgress: (p) => {
          if (p === 100) setPhase('installing');
          setProgress(p);
        },
      });
      setPhase('done');
    } catch (e) {
      setPhase('error');
      setError((e && e.message) || 'Update failed. Try again in a minute.');
    }
  }, []);

  const reset = useCallback(() => {
    setPhase('idle');
    setProgress(0);
    setError(null);
  }, []);

  const busy = phase === 'downloading' || phase === 'installing';

  return { isAndroid, phase, progress, error, busy, start, reset };
}
