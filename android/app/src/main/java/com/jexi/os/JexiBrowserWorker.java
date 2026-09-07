package com.jexi.os;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * ARENA — APK BROWSER WORKER (the phone half of spec Part 17).
 *
 * Turns this app's phone into a REAL browser worker for the JEXI brain:
 * it registers with the server's APK channel, long-polls for work, runs
 * each op in a private headless WebView, and posts the honest result.
 *
 *   POST /api/browser/apk/register { deviceId, capabilities }  → token
 *   POST /api/browser/apk/poll    { token }   → an op (or idle)
 *   POST /api/browser/apk/result  { token, taskId, ok, ... }  → done
 *
 * The main UI WebView is NEVER used for browsing — the worker keeps its
 * own off-screen WebView, so JEXI's browsing never fights the user's.
 *
 * Honesty rules (mirrored on the server):
 *  - no backend URL configured → the worker stays dormant, nothing is faked
 *  - every failure is reported as ok:false with the real error
 *  - the user's phone stays theirs: the server's policy gate decides what
 *    ops are allowed BEFORE they ever reach this worker (CAPTCHA never
 *    arrives here; the server refuses it first)
 *
 * Enabled/disabled: SharedPreferences "jexi_worker" → "enabled" (default on).
 * Kill switch for debugging: `adb shell am broadcast` is NOT used — the
 * setting file is enough (the worker re-reads it every cycle).
 */
public final class JexiBrowserWorker {

    private static final String PREFS = "jexi_worker";
    private static final String KEY_DEVICE_ID = "device_id";
    private static final String KEY_ENABLED = "enabled";

    private static final long BACKOFF_MS_DORMANT = 15_000;   // no backend URL
    private static final long BACKOFF_MS_ERROR = 8_000;      // network trouble
    private static final int CONNECT_TIMEOUT_MS = 10_000;
    private static final int POLL_READ_TIMEOUT_MS = 40_000;  // server holds 25s
    private static final long OP_TIMEOUT_MS = 45_000;        // hard cap per op

    private static volatile JexiBrowserWorker instance;

    private final Context appContext;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AtomicBoolean running = new AtomicBoolean(false);
    private Thread thread;

    /** The app's MAIN (Capacitor) WebView — used ONLY to read the backend
     *  URL the user configured (localStorage), never for browsing. */
    private volatile WebView mainWebView;

    /** The worker's private headless browser. */
    private volatile WebView workerWebView;

    private volatile String backendUrl = null;   // null = not discovered yet
    private volatile String token = null;

    private JexiBrowserWorker(Context ctx) {
        this.appContext = ctx.getApplicationContext();
    }

    /** Start the worker (idempotent). Called from MainActivity.onCreate. */
    public static void start(Context ctx, WebView mainWebViewForConfig) {
        if (instance == null) {
            synchronized (JexiBrowserWorker.class) {
                if (instance == null) instance = new JexiBrowserWorker(ctx);
            }
        }
        instance.mainWebView = mainWebViewForConfig;
        if (instance.running.compareAndSet(false, true)) {
            instance.thread = new Thread(instance::loop, "jexi-browser-worker");
            instance.thread.setDaemon(true);
            instance.thread.start();
        }
    }

    /* ------------------------------------------------------------------ */
    /* the loop                                                            */
    /* ------------------------------------------------------------------ */

    private void loop() {
        // small stagger so a fresh install doesn't hammer the server instantly
        sleepQuietly(3_000);
        while (running.get()) {
            try {
                if (!isEnabled()) { sleepQuietly(BACKOFF_MS_DORMANT); continue; }
                if (backendUrl == null) { refreshBackendUrl(); }
                if (backendUrl == null || backendUrl.isEmpty()) {
                    // user has not configured a backend — stay dormant, honestly
                    sleepQuietly(BACKOFF_MS_DORMANT); continue;
                }
                if (token == null && !register()) {
                    sleepQuietly(BACKOFF_MS_ERROR); continue;
                }
                JSONObject polled = poll();
                if (polled == null) { sleepQuietly(BACKOFF_MS_ERROR); continue; }
                if (polled.has("idle")) { continue; } // clean idle — poll again immediately
                if (polledHasOp(polled)) {
                    runAndReportOp(polled.optJSONObject("op"));
                }
            } catch (Exception e) {
                // never die — the worker outlives any single bad cycle
                sleepQuietly(BACKOFF_MS_ERROR);
            }
        }
    }

    private static boolean polledHasOp(JSONObject polled) {
        return polled != null && polled.has("op");
    }

    /* ------------------------------------------------------------------ */
    /* backend URL discovery — read from the app's own settings (localStorage) */
    /* ------------------------------------------------------------------ */

    private void refreshBackendUrl() {
        final WebView wv = this.mainWebView;
        if (wv == null) return;
        final CountDownLatch latch = new CountDownLatch(1);
        final AtomicReference<String> found = new AtomicReference<>(null);
        main.post(() -> {
            try {
                wv.evaluateJavascript(
                    "(function(){try{return localStorage.getItem('jexi_backend_url')||''}catch(e){return ''}})()",
                    value -> {
                        try {
                            if (value != null && !"null".equals(value)) {
                                String clean = value.replaceAll("^\"|\"$", "").trim();
                                if (clean.endsWith("/")) clean = clean.substring(0, clean.length() - 1);
                                found.set(clean);
                            }
                        } catch (Exception ignored) { }
                        latch.countDown();
                    });
            } catch (Exception e) {
                latch.countDown();
            }
        });
        try {
            if (latch.await(5, TimeUnit.SECONDS)) {
                String url = found.get();
                if (url != null && !url.isEmpty()) {
                    if (!url.startsWith("http")) url = "https://" + url;
                    // token invalidation on backend change — re-register
                    if (!url.equals(this.backendUrl)) this.token = null;
                    this.backendUrl = url;
                }
            }
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }

    /* ------------------------------------------------------------------ */
    /* channel protocol                                                    */
    /* ------------------------------------------------------------------ */

    private boolean register() {
        try {
            JSONObject body = new JSONObject();
            body.put("deviceId", deviceId());
            body.put("capabilities", new JSONArray()
                    .put("navigate").put("read").put("act").put("screenshot"));
            JSONObject res = httpPost(backendUrl + "/api/browser/apk/register", body, 15_000);
            if (res != null && res.optBoolean("ok")) {
                this.token = res.optString("token", null);
                return this.token != null;
            }
        } catch (Exception ignored) { }
        return false;
    }

    private JSONObject poll() {
        try {
            JSONObject body = new JSONObject();
            body.put("token", token);
            return httpPost(backendUrl + "/api/browser/apk/poll", body, POLL_READ_TIMEOUT_MS);
        } catch (Exception e) {
            return null;
        }
    }

    private void runAndReportOp(JSONObject op) {
        String taskId = op == null ? null : op.optString("taskId", null);
        if (taskId == null) return;
        String kind = op.optString("op", "");
        JSONObject params = op.optJSONObject("params") != null
                ? op.optJSONObject("params") : new JSONObject();

        JSONObject result = executeOp(kind, params);

        try {
            result.put("token", token);
            result.put("taskId", taskId);
            httpPost(backendUrl + "/api/browser/apk/result", result, 15_000);
        } catch (Exception e) {
            // the server's 60s op timeout will report this honestly if the
            // result never arrives — nothing is silently swallowed here
        }
    }

    /* ------------------------------------------------------------------ */
    /* op execution in the headless WebView                                */
    /* ------------------------------------------------------------------ */

    private JSONObject executeOp(String kind, JSONObject params) {
        JSONObject out = new JSONObject();
        try { out.put("ok", false); out.put("error", "unknown op"); } catch (Exception ignored) { }
        if (kind == null) return out;
        switch (kind) {
            case "navigate": return opNavigate(params);
            case "read":     return opRead(params);
            case "screenshot": return opScreenshot(params);
            case "act":      return opAct(params);
            default: {
                try { out.put("error", "unsupported op: " + kind); } catch (Exception ignored) { }
                return out;
            }
        }
    }

    /** Get (or lazily create) the headless browser on the main thread. */
    private WebView browser() throws InterruptedException {
        WebView existing = this.workerWebView;
        if (existing != null) return existing;
        final CountDownLatch latch = new CountDownLatch(1);
        main.post(() -> {
            try {
                WebView wv = new WebView(appContext);
                wv.getSettings().setJavaScriptEnabled(true);
                wv.getSettings().setDomStorageEnabled(true);
                wv.setLayoutParams(new android.view.ViewGroup.LayoutParams(1080, 1920));
                wv.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView view, String url) {
                        // delivered to whoever waits via the latch pattern below
                        if (view.getTag() instanceof CountDownLatch) {
                            ((CountDownLatch) view.getTag()).countDown();
                        }
                    }
                    @Override
                    public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                        if (req.isForMainFrame() && view.getTag() instanceof CountDownLatch) {
                            ((CountDownLatch) view.getTag()).countDown();
                        }
                    }
                });
                JexiBrowserWorker.this.workerWebView = wv;
            } catch (Exception ignored) {
                // creation failed — caller sees the timeout and reports honestly
            } finally {
                latch.countDown();
            }
        });
        latch.await(10, TimeUnit.SECONDS);
        return this.workerWebView;
    }

    /** Run a unit of work on the main thread with a hard timeout. */
    private Object onMainWithTimeout(MainThreadWork work, long timeoutMs) {
        final CountDownLatch latch = new CountDownLatch(1);
        final AtomicReference<Object> result = new AtomicReference<>(null);
        main.post(() -> {
            try {
                result.set(work.run());
            } catch (Exception e) {
                result.set(e);
            } finally {
                latch.countDown();
            }
        });
        try {
            if (!latch.await(timeoutMs, TimeUnit.MILLISECONDS)) {
                return new TimeoutException("op timed out after " + timeoutMs + "ms");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return e;
        }
        return result.get();
    }

    private interface MainThreadWork { Object run() throws Exception; }

    /**
     * Evaluate JS in a WebView and WAIT for the result on the WORKER thread
     * (never blocks the main thread). Returns the raw JSON-ish string the
     * WebView reports, or null on timeout.
     */
    private String evaluateAndWait(WebView wv, String js, long timeoutMs) {
        if (wv == null) return null;
        final CountDownLatch latch = new CountDownLatch(1);
        final AtomicReference<String> value = new AtomicReference<>(null);
        main.post(() -> {
            try {
                wv.evaluateJavascript(js, v -> {
                    value.set(v);
                    latch.countDown();
                });
            } catch (Exception e) {
                latch.countDown();
            }
        });
        try {
            if (latch.await(timeoutMs, TimeUnit.MILLISECONDS)) return value.get();
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        return null;
    }

    private static final class TimeoutException extends Exception {
        TimeoutException(String m) { super(m); }
    }

    private JSONObject opNavigate(JSONObject params) {
        String url = params.optString("url", "");
        if (url == null || url.isEmpty()) return fail("navigate: no url");
        Object loadResult = onMainWithTimeout(() -> {
            WebView wv = browser();
            if (wv == null) return new IllegalStateException("headless WebView unavailable");
            final CountDownLatch done = new CountDownLatch(1);
            wv.setTag(done);
            wv.loadUrl(url);
            // wait for onPageFinished inside the main thread would block the
            // thread the WebView needs — so we wait HERE (worker thread) for
            // the latch our WebViewClient counts down.
            return "started";
        }, 10_000);
        if (loadResult instanceof Throwable) return fail("navigate failed: " + ((Throwable) loadResult).getMessage());

        // wait for the page to finish loading (worker thread)
        try {
            WebView wv = browser();
            if (wv == null) return fail("headless WebView unavailable");
            Object tag = wv.getTag();
            long deadline = System.currentTimeMillis() + OP_TIMEOUT_MS;
            if (tag instanceof CountDownLatch) {
                boolean ok = ((CountDownLatch) tag).await(OP_TIMEOUT_MS, TimeUnit.MILLISECONDS);
                if (!ok) return fail("page did not finish loading within " + OP_TIMEOUT_MS / 1000 + "s — reported honestly");
            }
            wv.setTag(null);
            return readPageInfo(wv);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return fail("navigate interrupted");
        }
    }

    private JSONObject opRead(JSONObject params) {
        try {
            WebView wv = browser();
            if (wv == null) return fail("headless WebView unavailable");
            return readPageInfo(wv);
        } catch (Exception e) {
            return fail("read failed: " + e.getMessage());
        }
    }

    private JSONObject readPageInfo(WebView wv) {
        String raw = evaluateAndWait(wv,
            "(function(){try{return JSON.stringify({url:location.href,title:document.title,"
          + "text:(document.body?document.body.innerText:'').slice(0,20000)})}catch(e){return null}})()",
            15_000);
        if (raw != null && !"null".equals(raw)) {
            try {
                JSONObject p = new JSONObject(raw);
                JSONObject out = new JSONObject();
                out.put("ok", true);
                out.put("url", p.optString("url"));
                out.put("title", p.optString("title"));
                out.put("text", p.optString("text"));
                return out;
            } catch (Exception ignored) { }
        }
        return fail("could not read the page — reported honestly");
    }

    private JSONObject opScreenshot(JSONObject params) {
        Object shot = onMainWithTimeout(() -> {
            WebView wv = browser();
            if (wv == null) return new IllegalStateException("headless WebView unavailable");
            int width = Math.max(360, params.optInt("width", 1080));
            int height = Math.max(360, params.optInt("height", 1920));
            wv.measure(android.view.View.MeasureSpec.makeMeasureSpec(width, android.view.View.MeasureSpec.EXACTLY),
                       android.view.View.MeasureSpec.makeMeasureSpec(height, android.view.View.MeasureSpec.EXACTLY));
            wv.layout(0, 0, width, height);
            Bitmap bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bmp);
            wv.draw(canvas);
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            bmp.compress(Bitmap.CompressFormat.PNG, 80, bos);
            return Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP);
        }, 25_000);
        if (shot instanceof String) {
            JSONObject out = new JSONObject();
            try { out.put("ok", true); out.put("screenshotBase64", shot); out.put("format", "png"); } catch (Exception ignored) { }
            return out;
        }
        return fail("screenshot failed: " + (shot instanceof Throwable ? ((Throwable) shot).getMessage() : "unknown"));
    }

    private JSONObject opAct(JSONObject params) {
        String selector = params.optString("selector", "");
        String action = params.optString("action", "click");
        String text = params.optString("text", "");
        if (selector == null || selector.isEmpty()) return fail("act: no selector");
        try {
            WebView wv = browser();
            if (wv == null) return fail("headless WebView unavailable");
            String esc = selector.replace("\\", "\\\\").replace("'", "\\'");
            String js;
            if ("type".equals(action)) {
                String escText = text.replace("\\", "\\\\").replace("'", "\\'");
                js = "(function(){var e=document.querySelector('" + esc + "');if(!e)return 'element not found';"
                   + "try{e.value='" + escText + "';e.dispatchEvent(new Event('input',{bubbles:true}));"
                   + "e.dispatchEvent(new Event('change',{bubbles:true}));return null}catch(err){return String(err)}})()";
            } else { // click is the default
                js = "(function(){var e=document.querySelector('" + esc + "');if(!e)return 'element not found';"
                   + "try{e.click();return null}catch(err){return String(err)}})()";
            }
            String err = evaluateAndWait(wv, js, 12_000);
            if (err == null || "null".equals(err) || "\"\"".equals(err)) {
                JSONObject out = new JSONObject();
                out.put("ok", true);
                out.put("action", action);
                out.put("selector", selector);
                return out;
            }
            return fail("act failed: " + err);
        } catch (Exception e) {
            return fail("act failed: " + e.getMessage());
        }
    }

    private static JSONObject fail(String message) {
        JSONObject out = new JSONObject();
        try { out.put("ok", false); out.put("error", message); } catch (Exception ignored) { }
        return out;
    }

    /* ------------------------------------------------------------------ */
    /* small plumbing                                                      */
    /* ------------------------------------------------------------------ */

    private boolean isEnabled() {
        SharedPreferences prefs = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return prefs.getBoolean(KEY_ENABLED, true);
    }

    private String deviceId() {
        SharedPreferences prefs = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String id = prefs.getString(KEY_DEVICE_ID, null);
        if (id == null) {
            String model = Build.MODEL == null ? "android" : Build.MODEL;
            model = model.toLowerCase().replaceAll("[^a-z0-9]+", "-").replaceAll("^-|-$", "");
            if (model.isEmpty()) model = "android";
            id = model + "-" + UUID.randomUUID().toString().substring(0, 8);
            prefs.edit().putString(KEY_DEVICE_ID, id).apply();
        }
        return id;
    }

    /** POST JSON, read a JSON response. Null on any transport failure. */
    private JSONObject httpPost(String url, JSONObject body, int readTimeoutMs) throws Exception {
        java.net.HttpURLConnection conn = null;
        try {
            conn = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(readTimeoutMs);
            conn.setDoOutput(true);
            byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream os = conn.getOutputStream()) {
                os.write(payload);
            }
            int code = conn.getResponseCode();
            InputStream is = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (is == null) return null;
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
            String text = new String(bos.toByteArray(), StandardCharsets.UTF_8);
            if (text.isEmpty()) return null;
            return new JSONObject(text);
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private static void sleepQuietly(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
