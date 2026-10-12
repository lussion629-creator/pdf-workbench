import os, threading, http.server, functools
from playwright.sync_api import sync_playwright
DIST='/home/claude/pdfapp/dist/app'
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
srv=http.server.ThreadingHTTPServer(('127.0.0.1',8766),functools.partial(Q,directory=DIST)); threading.Thread(target=srv.serve_forever,daemon=True).start()
B='http://127.0.0.1:8766/index.html'
with sync_playwright() as pw:
    br=pw.chromium.launch(args=['--no-sandbox'])
    for name, vp, scheme in [('home_desk',{'width':1280,'height':900},'light'),('home_mob_dark',{'width':390,'height':844},'dark')]:
        p=br.new_page(viewport=vp, color_scheme=scheme); p.goto(B); p.wait_for_selector('.card'); p.wait_for_timeout(500); p.screenshot(path=f'/tmp/claude-0/{name}.png'); p.close()
    p=br.new_page(viewport={'width':1280,'height':900}); p.goto(B+'#organize'); 
    with p.expect_file_chooser() as fc: p.get_by_role('button',name='파일 선택').click()
    fc.value.set_files(['fx/doc3.pdf','fx/doc2.pdf']); p.wait_for_timeout(2000); p.screenshot(path='/tmp/claude-0/organize.png'); p.close()
    p=br.new_page(viewport={'width':1280,'height':900}, color_scheme='dark'); p.goto(B+'#sign')
    with p.expect_file_chooser() as fc: p.get_by_role('button',name='파일 선택').click()
    fc.value.set_files(['fx/doc2.pdf']); p.wait_for_timeout(2000); p.locator('.ed-bar .tb',has_text='서명').first.click(); p.wait_for_timeout(400); p.screenshot(path='/tmp/claude-0/sign.png'); p.close()
    p=br.new_page(viewport={'width':390,'height':844}); p.goto(B+'#compress')
    with p.expect_file_chooser() as fc: p.get_by_role('button',name='파일 선택').click()
    fc.value.set_files(['fx/scan.pdf']); p.wait_for_timeout(1200); p.click('#runbtn'); p.wait_for_selector('.done-head'); p.wait_for_timeout(300); p.screenshot(path='/tmp/claude-0/mob_result.png', full_page=True)
    print('overflow', p.evaluate('document.documentElement.scrollWidth'), p.close())
    br.close()
