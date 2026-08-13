package com.jexi.os;

import android.view.View;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * Known Android WebView bug: after the app returns from the background the
     * drawing surface can stay black (the renderer never redraws). Re-attaching
     * the WebView forces a fresh frame — the standard fix for the
     * "black screen when coming back to the app" issue.
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
