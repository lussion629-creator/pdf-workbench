/* ============ PDF 보안 ============ */
tool({id: 'unlock', cat: 'sec', code: 'OPEN', title: 'PDF 잠금 해제', desc: 'PDF의 암호와 사용 제한을 없애 자유롭게 쓸 수 있게 합니다.', multi: true, kw: '암호 해제 비밀번호 제거',
  opts: () => [S.files.some(f => f.locked) ? {id: 'pw', type: 'password', def: '', label: '열기 암호', hint: '파일을 열 때 쓰는 암호를 입력하세요. 여러 파일이면 같은 암호로 시도합니다.'} : {type: 'note', text: '열기 암호가 없는 파일입니다. 인쇄·복사 제한만 걸려 있다면 그대로 해제합니다.'},
    {type: 'note', text: '본인 소유이거나 해제할 권한이 있는 문서에만 사용하세요.'}],
  ready: () => S.files.length > 0 && (!S.files.some(f => f.locked) || !!S.opts.pw), needMsg: '암호를 입력하세요.',
  action: '잠금 해제',
  async run(ctx){
    const outs = [];
    for (const f of ctx.files) {
      await fileBytes(f); let doc;
      try { doc = await PDFDocument.load(f.bytes, {password: ctx.o.pw || '', updateMetadata: false}); }
      catch (e) {
        if (/encrypt/i.test(e.message || '') || /password/i.test(e.message || '')) throw userErr(`"${f.name}"의 암호가 맞지 않습니다. 다시 확인해 주세요.`);
        try { doc = await PDFDocument.load(f.bytes, {updateMetadata: false}); } catch (e2) { throw userErr(`"${f.name}"을(를) 열지 못했습니다.`); }
      }
      doc.context.trailerInfo.Encrypt = undefined;
      const blob = pdfBlob(await doc.save({useObjectStreams: true}));
      // verify the copy really opens without a password
      try { await openPdfjs(new Uint8Array(await blob.arrayBuffer())).promise; }
      catch (e) { if (isPwErr(e)) throw userErr(`"${f.name}"의 암호를 풀지 못했습니다.`); }
      outs.push({name: baseName(f.name) + '_잠금해제.pdf', blob});
    }
    return {outputs: outs, zipName: '잠금해제_PDF.zip'};
  }});

tool({id: 'protect', cat: 'sec', code: 'LOCK', title: 'PDF 보호', desc: 'PDF에 암호를 걸어 허락받지 않은 사람이 열지 못하게 합니다.', kw: '암호 비밀번호 잠금 암호화',
  opts: [{id: 'pw', type: 'password', def: '', label: '암호', live: true},
    {id: 'pw2', type: 'password', def: '', label: '암호 확인', live: true, hint: o => o.pw && o.pw2 && o.pw !== o.pw2 ? '두 암호가 다릅니다.' : '잊어버리면 되찾을 방법이 없습니다.'},
    {id: 'print', type: 'check', def: true, label: '인쇄 허용'}, {id: 'copy', type: 'check', def: true, label: '내용 복사 허용'}, {id: 'mod', type: 'check', def: false, label: '수정 허용'},
    {type: 'note', text: 'AES-256 방식으로 암호화합니다. 위 권한 설정은 관리자 암호(무작위로 만들어 따로 보여 드림)가 있어야 바꿀 수 있습니다.'}],
  ready: () => S.files.length && S.opts.pw && S.opts.pw === S.opts.pw2, needMsg: '같은 암호를 두 번 입력하세요.',
  action: 'PDF 암호 걸기',
  async run(ctx){
    const f = ctx.files[0]; const doc = await libDoc(f); const owner = hexId().slice(0, 16);
    doc.encrypt({userPassword: ctx.o.pw, ownerPassword: owner, permissions: {printing: ctx.o.print ? 'highResolution' : false, copying: !!ctx.o.copy, modifying: !!ctx.o.mod, annotating: !!ctx.o.mod, fillingForms: true, contentAccessibility: true, documentAssembly: !!ctx.o.mod}});
    const blob = pdfBlob(await doc.save({useObjectStreams: false}));
    const ownerBox = h('div', {class: 'note'}, '관리자 암호: ', h('code', {style: {fontFamily: 'var(--f-mono)', userSelect: 'all'}}, owner), ' — 권한을 바꿀 때 필요합니다. 따로 적어 두세요.');
    return {outputs: [{name: baseName(f.name) + '_보호.pdf', blob}], summary: '이제 이 파일을 열려면 암호가 필요합니다.', view: ownerBox};
  }});

/* signatures */
function trimCanvas(c){
  const g = c.getContext('2d', {willReadFrequently: true}); const d = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 10) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null; const p = 6;
  const o = document.createElement('canvas'); o.width = x1 - x0 + p * 2; o.height = y1 - y0 + p * 2; o.getContext('2d').drawImage(c, x0 - p, y0 - p, o.width, o.height, 0, 0, o.width, o.height); return o;
}
function loadSigs(){ try { return JSON.parse(localStorage.getItem('pdfwb.sigs') || '[]'); } catch (e) { return []; } }
function storeSigs(a){ try { if (a.length) localStorage.setItem('pdfwb.sigs', JSON.stringify(a.slice(0, 6))); else localStorage.removeItem('pdfwb.sigs'); } catch (e) {} }
function signModal(kind, done){
  const close = () => m.remove();
  let tab = 'draw', color = '#16204a', typed = '', font = 'Nanum Pen Script', upload = null, rmBg = true;
  const pad = h('canvas', {class: 'sigpad', width: 1000, height: 400, 'aria-label': '서명 그리는 곳'});
  const body = h('div', {style: {display: 'grid', gap: '12px'}});
  const fonts = ['Nanum Pen Script', 'Nanum Brush Script', 'Gaegu', 'IBM Plex Sans KR'];
  const saved = loadSigs();
  const draw = () => {
    body.innerHTML = '';
    body.append(h('div', {class: 'seg'}, [['draw', '직접 그리기'], ['type', '입력하기'], ['upload', '이미지 올리기']].map(([k, l]) => h('button', {type: 'button', 'aria-pressed': String(tab === k), onclick: () => { tab = k; draw(); }}, l))));
    const sw = h('div', {class: 'swatches'}, ['#111111', '#16204a', '#2747d4', '#c8323f'].map(c => h('button', {type: 'button', 'aria-label': c, style: {background: c}, 'aria-pressed': String(color === c), onclick: () => { color = c; draw(); }})));
    if (tab === 'draw') {
      const g = pad.getContext('2d'); g.lineCap = 'round'; g.lineJoin = 'round';
      body.append(pad, h('div', {class: 'row'}, sw, h('span', {class: 'sp', style: {flex: 1}}), h('button', {class: 'btn ghost small', type: 'button', onclick: () => g.clearRect(0, 0, pad.width, pad.height)}, '지우기')));
      let last = null;
      pad.onpointerdown = e => { pad.setPointerCapture(e.pointerId); const r = pad.getBoundingClientRect(); last = [(e.clientX - r.left) * pad.width / r.width, (e.clientY - r.top) * pad.height / r.height]; };
      pad.onpointermove = e => { if (!last) return; const r = pad.getBoundingClientRect(); const p = [(e.clientX - r.left) * pad.width / r.width, (e.clientY - r.top) * pad.height / r.height]; g.strokeStyle = color; g.lineWidth = 7 + (e.pressure && e.pressure !== 0.5 ? e.pressure * 6 : 0); g.beginPath(); g.moveTo(...last); g.lineTo(...p); g.stroke(); last = p; };
      pad.onpointerup = () => last = null;
    } else if (tab === 'type') {
      const inp = h('input', {class: 'in', id: 'sig-name', placeholder: kind === 'initials' ? '이니셜 (예: 홍길동 → ㅎㄱㄷ)' : '이름', value: typed, oninput: e => { typed = e.target.value; list.querySelectorAll('button').forEach(b => b.textContent = typed || '서명'); }});
      const list = h('div', {class: 'sigtypes'}, fonts.map(fm => h('button', {type: 'button', style: {fontFamily: `"${fm}",cursive`, color}, 'aria-pressed': String(font === fm), onclick: () => { font = fm; draw(); }}, typed || '서명')));
      body.append(inp, list, sw); setTimeout(() => inp.focus());
    } else {
      body.append(h('div', {class: 'row'}, h('button', {class: 'btn ghost', type: 'button', onclick: () => pickImage(src => { upload = src; draw(); })}, '서명·도장 이미지 고르기')),
        upload ? h('img', {src: upload, alt: '', style: {maxHeight: '140px', background: '#fff', border: '1px solid var(--line)', borderRadius: '8px'}}) : null,
        h('label', {class: 'chk'}, h('input', {type: 'checkbox', checked: rmBg, onchange: e => rmBg = e.target.checked}), '흰 배경 지우기 (도장·종이 서명 사진에 좋습니다)'));
    }
    if (saved.length) body.append(h('div', {class: 'fld'}, h('div', {class: 'lb'}, '저장해 둔 서명'), h('div', {class: 'row'}, saved.map(s => h('button', {type: 'button', class: 'btn ghost small', style: {background: '#fff', padding: '4px'}, onclick: () => { close(); done(s); }}, h('img', {src: s, alt: '저장된 서명', style: {height: '36px'}}))),
      h('button', {type: 'button', class: 'btn ghost small', onclick: () => { storeSigs([]); saved.length = 0; toast('이 기기에 저장된 서명을 모두 지웠습니다.'); draw(); }}, '저장된 서명 모두 지우기'))));
  };
  const finish = async () => {
    let c;
    if (tab === 'draw') c = trimCanvas(pad);
    else if (tab === 'type') {
      if (!typed.trim()) { toast('서명할 이름을 입력하세요.'); return; }
      try { await document.fonts.load(`160px "${font}"`, typed); } catch (e) {}
      const t = document.createElement('canvas'); t.width = 1600; t.height = 360; const g = t.getContext('2d'); g.font = `160px "${font}",cursive`; g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(typed, 20, 180); c = trimCanvas(t);
    } else {
      if (!upload) { toast('이미지를 고르세요.'); return; }
      const im = new Image(); im.src = upload; await im.decode(); const t = document.createElement('canvas'); t.width = im.naturalWidth; t.height = im.naturalHeight; const g = t.getContext('2d'); g.drawImage(im, 0, 0);
      if (rmBg) { const d = g.getImageData(0, 0, t.width, t.height); for (let i = 0; i < d.data.length; i += 4) { const l = (d.data[i] + d.data[i + 1] + d.data[i + 2]) / 3; if (l > 205) d.data[i + 3] = 0; else if (l > 160) d.data[i + 3] = Math.round((205 - l) / 45 * 255); } g.putImageData(d, 0, 0); }
      c = trimCanvas(t);
    }
    if (!c) { toast('서명을 먼저 그려 주세요.'); return; }
    const url = c.toDataURL('image/png');
    if (keep.checked) storeSigs([url, ...saved.filter(s => s !== url)]);
    close(); done(url);
  };
  const keep = h('input', {type: 'checkbox', checked: false});
  const m = h('div', {class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': '서명 만들기', onclick: e => { if (e.target === m) close(); }},
    h('div', {class: 'box'}, h('h3', {}, kind === 'initials' ? '이니셜 만들기' : '서명 만들기'), body,
      h('label', {class: 'chk'}, keep, h('span', {}, '이 기기에 서명 저장해 두기', h('div', {class: 'hint'}, '공용 컴퓨터에서는 켜지 마세요. 같은 기기를 쓰는 사람이 서명을 불러올 수 있습니다.'))),
      h('div', {class: 'row', style: {justifyContent: 'flex-end'}}, h('button', {class: 'btn ghost', type: 'button', onclick: close}, '취소'), h('button', {class: 'btn', type: 'button', onclick: finish}, '서명 넣기'))));
  document.body.append(m); draw();
}
editorTool({id: 'sign', cat: 'sec', code: 'SIGN', title: 'PDF에 서명하기', desc: '직접 그리거나 입력한 서명, 도장 이미지를 PDF에 넣습니다.', kw: '전자서명 사인 도장',
  ed: {tools: ['select', 'sign', 'initials', 'date', 'text'], onSign(kind){ signModal(kind, src => addImageObj(src, kind === 'initials' ? 0.1 : 0.25)); }},
  opts: () => [{type: 'note', text: '"서명"을 눌러 서명을 만든 뒤, 페이지 위에서 끌어 위치를 정하고 오른쪽 아래 모서리로 크기를 맞추세요. 여러 페이지에 넣을 수 있습니다.'}, ...edPropsRail().map(n => ({type: 'custom', render: () => n}))],
  ready: () => S.ed && Object.values(S.ed.objs).some(a => a.length), needMsg: '서명을 하나 이상 넣으세요.',
  action: '서명한 PDF 저장',
  async run(ctx){ const f = ctx.files[0]; const doc = await libDoc(f); await applyObjects(doc, S.ed.objs); return {outputs: [{name: baseName(f.name) + '_서명.pdf', blob: await saveDoc(doc)}]}; }});

/* redact */
const REDACT_PATTERNS = {rrn: [/\d{6}\s?-\s?[1-4]\d{6}/g, '주민등록번호'], phone: [/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}|0\d{1,2}-\d{3,4}-\d{4}/g, '전화번호'], email: [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '이메일'], card: [/\d{4}[-\s]\d{4}[-\s]\d{4}[-\s]\d{4}/g, '카드번호']};
async function findRedactions(query, pats){
  const f = S.files[0]; const d = await pjs(f); let n = 0;
  const regs = []; if (query.trim()) regs.push(new RegExp(query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'));
  pats.forEach(k => regs.push(new RegExp(REDACT_PATTERNS[k][0].source, 'g')));
  for (let i = 1; i <= d.numPages; i++) {
    const t = await pageTextItems(await d.getPage(i));
    for (const it of t.items) {
      const cw = it.w / Math.max(1, it.str.length);
      for (const re of regs) { re.lastIndex = 0; let m; while ((m = re.exec(it.str))) { if (!m[0]) { re.lastIndex++; continue; } edObjs(i).push({kind: 'redact', x: it.x + m.index * cw - 1, y: it.y - it.h * 0.08, w: m[0].length * cw + 2, h: it.h * 1.22}); n++; } }
    }
  }
  return n;
}
editorTool({id: 'redact', cat: 'sec', code: '███', title: 'PDF 검열', desc: '민감한 글자와 그림을 검은 상자로 영구히 지웁니다.', kw: '가리기 마스킹 개인정보 블라인드',
  ed: {tools: ['select', 'redact']},
  opts: () => [
    {type: 'note', text: '"가리기 상자"로 페이지 위를 끌어 영역을 고르거나, 아래에서 찾아 자동으로 가리세요. 가린 페이지는 이미지로 다시 만들어 밑의 글자가 완전히 사라집니다.'},
    {id: 'q', type: 'text', def: '', label: '찾아서 가릴 단어', placeholder: '예: 홍길동'},
    {id: 'pats', type: 'custom', render: () => h('div', {class: 'fld'}, h('div', {class: 'lb'}, '개인정보 자동 찾기'), Object.entries(REDACT_PATTERNS).map(([k, [, l]]) => h('label', {class: 'chk'}, h('input', {type: 'checkbox', checked: (S.opts.pats || []).includes(k), onchange: e => { const s = new Set(S.opts.pats || []); e.target.checked ? s.add(k) : s.delete(k); S.opts.pats = [...s]; }}), l)),
      h('button', {class: 'btn ghost small', type: 'button', onclick: async () => { const n = await findRedactions(S.opts.q || '', S.opts.pats || []); toast(n ? `${n}곳을 찾아 가렸습니다. 확인 후 저장하세요.` : '찾은 곳이 없습니다.'); drawStage(); drawRail(); }}, '찾아서 표시하기'))},
    {id: 'meta', type: 'check', def: true, label: '작성자 같은 문서 정보도 지우기'},
    ...edPropsRail().map(n => ({type: 'custom', render: () => n}))],
  ready: () => S.ed && Object.values(S.ed.objs).some(a => a.some(o => o.kind === 'redact')), needMsg: '가릴 영역을 하나 이상 고르세요.',
  action: '검열 적용',
  async run(ctx){
    const f = ctx.files[0]; const src = await libDoc(f); const d = await pjs(f); const out = await PDFDocument.create();
    const n = src.getPageCount(); let red = 0;
    for (let i = 1; i <= n; i++) {
      await ctx.progress(i / n, `${i}/${n}쪽 처리 중`);
      const boxes = (S.ed.objs[i] || []).filter(o => o.kind === 'redact');
      if (!boxes.length) { const [cp] = await out.copyPages(src, [i - 1]); out.addPage(cp); continue; }
      const p = await d.getPage(i); const sc = 2.5; const c = await renderPage(p, sc); const g = c.getContext('2d'); g.fillStyle = '#000';
      boxes.forEach(b => g.fillRect(b.x * sc, b.y * sc, b.w * sc, b.h * sc)); red += boxes.length;
      const vp = p.getViewport({scale: 1}); const img = await embedCanvas(out, c, 0.9); out.addPage([vp.width, vp.height]).drawImage(img, {x: 0, y: 0, width: vp.width, height: vp.height});
    }
    if (ctx.o.meta) { out.setTitle(''); out.setAuthor(''); out.setSubject(''); out.setKeywords([]); out.setProducer('PDF 작업대'); out.setCreator('PDF 작업대'); }
    else { try { const t = src.getTitle(); if (t) out.setTitle(t); const a = src.getAuthor(); if (a) out.setAuthor(a); } catch (e) {} }
    return {outputs: [{name: baseName(f.name) + '_검열.pdf', blob: await saveDoc(out)}], summary: `${red}곳을 영구히 지웠습니다.`};
  }});

/* compare */
function tokenize(s){ return s.match(/\S+|\n/g) || []; }
function diffHtml(tokens, cls, tag){
  const frag = document.createDocumentFragment(); let buf = ''; let mode = false;
  const flush = () => { if (!buf) return; if (mode) frag.append(h(tag, {class: cls}, buf)); else frag.append(buf); buf = ''; };
  for (const t of tokens) { if (!!t.ch !== mode) { flush(); mode = !!t.ch; } buf += t.t === '\n' ? '\n' : t.t + ' '; }
  flush(); return frag;
}
tool({id: 'compare', cat: 'sec', code: 'A≠B', title: 'PDF 비교', desc: '두 PDF를 나란히 놓고 달라진 글자와 모양을 표시합니다.', multi: true, min: 2, kw: '차이 버전 변경점 diff',
  long: '원본과 수정본 PDF를 넣으면 페이지별로 바뀐 단어와 달라진 부분을 표시합니다. 첫 번째 파일을 원본으로 봅니다.',
  needMsg: () => S.files.length < 2 ? '비교할 PDF 두 개를 넣어 주세요.' : '', onFiles(){ if (S.files.length > 2) { S.files = S.files.slice(-2); toast('최근에 넣은 두 파일로 비교합니다.'); } },
  opts: [{id: 'mode', type: 'seg', def: 'text', label: '비교 방식', choices: [['text', '글자 비교'], ['visual', '모양 비교']], hint: o => o.mode === 'text' ? '바뀐 단어를 빨강(삭제)과 초록(추가)으로 표시합니다.' : '두 페이지를 겹쳐 다른 부분을 분홍색으로 표시합니다.'}],
  action: '비교하기',
  async run(ctx){
    const [A, B] = ctx.files;
    if (ctx.o.mode === 'visual') {
      const da = await pjs(A), db = await pjs(B); const n = Math.max(da.numPages, db.numPages); const figs = []; let changed = 0;
      for (let i = 1; i <= Math.min(n, 40); i++) {
        await ctx.progress(i / n, `${i}쪽 비교 중`);
        if (i > da.numPages || i > db.numPages) { figs.push(h('figure', {}, h('figcaption', {}, `${i}쪽: ${i > da.numPages ? '수정본에만 있음' : '원본에만 있음'}`))); changed++; continue; }
        const W = 520; const pa = await da.getPage(i), pb = await db.getPage(i);
        const ca = await renderPage(pa, W / pa.getViewport({scale: 1}).width), cb = await renderPage(pb, W / pb.getViewport({scale: 1}).width);
        const out = document.createElement('canvas'); out.width = cb.width; out.height = cb.height; const go = out.getContext('2d'); go.drawImage(cb, 0, 0);
        const A_ = ca.getContext('2d').getImageData(0, 0, Math.min(ca.width, cb.width), Math.min(ca.height, cb.height)), B_ = go.getImageData(0, 0, A_.width, A_.height); let diff = 0;
        for (let p = 0; p < A_.data.length; p += 4) { const dd = Math.abs(A_.data[p] - B_.data[p]) + Math.abs(A_.data[p + 1] - B_.data[p + 1]) + Math.abs(A_.data[p + 2] - B_.data[p + 2]); if (dd > 90) { B_.data[p] = 255; B_.data[p + 1] = 0; B_.data[p + 2] = 160; diff++; } else { B_.data[p] = 255 - (255 - B_.data[p]) * 0.45; B_.data[p + 1] = 255 - (255 - B_.data[p + 1]) * 0.45; B_.data[p + 2] = 255 - (255 - B_.data[p + 2]) * 0.45; } }
        go.putImageData(B_, 0, 0); if (diff > 30) changed++;
        figs.push(h('figure', {}, out, h('figcaption', {}, `${i}쪽 · ${diff > 30 ? '다른 부분 있음' : '같음'}`)));
      }
      return {outputs: [], title: changed ? `${changed}쪽에서 차이를 찾았습니다` : '두 문서의 모양이 같습니다', summary: `${A.name} ↔ ${B.name}`,
        view: h('div', {style: {display: 'grid', gap: '12px'}}, h('div', {class: 'legend'}, h('span', {}, h('i', {style: {background: '#ff00a0'}}), '달라진 부분')), h('div', {class: 'visual-diff'}, figs))};
    }
    const ta = await docText(A, p => ctx.progress(p * 0.4, '원본 글자 읽는 중'), ctx.signal), tb = await docText(B, p => ctx.progress(0.4 + p * 0.4, '수정본 글자 읽는 중'), ctx.signal);
    const n = Math.max(ta.length, tb.length); const rows = []; let del = 0, add = 0; const report = [];
    for (let i = 0; i < n; i++) {
      const a = tokenize(ta[i] ? ta[i].text : ''), b = tokenize(tb[i] ? tb[i].text : '');
      const df = diffTokens(a, b); const dc = df.a.filter(t => t.ch && t.t !== '\n').length, ac = df.b.filter(t => t.ch && t.t !== '\n').length; del += dc; add += ac;
      if (!dc && !ac) continue;
      const left = h('div', {class: 'cmpcol'}, h('h4', {}, `${i + 1}쪽 · 원본 (−${dc})`), diffHtml(df.a, 'd', 'del'));
      const right = h('div', {class: 'cmpcol'}, h('h4', {}, `${i + 1}쪽 · 수정본 (+${ac})`), diffHtml(df.b, 'a', 'ins'));
      rows.push(h('div', {class: 'cmpgrid'}, left, right)); report.push(`<h3>${i + 1}쪽</h3><div class="g"><div>${left.innerHTML}</div><div>${right.innerHTML}</div></div>`);
      await ctx.progress(0.8 + 0.2 * i / n);
    }
    if (!ta.some(p => p.text.trim()) && !tb.some(p => p.text.trim())) throw userErr('두 파일 모두 글자가 없습니다(스캔 문서). "모양 비교"를 쓰거나 OCR을 먼저 실행하세요.');
    const html = `<!doctype html><meta charset="utf-8"><title>PDF 비교 결과</title><style>body{font-family:sans-serif;max-width:1100px;margin:24px auto;padding:0 16px}.g{display:grid;grid-template-columns:1fr 1fr;gap:12px}.g>div{white-space:pre-wrap;border:1px solid #ddd;padding:12px;border-radius:8px}del{background:#ffd6d9}ins{background:#c9f2dc;text-decoration:none}h4{margin:0 0 8px;color:#666}</style><h1>PDF 비교 결과</h1><p>원본: ${xmlEsc(A.name)}<br>수정본: ${xmlEsc(B.name)}<br>삭제 ${del}단어 · 추가 ${add}단어</p>${report.join('')}`;
    return {outputs: rows.length ? [{name: '비교결과.html', blob: new Blob([html], {type: 'text/html'})}] : [], title: rows.length ? `${rows.length}쪽에서 바뀐 부분을 찾았습니다` : '글자 내용이 같습니다', summary: `삭제 ${del}단어 · 추가 ${add}단어`,
      view: h('div', {style: {display: 'grid', gap: '12px'}}, h('div', {class: 'legend'}, h('span', {}, h('i', {style: {background: 'color-mix(in srgb,var(--danger) 30%,transparent)'}}), '원본에서 삭제'), h('span', {}, h('i', {style: {background: 'color-mix(in srgb,var(--ok) 35%,transparent)'}}), '수정본에 추가')), rows)};
  }});
