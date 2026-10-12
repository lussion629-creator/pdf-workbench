import os, glob, subprocess
from playwright.sync_api import sync_playwright
B='http://127.0.0.1:47613/index.html'
with sync_playwright() as pw:
    br=pw.chromium.launch(args=['--no-sandbox']); p=br.new_page(); errs=[]; p.on('pageerror', lambda e: errs.append(str(e)))
    for tid, files, act in [('merge',['doc3.pdf','doc2.pdf'],None), ('ocr',['scan.pdf'],None), ('pdf2word',['doc3.pdf'],None), ('sign',['doc2.pdf'],'sign')]:
        p.goto('about:blank'); p.goto(B+'#'+tid)
        with p.expect_file_chooser() as fc: p.get_by_role('button',name='파일 선택').click()
        fc.value.set_files([os.path.join('fx',f) for f in files]); p.wait_for_timeout(1200)
        if act=='sign':
            p.locator('.ed-bar .tb',has_text='서명').first.click(); p.get_by_role('button',name='입력하기').click(); p.fill('#sig-name','홍길동'); p.get_by_role('button',name='서명 넣기').click(); p.wait_for_timeout(600)
        p.click('#runbtn'); p.wait_for_selector('.done-head, .rail .err', timeout=120000)
        p.locator('.out .btn').first.click(); p.wait_for_timeout(1200)
        print(tid, '| toast:', p.inner_text('#toast-host').replace('\n',' '))
    br.close()
print('errors:', errs)
for f in sorted(glob.glob('/tmp/claude-0/dl/PDF작업대/*')): print(' saved', os.path.basename(f), os.path.getsize(f), subprocess.run(['file','-b',f],capture_output=True,text=True).stdout.strip()[:40])
