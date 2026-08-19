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
     * B152 — FIX: after an APK upgrade (in-app UPDATE), the Android WebView can
     * keep serving STALE cached assets — the old index.html plus old hashed
     * JS/CSS files that no longer exist in the new bundle — which renders a
     * white/broken screen until the user clears app data or re-installs.
     *
     * Fix: whenever the installed versionCode changes (upgrade or fresh
     * install), wipe the WebView cache + cookies BEFORE the new page loads, so
     * the new bundle always resolves its own assets.
     */
    private void clearWebViewCacheOnUpgrade() {
        try {
            final int current = BuildConfig.VERSION_CODE;
            final SharedPreferences prefs = getSharedPreferences("jexi_meta", MODE_PRIVATE);
            final int last = prefs.getInt("version_code", 0);
            if (last != current) {
                prefs.edit().putInt("version_code", current).apply();
                getBridge().getWebView().postDelayed(() -> {
                    try {
                        WebView wv = getBridge().getWebView();
                        if (wv == null) return;
                        wv.clearCache(true);
                        CookieManager.getInstance().removeAllCookies(null);
                        wv.getSettings().setCacheMode(WebSettings.LOAD_DEFAULT);
                    } catch (Exception e) { /* best-effort */ }
                }, 60);
            }
        } catch (Exception e) { /* best-effort */ }
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ensureRuntimePermissions();
        clearWebViewCacheOnUpgrade();
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
