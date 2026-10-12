/* ============ PDF로 변환 ============ */
tool({id: 'jpg2pdf', cat: 'to', code: 'JPG', title: 'JPG → PDF', desc: '사진과 이미지를 PDF로 만듭니다. 방향과 여백을 고를 수 있습니다.', accept: 'image', multi: true, kw: '이미지 사진 png',
  opts: () => imgOpts(false), action: 'PDF로 변환', run: ctx => imagesToPdf(ctx, null)});

/* simple flowing layout engine: keeps text selectable */
function collectBlocks(root){
  const out = [];
  const isBold = n => { const s = [...n.querySelectorAll('strong,b')].map(x => x.textContent).join(''); return s.trim() && s.replace(/\s/g, '') === n.textContent.replace(/\s/g, ''); };
  const walk = (el, depth) => {
    for (const n of el.childNodes) {
      if (n.nodeType !== 1) continue; const tag = n.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) { if (n.textContent.trim()) out.push({type: 'h', level: +tag[1], text: n.textContent.trim()}); n.querySelectorAll('img').forEach(i => out.push({type: 'img', src: i.getAttribute('src')})); }
      else if (tag === 'p' || tag === 'div' && !n.querySelector('p,table,ul,ol,div')) {
        const text = n.innerText !== undefined && n.isConnected ? n.innerText.trim() : n.textContent.trim();
        if (text) out.push({type: 'p', text, bold: isBold(n), align: n.style && n.style.textAlign});
        n.querySelectorAll('img').forEach(i => out.push({type: 'img', src: i.getAttribute('src')}));
        if (!text && !n.querySelector('img')) out.push({type: 'gap'});
      }
      else if (tag === 'ul' || tag === 'ol') {
        let k = 0;
        for (const li of n.children) {
          if (li.tagName !== 'LI') continue; k++;
          const cl = li.cloneNode(true); cl.querySelectorAll('ul,ol').forEach(x => x.remove());
          out.push({type: 'li', text: cl.textContent.trim(), marker: tag === 'ol' ? k + '.' : '•', depth});
          [...li.children].filter(c => /^(UL|OL)$/.test(c.tagName)).forEach(s => walk({childNodes: [s]}, depth + 1));
        }
      }
      else if (tag === 'table') out.push({type: 'table', rows: [...n.querySelectorAll('tr')].map(tr => [...tr.children].map(td => td.textContent.trim()))});
      else if (tag === 'img') out.push({type: 'img', src: n.getAttribute('src')});
      else if (tag === 'hr') out.push({type: 'hr'});
      else if (tag === 'br') out.push({type: 'gap'});
      else walk(n, depth);
    }
  };
  walk(root, 0); return out;
}
function wrapText(font, text, size, maxW){
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    const push = () => { lines.push(line.replace(/\s+$/, '')); line = ''; };
    for (const tok of para.split(/(\s+)/)) {
      if (!tok) continue;
      if (font.widthOfTextAtSize(line + tok, size) <= maxW) { line += tok; continue; }
      if (/^\s+$/.test(tok)) { push(); continue; }
      if (line.trim()) push();
      if (font.widthOfTextAtSize(tok, size) <= maxW) { line = tok; continue; }
      for (const ch of tok) { if (font.widthOfTextAtSize(line + ch, size) > maxW && line) push(); line += ch; }
    }
    push();
  }
  return lines;
}
async function flowPdf(blocks, ctx, pageSize){
  const doc = await PDFDocument.create(); const font = await korFont(doc);
  const [PW, PH] = pageSize || PAGE_SIZES.a4; const M = 64, CW = PW - 2 * M;
  let page, y; const newPage = () => { page = doc.addPage([PW, PH]); y = PH - M; }; newPage();
  const ensure = hh => { if (y - hh < M) newPage(); };
  const ink = rgb(0.1, 0.1, 0.12);
  const text = (s, x, yy, size, bold) => { const t = fsafe(font, s); page.drawText(t, {x, y: yy, size, font, color: ink}); if (bold) page.drawText(t, {x: x + size * 0.035, y: yy, size, font, color: ink}); };
  let i = 0;
  for (const b of blocks) {
    if (ctx && ++i % 20 === 0) await ctx.progress(0.3 + 0.6 * i / blocks.length, '페이지를 배치하는 중');
    if (b.type === 'gap') { y -= 8; continue; }
    if (b.type === 'hr') { ensure(14); y -= 7; page.drawLine({start: {x: M, y}, end: {x: PW - M, y}, thickness: 0.6, color: rgb(.7, .7, .7)}); y -= 7; continue; }
    if (b.type === 'h' || b.type === 'p' || b.type === 'li') {
      const size = b.type === 'h' ? [0, 20, 16, 13.5, 12, 11, 11][b.level] : 10.5;
      const indent = b.type === 'li' ? 16 + b.depth * 16 : 0;
      const lines = wrapText(font, fsafe(font, b.text), size, CW - indent);
      if (b.type === 'h') { y -= size * 0.5; ensure(size * 1.45 * Math.min(2, lines.length) + size); }
      lines.forEach((ln, k) => {
        ensure(size * 1.45);
        let x = M + indent;
        if (b.align === 'center') x = M + (CW - font.widthOfTextAtSize(ln, size)) / 2; else if (b.align === 'right') x = PW - M - font.widthOfTextAtSize(ln, size);
        if (b.type === 'li' && k === 0) text(b.marker, M + indent - 13, y - size, size);
        text(ln, x, y - size, size, b.type === 'h' || b.bold); y -= size * 1.45;
      });
      y -= b.type === 'h' ? size * 0.35 : 5;
      continue;
    }
    if (b.type === 'table' && b.rows.length) {
      const nc = Math.max(...b.rows.map(r => r.length)); const cw = CW / nc; const size = 9;
      y -= 4;
      for (const row of b.rows) {
        const cells = row.map(c => wrapText(font, fsafe(font, c), size, cw - 8));
        const rh = Math.max(1, ...cells.map(c => c.length)) * size * 1.35 + 8;
        ensure(rh);
        for (let c = 0; c < nc; c++) {
          page.drawRectangle({x: M + c * cw, y: y - rh, width: cw, height: rh, borderColor: rgb(.62, .64, .68), borderWidth: 0.6});
          (cells[c] || []).forEach((ln, k) => text(ln, M + c * cw + 4, y - 4 - size - k * size * 1.35, size));
        }
        y -= rh;
      }
      y -= 8; continue;
    }
    if (b.type === 'img' && b.src) {
      try {
        let img;
        const m = /^data:([^;]+);base64,(.*)$/.exec(b.src);
        if (m && m[1] === 'image/png') img = await doc.embedPng(b64bytes(m[2]));
        else if (m && m[1] === 'image/jpeg') img = await doc.embedJpg(b64bytes(m[2]));
        else { const im = new Image(); im.src = b.src; await im.decode(); img = await embedCanvas(doc, toCanvas(im, 2400), 0.9); }
        let w = img.width * 0.75, hh = img.height * 0.75; const s = Math.min(1, CW / w, (PH - 2 * M) / hh); w *= s; hh *= s;
        ensure(hh + 6); page.drawImage(img, {x: M, y: y - hh, width: w, height: hh}); y -= hh + 8;
      } catch (e) {}
    }
  }
  return doc;
}
tool({id: 'word2pdf', cat: 'to', code: 'DOCX', title: 'Word → PDF', desc: 'Word 문서(DOCX)를 PDF로 바꿉니다.', accept: 'docx', multi: true, kw: '워드 doc',
  opts: [{id: 'mode', type: 'seg', def: 'text', label: '변환 방식', choices: [['text', '텍스트 유지'], ['look', '모양 그대로']],
    hint: o => o.mode === 'text' ? '글자를 선택·검색할 수 있고 파일이 작습니다. 복잡한 서식은 단순해질 수 있습니다.' : '화면에 보이는 모양을 이미지로 옮깁니다. 글자 선택은 되지 않습니다.'},
    {id: 'n', type: 'note', text: '.docx 형식만 지원합니다. 예전 .doc 파일은 Word에서 .docx로 저장한 뒤 넣어 주세요.'}],
  action: 'PDF로 변환',
  async run(ctx){
    await need('mammoth'); const outs = [];
    for (const f of ctx.files) {
      await ctx.progress(0.05, `${f.name} 읽는 중`);
      const res = await mammoth.convertToHtml({arrayBuffer: await fileBytes(f)});
      const host = h('div', {style: {position: 'fixed', left: '-20000px', top: '0', width: '794px', padding: '72px 76px', background: '#fff', color: '#111', fontFamily: '"IBM Plex Sans KR","Malgun Gothic",sans-serif', fontSize: '14px', lineHeight: '1.6'}});
      host.append(...sanitizeDoc(res.value).body.childNodes);
      host.querySelectorAll('table').forEach(t => { t.style.borderCollapse = 'collapse'; t.querySelectorAll('td,th').forEach(c => { c.style.border = '1px solid #999'; c.style.padding = '4px 6px'; }); });
      host.querySelectorAll('img').forEach(i => { i.style.maxWidth = '100%'; });
      document.body.append(host);
      try {
        let doc;
        if (ctx.o.mode === 'look') {
          await ctx.progress(0.3, '페이지를 그리는 중');
          const pages = await htmlToCanvasPages(host, 794, 1123, 2);
          doc = await PDFDocument.create();
          for (const c of pages) { const img = await embedCanvas(doc, c, 0.9); const pg = doc.addPage(PAGE_SIZES.a4); pg.drawImage(img, {x: 0, y: 0, width: pg.getWidth(), height: pg.getHeight()}); }
        } else doc = await flowPdf(collectBlocks(host), ctx);
        outs.push({name: baseName(f.name) + '.pdf', blob: await saveDoc(doc)});
      } finally { host.remove(); }
    }
    return {outputs: outs, zipName: 'Word_PDF.zip'};
  }});

/* ---- PPTX renderer ---- */
function xdoc(s){ return new DOMParser().parseFromString(s, 'application/xml'); }
function kid(el, name){ if (!el) return null; for (const c of el.children) if (c.localName === name) return c; return null; }
function kidsN(el, name){ return el ? [...el.children].filter(c => c.localName === name) : []; }
function path(el, ...names){ let e = el; for (const n of names) { e = kid(e, n); if (!e) return null; } return e; }
function resolveP(dir, t){ if (t.startsWith('/')) return t.slice(1); const out = []; for (const p of (dir + t).split('/')) { if (p === '..') out.pop(); else if (p !== '.' && p !== '') out.push(p); } return out.join('/'); }
async function relsOf(zip, p){
  const dir = p.replace(/[^/]+$/, ''); const f = zip.file(dir + '_rels/' + p.split('/').pop() + '.rels'); const m = {};
  if (!f) return m; const d = xdoc(await f.async('string'));
  for (const r of d.getElementsByTagName('Relationship')) m[r.getAttribute('Id')] = {target: resolveP(dir, r.getAttribute('Target')), type: r.getAttribute('Type') || '', ext: r.getAttribute('TargetMode') === 'External'};
  return m;
}
function relByType(rels, t){ return Object.values(rels).find(r => r.type.endsWith('/' + t)); }
function clrOf(el, theme){
  if (!el) return null;
  const c = kid(el, 'srgbClr') || kid(el, 'schemeClr') || kid(el, 'sysClr') || kid(el, 'prstClr');
  if (!c) return null;
  let hex;
  if (c.localName === 'srgbClr') hex = c.getAttribute('val');
  else if (c.localName === 'sysClr') hex = c.getAttribute('lastClr') || '000000';
  else if (c.localName === 'prstClr') hex = {black: '000000', white: 'FFFFFF', red: 'FF0000', blue: '0000FF', green: '008000'}[c.getAttribute('val')] || '000000';
  else { const v = c.getAttribute('val'); const map = {tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2'}; hex = theme[map[v] || v] || '000000'; }
  let r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16), a = 1;
  for (const m of c.children) {
    const v = +m.getAttribute('val') / 100000;
    if (m.localName === 'lumMod') { r *= v; g *= v; b *= v; }
    if (m.localName === 'lumOff') { r += 255 * v; g += 255 * v; b += 255 * v; }
    if (m.localName === 'tint') { r = 255 - (255 - r) * v; g = 255 - (255 - g) * v; b = 255 - (255 - b) * v; }
    if (m.localName === 'shade') { r *= v; g *= v; b *= v; }
    if (m.localName === 'alpha') a = v;
  }
  const cl = x => Math.max(0, Math.min(255, Math.round(x)));
  return `rgba(${cl(r)},${cl(g)},${cl(b)},${a})`;
}
async function renderPptx(bytes, ctx){
  const zip = await JSZip.loadAsync(bytes);
  const presP = 'ppt/presentation.xml'; const pres = xdoc(await zip.file(presP).async('string')); const presRels = await relsOf(zip, presP);
  const sz = pres.getElementsByTagNameNS('*', 'sldSz')[0]; const CX = +sz.getAttribute('cx'), CY = +sz.getAttribute('cy');
  const W = 1600, sc = W / CX, H = Math.round(CY * sc);
  const ids = [...pres.getElementsByTagNameNS('*', 'sldId')].map(e => e.getAttribute('r:id') || e.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
  const slides = ids.map(id => presRels[id] && presRels[id].target).filter(Boolean);
  const imgCache = {};
  const getImg = async p => {
    if (p in imgCache) return imgCache[p]; const f = zip.file(p); if (!f || /\.(emf|wmf|tiff?)$/i.test(p)) return imgCache[p] = null;
    try { const b = await f.async('blob'); return imgCache[p] = await createImageBitmap(b); } catch (e) { return imgCache[p] = null; }
  };
  const out = [];
  for (let si = 0; si < slides.length; si++) {
    await ctx.progress(si / slides.length, `슬라이드 ${si + 1}/${slides.length} 그리는 중`);
    const sp = slides[si]; const sx = xdoc(await zip.file(sp).async('string')); const sRels = await relsOf(zip, sp);
    const lp = relByType(sRels, 'slideLayout'); const lx = lp ? xdoc(await zip.file(lp.target).async('string')) : null; const lRels = lp ? await relsOf(zip, lp.target) : {};
    const mp = relByType(lRels, 'slideMaster'); const mx = mp ? xdoc(await zip.file(mp.target).async('string')) : null; const mRels = mp ? await relsOf(zip, mp.target) : {};
    const tp = relByType(mRels, 'theme'); const theme = {};
    if (tp && zip.file(tp.target)) { const tx = xdoc(await zip.file(tp.target).async('string')); const cs = tx.getElementsByTagNameNS('*', 'clrScheme')[0]; if (cs) for (const c of cs.children) { const v = c.firstElementChild; theme[c.localName] = v ? (v.getAttribute('val') && v.localName === 'srgbClr' ? v.getAttribute('val') : v.getAttribute('lastClr') || v.getAttribute('val')) : '000000'; } }
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    // background
    for (const [x, rels] of [[mx, mRels], [lx, lRels], [sx, sRels]]) {
      const bg = x && x.getElementsByTagNameNS('*', 'bgPr')[0];
      if (!bg) continue;
      const fill = clrOf(kid(bg, 'solidFill'), theme); if (fill) { g.fillStyle = fill; g.fillRect(0, 0, W, H); }
      const blip = kid(bg, 'blipFill') && kid(kid(bg, 'blipFill'), 'blip');
      if (blip) { const r = rels[blip.getAttribute('r:embed')]; const im = r && await getImg(r.target); if (im) g.drawImage(im, 0, 0, W, H); }
    }
    const phMap = {};
    const collectPh = x => { if (!x) return; for (const s of x.getElementsByTagNameNS('*', 'sp')) { const ph = s.getElementsByTagNameNS('*', 'ph')[0]; const xf = s.getElementsByTagNameNS('*', 'xfrm')[0]; if (ph && xf) { const k1 = 'i' + (ph.getAttribute('idx') || ''), k2 = 't' + (ph.getAttribute('type') || 'body'); phMap[k1] ||= xf; phMap[k2] ||= xf; } } };
    collectPh(lx); collectPh(mx);
    const draw = async (tree, rels, T, skipPh) => {
      if (!tree) return;
      for (const n of tree.children) {
        const ln = n.localName;
        if (ln === 'grpSp') {
          const xf = path(n, 'grpSpPr', 'xfrm'); if (!xf) { await draw(n, rels, T, skipPh); continue; }
          const off = kid(xf, 'off'), ext = kid(xf, 'ext'), co = kid(xf, 'chOff'), ce = kid(xf, 'chExt');
          const ox = +off.getAttribute('x'), oy = +off.getAttribute('y'), ex = +ext.getAttribute('cx'), ey = +ext.getAttribute('cy');
          const cx0 = co ? +co.getAttribute('x') : ox, cy0 = co ? +co.getAttribute('y') : oy, cex = ce ? +ce.getAttribute('cx') || ex : ex, cey = ce ? +ce.getAttribute('cy') || ey : ey;
          const sxx = ex / cex, syy = ey / cey;
          await draw(n, rels, {ox: T.ox + (ox - cx0 * sxx) * T.sx, oy: T.oy + (oy - cy0 * syy) * T.sy, sx: T.sx * sxx, sy: T.sy * syy}, skipPh);
          continue;
        }
        if (ln !== 'sp' && ln !== 'pic' && ln !== 'graphicFrame' && ln !== 'cxnSp') continue;
        const ph = n.getElementsByTagNameNS('*', 'ph')[0];
        if (ph && skipPh) continue;
        let xf = ln === 'graphicFrame' ? kid(n, 'xfrm') : n.getElementsByTagNameNS('*', 'xfrm')[0];
        if (!xf && ph) xf = phMap['i' + (ph.getAttribute('idx') || '')] || phMap['t' + (ph.getAttribute('type') || 'body')];
        if (!xf) continue;
        const off = kid(xf, 'off'), ext = kid(xf, 'ext'); if (!off || !ext) continue;
        const X = (T.ox + +off.getAttribute('x') * T.sx) * sc, Y = (T.oy + +off.getAttribute('y') * T.sy) * sc;
        const Wd = +ext.getAttribute('cx') * T.sx * sc, Ht = +ext.getAttribute('cy') * T.sy * sc;
        const rot = +(xf.getAttribute('rot') || 0) / 60000;
        g.save(); if (rot) { g.translate(X + Wd / 2, Y + Ht / 2); g.rotate(rot * Math.PI / 180); g.translate(-(X + Wd / 2), -(Y + Ht / 2)); }
        if (ln === 'pic') {
          const blip = n.getElementsByTagNameNS('*', 'blip')[0]; const r = blip && rels[blip.getAttribute('r:embed')];
          const im = r && await getImg(r.target); if (im) g.drawImage(im, X, Y, Wd, Ht);
        } else if (ln === 'graphicFrame') {
          const tbl = n.getElementsByTagNameNS('*', 'tbl')[0];
          if (tbl) {
            const cols = [...tbl.getElementsByTagNameNS('*', 'gridCol')].map(e => +e.getAttribute('w') * T.sx * sc);
            let yy = Y;
            for (const tr of kidsN(tbl, 'tr')) {
              const rh = Math.max(+tr.getAttribute('h') * T.sy * sc, 24); let xx = X;
              kidsN(tr, 'tc').forEach((tc, ci) => {
                const w = cols[ci] || 80; const tcPr = kid(tc, 'tcPr'); const fill = tcPr && clrOf(kid(tcPr, 'solidFill'), theme);
                if (fill) { g.fillStyle = fill; g.fillRect(xx, yy, w, rh); }
                g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1; g.strokeRect(xx, yy, w, rh);
                drawTxBody(g, kid(tc, 'txBody'), xx, yy, w, rh, theme, sc, 14); xx += w;
              });
              yy += rh;
            }
          }
        } else {
          const spPr = kid(n, 'spPr'); const geo = spPr && kid(spPr, 'prstGeom'); const prst = geo ? geo.getAttribute('prst') : 'rect';
          let fill = spPr && clrOf(kid(spPr, 'solidFill'), theme);
          if (!fill && !(spPr && kid(spPr, 'noFill'))) { const st = kid(n, 'style'); const fr = st && kid(st, 'fillRef'); if (fr && fr.getAttribute('idx') !== '0' && ln !== 'cxnSp') fill = clrOf(fr, theme); }
          const lnEl = spPr && kid(spPr, 'ln'); let stroke = lnEl && !kid(lnEl, 'noFill') ? clrOf(kid(lnEl, 'solidFill'), theme) : null;
          if (!stroke && ln === 'cxnSp') { const st = kid(n, 'style'); const lr = st && kid(st, 'lnRef'); stroke = lr ? clrOf(lr, theme) : '#444'; }
          const lw = lnEl && lnEl.getAttribute('w') ? Math.max(1, +lnEl.getAttribute('w') * sc) : 2;
          g.beginPath();
          if (ln === 'cxnSp' || prst === 'line' || prst.startsWith('straightConnector')) {
            const fh = xf.getAttribute('flipH') === '1', fv = xf.getAttribute('flipV') === '1';
            g.moveTo(fh ? X + Wd : X, fv ? Y + Ht : Y); g.lineTo(fh ? X : X + Wd, fv ? Y : Y + Ht);
          } else if (prst === 'ellipse') g.ellipse(X + Wd / 2, Y + Ht / 2, Math.abs(Wd / 2), Math.abs(Ht / 2), 0, 0, Math.PI * 2);
          else if (prst === 'roundRect' && g.roundRect) g.roundRect(X, Y, Wd, Ht, Math.min(Wd, Ht) * 0.16);
          else if (prst === 'triangle') { g.moveTo(X + Wd / 2, Y); g.lineTo(X + Wd, Y + Ht); g.lineTo(X, Y + Ht); g.closePath(); }
          else g.rect(X, Y, Wd, Ht);
          if (fill && ln !== 'cxnSp') { g.fillStyle = fill; g.fill(); }
          if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
          const phType = ph ? (ph.getAttribute('type') || 'body') : null;
          drawTxBody(g, kid(n, 'txBody'), X, Y, Wd, Ht, theme, sc, phType === 'title' || phType === 'ctrTitle' ? 40 : phType === 'subTitle' ? 22 : phType === 'body' || (ph && !ph.getAttribute('type')) ? 20 : 18, phType === 'body' || (ph && !ph.getAttribute('type')));
        }
        g.restore();
      }
    };
    const T0 = {ox: 0, oy: 0, sx: 1, sy: 1};
    if (mx) await draw(mx.getElementsByTagNameNS('*', 'spTree')[0], mRels, T0, true);
    if (lx) await draw(lx.getElementsByTagNameNS('*', 'spTree')[0], lRels, T0, true);
    await draw(sx.getElementsByTagNameNS('*', 'spTree')[0], sRels, T0, false);
    out.push({canvas: c, w: CX / 12700, h: CY / 12700});
  }
  return out;
}
function drawTxBody(g, tb, X, Y, W, H, theme, sc, defPt, bullets){
  if (!tb) return;
  const bp = kid(tb, 'bodyPr'); const ins = k => bp && bp.getAttribute(k) != null ? +bp.getAttribute(k) * sc : (k[0] === 'l' || k[0] === 'r' ? 91440 : 45720) * sc;
  const fit = bp && kid(bp, 'normAutofit'); const fscale = fit && fit.getAttribute('fontScale') ? +fit.getAttribute('fontScale') / 100000 : 1;
  const x0 = X + ins('lIns'), maxW = Math.max(10, W - ins('lIns') - ins('rIns'));
  const lines = [];
  for (const p of kidsN(tb, 'p')) {
    const pPr = kid(p, 'pPr'); const algn = pPr && pPr.getAttribute('algn') || 'l'; const lvl = pPr ? +(pPr.getAttribute('lvl') || 0) : 0;
    const runs = [];
    for (const r of p.children) {
      if (r.localName === 'r' || r.localName === 'fld') { const rp = kid(r, 'rPr'); const t = kid(r, 't'); runs.push({t: t ? t.textContent : '', sz: rp && rp.getAttribute('sz') ? +rp.getAttribute('sz') / 100 : null, b: rp && rp.getAttribute('b') === '1', i: rp && rp.getAttribute('i') === '1', col: rp && clrOf(kid(rp, 'solidFill'), theme)}); }
      if (r.localName === 'br') runs.push({br: true});
    }
    const endSz = kid(p, 'endParaRPr') && kid(p, 'endParaRPr').getAttribute('sz');
    const pt = ((runs.find(r => r.sz) || {}).sz || (endSz ? +endSz / 100 : defPt)) * fscale;
    const px = pt * 12700 * sc;
    const noBu = pPr && kid(pPr, 'buNone'); const buChar = pPr && kid(pPr, 'buChar');
    const prefix = (bullets && !noBu && runs.some(r => r.t && r.t.trim())) || buChar ? (buChar ? buChar.getAttribute('char') : '•') + ' ' : '';
    const indent = lvl * px * 1.2;
    // greedy wrap of runs into lines
    let cur = {segs: [], w: 0, h: px, algn, indent}; const pushLine = () => { lines.push(cur); cur = {segs: [], w: 0, h: px, algn, indent}; };
    const all = prefix ? [{t: prefix, sz: null, b: false, col: null}, ...runs] : runs;
    if (!all.length) { lines.push({...cur, empty: true}); continue; }
    for (const r of all) {
      if (r.br) { pushLine(); continue; }
      const rpx = (r.sz ? r.sz * fscale * 12700 * sc : px);
      g.font = `${r.i ? 'italic ' : ''}${r.b ? '700' : '400'} ${rpx}px "IBM Plex Sans KR","Malgun Gothic",sans-serif`;
      for (const tok of r.t.split(/(\s+)/)) {
        if (!tok) continue; const w = g.measureText(tok).width;
        if (cur.w + w > maxW - indent && cur.segs.length && !/^\s+$/.test(tok)) pushLine();
        if (/^\s+$/.test(tok) && !cur.segs.length) continue;
        cur.segs.push({t: tok, font: g.font, col: r.col, w}); cur.w += w; cur.h = Math.max(cur.h, rpx);
      }
    }
    pushLine();
  }
  const total = lines.reduce((s, l) => s + l.h * 1.2, 0);
  const anchor = bp && bp.getAttribute('anchor') || 't';
  let y = anchor === 'ctr' ? Y + (H - total) / 2 : anchor === 'b' ? Y + H - ins('bIns') - total : Y + ins('tIns');
  g.textBaseline = 'alphabetic';
  const dflt = clrOf({children: [{localName: 'schemeClr', getAttribute: () => 'tx1', children: []}]}, theme) || '#111';
  for (const l of lines) {
    y += l.h * 1.2;
    let x = x0 + l.indent; if (l.algn === 'ctr') x = x0 + (maxW - l.w) / 2; else if (l.algn === 'r') x = x0 + maxW - l.w;
    for (const s of l.segs) { g.font = s.font; g.fillStyle = s.col || dflt; g.fillText(s.t, x, y - l.h * 0.25); x += s.w; }
  }
}
tool({id: 'ppt2pdf', cat: 'to', code: 'PPTX', title: 'PowerPoint → PDF', desc: 'PowerPoint 슬라이드(PPTX)를 PDF로 바꿉니다.', accept: 'pptx', multi: true, kw: '파워포인트 ppt 슬라이드',
  opts: [{id: 'n', type: 'note', text: '도형, 글상자, 사진, 표, 배경을 옮겨 그립니다. 애니메이션·차트·특수 효과는 단순하게 표현되거나 빠질 수 있습니다. 예전 .ppt 파일은 .pptx로 저장해서 넣어 주세요.'}],
  action: 'PDF로 변환',
  async run(ctx){
    const outs = [];
    for (const f of ctx.files) {
      let slides;
      try { slides = await renderPptx(await fileBytes(f), ctx); } catch (e) { console.error(e); throw userErr(`"${f.name}"을(를) 읽지 못했습니다. PowerPoint에서 .pptx로 다시 저장해 보세요.`); }
      const doc = await PDFDocument.create();
      for (const s of slides) { const img = await embedCanvas(doc, s.canvas, 0.9); const pg = doc.addPage([s.w, s.h]); pg.drawImage(img, {x: 0, y: 0, width: s.w, height: s.h}); }
      outs.push({name: baseName(f.name) + '.pdf', blob: await saveDoc(doc)});
    }
    return {outputs: outs, zipName: 'PPT_PDF.zip'};
  }});

tool({id: 'excel2pdf', cat: 'to', code: 'XLSX', title: 'Excel → PDF', desc: 'Excel 스프레드시트를 표 모양 그대로 PDF로 바꿉니다.', accept: 'xlsx', multi: true, kw: '엑셀 스프레드시트 csv',
  opts: [{id: 'orient', type: 'seg', def: 'land', label: '용지 방향', choices: [['land', '가로'], ['port', '세로']]},
    {id: 'sheets', type: 'seg', def: 'all', label: '시트', choices: [['all', '모든 시트'], ['first', '첫 시트만']]},
    {id: 'grid', type: 'check', def: true, label: '셀 테두리 그리기'}],
  action: 'PDF로 변환',
  async run(ctx){
    const outs = [];
    for (const f of ctx.files) {
      await ctx.progress(0.05, `${f.name} 읽는 중`);
      const sheets = await readSheetsIsolated(await fileBytes(f), ctx.o.sheets === 'first');
      const names = sheets.map(s => s.name);
      const doc = await PDFDocument.create(); let [PW, PH] = PAGE_SIZES.a4; if (ctx.o.orient !== 'port') [PW, PH] = [PH, PW];
      for (let si = 0; si < names.length; si++) {
        await ctx.progress(si / names.length, `${names[si]} 시트 그리는 중`);
        const html = sheets[si].html; if (!html) continue;
        const host = h('div', {style: {position: 'fixed', left: '-30000px', top: '0', background: '#fff', color: '#111', padding: '24px', fontFamily: '"IBM Plex Sans KR","Malgun Gothic",sans-serif', fontSize: '12px', width: 'max-content', minWidth: '600px'}});
        host.append(...sanitizeDoc(html).body.childNodes);
        host.prepend(h('div', {style: {fontWeight: '700', fontSize: '14px', marginBottom: '8px'}}, names[si]));
        host.querySelectorAll('table').forEach(t => { t.style.borderCollapse = 'collapse'; });
        host.querySelectorAll('td,th').forEach(c => { c.style.padding = '3px 6px'; c.style.whiteSpace = 'nowrap'; if (ctx.o.grid) c.style.border = '1px solid #b8bcc4'; if (/^-?[\d,.]+%?$/.test(c.textContent.trim())) c.style.textAlign = 'right'; });
        document.body.append(host);
        try {
          const wpx = host.scrollWidth; const hpx = Math.round(wpx * PH / PW);
          const pages = await htmlToCanvasPages(host, wpx, hpx, Math.min(2, 3000 / wpx));
          for (const c of pages) { const img = await embedCanvas(doc, c, 0.9); const pg = doc.addPage([PW, PH]); const s = Math.min(PW / c.width, PH / c.height); pg.drawImage(img, {x: 0, y: PH - c.height * s, width: c.width * s, height: c.height * s}); }
        } finally { host.remove(); }
      }
      if (!doc.getPageCount()) throw userErr(`"${f.name}"에 내용이 있는 시트가 없습니다.`);
      outs.push({name: baseName(f.name) + '.pdf', blob: await saveDoc(doc)});
    }
    return {outputs: outs, zipName: 'Excel_PDF.zip'};
  }});

tool({id: 'html2pdf', cat: 'to', code: 'HTML', title: 'HTML → PDF', desc: '웹 페이지(HTML 파일이나 코드)를 PDF로 바꿉니다.', accept: 'html', kw: '웹페이지 url',
  noFileStage: true,
  stage(st){
    if (!S.files.length) { st.append(dropzone()); return; }
    fileList(st);
  },
  opts: [{id: 'code', type: 'textarea', def: '', label: '또는 HTML 코드 붙여 넣기', placeholder: '<h1>제목</h1><p>내용…</p>', rows: 6, live: true},
    {id: 'vw', type: 'seg', def: '1280', label: '화면 너비', choices: [['1280', '데스크톱'], ['820', '태블릿'], ['390', '휴대폰']]},
    {id: 'paged', type: 'seg', def: 'a4', label: '페이지', choices: [['a4', 'A4로 나누기'], ['one', '한 장으로 길게']]},
    {id: 'n', type: 'note', text: '웹 주소(URL)에서 바로 가져오는 기능은 보안상 막혀 있습니다. 브라우저에서 페이지를 "다른 이름으로 저장(.html)"한 파일을 넣거나 코드를 붙여 넣으세요. 외부 이미지와 스크립트는 불러오지 않습니다.'}],
  ready: () => S.files.length > 0 || !!(S.opts.code || '').trim(),
  action: 'PDF로 변환',
  async run(ctx){
    const src = S.files.length ? await S.files[0].file.text() : ctx.o.code;
    const name = S.files.length ? baseName(S.files[0].name) : '웹페이지';
    const vw = +ctx.o.vw || 1280;
    const fr = h('iframe', {sandbox: 'allow-same-origin', style: {position: 'fixed', left: '-30000px', top: '0', width: vw + 'px', height: '1200px', border: '0', background: '#fff'}});
    document.body.append(fr);
    try {
      const clean = sanitizeDoc(/<html[\s>]/i.test(src) ? src : `<!doctype html><body style="font-family:'Malgun Gothic',sans-serif;margin:24px">${src}</body>`);
      await new Promise(res => { fr.onload = res; fr.srcdoc = '<!doctype html><meta charset="utf-8">' + clean.documentElement.outerHTML; setTimeout(res, 4000); });
      await sleep(300); await ctx.progress(0.3, '페이지를 그리는 중');
      const d = fr.contentDocument; const body = d.body; d.documentElement.style.background ||= '#fff';
      fr.style.height = Math.min(30000, d.documentElement.scrollHeight) + 'px';
      await need('h2c');
      const full = await html2canvas(d.documentElement, {scale: vw < 600 ? 2 : 1.5, backgroundColor: '#ffffff', logging: false, windowWidth: vw, windowHeight: d.documentElement.scrollHeight});
      const doc = await PDFDocument.create();
      if (ctx.o.paged === 'one') { const img = await embedCanvas(doc, full, 0.9); const w = 595.28, hh = full.height * w / full.width; doc.addPage([w, hh]).drawImage(img, {x: 0, y: 0, width: w, height: hh}); }
      else {
        const ph = Math.round(full.width * 1.4142);
        for (let y = 0; y < full.height; y += ph) {
          const c = document.createElement('canvas'); c.width = full.width; c.height = ph; const cx = c.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, ph); cx.drawImage(full, 0, -y);
          const img = await embedCanvas(doc, c, 0.9); doc.addPage(PAGE_SIZES.a4).drawImage(img, {x: 0, y: 0, width: 595.28, height: 841.89});
        }
      }
      return {outputs: [{name: name + '.pdf', blob: await saveDoc(doc)}]};
    } finally { fr.remove(); }
  }});

/* ============ PDF에서 변환 ============ */
async function extractImages(f, ctx){
  const d = await pjs(f); const out = []; const seen = new Set();
  for (let i = 1; i <= d.numPages; i++) {
    await ctx.progress(i / d.numPages, `${i}/${d.numPages}쪽에서 이미지 찾는 중`);
    const p = await d.getPage(i); const ops = await p.getOperatorList();
    for (let k = 0; k < ops.fnArray.length; k++) {
      const fn = ops.fnArray[k];
      if (fn !== pdfjsLib.OPS.paintImageXObject && fn !== pdfjsLib.OPS.paintJpegXObject && fn !== pdfjsLib.OPS.paintImageXObjectRepeat) continue;
      const id = ops.argsArray[k][0]; if (seen.has(id)) continue; seen.add(id);
      const store = id.startsWith('g_') ? p.commonObjs : p.objs;
      const img = await new Promise(res => { try { store.get(id, res); } catch (e) { res(null); } setTimeout(() => res(null), 3000); });
      if (!img || img.width < 32 || img.height < 32) continue;
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d');
      if (img.bitmap) g.drawImage(img.bitmap, 0, 0);
      else if (img.data) {
        const im = g.createImageData(img.width, img.height); const src = img.data; const dst = im.data; const n = img.width * img.height;
        if (img.kind === 3) dst.set(src.subarray(0, n * 4));
        else if (img.kind === 2) for (let q = 0, s = 0; q < n; q++) { dst[q * 4] = src[s++]; dst[q * 4 + 1] = src[s++]; dst[q * 4 + 2] = src[s++]; dst[q * 4 + 3] = 255; }
        else if (img.kind === 1) { const rowB = (img.width + 7) >> 3; for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) { const v = (src[y * rowB + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0; const q = (y * img.width + x) * 4; dst[q] = dst[q + 1] = dst[q + 2] = v; dst[q + 3] = 255; } }
        else continue;
        g.putImageData(im, 0, 0);
      } else continue;
      out.push({name: `${baseName(f.name)}_p${i}_이미지${out.length + 1}.jpg`, blob: await canvasBlob(toCanvas(c), 'image/jpeg', 0.92)});
    }
  }
  return out;
}
tool({id: 'pdf2jpg', cat: 'from', code: '→JPG', title: 'PDF → JPG', desc: '각 페이지를 JPG 이미지로 바꾸거나, PDF 안의 사진만 뽑아냅니다.', kw: '이미지 png 사진 추출',
  opts: [{id: 'mode', type: 'seg', def: 'pages', label: '방식', choices: [['pages', '페이지를 이미지로'], ['extract', '들어있는 이미지 추출']]},
    {id: 'q', type: 'seg', def: '150', label: '화질', choices: [['96', '보통'], ['150', '높음'], ['300', '인쇄용']], show: o => o.mode === 'pages'},
    {id: 'fmt', type: 'seg', def: 'jpg', label: '형식', choices: [['jpg', 'JPG'], ['png', 'PNG']], show: o => o.mode === 'pages'},
    {id: 'range', type: 'text', def: '', placeholder: '비우면 전체', label: '페이지', show: o => o.mode === 'pages', hint: '예: 1-3, 7'}],
  action: '이미지로 변환',
  async run(ctx){
    const f = ctx.files[0];
    if (ctx.o.mode === 'extract') { const outs = await extractImages(f, ctx); if (!outs.length) throw userErr('이 PDF에서 뽑아낼 이미지를 찾지 못했습니다. "페이지를 이미지로"를 써 보세요.'); return {outputs: outs, zipName: baseName(f.name) + '_이미지.zip', summary: `이미지 ${outs.length}개를 뽑았습니다.`}; }
    const d = await pjs(f); const idx = ctx.o.range ? parseRanges(ctx.o.range, d.numPages) : [...Array(d.numPages).keys()];
    const outs = []; const png = ctx.o.fmt === 'png';
    for (let k = 0; k < idx.length; k++) {
      await ctx.progress(k / idx.length, `${idx[k] + 1}쪽 변환 중`);
      const c = await renderPage(await d.getPage(idx[k] + 1), (+ctx.o.q || 150) / 72);
      outs.push({name: `${baseName(f.name)}_${idx[k] + 1}.${png ? 'png' : 'jpg'}`, blob: await canvasBlob(c, png ? 'image/png' : 'image/jpeg', 0.9)});
    }
    return {outputs: outs, zipName: baseName(f.name) + '_이미지.zip'};
  }});

function medianSize(pages){ const s = []; pages.forEach(p => p.lines.forEach(l => { for (let i = 0; i < Math.min(40, l.text.length); i++) s.push(l.h); })); s.sort((a, b) => a - b); return s[s.length >> 1] || 11; }
tool({id: 'pdf2word', cat: 'from', code: '→DOCX', title: 'PDF → Word', desc: 'PDF를 편집할 수 있는 Word 문서(DOCX)로 바꿉니다.', kw: '워드 doc 편집',
  opts: [{id: 'brk', type: 'check', def: true, label: 'PDF 페이지마다 새 페이지로 나누기'},
    {id: 'n', type: 'note', text: '글자가 없는 스캔 페이지는 이미지로 넣습니다. 스캔 문서를 글자로 바꾸려면 먼저 OCR PDF를 실행하세요.'}],
  action: 'Word로 변환',
  async run(ctx){
    const f = ctx.files[0]; const pages = await docText(f, p => ctx.progress(p * 0.6, '글자를 읽는 중'), ctx.signal);
    const body = medianSize(pages); const paras = []; const d = await pjs(f);
    for (const pg of pages) {
      if (pg.n > 1 && ctx.o.brk) paras.push({pageBreak: true});
      if (!pg.lines.length) {
        const c = await renderPage(await d.getPage(pg.n), 1.6); const s = Math.min(1, 480 / (c.width / 1.6));
        paras.push({image: {bytes: await blobBytes(await canvasBlob(c, 'image/jpeg', 0.85)), w: c.width / 1.6 * s, h: c.height / 1.6 * s}}); continue;
      }
      for (const b of pg.blocks) {
        const sz = b.h; const r = sz / body;
        const heading = r > 1.6 ? 1 : r > 1.3 ? 2 : r > 1.12 && b.lines.length <= 2 ? 3 : 0;
        const cx = (b.x + b.x2) / 2; const center = Math.abs(cx - pg.width / 2) < pg.width * 0.06 && b.x > pg.width * 0.18;
        paras.push({text: b.text, size: Math.max(7, Math.min(36, Math.round(sz * 2) / 2)), heading, bold: heading > 0, align: center ? 'center' : null, indent: b.x > 90 && !center ? Math.min(120, b.x - 72) : 0});
      }
      await ctx.progress(0.6 + 0.4 * pg.n / pages.length, '문서를 만드는 중');
    }
    const blob = await makeDocx(paras, {pageSize: [pages[0].width, pages[0].height]});
    return {outputs: [{name: baseName(f.name) + '.docx', blob}]};
  }});

async function renderNoText(page, scale){
  const vp = page.getViewport({scale}); const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillText = () => {}; g.strokeText = () => {};
  await page.render({canvasContext: g, viewport: vp}).promise; return c;
}
tool({id: 'pdf2ppt', cat: 'from', code: '→PPTX', title: 'PDF → PowerPoint', desc: 'PDF를 편집할 수 있는 PowerPoint 슬라이드(PPTX)로 바꿉니다.', kw: '파워포인트 ppt 슬라이드',
  opts: [{id: 'mode', type: 'seg', def: 'edit', label: '방식', choices: [['edit', '글자 편집 가능'], ['image', '모양 그대로']],
    hint: o => o.mode === 'edit' ? '배경과 그림은 이미지로, 글자는 글상자로 만들어 고칠 수 있습니다.' : '페이지 전체를 슬라이드 이미지로 넣습니다.'}],
  action: 'PowerPoint로 변환',
  async run(ctx){
    await need('pptx'); const f = ctx.files[0]; const d = await pjs(f);
    const p1 = (await d.getPage(1)).getViewport({scale: 1});
    const pptx = new PptxGenJS(); pptx.defineLayout({name: 'PDF', width: p1.width / 72, height: p1.height / 72}); pptx.layout = 'PDF';
    for (let i = 1; i <= d.numPages; i++) {
      await ctx.progress(i / d.numPages, `${i}/${d.numPages}쪽 변환 중`);
      const p = await d.getPage(i); const vp = p.getViewport({scale: 1}); const sx = p1.width / vp.width, sy = p1.height / vp.height;
      const slide = pptx.addSlide();
      const edit = ctx.o.mode !== 'image';
      const t = edit ? await pageTextItems(p) : null;
      const c = edit && t.items.length ? await renderNoText(p, 2) : await renderPage(p, 2);
      slide.addImage({data: c.toDataURL('image/jpeg', 0.86), x: 0, y: 0, w: p1.width / 72, h: p1.height / 72});
      if (edit && t.items.length) {
        for (const b of groupBlocks(groupLines(t.items))) {
          slide.addText(b.text, {x: b.x * sx / 72, y: (b.y - b.h * 0.15) * sy / 72, w: Math.max(0.3, (b.x2 - b.x) * sx / 72 + b.h / 72), h: Math.max(0.2, (b.y2 - b.y + b.h * 0.3) * sy / 72),
            fontSize: Math.max(6, Math.round(b.h * 0.92 * sy * 2) / 2), fontFace: 'Malgun Gothic', color: '222222', margin: 0, valign: 'top', paraSpaceAfter: 0, lineSpacingMultiple: 0.95});
        }
      }
    }
    const blob = await pptx.write({outputType: 'blob'});
    return {outputs: [{name: baseName(f.name) + '.pptx', blob: new Blob([blob], {type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'})}]};
  }});

function pageTable(items){
  const lines = groupLines(items); if (!lines.length) return [];
  const xs = lines.flatMap(l => { const segs = []; let cur = null; for (const it of l.items) { if (cur && it.x - (cur.x + cur.w) < it.h * 1.2) { cur.w = it.x + it.w - cur.x; cur.str += (it.x - (cur.x + cur.w) > it.h * 0.2 ? ' ' : '') + it.str; } else { cur = {x: it.x, w: it.w, str: it.str, h: it.h}; segs.push(cur); } } l.segs = segs; return segs.map(s => s.x); }).sort((a, b) => a - b);
  const anchors = []; for (const x of xs) { if (!anchors.length || x - anchors[anchors.length - 1].x > 12) anchors.push({x, n: 1}); else anchors[anchors.length - 1].n++; }
  const cols = anchors.filter(a => a.n >= 2).map(a => a.x); if (!cols.length) cols.push(anchors[0].x);
  return lines.map(l => {
    const row = new Array(cols.length).fill('');
    for (const s of l.segs) { let ci = 0; for (let k = 0; k < cols.length; k++) if (cols[k] <= s.x + 6) ci = k; row[ci] = row[ci] ? row[ci] + ' ' + s.str : s.str; }
    return row.map(v => { const t = v.trim(); const num = t.replace(/,/g, ''); return /^-?\d+(\.\d+)?$/.test(num) && t.length < 16 ? +num : t; });
  });
}
tool({id: 'pdf2excel', cat: 'from', code: '→XLSX', title: 'PDF → Excel', desc: 'PDF 속 표와 데이터를 Excel 스프레드시트로 옮깁니다.', kw: '엑셀 표 스프레드시트 csv',
  opts: [{id: 'sheet', type: 'seg', def: 'page', label: '시트 구성', choices: [['page', '페이지마다 시트'], ['one', '한 시트에 모두']]},
    {id: 'n', type: 'note', text: '글자 위치로 열을 나눕니다. 스캔 PDF는 OCR을 먼저 실행하세요.'}],
  action: 'Excel로 변환',
  async run(ctx){
    await need('xlsx'); const f = ctx.files[0]; const d = await pjs(f); const wb = XLSX.utils.book_new(); const all = [];
    for (let i = 1; i <= d.numPages; i++) {
      await ctx.progress(i / d.numPages, `${i}/${d.numPages}쪽 표 분석 중`);
      const t = await pageTextItems(await d.getPage(i)); const rows = pageTable(t.items);
      if (ctx.o.sheet === 'one') { if (all.length && rows.length) all.push([]); all.push(...rows); }
      else { const ws = XLSX.utils.aoa_to_sheet(rows.length ? rows : [['(이 페이지에는 글자가 없습니다)']]); ws['!cols'] = colWidths(rows); XLSX.utils.book_append_sheet(wb, ws, `${i}쪽`); }
    }
    if (ctx.o.sheet === 'one') { const ws = XLSX.utils.aoa_to_sheet(all.length ? all : [['(글자를 찾지 못했습니다)']]); ws['!cols'] = colWidths(all); XLSX.utils.book_append_sheet(wb, ws, '전체'); }
    const buf = XLSX.write(wb, {bookType: 'xlsx', type: 'array'});
    return {outputs: [{name: baseName(f.name) + '.xlsx', blob: new Blob([buf], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})}]};
  }});
function colWidths(rows){ const w = []; rows.forEach(r => r.forEach((v, i) => { const l = [...String(v)].reduce((s, ch) => s + (ch.charCodeAt(0) > 255 ? 2 : 1), 0); w[i] = Math.min(60, Math.max(w[i] || 6, l + 2)); })); return w.map(x => ({wch: x})); }

const ICC_SRGB = '%%ICC%%';
function hexId(){ return [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join(''); }
async function makePdfA(doc, title){
  const now = new Date(); now.setMilliseconds(0);
  const iso = now.toISOString().replace('.000Z', 'Z');
  doc.setCreationDate(now); doc.setModificationDate(now); doc.setProducer('PDF 작업대'); doc.setCreator('PDF 작업대'); if (title) doc.setTitle(title);
  const ctxp = doc.context;
  const icc = ctxp.flateStream(b64bytes(ICC_SRGB), {N: 3});
  const oi = ctxp.obj({Type: 'OutputIntent', S: 'GTS_PDFA1', OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'), Info: PDFString.of('sRGB IEC61966-2.1'), RegistryName: PDFString.of('http://www.color.org'), DestOutputProfile: ctxp.register(icc)});
  doc.catalog.set(N('OutputIntents'), ctxp.obj([oi]));
  const esc = s => xmlEsc(s || '');
  const xmp = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/"><pdfaid:part>2</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance>${title ? `<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${esc(title)}</rdf:li></rdf:Alt></dc:title>` : ''}<xmp:CreateDate>${iso}</xmp:CreateDate><xmp:ModifyDate>${iso}</xmp:ModifyDate><xmp:MetadataDate>${iso}</xmp:MetadataDate><xmp:CreatorTool>PDF 작업대</xmp:CreatorTool><pdf:Producer>PDF 작업대</pdf:Producer></rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
  const meta = ctxp.stream(new TextEncoder().encode(xmp), {Type: 'Metadata', Subtype: 'XML'});
  doc.catalog.set(N('Metadata'), ctxp.register(meta));
  const names = doc.catalog.lookup(N('Names')); if (names instanceof PDFDict) names.delete(N('JavaScript'));
  doc.catalog.delete(N('OpenAction')); doc.catalog.delete(N('AA'));
  const id = PDFHexString.of(hexId()); ctxp.trailerInfo.ID = ctxp.obj([id, id]);
  return doc;
}
tool({id: 'pdf2pdfa', cat: 'from', code: 'PDF/A', title: 'PDF → PDF/A', desc: '오래 보관하기 위한 ISO 표준 PDF/A 형식으로 바꿉니다.', kw: '보존 아카이브 표준',
  opts: [{id: 'strict', type: 'check', def: false, label: '엄격 모드: 페이지를 이미지로 바꿔 규격을 확실히 맞추기', hint: '원본 글꼴이 PDF 안에 없는 경우 PDF/A 검증에 실패할 수 있습니다. 이 옵션은 글꼴 문제를 없애는 대신 글자 선택이 안 됩니다.'},
    {id: 'n', type: 'note', text: 'PDF/A-2b 규격에 맞춰 sRGB 색 프로필, XMP 메타데이터, 문서 ID를 넣고 자바스크립트를 제거합니다.'}],
  action: 'PDF/A로 변환',
  async run(ctx){
    const f = ctx.files[0];
    const doc = ctx.o.strict ? await rasterize(f, 200, 0.9, ctx) : await libDoc(f);
    await makePdfA(doc, baseName(f.name));
    return {outputs: [{name: baseName(f.name) + '_PDFA.pdf', blob: pdfBlob(await doc.save({useObjectStreams: false}))}], summary: 'PDF/A-2b 형식으로 저장했습니다.'};
  }});
