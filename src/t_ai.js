/* ============ PDF 분석 ============ */
function mdToHtml(md){
  const esc = s => s.replace(/[&<>]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;'}[c]));
  const inl = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
  let html = '', inList = false;
  for (const ln of md.split('\n')) {
    const m = /^(#{1,6})\s+(.*)$/.exec(ln); const li = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(ln);
    if (li) { if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + inl(li[1]) + '</li>'; continue; }
    if (inList) { html += '</ul>'; inList = false; }
    if (m) html += `<h${Math.min(3, m[1].length)}>${inl(m[2])}</h${Math.min(3, m[1].length)}>`;
    else if (ln.trim()) html += '<p>' + inl(ln) + '</p>';
  }
  if (inList) html += '</ul>';
  return html;
}
function pdfToMarkdown(pages, withPages){
  const body = medianSize(pages); const out = [];
  for (const pg of pages) {
    if (withPages && pages.length > 1) out.push(`<!-- ${pg.n}쪽 -->`);
    for (const b of pg.blocks) {
      const r = b.h / body; const t = b.text.trim(); if (!t) continue;
      if (r > 1.6 && t.length < 120) out.push('# ' + t.replace(/\n/g, ' '));
      else if (r > 1.3 && t.length < 140) out.push('## ' + t.replace(/\n/g, ' '));
      else if (r > 1.12 && t.length < 140 && b.lines.length <= 2) out.push('### ' + t.replace(/\n/g, ' '));
      else if (/^[•●○◦▪·\-–]\s*/.test(t)) out.push(t.split('\n').map(l => '- ' + l.replace(/^[•●○◦▪·\-–]\s*/, '')).join('\n'));
      else if (/^\d+[.)]\s/.test(t)) out.push(t);
      else if (b.lines.some(l => l.text.includes('\t')) && b.lines.length > 1) {
        const rows = b.lines.map(l => l.text.split('\t').map(c => c.trim())); const nc = Math.max(...rows.map(r => r.length));
        if (nc > 1) { out.push(rows.map((r, i) => '| ' + [...r, ...Array(nc - r.length).fill('')].join(' | ') + ' |' + (i === 0 ? '\n|' + ' --- |'.repeat(nc) : '')).join('\n')); continue; }
        out.push(t);
      } else out.push(t.replace(/\n/g, ' '));
    }
  }
  return out.join('\n\n').replace(/\n{3,}/g, '\n\n') + '\n';
}
tool({id: 'markdown', cat: 'ai', code: '.MD', title: 'PDF → 마크다운', desc: 'PDF를 제목·목록·표가 살아 있는 마크다운 파일로 바꿉니다. 노트나 LLM 입력용으로 좋습니다.', kw: 'md markdown 텍스트 llm', isNew: false,
  opts: [{id: 'pages', type: 'check', def: false, label: '쪽 구분 표시 넣기'}],
  action: '마크다운으로 변환',
  async run(ctx){
    const f = ctx.files[0]; const pages = await docText(f, p => ctx.progress(p, '글자를 읽는 중'), ctx.signal);
    if (!pages.some(p => p.text.trim())) throw userErr('글자가 없는 PDF입니다. 스캔 문서라면 먼저 OCR PDF를 실행하세요.');
    const md = pdfToMarkdown(pages, ctx.o.pages);
    return {outputs: [{name: baseName(f.name) + '.md', blob: new Blob([md], {type: 'text/markdown'})}], summary: `${pages.length}쪽, ${md.length.toLocaleString()}자`,
      view: h('div', {class: 'preview-text', style: {fontFamily: 'var(--f-mono)', fontSize: '13px'}}, md.slice(0, 30000))};
  }});

function aiErr(e){
  const c = e && e.code;
  if (c === 'cancelled') return userErr('취소했습니다.');
  if (c === 'not_granted' || c === 'sampling_disabled') return userErr('Claude 사용이 허용되지 않았습니다. 이 페이지의 권한 설정에서 허용한 뒤 다시 시도하세요.');
  if (c === 'rate_limited') return userErr('Claude 사용량 한도에 걸렸습니다. 잠시 후 다시 시도하세요.');
  if (c === 'prompt_too_large') return userErr('문서가 너무 깁니다. 페이지 범위를 줄여 다시 시도하세요.');
  if (c === 'refused') return userErr('Claude가 이 내용을 처리하지 않았습니다.');
  if (c === 'invalid_json') return userErr('번역 결과를 읽지 못했습니다. 다시 시도하세요.');
  return userErr('Claude에 연결하지 못했습니다. 다시 시도하세요.');
}
/* personal data never leaves the device in clear: swap it for placeholders before sending, restore after */
const PII = [['주민등록번호', /\b\d{6}\s?-\s?[1-8]\d{6}\b/g], ['카드번호', /\b\d{4}[-\s]\d{4}[-\s]\d{4}[-\s]\d{4}\b/g], ['전화번호', /\b(?:01[016789]|0\d{1,2})[-\s.]?\d{3,4}[-\s.]?\d{4}\b/g],
  ['계좌·여권 등 긴 번호', /\b\d{3,6}-\d{2,6}-\d{4,8}\b/g], ['이메일', /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g]];
function maskPII(text, map){
  for (const [label, re] of PII) text = text.replace(re, m => { let k = map.byVal.get(m); if (!k) { k = `⟦P${map.list.length + 1}⟧`; map.byVal.set(m, k); map.list.push([k, m, label]); } return k; });
  return text;
}
function newPiiMap(){ return {byVal: new Map(), list: []}; }
function unmaskPII(text, map){ for (const [k, v] of map.list) text = text.split(k).join(v); return text; }
function piiSummary(map){ const c = {}; map.list.forEach(([, , l]) => c[l] = (c[l] || 0) + 1); return Object.entries(c).map(([l, n]) => `${l} ${n}건`).join(', '); }
const maskOpt = {id: 'mask', type: 'check', def: true, label: '보내기 전에 개인정보 가리기', hint: '주민등록번호·카드번호·전화번호·이메일을 기호로 바꿔 보내고, 결과에는 이 기기에서 원래 값으로 되돌립니다.'};
const AI_LANGS = [['ko', '한국어'], ['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['pt', 'Português'], ['it', 'Italiano'], ['id', 'Bahasa Indonesia']];
const aiNote = () => window.claude ? null : {type: 'note', warn: true, text: 'AI 기능은 Claude 안에서 이 도구를 열었을 때만 쓸 수 있습니다.'};
tool({id: 'summarize', cat: 'ai', code: 'AI·요약', title: 'AI 요약기', desc: '긴 PDF의 핵심을 몇 초 만에 간추려 줍니다.', kw: '요약 정리 핵심 ai claude', isNew: true,
  opts: () => [aiNote(), {id: 'len', type: 'seg', def: 'mid', label: '길이', choices: [['short', '짧게'], ['mid', '보통'], ['long', '자세히']]},
    {id: 'lang', type: 'select', def: 'ko', label: '요약 언어', choices: [['ko', '한국어'], ['src', '문서 언어 그대로'], ['en', 'English']]},
    {id: 'range', type: 'text', def: '', label: '페이지', placeholder: '비우면 전체'}, maskOpt,
    {type: 'note', text: '문서에서 뽑은 글자를 Claude에게 보내 요약합니다. 처음 한 번은 허용할지 묻습니다. 환자 기록처럼 민감한 문서는 먼저 PDF 검열로 지운 뒤 쓰세요.'}].filter(Boolean),
  ready: () => S.files.length > 0 && !!window.claude, action: '요약하기',
  async run(ctx){
    const sample = await getSample(); if (!sample) throw userErr('이 보기에서는 AI 기능을 쓸 수 없습니다.');
    const f = ctx.files[0]; const pages = await docText(f, p => ctx.progress(p * 0.3, '글자를 읽는 중'), ctx.signal);
    const idx = ctx.o.range ? new Set(parseRanges(ctx.o.range, pages.length)) : null;
    let text = pages.filter(p => !idx || idx.has(p.n - 1)).map(p => `[${p.n}쪽]\n${p.text}`).join('\n\n');
    if (!text.replace(/\[\d+쪽\]/g, '').trim()) throw userErr('글자가 없는 PDF입니다. 스캔 문서라면 먼저 OCR PDF를 실행하세요.');
    if (text.length > 160000) text = text.slice(0, 160000) + '\n…(이하 생략)';
    const pii = newPiiMap(); if (ctx.o.mask !== false) text = maskPII(text, pii);
    const lenSpec = {short: '핵심 요점 3~5개의 짧은 글머리표', mid: '한 문단 개요와 핵심 요점 5~8개의 글머리표', long: '섹션별 소제목(##)과 각 섹션의 자세한 글머리표, 마지막에 결론 한 문단'}[ctx.o.len];
    const langSpec = ctx.o.lang === 'ko' ? '한국어로' : ctx.o.lang === 'en' ? 'in English' : '문서에 쓰인 언어로';
    const prompt = `다음은 PDF 문서 "${f.name}"에서 추출한 텍스트입니다. ${langSpec} 요약해 주세요.\n형식: 첫 줄은 "# "로 시작하는 문서 제목 한 줄, 그다음 ${lenSpec}. 마크다운만 쓰고, 문서에 없는 내용은 덧붙이지 마세요. 중요한 수치와 날짜는 그대로 살리고, 가능하면 근거 쪽수를 (p.3)처럼 붙이세요. ⟦P1⟧ 같은 기호는 가려 둔 값이니 그대로 옮겨 쓰세요.\n\n<document>\n${text}\n</document>`;
    const out = h('div', {class: 'preview-text md', style: {whiteSpace: 'normal'}}, '생각하는 중…');
    await ctx.progress(0.35, 'Claude가 문서를 읽고 있습니다 (허용 창이 뜨면 허용을 눌러 주세요)');
    let res;
    try { res = await sample(prompt, {signal: ctx.signal, modelTier: 'default', onText: ({text}) => { out.innerHTML = mdToHtml(unmaskPII(text, pii)); ctx.progress(0.7, '요약을 쓰는 중…').catch(() => {}); }}); }
    catch (e) { throw aiErr(e); }
    const final = unmaskPII(res.text, pii); out.innerHTML = mdToHtml(final);
    const masked = pii.list.length ? ` · 가려서 보낸 개인정보: ${piiSummary(pii)}` : '';
    return {outputs: [{name: baseName(f.name) + '_요약.md', blob: new Blob([final], {type: 'text/markdown'})}], title: '요약했습니다', summary: (res.truncated ? '요약이 길어 중간에 끊겼습니다. 페이지 범위를 줄여 보세요.' : `${pages.length}쪽 문서`) + masked, view: out};
  }});

tool({id: 'translate', cat: 'ai', code: 'AI·번역', title: 'PDF 번역', desc: 'AI로 PDF를 번역하고, 원래 배치를 최대한 살린 PDF로 돌려줍니다.', kw: '번역 영어 한국어 ai claude', isNew: true,
  opts: () => [aiNote(), {id: 'to', type: 'select', def: 'ko', label: '번역할 언어', choices: AI_LANGS},
    {id: 'range', type: 'text', def: '', label: '페이지', placeholder: '비우면 전체', hint: '긴 문서는 범위를 나눠 번역하면 빠릅니다.'},
    {id: 'md', type: 'check', def: true, label: '번역문을 텍스트(.md)로도 받기'}, maskOpt,
    {type: 'note', text: '원래 글자 자리를 흰 바탕으로 덮고 번역문을 맞춰 넣습니다. 색 배경 위의 글자는 흰 상자가 보일 수 있습니다.'}].filter(Boolean),
  ready: () => S.files.length > 0 && !!window.claude, action: '번역하기',
  async run(ctx){
    const sample = await getSample(); if (!sample) throw userErr('이 보기에서는 AI 기능을 쓸 수 없습니다.');
    const f = ctx.files[0]; const pages = await docText(f, p => ctx.progress(p * 0.1, '글자를 읽는 중'), ctx.signal);
    const sel = ctx.o.range ? new Set(parseRanges(ctx.o.range, pages.length)) : null;
    const blocks = []; pages.forEach(p => { if (sel && !sel.has(p.n - 1)) return; p.blocks.forEach(b => { if (b.text.trim() && /\p{L}/u.test(b.text)) blocks.push({p, b}); }); });
    if (!blocks.length) throw userErr('번역할 글자가 없습니다. 스캔 문서라면 먼저 OCR PDF를 실행하세요.');
    const lang = AI_LANGS.find(l => l[0] === ctx.o.to)[1];
    const pii = newPiiMap();
    const chunks = []; let cur = [], len = 0;
    for (const x of blocks) { if (cur.length && (len + x.b.text.length > 4500 || cur.length >= 60)) { chunks.push(cur); cur = []; len = 0; } cur.push(x); len += x.b.text.length; }
    if (cur.length) chunks.push(cur);
    for (let ci = 0; ci < chunks.length; ci++) {
      await ctx.progress(0.1 + 0.8 * ci / chunks.length, `번역하는 중 ${ci + 1}/${chunks.length} (허용 창이 뜨면 허용을 눌러 주세요)`);
      const arr = chunks[ci].map(x => ctx.o.mask !== false ? maskPII(x.b.text, pii) : x.b.text);
      const prompt = `Translate every string in this JSON array into ${lang}. Keep numbers, names, codes, URLs, line breaks and placeholder tokens like ⟦P1⟧ exactly as they are. If a string is already in ${lang} or is not translatable, return it unchanged. Reply with only a JSON array of exactly ${arr.length} strings, in the same order.\n\n${JSON.stringify(arr)}`;
      let res;
      try { res = await sample.json(prompt, {signal: ctx.signal, modelTier: 'default'}); } catch (e) { throw aiErr(e); }
      if (!Array.isArray(res)) throw userErr('번역 결과를 읽지 못했습니다. 다시 시도하세요.');
      chunks[ci].forEach((x, i) => { x.tr = typeof res[i] === 'string' ? unmaskPII(res[i], pii) : x.b.text; });
    }
    await ctx.progress(0.92, '번역문을 페이지에 배치하는 중');
    const doc = await libDoc(f); const font = await korFont(doc);
    for (const x of blocks) {
      const page = doc.getPage(x.p.n - 1); const g = geom(page); const b = x.b;
      const bx = b.x - 1, by = b.y - b.h * 0.12, bw = Math.max(20, b.x2 - b.x + 2), bh = Math.max(b.h, b.y2 - b.y + b.h * 0.15);
      const a = g.map(bx, by + bh); page.drawRectangle({x: a.x, y: a.y, width: bw, height: bh, rotate: g.rot, color: rgb(1, 1, 1)});
      let size = b.h * 0.95, lines;
      for (let k = 0; k < 30; k++) { lines = wrapText(font, fsafe(font, x.tr), size, bw * 1.04); if (lines.length * size * 1.22 <= bh * 1.08 || size < 4.5) break; size *= 0.92; }
      drawTextDisp(page, g, lines.join('\n'), bx + 1, by + (bh - Math.min(bh, lines.length * size * 1.22)) / 2 * 0, {size, font, color: rgb(0.08, 0.08, 0.1)});
    }
    const outs = [{name: `${baseName(f.name)}_${ctx.o.to}.pdf`, blob: await saveDoc(doc)}];
    if (ctx.o.md) { const md = pages.map(p => blocks.filter(x => x.p === p).map(x => x.tr).join('\n\n')).filter(Boolean).join('\n\n---\n\n'); outs.push({name: `${baseName(f.name)}_${ctx.o.to}.md`, blob: new Blob([md], {type: 'text/markdown'})}); }
    return {outputs: outs, summary: `글 덩어리 ${blocks.length}개를 ${lang}(으)로 번역했습니다.` + (pii.list.length ? ` 가려서 보낸 개인정보: ${piiSummary(pii)}` : '')};
  }});

/* ============ boot ============ */
window.appBack = () => { if (document.querySelector('.modal')) { document.querySelector('.modal').remove(); return true; } if (S.tool) { go(null); return true; } return false; };
(function boot(){
  if (window.AndroidBridge) document.documentElement.classList.add('in-app');
  if (window.AndroidBridge || !window.claude) { const ai = TOOLS.filter(t => t.isNew); ai.forEach(t => { t.desc += ' (Claude 안에서 열었을 때 사용 가능)'; }); }
  let id = ''; try { id = (location.hash || '').slice(1); } catch (e) {}
  if (id && TOOLS.some(t => t.id === id)) go(id); else render();
  window.addEventListener('hashchange', () => { let h2 = ''; try { h2 = location.hash.slice(1); } catch (e) {} if ((S.tool ? S.tool.id : '') !== h2) go(TOOLS.some(t => t.id === h2) ? h2 : null); });
  if (window.__DESKTOP__) { const ping = () => fetch('/__ping').catch(() => {}); ping(); setInterval(ping, 5000); }
  fontBytes(); // warm the Korean font
})();
