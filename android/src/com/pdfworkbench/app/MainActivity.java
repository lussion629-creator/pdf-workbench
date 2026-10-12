package com.pdfworkbench.app;

import android.Manifest;
import android.app.Activity;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.Map;

/** Hosts the offline PDF toolkit (assets/www) in a WebView served from a private https origin. */
public class MainActivity extends Activity {
    static final String HOST = "app.pdfworkbench.local";
    static final int REQ_FILE = 1001;
    static final int REQ_CAMERA = 1002;

    private WebView web;
    private ValueCallback<Uri[]> fileCb;
    private Uri cameraUri;
    /** true only while our own bundled page is loaded; the JS bridge refuses everything else */
    volatile boolean pageTrusted = false;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Window w = getWindow();
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        int bg = dark ? Color.rgb(0x11, 0x14, 0x1b) : Color.rgb(0xf1, 0xf3, 0xf7);
        w.setStatusBarColor(bg);
        w.setNavigationBarColor(bg);
        if (!dark && Build.VERSION.SDK_INT >= 23) w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);

        web = new WebView(this);
        web.setBackgroundColor(bg);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setTextZoom(100);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setGeolocationEnabled(false);
        s.setSaveFormData(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        web.addJavascriptInterface(new Bridge(this), "AndroidBridge");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView v, String url, android.graphics.Bitmap icon) {
                Uri u = Uri.parse(url);
                pageTrusted = "https".equals(u.getScheme()) && HOST.equals(u.getHost());
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (HOST.equals(u.getHost())) return asset(u.getPath());
                return null;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (HOST.equals(u.getHost())) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { /* no browser */ }
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                if (p.isCaptureEnabled() && Build.VERSION.SDK_INT >= 29 && openCamera()) return true;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                String[] mimes = mimesFor(p.getAcceptTypes());
                if (mimes.length > 0) i.putExtra(Intent.EXTRA_MIME_TYPES, mimes);
                if (p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(Intent.createChooser(i, "파일 선택"), REQ_FILE);
                } catch (Exception e) {
                    fileCb = null;
                    return false;
                }
                return true;
            }
        });

        if (Build.VERSION.SDK_INT < 29 && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, 7);
        }
        if (state != null) web.restoreState(state);
        else web.loadUrl("https://" + HOST + "/index.html");
    }

    private boolean openCamera() {
        try {
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.Images.Media.DISPLAY_NAME, "scan_" + System.currentTimeMillis() + ".jpg");
            cv.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
            cv.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/PDF작업대");
            cameraUri = getContentResolver().insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv);
            Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            i.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
            startActivityForResult(i, REQ_CAMERA);
            return true;
        } catch (Exception e) {
            cameraUri = null;
            return false;
        }
    }

    static String[] mimesFor(String[] accept) {
        LinkedHashSet<String> out = new LinkedHashSet<>();
        if (accept == null) return new String[0];
        for (String raw : accept) {
            for (String a : raw.split(",")) {
                a = a.trim().toLowerCase();
                if (a.isEmpty()) continue;
                if (a.contains("/")) { out.add(a); continue; }
                switch (a) {
                    case ".pdf": out.add("application/pdf"); break;
                    case ".docx": out.add("application/vnd.openxmlformats-officedocument.wordprocessingml.document"); break;
                    case ".pptx": out.add("application/vnd.openxmlformats-officedocument.presentationml.presentation"); break;
                    case ".xlsx": out.add("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"); break;
                    case ".xls": out.add("application/vnd.ms-excel"); break;
                    case ".ods": out.add("application/vnd.oasis.opendocument.spreadsheet"); break;
                    case ".csv": out.add("text/csv"); out.add("text/comma-separated-values"); break;
                    case ".html": case ".htm": out.add("text/html"); break;
                    default: break;
                }
            }
        }
        if (out.contains("text/html") || out.contains("text/csv")) out.add("text/plain");
        return out.toArray(new String[0]);
    }

    private WebResourceResponse asset(String path) {
        if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
        if (path.contains("..")) return notFound();
        try {
            InputStream in = getAssets().open("www" + Uri.decode(path));
            String mime = mimeOf(path);
            Map<String, String> h = new HashMap<>();
            h.put("Access-Control-Allow-Origin", "*");
            h.put("Cache-Control", "no-cache");
            boolean text = mime.startsWith("text/") || mime.contains("javascript") || mime.contains("json");
            return new WebResourceResponse(mime, text ? "utf-8" : null, 200, "OK", h, in);
        } catch (Exception e) {
            return notFound();
        }
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<String, String>(), new java.io.ByteArrayInputStream(new byte[0]));
    }

    static String mimeOf(String p) {
        String l = p.toLowerCase();
        if (l.endsWith(".html")) return "text/html";
        if (l.endsWith(".js")) return "application/javascript";
        if (l.endsWith(".json")) return "application/json";
        if (l.endsWith(".css")) return "text/css";
        if (l.endsWith(".ttf")) return "font/ttf";
        if (l.endsWith(".wasm")) return "application/wasm";
        if (l.endsWith(".gz")) return "application/gzip";
        if (l.endsWith(".png")) return "image/png";
        if (l.endsWith(".svg")) return "image/svg+xml";
        return "application/octet-stream";
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == REQ_FILE || req == REQ_CAMERA) {
            Uri[] out = null;
            if (res == RESULT_OK) {
                if (req == REQ_CAMERA) out = cameraUri != null ? new Uri[]{cameraUri} : null;
                else if (data != null) {
                    if (data.getClipData() != null) {
                        ArrayList<Uri> list = new ArrayList<>();
                        for (int i = 0; i < data.getClipData().getItemCount(); i++) list.add(data.getClipData().getItemAt(i).getUri());
                        out = list.toArray(new Uri[0]);
                    } else if (data.getData() != null) out = new Uri[]{data.getData()};
                }
            } else if (req == REQ_CAMERA && cameraUri != null) {
                try { getContentResolver().delete(cameraUri, null, null); } catch (Exception e) { /* ignore */ }
            }
            if (fileCb != null) fileCb.onReceiveValue(out);
            fileCb = null;
            cameraUri = null;
            return;
        }
        super.onActivityResult(req, res, data);
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(window.appBack && window.appBack()) ? 'y' : 'n'", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String v) {
                if (v == null || !v.contains("y")) finish();
            }
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    /** Called from the page to write a finished file into Downloads/PDF작업대. */
    static class Bridge {
        private final MainActivity a;
        Bridge(MainActivity a) { this.a = a; }
        @JavascriptInterface
        public String saveFile(String name, String mime, String b64) {
            if (!a.pageTrusted) return "ERR 허용되지 않은 페이지입니다";
            try {
                byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
                String safe = name.replaceAll("[\\\\/:*?\"<>|]", "_");
                if (mime == null || mime.isEmpty() || mime.equals("application/octet-stream")) {
                    String ext = MimeTypeMap.getFileExtensionFromUrl(safe.replace(" ", "_"));
                    String m = ext == null ? null : MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext.toLowerCase());
                    mime = m != null ? m : "application/octet-stream";
                }
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentResolver cr = a.getContentResolver();
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Downloads.DISPLAY_NAME, safe);
                    cv.put(MediaStore.Downloads.MIME_TYPE, mime);
                    cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/PDF작업대");
                    Uri u = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    if (u == null) return "ERR 저장 공간에 파일을 만들 수 없습니다";
                    OutputStream os = cr.openOutputStream(u);
                    try { os.write(bytes); } finally { os.close(); }
                    return "다운로드/PDF작업대/" + safe;
                } else {
                    File dir;
                    if (a.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED)
                        dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "PDF작업대");
                    else dir = a.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    if (dir != null && !dir.exists()) dir.mkdirs();
                    File f = new File(dir, safe);
                    int k = 1;
                    String base = safe.contains(".") ? safe.substring(0, safe.lastIndexOf('.')) : safe;
                    String ext = safe.contains(".") ? safe.substring(safe.lastIndexOf('.')) : "";
                    while (f.exists()) f = new File(dir, base + " (" + (k++) + ")" + ext);
                    FileOutputStream fos = new FileOutputStream(f);
                    try { fos.write(bytes); } finally { fos.close(); }
                    return f.getAbsolutePath();
                }
            } catch (Throwable t) {
                return "ERR " + t.getMessage();
            }
        }

        @JavascriptInterface
        public void toast(String msg) {
            if (!a.pageTrusted) return;
            final String m = msg;
            a.runOnUiThread(new Runnable() { public void run() { Toast.makeText(a, m, Toast.LENGTH_SHORT).show(); } });
        }
    }
}
