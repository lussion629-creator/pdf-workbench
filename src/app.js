/* ============ app state & shell ============ */
const S = {tool: null, files: [], opts: {}, result: null, cat: 'all', q: '', pages: null, error: null};
let FID = 0;
const CATS = [['org', 'PDF 구성'], ['opt', 'PDF 최적화'], ['to', 'PDF로 변환'], ['from', 'PDF에서 변환'], ['edit', 'PDF 편집'], ['sec', 'PDF 보안'], ['ai', 'PDF 분석']];
const TOOLS = [];
function tool(t){ TOOLS.push(t); return t; }
const ACCEPT = {
  pdf: {acc: '.pdf,application/pdf', ok: f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf', label: 'PDF'},
  image: {acc: 'image/*', ok: f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp)$/i.test(f.name), label: 'JPG, PNG 등 이미지'},
  docx: {acc: '.docx', ok: f => /\.docx$/i.test(f.name), label: 'Word(.docx)'},
  pptx: {acc: '.pptx', ok: f => /\.pptx$/i.test(f.name), label: 'PowerPoint(.pptx)'},
  xlsx: {acc: '.xlsx,.xls,.csv,.ods', ok: f => /\.(xlsx|xls|csv|ods)$/i.test(f.name), label: 'Excel(.xlsx, .xls, .csv)'},
  html: {acc: '.html,.htm', ok: f => /\.html?$/i.test(f.name) || f.type === 'text/html', label: 'HTML'}
};
const app = $('#app');

function topbar(){
  return h('header', {class: 'top'},
    h('button', {class: 'brand', type: 'button', onclick: () => go(null)}, h('span', {class: 'brand-mark'}, h('i'), h('i')), 'PDF 작업대'),
    h('div', {class: 'local'}, h('span', {class: 'dot'}), h('span', {}, '파일은 ', h('b', {}, '이 기기 안에서만'), ' 처리됩니다')));
}
function go(id, files){
  const t = id ? TOOLS.find(x => x.id === id) : null;
  S.tool = t; S.files = []; S.opts = {}; S.result = null; S.pages = null; S.error = null; S.ed = null;
  try { history.replaceState(null, '', id ? '#' + id : location.pathname + location.search); } catch (e) {}
  render(); window.scrollTo(0, 0);
  if (t && files && files.length) intake(files);
}
function render(){ if (S.tool) renderTool(); else renderHome(); }

function renderHome(){
  const filt = h('div', {class: 'filters', role: 'toolbar', 'aria-label': '분류'},
    [['all', '모두'], ...CATS].map(([k, l]) => h('button', {class: 'chip', type: 'button', 'aria-pressed': String(S.cat === k), onclick: () => { S.cat = k; renderHome(); }}, l)),
    h('input', {class: 'search', id: 'q', type: 'search', placeholder: '도구 찾기 (예: 압축, 서명)', value: S.q, oninput: e => { S.q = e.target.value; drawShelf(); }}));
  const shelf = h('div', {class: 'shelf', id: 'shelf'});
  app.replaceChildren(topbar(),
    h('section', {class: 'hero'},
      h('h1', {}, 'PDF 작업에 필요한 도구 ', TOOLS.length, '가지를 한곳에'),
      h('p', {}, '합치기, 나누기, 압축, 변환, 서명, OCR까지. 서버에 올리지 않고 이 기기 안에서 바로 처리하므로 계약서나 신분증처럼 민감한 문서도 밖으로 나가지 않습니다.')),
    filt, shelf,
    h('footer', {class: 'foot'}, h('span', {}, 'AI 요약과 번역만 Claude에게 텍스트를 보내며, 실행 전에 허용 여부를 묻습니다.'), h('span', {}, '결과물은 저장 버튼으로 내려받습니다.')));
  drawShelf();
  const qi = $('#q'); if (S.q && qi) { qi.focus(); qi.setSelectionRange(S.q.length, S.q.length); }
}
function drawShelf(){
  const shelf = $('#shelf'); if (!shelf) return; shelf.innerHTML = '';
  const q = S.q.trim().toLowerCase();
  for (const [k, label] of CATS) {
    if (S.cat !== 'all' && S.cat !== k) continue;
    const list = TOOLS.filter(t => t.cat === k && (!q || (t.title + t.desc + (t.kw || '')).toLowerCase().includes(q)));
    if (!list.length) continue;
    shelf.append(h('section', {}, h('h2', {}, label), h('div', {class: 'grid'}, list.map(card))));
  }
  if (!shelf.children.length) shelf.append(h('p', {class: 'note'}, `"${S.q}"에 맞는 도구가 없습니다. 다른 단어로 찾아보세요.`));
}
function card(t){
  return h('button', {class: 'card', type: 'button', 'data-cat': t.cat, onclick: () => go(t.id)},
    h('span', {class: 'sheet', 'data-cat': t.cat}, t.code),
    h('span', {class: 't'}, t.title, t.isNew ? h('span', {class: 'new'}, 'AI') : null),
    h('span', {class: 'd'}, t.desc));
}

/* ============ tool view ============ */
function renderTool(){
  const t = S.tool;
  app.replaceChildren(topbar(),
    h('div', {class: 'tool-head'},
      h('button', {class: 'back', type: 'button', onclick: () => go(null)}, '← 모든 도구'),
      h('span', {class: 'sheet big', 'data-cat': t.cat}, t.code),
      h('div', {}, h('h1', {}, t.title), h('p', {}, t.long || t.desc))),
    h('div', {class: 'bench'}, h('section', {class: 'stage', id: 'stage', 'aria-label': '작업 영역'}), h('aside', {class: 'rail', id: 'rail', 'aria-label': '설정'})));
  drawStage(); drawRail();
}
function acceptOf(t){ return ACCEPT[t.accept || 'pdf']; }
function pickFiles(capture){
  const t = S.tool; const a = acceptOf(t);
  const inp = h('input', {type: 'file', accept: a.acc, multiple: !!t.multi || null, style: {display: 'none'}});
  if (capture) inp.setAttribute('capture', 'environment');
  inp.onchange = () => { intake([...inp.files]); inp.remove(); };
  document.body.append(inp); inp.click();
}
function dropzone(){
  const t = S.tool; const a = acceptOf(t);
  const z = h('div', {class: 'drop'},
    h('span', {class: 'sheet big', 'data-cat': t.cat}, t.code),
    h('strong', {}, t.multi ? `${a.label} 파일을 여기로 끌어 놓으세요` : `${a.label} 파일을 여기로 끌어 놓으세요`),
    h('small', {}, t.multi ? '여러 개를 한 번에 놓을 수 있습니다' : '파일 하나를 선택하세요'),
    h('div', {class: 'row', style: {justifyContent: 'center'}},
      h('button', {class: 'btn', type: 'button', onclick: () => pickFiles()}, '파일 선택'),
      t.camera ? h('button', {class: 'btn ghost', type: 'button', onclick: () => pickFiles(true)}, '카메라로 촬영') : null),
    t.dropExtra ? t.dropExtra() : null);
  wireDrop(z);
  return z;
}
function wireDrop(z){
  z.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); z.classList.add('over'); } });
  z.addEventListener('dragleave', () => z.classList.remove('over'));
  z.addEventListener('drop', e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); z.classList.remove('over'); intake([...e.dataTransfer.files]); });
}
document.addEventListener('paste', e => {
  if (!S.tool || S.result) return; const fs = [...(e.clipboardData && e.clipboardData.files || [])];
  if (fs.length) { e.preventDefault(); intake(fs); }
});
async function intake(list){
  const t = S.tool; const a = acceptOf(t);
  const good = list.filter(a.ok); const bad = list.length - good.length;
  if (bad) toast(`${a.label} 파일만 넣을 수 있습니다. ${bad}개를 건너뛰었습니다.`);
  if (!good.length) return;
  const items = good.map(f => ({id: ++FID, file: f, name: f.name, size: f.size, type: f.type}));
  if (t.multi) S.files.push(...items); else { S.files = [items[0]]; S.pages = null; }
  S.result = null; S.error = null;
  if (t.accept === undefined || t.accept === 'pdf') {
    for (const f of items) {
      try { const d = await pjs(f); f.pages = d.numPages; }
      catch (e) { if (isPwErr(e)) f.locked = true; else f.broken = true; }
    }
  }
  if (t.onFiles) { try { await t.onFiles(); } catch (e) { S.error = e.user ? e.message : String(e.message || e); } }
  drawStage(); drawRail();
}
function drawStage(){
  const st = $('#stage'); if (!st) return; st.innerHTML = '';
  const t = S.tool;
  if (S.result) return resultsView(st);
  if (!S.files.length && !t.noFileStage) { st.append(dropzone()); return; }
  if (t.stage) t.stage(st); else fileList(st);
}
function fileMeta(f){
  if (f.locked) return '암호 보호됨';
  if (f.broken) return '읽기 오류 · ' + fmtSize(f.size);
  return (f.pages ? f.pages + '쪽 · ' : '') + fmtSize(f.size);
}
function fileThumb(f, box){
  const t = S.tool;
  if (/^image\//.test(f.type)) { const img = h('img', {alt: ''}); img.src = f.url ||= URL.createObjectURL(f.file); box.append(img); return; }
  if (t.accept && t.accept !== 'pdf') { box.append(h('span', {class: 'sheet big', 'data-cat': t.cat}, (f.name.split('.').pop() || '').toUpperCase().slice(0, 4))); return; }
  if (f.locked || f.broken) { box.append(h('span', {class: 'sheet big', 'data-cat': 'sec'}, f.locked ? 'LOCK' : '?')); return; }
  renderFit(f, 1, 160, 210).then(c => { box.innerHTML = ''; box.append(c); }).catch(() => {});
}
function fileList(st){
  const t = S.tool;
  st.append(h('div', {class: 'stage-bar'},
    h('span', {}, S.files.length + '개 파일'), h('span', {class: 'sp'}),
    t.multi && S.files.length > 1 ? h('button', {class: 'btn ghost small', type: 'button', onclick: () => { S.files.sort((a, b) => a.name.localeCompare(b.name, 'ko', {numeric: true})); drawStage(); }}, '이름순 정렬') : null,
    h('button', {class: 'btn ghost small', type: 'button', onclick: () => pickFiles()}, t.multi ? '+ 파일 추가' : '다른 파일 선택')));
  const grid = h('div', {class: 'files'});
  let dragId = null;
  S.files.forEach((f, i) => {
    const thumb = h('div', {class: 'thumb'});
    const c = h('div', {class: 'fcard', draggable: t.multi ? 'true' : null},
      h('div', {class: 'tools'},
        t.multi && i > 0 ? ib('left', '앞으로', () => { S.files.splice(i - 1, 0, S.files.splice(i, 1)[0]); drawStage(); }) : null,
        t.multi && i < S.files.length - 1 ? ib('right', '뒤로', () => { S.files.splice(i + 1, 0, S.files.splice(i, 1)[0]); drawStage(); }) : null,
        ib('x', '빼기', () => { S.files.splice(i, 1); S.pages = null; t.onFiles && t.onFiles(); drawStage(); drawRail(); })),
      thumb, h('div', {class: 'nm', title: f.name}, f.name), h('div', {class: 'meta'}, fileMeta(f)));
    if (t.multi) {
      c.addEventListener('dragstart', e => { dragId = f.id; c.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(f.id)); });
      c.addEventListener('dragend', () => c.classList.remove('dragging'));
      c.addEventListener('dragover', e => { if (dragId != null) e.preventDefault(); });
      c.addEventListener('drop', e => {
        if (dragId == null) return; e.preventDefault(); e.stopPropagation();
        const from = S.files.findIndex(x => x.id === dragId); const to = S.files.indexOf(f);
        if (from > -1 && to > -1 && from !== to) { S.files.splice(to, 0, S.files.splice(from, 1)[0]); drawStage(); }
        dragId = null;
      });
    }
    fileThumb(f, thumb); grid.append(c);
  });
  if (t.multi) { const add = h('button', {class: 'addmore', type: 'button', onclick: () => pickFiles()}, '+ 추가'); grid.append(add); }
  wireDrop(st);
  st.append(grid);
  const warn = S.files.filter(f => f.locked);
  if (warn.length && t.id !== 'unlock' && t.id !== 'repair') st.append(h('p', {class: 'note warn', style: {marginTop: '14px'}}, `암호로 보호된 파일이 있습니다: ${warn.map(f => f.name).join(', ')}. 'PDF 잠금 해제'로 먼저 암호를 제거하세요.`));
  if (t.stageExtra) st.append(t.stageExtra());
}

/* ============ options rail ============ */
function optVal(spec){ if (S.opts[spec.id] === undefined) S.opts[spec.id] = typeof spec.def === 'function' ? spec.def() : spec.def; return S.opts[spec.id]; }
function setOpt(id, v, redraw){
  S.opts[id] = v; const t = S.tool;
  if (t.onOpt) t.onOpt(id, v);
  if (redraw) drawRail(); else refreshReady();
}
function renderSpec(sp){
  const t = S.tool;
  if (sp.show && !sp.show(S.opts)) return null;
  const v = sp.type === 'note' || sp.type === 'custom' ? null : optVal(sp);
  const lab = sp.label ? h('label', {for: 'o-' + sp.id}, sp.label) : null;
  const hint = sp.hint ? h('div', {class: 'hint'}, typeof sp.hint === 'function' ? sp.hint(S.opts) : sp.hint) : null;
  let ctl;
  switch (sp.type) {
    case 'note': return h('div', {class: 'note' + (sp.warn ? ' warn' : '')}, typeof sp.text === 'function' ? sp.text(S.opts) : sp.text);
    case 'custom': return sp.render();
    case 'seg':
      ctl = h('div', {class: 'seg', role: 'group', 'aria-label': sp.label || ''}, sp.choices.map(([cv, cl]) => h('button', {type: 'button', 'aria-pressed': String(v === cv), onclick: () => setOpt(sp.id, cv, true)}, cl)));
      return h('div', {class: 'fld'}, sp.label ? h('div', {class: 'lb'}, sp.label) : null, ctl, hint);
    case 'select':
      ctl = h('select', {class: 'in', id: 'o-' + sp.id, onchange: e => setOpt(sp.id, e.target.value, true)}, sp.choices.map(([cv, cl]) => h('option', {value: cv, selected: v === cv || null}, cl)));
      break;
    case 'check':
      return h('label', {class: 'chk'}, h('input', {type: 'checkbox', id: 'o-' + sp.id, checked: !!v, onchange: e => setOpt(sp.id, e.target.checked, true)}), h('span', {}, sp.label, sp.hint ? h('div', {class: 'hint'}, sp.hint) : null));
    case 'range':
      const out = h('span', {class: 'rangeval'}, (sp.fmt || (x => x))(v));
      ctl = h('div', {class: 'row', style: {flexWrap: 'nowrap'}}, h('input', {type: 'range', id: 'o-' + sp.id, min: sp.min, max: sp.max, step: sp.step || 1, value: v, oninput: e => { setOpt(sp.id, +e.target.value); out.textContent = (sp.fmt || (x => x))(+e.target.value); }}), out);
      break;
    case 'color':
      ctl = h('div', {class: 'row'}, h('input', {type: 'color', id: 'o-' + sp.id, value: v, oninput: e => setOpt(sp.id, e.target.value)}));
      break;
    case 'pos9': case 'pos6': {
      const keys = sp.type === 'pos9' ? ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'] : ['tl', 'tc', 'tr', 'bl', 'bc', 'br'];
      const names = {tl: '왼쪽 위', tc: '가운데 위', tr: '오른쪽 위', ml: '왼쪽 가운데', mc: '정가운데', mr: '오른쪽 가운데', bl: '왼쪽 아래', bc: '가운데 아래', br: '오른쪽 아래'};
      ctl = h('div', {class: 'pos9' + (sp.type === 'pos6' ? ' six' : '')}, keys.map(k => h('button', {type: 'button', title: names[k], 'aria-label': names[k], 'aria-pressed': String(v === k), onclick: () => setOpt(sp.id, k, true)})));
      return h('div', {class: 'fld'}, h('div', {class: 'lb'}, sp.label), ctl, hint);
    }
    case 'image': {
      const name = v ? v.name : '선택한 이미지 없음';
      ctl = h('div', {class: 'row'}, h('button', {class: 'btn ghost small', type: 'button', onclick: () => {
        const inp = h('input', {type: 'file', accept: 'image/*', style: {display: 'none'}}); inp.onchange = () => { if (inp.files[0]) setOpt(sp.id, inp.files[0], true); inp.remove(); }; document.body.append(inp); inp.click();
      }}, '이미지 선택'), h('span', {class: 'hint'}, name));
      return h('div', {class: 'fld'}, h('div', {class: 'lb'}, sp.label), ctl, hint);
    }
    case 'textarea':
      ctl = h('textarea', {class: 'in', id: 'o-' + sp.id, placeholder: sp.placeholder || '', rows: sp.rows || 4, oninput: e => setOpt(sp.id, e.target.value)}); ctl.value = v || '';
      if (sp.live) ctl.addEventListener('change', () => drawRail());
      break;
    default:
      ctl = h('input', {class: 'in', id: 'o-' + sp.id, type: sp.type || 'text', value: v ?? '', placeholder: sp.placeholder || '', min: sp.min, max: sp.max, step: sp.step, autocomplete: sp.type === 'password' ? 'new-password' : 'off',
        oninput: e => setOpt(sp.id, sp.type === 'number' ? (e.target.value === '' ? '' : +e.target.value) : e.target.value),
        onchange: sp.live ? () => drawRail() : null});
  }
  return h('div', {class: 'fld'}, lab, ctl, hint);
}
function drawRail(){
  const r = $('#rail'); if (!r) return; r.innerHTML = '';
  const t = S.tool;
  if (S.result) return resultRail(r);
  const specs = typeof t.opts === 'function' ? t.opts() : (t.opts || []);
  if (specs.length) r.append(h('h3', {}, '설정'));
  for (const sp of specs) { const n = renderSpec(sp); if (n) r.append(n); }
  const ready = isReady(t);
  if (S.error) r.append(h('div', {class: 'err', role: 'alert'}, S.error));
  r.append(h('button', {class: 'btn wide', type: 'button', id: 'runbtn', disabled: !ready || null, onclick: runTool}, t.action || t.title));
  if (!ready && t.needMsg) r.append(h('div', {class: 'hint', style: {fontSize: '13px', color: 'var(--muted)'}}, typeof t.needMsg === 'function' ? t.needMsg() : t.needMsg));
}

function isReady(t){ return !!(t.ready ? t.ready() : (S.files.length >= (t.min || 1) && !S.files.some(f => f.broken && t.id !== 'repair'))); }
function refreshReady(){ const b = $('#runbtn'); if (b && S.tool && !S.result) b.disabled = !isReady(S.tool); }
/* ============ running ============ */
async function runTool(){
  const t = S.tool; const st = $('#stage');
  const ac = new AbortController();
  const bar = h('i'); const msg = h('div', {class: 'msg'}, '준비하는 중…');
  const ov = h('div', {class: 'busy', role: 'status', 'aria-live': 'polite'}, h('div', {class: 'box'}, msg, h('div', {class: 'bar'}, bar),
    h('button', {class: 'btn ghost small', type: 'button', onclick: () => { ac.abort(); msg.textContent = '취소하는 중…'; }}, '취소')));
  st.append(ov); S.error = null;
  const btn = $('#runbtn'); if (btn) btn.disabled = true;
  let lastYield = 0;
  const ctx = {
    files: S.files, o: S.opts, signal: ac.signal,
    check(){ if (ac.signal.aborted) throw userErr('취소했습니다.'); },
    async progress(frac, m){
      if (m) msg.textContent = m; if (frac != null) bar.style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
      const now = performance.now(); if (now - lastYield > 40) { lastYield = now; await sleep(0); }
      if (ac.signal.aborted) throw userErr('취소했습니다.');
    }
  };
  try {
    const res = await t.run(ctx);
    S.result = res || {outputs: []};
  } catch (e) {
    console.error(e);
    S.error = e && e.user ? e.message : '처리하지 못했습니다. ' + (e && e.message ? '(' + e.message + ')' : '');
  }
  drawStage(); drawRail();
}
function extOf(n){ return (n.split('.').pop() || '').toLowerCase(); }
function resultsView(st){
  const t = S.tool; const res = S.result;
  const outs = res.outputs || [];
  const total = outs.reduce((s, o) => s + o.blob.size, 0);
  st.append(h('div', {class: 'results'},
    h('div', {class: 'done-head'}, h('span', {class: 'ok', 'aria-hidden': 'true'}, '✓'),
      h('div', {}, h('h2', {}, res.title || '완료했습니다'), h('p', {}, res.summary || (outs.length ? `파일 ${outs.length}개 · ${fmtSize(total)}` : '')))),
    res.view || null,
    outs.length ? h('div', {class: 'outlist'}, outs.map(o => h('div', {class: 'out'},
      h('span', {class: 'sheet', 'data-cat': t.cat, style: {width: '32px', height: '38px', fontSize: '9px'}}, extOf(o.name).toUpperCase().slice(0, 4)),
      h('span', {class: 'nm', title: o.name}, o.name), h('span', {class: 'sz'}, fmtSize(o.blob.size)),
      h('button', {class: 'btn small', type: 'button', onclick: () => saveBlob(o.name, o.blob)}, '저장')))) : null));
}
async function zipAll(outs, name){
  const z = new JSZip(); const used = new Set();
  for (const o of outs) { let n = o.name, k = 1; while (used.has(n)) n = baseName(o.name) + ` (${k++}).` + extOf(o.name); used.add(n); z.file(n, o.blob); }
  return {name, blob: await z.generateAsync({type: 'blob', mimeType: 'application/zip'})};
}
function resultRail(r){
  const t = S.tool; const outs = S.result.outputs || [];
  r.append(h('h3', {}, '내보내기'));
  if (outs.length === 1) r.append(h('button', {class: 'btn wide', type: 'button', onclick: () => saveBlob(outs[0].name, outs[0].blob)}, '저장하기'));
  if (outs.length > 1) r.append(h('button', {class: 'btn wide', type: 'button', onclick: async () => { const z = await zipAll(outs, S.result.zipName || (t.id + '_결과.zip')); saveBlob(z.name, z.blob); }}, `ZIP으로 모두 저장 (${outs.length}개)`));
  const pdfOuts = outs.filter(o => extOf(o.name) === 'pdf');
  if (pdfOuts.length) {
    const sel = h('select', {class: 'in', id: 'next-tool'}, h('option', {value: ''}, '도구를 고르세요'),
      CATS.map(([k, l]) => h('optgroup', {label: l}, TOOLS.filter(x => x.cat === k && (!x.accept || x.accept === 'pdf') && x.id !== t.id).map(x => h('option', {value: x.id}, x.title)))));
    r.append(h('div', {class: 'fld'}, h('label', {for: 'next-tool'}, '이 결과로 이어서 작업'), sel,
      h('button', {class: 'btn ghost', type: 'button', onclick: () => {
        if (!sel.value) { toast('이어서 쓸 도구를 고르세요.'); return; }
        const nt = TOOLS.find(x => x.id === sel.value);
        const fs = (nt.multi ? pdfOuts : pdfOuts.slice(0, 1)).map(o => new File([o.blob], o.name, {type: 'application/pdf'}));
        go(nt.id, fs);
      }}, '결과 넘기기'), h('div', {class: 'hint'}, '여러 도구를 차례로 거치는 작업 흐름을 만들 수 있습니다.')));
  }
  r.append(h('div', {class: 'row'},
    h('button', {class: 'btn ghost', type: 'button', onclick: () => { S.result = null; drawStage(); drawRail(); }}, '설정 바꿔 다시'),
    h('button', {class: 'btn ghost', type: 'button', onclick: () => go(t.id)}, '새 파일로')));
}
