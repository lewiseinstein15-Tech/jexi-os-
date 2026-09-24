import { useCallback, useEffect, useState } from 'react';
import { checkForUpdate, downloadAndInstall, APK_URL, isNativeAndroid } from '../utils/updateCenter';

/**
 * B179 — the update banner, rebuilt minimal. One check on boot, one tap to
 * install, a browser fallback link on ANY failure. It can never block chat:
 * it renders nothing until an update is actually confirmed.
 */
export default function UpdateBanner() {
  const [info, setInfo] = useState(null);
  const [phase, setPhase] = useState('idle'); // idle | working | done | error
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    checkForUpdate().then((r) => { if (alive && r && r.available) setInfo(r); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const install = useCallback(async () => {
    setPhase('working'); setProgress(0); setError('');
    const r = await downloadAndInstall(setProgress);
    if (r.ok) setPhase('done');
    else { setPhase('error'); setError(r.error || 'update failed'); }
  }, []);

  if (!info || !isNativeAndroid()) return null;
  const busy = phase === 'working';

  return (
    <div className="jx-updbar">
      <div className="jx-upd-row">
        <span className="jx-upd-ic">⬆️</span>
        <div className="jx-upd-txt">
          <b>Update ready — {info.tag}</b>
          <span>{phase === 'done' ? 'Tap INSTALL in the system dialog.' : busy ? `Downloading… ${progress < 0 ? '' : Math.max(0, progress)}%` : 'Your chats and settings stay.'}</span>
        </div>
        {busy ? (
          <span className="jx-upd-spin" />
        ) : phase === 'error' ? (
          <a className="jx-upd-btn" href={APK_URL} target="_blank" rel="noreferrer">Browser</a>
        ) : (
          <button type="button" className="jx-upd-btn" onClick={install}>
            {phase === 'done' ? 'Installed?' : 'Update'}
          </button>
        )}
      </div>
      {phase === 'error' && (
        <div className="jx-upd-err">
          {error} — download in your browser instead:
          {' '}
          <a href={APK_URL} target="_blank" rel="noreferrer">get the APK</a>
        </div>
      )}
      {busy && <div className="jx-upd-prog"><i style={{ width: `${Math.max(4, progress)}%` }} /></div>}
    </div>
  );
}
