/* ============ PDF 최적화 ============ */
const N = k => PDFName.of(k);
function nameOf(v){ return v instanceof PDFName ? v.asString().replace(/^\//, '') : null; }
async function inflate(bytes){
  const ds = new DecompressionStream('deflate');
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(buf);
}
function unpredict(data, colors, columns){
  const rowLen = colors * columns; const out = new Uint8Array(rowLen * Math.floor(data.length / (rowLen + 1)));
  let prev = new Uint8Array(rowLen);
  for (let r = 0, ip = 0, op = 0; ip + rowLen < data.length + 1 && op < out.length; r++) {
    const ft = data[ip++]; const row = out.subarray(op, op + rowLen);
    for (let i = 0; i < rowLen; i++) {
      const raw = data[ip + i]; const a = i >= colors ? row[i - colors] : 0; const b = prev[i]; const c = i >= colors ? prev[i - colors] : 0;
      let v;
      switch (ft) { case 1: v = raw + a; break; case 2: v = raw + b; break; case 3: v = raw + ((a + b) >> 1); break;
        case 4: { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
        default: v = raw; }
      row[i] = v & 255;
    }
    prev = row; ip += rowLen; op += rowLen;
  }
  return out;
}
function csComps(doc, cs){
  if (cs instanceof PDFName) { const n = nameOf(cs); return n === 'DeviceRGB' ? 3 : n === 'DeviceGray' ? 1 : 0; }
  if (cs instanceof PDFArray && cs.size() >= 2 && nameOf(cs.lookup(0)) === 'ICCBased') {
    const st = cs.lookup(1); const nn = st && st.dict && st.dict.lookup(N('N')); const v = nn && nn.asNumber ? nn.asNumber() : 0; return v === 3 || v === 1 ? v : 0;
  }
  return 0;
}
async function recompressImages(doc, q, maxDim, ctx){
  const imgs = doc.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFRawStream && nameOf(o.dict.lookup(N('Subtype'))) === 'Image');
  let saved = 0, changed = 0, i = 0;
  for (const [ref, s] of imgs) {
    await ctx.progress(0.1 + 0.8 * (i++ / imgs.length), `이미지 최적화 ${i}/${imgs.length}`);
    try {
      const d = s.dict;
      const imk = d.lookup(N('ImageMask'));
      if ((imk && imk.asBoolean && imk.asBoolean()) || d.lookup(N('Decode'))) continue;
      const bpc = d.lookup(N('BitsPerComponent')); if (!bpc || bpc.asNumber() !== 8) continue;
      const W = d.lookup(N('Width')).asNumber(), H = d.lookup(N('Height')).asNumber();
      if (W * H < 40000 || s.contents.length < 24000) continue;
      const comps = csComps(doc, d.lookup(N('ColorSpace'))); if (!comps) continue;
      let filt = d.lookup(N('Filter')); if (filt instanceof PDFArray) { if (filt.size() !== 1) continue; filt = filt.lookup(0); }
      const fn = nameOf(filt);
      let src;
      if (fn === 'DCTDecode') { src = await createImageBitmap(new Blob([s.contents], {type: 'image/jpeg'})); }
      else if (fn === 'FlateDecode') {
        let raw = await inflate(s.contents);
        const dp = d.lookup(N('DecodeParms'));
        if (dp instanceof PDFDict) { const pr = dp.lookup(N('Predictor')); if (pr && pr.asNumber() >= 10) { const col = dp.lookup(N('Columns')); raw = unpredict(raw, comps, col ? col.asNumber() : W); } else if (pr && pr.asNumber() > 1) continue; }
        if (raw.length < W * H * comps) continue;
        const im = new ImageData(W, H); const px = im.data;
        for (let p = 0, k = 0; p < W * H; p++) { if (comps === 3) { px[p * 4] = raw[k++]; px[p * 4 + 1] = raw[k++]; px[p * 4 + 2] = raw[k++]; } else { px[p * 4] = px[p * 4 + 1] = px[p * 4 + 2] = raw[k++]; } px[p * 4 + 3] = 255; }
        src = await createImageBitmap(im);
      } else continue;
      const c = toCanvas(src, maxDim);
      const jb = await blobBytes(await canvasBlob(c, 'image/jpeg', q));
      if (jb.length >= s.contents.length * 0.92) continue;
      const nd = d.clone(doc.context);
      nd.set(N('Filter'), N('DCTDecode')); nd.delete(N('DecodeParms')); nd.delete(N('Length'));
      nd.set(N('Width'), PDFNumber.of(c.width)); nd.set(N('Height'), PDFNumber.of(c.height));
      nd.set(N('ColorSpace'), N('DeviceRGB')); nd.set(N('BitsPerComponent'), PDFNumber.of(8));
      doc.context.assign(ref, PDFRawStream.of(nd, jb));
      saved += s.contents.length - jb.length; changed++;
    } catch (e) { /* leave this image as is */ }
  }
  return {saved, changed, total: imgs.length};
}
async function rasterize(f, dpi, q, ctx, label){
  const d = await pjs(f); const out = await PDFDocument.create();
  for (let i = 1; i <= d.numPages; i++) {
    await ctx.progress(i / d.numPages, `${label || '페이지'} ${i}/${d.numPages} 처리 중`);
    const p = await d.getPage(i); const vp = p.getViewport({scale: 1});
    const c = await renderPage(p, dpi / 72); const img = await embedCanvas(out, c, q);
    const pg = out.addPage([vp.width, vp.height]); pg.drawImage(img, {x: 0, y: 0, width: vp.width, height: vp.height});
  }
  return out;
}
const LEVELS = {low: {q: 0.82, max: 2400, dpi: 150, label: '낮은 압축'}, rec: {q: 0.66, max: 1600, dpi: 120, label: '권장 압축'}, high: {q: 0.45, max: 1000, dpi: 90, label: '강력 압축'}};
tool({id: 'compress', cat: 'opt', code: 'KB↓', title: 'PDF 압축', desc: '품질은 최대한 지키면서 PDF 파일 크기를 줄입니다.', multi: true, kw: '용량 줄이기 최적화',
  opts: [{id: 'level', type: 'seg', def: 'rec', label: '압축 수준', choices: [['low', '낮음'], ['rec', '권장'], ['high', '강력']],
      hint: o => ({low: '화질을 거의 그대로 두고 조금 줄입니다.', rec: '화질과 크기의 균형. 대부분의 문서에 알맞습니다.', high: '이미지 화질을 낮춰 크기를 크게 줄입니다.'})[o.level]},
    {id: 'raster', type: 'check', def: false, label: '페이지 전체를 이미지로 바꿔서 더 줄이기', hint: '스캔 문서에 효과적입니다. 대신 글자를 선택하거나 검색할 수 없게 됩니다.'}],
  action: 'PDF 압축',
  async run(ctx){
    const L = LEVELS[ctx.o.level || 'rec']; const outs = []; const lines = [];
    for (const f of ctx.files) {
      await ctx.progress(0, `${f.name} 분석 중`);
      let blob;
      if (ctx.o.raster) blob = await saveDoc(await rasterize(f, L.dpi, L.q, ctx));
      else {
        const doc = await libDoc(f); await recompressImages(doc, L.q, L.max, ctx);
        await ctx.progress(0.95, '저장하는 중');
        blob = pdfBlob(await doc.save({useObjectStreams: true}));
      }
      const orig = f.size; const smaller = blob.size < orig;
      if (!smaller) blob = new Blob([f.bytes], {type: 'application/pdf'});
      outs.push({name: baseName(f.name) + '_압축.pdf', blob});
      lines.push(h('div', {class: 'out cmp'}, h('span', {class: 'nm'}, f.name), h('span', {}, fmtSize(orig), ' → ', fmtSize(blob.size), ' ', smaller ? h('b', {}, `(${Math.round((1 - blob.size / orig) * 100)}% 감소)`) : '(이미 최적화되어 있어 원본 유지)')));
    }
    const before = ctx.files.reduce((s, f) => s + f.size, 0), after = outs.reduce((s, o) => s + o.blob.size, 0);
    return {outputs: outs, zipName: '압축된_PDF.zip', title: after < before ? `${Math.round((1 - after / before) * 100)}% 줄였습니다` : '더 줄일 부분이 없었습니다', summary: `${fmtSize(before)} → ${fmtSize(after)}`, view: h('div', {class: 'outlist'}, lines)};
  }});

tool({id: 'repair', cat: 'opt', code: 'FIX', title: 'PDF 복구', desc: '손상되었거나 열리지 않는 PDF를 고쳐 남은 내용을 살립니다.', multi: true, kw: '고치기 손상',
  opts: [{id: 'n', type: 'note', text: '먼저 파일 구조를 다시 씁니다. 그래도 읽히지 않으면 화면에 그릴 수 있는 페이지를 이미지로 옮겨 새 PDF를 만듭니다.'}],
  ready: () => S.files.length > 0, action: 'PDF 복구',
  async run(ctx){
    const outs = []; const notes = [];
    for (const f of ctx.files) {
      await ctx.progress(0, `${f.name} 확인 중`); await fileBytes(f);
      let ok = false;
      try {
        const d = await PDFDocument.load(f.bytes, {ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false});
        const n = d.getPageCount();
        if (n > 0 && !d.isEncrypted) { d.getPages().forEach(p => p.getSize()); outs.push({name: baseName(f.name) + '_복구.pdf', blob: pdfBlob(await d.save({useObjectStreams: false}))}); notes.push(`${f.name}: 구조를 다시 써서 ${n}쪽을 복구했습니다.`); ok = true; }
      } catch (e) {}
      if (!ok) {
        try { f._pjs = null; const doc = await rasterize(f, 150, 0.85, ctx, '페이지 복원'); outs.push({name: baseName(f.name) + '_복구.pdf', blob: await saveDoc(doc)}); notes.push(`${f.name}: 페이지 ${doc.getPageCount()}쪽을 이미지로 옮겨 복구했습니다.`); }
        catch (e) { notes.push(`${f.name}: 복구할 수 있는 내용을 찾지 못했습니다.${isPwErr(e) ? ' 암호가 걸린 파일입니다.' : ''}`); }
      }
    }
    if (!outs.length) throw userErr(notes.join(' '));
    return {outputs: outs, zipName: '복구된_PDF.zip', view: h('div', {class: 'note'}, notes.map(n => h('div', {}, n)))};
  }});

/* OCR */
let _ocr = {};
async function ocrWorker(langs, ctx){
  if (_ocr.key === langs && _ocr.w) return _ocr.w;
  if (_ocr.w) { try { await _ocr.w.terminate(); } catch (e) {} }
  await need('tess');
  const base = new URL('.', location.href).href;
  _ocr.cb = null;
  const w = await Tesseract.createWorker(langs.split('+'), 1, {
    workerPath: base + 'tess/worker.min.js', corePath: base + 'tess/core', langPath: base + 'tess/lang', workerBlobURL: false, gzip: true, cacheMethod: 'none',
    logger: m => { _ocr.cb && _ocr.cb(m); }
  });
  _ocr = {key: langs, w, cb: null};
  return w;
}
async function ocrPages(f, ctx, langs, skipText){
  _ocr.cb = null;
  await ctx.progress(0.02, '문자 인식 엔진을 준비하는 중 (처음 한 번은 수십 초 걸립니다)');
  const w = await ocrWorker(langs, ctx);
  const d = await pjs(f); const res = [];
  for (let i = 1; i <= d.numPages; i++) {
    ctx.check();
    const p = await d.getPage(i);
    if (skipText) { const tc = await p.getTextContent(); if (tc.items.filter(t => t.str.trim()).length > 8) { res.push({n: i, skipped: true}); continue; } }
    const vp = p.getViewport({scale: 1}); const scale = Math.min(3, 2600 / Math.max(vp.width, vp.height));
    const c = await renderPage(p, scale);
    _ocr.cb = m => { if (m.status === 'recognizing text') ctx.progress((i - 1 + m.progress) / d.numPages, `${i}/${d.numPages}쪽 글자 인식 중 ${Math.round(m.progress * 100)}%`).catch(() => {}); };
    await ctx.progress((i - 1) / d.numPages, `${i}/${d.numPages}쪽 글자 인식 중`);
    const {data} = await w.recognize(c);
    res.push({n: i, scale, words: (data.words || []).filter(wd => wd.text.trim() && wd.confidence > 30).map(wd => ({t: wd.text, x0: wd.bbox.x0 / scale, y0: wd.bbox.y0 / scale, x1: wd.bbox.x1 / scale, y1: wd.bbox.y1 / scale})), text: data.text});
  }
  _ocr.cb = null;
  return res;
}
tool({id: 'ocr', cat: 'opt', code: 'OCR', title: 'OCR PDF', desc: '스캔한 PDF에서 글자를 인식해 검색하고 복사할 수 있는 문서로 만듭니다.', kw: '문자인식 텍스트 검색',
  long: '스캔한 PDF의 글자를 인식해 보이지 않는 텍스트 층을 덧입힙니다. 모양은 그대로이고, 검색·복사·선택이 가능해집니다.',
  opts: [{id: 'lang', type: 'seg', def: 'kor+eng', label: '문서 언어', choices: [['kor+eng', '한국어+영어'], ['kor', '한국어'], ['eng', '영어']]},
    {id: 'skip', type: 'check', def: true, label: '이미 글자가 있는 페이지는 건너뛰기'},
    {id: 'txt', type: 'check', def: true, label: '인식한 글자를 텍스트 파일(.txt)로도 받기'}],
  action: 'OCR 실행',
  async run(ctx){
    const f = ctx.files[0]; const pages = await ocrPages(f, ctx, ctx.o.lang || 'kor+eng', ctx.o.skip);
    await ctx.progress(0.97, '텍스트 층을 입히는 중');
    const doc = await libDoc(f); const font = await korFont(doc); let words = 0;
    for (const r of pages) {
      if (r.skipped) continue;
      const page = doc.getPage(r.n - 1); const g = geom(page);
      for (const wd of r.words) {
        const wpt = wd.x1 - wd.x0, hpt = wd.y1 - wd.y0; const t = fsafe(font, wd.t);
        let size = wpt / Math.max(1e-3, font.widthOfTextAtSize(t, 1)); size = Math.max(2, Math.min(size, hpt * 1.3));
        const pt = g.map(wd.x0, wd.y1 - hpt * 0.12);
        page.drawText(t, {x: pt.x, y: pt.y, size, font, rotate: g.rot, opacity: 0});
        words++;
      }
    }
    const outs = [{name: baseName(f.name) + '_OCR.pdf', blob: await saveDoc(doc)}];
    const text = pages.map(r => r.skipped ? '' : `--- ${r.n}쪽 ---\n${r.text || ''}`).filter(Boolean).join('\n\n');
    if (ctx.o.txt) outs.push({name: baseName(f.name) + '_OCR.txt', blob: new Blob([text], {type: 'text/plain'})});
    const done = pages.filter(p => !p.skipped).length;
    return {outputs: outs, summary: `${done}쪽에서 단어 ${words}개를 인식했습니다.${pages.length - done ? ` 글자가 이미 있던 ${pages.length - done}쪽은 건너뛰었습니다.` : ''}`,
      view: text ? h('details', {}, h('summary', {style: {cursor: 'pointer', fontSize: '14px'}}, '인식한 글자 미리 보기'), h('div', {class: 'preview-text'}, text.slice(0, 20000))) : null};
  }});
