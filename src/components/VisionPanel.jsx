import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Eye, Loader2, Video, VideoOff } from 'lucide-react';
import { getBackendUrl } from '../utils/helpers';

// Must match the installed @mediapipe/tasks-vision version (JS + WASM stay in sync)
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// Face landmark indices (MediaPipe FaceMesh topology)
const LEFT_EYE = { outer: 33, inner: 133, top: 159, bottom: 145 };
const RIGHT_EYE = { outer: 362, inner: 263, top: 386, bottom: 374 };
const NOSE_TIP = 1;
const MOUTH_LEFT = 61, MOUTH_RIGHT = 291, MOUTH_TOP = 13, MOUTH_BOTTOM = 14;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// --- Face recognition (creator enrollment) ---
// Normalize 10 geometric face ratios (scale-invariant) and compare with cosine
// similarity, entirely on-device. Saved to localStorage — never leaves the browser.
const MATCH_THRESHOLD = 0.95;
const MATCH_STREAK = 3;
const CREATOR_KEY = 'jexi_creator_face';

const faceVector = (lms) => {
  const d = (i, j) => Math.hypot(lms[i].x - lms[j].x, lms[i].y - lms[j].y);
  const eyeLine = d(33, 263), faceH = d(10, 152), faceW = d(234, 454);
  const e = (a, b) => a / (b + 1e-6);
  return [
    e(eyeLine, faceH),
    e(faceW, faceH),
    e(d(1, 13), eyeLine),
    e(d(61, 291), eyeLine),
    e(d(13, 14), eyeLine),
    e(d(159, 145), d(33, 133)),
    e(d(386, 374), d(362, 263)),
    e(d(55, 159), eyeLine),
    e(d(285, 386), eyeLine),
    e(Math.abs(lms[168].y - lms[10].y), faceH),
  ];
};

const cosine = (a, b) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
};

function computeExpressions(lms) {
  const fw = dist(lms[234], lms[454]);
  const fh = dist(lms[10], lms[152]);
  const mw = dist(lms[MOUTH_LEFT], lms[MOUTH_RIGHT]);
  const mh = dist(lms[MOUTH_TOP], lms[MOUTH_BOTTOM]);
  const smile = mw / (mh + 0.0001) > 2.6;
  const mouthOpen = mh / (fh + 0.0001) > 0.045;
  const ear = (eye) => (dist(lms[eye.top], lms[eye.bottom]) * 2) / (dist(lms[eye.outer], lms[eye.inner]) + 0.0001);
  const eyesClosed = (ear(LEFT_EYE) + ear(RIGHT_EYE)) / 2 < 0.17;
  const cx = (lms[234].x + lms[454].x) / 2;
  const cy = (lms[10].y + lms[152].y) / 2;
  const dx = (lms[NOSE_TIP].x - cx) / (fw + 0.0001);
  const dy = (lms[NOSE_TIP].y - cy) / (fh + 0.0001);
  const tilt = Math.round(Math.atan2(lms[RIGHT_EYE.outer].y - lms[LEFT_EYE.outer].y, lms[RIGHT_EYE.outer].x - lms[LEFT_EYE.outer].x) * 180 / Math.PI);
  const looking = (Math.abs(dx) > 0.12 || Math.abs(dy) > 0.12)
    ? (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'))
    : 'center';
  return { smile, mouthOpen, eyesClosed, tilt, looking };
}

export default function VisionPanel({ open, onClose, onVision }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const landmarkerRef = useRef(null);
  const rafRef = useRef(null);
  const lastTickRef = useRef(0);
  const enrolledRef = useRef(null);
  const streakRef = useRef(0);

  const [camStatus, setCamStatus] = useState('starting'); // starting | on | error
  const [camError, setCamError] = useState('');
  const [mpStatus, setMpStatus] = useState('loading'); // loading | ready | error
  const [expressions, setExpressions] = useState(null);
  const [thinking, setThinking] = useState(false);
  const [visionText, setVisionText] = useState('');
  const [visionError, setVisionError] = useState('');
  const [enrolled, setEnrolled] = useState(null);
  const [matched, setMatched] = useState(false);
  const [similarity, setSimilarity] = useState(0);
  const [enrolling, setEnrolling] = useState(false);

  // Load the saved creator face (device-local, private)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CREATOR_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.vector)) {
          enrolledRef.current = parsed.vector;
          setEnrolled(parsed.vector);
        }
      }
    } catch {}
  }, []);

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      // 1) Camera
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setCamStatus('on');
      } catch (e) {
        if (!cancelled) { setCamStatus('error'); setCamError('Camera access denied or unavailable. Allow camera permission so JEXI can see you.'); }
        return;
      }

      // 2) On-device face engine (MediaPipe — free, instant, no API key)
      try {
        const { FilesetResolver, FaceLandmarker } = await import('@mediapipe/tasks-vision');
        const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
        let lm;
        try {
          lm = await FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' }, runningMode: 'VIDEO', numFaces: 1 });
        } catch {
          lm = await FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' }, runningMode: 'VIDEO', numFaces: 1 });
        }
        if (cancelled) { lm.close(); return; }
        landmarkerRef.current = lm;
        setMpStatus('ready');
      } catch (e) {
        if (!cancelled) { setMpStatus('error'); setVisionError('On-device face engine unavailable (' + e.message + ') — camera + JEXI vision still work.'); }
      }
    })();

    return () => { cancelled = true; stopCamera(); try { landmarkerRef.current?.close?.(); } catch {} landmarkerRef.current = null; };
  }, [open, stopCamera]);

  // Detection loop — reads expressions a few times per second while the face engine is up
  useEffect(() => {
    if (!open || mpStatus !== 'ready') return;
    let alive = true;
    const tick = (ts) => {
      if (!alive) return;
      if (ts - lastTickRef.current > 150) {
        lastTickRef.current = ts;
        try {
          const lm = landmarkerRef.current;
          const video = videoRef.current;
          if (lm && video && video.videoWidth > 0) {
            const res = lm.detectForVideo(video, ts);
            if (res.faceLandmarks && res.faceLandmarks.length > 0) {
              const lms = res.faceLandmarks[0];
              setExpressions(computeExpressions(lms));
              if (enrolledRef.current) {
                const sim = cosine(enrolledRef.current, faceVector(lms));
                streakRef.current = sim > MATCH_THRESHOLD ? streakRef.current + 1 : 0;
                const isMatch = streakRef.current >= MATCH_STREAK;
                setMatched(isMatch);
                setSimilarity(Math.round(sim * 1000) / 10);
              } else {
                setMatched(false);
              }
            } else {
              setExpressions(prev => prev ? { ...prev, faceLost: true } : { faceLost: true });
            }
          }
        } catch {}
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { alive = false; if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [open, mpStatus]);

  const captureFrame = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.7);
  };

  const enroll = async () => {
    if (enrolling) return;
    setEnrolling(true);
    setVisionError('');
    const samples = [];
    for (let i = 0; i < 4; i++) {
      try {
        const lm = landmarkerRef.current;
        const video = videoRef.current;
        if (lm && video && video.videoWidth > 0) {
          const res = lm.detectForVideo(video, performance.now());
          if (res.faceLandmarks && res.faceLandmarks.length > 0) samples.push(faceVector(res.faceLandmarks[0]));
        }
      } catch {}
      await new Promise(r => setTimeout(r, 400));
    }
    if (samples.length >= 3) {
      const avg = samples[0].map((_, i) => samples.reduce((s, v) => s + v[i], 0) / samples.length);
      enrolledRef.current = avg;
      setEnrolled(avg);
      setMatched(true);
      setSimilarity(100);
      localStorage.setItem(CREATOR_KEY, JSON.stringify({ vector: avg, at: new Date().toISOString() }));
    } else {
      setVisionError('Could not capture your face — make sure you are centered and well-lit in the camera.');
    }
    setEnrolling(false);
  };

  const clearCreator = () => {
    enrolledRef.current = null;
    setEnrolled(null);
    setMatched(false);
    setSimilarity(0);
    localStorage.removeItem(CREATOR_KEY);
  };

  const askVision = async () => {
    const img = captureFrame();
    if (!img) return;
    setThinking(true);
    setVisionError('');
    try {
      const who = matched
        ? 'I am Lewis Einstein, your creator (an AI & ML Engineer), looking at you through my camera. Recognize me, greet me by name as your creator, and describe how I look today.'
        : 'Look at me through my camera. Tell me what you see, who I am, and how I look right now.';
      const res = await fetch(`${getBackendUrl()}/api/vision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: img, prompt: who }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setVisionText(data.text);
      onVision(data.text);
    } catch (e) {
      setVisionError(e.message || 'Vision failed — is the backend reachable?');
    } finally {
      setThinking(false);
    }
  };

  if (!open) return null;

  const chips = expressions && !expressions.faceLost ? [
    expressions.smile && '😊 Smiling',
    expressions.mouthOpen && '😮 Mouth open',
    expressions.eyesClosed && '😴 Eyes closed',
    `🙂 Looking ${expressions.looking}`,
    `🙃 Tilt ${expressions.tilt}°`,
  ].filter(Boolean) : [];

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md glass rounded-2xl p-4 border border-[#00FF9D]/25">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-[#00FF9D]" />
            <h3 className="text-xs font-bold text-[#00FF9D] tracking-wider">JEXI'S EYES — CAMERA</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1"><X className="w-4 h-4" /></button>
        </div>

        <div className="relative rounded-xl overflow-hidden bg-black border border-[#1a1a1a] aspect-video flex items-center justify-center">
          {camStatus === 'on' ? (
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          ) : (
            <div className="text-center px-4">
              {camStatus === 'starting'
                ? <div className="flex items-center justify-center gap-2 text-gray-400 text-[10px]"><Loader2 className="w-4 h-4 animate-spin" /> Starting camera…</div>
                : <div className="text-red-400 text-[10px]">{camError}</div>}
            </div>
          )}
          {camStatus === 'on' && mpStatus === 'ready' && (
            <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-sm rounded-full px-2.5 py-1 border border-[#00FF9D]/30">
              <span className="text-[9px] font-bold text-[#00FF9D] flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#00FF9D] animate-pulse" /> FACE ENGINE LIVE
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5 mt-2 min-h-[24px]">
          {mpStatus === 'loading' && <span className="text-[9px] text-gray-500 animate-pulse">Loading face engine…</span>}
          {mpStatus === 'ready' && chips.length === 0 && !enrolled && <span className="text-[9px] text-gray-500">Look at the camera 👋</span>}
          {chips.map((c, i) => <span key={i} className="bg-[#00FF9D]/10 border border-[#00FF9D]/30 text-[#00FF9D] rounded-full px-2 py-0.5 text-[9px] font-bold">{c}</span>)}
          {enrolled && matched && <span className="bg-amber-400/15 border border-amber-400/40 text-amber-300 rounded-full px-2 py-0.5 text-[9px] font-bold">👑 Creator — Lewis{similarity > 0 && ` · ${similarity}%`}</span>}
          {enrolled && !matched && expressions && !expressions.faceLost && <span className="bg-gray-500/10 border border-gray-500/30 text-gray-300 rounded-full px-2 py-0.5 text-[9px] font-bold">🙂 New face{similarity > 0 && ` · ${similarity}%`}</span>}
          {mpStatus === 'error' && <span className="text-[9px] text-amber-400">Face engine off — camera + JEXI vision still work.</span>}
        </div>

        {!enrolled && camStatus === 'on' && mpStatus === 'ready' && (
          <button
            onClick={enroll}
            disabled={enrolling}
            className="mt-3 w-full bg-amber-400/15 border border-amber-400/40 text-amber-300 rounded-xl py-2.5 text-[11px] font-bold flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-amber-400/25 transition-colors"
          >
            {enrolling
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Capturing your face — keep looking at the camera…</>
              : <>👑 Teach JEXI your face (make me creator)</>}
          </button>
        )}
        {enrolled && (
          <div className="flex items-center justify-between mt-3">
            <span className="text-[9px] text-amber-300/80">👑 Creator face saved on this device</span>
            <button onClick={clearCreator} className="text-[9px] text-gray-500 hover:text-red-400 underline">Re-teach / Clear</button>
          </div>
        )}

        <button
          onClick={askVision}
          disabled={thinking || camStatus !== 'on'}
          className="mt-3 w-full bg-[#00FF9D] text-black rounded-xl py-2.5 text-[11px] font-bold flex items-center justify-center gap-2 disabled:opacity-40 hover:bg-[#00e68a] transition-colors"
        >
          {thinking ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> JEXI is looking…</> : <><Video className="w-3.5 h-3.5" /> 👁 What do you see?</>}
        </button>
        {visionError && <p className="mt-2 text-[9px] text-red-400">{visionError}</p>}
        {visionText && (
          <div className="mt-2 bg-[#0a0a0a] border border-[#1a1a1a] rounded-lg p-2.5 text-[10px] text-gray-200 max-h-28 overflow-y-auto whitespace-pre-wrap">
            {visionText}
          </div>
        )}

        <p className="mt-2 text-[8px] text-gray-600 leading-relaxed">
          Engine A: on-device face tracking (free, instant, runs in your browser). Engine B: JEXI's AI vision via
          Groq/Gemini when you tap "What do you see?" — her reply types itself into the chat.
        </p>
      </div>
    </div>
  );
}
