/* ============ PDF 편집: rotate / page numbers / watermark ============ */
tool({id: 'rotate', cat: 'edit', code: '↻', title: 'PDF 회전', desc: '페이지를 원하는 방향으로 돌립니다. 여러 PDF를 한 번에 돌릴 수 있습니다.', multi: true, kw: '돌리기 방향',
  stage: st => pageGrid(st, 'rotate'), onFiles(){ syncPages(); },
  opts: [{id: 'n', type: 'note', text: '왼쪽에서 페이지를 누를 때마다 시계 방향으로 90° 돌아갑니다. 위쪽 버튼으로 전체를 한 번에 돌릴 수 있습니다.'}],
  ready: () => S.pages && S.pages.some(p => p.rot),
  needMsg: '돌릴 페이지를 하나 이상 고르세요.',
  action: '회전 적용',
  async run(ctx){
    const outs = [];
    for (const f of ctx.files) {
      const doc = await libDoc(f);
      S.pages.filter(p => p.fid === f.id && p.rot).forEach(p => { const pg = doc.getPage(p.n - 1); pg.setRotation(degrees(((pg.getRotation().angle || 0) + p.rot) % 360)); });
      outs.push({name: baseName(f.name) + '_회전.pdf', blob: await saveDoc(doc)});
    }
    return {outputs: outs, zipName: '회전된_PDF.zip'};
  }});

function pageIdx(o, total, key = 'range'){ return o[key] && String(o[key]).trim() ? parseRanges(o[key], total) : [...Array(total).keys()]; }
tool({id: 'pagenum', cat: 'edit', code: '#12', title: '페이지 번호', desc: '페이지 번호를 원하는 위치, 크기, 형식으로 넣습니다.', kw: '쪽번호 넘버링',
  opts: [{id: 'pos', type: 'pos6', def: 'bc', label: '위치'},
    {id: 'facing', type: 'check', def: false, label: '양면 모드 (짝수 쪽은 좌우 반대로)'},
    {id: 'margin', type: 'seg', def: 'rec', label: '여백', choices: [['small', '좁게'], ['rec', '보통'], ['big', '넓게']]},
    {id: 'fmt', type: 'select', def: '{n}', label: '형식', choices: [['{n}', '1'], ['{n} / {p}', '1 / 10'], ['- {n} -', '- 1 -'], ['{n}쪽', '1쪽'], ['Page {n} of {p}', 'Page 1 of 10'], ['custom', '직접 입력']]},
    {id: 'custom', type: 'text', def: '{n}쪽 / 전체 {p}쪽', label: '직접 입력', hint: '{n}은 쪽 번호, {p}는 전체 쪽수로 바뀝니다.', show: o => o.fmt === 'custom'},
    {id: 'start', type: 'number', def: 1, min: 0, label: '시작 번호'},
    {id: 'range', type: 'text', def: '', label: '번호를 넣을 페이지', placeholder: '비우면 전체 (예: 2-)', hint: '표지를 빼려면 "2-"처럼 입력하세요.'},
    {id: 'size', type: 'range', def: 11, min: 6, max: 28, label: '글자 크기', fmt: v => v + 'pt'},
    {id: 'color', type: 'color', def: '#222222', label: '색'}],
  action: '번호 넣기',
  async run(ctx){
    const f = ctx.files[0]; const o = ctx.o; const doc = await libDoc(f); const font = await korFont(doc); const total = doc.getPageCount();
    const idx = pageIdx(o, total); const m = {small: 18, rec: 30, big: 48}[o.margin]; const size = +o.size || 11; const color = hexRgb(o.color);
    const fmt = o.fmt === 'custom' ? (o.custom || '{n}') : o.fmt;
    idx.forEach((pi, k) => {
      const page = doc.getPage(pi); const g = geom(page);
      const text = fmt.replace(/\{n\}/g, String((+o.start || 0) + k)).replace(/\{p\}/g, String(idx.length + (+o.start || 1) - 1));
      const tw = font.widthOfTextAtSize(fsafe(font, text), size);
      let col = o.pos[1]; if (o.facing && (pi % 2 === 1)) col = col === 'l' ? 'r' : col === 'r' ? 'l' : col;
      const dx = col === 'l' ? m : col === 'r' ? g.dispW - m - tw : (g.dispW - tw) / 2;
      const dy = o.pos[0] === 't' ? m : g.dispH - m - size;
      drawTextDisp(page, g, text, dx, dy, {size, font, color});
    });
    return {outputs: [{name: baseName(f.name) + '_번호.pdf', blob: await saveDoc(doc)}], summary: `${idx.length}쪽에 번호를 넣었습니다.`};
  }});

function placeRotated(c, w, hgt, theta){
  const t = theta * Math.PI / 180, dir = [Math.cos(t), Math.sin(t)], up = [-Math.sin(t), Math.cos(t)];
  return {x: c.x - w / 2 * dir[0] - hgt / 2 * up[0], y: c.y - w / 2 * dir[1] - hgt / 2 * up[1]};
}
function moveUnder(page){
  const arr = page.node.Contents();
  if (arr instanceof PDFArray && arr.size() > 1) { const last = arr.get(arr.size() - 1); arr.remove(arr.size() - 1); arr.insert(0, last); }
}
tool({id: 'watermark', cat: 'edit', code: 'WM', title: '워터마크', desc: 'PDF에 글자나 이미지 워터마크를 넣습니다. 투명도와 위치를 고릅니다.', kw: '도장 대외비 copy',
  opts: [{id: 'kind', type: 'seg', def: 'text', label: '종류', choices: [['text', '글자'], ['image', '이미지']]},
    {id: 'text', type: 'text', def: '대외비', label: '워터마크 글자', show: o => o.kind === 'text'},
    {id: 'size', type: 'range', def: 54, min: 10, max: 160, label: '글자 크기', fmt: v => v + 'pt', show: o => o.kind === 'text'},
    {id: 'color', type: 'color', def: '#c8323f', label: '색', show: o => o.kind === 'text'},
    {id: 'img', type: 'image', label: '워터마크 이미지', show: o => o.kind === 'image', hint: '투명 배경 PNG가 가장 깔끔합니다.'},
    {id: 'iscale', type: 'range', def: 40, min: 5, max: 100, label: '이미지 크기 (페이지 너비 대비)', fmt: v => v + '%', show: o => o.kind === 'image'},
    {id: 'pos', type: 'pos9', def: 'mc', label: '위치'},
    {id: 'mosaic', type: 'check', def: false, label: '페이지 전체에 바둑판처럼 반복'},
    {id: 'rot', type: 'seg', def: '45', label: '기울기', choices: [['0', '0°'], ['45', '45°'], ['90', '90°'], ['-45', '-45°']]},
    {id: 'opacity', type: 'range', def: 30, min: 5, max: 100, label: '불투명도', fmt: v => v + '%'},
    {id: 'layer', type: 'seg', def: 'over', label: '층', choices: [['over', '내용 위'], ['under', '내용 아래']], hint: o => o.layer === 'under' ? '배경이 흰색으로 꽉 찬 스캔 문서에서는 아래 층 워터마크가 가려질 수 있습니다.' : ''},
    {id: 'range', type: 'text', def: '', label: '적용할 페이지', placeholder: '비우면 전체'}],
  ready: () => S.files.length && (S.opts.kind !== 'image' || S.opts.img) && (S.opts.kind === 'image' || (S.opts.text || '').trim()),
  needMsg: () => S.opts.kind === 'image' ? '워터마크로 쓸 이미지를 고르세요.' : '워터마크 글자를 입력하세요.',
  action: '워터마크 넣기',
  async run(ctx){
    const f = ctx.files[0]; const o = ctx.o; const doc = await libDoc(f); const total = doc.getPageCount();
    const font = o.kind === 'text' ? await korFont(doc) : null;
    const img = o.kind === 'image' ? await embedAny(doc, o.img) : null;
    const op = (+o.opacity || 30) / 100; const ang = +o.rot || 0;
    const idx = pageIdx(o, total);
    for (const pi of idx) {
      const page = doc.getPage(pi); const g = geom(page);
      let w, hh;
      if (img) { w = g.dispW * (+o.iscale || 40) / 100; hh = w * img.height / img.width; }
      else { hh = +o.size || 54; w = font.widthOfTextAtSize(fsafe(font, o.text), hh); }
      const centers = [];
      if (o.mosaic) {
        const stepX = Math.max(w, hh) * 1.15 + 40, stepY = Math.max(hh * 3, 120);
        for (let y = stepY / 2, r = 0; y < g.dispH + stepY; y += stepY, r++) for (let x = (r % 2 ? stepX / 2 : 0); x < g.dispW + stepX; x += stepX) centers.push([x, y]);
      } else {
        const m = 36; const ex = Math.abs(Math.cos(ang * Math.PI / 180)) * w / 2 + Math.abs(Math.sin(ang * Math.PI / 180)) * hh / 2, ey = Math.abs(Math.sin(ang * Math.PI / 180)) * w / 2 + Math.abs(Math.cos(ang * Math.PI / 180)) * hh / 2;
        const cx = o.pos[1] === 'l' ? m + ex : o.pos[1] === 'r' ? g.dispW - m - ex : g.dispW / 2;
        const cy = o.pos[0] === 't' ? m + ey : o.pos[0] === 'b' ? g.dispH - m - ey : g.dispH / 2;
        centers.push([cx, cy]);
      }
      const theta = g.r + ang;
      for (const [cx, cy] of centers) {
        const c = g.map(cx, cy);
        if (img) { const p = placeRotated(c, w, hh, theta); page.drawImage(img, {x: p.x, y: p.y, width: w, height: hh, rotate: degrees(theta), opacity: op}); }
        else { const p = placeRotated(c, w, hh * 0.72, theta); page.drawText(fsafe(font, o.text), {x: p.x, y: p.y, size: hh, font, color: hexRgb(o.color), rotate: degrees(theta), opacity: op}); }
      }
      if (o.layer === 'under') moveUnder(page);
      await ctx.progress(pi / total);
    }
    return {outputs: [{name: baseName(f.name) + '_워터마크.pdf', blob: await saveDoc(doc)}]};
  }});

/* ============ page editor (edit / sign / redact / crop / forms) ============ */
const TB = {
  select: ['선택', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 3l14 8-6 2-2 6z"/></svg>'],
  text: ['글자', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 6V4h14v2M12 4v16M9 20h6"/></svg>'],
  image: ['이미지', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-8 8"/></svg>'],
  rect: ['사각형', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="6" width="16" height="12"/></svg>'],
  ellipse: ['원', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="12" rx="8" ry="6"/></svg>'],
  line: ['선', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 19L19 5"/></svg>'],
  pen: ['펜', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 17c3-4 5 2 8-2s4-8 7-6 1 6-2 8"/></svg>'],
  highlight: ['형광펜', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20h16"/><path d="M8 16l-2-2 9-9 4 4-9 9z"/></svg>'],
  whiteout: ['지우개(흰 상자)', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="7" width="16" height="10" rx="1"/></svg>'],
  redact: ['가리기 상자', '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="8" width="18" height="8"/></svg>'],
  ftext: ['텍스트 필드', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="7" width="18" height="10" rx="1"/><path d="M7 10v4"/></svg>'],
  fcheck: ['체크박스', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="5" width="14" height="14" rx="2"/><path d="M8 12l3 3 5-6"/></svg>'],
  sign: ['서명', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 18c2-6 4-10 6-10s-1 9 2 9 3-5 5-5 1 4 5 4"/></svg>'],
  initials: ['이니셜', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 18V6l5 12V6M15 18V6h4"/></svg>'],
  date: ['날짜', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>']
};
function edInit(cfg){
  S.ed = {page: 1, objs: {}, tool: cfg.tools[0], sel: null, cfg, defaults: {color: '#d0021b', size: 14, sw: 2, opacity: 100, fill: false}, crop: null};
}
function edObjs(n){ return S.ed.objs[n] ||= []; }
function editorStage(st){
  const ed = S.ed; const f = S.files[0]; const cfg = ed.cfg;
  if (!f.pages) { st.append(h('p', {class: 'note warn'}, f.locked ? '암호가 걸린 PDF입니다. 먼저 PDF 잠금 해제를 사용하세요.' : '이 PDF를 열지 못했습니다.')); return; }
  const bar = h('div', {class: 'ed-bar', role: 'toolbar', 'aria-label': '편집 도구'});
  cfg.tools.forEach(t => {
    if (t === '|') { bar.append(h('span', {class: 'sep'})); return; }
    bar.append(h('button', {class: 'tb', type: 'button', 'aria-pressed': String(ed.tool === t), title: TB[t][0], html: TB[t][1] + `<span>${TB[t][0]}</span>`, onclick: () => edTool(t)}));
  });
  if (cfg.barExtra) bar.append(...cfg.barExtra());
  const scroll = h('div', {class: 'ed-scroll'}); const pageBox = h('div', {class: 'ed-page'}); const layer = h('div', {class: 'ed-layer'});
  scroll.append(pageBox);
  const nav = h('div', {class: 'ed-nav'},
    h('button', {class: 'ib', type: 'button', html: ICON.left, 'aria-label': '이전 쪽', disabled: ed.page <= 1 || null, onclick: () => { ed.page--; ed.sel = null; drawStage(); drawRail(); }}),
    h('span', {}, `${ed.page} / ${f.pages}`),
    h('button', {class: 'ib', type: 'button', html: ICON.right, 'aria-label': '다음 쪽', disabled: ed.page >= f.pages || null, onclick: () => { ed.page++; ed.sel = null; drawStage(); drawRail(); }}));
  const strip = h('div', {class: 'thumbs-strip'});
  st.append(bar, scroll, nav, f.pages > 1 ? strip : null);
  // page render
  (async () => {
    const d = await pjs(f); const p = await d.getPage(ed.page); const vp = p.getViewport({scale: 1});
    const avail = Math.max(260, Math.min(st.clientWidth - 40, 900)); const k = avail / vp.width;
    ed.k = k; ed.dispW = vp.width; ed.dispH = vp.height;
    const c = await renderPage(p, k * Math.min(2, window.devicePixelRatio || 1));
    c.style.width = vp.width * k + 'px'; c.style.height = vp.height * k + 'px';
    pageBox.style.width = vp.width * k + 'px'; pageBox.style.height = vp.height * k + 'px';
    pageBox.replaceChildren(c, layer);
    if (cfg.onPage) cfg.onPage(p);
    edDraw(layer); wireLayer(layer);
  })();
  if (f.pages > 1) for (let i = 1; i <= f.pages; i++) {
    const b = h('button', {type: 'button', 'aria-current': String(i === ed.page), 'aria-label': i + '쪽', onclick: () => { ed.page = i; ed.sel = null; drawStage(); drawRail(); }});
    const cnt = (ed.objs[i] || []).length; if (cnt) b.append(h('span', {class: 'badge'}, cnt));
    strip.append(b);
    renderFit(f, i, 70, 90).then(c => b.prepend(c)).catch(() => {});
  }
}
function edTool(t){
  const ed = S.ed;
  if (t === 'image') { pickImage(src => { const k = 0.4; addImageObj(src, k); }); return; }
  if ((t === 'sign' || t === 'initials') && ed.cfg.onSign) { ed.cfg.onSign(t); return; }
  if (t === 'date') { const d = new Date(); const txt = `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`; const o = {kind: 'text', x: ed.dispW * 0.6, y: ed.dispH * 0.8, text: txt, size: 12, color: '#111111'}; edObjs(ed.page).push(o); ed.sel = o; ed.tool = 'select'; drawStage(); drawRail(); return; }
  ed.tool = t; ed.sel = null; drawStage(); drawRail();
}
function pickImage(cb){
  const inp = h('input', {type: 'file', accept: 'image/*', style: {display: 'none'}});
  inp.onchange = async () => { const fl = inp.files[0]; inp.remove(); if (!fl) return; const bm = await loadImage(fl); const c = toCanvas(bm, 2000); const keepPng = /png|gif|webp/.test(fl.type);
    const cc = document.createElement('canvas'); cc.width = c.width; cc.height = c.height; cc.getContext('2d').drawImage(bm, 0, 0, c.width, c.height);
    cb((keepPng ? cc : c).toDataURL(keepPng ? 'image/png' : 'image/jpeg', 0.92), c.width, c.height); };
  document.body.append(inp); inp.click();
}
function addImageObj(src, frac, w0, h0){
  const ed = S.ed; const im = new Image();
  im.onload = () => { const w = ed.dispW * frac; const hh = w * im.naturalHeight / im.naturalWidth; const o = {kind: 'image', x: (ed.dispW - w) / 2, y: (ed.dispH - hh) / 2, w, h: hh, src}; edObjs(ed.page).push(o); ed.sel = o; ed.tool = 'select'; drawStage(); drawRail(); };
  im.src = src;
}
function objBox(o){
  if (o.kind === 'line') return {x: Math.min(o.x1, o.x2), y: Math.min(o.y1, o.y2), w: Math.abs(o.x2 - o.x1), h: Math.abs(o.y2 - o.y1)};
  if (o.kind === 'pen') { const xs = o.pts.map(p => p[0]), ys = o.pts.map(p => p[1]); const x = Math.min(...xs), y = Math.min(...ys); return {x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y}; }
  return {x: o.x, y: o.y, w: o.w || 0, h: o.h || 0};
}
function edDraw(layer){
  const ed = S.ed; const k = ed.k; layer.innerHTML = '';
  for (const o of edObjs(ed.page)) layer.append(objEl(o, k));
  if (ed.cfg.crop && ed.crop) layer.append(cropEl(ed.crop, k));
}
function objEl(o, k){
  const ed = S.ed; const b = objBox(o); const pad = o.kind === 'line' || o.kind === 'pen' ? (o.sw || 2) * k + 6 : 0;
  const el = h('div', {class: 'obj' + (ed.sel === o ? ' sel' : '') + (o.kind === 'redact' ? ' redact' : '') + (o.kind === 'field' ? ' field' : ''), style: {left: (b.x * k - pad) + 'px', top: (b.y * k - pad) + 'px', width: (b.w * k + pad * 2) + 'px', height: (b.h * k + pad * 2) + 'px'}});
  el.__o = o;
  if (o.kind === 'text') {
    const t = h('div', {class: 'txt', style: {fontSize: o.size * k + 'px', color: o.color, fontWeight: o.bold ? '700' : '400'}}); t.textContent = o.text;
    el.style.width = ''; el.style.height = ''; el.append(t);
    if (ed.editing === o) {
      t.contentEditable = 'true'; setTimeout(() => { t.focus(); const r = document.createRange(); r.selectNodeContents(t); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
      t.addEventListener('input', () => { o.text = t.innerText; });
      t.addEventListener('blur', () => { o.text = t.innerText.replace(/\n$/, ''); ed.editing = null; if (!o.text.trim()) { const arr = edObjs(ed.page); arr.splice(arr.indexOf(o), 1); ed.sel = null; } edSyncSize(); drawRail(); });
      t.addEventListener('keydown', e => { if (e.key === 'Escape') t.blur(); e.stopPropagation(); });
    }
  } else if (o.kind === 'image') el.append(h('img', {src: o.src, alt: ''}));
  else if (o.kind === 'field') el.textContent = o.ftype === 'check' ? '☐' : (o.name || '텍스트 필드');
  else if (o.kind !== 'redact') {
    const ns = 'http://www.w3.org/2000/svg'; const sv = document.createElementNS(ns, 'svg');
    const W = b.w * k + pad * 2, H = b.h * k + pad * 2; sv.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const col = o.color || '#000'; const sw = (o.sw || 2) * k; let s;
    if (o.kind === 'rect') { s = document.createElementNS(ns, 'rect'); s.setAttribute('x', sw / 2); s.setAttribute('y', sw / 2); s.setAttribute('width', Math.max(0, W - sw)); s.setAttribute('height', Math.max(0, H - sw)); }
    if (o.kind === 'ellipse') { s = document.createElementNS(ns, 'ellipse'); s.setAttribute('cx', W / 2); s.setAttribute('cy', H / 2); s.setAttribute('rx', Math.max(0, W / 2 - sw / 2)); s.setAttribute('ry', Math.max(0, H / 2 - sw / 2)); }
    if (o.kind === 'line') { s = document.createElementNS(ns, 'line'); s.setAttribute('x1', (o.x1 - b.x) * k + pad); s.setAttribute('y1', (o.y1 - b.y) * k + pad); s.setAttribute('x2', (o.x2 - b.x) * k + pad); s.setAttribute('y2', (o.y2 - b.y) * k + pad); }
    if (o.kind === 'pen') { s = document.createElementNS(ns, 'polyline'); s.setAttribute('points', o.pts.map(p => `${(p[0] - b.x) * k + pad},${(p[1] - b.y) * k + pad}`).join(' ')); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('stroke-linecap', 'round'); }
    if (o.fillOnly) { s.setAttribute('fill', col); s.setAttribute('stroke', 'none'); }
    else { s.setAttribute('fill', o.fill && (o.kind === 'rect' || o.kind === 'ellipse') ? col : 'none'); s.setAttribute('stroke', col); s.setAttribute('stroke-width', sw); }
    sv.style.opacity = (o.opacity ?? 100) / 100; sv.append(s); el.append(sv);
  }
  if (o.kind !== 'pen' && o.kind !== 'line' || o.kind === 'line') el.append(h('span', {class: 'h', 'data-h': '1'}));
  return el;
}
function edSyncSize(){
  const ed = S.ed; const layer = $('.ed-layer'); if (!layer) return;
  for (const el of layer.children) { const o = el.__o; if (o && o.kind === 'text') { o.w = el.offsetWidth / ed.k; o.h = el.offsetHeight / ed.k; } }
  edDraw(layer);
}
function cropEl(r, k){
  const el = h('div', {class: 'cropbox', style: {left: r.x * k + 'px', top: r.y * k + 'px', width: r.w * k + 'px', height: r.h * k + 'px'}}, h('span', {class: 'h', 'data-h': '1'}));
  el.__crop = true; return el;
}
function wireLayer(layer){
  const ed = S.ed; let act = null;
  const pt = e => { const r = layer.getBoundingClientRect(); return [(e.clientX - r.left) / ed.k, (e.clientY - r.top) / ed.k]; };
  layer.onpointerdown = e => {
    if (ed.editing) return;
    const [x, y] = pt(e); const tgt = e.target.closest('.obj,.cropbox');
    const handle = e.target.dataset && e.target.dataset.h;
    if (tgt && tgt.__crop) { act = {type: handle ? 'cropsize' : 'cropmove', x0: x, y0: y, r0: {...ed.crop}}; }
    else if (tgt && (ed.tool === 'select' || ed.cfg.crop || true) && tgt.__o) {
      const o = tgt.__o; ed.sel = o; drawRail();
      layer.querySelectorAll('.obj').forEach(n => n.classList.toggle('sel', n === tgt));
      act = {type: handle ? 'size' : 'move', o, x0: x, y0: y, snap: JSON.parse(JSON.stringify(o))};
    } else if (ed.tool === 'text') {
      const o = {kind: 'text', x, y: y - ed.defaults.size * 0.6, text: '글자를 입력하세요', size: ed.defaults.size, color: ed.defaults.color};
      edObjs(ed.page).push(o); ed.sel = o; ed.editing = o; edDraw(layer); drawRail(); return;
    } else if (['rect', 'ellipse', 'highlight', 'whiteout', 'redact', 'ftext', 'fcheck'].includes(ed.tool)) {
      const kind = {highlight: 'rect', whiteout: 'rect', ftext: 'field', fcheck: 'field'}[ed.tool] || ed.tool;
      const o = {kind, x, y, w: 1, h: 1, color: ed.defaults.color, sw: ed.defaults.sw, opacity: ed.defaults.opacity, fill: ed.defaults.fill};
      if (ed.tool === 'highlight') Object.assign(o, {color: '#ffe14d', fillOnly: true, opacity: 45});
      if (ed.tool === 'whiteout') Object.assign(o, {color: '#ffffff', fillOnly: true, opacity: 100});
      if (ed.tool === 'ftext') Object.assign(o, {ftype: 'text', name: '필드' + (Object.values(ed.objs).flat().filter(z => z.kind === 'field').length + 1)});
      if (ed.tool === 'fcheck') Object.assign(o, {ftype: 'check', name: '체크' + (Object.values(ed.objs).flat().filter(z => z.kind === 'field').length + 1), w: 14, h: 14});
      edObjs(ed.page).push(o); ed.sel = o; act = {type: 'create', o, x0: x, y0: y};
    } else if (ed.tool === 'line') { const o = {kind: 'line', x1: x, y1: y, x2: x, y2: y, color: ed.defaults.color, sw: ed.defaults.sw, opacity: ed.defaults.opacity}; edObjs(ed.page).push(o); ed.sel = o; act = {type: 'line', o}; }
    else if (ed.tool === 'pen') { const o = {kind: 'pen', pts: [[x, y]], color: ed.defaults.color, sw: ed.defaults.sw, opacity: ed.defaults.opacity}; edObjs(ed.page).push(o); ed.sel = o; act = {type: 'pen', o}; }
    else { ed.sel = null; layer.querySelectorAll('.obj').forEach(n => n.classList.remove('sel')); drawRail(); return; }
    layer.setPointerCapture(e.pointerId); e.preventDefault();
  };
  layer.onpointermove = e => {
    if (!act) return; const [x, y] = pt(e); const dx = x - act.x0, dy = y - act.y0; const o = act.o;
    if (act.type === 'move') {
      if (o.kind === 'line') { o.x1 = act.snap.x1 + dx; o.y1 = act.snap.y1 + dy; o.x2 = act.snap.x2 + dx; o.y2 = act.snap.y2 + dy; }
      else if (o.kind === 'pen') o.pts = act.snap.pts.map(p => [p[0] + dx, p[1] + dy]);
      else { o.x = act.snap.x + dx; o.y = act.snap.y + dy; }
    } else if (act.type === 'size') {
      if (o.kind === 'line') { o.x2 = act.snap.x2 + dx; o.y2 = act.snap.y2 + dy; }
      else if (o.kind === 'text') { o.size = Math.max(5, act.snap.size * (1 + dy / Math.max(10, act.snap.h || 20))); }
      else if (o.kind === 'image' || (o.kind === 'field' && o.ftype === 'check')) { const w = Math.max(6, act.snap.w + dx); o.h = act.snap.h * w / act.snap.w; o.w = w; }
      else { o.w = Math.max(4, act.snap.w + dx); o.h = Math.max(4, act.snap.h + dy); }
    } else if (act.type === 'create') {
      if (o.ftype === 'check') { o.x = x - 7; o.y = y - 7; }
      else { o.x = Math.min(x, act.x0); o.y = Math.min(y, act.y0); o.w = Math.abs(dx); o.h = Math.abs(dy); }
    } else if (act.type === 'line') { o.x2 = x; o.y2 = y; }
    else if (act.type === 'pen') o.pts.push([x, y]);
    else if (act.type === 'cropmove') { const r = ed.crop; r.x = Math.max(0, Math.min(ed.dispW - r.w, act.r0.x + dx)); r.y = Math.max(0, Math.min(ed.dispH - r.h, act.r0.y + dy)); }
    else if (act.type === 'cropsize') { const r = ed.crop; r.w = Math.max(20, Math.min(ed.dispW - r.x, act.r0.w + dx)); r.h = Math.max(20, Math.min(ed.dispH - r.y, act.r0.h + dy)); }
    edDraw(layer);
  };
  layer.onpointerup = () => {
    if (!act) return;
    const o = act.o;
    if (act.type === 'create' && o.ftype !== 'check' && (o.w < 4 || o.h < 4)) { Object.assign(o, o.kind === 'field' ? {w: 160, h: 22} : o.kind === 'redact' ? {w: 120, h: 18} : {w: 120, h: 60}); }
    if (act.type === 'line' && Math.hypot(o.x2 - o.x1, o.y2 - o.y1) < 3) { o.x2 = o.x1 + 100; }
    if ((act.type === 'cropsize' || act.type === 'cropmove') && ed.cfg.onCrop) ed.cfg.onCrop();
    act = null; edDraw(layer); drawRail(); updateBadges();
  };
  layer.ondblclick = e => { const tgt = e.target.closest('.obj'); if (tgt && tgt.__o && tgt.__o.kind === 'text') { ed.editing = tgt.__o; ed.sel = tgt.__o; edDraw(layer); } };
}
function updateBadges(){
  const strip = $('.thumbs-strip'); if (!strip) return;
  [...strip.children].forEach((b, i) => { b.querySelector('.badge')?.remove(); const cnt = (S.ed.objs[i + 1] || []).length; if (cnt) b.append(h('span', {class: 'badge'}, cnt)); });
}
document.addEventListener('keydown', e => {
  const ed = S.ed; if (!ed || !ed.sel || ed.editing || S.result) return;
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement && document.activeElement.tagName)) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { const arr = edObjs(ed.page); const i = arr.indexOf(ed.sel); if (i > -1) { arr.splice(i, 1); ed.sel = null; drawStage(); drawRail(); e.preventDefault(); } }
});
function edPropsRail(){
  const ed = S.ed; if (!ed) return []; const o = ed.sel; const out = [];
  const target = o || ed.defaults;
  const kind = o ? o.kind : ed.tool;
  const setP = (k, v, re) => { target[k] = v; if (o) { const layer = $('.ed-layer'); if (layer) edDraw(layer); if (o.kind === 'text') setTimeout(edSyncSize); } if (re) drawRail(); };
  const swatches = ['#111111', '#d0021b', '#2747d4', '#18855f', '#f5a623', '#ffffff'];
  const showColor = ['text', 'rect', 'ellipse', 'line', 'pen'].includes(kind);
  if (!o && !showColor) return out;
  out.push(h('h3', {}, o ? '선택한 항목' : '새 항목 기본값'));
  if (showColor) out.push(h('div', {class: 'fld'}, h('div', {class: 'lb'}, '색'), h('div', {class: 'row'},
    h('div', {class: 'swatches'}, swatches.map(c => h('button', {type: 'button', 'aria-label': c, style: {background: c}, 'aria-pressed': String((target.color || '').toLowerCase() === c), onclick: () => setP('color', c, true)}))),
    h('input', {type: 'color', value: target.color || '#000000', 'aria-label': '직접 고르기', oninput: e => setP('color', e.target.value)}))));
  if (kind === 'text') {
    out.push(h('div', {class: 'fld'}, h('label', {for: 'p-size'}, '글자 크기'), h('input', {class: 'in', id: 'p-size', type: 'number', min: 5, max: 200, value: Math.round(target.size || 14), oninput: e => setP('size', +e.target.value || 12)})));
    out.push(h('label', {class: 'chk'}, h('input', {type: 'checkbox', checked: !!target.bold, onchange: e => setP('bold', e.target.checked)}), '굵게'));
    if (o) out.push(h('div', {class: 'fld'}, h('label', {for: 'p-text'}, '내용'), h('textarea', {class: 'in', id: 'p-text', rows: 3, oninput: e => setP('text', e.target.value)}, o.text)));
  }
  if (['rect', 'ellipse', 'line', 'pen'].includes(kind) && !(o && o.fillOnly)) {
    out.push(h('div', {class: 'fld'}, h('label', {for: 'p-sw'}, '선 두께'), h('input', {type: 'range', id: 'p-sw', min: 0.5, max: 12, step: 0.5, value: target.sw || 2, oninput: e => setP('sw', +e.target.value)})));
    if (kind === 'rect' || kind === 'ellipse') out.push(h('label', {class: 'chk'}, h('input', {type: 'checkbox', checked: !!target.fill, onchange: e => setP('fill', e.target.checked)}), '안쪽 채우기'));
  }
  if (['rect', 'ellipse', 'line', 'pen', 'image', 'text'].includes(kind)) out.push(h('div', {class: 'fld'}, h('label', {for: 'p-op'}, '불투명도'), h('input', {type: 'range', id: 'p-op', min: 10, max: 100, value: target.opacity ?? 100, oninput: e => setP('opacity', +e.target.value)})));
  if (o && o.kind === 'field') {
    out.push(h('div', {class: 'fld'}, h('label', {for: 'p-fn'}, '필드 이름'), h('input', {class: 'in', id: 'p-fn', value: o.name || '', oninput: e => { o.name = e.target.value.replace(/[.\s]/g, '_'); const l = $('.ed-layer'); if (l) edDraw(l); }})));
  }
  if (o) out.push(h('button', {class: 'btn ghost small', type: 'button', onclick: () => { const arr = edObjs(ed.page); arr.splice(arr.indexOf(o), 1); ed.sel = null; drawStage(); drawRail(); }}, '선택 항목 삭제'));
  return out;
}
async function dataUrlImage(doc, src){
  const m = /^data:([^;]+);base64,(.*)$/.exec(src); const bytes = b64bytes(m[2]);
  return m[1] === 'image/png' ? doc.embedPng(bytes) : doc.embedJpg(bytes);
}
async function applyObjects(doc, objsByPage){
  let font = null; const cache = new Map();
  for (const [pn, list] of Object.entries(objsByPage)) {
    if (!list.length) continue;
    const page = doc.getPage(+pn - 1); const g = geom(page);
    for (const o of list) {
      const op = (o.opacity ?? 100) / 100; const col = hexRgb(o.color);
      if (o.kind === 'text') {
        font ||= await korFont(doc);
        drawTextDisp(page, g, o.text, o.x, o.y + (o.size * 0.02), {size: o.size, font, color: col, opacity: op});
        if (o.bold) drawTextDisp(page, g, o.text, o.x + o.size * 0.035, o.y + (o.size * 0.02), {size: o.size, font, color: col, opacity: op});
      } else if (o.kind === 'image') {
        let img = cache.get(o.src); if (!img) { img = await dataUrlImage(doc, o.src); cache.set(o.src, img); }
        const p = g.map(o.x, o.y + o.h); page.drawImage(img, {x: p.x, y: p.y, width: o.w, height: o.h, rotate: g.rot, opacity: op});
      } else if (o.kind === 'rect') {
        const p = g.map(o.x, o.y + o.h);
        if (o.fillOnly) page.drawRectangle({x: p.x, y: p.y, width: o.w, height: o.h, rotate: g.rot, color: col, opacity: op});
        else page.drawRectangle({x: p.x, y: p.y, width: o.w, height: o.h, rotate: g.rot, borderColor: col, borderWidth: o.sw || 2, color: o.fill ? col : undefined, opacity: op, borderOpacity: op});
      } else if (o.kind === 'ellipse') {
        const p = g.map(o.x + o.w / 2, o.y + o.h / 2);
        page.drawEllipse({x: p.x, y: p.y, xScale: o.w / 2, yScale: o.h / 2, rotate: g.rot, borderColor: col, borderWidth: o.sw || 2, color: o.fill ? col : undefined, opacity: op, borderOpacity: op});
      } else if (o.kind === 'line') {
        page.drawLine({start: g.map(o.x1, o.y1), end: g.map(o.x2, o.y2), thickness: o.sw || 2, color: col, opacity: op, lineCap: 1});
      } else if (o.kind === 'pen') {
        for (let i = 1; i < o.pts.length; i++) page.drawLine({start: g.map(...o.pts[i - 1]), end: g.map(...o.pts[i]), thickness: o.sw || 2, color: col, opacity: op, lineCap: 1});
      }
    }
  }
}
function editorTool(def){
  return tool(Object.assign({
    stage(st){ if (!S.ed) edInit(def.ed); editorStage(st); },
    onFiles(){ edInit(def.ed); }
  }, def));
}
editorTool({id: 'edit', cat: 'edit', code: 'EDIT', title: 'PDF 편집', desc: 'PDF에 글자, 이미지, 도형, 펜 그림, 형광펜을 더하고 크기·글꼴·색을 바꿉니다.', kw: '수정 주석 텍스트 추가',
  ed: {tools: ['select', 'text', 'image', '|', 'rect', 'ellipse', 'line', 'pen', '|', 'highlight', 'whiteout']},
  opts: () => [{id: 'n', type: 'note', text: '도구를 고른 뒤 페이지를 누르거나 끌어서 추가합니다. 글자는 두 번 눌러 고칩니다. 지우개(흰 상자)로 기존 내용을 덮을 수 있습니다.'}, ...edPropsRail().map(n => ({type: 'custom', render: () => n}))],
  ready: () => S.ed && Object.values(S.ed.objs).some(a => a.length), needMsg: '페이지에 무언가를 추가하면 저장할 수 있습니다.',
  action: '편집 내용 저장',
  async run(ctx){ const f = ctx.files[0]; const doc = await libDoc(f); await applyObjects(doc, S.ed.objs); return {outputs: [{name: baseName(f.name) + '_편집.pdf', blob: await saveDoc(doc)}]}; }});

async function autoMargins(page){
  const c = await renderPage(page, 0.6); const g = c.getContext('2d', {willReadFrequently: true}); const d = g.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const i = (y * c.width + x) * 4; if (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  if (x1 <= x0) return null; const s = 1 / 0.6, pad = 8;
  return {x: Math.max(0, x0 * s - pad), y: Math.max(0, y0 * s - pad), w: Math.min(c.width * s, (x1 - x0) * s + pad * 2), h: Math.min(c.height * s, (y1 - y0) * s + pad * 2)};
}
editorTool({id: 'crop', cat: 'edit', code: 'CROP', title: 'PDF 자르기', desc: '페이지 여백이나 원하는 영역만 남기고 잘라냅니다. 한 페이지 또는 전체에 적용합니다.', kw: '크롭 여백',
  ed: {tools: [], crop: true,
    barExtra: () => [h('button', {class: 'btn ghost small', type: 'button', onclick: async () => { const d = await pjs(S.files[0]); const r = await autoMargins(await d.getPage(S.ed.page)); if (r) { S.ed.crop = r; drawStage(); } else toast('내용을 찾지 못했습니다.'); }}, '여백 자동 찾기'),
      h('button', {class: 'btn ghost small', type: 'button', onclick: () => { S.ed.crop = {x: 0, y: 0, w: S.ed.dispW, h: S.ed.dispH}; drawStage(); }}, '전체 선택')],
    onPage(){ if (!S.ed.crop) { S.ed.crop = {x: S.ed.dispW * 0.08, y: S.ed.dispH * 0.08, w: S.ed.dispW * 0.84, h: S.ed.dispH * 0.84}; drawRail(); } }},
  opts: [{id: 'scope', type: 'seg', def: 'all', label: '적용 범위', choices: [['all', '모든 페이지'], ['cur', '보고 있는 페이지만']]},
    {id: 'n', type: 'note', text: '파란 상자를 끌어 옮기고, 오른쪽 아래 모서리로 크기를 조절하세요. 상자 밖은 잘려 나갑니다.'}],
  ready: () => S.ed && S.ed.crop, action: 'PDF 자르기',
  async run(ctx){
    const f = ctx.files[0]; const doc = await libDoc(f); const ed = S.ed; const r = ed.crop;
    const fr = {x: r.x / ed.dispW, y: r.y / ed.dispH, w: r.w / ed.dispW, h: r.h / ed.dispH};
    const idx = ctx.o.scope === 'cur' ? [ed.page - 1] : doc.getPageIndices();
    for (const i of idx) {
      const page = doc.getPage(i); const g = geom(page);
      const dx = fr.x * g.dispW, dy = fr.y * g.dispH, dw = fr.w * g.dispW, dh = fr.h * g.dispH;
      const a = g.map(dx, dy), b = g.map(dx + dw, dy + dh);
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(a.x - b.x), hh = Math.abs(a.y - b.y);
      page.setCropBox(x, y, w, hh); page.setMediaBox(x, y, w, hh);
    }
    return {outputs: [{name: baseName(f.name) + '_자르기.pdf', blob: await saveDoc(doc)}], summary: `${idx.length}쪽을 잘랐습니다.`};
  }});

/* forms */
async function detectFields(){
  const f = S.files[0]; const d = await pjs(f); let added = 0;
  for (let i = 1; i <= d.numPages; i++) {
    const t = await pageTextItems(await d.getPage(i));
    for (const it of t.items) {
      const re = /_{3,}|\.{6,}/g; let m;
      while ((m = re.exec(it.str))) { const cw = it.w / it.str.length; edObjs(i).push({kind: 'field', ftype: 'text', name: '필드' + (++added), x: it.x + m.index * cw, y: it.y - it.h * 0.2, w: Math.max(30, m[0].length * cw), h: it.h * 1.3}); }
      const re2 = /[□☐▢]/g; while ((m = re2.exec(it.str))) { const cw = it.w / it.str.length; edObjs(i).push({kind: 'field', ftype: 'check', name: '체크' + (++added), x: it.x + m.index * cw, y: it.y, w: it.h, h: it.h}); }
    }
  }
  toast(added ? `빈칸 ${added}개를 찾아 필드로 만들었습니다.` : '자동으로 찾은 빈칸이 없습니다. 도구로 직접 추가하세요.');
  drawStage(); drawRail();
}
editorTool({id: 'forms', cat: 'edit', code: 'FORM', title: 'PDF 양식', desc: '양식 필드를 채우거나, 빈칸을 찾아 작성 가능한 PDF 양식으로 만듭니다.', kw: '폼 필드 체크박스 작성', isNew: false,
  ed: {tools: ['select', 'ftext', 'fcheck', '|', 'text'], barExtra: () => [h('button', {class: 'btn ghost small', type: 'button', onclick: detectFields}, '빈칸 자동 찾기')]},
  async onFiles(){
    edInit(this.ed); S.formFields = [];
    const f = S.files[0]; if (!f || !f.pages) return;
    try { const doc = await libDoc(f); const form = doc.getForm();
      S.formFields = form.getFields().map(fl => {
        const type = fl.constructor.name; const name = fl.getName(); let value = '', options = [];
        try { if (type === 'PDFTextField') value = fl.getText() || ''; if (type === 'PDFCheckBox') value = fl.isChecked(); if (type === 'PDFDropdown' || type === 'PDFOptionList') { options = fl.getOptions(); value = (fl.getSelected() || [])[0] || ''; } if (type === 'PDFRadioGroup') { options = fl.getOptions(); value = fl.getSelected() || ''; } } catch (e) {}
        return {name, type, value, options};
      }).filter(x => x.type !== 'PDFButton' && x.type !== 'PDFSignature');
    } catch (e) { S.formFields = []; }
  },
  opts: () => {
    const ff = S.formFields || [];
    const list = ff.length ? h('div', {class: 'form-fields'}, ff.map((fl, i) => {
      const id = 'ff' + i;
      if (fl.type === 'PDFCheckBox') return h('label', {class: 'chk'}, h('input', {type: 'checkbox', id, checked: !!fl.value, onchange: e => fl.value = e.target.checked}), fl.name);
      if (fl.options.length) return h('div', {class: 'fld'}, h('label', {for: id}, fl.name), h('select', {class: 'in', id, onchange: e => fl.value = e.target.value}, h('option', {value: ''}, '선택 안 함'), fl.options.map(o => h('option', {value: o, selected: o === fl.value || null}, o))));
      return h('div', {class: 'fld'}, h('label', {for: id}, fl.name), h('input', {class: 'in', id, value: fl.value, oninput: e => fl.value = e.target.value}));
    })) : null;
    return [
      ff.length ? {type: 'note', text: `이 PDF에는 채울 수 있는 필드가 ${ff.length}개 있습니다.`} : {type: 'note', text: '채울 수 있는 필드가 없는 PDF입니다. "빈칸 자동 찾기"나 위쪽 도구로 필드를 만들면 작성 가능한 양식이 됩니다.'},
      list ? {type: 'custom', render: () => list} : null,
      {id: 'flatten', type: 'check', def: false, label: '입력한 내용을 고정하기 (더 이상 고칠 수 없게)'},
      ...edPropsRail().map(n => ({type: 'custom', render: () => n}))
    ].filter(Boolean);
  },
  ready: () => S.files.length && S.files[0].pages > 0, action: '양식 저장',
  async run(ctx){
    const f = ctx.files[0]; const doc = await libDoc(f); const form = doc.getForm(); const font = await korFont(doc);
    for (const fl of S.formFields || []) {
      try { const fld = form.getField(fl.name);
        if (fl.type === 'PDFTextField') fld.setText(fl.value || '');
        else if (fl.type === 'PDFCheckBox') fl.value ? fld.check() : fld.uncheck();
        else if ((fl.type === 'PDFDropdown' || fl.type === 'PDFOptionList' || fl.type === 'PDFRadioGroup') && fl.value) fld.select(fl.value);
      } catch (e) {}
    }
    const used = new Set(form.getFields().map(x => x.getName()));
    for (const [pn, list] of Object.entries(S.ed.objs)) {
      const page = doc.getPage(+pn - 1); const g = geom(page);
      for (const o of list) {
        if (o.kind !== 'field') continue;
        let name = o.name || 'field'; let k = 2; while (used.has(name)) name = (o.name || 'field') + '_' + k++; used.add(name);
        const p = g.map(o.x, o.y + o.h);
        if (o.ftype === 'check') form.createCheckBox(name).addToPage(page, {x: p.x, y: p.y, width: o.w, height: o.h, rotate: g.rot, borderWidth: 1, borderColor: rgb(.3, .3, .3)});
        else { const tf = form.createTextField(name); tf.addToPage(page, {x: p.x, y: p.y, width: o.w, height: o.h, rotate: g.rot, font, borderWidth: 0.6, borderColor: rgb(.55, .58, .65)}); }
      }
    }
    await applyObjects(doc, Object.fromEntries(Object.entries(S.ed.objs).map(([k, v]) => [k, v.filter(o => o.kind !== 'field')])));
    try { form.updateFieldAppearances(font); } catch (e) {}
    if (ctx.o.flatten) { try { form.flatten(); } catch (e) {} }
    return {outputs: [{name: baseName(f.name) + '_양식.pdf', blob: await saveDoc(doc)}]};
  }});
