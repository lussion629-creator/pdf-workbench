/* ============ page grid (organize / rotate / remove / extract) ============ */
function initPages(){
  S.pages = [];
  for (const f of S.files) { if (!f.pages) continue; for (let n = 1; n <= f.pages; n++) S.pages.push({key: f.id + '-' + n + '-' + Math.random().toString(36).slice(2, 6), fid: f.id, n, rot: 0, del: false, sel: false}); }
}
function syncPages(){
  if (!S.pages) return initPages();
  const ids = new Set(S.files.map(f => f.id));
  S.pages = S.pages.filter(p => p.blank || ids.has(p.fid));
  for (const f of S.files) if (f.pages && !S.pages.some(p => p.fid === f.id)) for (let n = 1; n <= f.pages; n++) S.pages.push({key: f.id + '-' + n + '-' + Math.random().toString(36).slice(2, 6), fid: f.id, n, rot: 0, del: false, sel: false});
}
const thumbCache = new Map();
function pageThumb(p, box){
  if (p.blank) { box.append(h('div', {class: 'blankpg'})); return; }
  const f = S.files.find(x => x.id === p.fid); if (!f) return;
  const k = p.fid + ':' + p.n;
  const put = c => { const cl = c.cloneNode(); cl.getContext('2d').drawImage(c, 0, 0); box.innerHTML = ''; box.append(cl); applyRot(p, box); };
  if (thumbCache.has(k)) return put(thumbCache.get(k));
  const io = new IntersectionObserver(async ents => {
    if (!ents.some(e => e.isIntersecting)) return; io.disconnect();
    try { const c = await renderFit(f, p.n, 150, 200); thumbCache.set(k, c); put(c); } catch (e) {}
  }, {rootMargin: '300px'});
  io.observe(box);
}
function applyRot(p, box){ const c = box.firstElementChild; if (c) c.style.transform = `rotate(${p.rot}deg)` + (p.rot % 180 ? ' scale(.75)' : ''); }
function pageGrid(st, mode){
  syncPages();
  const multiFile = S.files.length > 1;
  const live = S.pages.filter(p => !p.del).length;
  const bar = h('div', {class: 'stage-bar'});
  if (mode === 'organize') bar.append(h('span', {}, `${live}쪽`), h('span', {class: 'sp'}),
    h('button', {class: 'btn ghost small', type: 'button', onclick: () => { S.pages.reverse(); drawStage(); }}, '순서 뒤집기'),
    h('button', {class: 'btn ghost small', type: 'button', onclick: () => pickFiles()}, '+ PDF 추가'));
  if (mode === 'rotate') bar.append(h('span', {}, '페이지를 누르면 90° 회전합니다'), h('span', {class: 'sp'}),
    h('button', {class: 'btn ghost small', type: 'button', onclick: () => { S.pages.forEach(p => p.rot = (p.rot + 270) % 360); drawStage(); drawRail(); }}, '전체 왼쪽으로'),
    h('button', {class: 'btn ghost small', type: 'button', onclick: () => { S.pages.forEach(p => p.rot = (p.rot + 90) % 360); drawStage(); drawRail(); }}, '전체 오른쪽으로'),
    h('button', {class: 'btn ghost small', type: 'button', onclick: () => { S.pages.forEach(p => p.rot = 0); drawStage(); drawRail(); }}, '초기화'),
    h('button', {class: 'btn ghost small', type: 'button', onclick: () => pickFiles()}, '+ PDF 추가'));
  if (mode === 'remove') bar.append(h('span', {}, `삭제할 페이지를 누르세요 · ${S.pages.length - live}쪽 선택됨`), h('span', {class: 'sp'}),
    h('button', {class: 'btn ghost small', type: 'button', onclick: () => { S.pages.forEach(p => p.del = false); S.opts.rmRange = ''; drawStage(); drawRail(); }}, '선택 해제'));
  if (mode === 'extract') bar.append(h('span', {}, `추출할 페이지를 누르세요 · ${S.pages.filter(p => p.sel).length}쪽 선택됨`), h('span', {class: 'sp'}),
    h('button', {class: 'btn ghost small', type: 'button', onclick: () => { S.pages.forEach(p => p.sel = true); drawStage(); drawRail(); }}, '모두 선택'),
    h('button', {class: 'btn ghost small', type: 'button', onclick: () => { S.pages.forEach(p => p.sel = false); drawStage(); drawRail(); }}, '선택 해제'));
  st.append(bar); wireDrop(st);
  let drag = null;
  const mkCard = (p, idx) => {
    const pv = h('div', {class: 'pv'});
    const f = S.files.find(x => x.id === p.fid);
    const label = p.blank ? '빈 페이지' : (multiFile && mode === 'organize' ? `${S.files.indexOf(f) + 1}-${p.n}` : String(p.n));
    const c = h('div', {class: 'pcard' + (p.sel ? ' sel' : '') + (p.del ? ' del' : ''), tabindex: '0', draggable: mode === 'organize' ? 'true' : null},
      mode === 'extract' ? h('span', {class: 'tick'}, p.sel ? '✓' : '') : null,
      h('div', {class: 'pt'},
        mode === 'organize' || mode === 'rotate' ? [ib('rotL', '왼쪽으로 회전', () => { p.rot = (p.rot + 270) % 360; applyRot(p, pv); drawRail(); }), ib('rotR', '오른쪽으로 회전', () => { p.rot = (p.rot + 90) % 360; applyRot(p, pv); drawRail(); })] : null,
        mode === 'organize' ? [ib('plus', '뒤에 빈 페이지 넣기', () => { const ref = S.pages[idx]; S.pages.splice(idx + 1, 0, {key: 'b' + Math.random(), blank: true, fid: ref.fid, n: ref.n, rot: 0}); drawStage(); }),
          ib('copy', '복제', () => { S.pages.splice(idx + 1, 0, {...p, key: p.key + 'c' + Math.random()}); drawStage(); }),
          ib('x', '삭제', () => { S.pages.splice(idx, 1); drawStage(); })] : null),
      pv, h('span', {class: 'no'}, label));
    pageThumb(p, pv);
    const act = () => {
      if (mode === 'rotate') { p.rot = (p.rot + 90) % 360; applyRot(p, pv); drawRail(); }
      if (mode === 'remove') { p.del = !p.del; drawStage(); syncRmRange(); }
      if (mode === 'extract') { p.sel = !p.sel; drawStage(); drawRail(); }
    };
    c.addEventListener('click', act);
    c.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); } });
    if (mode === 'organize') {
      c.addEventListener('dragstart', e => { drag = p; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p.key); c.style.opacity = '.4'; });
      c.addEventListener('dragend', () => { c.style.opacity = ''; });
      c.addEventListener('dragover', e => { if (drag) { e.preventDefault(); c.classList.add('drop-before'); } });
      c.addEventListener('dragleave', () => c.classList.remove('drop-before'));
      c.addEventListener('drop', e => {
        if (!drag) return; e.preventDefault(); e.stopPropagation();
        const from = S.pages.indexOf(drag); S.pages.splice(from, 1); const to = S.pages.indexOf(p); S.pages.splice(to, 0, drag); drag = null; drawStage();
      });
    }
    return c;
  };
  if (mode === 'rotate' && multiFile) {
    for (const f of S.files) {
      st.append(h('div', {class: 'pgroup'}, h('h4', {}, f.name), h('div', {class: 'pages'}, S.pages.filter(p => p.fid === f.id).map(p => mkCard(p, S.pages.indexOf(p))))));
    }
  } else st.append(h('div', {class: 'pages'}, S.pages.map(mkCard)));
}
function syncRmRange(){
  const ns = S.pages.filter(p => p.del).map(p => p.n);
  S.opts.rmRange = compactRanges(ns); drawRail();
}
function compactRanges(ns){
  ns = [...new Set(ns)].sort((a, b) => a - b); const out = [];
  for (let i = 0; i < ns.length; i++) { let j = i; while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++; out.push(i === j ? '' + ns[i] : `${ns[i]}-${ns[j]}`); i = j; }
  return out.join(', ');
}
async function srcDocs(files){ const m = new Map(); for (const f of files) if (f.pages) m.set(f.id, await libDoc(f)); return m; }
async function buildFromPages(pages, docs, ctx){
  const out = await PDFDocument.create();
  let i = 0;
  for (const p of pages) {
    if (p.blank) {
      const ref = docs.get(p.fid); let sz = [595.28, 841.89];
      if (ref) { const rp = ref.getPage(Math.min(p.n, ref.getPageCount()) - 1); const g = geom(rp); sz = [g.dispW, g.dispH]; }
      out.addPage(sz);
    } else {
      const [cp] = await out.copyPages(docs.get(p.fid), [p.n - 1]);
      if (p.rot) cp.setRotation(degrees(((cp.getRotation().angle || 0) + p.rot) % 360));
      out.addPage(cp);
    }
    if (ctx) await ctx.progress(++i / pages.length, `페이지 정리 중 ${i}/${pages.length}`);
  }
  return out;
}
async function copyIdx(src, idx){ const out = await PDFDocument.create(); const cps = await out.copyPages(src, idx); cps.forEach(p => out.addPage(p)); return out; }

/* ============ PDF 구성 ============ */
tool({id: 'merge', cat: 'org', code: '1+2', title: 'PDF 합치기', desc: '여러 PDF를 원하는 순서로 하나의 파일로 합칩니다.', multi: true, min: 2, kw: '병합 결합',
  long: '여러 PDF를 원하는 순서로 하나로 합칩니다. 카드를 끌어서 순서를 바꾸세요.',
  needMsg: () => S.files.length < 2 ? 'PDF를 2개 이상 넣어 주세요.' : '',
  opts: [{id: 'evenPad', type: 'check', def: false, label: '양면 인쇄용 빈 페이지 넣기', hint: '홀수 쪽으로 끝나는 파일 뒤에 빈 페이지를 넣어, 다음 파일이 새 장에서 시작하게 합니다.'},
    {id: 'outName', type: 'text', def: '합친문서', label: '파일 이름'}],
  action: 'PDF 합치기',
  async run(ctx){
    const out = await PDFDocument.create(); let i = 0;
    for (const f of ctx.files) {
      await ctx.progress(i / ctx.files.length, `${f.name} 합치는 중`);
      const src = await libDoc(f); const cps = await out.copyPages(src, src.getPageIndices()); cps.forEach(p => out.addPage(p));
      if (ctx.o.evenPad && cps.length % 2 && i < ctx.files.length - 1) { const g = geom(cps[cps.length - 1]); out.addPage([g.dispW, g.dispH]); }
      i++;
    }
    await ctx.progress(1, '저장하는 중');
    return {outputs: [{name: (ctx.o.outName || '합친문서').replace(/\.pdf$/i, '') + '.pdf', blob: await saveDoc(out)}], summary: `${ctx.files.length}개 파일, ${out.getPageCount()}쪽을 하나로 합쳤습니다.`};
  }});

tool({id: 'split', cat: 'org', code: '1÷2', title: 'PDF 분할', desc: '페이지 범위를 정해 나누거나, 모든 페이지를 각각의 PDF로 만듭니다.', kw: '나누기 분리',
  opts: () => {
    const n = S.files[0] && S.files[0].pages || 0;
    return [
      {id: 'mode', type: 'seg', def: 'ranges', label: '나누는 방법', choices: [['ranges', '범위 지정'], ['fixed', '일정 간격'], ['each', '모든 페이지']]},
      {id: 'ranges', type: 'text', def: () => n > 1 ? `1-${Math.ceil(n / 2)}, ${Math.ceil(n / 2) + 1}-${n}` : '1', label: '범위', hint: `쉼표로 구분한 범위마다 파일 하나가 만들어집니다. 전체 ${n}쪽.`, show: o => o.mode === 'ranges'},
      {id: 'mergeR', type: 'check', def: false, label: '모든 범위를 하나의 PDF로 합치기', show: o => o.mode === 'ranges'},
      {id: 'every', type: 'number', def: 2, min: 1, label: '몇 쪽마다 나눌까요', show: o => o.mode === 'fixed', hint: o => n ? `파일 ${Math.ceil(n / Math.max(1, +o.every || 1))}개가 만들어집니다.` : ''},
      {id: 'eachSel', type: 'text', def: '', placeholder: '비우면 전체', label: '추출할 페이지', show: o => o.mode === 'each', hint: '예: 1, 3-5. 지정한 페이지만 각각 PDF로 만듭니다.'}
    ];
  },
  onFiles(){ const n = S.files[0] && S.files[0].pages || 0; S.opts.ranges = n > 1 ? `1-${Math.ceil(n / 2)}, ${Math.ceil(n / 2) + 1}-${n}` : '1'; },
  action: 'PDF 분할',
  async run(ctx){
    const f = ctx.files[0]; const src = await libDoc(f); const n = src.getPageCount(); const base = baseName(f.name); const o = ctx.o;
    let groups;
    if (o.mode === 'fixed') { const k = Math.max(1, +o.every || 1); groups = []; for (let i = 0; i < n; i += k) groups.push({label: `${i + 1}-${Math.min(n, i + k)}`, idx: [...Array(Math.min(k, n - i)).keys()].map(j => i + j)}); }
    else if (o.mode === 'each') { const idx = o.eachSel ? parseRanges(o.eachSel, n) : [...Array(n).keys()]; groups = idx.map(i => ({label: String(i + 1), idx: [i]})); }
    else { groups = rangeGroups(o.ranges, n); if (o.mergeR) groups = [{label: groups.map(g => g.label).join('_'), idx: groups.flatMap(g => g.idx)}]; }
    if (!groups.length) throw userErr('나눌 페이지 범위를 입력하세요.');
    const outs = [];
    for (let i = 0; i < groups.length; i++) {
      await ctx.progress(i / groups.length, `파일 ${i + 1}/${groups.length} 만드는 중`);
      const d = await copyIdx(src, groups[i].idx); outs.push({name: `${base}_${groups[i].label}.pdf`, blob: await saveDoc(d)});
    }
    return {outputs: outs, zipName: base + '_분할.zip', summary: `${outs.length}개 파일로 나눴습니다.`};
  }});

tool({id: 'remove', cat: 'org', code: '−PG', title: '페이지 제거', desc: '필요 없는 페이지를 골라 지웁니다.', kw: '삭제',
  stage: st => pageGrid(st, 'remove'),
  opts: [{id: 'rmRange', type: 'text', def: '', label: '삭제할 페이지', placeholder: '예: 2, 5-7', live: true, hint: '직접 입력하거나 왼쪽에서 페이지를 누르세요.'}],
  onOpt(id, v){ if (id === 'rmRange' && S.pages) { try { const idx = new Set(parseRanges(v, S.files[0].pages)); S.pages.forEach(p => p.del = idx.has(p.n - 1)); drawStage(); } catch (e) {} } },
  ready: () => S.files.length && S.pages && S.pages.some(p => p.del) && S.pages.some(p => !p.del),
  needMsg: () => S.pages && S.pages.length && S.pages.every(p => p.del) ? '모든 페이지를 지울 수는 없습니다.' : '지울 페이지를 하나 이상 고르세요.',
  action: '페이지 삭제',
  async run(ctx){
    const f = ctx.files[0]; const src = await libDoc(f);
    const del = S.pages.filter(p => p.del).map(p => p.n - 1).sort((a, b) => b - a);
    del.forEach(i => src.removePage(i));
    return {outputs: [{name: baseName(f.name) + '_편집.pdf', blob: await saveDoc(src)}], summary: `${del.length}쪽을 지우고 ${src.getPageCount()}쪽이 남았습니다.`};
  }});

tool({id: 'extract', cat: 'org', code: 'PG↗', title: '페이지 추출', desc: '원하는 페이지만 골라 새 PDF로 만듭니다.', kw: '뽑기',
  stage: st => pageGrid(st, 'extract'),
  opts: [{id: 'exRange', type: 'text', def: '', label: '추출할 페이지', placeholder: '예: 1, 3-5', live: true},
    {id: 'exMode', type: 'seg', def: 'one', label: '결과', choices: [['one', '하나의 PDF'], ['each', '페이지마다 PDF']]}],
  onOpt(id, v){ if (id === 'exRange' && S.pages) { try { const idx = new Set(parseRanges(v, S.files[0].pages)); S.pages.forEach(p => p.sel = idx.has(p.n - 1)); drawStage(); } catch (e) {} } },
  ready: () => S.pages && S.pages.some(p => p.sel),
  needMsg: '추출할 페이지를 하나 이상 고르세요.',
  action: '페이지 추출',
  async run(ctx){
    const f = ctx.files[0]; const src = await libDoc(f); const idx = S.pages.filter(p => p.sel).map(p => p.n - 1); const base = baseName(f.name);
    if (ctx.o.exMode === 'each') { const outs = []; for (const i of idx) { await ctx.progress(outs.length / idx.length); outs.push({name: `${base}_${i + 1}.pdf`, blob: await saveDoc(await copyIdx(src, [i]))}); } return {outputs: outs, zipName: base + '_추출.zip'}; }
    return {outputs: [{name: `${base}_추출.pdf`, blob: await saveDoc(await copyIdx(src, idx))}], summary: `${idx.length}쪽을 추출했습니다.`};
  }});

tool({id: 'organize', cat: 'org', code: '⇅', title: 'PDF 구성', desc: '페이지 순서를 바꾸고, 지우고, 회전하고, 빈 페이지나 다른 PDF를 끼워 넣습니다.', multi: true, kw: '순서 정렬 재배열',
  stage: st => pageGrid(st, 'organize'),
  onFiles(){ syncPages(); },
  opts: [{id: 'n1', type: 'note', text: '페이지를 끌어서 순서를 바꾸세요. 페이지 위에 마우스를 올리면 회전·복제·삭제·빈 페이지 추가 버튼이 나옵니다.'}],
  ready: () => S.pages && S.pages.length > 0,
  action: '구성 적용',
  async run(ctx){
    const docs = await srcDocs(ctx.files); const out = await buildFromPages(S.pages, docs, ctx);
    return {outputs: [{name: baseName(ctx.files[0].name) + '_구성.pdf', blob: await saveDoc(out)}], summary: `${out.getPageCount()}쪽으로 구성했습니다.`};
  }});

/* images -> PDF (shared by JPG→PDF and scan) */
function enhance(c, mode){
  if (mode === 'none') return c;
  const ctx = c.getContext('2d', {willReadFrequently: true}); const im = ctx.getImageData(0, 0, c.width, c.height); const d = im.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) { const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; hist[y]++; }
  const tot = d.length / 4; let acc = 0, lo = 0, hi = 255;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > tot * 0.02) { lo = i; break; } }
  acc = 0; for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > tot * 0.2) { hi = i; break; } }
  const span = Math.max(20, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    if (mode === 'color') { for (let k = 0; k < 3; k++) d[i + k] = Math.max(0, Math.min(255, (d[i + k] - lo) * 255 / span)); continue; }
    let y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000; y = (y - lo) * 255 / span;
    if (mode === 'bw') y = y > 165 ? 255 : y < 90 ? 0 : (y - 90) * 255 / 75;
    y = Math.max(0, Math.min(255, y)); d[i] = d[i + 1] = d[i + 2] = y;
  }
  ctx.putImageData(im, 0, 0); return c;
}
async function imagesToPdf(ctx, enhanceMode){
  const o = ctx.o; const outs = []; let doc = await PDFDocument.create(); let i = 0;
  const margin = {none: 0, small: 20, big: 40}[o.margin || 'none'];
  for (const f of ctx.files) {
    await ctx.progress(i / ctx.files.length, `${f.name} 넣는 중`);
    let img;
    if (enhanceMode && enhanceMode !== 'none') { const bm = await loadImage(f.file); const c = enhance(toCanvas(bm, 3000), enhanceMode); img = await embedCanvas(doc, c, 0.85); }
    else img = await embedAny(doc, f.file);
    let pw, ph;
    if (o.size === 'fit') { pw = img.width * 0.75 + margin * 2; ph = img.height * 0.75 + margin * 2; }
    else {
      [pw, ph] = PAGE_SIZES[o.size || 'a4'];
      const land = o.orient === 'land' || (o.orient === 'auto' && img.width > img.height);
      if (land) [pw, ph] = [ph, pw];
    }
    const page = doc.addPage([pw, ph]);
    const s = Math.min((pw - margin * 2) / img.width, (ph - margin * 2) / img.height);
    const w = img.width * s, hh = img.height * s;
    page.drawImage(img, {x: (pw - w) / 2, y: (ph - hh) / 2, width: w, height: hh});
    i++;
    if (o.merge === false) { outs.push({name: baseName(f.name) + '.pdf', blob: await saveDoc(doc)}); doc = await PDFDocument.create(); }
  }
  if (o.merge !== false) outs.push({name: (ctx.files.length === 1 ? baseName(ctx.files[0].name) : (enhanceMode ? '스캔문서' : '이미지모음')) + '.pdf', blob: await saveDoc(doc)});
  return {outputs: outs, zipName: '이미지_PDF.zip', summary: `이미지 ${ctx.files.length}장을 PDF로 만들었습니다.`};
}
function imgOpts(scan){
  return [
    scan ? {id: 'enh', type: 'seg', def: 'bw', label: '보정', choices: [['bw', '문서(흑백)'], ['gray', '회색조'], ['color', '컬러 선명'], ['none', '원본']], hint: '종이 문서는 흑백 보정을 쓰면 배경이 하얗고 글자가 또렷해집니다.'} : null,
    {id: 'orient', type: 'seg', def: 'auto', label: '방향', choices: [['auto', '자동'], ['port', '세로'], ['land', '가로']], show: o => o.size !== 'fit'},
    {id: 'size', type: 'select', def: 'a4', label: '페이지 크기', choices: [['a4', 'A4 (297×210mm)'], ['letter', 'US Letter'], ['a3', 'A3'], ['a5', 'A5'], ['legal', 'US Legal'], ['fit', '이미지 크기에 맞춤']]},
    {id: 'margin', type: 'seg', def: scan ? 'none' : 'small', label: '여백', choices: [['none', '없음'], ['small', '좁게'], ['big', '넓게']]},
    {id: 'merge', type: 'check', def: true, label: '모든 이미지를 하나의 PDF로 합치기'}
  ].filter(Boolean);
}
tool({id: 'scan', cat: 'org', code: 'SCAN', title: 'PDF로 스캔', desc: '휴대폰으로 찍은 문서 사진을 깔끔한 PDF 스캔본으로 만듭니다.', accept: 'image', multi: true, camera: true, kw: '사진 카메라',
  long: '문서를 찍은 사진을 넣으면 밝기와 대비를 보정해 스캔본처럼 만듭니다. 휴대폰에서는 "카메라로 촬영"을 누르면 바로 찍을 수 있습니다.',
  opts: () => imgOpts(true), action: 'PDF 스캔본 만들기',
  run: ctx => imagesToPdf(ctx, ctx.o.enh)});
