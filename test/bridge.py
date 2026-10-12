import threading, http.server, functools
from playwright.sync_api import sync_playwright
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
srv=http.server.ThreadingHTTPServer(('127.0.0.1',8767),functools.partial(Q,directory='/home/claude/pdfapp/dist/app')); threading.Thread(target=srv.serve_forever,daemon=True).start()
with sync_playwright() as pw:
    br=pw.chromium.launch(args=['--no-sandbox']); p=br.new_page()
    p.add_init_script("window.AndroidBridge={saveFile:(n,m,b)=>{window._saved=[n,m,b.length,b.slice(0,8)];return 'Download/PDF작업대/'+n}}")
    p.goto('http://127.0.0.1:8767/index.html#merge')
    with p.expect_file_chooser() as fc: p.get_by_role('button',name='파일 선택').click()
    fc.value.set_files(['fx/doc3.pdf','fx/doc2.pdf']); p.wait_for_timeout(800); p.click('#runbtn'); p.wait_for_selector('.done-head')
    p.locator('.out .btn').first.click(); p.wait_for_timeout(500)
    print('saved', p.evaluate('window._saved'), '| toast:', p.inner_text('#toast-host'))
    print('ai desc:', p.evaluate("TOOLS.find(t=>t.id==='summarize').desc"))
    br.close()
