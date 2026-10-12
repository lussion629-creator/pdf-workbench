import os, threading, http.server, functools
from playwright.sync_api import sync_playwright
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
srv=http.server.ThreadingHTTPServer(('127.0.0.1',8768),functools.partial(Q,directory='/home/claude/pdfapp/dist/app')); threading.Thread(target=srv.serve_forever,daemon=True).start()
B='http://127.0.0.1:8768/index.html'
with sync_playwright() as pw:
    br=pw.chromium.launch(args=['--no-sandbox']); p=br.new_page(); csp=[]
    p.on('console', lambda m: 'Content Security Policy' in m.text and csp.append(m.text[:120]))
    for tid, f in [('html2pdf','evil.html'),('excel2pdf','evil.xlsx')]:
        p.goto('about:blank'); p.goto(B+'#'+tid)
        with p.expect_file_chooser() as fc: p.get_by_role('button',name='파일 선택').click()
        fc.value.set_files([os.path.join('fx',f)]); p.wait_for_timeout(800); p.click('#runbtn'); p.wait_for_selector('.done-head, .rail .err', timeout=60000); p.wait_for_timeout(500)
        print(tid, 'result:', p.inner_text('.done-head') if p.query_selector('.done-head') else p.inner_text('.rail .err'), '| pwned =', p.evaluate('window.pwned'))
    p.goto(B)
    r = p.evaluate("""() => { const m = newPiiMap(); const t = '주민 900101-1234567 전화 010-1234-5678 메일 a@b.com 금액 1,250,000원'; const masked = maskPII(t, m); return {masked, back: unmaskPII(masked, m) === t, summary: piiSummary(m)}; }""")
    print('pii:', r)
    print('csp violations:', csp)
    br.close()
