'use strict';
/* ============ platform & libraries ============ */
const {PDFDocument, rgb, degrees, StandardFonts, PDFName, PDFRawStream, PDFArray, PDFDict, PDFNumber, PDFString, PDFHexString, PDFRef} = PDFLib;
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.js', location.href).href;
const CDN = {
  xlsx: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
  mammoth: 'https://cdn.jsdelivr.net/npm/mammoth@1.12.3/mammoth.browser.min.js',
  h2c: 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
  pptx: 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js',
  tess: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'
};
const SRI = %%SRI%%;
const _loaded = {};
function need(k){
  return _loaded[k] ||= new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = CDN[k]; s.async = true;
    if (SRI[CDN[k]]) { s.integrity = SRI[CDN[k]]; s.crossOrigin = 'anonymous'; }
    s.onload = res;
    s.onerror = () => { delete _loaded[k]; rej(userErr('변환에 필요한 구성 요소를 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요.')); };
    document.head.appendChild(s);
  });
}
function userErr(msg){ const e = new Error(msg); e.user = true; return e; }
function b64bytes(s){ const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }

let _cmaps;
function cmapBundle(){ return _cmaps ||= fetch('cmaps.json').then(r => { if (!r.ok) throw 0; return r.json(); }).catch(() => ({})); }
class LocalCMapReader {
  constructor(){}
  async fetch({name}){
    const m = await cmapBundle();
    if (!m[name]) throw new Error('CMap not found: ' + name);
    return {cMapData: b64bytes(m[name]), compressionType: 1};
  }
}

let _fontBytes;
function fontBytes(){ return _fontBytes ||= fetch('fonts/NanumGothic.ttf').then(r => { if (!r.ok) throw 0; return r.arrayBuffer(); }).catch(() => null); }
async function korFont(doc){
  if (doc.__kf) return doc.__kf;
  const b = await fontBytes();
  if (b) { doc.registerFontkit(fontkit.default || fontkit); doc.__kf = await doc.embedFont(b, {subset: true}); }
  else { doc.__kf = await doc.embedFont(StandardFonts.Helvetica); doc.__kf.__latin = true; }
  return doc.__kf;
}
function fsafe(font, s){ return font.__latin ? String(s).replace(/[^\x20-\x7e]/g, '?') : String(s); }

/* downloads & AI capabilities */
let _dl, _sample;
function getDownloads(){ return _dl ||= (window.claude ? claude.use('downloads') : Promise.resolve(undefined)); }
function getSample(){ return _sample ||= (window.claude ? claude.use('sample') : Promise.resolve(null)); }

async function saveBlob(name, blob){
  if (window.AndroidBridge) { // installed Android app: hand the bytes to the native side, which writes to Downloads
    const buf = new Uint8Array(await blob.arrayBuffer()); let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    const res = AndroidBridge.saveFile(name, blob.type || 'application/octet-stream', btoa(bin));
    toast(res && res.startsWith('ERR') ? '저장하지 못했습니다: ' + res.slice(4) : '다운로드 폴더에 저장했습니다: ' + (res || name));
    return !(res && res.startsWith('ERR'));
  }
  if (window.__DESKTOP__) { // desktop app: the local launcher writes into Downloads/PDF작업대
    try {
      const r = await fetch('/__save?name=' + encodeURIComponent(name), {method: 'POST', headers: {'X-PDFWB': '1'}, body: blob});
      const j = await r.json(); if (!r.ok || !j.path) throw new Error(j.error || r.status);
      toast('저장했습니다: ' + j.path, ['폴더 열기', () => fetch('/__reveal?path=' + encodeURIComponent(j.path), {method: 'POST', headers: {'X-PDFWB': '1'}})]);
      return true;
    } catch (e) { toast('저장하지 못했습니다: ' + (e.message || e)); return false; }
  }
  const d = await getDownloads();
  if (d === undefined) { // plain browser (no Claude viewer): normal download
    const a = h('a', {href: URL.createObjectURL(blob), download: name}); document.body.append(a); a.click(); a.remove(); return true;
  }
  if (!d) { toast('이 보기에서는 파일을 저장할 수 없습니다. 게시된 페이지를 직접 열어 주세요.'); return false; }
  try { await d.save({filename: name, data: blob}); toast('저장했습니다: ' + name); return true; }
  catch (e) {
    const c = e && e.code;
    if (c === 'declined') return false;
    if (c === 'rate_limited') toast('저장 창이 이미 열려 있습니다. 잠시 후 다시 누르세요.');
    else if (c === 'too_large') toast('파일이 너무 커서 저장할 수 없습니다. 압축하거나 나눠서 저장하세요.');
    else if (c === 'rejected_extension' || c === 'extension_not_enabled') toast('이 형식은 이 화면에서 저장할 수 없습니다.');
    else toast('저장하지 못했습니다. 다시 시도하세요.');
    return false;
  }
}

/* ============ DOM helpers ============ */
function h(tag, props, ...kids){
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (k === 'text') e.textContent = v;
    else if (k in e && typeof v !== 'string' && k !== 'list') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(9)) { if (k == null || k === false) continue; e.append(k.nodeType ? k : String(k)); }
  return e;
}
const $ = (s, r = document) => r.querySelector(s);
function toast(msg, action){
  const host = $('#toast-host'); host.innerHTML = '';
  const t = h('div', {class: 'toast', role: 'status'}, msg, action ? h('button', {type: 'button', class: 'toast-act', onclick: () => { action[1](); t.remove(); }}, action[0]) : null); host.append(t);
  clearTimeout(toast._t); toast._t = setTimeout(() => t.remove(), action ? 7000 : 3600);
}
function fmtSize(n){ if (n < 1024) return n + ' B'; if (n < 1048576) return (n / 1024).toFixed(1) + ' KB'; return (n / 1048576).toFixed(2) + ' MB'; }
function baseName(n){ return n.replace(/\.[^.]+$/, ''); }
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
const ICON = {
  rotL: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
  rotR: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M15 6l-6 6 6 6"/></svg>',
  right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>'
};
function ib(icon, title, onclick){ return h('button', {class: 'ib', type: 'button', title, 'aria-label': title, html: ICON[icon] || icon, onclick: e => { e.stopPropagation(); onclick(e); }}); }

/* ============ PDF helpers ============ */
async function fileBytes(f){ if (!f.bytes) f.bytes = await f.file.arrayBuffer(); return f.bytes; }
async function pjs(f){
  if (f._pjs) return f._pjs;
  await fileBytes(f);
  const task = openPdfjs(new Uint8Array(f.bytes.slice(0)), {password: f.password || undefined});
  f._pjs = task.promise;
  try { return await f._pjs; } catch (e) { f._pjs = null; throw e; }
}
/* every PDF is opened through here: isEvalSupported:false closes the pdf.js font-eval hole (CVE-2024-4367) */
function openPdfjs(data, extra){
  return pdfjsLib.getDocument({data, CMapReaderFactory: LocalCMapReader, isEvalSupported: false, useSystemFonts: true, stopAtErrors: false, enableXfa: false, ...(extra || {})});
}
/* strip anything executable from untrusted HTML (Word/Excel/HTML inputs) before it touches the page */
function sanitizeDoc(html){
  const d = new DOMParser().parseFromString(String(html), 'text/html');
  d.querySelectorAll('script,iframe,frame,frameset,object,embed,applet,link[rel=import],meta,base,form,noscript,template,portal').forEach(n => n.remove());
  d.querySelectorAll('*').forEach(el => {
    for (const a of [...el.attributes]) {
      const n = a.name.toLowerCase(), v = a.value.replace(/[\u0000-\u0020]/g, '').toLowerCase();
      if (n.startsWith('on') || n === 'srcdoc' || n === 'formaction') el.removeAttribute(a.name);
      else if (/^(href|src|xlink:href|action|background|poster|data)$/.test(n) && (v.startsWith('javascript:') || v.startsWith('vbscript:') || (v.startsWith('data:') && !v.startsWith('data:image/')))) el.removeAttribute(a.name);
    }
  });
  return d;
}
/* SheetJS has unfixed parser bugs (prototype pollution, ReDoS): parse spreadsheets in a throwaway worker with a time limit */
function readSheetsIsolated(bytes, firstOnly){
  return new Promise((res, rej) => {
    let w; try { w = new Worker(new URL('xlsx-worker.js', location.href)); } catch (e) { rej(userErr('스프레드시트 처리기를 시작하지 못했습니다.')); return; }
    const t = setTimeout(() => { w.terminate(); rej(userErr('스프레드시트를 읽는 데 너무 오래 걸려 중단했습니다. 파일이 손상되었거나 비정상적일 수 있습니다.')); }, 60000);
    w.onmessage = e => { clearTimeout(t); w.terminate(); e.data && e.data.ok ? res(e.data.sheets) : rej(userErr('스프레드시트를 읽지 못했습니다. ' + (e.data && e.data.error || ''))); };
    w.onerror = () => { clearTimeout(t); w.terminate(); rej(userErr('스프레드시트를 읽지 못했습니다.')); };
    const copy = bytes.slice(0); w.postMessage({bytes: copy, first: !!firstOnly}, [copy]);
  });
}
function isPwErr(e){ return e && (e.name === 'PasswordException' || /password/i.test(e.message || '')); }
async function libDoc(f, extra){
  await fileBytes(f);
  try { return await PDFDocument.load(f.bytes, {updateMetadata: false, ...(extra || {})}); }
  catch (e) {
    if (e && /encrypt/i.test(e.message || '')) {
      try { const d = await PDFDocument.load(f.bytes, {password: f.password || '', updateMetadata: false}); d.context.trailerInfo.Encrypt = undefined; return d; }
      catch (e2) { throw userErr(`"${f.name}"은(는) 암호가 걸린 PDF입니다. 먼저 'PDF 잠금 해제'에서 암호를 제거하세요.`); }
    }
    throw userErr(`"${f.name}"을(를) 읽지 못했습니다. 손상된 파일이라면 'PDF 복구'를 먼저 사용해 보세요.`);
  }
}
async function renderPage(page, scale, extraRot = 0, bg = '#fff'){
  const vp = page.getViewport({scale, rotation: (page.rotate + extraRot) % 360});
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(vp.width)); c.height = Math.max(1, Math.round(vp.height));
  const ctx = c.getContext('2d'); ctx.fillStyle = bg; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({canvasContext: ctx, viewport: vp}).promise;
  return c;
}
async function renderFit(f, n, maxW, maxH){
  const d = await pjs(f); const p = await d.getPage(n); const vp = p.getViewport({scale: 1});
  const s = Math.min(maxW / vp.width, (maxH || 1e9) / vp.height);
  return renderPage(p, s * (window.devicePixelRatio > 1 ? 1.5 : 1));
}
function canvasBlob(c, type = 'image/jpeg', q = 0.9){ return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('canvas')), type, q)); }
async function blobBytes(b){ return new Uint8Array(await b.arrayBuffer()); }
function pdfBlob(bytes){ return new Blob([bytes], {type: 'application/pdf'}); }
async function saveDoc(doc){ return pdfBlob(await doc.save({useObjectStreams: true})); }

/* page geometry: display coords (top-left origin, rotated as seen) -> PDF user space */
function geom(page){
  const box = page.getCropBox();
  const r = (((page.getRotation().angle || 0) % 360) + 360) % 360;
  const W = box.width, H = box.height;
  const dispW = r % 180 ? H : W, dispH = r % 180 ? W : H;
  function map(dx, dy){
    let x, y;
    if (r === 0) { x = dx; y = H - dy; } else if (r === 90) { x = dy; y = dx; }
    else if (r === 180) { x = W - dx; y = dy; } else { x = W - dy; y = H - dx; }
    return {x: x + box.x, y: y + box.y};
  }
  return {r, W, H, box, dispW, dispH, map, rot: degrees(r)};
}
function drawTextDisp(page, g, text, dx, dy, o){
  const lines = String(text).split('\n');
  const size = o.size, lh = size * 1.25;
  lines.forEach((ln, i) => {
    if (!ln) return;
    const p = g.map(dx, dy + size * 0.86 + i * lh);
    page.drawText(fsafe(o.font, ln), {x: p.x, y: p.y, size, font: o.font, color: o.color || rgb(0, 0, 0), rotate: g.rot, opacity: o.opacity ?? 1});
  });
}
function hexRgb(hex){ const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '#000000'); return m ? rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255) : rgb(0, 0, 0); }

/* page range parsing: "1-3, 5, 8-" -> [0,1,2,4,7,...] */
function parseRanges(str, total){
  const out = [];
  for (const partRaw of String(str || '').split(/[,，\s]+/)) {
    const part = partRaw.trim(); if (!part) continue;
    const m = /^(\d*)\s*[-~]\s*(\d*)$/.exec(part);
    if (m) {
      let a = m[1] ? +m[1] : 1, b = m[2] ? +m[2] : total;
      if (a > b) [a, b] = [b, a];
      for (let i = Math.max(1, a); i <= Math.min(total, b); i++) out.push(i - 1);
    } else if (/^\d+$/.test(part)) { const n = +part; if (n >= 1 && n <= total) out.push(n - 1); }
    else throw userErr(`페이지 범위 "${part}"를 이해하지 못했습니다. 예: 1-3, 5, 8-10`);
  }
  return out;
}
function rangeGroups(str, total){
  return String(str || '').split(/[,，]+/).map(s => s.trim()).filter(Boolean).map(s => ({label: s, idx: parseRanges(s, total)})).filter(g => g.idx.length);
}

/* text extraction with positions (display coords, pt) */
async function pageTextItems(page){
  const vp = page.getViewport({scale: 1});
  const tc = await page.getTextContent();
  const items = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) { if (it.hasEOL && items.length) items[items.length - 1].eol = true; continue; }
    const t = pdfjsLib.Util.transform(vp.transform, it.transform);
    const fh = Math.hypot(t[2], t[3]) || Math.abs(it.height) || 10;
    const x = t[4], yb = t[5];
    const w = it.width * vp.scale || it.str.length * fh * 0.5;
    items.push({str: it.str, x, y: yb - fh, w: Math.abs(w), h: fh, base: yb, font: it.fontName, eol: it.hasEOL});
  }
  return {items, width: vp.width, height: vp.height};
}
function groupLines(items){
  const sorted = [...items].sort((a, b) => a.base - b.base || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const ln = lines.find(l => Math.abs(l.base - it.base) < Math.max(2, Math.min(l.h, it.h) * 0.45));
    if (ln) { ln.items.push(it); ln.h = Math.max(ln.h, it.h); }
    else lines.push({base: it.base, h: it.h, items: [it]});
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    let s = '', prevEnd = null;
    for (const it of l.items) {
      if (prevEnd != null) { const gap = it.x - prevEnd; if (gap > it.h * 0.18 && !s.endsWith(' ') && !it.str.startsWith(' ')) s += gap > it.h * 2.2 ? '\t' : ' '; }
      s += it.str; prevEnd = it.x + it.w;
    }
    l.text = s.replace(/\s+$/, ''); l.x = l.items[0].x; l.x2 = Math.max(...l.items.map(i => i.x + i.w)); l.y = l.base - l.h;
  }
  lines.sort((a, b) => a.base - b.base);
  return lines;
}
function groupBlocks(lines){
  const blocks = [];
  for (const l of lines) {
    const b = blocks[blocks.length - 1];
    const prev = b && b.lines[b.lines.length - 1];
    if (b && prev && Math.abs(prev.h - l.h) < l.h * 0.25 && l.y - prev.base < l.h * 0.9 && l.x < prev.x2 && l.x2 > b.x - l.h && !/^[•\-–·▪●○◦\d]+[.)]?\s/.test(l.text)) {
      b.lines.push(l); b.x = Math.min(b.x, l.x); b.x2 = Math.max(b.x2, l.x2); b.y2 = l.base + l.h * 0.25;
    } else blocks.push({lines: [l], x: l.x, x2: l.x2, y: l.y, y2: l.base + l.h * 0.25, h: l.h});
  }
  for (const b of blocks) b.text = b.lines.map(l => l.text.replace(/\t/g, ' ')).join('\n').replace(/([^\s.!?。:;])\n(?=[a-z가-힣])/g, '$1 ');
  return blocks;
}
async function docText(f, onProgress, signal){
  const d = await pjs(f); const pages = [];
  for (let i = 1; i <= d.numPages; i++) {
    if (signal && signal.aborted) throw userErr('취소했습니다.');
    const p = await d.getPage(i); const t = await pageTextItems(p);
    const lines = groupLines(t.items);
    pages.push({n: i, width: t.width, height: t.height, lines, blocks: groupBlocks(lines), text: lines.map(l => l.text).join('\n')});
    onProgress && onProgress(i / d.numPages);
  }
  return pages;
}

/* image helpers */
async function loadImage(file){
  const bmp = await createImageBitmap(file, {imageOrientation: 'from-image'}).catch(async () => {
    const url = URL.createObjectURL(file); const img = new Image(); img.src = url; await img.decode(); return img;
  });
  return bmp;
}
function toCanvas(src, maxDim){
  const w = src.width, hgt = src.height; const s = maxDim ? Math.min(1, maxDim / Math.max(w, hgt)) : 1;
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(hgt * s));
  const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(src, 0, 0, c.width, c.height); return c;
}
async function embedCanvas(doc, c, q = 0.88){ return doc.embedJpg(await blobBytes(await canvasBlob(c, 'image/jpeg', q))); }
async function embedAny(doc, file){
  const t = (file.type || '').toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (t === 'image/png') { try { return await doc.embedPng(bytes); } catch (e) {} }
  if (t === 'image/jpeg' && bytes[0] === 0xff) {
    // re-encode only when EXIF orientation would otherwise be lost
    if (!hasExifRotation(bytes)) { try { return await doc.embedJpg(bytes); } catch (e) {} }
  }
  const img = await loadImage(file); const c = toCanvas(img, 5000);
  return t === 'image/png' || t === 'image/webp' || t === 'image/gif' ? doc.embedPng(await blobBytes(await canvasBlob(c, 'image/png'))) : embedCanvas(doc, c, 0.92);
}
function hasExifRotation(b){
  for (let i = 2; i < Math.min(b.length, 65536) - 10; i++) {
    if (b[i] === 0x45 && b[i + 1] === 0x78 && b[i + 2] === 0x69 && b[i + 3] === 0x66) {
      const t = i + 6; const le = b[t] === 0x49; const r16 = o => le ? b[o] | b[o + 1] << 8 : b[o] << 8 | b[o + 1];
      const r32 = o => le ? (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0 : (b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) >>> 0;
      const ifd = t + r32(t + 4); const n = r16(ifd);
      for (let k = 0; k < n; k++) { const e = ifd + 2 + k * 12; if (r16(e) === 0x0112) return r16(e + 8) > 1; }
      return false;
    }
  }
  return false;
}
async function htmlToCanvasPages(node, pageWpx, pageHpx, scale = 2){
  await need('h2c');
  const full = await html2canvas(node, {scale, backgroundColor: '#ffffff', useCORS: false, logging: false, windowWidth: node.scrollWidth});
  const pages = []; const ph = Math.round(pageHpx * scale);
  // try to cut at blank rows so lines are not split
  const ctx = full.getContext('2d', {willReadFrequently: true});
  let y = 0;
  while (y < full.height - 2) {
    let cut = Math.min(full.height, y + ph);
    if (cut < full.height) {
      for (let k = 0; k < ph * 0.25; k += 2) {
        const row = ctx.getImageData(0, cut - k, full.width, 1).data; let blank = true;
        for (let i = 0; i < row.length; i += 16) { if (row[i] < 245 || row[i + 1] < 245 || row[i + 2] < 245) { blank = false; break; } }
        if (blank) { cut = cut - k; break; }
      }
    }
    const c = document.createElement('canvas'); c.width = full.width; c.height = ph;
    const cx = c.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height);
    cx.drawImage(full, 0, y, full.width, cut - y, 0, 0, full.width, cut - y);
    pages.push(c); y = cut;
  }
  return pages;
}
const PAGE_SIZES = {a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008], a3: [841.89, 1190.55], a5: [419.53, 595.28]};

/* minimal DOCX writer */
function xmlEsc(s){ return String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''); }
async function makeDocx(paras, opts = {}){
  // paras: [{text, size(pt), bold, align, pageBreak, heading(1-3), image:{bytes,w,h}}]
  const zip = new JSZip(); const media = [];
  const body = paras.map(p => {
    if (p.pageBreak) return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    if (p.image) {
      const id = media.length + 1; media.push(p.image);
      const cx = Math.round(p.image.w * 12700), cy = Math.round(p.image.h * 12700);
      return `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="img${id}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="img${id}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rImg${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    }
    const sz = Math.round((p.size || 11) * 2);
    const ppr = (p.heading ? `<w:pStyle w:val="Heading${p.heading}"/>` : '') + (p.align ? `<w:jc w:val="${p.align}"/>` : '') + (p.indent ? `<w:ind w:left="${Math.round(p.indent * 20)}"/>` : '') + '<w:spacing w:after="80"/>';
    const runs = String(p.text).split('\n').map((ln, i) => (i ? '<w:r><w:br/></w:r>' : '') + `<w:r><w:rPr>${p.bold ? '<w:b/>' : ''}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${xmlEsc(ln.replace(/\t/g, '    '))}</w:t></w:r>`).join('');
    return `<w:p><w:pPr>${ppr}</w:pPr>${runs}</w:p>`;
  }).join('');
  const [pw, ph] = opts.pageSize || [595.28, 841.89];
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rSt" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${media.map((m, i) => `<Relationship Id="rImg${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/img${i + 1}.jpeg"/>`).join('')}</Relationships>`);
  media.forEach((m, i) => zip.file(`word/media/img${i + 1}.jpeg`, m.bytes));
  const hs = [1, 2, 3].map(n => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="100"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>`).join('');
  zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Malgun Gothic" w:hAnsi="Malgun Gothic" w:eastAsia="Malgun Gothic" w:cs="Malgun Gothic"/><w:sz w:val="22"/><w:lang w:val="ko-KR" w:eastAsia="ko-KR"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${hs}</w:styles>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}<w:sectPr><w:pgSz w:w="${Math.round(pw * 20)}" w:h="${Math.round(ph * 20)}"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
}

/* LCS word diff (bounded) */
function diffTokens(a, b){
  const n = a.length, m = b.length;
  if (n * m > 4e6) { // too big: fall back to line-level equality
    const sb = new Set(b), sa = new Set(a);
    return {a: a.map(t => ({t, ch: !sb.has(t)})), b: b.map(t => ({t, ch: !sa.has(t)}))};
  }
  const dp = Array.from({length: n + 1}, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ra = [], rb = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ra.push({t: a[i++]}); rb.push({t: b[j++]}); }
    else if (dp[i + 1][j] >= dp[i][j + 1]) ra.push({t: a[i++], ch: true}); else rb.push({t: b[j++], ch: true});
  }
  while (i < n) ra.push({t: a[i++], ch: true}); while (j < m) rb.push({t: b[j++], ch: true});
  return {a: ra, b: rb};
}
