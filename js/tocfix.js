// 이미 만들어 둔 교재 합본(강사용)의 목차를 「강사용 실제 쪽수」로 다시 만든다.
// 원본 교재를 다시 올릴 필요 없이, 만들어 둔 강사용·학생용 PDF만으로 단원 위치를 찾아 낸다.
//  · 단원 첫 쪽 = 단원 QR(300×300 그림)이 찍힌 쪽 (강사용·학생용 모두)
//  · 문제 끝 쪽 = 「정답 및 해설」 속표지 바로 앞 쪽
//  · 정답 쪽 범위 = 속표지 뒤 쪽들 중 위쪽에 「1-1.○○(01)」 같은 단원 제목 줄이 있는 쪽이 새 단원의 시작
const TocFix = (function () {
  const NAME_RE = /^\s*\d+(?:\s*[‑‐\-]\s*\d+)*\s*\.\s*\S/;
  const strip = s => {
    let t = String(s || '').replace(/‑|‐/g, '-').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
    const m = t.match(/^\d+(?:-\d+)*\./);                       // 두 단 제목이 한 줄로 합쳐진 경우: 앞 제목 번호가 다시 나오면 거기서 자른다
    if (m) { const i = t.indexOf(m[0], m[0].length); if (i > 0) t = t.slice(0, i).trim(); }
    if (/^[^()]*\(\d+$/.test(t)) t += ')';
    if (/^[^()]*\d{2}\)$/.test(t)) t = t.replace(/(\d{2})\)$/, '($1)');
    return t;
  };

  // 단원 QR이 찍힌 쪽(1부터)을 모두 찾는다: 쪽 자원에 300×300 그림이 있는 쪽
  function qrPages(pdf) {
    const out = [], ctx = pdf.context, N = PDFLib.PDFName;
    pdf.getPages().forEach((pg, i) => {
      try {
        const res = pg.node.Resources(); if (!res) return;
        const xo = res.lookup(N.of('XObject')); if (!xo || !xo.entries) return;
        for (const ent of xo.entries()) {
          const o = ctx.lookup(ent[1]); const d = o && o.dict; if (!d) continue;
          const w = d.lookup(N.of('Width')), h = d.lookup(N.of('Height'));
          if (w && h && w.asNumber && w.asNumber() === 300 && h.asNumber() === 300) { out.push(i + 1); return; }
        }
      } catch (e) {}
    });
    return out;
  }

  // 한 쪽의 글자 줄(위에서 아래 순서)
  async function pageLines(doc, p) {
    const pg = await doc.getPage(p), vp = pg.getViewport({ scale: 1 }), tc = await pg.getTextContent();
    const rows = [];
    tc.items.forEach(it => { const t = String(it.str || ''); if (!t.trim()) return; const y = vp.height - it.transform[5], x = it.transform[4]; let r = rows.find(z => Math.abs(z.y - y) < 4); if (!r) rows.push(r = { y: y, parts: [] }); r.parts.push({ x: x, w: it.width || 0, t: t }); });
    rows.sort((a, b) => a.y - b.y);
    return { H: vp.height, lines: rows.map(r => ({ y: r.y, text: r.parts.sort((a, b) => a.x - b.x).reduce((acc, z, i, arr) => acc + (i && z.x - (arr[i - 1].x + arr[i - 1].w) > 1.5 ? ' ' : '') + z.t, '').replace(/\s+/g, ' ').trim() })) };
  }

  // 「정답 및 해설」 속표지 쪽: 마지막 단원 QR 쪽 뒤에서 처음 나오는, 글자가 거의 없고 「정답 및 해설」로 시작하는 쪽
  async function findDivider(doc, from, N) {
    for (let p = from; p <= N; p++) {
      const { lines } = await pageLines(doc, p), t = lines.map(l => l.text).join(' ');
      const tn = t.replace(/\s+/g, ''); if (/^정답및해설/.test(tn) && tn.length < 50) return p;
    }
    return 0;
  }

  // 정답 쪽을 단원별로 나눈다: 위쪽 6줄 안에 「1-1.○○(01)」 같은 단원 제목 줄(「|」 없음)이 있으면 새 단원 시작
  async function answerSections(doc, from, N, say) {
    const secs = [];
    for (let p = from; p <= N; p++) {
      if (say && (p - from) % 15 === 0) say('정답 쪽 단원 나누는 중... ' + (p - from) + '/' + (N - from + 1));
      const { H, lines } = await pageLines(doc, p), top = lines.filter(l => l.y < H * 0.2).slice(0, 6);
      const nm = top.find(l => NAME_RE.test(l.text) && l.text.indexOf('|') < 0 && l.text.length < 60);
      if (nm) {
        const tg = top.find(l => /공략|수준별|자료분석/.test(l.text) && /정답\s*및\s*해설/.test(l.text));
        const name = strip(nm.text), tag = tg ? tg.text.replace(/[·・].*$/, '').trim() : '', last = secs[secs.length - 1];
        // 쪽마다 제목이 되풀이되는 교재가 있어서, 앞 쪽과 제목·분류가 똑같으면 같은 단원의 이어진 쪽으로 본다
        if (last && last.ab === p - 1 && last.name === name && last.tag === tag) last.ab = p;
        else secs.push({ aa: p, ab: p, name: name, tag: tag });
      } else if (secs.length) secs[secs.length - 1].ab = p;
    }
    return secs;
  }

  async function analyze(bytes, say, label, wantAnswers) {
    say(label + ' 열어 보는 중...');
    const pdf = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const N = pdf.getPageCount(), qr = qrPages(pdf);
    if (qr[0] !== 2 && /tocfix:v1/.test(String(pdf.getKeywords() || ''))) qr.unshift(2);   // 이미 고친 파일: 목차 쪽 QR이 그림으로 바뀌어 있다
    if (qr.length < 2 || qr[0] !== 2) throw new Error(label + '에서 목차 쪽·단원 QR을 찾지 못했어요. 이 앱으로 만든 QR 합본이 아닌 것 같아요.');
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
    say(label + ' 정답 속표지 찾는 중...');
    const div = await findDivider(doc, qr[qr.length - 1] + 1, N);
    if (!div) throw new Error(label + '에서 「정답 및 해설」 속표지를 찾지 못했어요.');
    const starts = qr.slice(1), secs = starts.map((s, i) => ({ qa: s, qb: i + 1 < starts.length ? starts[i + 1] - 1 : div - 1 }));
    let ans = [];
    if (wantAnswers) {
      ans = await answerSections(doc, div + 1, N, t => say(label + ' ' + t));
      if (ans.length !== secs.length) throw new Error(label + ': 문제 단원 ' + secs.length + '개인데 정답 쪽에서 찾은 단원은 ' + ans.length + '개예요. (정답 쪽 제목 모양이 달라서 나누지 못했어요)');
    }
    return { pdf: pdf, doc: doc, N: N, tocEnd: qr[1] - 1, div: div, secs: secs, ans: ans };
  }

  // 목차 오른쪽 위 「여러 단원 한꺼번에 채점 → QR」 상자를 그림으로 따 둔다 (새 목차 쪽에 다시 붙이려고)
  async function grabMultiQr(doc, W, H) {
    const pg = await doc.getPage(2), K = 3, vp = pg.getViewport({ scale: K }), cv = document.createElement('canvas'); cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height);
    const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
    await pg.render({ canvasContext: cx, viewport: vp, canvas: cv }).promise;
    const bw = 200, bh = 52, c2 = document.createElement('canvas'); c2.width = bw * K; c2.height = bh * K;
    c2.getContext('2d').drawImage(cv, (W - bw) * K, 0, bw * K, bh * K, 0, 0, bw * K, bh * K);
    cv.width = cv.height = 0;
    return { png: c2.toDataURL('image/png'), w: bw, h: bh };
  }

  // 메인: 강사용(bytes) + 학생용(studentBytes, 선택) → 새 강사용 PDF(Uint8Array)와 요약
  async function rebuild(o) {
    const say = o.say || (() => {});
    const T = await analyze(o.bytes, say, '강사용', true);
    let S = null;
    if (o.studentBytes) { try { S = await analyze(o.studentBytes, say, '학생용', false); if (S.secs.length !== T.secs.length) { say('학생용 단원 수가 달라 학생 쪽수는 빼요'); S = null; } } catch (e) { say('학생용을 읽지 못해 학생 쪽수는 빼요: ' + e.message); S = null; } }
    const n = T.secs.length, K = T.tocEnd - 1;          // K = 지울 옛 목차 쪽 수 (2쪽부터 첫 단원 앞 쪽까지)
    // 단원 이름·분류: 만들 때 저장해 둔 정보(coverSecs)가 있으면 그것, 없으면 정답 쪽 제목에서 읽은 것
    const cs = (o.coverSecs && o.coverSecs.length === n) ? o.coverSecs.slice().sort((a, b) => a.order - b.order) : null;
    const unitOf = nm => { const m = String(nm).match(/^\s*(\d+)/); return m ? parseInt(m[1], 10) : 0; };
    const secs = T.secs.map((s, i) => Object.assign({ order: i, unit: unitOf(T.ans[i].name), unitName: '', tag: T.ans[i].tag, name: T.ans[i].name }, cs ? { name: cs[i].name, tag: cs[i].tag || '', unit: cs[i].unit, unitName: cs[i].unitName || '', order: cs[i].order } : {}, { qa: s.qa, qb: s.qb, aa: T.ans[i].aa, ab: T.ans[i].ab }));
    const first = T.pdf.getPage(0).getSize(), W = first.width, H = first.height;
    say('옛 목차 쪽의 QR 상자를 따 두는 중...');
    const qrBox = await grabMultiQr(T.doc, W, H);
    const pdf = T.pdf;
    for (let i = K; i >= 1; i--) pdf.removePage(i);          // 옛 목차 쪽 지우기 (표지 다음 K쪽)
    const pos = p => p > K + 1 ? p - K : p, posEnd = (sec, w) => pos(sec[w]);
    // 학생 교재 쪽 (학생용 PDF 그대로의 실제 쪽 번호)
    let stu = null; const qaMap = {}, qbMap = {};
    if (S) { T.secs.forEach((t, i) => { qaMap[t.qa] = S.secs[i].qa; qbMap[t.qb] = S.secs[i].qb; }); stu = { pos: p => qaMap[p] || qbMap[p] || 0, final: true }; }
    say('새 목차 만드는 중...');
    const nIns = await o.insertToc(pdf, secs, o.bookName, pos, true, 1, posEnd, stu, K);
    if (nIns !== K) throw new Error('새 목차가 ' + nIns + '쪽이라 옛 목차(' + K + '쪽)와 쪽 수가 달라요. 쪽 번호가 밀려서 중단했어요.');
    // 목차 쪽 오른쪽 위 QR 상자 복원
    { const img = await pdf.embedPng(qrBox.png), pg = pdf.getPage(1); pg.drawRectangle({ x: W - qrBox.w, y: H - qrBox.h, width: qrBox.w, height: qrBox.h, color: PDFLib.rgb(1, 1, 1) }); pg.drawImage(img, { x: W - qrBox.w, y: H - qrBox.h, width: qrBox.w, height: qrBox.h }); }
    { const font0 = await pdf.embedFont(PDFLib.StandardFonts.HelveticaBold);      // 새 목차 쪽 번호 (옛 목차 쪽과 함께 지워졌으므로 다시 쓴다)
      for (let i = 1; i <= K; i++) { const pg = pdf.getPage(i), t = String(i + 1), tw = font0.widthOfTextAtSize(t, 9.5); pg.drawText(t, { x: pg.getWidth() / 2 - tw / 2, y: 16, size: 9.5, font: font0, color: PDFLib.rgb(0.1, 0.1, 0.1) }); } }
    // 문제 쪽마다 「학생교재 N~M쪽」 (단원 전체 범위) — 쪽번호 옆
    let noted = 0;
    const already = /tocfix:v1/.test(String(pdf.getKeywords() || ''));
    if (already) say('이미 고친 파일이라 학생교재 쪽수 표시는 다시 붙이지 않아요');
    if (S && !o.noNotes && !already) {
      const font = await pdf.embedFont(PDFLib.StandardFonts.HelveticaBold), cache = {};
      for (let i = 0; i < n; i++) {
        const a = S.secs[i].qa, b = S.secs[i].qb, txt = '학생교재 ' + a + (b !== a ? '~' + b : '') + '쪽';
        if (!cache[txt]) {
          const nc = document.createElement('canvas'), ng = nc.getContext('2d'), F = '700 30px "Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif'; ng.font = F;
          const tw = Math.ceil(ng.measureText(txt).width) + 28; nc.width = tw; nc.height = 48; ng.font = F;
          ng.fillStyle = '#E8F0FE'; ng.beginPath(); ng.roundRect(1, 1, tw - 2, 46, 12); ng.fill(); ng.strokeStyle = '#2F5DA8'; ng.lineWidth = 2.5; ng.stroke();
          ng.fillStyle = '#1F3F7A'; ng.textBaseline = 'middle'; ng.textAlign = 'center'; ng.fillText(txt, tw / 2, 25);
          cache[txt] = { emb: await pdf.embedPng(nc.toDataURL('image/png')), r: tw / 48 };
        }
        const c = cache[txt];
        for (let p = T.secs[i].qa; p <= T.secs[i].qb; p++) {
          const np = p, pg = pdf.getPage(np - 1), tw = font.widthOfTextAtSize(String(np), 9.5), h = 11, w = h * c.r;
          pg.drawImage(c.emb, { x: pg.getWidth() / 2 + tw / 2 + 8, y: 14.5, width: w, height: h }); noted++;
        }
      }
    }
    say('저장하는 중...');
    try { pdf.setKeywords([String(pdf.getKeywords() || '').replace(/\s*tocfix:v1/g, '').trim(), 'tocfix:v1'].filter(Boolean)); } catch (e) {}
    const out = await pdf.save();
    return { bytes: out, summary: { sections: n, tocPagesOld: K, tocPagesNew: nIns, divider: T.div - K, pages: out.length, notes: noted, student: !!S, namesFrom: cs ? '저장된 교재 정보' : '정답 쪽 제목' }, secs: secs.map(s => ({ name: s.name, tag: s.tag, qa: pos(s.qa), qb: pos(s.qb), aa: pos(s.aa), ab: pos(s.ab) })) };
  }
  return { rebuild: rebuild, analyze: analyze, qrPages: qrPages };
})();
