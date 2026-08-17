import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Eye, Loader2, Video, VideoOff, Hand, VolumeX } from 'lucide-react';
import { getBackendUrl, jexiFetch } from '../utils/helpers';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { isNativePlatform } from '../utils/phoneNotify';

// Must match the installed @mediapipe/tasks-vision version (JS + WASM stay in sync)
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
const FACE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const HAND_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';

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

// --- SCENE GATE: dHash (perceptual difference hash) ---
// Downscale the frame to 8x8 grayscale, hash adjacent-pixel brightness
// relations into a 56-bit fingerprint. A Hamming distance above the threshold
// means the scene meaningfully changed → that is when JEXI may narrate.
const HASH_N = 8;
const SCENE_CHANGE_BITS = 12;

const grayFrame = (video) => {
  const canvas = document.createElement('canvas');
  canvas.width = HASH_N;
  canvas.height = HASH_N;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, HASH_N, HASH_N);
  const { data } = ctx.getImageData(0, 0, HASH_N, HASH_N);
  const gray = new Uint8Array(HASH_N * HASH_N);
  for (let i = 0; i < HASH_N * HASH_N; i++) {
    gray[i] = (data[i * 4] * 299 + data[i * 4 + 1] * 587 + data[i * 4 + 2] * 114) / 1000;
  }
  return gray;
};

const dHashOf = (gray) => {
  // 56-bit fingerprint as two 32-bit halves (hi/lo) — Number arithmetic,
  // no BigInt literals (BigInt needs Chrome 67+ to even PARSE the bundle,
  // which blank-screens the app on older Android WebViews).
  let hi = 0;
  let lo = 0;
  let bits = 0;
  for (let y = 0; y < HASH_N; y++) {
    for (let x = 0; x < HASH_N - 1; x++) {
      const bit = gray[y * HASH_N + x] > gray[y * HASH_N + x + 1] ? 1 : 0;
      if (bits < 32) lo = (lo << 1) | bit;
      else hi = (hi << 1) | bit;
      bits++;
    }
  }
  return { hi, lo };
};

const hamming = (a, b) => {
  // Popcount of the XOR of both 32-bit halves.
  const popcount = (n) => {
    n = n - ((n >> 1) & 0x55555555);
    n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
    return (((n + (n >> 4)) & 0x0f0f0f0f) * 0x01010101) >> 24;
  };
  return popcount(a.hi ^ b.hi) + popcount(a.lo ^ b.lo);
};

// --- GESTURES (MediaPipe GestureRecognizer categories) ---
const GESTURE_META = {
  Thumb_Up: { emoji: '👍', label: 'THUMBS UP', quiet: false },
  Open_Palm: { emoji: '✋', label: 'OPEN PALM', quiet: true },
  Pointing_Up: { emoji: '👆', label: 'POINTING', quiet: false },
  Victory: { emoji: '✌️', label: 'PEACE', quiet: false },
  Closed_Fist: { emoji: '✊', label: 'FIST BUMP', quiet: false },
  ILoveYou: { emoji: '🤟', label: 'LOVE', quiet: false },
};
const GESTURE_MIN_SCORE = 0.6;
const GESTURE_GAP_MS = 4000; // min gap between two gesture narrations
const WAVE_REVERSALS = 3;     // direction reversals in 1.5s = wave
const WAVE_WINDOW_MS = 1500;

// Scene/face event narration gaps (anti-spam — research: event-gated, never timers)
const SCENE_GAP_MS = 8000;
const QUIET_MS = 45000; // open palm → silence for 45s

export default function VisionPanel({ open, onClose, onVision }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const landmarkerRef = useRef(null);
  const gestureRef = useRef(null);
  const rafRef = useRef(null);
  const lastTickRef = useRef(0);
  const enrolledRef = useRef(null);
  const streakRef = useRef(0);
  const narrateBusyRef = useRef(false);
  const lastNarrationRef = useRef(0);
  const lastGestureRef = useRef('');
  const lastGestureAtRef = useRef(0);
  const quietUntilRef = useRef(0);
  const sceneHashRef = useRef(null);
  const facePresentRef = useRef(false);
  const waveTraceRef = useRef([]); // [{ x, t }] — wrist trajectory for wave detection
  const [lastGesture, setLastGesture] = useState(null); // { emoji, label }
  const [sceneChanged, setSceneChanged] = useState(false);
  const [quietLeft, setQuietLeft] = useState(0);

  const [camStatus, setCamStatus] = useState('starting'); // starting | on | error
  const [camError, setCamError] = useState('');
  const [photoImage, setPhotoImage] = useState(null);   // native-camera fallback photo
  const [photoBusy, setPhotoBusy] = useState(false);
  const [retryKey, setRetryKey] = useState(0);          // re-run the camera effect
  const photoInputRef = useRef(null);
  const [mpStatus, setMpStatus] = useState('loading'); // loading | ready | error
  const [handStatus, setHandStatus] = useState('idle'); // idle | loading | ready | error
  const [expressions, setExpressions] = useState(null);
  const [thinking, setThinking] = useState(false);
  const [visionText, setVisionText] = useState('');
  const [visionError, setVisionError] = useState('');
  const [enrolled, setEnrolled] = useState(null);
  const [matched, setMatched] = useState(false);
  const [similarity, setSimilarity] = useState(0);
  const [enrolling, setEnrolling] = useState(false);
  const [continuous, setContinuous] = useState(false);
  const [continuousNote, setContinuousNote] = useState('');

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

  // Quiet-mode countdown ticker (just for the UI chip)
  useEffect(() => {
    if (!open) return;
    const iv = setInterval(() => {
      setQuietLeft(Math.max(0, Math.ceil((quietUntilRef.current - Date.now()) / 1000)));
    }, 1000);
    return () => clearInterval(iv);
  }, [open]);

  // Keep the latest onVision in a ref so the eyes loop never restarts when the
  // parent re-renders (each narration appends a chat message → new callback).
  const onVisionRef = useRef(onVision);
  useEffect(() => { onVisionRef.current = onVision; }, [onVision]);

  // "SCENE CHANGED" chip is a flash — clear it shortly after it fires.
  useEffect(() => {
    if (!sceneChanged) return;
    const t = setTimeout(() => setSceneChanged(false), 2500);
    return () => clearTimeout(t);
  }, [sceneChanged]);

  // Stop live narration whenever the panel closes
  useEffect(() => {
    if (!open) {
      setContinuous(false);
      setContinuousNote('');
      setLastGesture(null);
    }
  }, [open]);

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
  }, []);

  // Camera + on-device engines (face + hands), loaded lazily in parallel
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
        if (!cancelled) {
          setCamStatus('error');
          setCamError('Camera access denied or unavailable (' + String((e && e.name) || e) + '). Allow camera permission, or use "Take photo".');
        }
        return;
      }

      // 2) On-device face engine (MediaPipe — free, instant, no API key)
      try {
        const { FilesetResolver, FaceLandmarker } = await import('@mediapipe/tasks-vision');
        const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
        let lm;
        try {
          lm = await FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: 'GPU' }, runningMode: 'VIDEO', numFaces: 1 });
        } catch {
          lm = await FaceLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: 'CPU' }, runningMode: 'VIDEO', numFaces: 1 });
        }
        if (cancelled) { lm.close(); return; }
        landmarkerRef.current = lm;
        setMpStatus('ready');
      } catch (e) {
        if (!cancelled) { setMpStatus('error'); setVisionError('On-device face engine unavailable (' + e.message + ') — camera + JEXI vision still work.'); }
      }

      // 3) Hands engine (gestures + wave) — degrades gracefully if unavailable
      setHandStatus('loading');
      try {
        const { FilesetResolver, GestureRecognizer } = await import('@mediapipe/tasks-vision');
        const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
        let gr;
        try {
          gr = await GestureRecognizer.createFromOptions(fileset, { baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: 'GPU' }, runningMode: 'VIDEO', numHands: 1 });
        } catch {
          gr = await GestureRecognizer.createFromOptions(fileset, { baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate: 'CPU' }, runningMode: 'VIDEO', numHands: 1 });
        }
        if (cancelled) { gr.close(); return; }
        gestureRef.current = gr;
        setHandStatus('ready');
      } catch (e) {
        if (!cancelled) { setHandStatus('error'); }
      }
    })();

    return () => {
      cancelled = true;
      stopCamera();
      try { landmarkerRef.current?.close?.(); } catch {}
      try { gestureRef.current?.close?.(); } catch {}
      landmarkerRef.current = null;
      gestureRef.current = null;
    };
  }, [open, stopCamera, retryKey]);

  const captureFrame = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    return canvas.toDataURL('image/jpeg', 0.7);
  };

  // Shared helper: send the current frame + event context to JEXI's AI vision
  const captureAndAsk = useCallback(async (prompt) => {
    const img = captureFrame();
    if (!img) throw new Error('No camera frame available.');
    const res = await jexiFetch(`${getBackendUrl()}/api/vision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: img, prompt }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    return data.text;
  }, []);

  // B94 — NATIVE-CAMERA FALLBACK: when getUserMedia is blocked, take a photo
  // with the phone's real camera app (or a file picker on web) and send it
  // to JEXI's vision — the camera ALWAYS works.
  const takePhoto = async () => {
    setPhotoBusy(true);
    setVisionError('');
    try {
      if (isNativePlatform()) {
        const photo = await Camera.getPhoto({ resultType: CameraResultType.DataUrl, source: CameraSource.Camera, quality: 70, width: 1280 });
        setPhotoImage(photo.dataUrl || null);
      } else {
        photoInputRef.current?.click(); // web: file picker
      }
    } catch (e) {
      setVisionError('Could not open the camera: ' + String((e && e.message) || e));
    } finally {
      setPhotoBusy(false);
    }
  };

  const handlePhotoPick = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhotoImage(reader.result);
    reader.readAsDataURL(file);
  };

  const analyzePhoto = async (prompt) => {
    if (!photoImage) return;
    setVisionError('');
    setBusy(true);
    try {
      const res = await jexiFetch(`${getBackendUrl()}/api/vision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: photoImage, prompt: prompt || 'Describe what you see in this photo.' }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setVisionResult(data.text);
    } catch (e) {
      setVisionError('Vision failed: ' + String((e && e.message) || e));
    } finally {
      setBusy(false);
    }
  };

  const creatorPrompt = (short, context) => (short
    ? 'You are looking at your creator, Lewis Einstein (an AI & ML Engineer), through my camera. Briefly narrate right now what you see: how I look today, my expression, my surroundings. 1-2 sentences.'
    : 'I am Lewis Einstein, your creator (an AI & ML Engineer), looking at you through my camera. Recognize me, greet me by name as your creator, and describe how I look today.'
  ) + (context ? `\n\nWHAT JUST HAPPENED: ${context}` : '');
  const strangerPrompt = (short, context) => (short
    ? 'Look at me through my camera. Briefly narrate right now what you see: who is in frame, expression, surroundings. 1-2 sentences.'
    : 'Look at me through my camera. Tell me what you see, who I am, and how I look right now.'
  ) + (context ? `\n\nWHAT JUST HAPPENED: ${context}` : '');

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
    setThinking(true);
    setVisionError('');
    try {
      // B94 — if live camera is unavailable but a photo was taken, analyze it.
      let text;
      if (camStatus !== 'on' && photoImage) {
        const res = await jexiFetch(`${getBackendUrl()}/api/vision`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: photoImage, prompt: strangerPrompt(false) }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
        text = data.text;
      } else {
        text = await captureAndAsk(matched ? creatorPrompt(false) : strangerPrompt(false));
      }
      setVisionText(text);
      onVision(text);
    } catch (e) {
      setVisionError(e.message || 'Vision failed — is the backend reachable?');
    } finally {
      setThinking(false);
    }
  };

  // ===== THE EYES LOOP: faces + hands + scene gate + event-driven narration =====
  // Reads landmarks a few times per second. Narration fires ONLY on an event
  // (gesture, scene change, face appears/disappears) past its min-gap — never
  // on a blind timer (pattern from LiveKit vision demos + pHash scene gating).
  useEffect(() => {
    if (!open) return;
    if (mpStatus !== 'ready' && handStatus === 'idle') return;
    let alive = true;
    const video = () => videoRef.current;
    const now = () => performance.now();
    const sceneReady = mpStatus === 'ready';

    // Fire a narration for an event. Respects quiet mode + per-event gaps.
    const tryNarrate = async (context, minGap) => {
      if (!alive) return;
      const t = Date.now();
      if (t < quietUntilRef.current) return;
      if (t - lastNarrationRef.current < minGap) return;
      if (narrateBusyRef.current) return;
      lastNarrationRef.current = t;
      narrateBusyRef.current = true;
      setVisionError('');
      try {
        const isCreator = streakRef.current >= MATCH_STREAK;
        const text = await captureAndAsk(isCreator ? creatorPrompt(true, context) : strangerPrompt(true, context));
        if (!alive) return;
        setVisionText(text);
        onVisionRef.current?.(text);
        setContinuousNote(`Narrated ${new Date().toLocaleTimeString()} — ${context}`);
      } catch (e) {
        if (alive) setVisionError(e.message || 'Vision failed — is the backend reachable?');
      } finally {
        narrateBusyRef.current = false;
      }
    };

    // Wave detection: count wrist direction reversals in a sliding window
    const isWave = (x) => {
      const trace = waveTraceRef.current;
      const t = now();
      trace.push({ x, t });
      while (trace.length && t - trace[0].t > WAVE_WINDOW_MS) trace.shift();
      if (trace.length < 8) return false;
      let dir = 0, reversals = 0;
      for (let i = 1; i < trace.length; i++) {
        const d = trace[i].x - trace[i - 1].x;
        if (Math.abs(d) < 0.004) continue;
        const nd = d > 0 ? 1 : -1;
        if (dir !== 0 && nd !== dir) reversals++;
        dir = nd;
      }
      return reversals >= WAVE_REVERSALS;
    };

    const tick = (ts) => {
      if (!alive) return;
      if (ts - lastTickRef.current > 150) {
        lastTickRef.current = ts;
        try {
          const v = video();

          // --- FACE: expressions + creator match (unchanged behavior) ---
          if (mpStatus === 'ready' && landmarkerRef.current && v && v.videoWidth > 0) {
            const res = landmarkerRef.current.detectForVideo(v, ts);
            const lms = res.faceLandmarks && res.faceLandmarks.length > 0 ? res.faceLandmarks[0] : null;
            const facePresent = Boolean(lms);
            if (lms) {
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
              streakRef.current = 0;
            }
            // Face appeared / disappeared → a scene event worth narrating
            if (continuous && facePresent !== facePresentRef.current && facePresentRef.current !== false) {
              tryNarrate(facePresent ? 'Your face just appeared in front of the camera.' : 'You just left the camera frame.', SCENE_GAP_MS);
            }
            facePresentRef.current = facePresent;
          }

          // --- HANDS: gestures + wave ---
          if (handStatus === 'ready' && gestureRef.current && v && v.videoWidth > 0) {
            const res = gestureRef.current.recognizeForVideo(v, ts);
            const g = res.gestures && res.gestures[0] && res.gestures[0][0];
            const lms = res.landmarks && res.landmarks[0];
            if (g && g.categoryName !== 'None' && g.score >= GESTURE_MIN_SCORE) {
              const meta = GESTURE_META[g.categoryName];
              if (meta) {
                const t = Date.now();
                const fresh = g.categoryName !== lastGestureRef.current || t - lastGestureAtRef.current >= GESTURE_GAP_MS;
                if (fresh) {
                  lastGestureRef.current = g.categoryName;
                  lastGestureAtRef.current = t;
                  setLastGesture(meta);
                  if (continuous) {
                    if (meta.quiet) {
                      // Open palm = quiet mode — a real pause, not just a note
                      quietUntilRef.current = t + QUIET_MS;
                      setQuietLeft(Math.ceil(QUIET_MS / 1000));
                      tryNarrate('You just showed an open palm — the universal “stop”. Acknowledge it and let them know you will go quiet for a bit.', 2000);
                    } else {
                      const context = {
                        Thumb_Up: 'You just gave a thumbs up — a clear approval. Acknowledge it warmly and briefly.',
                        Pointing_Up: 'You just pointed up — as if drawing attention to something. Respond to the gesture.',
                        Victory: 'You just flashed a peace sign. Play along warmly.',
                        Closed_Fist: 'You just made a fist — bump it back with energy.',
                        ILoveYou: 'You just signed “I love you” with your hand. Say it back.',
                      }[g.categoryName];
                      tryNarrate(context, GESTURE_GAP_MS);
                    }
                  }
                }
              }
            } else if (lms && continuous) {
              // Dynamic WAVE from the wrist trajectory (static model can't catch it)
              if (isWave(lms[0].x)) {
                const t = Date.now();
                if (t - lastGestureAtRef.current >= GESTURE_GAP_MS) {
                  lastGestureRef.current = '__wave';
                  lastGestureAtRef.current = t;
                  setLastGesture({ emoji: '👋', label: 'WAVE' });
                  tryNarrate('You just waved at me. Greet them back like an old friend.', GESTURE_GAP_MS);
                }
              }
            } else if (!continuous) {
              waveTraceRef.current = [];
            }
          }

          // --- SCENE GATE: dHash of the frame; narrate only on real change ---
          if (sceneReady && v && v.videoWidth > 0 && continuous) {
            const hash = dHashOf(grayFrame(v));
            if (sceneHashRef.current) {
              const bits = hamming(sceneHashRef.current, hash);
              if (bits >= SCENE_CHANGE_BITS) {
                setSceneChanged(true);
                tryNarrate(`The scene changed significantly (${bits} bits of the frame differ) — the surroundings, light, or what is in front of the camera are different now. Narrate what you now see.`, SCENE_GAP_MS);
              }
            }
            sceneHashRef.current = hash;
          }
        } catch (e) { /* a bad frame must never kill the eyes */ }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { alive = false; if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [open, continuous, mpStatus, handStatus, captureAndAsk]);

  if (!open) return null;

  const chips = expressions && !expressions.faceLost ? [
    expressions.smile && '😊 Smiling',
    expressions.mouthOpen && '😮 Mouth open',
    expressions.eyesClosed && '😴 Eyes closed',
    `🙂 Looking ${expressions.looking}`,
    `🙃 Tilt ${expressions.tilt}°`,
  ].filter(Boolean) : [];

  const quietOn = quietUntilRef.current > Date.now();

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md glass rounded-2xl p-4 border border-[#00FF9D]/25 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Eye className="w-4 h-4 text-[#00FF9D]" />
            <h3 className="text-xs font-bold text-[#00FF9D] tracking-wider">JEXI'S EYES — CAMERA</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1"><X className="w-4 h-4" /></button>
        </div>

        <div className="relative rounded-xl overflow-hidden bg-black border border-[#1a1a1a] aspect-video flex items-center justify-center">
          {photoImage ? (
            <img src={photoImage} alt="captured" className="w-full h-full object-cover" />
          ) : camStatus === 'on' ? (
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          ) : (
            <div className="text-center px-4 py-6">
              {camStatus === 'starting' ? (
                <div className="flex items-center justify-center gap-2 text-gray-400 text-[10px]"><Loader2 className="w-4 h-4 animate-spin" /> Starting camera…</div>
              ) : (
                <>
                  <div className="text-red-400 text-[10px] mb-2">{camError}</div>
                  <div className="flex gap-2 justify-center">
                    <button type="button" onClick={() => setRetryKey((k) => k + 1)} className="px-3 py-1.5 rounded-lg border border-[#00FF9D]/40 text-[#00FF9D] text-[9px] font-bold hover:bg-[#00FF9D]/10">↻ RETRY CAMERA</button>
                    <button type="button" onClick={takePhoto} disabled={photoBusy} className="px-3 py-1.5 rounded-lg bg-[#00FF9D] text-black text-[9px] font-bold disabled:opacity-50 flex items-center gap-1">
                      {photoBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : '📷'} TAKE PHOTO
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {camStatus === 'on' && mpStatus === 'ready' && (
            <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-sm rounded-full px-2.5 py-1 border border-[#00FF9D]/30">
              <span className="text-[9px] font-bold text-[#00FF9D] flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#00FF9D] animate-pulse" /> FACE ENGINE LIVE
              </span>
            </div>
          )}
          {camStatus === 'on' && handStatus === 'ready' && (
            <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm rounded-full px-2.5 py-1 border border-[#00d4ff]/40">
              <span className="text-[9px] font-bold text-[#00d4ff] flex items-center gap-1.5">
                <Hand className="w-3 h-3" /> GESTURES LIVE
              </span>
            </div>
          )}
          {camStatus === 'on' && continuous && (
            <div className={`absolute bottom-2 left-2 rounded-full px-2.5 py-1 border backdrop-blur-sm flex items-center gap-1.5 ${
              quietOn ? 'bg-gray-700/40 border-gray-500/60' : 'bg-red-500/20 border-red-400/50'
            }`}>
              {quietOn ? (
                <>
                  <VolumeX className="w-3 h-3 text-gray-300" />
                  <span className="text-[9px] font-bold text-gray-200">QUIET {quietLeft}s</span>
                </>
              ) : (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-ping" />
                  <span className="text-[9px] font-bold text-red-300">LIVE VISION</span>
                </>
              )}
            </div>
          )}
          {sceneChanged && (
            <div className="absolute bottom-2 right-2 bg-[#00d4ff]/15 border border-[#00d4ff]/40 rounded-full px-2.5 py-1">
              <span className="text-[9px] font-bold text-[#00d4ff]">SCENE CHANGED</span>
            </div>
          )}
        </div>

        <input ref={photoInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoPick} />
        {photoImage && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            <button type="button" onClick={() => analyzePhoto('Describe what you see in this photo.')} disabled={busy} className="px-3 py-1.5 rounded-lg bg-[#00FF9D] text-black text-[9px] font-bold disabled:opacity-50">🔍 ASK JEXI ABOUT THIS PHOTO</button>
            <button type="button" onClick={() => { setPhotoImage(null); setRetryKey((k) => k + 1); }} className="px-3 py-1.5 rounded-lg border border-gray-500/40 text-gray-300 text-[9px] font-bold">✕ Use live camera</button>
          </div>
        )}
        <div className="flex flex-wrap gap-1.5 mt-2 min-h-[24px]">
          {mpStatus === 'loading' && <span className="text-[9px] text-gray-500 animate-pulse">Loading face engine…</span>}
          {mpStatus === 'ready' && chips.length === 0 && !enrolled && !lastGesture && <span className="text-[9px] text-gray-500">Look at the camera 👋</span>}
          {chips.map((c, i) => <span key={i} className="bg-[#00FF9D]/10 border border-[#00FF9D]/30 text-[#00FF9D] rounded-full px-2 py-0.5 text-[9px] font-bold">{c}</span>)}
          {enrolled && matched && <span className="bg-amber-400/15 border border-amber-400/40 text-amber-300 rounded-full px-2 py-0.5 text-[9px] font-bold">👑 Creator — Lewis{similarity > 0 && ` · ${similarity}%`}</span>}
          {enrolled && !matched && expressions && !expressions.faceLost && <span className="bg-gray-500/10 border border-gray-500/30 text-gray-300 rounded-full px-2 py-0.5 text-[9px] font-bold">🙂 New face{similarity > 0 && ` · ${similarity}%`}</span>}
          {mpStatus === 'error' && <span className="text-[9px] text-amber-400">Face engine off — camera + JEXI vision still work.</span>}
          {handStatus === 'loading' && <span className="text-[9px] text-gray-600 animate-pulse">Loading gesture engine…</span>}
          {handStatus === 'error' && <span className="text-[9px] text-gray-600">Gestures off — face vision still works.</span>}
          {lastGesture && (
            <span className="bg-[#00d4ff]/15 border border-[#00d4ff]/40 text-[#00d4ff] rounded-full px-2 py-0.5 text-[9px] font-bold flex items-center gap-1">
              {lastGesture.emoji} {lastGesture.label}
              {lastGesture.quiet && ' · QUIET MODE'}
            </span>
          )}
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
          disabled={thinking || (camStatus !== 'on' && !photoImage) || continuous}
          className="mt-3 w-full bg-[#00FF9D] text-black rounded-xl py-2.5 text-[11px] font-bold flex items-center justify-center gap-2 disabled:opacity-40 hover:bg-[#00e68a] transition-colors"
        >
          {thinking ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> JEXI is looking…</> : <><Video className="w-3.5 h-3.5" /> 👁 What do you see?</>}
        </button>

        <button
          onClick={() => { setContinuous(c => !c); setSceneChanged(false); if (!continuous) { quietUntilRef.current = 0; setQuietLeft(0); } }}
          disabled={camStatus !== 'on'}
          className={`mt-2 w-full rounded-xl py-2.5 text-[11px] font-bold flex items-center justify-center gap-2 transition-colors disabled:opacity-40 ${
            continuous
              ? 'bg-red-500/20 border border-red-400/50 text-red-300 hover:bg-red-500/30'
              : 'bg-[#1a1a1a] border border-[#2a2a2a] text-gray-300 hover:border-red-400/50 hover:text-red-300'
          }`}
        >
          {continuous
            ? <><span className="w-2 h-2 rounded-full bg-red-400 animate-ping" /> ⏹ Stop live vision</>
            : <><VideoOff className="w-3.5 h-3.5" /> 🔴 Live vision — she narrates when something changes</>}
        </button>
        {continuous && continuousNote && (
          <p className="mt-1.5 text-[9px] text-red-300/80 text-center">{continuousNote}</p>
        )}

        {visionError && <p className="mt-2 text-[9px] text-red-400">{visionError}</p>}
        {visionText && (
          <div className="mt-2 bg-[#0a0a0a] border border-[#1a1a1a] rounded-lg p-2.5 text-[10px] text-gray-200 max-h-28 overflow-y-auto whitespace-pre-wrap">
            {visionText}
          </div>
        )}

        <p className="mt-2 text-[8px] text-gray-600 leading-relaxed">
          Eyes: on-device face tracking + hand gestures (free, instant, private — nothing leaves your device). AI vision via
          Groq/Gemini only when she narrates. Live vision is event-driven: a gesture, a face appearing, or a real scene change —
          never a blind timer. ✋ open palm = quiet mode, 👍 thumbs up = approval, 👋 wave = hello.
        </p>
      </div>
    </div>
  );
}
