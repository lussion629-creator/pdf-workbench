#!/usr/bin/env python3
"""Builds the app: dist/web (Claude artifact), dist/app (offline bundle: Android, GitHub Pages), dist/desktop (PC app)."""
import base64, hashlib, json, os, re, shutil, sys

ROOT = os.path.dirname(os.path.abspath(__file__))
NM = os.path.join(ROOT, 'node_modules')
SRC = os.path.join(ROOT, 'src')
PARTS = ['core.js', 'app.js', 't_pages.js', 't_opt.js', 't_conv.js', 't_edit.js', 't_sec.js', 't_ai.js']

CDN_LOCAL = {
    'https://cdn.jsdelivr.net/npm/@cantoo/pdf-lib@2.11.1/dist/pdf-lib.min.js': '@cantoo/pdf-lib/dist/pdf-lib.min.js',
    'https://cdn.jsdelivr.net/npm/@cantoo/fontkit@2.0.12/dist/fontkit.umd.min.js': '@cantoo/fontkit/dist/fontkit.umd.min.js',
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js': 'pdfjs-dist/build/pdf.min.js',
    'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js': 'jszip/dist/jszip.min.js',
    'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js': 'xlsx/dist/xlsx.full.min.js',
    'https://cdn.jsdelivr.net/npm/mammoth@1.12.3/mammoth.browser.min.js': 'mammoth/mammoth.browser.min.js',
    'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js': 'html2canvas/dist/html2canvas.min.js',
    'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js': 'pptxgenjs/dist/pptxgen.bundle.js',
    'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js': 'tesseract.js/dist/tesseract.min.js',
}

def page_html():
    shell = open(os.path.join(SRC, 'shell.html'), encoding='utf-8').read()
    js = '\n'.join(open(os.path.join(SRC, p), encoding='utf-8').read() for p in PARTS)
    icc = base64.b64encode(open(os.path.join(ROOT, 'assets/sRGB.icc'), 'rb').read()).decode()
    js = js.replace('%%ICC%%', icc)
    sri = {u: 'sha384-' + base64.b64encode(hashlib.sha384(open(os.path.join(NM, r), 'rb').read()).digest()).decode() for u, r in CDN_LOCAL.items()}
    js = js.replace('%%SRI%%', json.dumps(sri))
    for u, v in sri.items():
        shell = shell.replace(f'<script src="{u}"></script>', f'<script src="{u}" integrity="{v}" crossorigin="anonymous"></script>')
    assert '</script>' not in js and '%%' not in js
    return shell.replace('%%JS%%', js)

def copy(src, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copyfile(src, dst)

def assets(out):
    copy(os.path.join(NM, 'pdfjs-dist/build/pdf.worker.min.js'), os.path.join(out, 'pdf.worker.min.js'))
    cdir = os.path.join(NM, 'pdfjs-dist/cmaps')
    bundle = {f[:-6]: base64.b64encode(open(os.path.join(cdir, f), 'rb').read()).decode() for f in sorted(os.listdir(cdir)) if f.endswith('.bcmap')}
    with open(os.path.join(out, 'cmaps.json'), 'w') as fh: json.dump(bundle, fh, separators=(',', ':'))
    copy(os.path.join(ROOT, 'fonts/NanumGothic.ttf'), os.path.join(out, 'fonts/NanumGothic.ttf'))
    copy(os.path.join(SRC, 'xlsx-worker.js'), os.path.join(out, 'xlsx-worker.js'))
    # worker copy of SheetJS with raw control bytes written as \xNN escapes (identical behaviour, clean text file)
    raw = open(os.path.join(NM, 'xlsx/dist/xlsx.full.min.js'), 'rb').read()
    esc = re.sub(rb'[\x00-\x08\x0b\x0c\x0e-\x1f]', lambda m: b'\\x%02x' % m.group(0)[0], raw)
    txt = esc.decode('utf-8', 'surrogateescape')  # stray non-UTF-8 bytes sit inside string tables; spell them as escapes too
    esc = re.sub('[\udc80-\udcff]', lambda m: '\\x%02x' % (ord(m.group(0)) - 0xdc00), txt).replace('\ufffd', '\\ufffd').encode('utf-8')
    os.makedirs(os.path.join(out, 'lib'), exist_ok=True)
    open(os.path.join(out, 'lib/xlsx.sheet.js'), 'wb').write(esc)
    shim = "(function(){var f=self.fetch.bind(self);self.fetch=function(u,o){return f(String(u).replace(/\\.traineddata\\.gz$/,'.traineddata.gz.wasm'),o);};})();\n"
    os.makedirs(os.path.join(out, 'tess'), exist_ok=True)
    with open(os.path.join(out, 'tess/worker.min.js'), 'w', encoding='utf-8') as fh:
        fh.write(shim + open(os.path.join(NM, 'tesseract.js/dist/worker.min.js'), encoding='utf-8').read())
    for f in ['tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js']:
        copy(os.path.join(NM, 'tesseract.js-core', f), os.path.join(out, 'tess/core', f))
    for lang in ['kor', 'eng']:
        copy(os.path.join(NM, f'@tesseract.js-data/{lang}/4.0.0_best_int/{lang}.traineddata.gz'), os.path.join(out, f'tess/lang/{lang}.traineddata.gz.wasm'))

def build(target):
    out = os.path.join(ROOT, 'dist', target)
    shutil.rmtree(out, ignore_errors=True); os.makedirs(out)
    html = page_html()
    if target in ('app', 'desktop'):
        for url, rel in CDN_LOCAL.items():
            local = 'lib/' + rel.split('/')[-1]
            copy(os.path.join(NM, rel), os.path.join(out, local))
            html = html.replace(url, local)
        # Google Fonts are optional offline; keep the link (fails quietly without network)
        html = ('<!doctype html><html lang="ko"><head><meta charset="utf-8">'
                '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
                '<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
                'body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>'
                + ('<script>window.__DESKTOP__=1</script>' if target == 'desktop' else '') + '</head><body>' + html + '</body></html>')
    if target in ('app', 'desktop'):
        # Content-Security-Policy: only this app's own files may run; inline scripts are pinned by hash
        hashes = ' '.join("'sha256-%s'" % base64.b64encode(hashlib.sha256(s.encode('utf-8')).digest()).decode()
                          for s in re.findall(r'<script>(.*?)</script>', html, re.S))
        csp = ("default-src 'self'; script-src 'self' 'wasm-unsafe-eval' " + hashes + "; worker-src 'self' blob:; "
               "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; "
               "img-src 'self' data: blob:; connect-src 'self' data: blob:; frame-src 'self' about: blob: data:; "
               "object-src 'none'; base-uri 'none'; form-action 'none'")
        html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="%s">' % csp, 1)
    with open(os.path.join(out, 'index.html'), 'w', encoding='utf-8') as fh: fh.write(html)
    assets(out)
    print(target, 'built:', out, os.path.getsize(os.path.join(out, 'index.html')), 'bytes html')

if __name__ == '__main__':
    for t in (sys.argv[1:] or ['web', 'app', 'desktop']): build(t)
