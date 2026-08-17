package com.jexi.os;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebView;

import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /** Known Android WebView bug: after backgrounding, the drawing surface can
     *  stay black. Re-attaching the WebView forces a fresh frame. */
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
     * B93 — VISION FIX. The WebView silently denies navigator.mediaDevices
     * .getUserMedia() unless onPermissionRequest is granted. The grant lives
     * in the WebChromeClient below (installed in onCreate) — this class-level
     * helper is reused by that client.
     */
    private void grantWebViewPermission(PermissionRequest request) {
        runOnUiThread(() -> {
            try {
                request.grant(request.getResources());
            } catch (Exception e) {
                request.deny();
            }
        });
    }

    /** Ask for camera + mic at launch so the system dialog shows early and
     *  getUserMedia works the first time JEXI opens her eyes. */
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

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ensureRuntimePermissions();
        WebView wv = getBridge().getWebView();
        if (wv != null) {
            wv.setWebChromeClient(new WebChromeClient() {
                @Override
                public void onPermissionRequest(PermissionRequest request) {
                    grantWebViewPermission(request);
                }
            });
        }
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
