package com.jexi.os;

import android.Manifest;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;

import java.io.File;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * Known Android WebView bug: after backgrounding, the drawing surface can
     * stay black. Re-attaching the WebView forces a fresh frame.
     */
    private void refreshWebViewSurface() {
        getBridge().getWebView().postDelayed(() -> {
            WebView wv = getBridge().getWebView();
            if (wv == null) return;
            wv.setVisibility(View.GONE);
            wv.setVisibility(View.VISIBLE);
            wv.postInvalidateDelayed(50);
        }, 120);
    }

    /**
     * B94 — VISION/CAMERA FIX (correct approach).
     *
     * Capacitor's own BridgeWebChromeClient ALREADY implements
     * onPermissionRequest: when the WebView asks for VIDEO_CAPTURE /
     * AUDIO_CAPTURE it requests the runtime CAMERA / RECORD_AUDIO
     * permissions via its ActivityResult launcher and then grants the
     * WebView request. We must NOT replace that client (a bare
     * WebChromeClient granted without the runtime permission, which is why
     * camera still failed). We only:
     *   1. proactively request CAMERA + RECORD_AUDIO at launch so the OS
     *      dialog appears immediately and getUserMedia succeeds first try,
     *   2. keep the black-screen fix.
     */
    private void ensureRuntimePermissions() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        String[] needed = new String[]{
                Manifest.permission.CAMERA,
                Manifest.permission.RECORD_AUDIO,
        };
        boolean anyMissing = false;
        for (String p : needed) {
            if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) {
                anyMissing = true;
                break;
            }
        }
        if (anyMissing) {
            ActivityCompat.requestPermissions(this, needed, 1001);
        }
    }

    /**
     * B152/B153 — FIX: after an APK upgrade (in-app UPDATE) the Android WebView
     * kept serving its STALE cached bundle (old index.html + old hashed
     * assets) — the white/broken screen — because the previous fix ran AFTER
     * the page had already started loading from cache.
     *
     * B153 did it by deleting the ENTIRE app_webview directory — which also
     * deleted the app's localStorage (session id, access key, settings) and
     * therefore wiped conversation identity on every upgrade: JEXI "forgot"
     * everything after each update. B155 fixes that: only the CACHE and
     * SERVICE WORKER subdirectories are deleted (that is all the stale-bundle
     * bug needs — localStorage never serves HTML/JS), so identity, settings
     * and remembered conversations survive every update.
     */
    private void deleteRecursive(File f) {
        if (f == null || !f.exists()) return;
        if (f.isDirectory()) {
            File[] kids = f.listFiles();
            if (kids != null) for (File k : kids) deleteRecursive(k);
        }
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }

    /** Cache/SW dirs that can hold a STALE BUNDLE — safe to delete on upgrade.
     *  Deliberately NOT included: Local Storage, Web Data, Session Storage,
     *  IndexedDB, blob_storage, databases, File System, Cookies — those hold
     *  the user's identity, access key, settings and history. */
    private static final String[] CACHE_SUBDIRS = {
            "Cache", "HTTP Cache", "Code Cache", "GPUCache",
            "DawnCache", "DawnGraphiteCache", "GrShaderCache", "ShaderCache",
            "Service Worker",
    };

    private void wipeWebViewDataOnUpgrade() {
        try {
            final int current = BuildConfig.VERSION_CODE;
            final SharedPreferences prefs = getSharedPreferences("jexi_meta", MODE_PRIVATE);
            final int last = prefs.getInt("version_code", 0);
            if (last != current) {
                prefs.edit().putInt("version_code", current).apply();
                // Run BEFORE super.onCreate() — the WebView does not exist yet,
                // so no in-flight load can re-seed from the old cache.
                final File webview = getDir("app_webview", MODE_PRIVATE);
                for (String sub : CACHE_SUBDIRS) {
                    deleteRecursive(new File(webview, sub));
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                    CookieManager.getInstance().removeAllCookies(null);
                }
            }
        } catch (Exception e) { /* best-effort — the app still opens */ }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // MUST run before super.onCreate: that is when Capacitor creates the
        // WebView and begins loading the page from cache.
        wipeWebViewDataOnUpgrade();
        super.onCreate(savedInstanceState);
        ensureRuntimePermissions();
        // Second layer: even on a non-upgrade launch, force the local bundle
        // to bypass any residual HTTP cache.
        getBridge().getWebView().postDelayed(() -> {
            try {
                WebView wv = getBridge().getWebView();
                if (wv == null) return;
                wv.getSettings().setCacheMode(WebSettings.LOAD_DEFAULT);
            } catch (Exception e) { /* best-effort */ }
        }, 80);
    }

    @Override
    public void onResume() {
        super.onResume();
        refreshWebViewSurface();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) refreshWebViewSurface();
    }
}
