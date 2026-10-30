/**
 * 문제은행 핵심 로직 (브라우저용, pdf.js + pdf-lib 사용)
 *  - scanPdf: PDF에서 문항 위치/정답 표시 위치/문항 수를 자동으로 찾는다.
 *  - renderRect: PDF 페이지의 특정 영역을 이미지(캔버스)로 잘라낸다.
 *  - composeExamPdf: 선택한 문항 이미지들을 새 시험지 PDF로 조합한다.
 */
(function (root) {
  const COLUMN_GAP_MIN = 40;
  const TOP_PAD = 9;     // 문항 사이의 가는 구분선이 잘리지 않게 여유를 더 둔다
  const BOTTOM_PAD = 8;
  const CIRCLED = { '①': '1', '②': '2', '③': '3', '④': '4', '⑤': '5', '⑥': '6', '⑦': '7', '⑧': '8', '⑨': '9', '⑩': '10' };

  // ── 페이지 텍스트를 top 기준 좌표로 정리 ──
  async function pageItems(doc, pageNum, withImages) {
    const page = await doc.getPage(pageNum);
    const vp = page.getViewport({ scale: 1 });
    const H = vp.height, W = vp.width;
    const tc = await page.getTextContent();
    const items = [];
    for (const it of tc.items) {
      const str = it.str;
      if (!str || !str.trim()) continue;
      const size = Math.abs(it.transform[3]) || it.height || 0;
      const x = it.transform[4];
      const base = H - it.transform[5];          // 위에서부터 잰 baseline
      const h = it.height || size;
      items.push({
        str: str.trim(), x: x, w: it.width, size: Math.round(size * 10) / 10,
        top: base - h, bottom: base + h * 0.25, base: base,
      });
    }
    const out = { W: W, H: H, items: items };
    if (withImages) { try { out.imgs = await pageImageRects(page, vp); } catch (e) { out.imgs = []; } }
    return out;
  }

  // 쪽에 그려진 그림(이미지)들의 위치 [x0, top, x1, bottom] (위에서부터 잰 좌표).
  // 그림은 글자로 안 읽혀서, 단의 마지막 문항·해설은 "마지막 글자"까지만 잘라 내면 그 밑의 그림·그래프가 잘린다 — 그걸 막으려고 찾아 둔다.
  async function pageImageRects(page, vp) {
    const OPS = (typeof pdfjsLib !== 'undefined' && pdfjsLib.OPS) || { save: 10, restore: 11, transform: 12, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75, paintImageXObject: 85, paintInlineImageXObject: 86, paintImageMaskXObject: 83, paintImageXObjectRepeat: 88, constructPath: 91 };
    const ol = await page.getOperatorList();
    const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
    let ctm = vp.transform.slice();
    const stack = [], rects = [];
    for (let i = 0; i < ol.fnArray.length; i++) {
      const fn = ol.fnArray[i], a = ol.argsArray[i];
      if (fn === OPS.save) stack.push(ctm.slice());
      else if (fn === OPS.restore) { if (stack.length) ctm = stack.pop(); }
      else if (fn === OPS.transform) ctm = mul(ctm, a);
      else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm.slice()); if (a && a[0]) ctm = mul(ctm, a[0]); }
      else if (fn === OPS.paintFormXObjectEnd) { if (stack.length) ctm = stack.pop(); }
      else if (fn === OPS.constructPath) {
        const nx = ol.fnArray[i + 1];
        if (nx === 29 || nx === 30) continue;                       // 잘라내기(clip)용 도형은 제외
        // 벡터 도형(그래프 선·상자 테두리 등): 좌표 묶음의 바깥 사각형
        const co = a && a[1];
        if (co && co.length >= 2) {
          const xs = [], ys = [];
          for (let k = 0; k + 1 < co.length; k += 2) { xs.push(ctm[0] * co[k] + ctm[2] * co[k + 1] + ctm[4]); ys.push(ctm[1] * co[k] + ctm[3] * co[k + 1] + ctm[5]); }
          rects.push([Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys), 1]);
        }
      }
      else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject || fn === OPS.paintImageXObjectRepeat) {
        const xs = [], ys = [];
        [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(function (pt) { xs.push(ctm[0] * pt[0] + ctm[2] * pt[1] + ctm[4]); ys.push(ctm[1] * pt[0] + ctm[3] * pt[1] + ctm[5]); });
        rects.push([Math.min.apply(null, xs), Math.min.apply(null, ys), Math.max.apply(null, xs), Math.max.apply(null, ys)]);
      }
    }
    return rects;
  }
  // 쪽 아래 꼬리말 영역의 위쪽 경계: 꼬리말 위의 가로줄, 또는 저작권 문구 같은 잡글자의 맨 윗줄. 문항·해설을 이보다 아래까지 자르지 않는다.
  function footerCap(pd, x0, x1, topY) {
    let cap = pd.H - 62;
    (pd.imgs || []).forEach(function (r) {
      if (r[4] && (r[3] - r[1]) < 2.5 && (r[2] - r[0]) > (x1 - x0) * 0.6 && r[1] > pd.H * 0.6 && r[1] > topY + 10 && r[2] > x0 && r[0] < x1) {
        // 그림 테두리 상자의 윗변(아래로 세로선이 이어진다)은 쪽 바닥 구분선이 아니다
        const boxTop = (pd.imgs || []).some(function (v) { return v[4] && (v[2] - v[0]) < 2.5 && (v[3] - v[1]) > 12 && Math.abs(v[1] - r[1]) < 3 && v[0] >= r[0] - 3 && v[0] <= r[2] + 3; });
        if (!boxTop) cap = Math.min(cap, r[1] - 2);
      }
    });
    try {
      const jk = junkItems(pd.items);
      pd.items.forEach(function (it) { if (jk.has(it) && it.top > topY + 10 && it.top > pd.H * 0.6 && it.x < x1 && it.x + it.w > x0) cap = Math.min(cap, it.top - 2); });
    } catch (e) {}
    return cap;
  }
  // 이 단(x0~x1)에서 top 아래쪽에 있는 그림 중 가장 낮은 곳 (없으면 -1). limit보다 아래(쪽 바닥 장식)는 뺀다.
  function lowestImageBottom(pd, x0, x1, top, limit, from) {
    if (typeof NOIMG !== 'undefined' && NOIMG) return -1;
    const cand = [];
    (pd.imgs || []).forEach(function (r) {
      const w = r[2] - r[0], h = r[3] - r[1];
      if (r[2] < x0 + 4 || r[0] > x1 - 4 || r[1] < top - 4 || r[3] > limit + 2) return;
      if (w > (x1 - x0) * 1.6) return;                              // 쪽 전체 장식은 제외
      if (pd.tableRect && r[0] < pd.tableRect[2] && r[2] > pd.tableRect[0] && r[1] < pd.tableRect[3] && r[3] > pd.tableRect[1] + 4) return;   // 정답표는 문제 그림이 아니다
      if (r[4]) { if (h > pd.H * 0.6 || (h < 1.5 && w < 1.5)) return; }     // 벡터: 쪽 테두리급 큰 도형·점은 제외
      else if (h < 6 || w < 6) return;
      cand.push(r);
    });
    // 글자가 끝난 곳(from)에서 이어져 있는 것만 따라간다 (멀리 떨어진 아래쪽 상자·장식은 이 문항 것이 아님)
    cand.sort(function (a, b) { return a[1] - b[1]; });
    let b = from;
    cand.forEach(function (r) { if (r[1] <= b + 36 && r[3] > b) b = r[3]; });
    return b > from ? b : -1;
  }

  const NUM_RE = /^(\d{1,2})[.)](\s|$)/;

  function numberSpans(pd) {
    const out = [];
    const its = pd.items;
    // "16."이 "1" + "6." 처럼 글자(자릿수)마다 조각난 경우를 위해, 바로 왼쪽에 붙어 있는 한 자리 숫자 조각을 찾는다
    const leftDigit = it => its.find(o => o !== it && /^\d$/.test(o.str) && Math.abs(o.base - it.base) < 3 && it.x - (o.x + o.w) < 2.5 && it.x - (o.x + o.w) > -1.5);
    const rightPiece = (it, re) => its.find(o => o !== it && re.test(o.str) && Math.abs(o.base - it.base) < 3 && o.x >= it.x + it.w - 2 && o.x - (it.x + it.w) < 5);
    for (const it of its) {
      const m = NUM_RE.exec(it.str);
      if (m) {
        const ld = it.str.length >= 2 && /^\d[.)]/.test(it.str) ? leftDigit(it) : null;
        if (ld && !leftDigit(ld)) out.push({ num: parseInt(ld.str + m[1], 10), x: ld.x, x1: it.x + it.w, top: Math.min(it.top, ld.top), bottom: Math.max(it.bottom, ld.bottom), size: it.size });
        else if (!ld) out.push({ num: parseInt(m[1], 10), x: it.x, x1: it.x + it.w, top: it.top, bottom: it.bottom, size: it.size });
      } else if (/^\d{1,2}$/.test(it.str) && !leftDigit(it) && !its.some(o => o !== it && /[(（\[]$/.test(o.str.trim()) && Math.abs(o.base - it.base) < 3 && it.x - (o.x + o.w) < 3 && it.x - (o.x + o.w) > -2)) {   // "총(6)쪽" 같은 꼬리말 쪽번호는 문항 번호가 아니다
        // 번호와 점이 글꼴이 달라 따로 조각난 경우: "8" + "." / "1" + "8" + "."
        const d2 = it.str.length === 1 ? rightPiece(it, /^\d$/) : null;
        const base = d2 ? d2 : it; let dot = rightPiece(base, /^[.)]/);
        if (dot && dot.str === '.' && its.some(o => o !== dot && /^\d/.test(o.str) && Math.abs(o.base - dot.base) < 3 && o.x >= dot.x + dot.w - 1 && o.x - (dot.x + dot.w) < 2.5)) dot = null;   // "56.25" 같은 소수점은 문항 번호가 아니다
        if (dot) out.push({ num: parseInt(it.str + (d2 ? d2.str : ''), 10), x: it.x, x1: dot.x + dot.w, top: Math.min(it.top, dot.top), bottom: Math.max(it.bottom, dot.bottom), size: it.size });
      }
    }
    return out;
  }

  // "N) 정답 ③" 표시 찾기 (정답 번호가 글자면 text로 읽고, 그림이면 text 없음)
  // "N) 정답 ③", "N)[정답] ③", "N.[정답]", "N번 【정답】 …" 같은 표시를 찾는다.
  //  - 정답이 ①~⑤ / 숫자면 text로 읽고, 문장이면(서술형 정답) written=true 로 표시한다
  //  - 정답 번호가 그림이라 안 읽히면 text 없이 위치만 돌려준다
  const MARK_OPEN = '[\\[\\(【<]?', MARK_CLOSE = '[\\]\\)】>]?';
  const MERGED_RE = new RegExp('^(\\d{1,2})\\s*[).]\\s*' + MARK_OPEN + '\\s*정답\\s*' + MARK_CLOSE + '\\s*[:：]?\\s*(.*)$');
  const NUM_ONLY_RE = /^(\d{1,2})\s*[).]$/;
  const MARK_ONLY_RE = new RegExp('^' + MARK_OPEN + '\\s*정답\\s*' + MARK_CLOSE + '$');

  // "③⑤" · "③,⑤" · "3,5" · "③ ⑤" 처럼 보기 번호만 여러 개 나열된 정답이면 "35"로 돌려준다(아니면 '').
  function multiAnswerText(t) {
    const x = String(t || '').trim();
    if (!/^[①-⑨1-9](?:[\s,，·\/+]*[①-⑨1-9])+$/.test(x)) return '';
    const ds = x.replace(/[①-⑨]/g, c => String(c.charCodeAt(0) - 0x2460 + 1)).match(/[1-9]/g) || [];
    const u = Array.from(new Set(ds)).sort().join('');
    return u.length >= 2 ? u : '';
  }

  function answerMarkers(pd) {
    const found = [];
    const its = pd.items;
    for (let i = 0; i < its.length; i++) {
      const it = its[i];
      let m = MERGED_RE.exec(it.str);
      let num, tail = '', top = it.top, bottom = it.bottom, base = it.base;
      let markerLeft = it.x, markerRight = it.x + it.w, numRect = null, nextIdx = i + 1;
      if (m) {
        num = parseInt(m[1], 10);
        tail = m[2].trim();
        // 글자 수 비율로 "N)" 부분의 위치를 어림한다 (옛 번호를 지우고 새 번호를 덮을 때 사용)
        const perChar = it.w / Math.max(1, it.str.length);
        const prefixLen = it.str.length - m[2].length;
        markerRight = it.x + prefixLen * perChar;
        const numLen = String(m[1]).length + 1;
        numRect = [it.x - 1, it.top - 1, it.x + numLen * perChar + 2, it.bottom + 1];
      } else {
        m = NUM_ONLY_RE.exec(it.str);
        if (!m) continue;
        // "[정답]"이 "[" · "정답" · "]" 처럼 조각나 있어도 이어서 본다 (최대 3조각)
        let k = 0, joined = '', nxt = null;
        for (let n = 1; n <= 3 && its[i + n]; n++) {
          const c = its[i + n];
          if (Math.abs(c.base - it.base) > 8 || c.x < it.x || c.x - (n === 1 ? it.x + it.w : its[i + n - 1].x + its[i + n - 1].w) > 30) break;
          joined += c.str;
          if (MARK_ONLY_RE.test(joined) && /정답/.test(joined)) {
            k = n; nxt = c;
            const cl = its[i + n + 1];                      // "[정답" 뒤에 따로 떨어진 "]"도 마커의 일부로 본다
            if (/^[\[\(【<]/.test(joined) && !/[\]\)】>]$/.test(joined) && cl && /^[\]\)】>]$/.test(cl.str) && Math.abs(cl.base - it.base) <= 8) { k = n + 1; nxt = cl; }
            break;
          }
        }
        if (!k) continue;
        num = parseInt(m[1], 10);
        numRect = [it.x - 1, it.top - 1, it.x + it.w + 2, it.bottom + 1];
        markerRight = nxt.x + nxt.w;
        for (let n = 1; n <= k; n++) { top = Math.min(top, its[i + n].top); bottom = Math.max(bottom, its[i + n].bottom); }
        nextIdx = i + k + 1;
      }
      // 같은 줄 바로 오른쪽에 정답이 따로 떨어져 있으면 읽는다
      if (!tail) {
        const after = its[nextIdx];
        if (after && Math.abs(after.base - base) < 8 && after.x >= markerRight - 2 && after.x - markerRight < 40) tail = after.str;
      }
      let text = '', written = false;
      const t = tail.replace(/[:\s]/g, '');
      const multiAns = multiAnswerText(t);
      if (CIRCLED[t]) text = CIRCLED[t];
      else if (multiAns) text = multiAns;               // ③⑤ · ③, ⑤ · 3,5 → "35" (정답이 2개 이상)
      else if (/^\d{1,2}$/.test(t)) text = t;
      else if (t.length >= 2 && !/^[①-⑨]/.test(t)) written = true;          // 문장으로 된 정답 = 서술형 (①~⑤로 시작하면 보기 번호 + 설명이라 제외)
      found.push({ num: num, rect: [markerLeft - 4, top - 4, markerRight + 70, bottom + 4], text: text, written: written, top: top, bottom: bottom, x: markerLeft, mr: markerRight, numRect: numRect });
    }
    return found;
  }


  // ── "정답 및 해설" 같은 제목으로 해설 영역의 시작 쪽을 찾는다 ──
  // 문항 번호 옆 정답 표시가 전부 그림이라 "N) 정답" 패턴이 하나도 안 잡히는 PDF에서도,
  // 이 제목 한 줄만 찾으면 그 뒤 페이지 전체를 해설 영역으로 확정할 수 있다.
  const EXPL_HEADING_RE = /정답\s*(및|과|와)?\s*(해설|풀이)|해설\s*(및|과|와)?\s*정답|정답\s*표/;
  const CHAPTER_TAG_RE = /^\d{1,2}-\d{1,2}\.$/;   // 문항마다 되풀이되는 "1-1." 같은 챕터 라벨
  function findExplHeadingPage(pages) {
    for (let i = 0; i < pages.length; i++) {
      const pd = pages[i];
      for (const it of pd.items) {
        if (EXPL_HEADING_RE.test(it.str)) return i + 1;
      }
      // 제목이 두 조각으로 나뉘어 찍히는 경우 대비 (예: "정답" + "및 해설")
      for (let j = 0; j < pd.items.length - 1; j++) {
        const a = pd.items[j], b = pd.items[j + 1];
        if (Math.abs(a.top - b.top) < 6 && EXPL_HEADING_RE.test(a.str + b.str)) return i + 1;
      }
    }
    return null;
  }

  function clusterColumns(spans, minGap) {
    if (spans.length < 2) return [spans];
    const xs = spans.map(s => s.x).sort((a, b) => a - b);
    let maxGap = 0, before = xs[0];
    for (let i = 0; i < xs.length - 1; i++) {
      const g = xs[i + 1] - xs[i];
      if (g > maxGap) { maxGap = g; before = xs[i]; }
    }
    if (maxGap < (minGap || COLUMN_GAP_MIN)) return [spans];
    const split = before + maxGap / 2;
    const left = spans.filter(s => s.x < split), right = spans.filter(s => s.x >= split);
    if (!(left.length && right.length)) return [spans];
    // 한 쪽에 시험지 두 장을 나란히 넣은 PDF(2-up): 각 쪽 안에서 또 크게(100pt 이상) 벌어진 틈이 있으면 단을 더 나눈다
    const more = side => { const r = clusterColumns(side, 100); return r.length > 1 && r.every(c => c.length >= 2) ? r : [side]; };
    return more(left).concat(more(right));
  }

  // 문항 번호 모양("N.")이지만 진짜 문항이 아닌 것을 걸러낸다.
  //  ① 바로 옆에 "[정답]"·"해설"이 붙은 것 (해설 쪽의 번호)
  //  ② 같은 단에서 문항 번호 줄보다 안쪽으로 들어가 있는 것 ([실험 과정] 상자 속의 "1. 전원 장치를…" 같은 단계 번호)
  //  ③ 이미 나온 번호가 또 나온 것 (앞에서 이미 문항으로 잡은 번호는 한 번만)
  // 반환: 페이지 번호(0부터) → 문항으로 인정된 번호 목록(읽는 순서)
  function selectQuestionSpans(pages, qSize, skipPages) {
    const out = {}, seen = new Set();
    const tagNear = (pd, sp) => pd.items.some(it => it.x > sp.x + 1 && it.x < sp.x1 + 90 && Math.abs(it.top - sp.top) < 5 && /정답|해설/.test(it.str));
    pages.forEach((pd, idx) => {
      if (skipPages && skipPages.includes(idx + 1)) return;
      let spans = numberSpans(pd).filter(sp => Math.abs(sp.size - qSize) < 1.0 && !tagNear(pd, sp));
      if (!spans.length) { out[idx] = []; return; }
      const cols = clusterColumns(spans);
      const ordered = [];
      cols.forEach(cs => {
        const xmin = Math.min.apply(null, cs.map(sp => sp.x));
        cs.filter(sp => sp.x <= xmin + 8).sort((a, b) => a.top - b.top).forEach(sp => ordered.push(sp));
      });
      out[idx] = ordered.filter(sp => { if (seen.has(sp.num)) return false; seen.add(sp.num); return true; });
    });
    // 2차: 번호 글자 크기가 다른 문항 구출. 시험지를 여러 군데서 이어 붙이면 어떤 문항("18." "19." 등)은 번호 글자가 본문 크기라서
    // 위의 크기 조건에 걸러진다. 그러면 앞 문항에 통째로 붙어 버린다. 번호가 비는 자리(앞뒤 번호 사이)이고 단의 왼쪽 끝에 맞는 번호만 되살린다.
    try {
      const have = new Set(); Object.keys(out).forEach(k => out[k].forEach(sp => have.add(sp.num)));
      const maxN = have.size ? Math.max.apply(null, Array.from(have)) : 0;
      const missing = new Set(); for (let n = 1; n < maxN; n++) if (!have.has(n)) missing.add(n);
      if (missing.size) pages.forEach((pd, idx) => {
        if (skipPages && skipPages.includes(idx + 1) || !out[idx] || !out[idx].length) return;
        const base = out[idx], cols = clusterColumns(base.slice());
        const colX = cols.map(cs => Math.min.apply(null, cs.map(sp => sp.x)));
        const cand = numberSpans(pd).filter(sp => missing.has(sp.num) && !have.has(sp.num) && sp.size >= qSize * 0.6 && sp.size <= qSize * 1.5 && !tagNear(pd, sp) &&
          colX.some(x => Math.abs(sp.x - x) <= 8)).sort((a, b) => a.top - b.top);
        cand.forEach(sp => {
          if (have.has(sp.num)) return;
          const ci = colX.findIndex(x => Math.abs(sp.x - x) <= 8);
          const same = base.filter(b => Math.abs(b.x - colX[ci]) <= 8).sort((a, b) => a.top - b.top);
          let prev = null, next = null;
          same.forEach(b => { if (b.top < sp.top - 2) prev = b; else if (b.top > sp.top + 2 && !next) next = b; });
          if (prev && sp.num <= prev.num) return;
          if (next && sp.num >= next.num) return;
          if (prev && sp.num - prev.num > 3) return;
          base.push(sp); have.add(sp.num);
        });
        // 다시 읽는 순서(단 → 위에서 아래)로 정렬
        const colOf = sp => { const k = colX.findIndex(x => Math.abs(sp.x - x) <= 8); return k < 0 ? 9999 : colX[k]; };
        base.sort((a, b) => (colOf(a) - colOf(b)) || (a.top - b.top));
      });
    } catch (e) {}
    return out;
  }

  // ── 해설 구간: "N) 정답" 표시부터 다음 표시 전까지 (단이 바뀌면 이어지는 부분까지 붙인다) ──
  function computeExplanations(pages, answerPages, qSize) {
    const out = {};
    if (!answerPages.length) return out;
    const first = answerPages[0], last = answerPages[answerPages.length - 1];
    // 2단 편집인지: 정답 표시들의 x가 크게 갈리면 2단
    const allX = [];
    for (let p = first; p <= last; p++) (pages[p - 1].markers || []).forEach(m => allX.push(m.x));
    if (!allX.length) return out;
    const two = Math.max.apply(null, allX) - Math.min.apply(null, allX) > 40;
    const W = pages[first - 1].W;
    const half = W / 2;
    const leftXs = allX.filter(x => !two || x < half), rightXs = allX.filter(x => two && x >= half);
    const leftX0 = Math.min.apply(null, leftXs) - 12;
    const rightX0 = two ? Math.min.apply(null, rightXs) - 12 : W;
    const colDefs = two ? [[leftX0, rightX0 - 4], [rightX0, W - leftX0]] : [[leftX0, W - leftX0]];

    let lastNum = null;
    for (let p = first; p <= last; p++) {
      const pd = pages[p - 1];
      const contentTop = pd.H * 0.096;
      colDefs.forEach((cd, ci) => {
        const inCol = it => (!two) || (ci === 0 ? it.x < half : it.x >= half);
        const ms = (pd.markers || []).filter(m => inCol({ x: m.x })).sort((a, b) => a.top - b.top);
        const body = pd.items.filter(it => inCol(it) && it.top >= contentTop && it.top < pd.H - 62);
        // 이어지는 부분: 이 단의 첫 표시 위쪽
        const firstTop = ms.length ? ms[0].top - 4 : pd.H - 62;
        if (lastNum !== null && firstTop - contentTop > 10 && body.some(it => it.top < firstTop)) {
          // 이어지는 해설의 첫 줄에 분수·수식처럼 키가 큰 글자가 있으면, 그 윗부분이 contentTop(쪽 높이의 9.6%) 위로 올라가 있어서 잘렸다 → 걸쳐 있는 글자만큼 위로 넓힌다 (쪽 머리글 높이 7%보다는 올라가지 않는다)
          const hi = pd.items.filter(it => inCol(it) && it.bottom > pd.H * 0.07 && it.top < contentTop);
          const segTop = hi.length ? Math.max(pd.H * 0.07, Math.min.apply(null, hi.map(it => it.top)) - 4) : contentTop;
          out[lastNum].segments.push({ page: p, rect: [cd[0], segTop, cd[1], firstTop] });
        }
        ms.forEach((m, i) => {
          let bottom;
          if (i + 1 < ms.length) bottom = ms[i + 1].top - 6;
          else {
            // 이 단의 마지막 문항: 다음 표시가 없어서 어디까지가 이 해설인지 글자만으론 알기 어렵다.
            // 해설 문단이 그림(글자로 안 읽히는 폰트)으로 되어 있으면 body에 아무것도 안 잡히는데,
            // 그렇다고 상자를 작게 잡으면 실제 해설이 통째로 잘려나간다.
            // → 글자를 못 찾으면 "너무 작게"보다는 "이 칸의 바닥까지"로 넉넉하게 잡는다(빈 여백이 좀 남는 게,
            //   해설이 잘리는 것보다 낫다).
            // 표시 자기 자신과 "해설" 배지 글자는 상자 아래쪽 경계로 치지 않는다 — 마커 자신의
            // 줄(예: "13.")이 자기보다 낮은 텍스트가 없다는 이유로 스스로를 경계로 써버리는 것과,
            // 그 밑의(글자로 안 읽히는) 해설 문단을 "해설" 배지 위치에서 멈춰버리는 것을 막는다.
            const lows = body
              .filter(it => it.top > m.bottom && it.str.trim() !== '해설' &&
                (!qSize || it.size >= qSize * 0.65) && !CHAPTER_TAG_RE.test(it.str.trim()))
              .map(it => it.bottom);
            bottom = (lows.length ? Math.max.apply(null, lows) : pd.H - 62) + 6;
            const fcap = footerCap(pd, cd[0], cd[1], m.top);
            { const ib = lowestImageBottom(pd, cd[0], cd[1], m.top, fcap, bottom - 6); if (ib + 6 > bottom) bottom = ib + 6; }   // 해설 밑의 그림·상자도 포함
            if (!lows.length) bottom = Math.min(bottom, fcap);
          }
          if (!out[m.num]) out[m.num] = { segments: [], numRect: m.numRect };
          out[m.num].segments.push({ page: p, rect: [cd[0], m.top - 4, cd[1], bottom] });
        });
        if (ms.length) lastNum = ms[ms.length - 1].num;
      });
    }
    return out;
  }

  // ── PDF 전체 스캔 ──
  // 쪽 안에 붙어 있는 「정답표」(문항 정답 | 문항 정답 …) 자리를 찾는다 — 마지막 문제 그림에 같이 잘려 들어가지 않게 한다. 없으면 null
  async function detectAnswerTable(doc, p, pd) {
    try {
      // (1) 글자로 된 표: 머리글 「문항」「정답」과 그 밑의 숫자 줄들
      const norm = it => String(it.str).replace(/\s+/g, '');
      const hs = pd.items.filter(it => /^(문항|번호|문번)$/.test(norm(it)));
      const as = pd.items.filter(it => /^정답$/.test(norm(it)));
      const pr = hs.filter(h => as.some(a => Math.abs(a.top - h.top) < 6 && a.x > h.x));
      if (pr.length) {
        const top = Math.min.apply(null, pr.map(h => h.top)) - 5;
        const lastA = as.filter(a => pr.some(h => Math.abs(a.top - h.top) < 6));
        const x0 = Math.min.apply(null, pr.map(h => h.x)) - 14, x1 = Math.max.apply(null, lastA.map(a => a.x + (a.w || 20))) + 60;
        const nums = pd.items.filter(it => it.top > top && it.x >= x0 && it.x <= x1 && /^[\d,，]{1,5}$/.test(norm(it)));
        if (nums.length >= 10) return [x0, top, x1, Math.max.apply(null, nums.map(it => it.bottom)) + 6];
      }
      // (2) 그림으로 된 표: 쪽 아래쪽의 큰 그림 중 가로·세로 줄이 많은 것
      for (const r of (pd.imgs || [])) {
        if (r[4]) continue;
        const w = r[2] - r[0], h = r[3] - r[1];
        if (w < 100 || h < 100 || w > pd.W * 0.7 || r[3] < pd.H * 0.4) continue;
        const c = await renderRect(doc, p, r, 1.6, false);
        const M = _inkMap(c);
        let hl = 0, prev = false;
        for (let y = 0; y < M.h; y++) { let n = 0; for (let x = 0; x < M.w; x++) n += M.ink[y * M.w + x]; const on = n / M.w >= 0.7; if (on && !prev) hl++; prev = on; }
        let vl = 0; prev = false;
        for (let x = 0; x < M.w; x++) { let n = 0; for (let y = 0; y < M.h; y++) n += M.ink[y * M.w + x]; const on = n / M.h >= 0.7; if (on && !prev) vl++; prev = on; }
        if (hl >= 8 && vl >= 3) return [r[0] - 3, r[1] - 3, r[2] + 3, r[3] + 3];
      }
    } catch (e) {}
    return null;
  }
  async function scanPdf(doc, onProgress) {
    const n = doc.numPages;
    const pages = [];
    for (let p = 1; p <= n; p++) {
      pages.push(await pageItems(doc, p, true));
      pages[p - 1].tableRect = await detectAnswerTable(doc, p, pages[p - 1]);
      if (onProgress) onProgress(p, n);
    }

    // 1) 문항 번호 글자 크기 = "서로 다른 번호가 가장 많이 나오는 크기 중 가장 큰 것"
    const groups = {};
    pages.forEach((pd, idx) => {
      const markerNums = new Set(answerMarkers(pd).map(a => a.num));
      pages[idx].markers = answerMarkers(pd);
      for (const s of numberSpans(pd)) {
        (groups[s.size] = groups[s.size] || new Set()).add(s.num);
      }
    });
    let maxDistinct = 0;
    Object.values(groups).forEach(set => { if (set.size > maxDistinct) maxDistinct = set.size; });
    let qSize = null;
    Object.keys(groups).map(Number).sort((a, b) => b - a).forEach(sz => {
      if (qSize === null && groups[sz].size >= Math.max(2, maxDistinct * 0.8)) qSize = sz;
    });

    // 1.5) "정답 및 해설" 같은 제목이 있으면, 정답 표시를 글자로 못 읽더라도
    //      그 뒤 페이지 전체는 해설 영역으로 확정하고, 문항 번호와 같은 크기의 "N." 표시를
    //      (곁에 "정답"이라는 글자가 없어도) 해설 시작 표시로 대신 사용한다.
    const explHeadingPage = findExplHeadingPage(pages);
    if (explHeadingPage !== null) {
      for (let idx = explHeadingPage - 1; idx < pages.length; idx++) {
        const pd = pages[idx];
        if (pd.markers.length || qSize === null) continue;   // 이미 글자로 읽혔으면 그대로 둔다
        pd.markers = numberSpans(pd)
          .filter(s => Math.abs(s.size - qSize) < 1.0)
          .map(s => ({
            num: s.num, x: s.x, top: s.top, bottom: s.bottom, base: s.bottom,
            rect: [s.x - 4, s.top - 4, s.x1 + 70, s.bottom + 4],
            text: '', written: false, mr: s.x1, numRect: [s.x - 1, s.top - 1, s.x1 + 2, s.bottom + 1],
          }));
      }
    }

    // 2) 정답 표시(페이지별)
    const answers = {};
    const answerPages = [];
    pages.forEach((pd, idx) => {
      if (pd.markers.length) answerPages.push(idx + 1);
      pd.markers.forEach(m => {
        if (!answers[m.num]) answers[m.num] = { page: idx + 1, rect: m.rect, text: m.text, written: !!m.written, mr: m.mr, mtop: m.top, mbottom: m.bottom };
      });
    });

    // 3) 문항 위치 계산
    const acceptedSpans = qSize === null ? {} : selectQuestionSpans(pages, qSize, answerPages);
    const questions = [];
    const questionPages = [];
    const allHeads = [];               // 쪽 안의 공통 지문 머리글 "[26~27]" 의 숫자 자리 (문제은행 번호가 새로 붙을 때 머리글 번호도 같이 바꿔 쓰려고)
    const lastQ = {}, conts = [];      // 단별 맨 아래 문항 / 단 맨 위에서 앞 단 문항의 그림·보기·선택지가 이어지는 부분
    const pendingPre = [];             // 단 맨 아래에 있는 "[선택형 11-13]" 공통 지문 → 다음 단(없으면 다음 쪽)의 첫 문항 앞에 붙인다
    const firstQ = {};                 // firstQ[쪽 idx][단 번호] = 그 단의 첫 문항
    // 문서 전체가 2단 편집인데 어떤 쪽에는 한 단에만 문항이 있을 때(예: 마지막 쪽에 25번 하나)에도 2단 기준으로 자르기 위해, 2단인 쪽들에서 단 위치를 미리 구한다
    let docSplit = null;
    {
      const two = [];
      pages.forEach((pd, idx) => {
        if (answerPages.includes(idx + 1)) return;
        const sp = (acceptedSpans[idx] || []);
        if (sp.length < 2) return;
        const cs = clusterColumns(sp);
        if (cs.length === 2) two.push({ sx: Math.min.apply(null, cs[1].map(x => x.x)) - 8, l0: Math.min.apply(null, cs[0].map(x => x.x)) - 6, r0: Math.min.apply(null, cs[1].map(x => x.x)) - 6 });
      });
      const nq = (acceptedSpans && Object.keys(acceptedSpans).filter(k => (acceptedSpans[k] || []).length).length) || 0;
      if (two.length >= 1 && two.length >= nq * 0.5) {
        const med = k => { const a = two.map(t => t[k]).sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
        docSplit = { sx: med('sx'), l0: med('l0'), r0: med('r0') };
      }
    }
    pages.forEach((pd, idx) => {
      if (answerPages.includes(idx + 1) || qSize === null) return;
      const spans = (acceptedSpans[idx] || []).slice();
      if (!spans.length) return;
      questionPages.push(idx + 1);
      const contentTop = Math.min.apply(null, spans.map(s => s.top)) - 3;
      const body = pd.items.filter(it => it.top >= contentTop && it.top < pd.H - 62);
      const cols = clusterColumns(spans);
      let splitX = null, side = cols.map((_, i) => i), single2 = false;
      if (cols.length === 2) {
        splitX = Math.min.apply(null, cols[1].map(s => s.x)) - 8;          // 단 경계 = 오른쪽 단 문항 번호 바로 왼쪽 (번호들의 가운데가 아니다 — 왼쪽 단의 본문은 가운데를 넘어 오른쪽까지 온다)
      } else if (docSplit) {
        const mx = Math.min.apply(null, spans.map(s => s.x));
        if (Math.abs(mx - docSplit.l0 - 6) < 14 || Math.abs(mx - docSplit.r0 - 6) < 14) {
          splitX = docSplit.sx; side = [Math.abs(mx - docSplit.l0 - 6) < Math.abs(mx - docSplit.r0 - 6) ? 0 : 1]; single2 = true;
        }
      }
      const nColsPage = single2 ? 2 : cols.length;
      const colX0 = cols.map(cs => Math.min.apply(null, cs.map(s => s.x)) - 6);
      const leftMargin = single2 ? docSplit.l0 : Math.min.apply(null, colX0);
      cols.forEach((colSpans, ci0) => {
        const ci = side[ci0];
        colSpans.sort((a, b) => a.top - b.top);
        // 단이 3개 이상(한 쪽에 시험지 두 장): 각 단의 번호 위치부터 다음 단 번호 직전까지가 그 단이다
        const mcLo = cols.length > 2 ? (ci0 === 0 ? -1e9 : colX0[ci0] - 2) : null, mcHi = cols.length > 2 ? (ci0 + 1 < cols.length ? colX0[ci0 + 1] - 2 : 1e9) : null;
        const inCol = it => cols.length > 2 ? (it.x >= mcLo && it.x < mcHi) : (splitX === null || (ci === 0 ? it.x < splitX : it.x >= splitX));
        const colItems = body.filter(inCol);
        // 왼쪽 경계 = 각 단의 문항 번호 위치 (그림/표 안 글자에 흔들리지 않게)
        const x0 = colX0[ci0];
        // 오른쪽 경계 = 다음 단 시작 직전, 마지막 단은 좌우 여백이 같다고 보고 페이지 폭에서 계산
        const measured = Math.max.apply(null, colItems.map(it => it.x + it.w).concat(colSpans.map(s => s.x1))) + 6;
        const x1 = single2 ? (ci === 0 ? docSplit.r0 - 4 : Math.max(measured, pd.W - leftMargin)) : (ci0 + 1 < cols.length ? colX0[ci0 + 1] - 4 : Math.max(measured, pd.W - leftMargin));
        // "[선택형 11-13]" 같은 공통 지문 머리글: 이 줄부터 다음 문항 번호까지는 그 문항들이 함께 쓰는 지문·그림이라서 다음 문항 그림에 넣는다
        const colAll = pd.items.filter(it => it.top >= pd.H * 0.085 && it.top < pd.H - 62 && inCol(it));
        const colAllH = pd.items.filter(it => it.top >= pd.H * 0.035 && it.top < pd.H - 62 && inCol(it));   // 머리글은 쪽 맨 위 가까이에도 있다
        const heads = findGroupHeads(colAllH).filter(h => h.x > x0 - 14 && h.x < x0 + 34);
        heads.forEach(h => { if (h.digits && !allHeads.some(o => o.page === idx + 1 && Math.abs(o.digits[1] - h.digits[1]) < 2 && Math.abs(o.digits[0] - h.digits[0]) < 2)) allHeads.push({ page: idx + 1, digits: h.digits, a: h.a, b: h.b }); });
        const headTop = colSpans.map((sp, i) => {
          const lo = i > 0 ? colSpans[i - 1].bottom : pd.H * 0.03;
          const hs = heads.filter(h => h.top < sp.top - 6 && h.top > lo + 2);
          return hs.length ? Math.max(0, hs[0].top - 3) : null;
        });
        // 단 맨 위, 첫 문항 번호보다 위에 글자·그림이 있으면 앞 단 마지막 문항이 이어지는 부분이다
        // (문제 글은 왼쪽 단 맨 아래, 그래프·<보기>·선택지는 오른쪽 단 맨 위에 있는 시험지)
        if (headTop[0] === null) {
          const first = colSpans[0], rb = first.top - TOP_PAD - 1, jkc = junkItems(colAll);
          const els = [];
          colAllH.forEach(it => { if (it.top < rb && it.bottom <= rb + 3 && it.size >= qSize * 0.85 && it.size <= qSize * 1.25 && String(it.str).trim() && !jkc.has(it) && it.x >= x0 - 14) els.push({ top: it.top, bottom: it.bottom, str: String(it.str) }); });
          (pd.imgs || []).forEach(r => { const w = r[2] - r[0], h = r[3] - r[1]; if (!r[4] && w >= 6 && h >= 6 && r[3] <= rb + 2 && r[1] >= pd.H * 0.03 && r[0] < x1 - 4 && r[2] > x0 + 4 && w <= (x1 - x0) * 1.3) els.push({ top: r[1], bottom: r[3], img: true }); });
          els.sort((a, b) => b.bottom - a.bottom);
          let cur = rb, ctop = null, cbot = null; const chain = [];
          for (const e of els) { if (e.bottom >= cur - (chain.length ? 45 : 130)) { chain.push(e); cur = Math.min(cur, e.top); ctop = cur; if (cbot === null) cbot = e.bottom; } else break; }
          if (chain.length && ctop !== null && chain.some(e => /[①②③④⑤]/.test(e.str || ''))) {
            conts.push({ idx: idx, ci: ci, rect: [Math.max(0, x0), Math.max(0, ctop - 3), Math.min(pd.W, x1), Math.min(rb, cbot + BOTTOM_PAD)] });
          }
        }
        colSpans.forEach((s, i) => {
          // 위쪽 여유(TOP_PAD) 안에 앞 문항의 마지막 줄이 걸치면, 그 줄이 반쯤 잘려서 보이므로
          // 그 줄 바로 아래에서 자른다 (앞 문항 쪽에는 그 줄이 온전히 들어 있다)
          const above = colItems.filter(it => it.top < s.top - 1 && it.bottom <= s.top + 3 && it.bottom > s.top - TOP_PAD - 2);
          const prevBottom = above.length ? Math.max.apply(null, above.map(it => it.bottom)) : -1;
          let top = Math.max(0, Math.min(s.top - 0.5, Math.max(s.top - TOP_PAD, prevBottom + 0.5)));
          if (headTop[i] !== null) top = Math.min(top, headTop[i]);
          let bottom;
          if (i + 1 < colSpans.length) bottom = (headTop[i + 1] !== null ? headTop[i + 1] - 1 : colSpans[i + 1].top - TOP_PAD - 1);
          if (i + 1 < colSpans.length && headTop[i + 1] === null) {
            // 다음 문항 번호 바로 위 여유(TOP_PAD) 안에 이 문항의 마지막 줄이 걸치면, 그 줄이 반쯤 잘리니 그 줄 끝까지 포함한다
            // (다음 문항은 같은 줄 아래에서부터 시작하므로 겹치지 않는다)
            const ns = colSpans[i + 1], jkAb = junkItems(colItems);
            const ab = colItems.filter(it => it.top >= s.top && it.top < bottom - 2 && it.bottom > bottom && it.bottom <= ns.top + 3 && it.size >= qSize * 0.85 && it.size <= qSize * 1.25 && !CHAPTER_TAG_RE.test(String(it.str).trim()) && !jkAb.has(it) && String(it.str).trim());
            if (ab.length) { const pb = Math.max.apply(null, ab.map(it => it.bottom)); if (pb + 0.5 > bottom) bottom = pb + 0.5; }
          }
          else if (i + 1 >= colSpans.length) {
            // 이 단의 마지막 문항: 문항 번호 자기 자신의 줄은 "그 밑에 내용이 있다"는 근거로 못 쓴다
            // (자기 자신만 잡히면 문항이 통째로 잘린다 — 특히 본문이 그림/이미지 형태라 글자로
            //  안 읽히는 경우 이 문제가 생긴다).
            // 챕터 라벨("1-1.")이나 그보다 확연히 작은 글자(난이도 배지 등)는 바닥 경계로 안 쓴다 —
            // 이런 게 문항 바로 밑 여백에 살짝 걸리면, 진짜 내용이 있는 훨씬 아래쪽 대신 그 배지
            // 위치에서 문항이 끊겨버린다.
            const jk = junkItems(colItems);
            // 쪽 번호 줄("7 / 7")부터 아래는 꼬리말이다 — 문제 그림에 넣지 않는다
            const pn = pd.items.filter(it => it.top > pd.H * 0.5 && it.x > pd.W * 0.4 && (/^\d{1,2}\s*\/\s*\d{1,2}$/.test(it.str) || (it.str === '/' && pd.items.some(o => /^\d{1,2}$/.test(o.str) && Math.abs(o.top - it.top) < 3 && o.x < it.x && it.x - (o.x + o.w) < 8) && pd.items.some(o => /^\d{1,2}$/.test(o.str) && Math.abs(o.top - it.top) < 3 && o.x > it.x && o.x - (it.x + it.w) < 8))));
            const footTop = pn.length ? Math.min.apply(null, pn.map(it => it.top)) : null;
            const tailHead = heads.find(h => h.top > s.top + 8);          // 이 단 맨 아래에 다음 문항들의 공통 지문이 시작되나?
            const lows = colItems
              .filter(it => it.top > s.bottom && it.size >= qSize * 0.65 && !CHAPTER_TAG_RE.test(it.str.trim()) && !jk.has(it) && (footTop === null || it.top < footTop - 3) && (!tailHead || it.top < tailHead.top - 2) && !(pd.tableRect && it.x >= pd.tableRect[0] - 2 && it.x <= pd.tableRect[2] && it.top >= pd.tableRect[1] - 2 && it.top <= pd.tableRect[3]))
              .map(it => it.bottom);
            bottom = tailHead ? (lows.length ? Math.max.apply(null, lows) : tailHead.top - 4) : (lows.length ? Math.max.apply(null, lows) : pd.H - 62);
            const fcap = footTop === null ? footerCap(pd, x0, x1, s.top) : Math.min(footerCap(pd, x0, x1, s.top), footTop - 3);
            if (!tailHead) { const ib = lowestImageBottom(pd, x0, x1, s.top, fcap, bottom); if (ib > bottom) bottom = ib; }   // 글자 밑의 그림·그래프도 포함
            if (!tailHead && !lows.length) bottom = Math.min(bottom, fcap);
            if (tailHead) {
              const tl = colAll.filter(it => it.top >= tailHead.top - 1 && it.size >= qSize * 0.5 && !jk.has(it) && String(it.str).trim());
              const tb = Math.max(tl.length ? Math.max.apply(null, tl.map(it => it.bottom)) : tailHead.bottom, pd.H - 72);     // 그림은 글자로 안 읽히니 단 바닥까지 넉넉히 (남는 빈 여백은 나중에 잘린다)
              pendingPre.push({ idx: idx, ci: ci, ncols: nColsPage, rect: [Math.max(0, x0), Math.max(0, tailHead.top - 3), Math.min(pd.W, x1), tb + BOTTOM_PAD], page: idx + 1 });
            }
          }
          { const tr = pd.tableRect; if (tr && i + 1 >= colSpans.length && tr[1] > s.top + 20 && x0 < tr[2] && x1 > tr[0] && bottom + BOTTOM_PAD > tr[1] - 1) bottom = Math.max(s.bottom + 4, tr[1] - 2 - BOTTOM_PAD); }   // 정답표 위에서 자른다
          const padB = (i + 1 < colSpans.length && headTop[i + 1] !== null) ? 0 : BOTTOM_PAD;      // 다음이 공통 지문 머리글이면 그 글자 윗부분까지 걸치지 않게 여유를 두지 않는다
          const qObj = { page: idx + 1, num: s.num, rect: [Math.max(0, x0), top, Math.min(pd.W, x1), bottom + padB], numRect: [s.x, s.top, s.x1, s.bottom] };
          if (i === 0) (firstQ[idx] = firstQ[idx] || {})[ci] = qObj;
          questions.push(qObj);
          (lastQ[idx] = lastQ[idx] || {})[ci] = qObj;
        });
      });
    });
    questions.sort((a, b) => a.page - b.page || a.rect[0] - b.rect[0] || a.rect[1] - b.rect[1]);

    // 3.4) 앞 단 마지막 문항에 이어지는 부분(그래프·보기·선택지)을 그 문항에 붙인다 — 앞 문항에 선택지가 이미 있거나 공통 지문이 이어지는 단이면 붙이지 않는다
    conts.forEach(ct => {
      let tIdx = ct.idx, tCi = ct.ci - 1;
      if (tCi < 0) { tIdx = ct.idx - 1; const lc = lastQ[tIdx] ? Object.keys(lastQ[tIdx]).map(Number) : []; tCi = lc.length ? Math.max.apply(null, lc) : -1; }
      const tq = lastQ[tIdx] && lastQ[tIdx][tCi];
      if (!tq) return;
      if (pendingPre.some(pc => pc.idx === tIdx && pc.ci === tCi)) return;
      const pg = pages[tIdx];
      const hasChoice = pg && pg.items.some(it => it.top >= tq.rect[1] && it.bottom <= tq.rect[3] + 2 && it.x >= tq.rect[0] - 2 && it.x <= tq.rect[2] && /[①②③④⑤]/.test(String(it.str)));
      if (hasChoice) return;
      tq.extra = (tq.extra || []).concat([{ page: ct.idx + 1, rect: ct.rect }]);
    });

    // 3.5) 단 맨 아래의 공통 지문은 다음 단(없으면 다음 쪽 첫 단)의 첫 문항 그림 위에 붙인다
    pendingPre.forEach(pc => {
      let tIdx = pc.idx, tCi = pc.ci + 1;
      if (tCi >= pc.ncols) { tIdx = pc.idx + 1; tCi = 0; }
      const q = firstQ[tIdx] && (firstQ[tIdx][tCi] || (tCi === 0 ? firstQ[tIdx][1] : null));
      // 공통 지문 범위 안에 다른 문항 번호가 들어 있거나, 이미 어떤 문항 그림이 그 머리글부터 시작하면
      // (= 같은 단에서 지문을 이미 포함) 따로 또 붙이면 같은 문제가 한 번 더 나오고 정답 표시도 빠진다
      const dup = questions.some(o => o !== q && o.page === pc.page && o.rect[0] < pc.rect[2] && o.rect[2] > pc.rect[0] &&
        ((o.numRect[1] > pc.rect[1] + 4 && o.numRect[3] < pc.rect[3]) || (o.rect[1] <= pc.rect[1] + 6 && o.rect[3] > pc.rect[1] + 20)));
      if (dup) return;
      if (q) q.pre = (q.pre || []).concat([{ page: pc.page, rect: pc.rect }]);
    });

    // 3.6) 각 문항 그림 안에 들어 있는 공통 지문 머리글 번호의 자리
    questions.forEach(q => {
      const rs = [{ page: q.page, rect: q.rect }].concat((q.pre || []), (q.extra || []));
      const marks = [];
      allHeads.forEach(h => { if (rs.some(r => r.page === h.page && h.digits[0] >= r.rect[0] - 2 && h.digits[2] <= r.rect[2] + 2 && h.digits[1] >= r.rect[1] - 2 && h.digits[3] <= r.rect[3] + 2)) marks.push({ page: h.page, r: h.digits, a: h.a, b: h.b }); });
      if (marks.length) q.headMarks = marks;
    });

    // 4) 추정 문항 수 = 가장 큰 문항 번호
    const questionCount = questions.reduce((m, q) => Math.max(m, q.num), 0);
    const explanations = computeExplanations(pages, answerPages, qSize);
    return { pageCount: n, questions: questions, answers: answers, explanations: explanations, questionPages: questionPages, answerPages: answerPages, questionCount: questionCount, tableRects: pages.map(pd => pd.tableRect || null) };
  }

  // 문제지 뒤에 정답지를 붙여 만든 PDF: 붙인 쪽(뒤에서 n쪽)에서 잡힌 "문항"은 정답표 속 번호라서 문항에서 빼고, 그 쪽들을 정답 쪽으로 돌린다
  function markAppendedAnswerPages(scan, appended) {
    if (!scan || !(appended > 0)) return scan;
    const first = scan.pageCount - appended + 1;
    scan.questions = scan.questions.filter(q => q.page < first);
    scan.questionPages = scan.questionPages.filter(p => p < first);
    scan.questionCount = scan.questions.reduce((m, q) => Math.max(m, q.num), 0);
    const ps = (scan.answerPages || []).slice();
    for (let p = first; p <= scan.pageCount; p++) if (ps.indexOf(p) < 0) ps.push(p);
    scan.answerPages = ps.sort((a, b) => a - b);
    return scan;
  }

  // "[선택형 11-13]"·"[서술형 1-2]" 처럼 여러 문항이 같이 쓰는 지문의 머리글 줄을 찾는다 (줄 맨 앞에서 시작하는 것만)
  const GROUP_HEAD_RE = /^[※\*★☆◆◇■□●○▶▷☞◎]*[\[［〔【]\s*(?:선택형|서술형|서답형|논술형|객관식|주관식)?\s*\d{1,2}\s*[-~∼–～]\s*\d{1,2}\s*(?:번)?\s*[\]］〕】]/;
  function findGroupHeads(items) {
    const sorted = items.filter(it => String(it.str).trim()).slice().sort((a, b) => a.top - b.top || a.x - b.x);
    const lines = [];
    sorted.forEach(it => { const ln = lines.find(l => Math.abs(l.top - it.top) < Math.max(3, (it.bottom - it.top) * 0.5)); if (ln) ln.items.push(it); else lines.push({ top: it.top, items: [it] }); });
    const out = [];
    lines.forEach(ln => {
      ln.items.sort((a, b) => a.x - b.x);
      const t = ln.items.map(i => i.str).join('').replace(/\s+/g, '');
      if (GROUP_HEAD_RE.test(t)) {
        const h = { top: Math.min.apply(null, ln.items.map(i => i.top)), bottom: Math.max.apply(null, ln.items.map(i => i.bottom)), x: ln.items[0].x, text: t };
        try {   // "[26~27]" 안의 숫자 부분(26~27)의 자리 — 글자 폭 비율로 어림한다
          const chars = [];
          ln.items.forEach(it => {
            const cs = Array.from(String(it.str)).filter(c => /\S/.test(c)); if (!cs.length) return;
            const wt = cs.map(c => /\d/.test(c) ? 0.55 : /[~∼～]/.test(c) ? 0.8 : /[-–]/.test(c) ? 0.35 : /[\[\]［］〔〕【】]/.test(c) ? 0.4 : /[A-Za-z]/.test(c) ? 0.55 : 1);
            const tw = wt.reduce((u, v) => u + v, 0); let acc = 0;
            cs.forEach((c, k) => { chars.push({ c: c, x0: it.x + it.w * acc / tw, x1: it.x + it.w * (acc + wt[k]) / tw }); acc += wt[k]; });
          });
          const flat = chars.map(o => o.c).join(''), m1 = GROUP_HEAD_RE.exec(flat), m2 = /(\d{1,2})[-~∼–～](\d{1,2})/.exec(m1[0]);
          if (m2) {
            const i0 = m2.index, i1 = m2.index + m2[0].length - 1;
            h.digits = [chars[i0].x0 + 0.5, h.top, chars[i1].x1 - 0.5, h.bottom]; h.a = parseInt(m2[1], 10); h.b = parseInt(m2[2], 10);
          }
        } catch (e) {}
        out.push(h);
      }
    });
    return out.sort((a, b) => a.top - b.top);
  }

  // ── 영역 이미지로 자르기 ──
  function createCanvas(w, h) {
    if (root.BankCore && root.BankCore._createCanvas) return root.BankCore._createCanvas(w, h);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  // "다음 장에 계속"·"뒷면에 계속"·"끝" 같은 안내 문구: 문제 그림에 들어가지 않게 지운다
  const JUNK_RE = /다음\s*(장|쪽|페이지)\s*(에|으로)?\s*계속|뒷\s*면\s*(에|으로)?\s*계속|뒤\s*쪽\s*(에|으로)?\s*계속|앞\s*면\s*에서\s*계속|^\s*[-–—\s]*[\[(<]?\s*끝\s*[\])>]?\s*[-–—\s]*$/;
  const JUNK_COMPACT_RE = /([<〈《\[(‹]?(다음(장|쪽|페이지)(에|으로)?계속|뒷면(에|으로)?계속|뒤쪽(에|으로)?계속|앞면에서계속)[>〉》\])›]?|^[-–—\[(<]*끝\.?[\])>–—-]*$|이?시험문제의저작권은.*|본?시험문제의저작권.*|수고하셨습니다.*|[＊*]?확인사항|[○◦•]?답안지의해당란.*|했는지확인하시오\.?)/;
  // 글자 조각이 "뒷면에" + "계속"처럼 나뉘어 있어도 찾을 수 있게, 같은 줄의 글자 조각을 이어붙여서 검사한다.
  // 반환: 안내 문구에 해당하는 글자 조각들의 집합(Set)
  function junkItems(items) {
    const out = new Set();
    const sorted = items.filter(it => it && String(it.str).trim()).slice().sort((a, b) => a.top - b.top || a.x - b.x);
    const lines = [];
    sorted.forEach(it => {
      const ln = lines.find(l => Math.abs(l.top - it.top) < Math.max(3, (it.bottom - it.top) * 0.5));
      if (ln) ln.items.push(it); else lines.push({ top: it.top, items: [it] });
    });
    lines.forEach(ln => {
      ln.items.sort((a, b) => a.x - b.x);
      // 가로로 크게 떨어진 조각(다른 칸의 글자)은 따로 묶는다
      const groups = []; let g = null;
      ln.items.forEach(it => {
        if (g && it.x - g.right < 14) { g.items.push(it); g.right = Math.max(g.right, it.x + it.w); }
        else { g = { items: [it], right: it.x + it.w }; groups.push(g); }
      });
      groups.forEach(gr => {
        let str = '', map = [];
        gr.items.forEach(it => { const t = String(it.str).replace(/\s+/g, ''); for (let k = 0; k < t.length; k++) map.push(it); str += t; });
        const m = JUNK_COMPACT_RE.exec(str);
        if (!m) return;
        if (m[0].length < str.length - 6) return;        // 문장 속에 우연히 든 것은 건드리지 않는다 (안내 문구는 거의 혼자 한 줄)
        for (let k = m.index; k < m.index + m[0].length; k++) out.add(map[k]);
        // "<" ">"가 따로 떨어진 글자 조각이면 같이 지운다
        const xs = Array.from(out).filter(it => gr.items.indexOf(it) >= 0).map(it => it.x), xe = Array.from(out).filter(it => gr.items.indexOf(it) >= 0).map(it => it.x + it.w);
        const lo = Math.min.apply(null, xs) - 40, hi = Math.max.apply(null, xe) + 40;
        ln.items.forEach(it => { if (/^[<>〈〉《》‹›\[\]()]$/.test(String(it.str).trim()) && it.x >= lo && it.x <= hi) out.add(it); });
      });
    });
    return out;
  }
  // 문제집의 장식(주황색 "빈출★" 배지·위쪽 주황 줄)은 문제 내용이 아니라서, 그림 위·아래 가장자리에 걸친 주황색 부분은 지운다
  function eraseOrangeEdges(canvas, scale) {
    const w = canvas.width, h = canvas.height, strip = Math.min(Math.round(34 * scale), Math.floor(h / 3));
    if (w < 40 || h < 40) return;
    const ctx = canvas.getContext('2d');
    [[0, strip], [h - strip, h]].forEach(r => {
      const img = ctx.getImageData(0, r[0], w, r[1] - r[0]), d = img.data; let hit = 0;
      const isOr = i => { const R = d[i], G = d[i + 1], B = d[i + 2]; return R > 150 && R - B > 22 && R >= G && G >= B - 8 && !(R > 240 && G > 240 && B > 225); };
      for (let i = 0; i < d.length; i += 4) if (isOr(i)) hit++;
      if (!hit || hit > d.length / 4 * 0.08) return;                 // 주황색이 넓게 퍼져 있으면 장식이 아니라 그림(사진)이다
      for (let i = 0; i < d.length; i += 4) if (isOr(i)) { d[i] = d[i + 1] = d[i + 2] = 255; }
      ctx.putImageData(img, 0, r[0]);
    });
  }
  // 같은 쪽 자료(pd)에서 문항마다 똑같이 다시 계산하던 것(출처 표시·쓸모없는 글자 찾기)을 한 번만 계산해 둔다
  const _memoMap = new WeakMap();
  function _memo(obj, key, fn) { let m = _memoMap.get(obj); if (!m) { m = {}; _memoMap.set(obj, m); } if (!(key in m)) m[key] = fn(); return m[key]; }
  const _pageCache = [];       // 최근에 통째로 그린 쪽 (메모리를 아끼려고 3개까지만)
  function _pageBitmap(doc, page, pageNum, scale) {
    for (const e of _pageCache) if (e.doc === doc && e.p === pageNum && e.s === scale) return e.promise;
    const vp = page.getViewport({ scale: scale });
    if (vp.width * vp.height > 40e6) return Promise.resolve(null);
    const c = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height)), cx = c.getContext('2d');
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height);
    const promise = page.render({ canvasContext: cx, viewport: vp, canvas: c }).promise.then(() => c);
    _pageCache.push({ doc: doc, p: pageNum, s: scale, promise: promise });
    while (_pageCache.length > 3) _pageCache.shift();
    promise.catch(() => { const i = _pageCache.findIndex(e => e.promise === promise); if (i >= 0) _pageCache.splice(i, 1); });
    return promise;
  }
  async function renderRect(doc, pageNum, rect, scale, trimBottom) {
    const page = await doc.getPage(pageNum);
    const x0 = rect[0], y0 = rect[1], w = Math.max(4, rect[2] - rect[0]), h = Math.max(4, rect[3] - rect[1]);
    const canvas = createCanvas(Math.ceil(w * scale), Math.ceil(h * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // 한 쪽에 문항이 여러 개라 같은 쪽을 문항마다 다시 그리면 느리다 → 쪽 전체를 한 번만 그려 두고(최근 몇 쪽만 보관) 거기서 잘라 쓴다
    let full = null;
    try { full = await _pageBitmap(doc, page, pageNum, scale); } catch (e) { full = null; }
    if (full) ctx.drawImage(full, -Math.round(x0 * scale), -Math.round(y0 * scale));
    else {
      const viewport = page.getViewport({ scale: scale, offsetX: -x0 * scale, offsetY: -y0 * scale });
      await page.render({ canvasContext: ctx, viewport: viewport, canvas: canvas }).promise;
    }
    eraseEdgeRules(canvas);
    try {
      const pdm = await pageItems(doc, pageNum);
      ctx.fillStyle = '#fff';
      _memo(pdm, 'marks', () => sourceMarkRects(pdm)).forEach(m => {
        const r = m.rect;
        if (r[0] < rect[2] && r[2] > rect[0] && r[1] < rect[3] && r[3] > rect[1])
          ctx.fillRect((r[0] - rect[0]) * scale, (r[1] - rect[1]) * scale, (r[2] - r[0]) * scale, (r[3] - r[1]) * scale);
      });
    } catch (e) {}
    if (trimBottom) eraseOrangeEdges(canvas, scale);
    if (trimBottom) {
      try {
        const pd = await pageItems(doc, pageNum);
        ctx.fillStyle = '#fff';
        const jk = _memo(pd, 'junk', () => junkItems(pd.items));
        pd.items.filter(it => jk.has(it) && it.x < rect[2] && it.x + it.w > rect[0] && it.top < rect[3] && it.bottom > rect[1]).forEach(it => {
          ctx.fillRect((it.x - rect[0] - 2) * scale, (it.top - rect[1] - 2) * scale, (it.w + 4) * scale, (it.bottom - it.top + 4) * scale);
        });
      } catch (e) {}
    }
    return trimBottom ? trimRightWhite(trimBottomWhite(canvas, Math.round(6 * scale)), Math.round(8 * scale)) : canvas;
  }

  // 오른쪽 끝의 빈 흰 여백을 잘라낸다 (한 단짜리 문항이 두 단 폭으로 저장돼서 "넓은 문항"으로 오해받는 것을 막는다)
  function trimRightWhite(canvas, pad) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    if (w < 80) return canvas;
    const data = ctx.getImageData(0, 0, w, h).data;
    let last = -1;
    for (let x = w - 1; x >= 0 && last < 0; x--) {
      for (let y = 0; y < h; y += 1) {
        const i = (y * w + x) * 4;
        if (data[i] < 226 || data[i + 1] < 226 || data[i + 2] < 226) { last = x; break; }
      }
    }
    const newW = Math.min(w, Math.max(Math.floor(w * 0.3), 60, last + 1 + pad));
    if (newW >= w - 2) return canvas;
    const out = createCanvas(newW, h);
    out.getContext('2d').drawImage(canvas, 0, 0, newW, h, 0, 0, newW, h);
    return out;
  }
  // 문항 하나를 그림으로: 본문 영역 + (다음 단·쪽으로 이어지는 부분이 있으면) 이어붙여서 하나로
  // markHeads: 공통 지문 머리글("[26~27]")의 숫자 자리를 거의 흰색(253,254,255) 표식으로 덮어 둔다 — 문제은행에서 새 번호를 붙일 때
  //   그 자리를 찾아 "[158~159]" 처럼 새 번호로 바꿔 쓰려고. 돌려주는 canvas.mainTop = 본문 위에 붙은 지문 그림의 높이(px)
  // 정답에 노란 형광펜이 칠해진 시험지: 문항 그림에서 형광펜 칠을 지운다 (글자·원숫자는 그대로 두고 노란색만 흰색으로).
  // 사진 속 노란색은 건드리지 않게, 작은 직사각형 덩어리(번호·한 줄 크기)만 대상으로 한다.
  function eraseYellowHighlight(c, scale) {
    try {
      const w = c.width, h = c.height, ctx = c.getContext('2d'), img = ctx.getImageData(0, 0, w, h), d = img.data;
      const yel = new Uint8Array(w * h);
      for (let i = 0, n = w * h; i < n; i++) {
        const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2], m = Math.max(r, g);
        if (m >= 110 && Math.abs(r - g) <= 22 && b <= m * 0.8 && m - b >= 28) yel[i] = 1;
      }
      const seen = new Uint8Array(w * h), maxW = 120 * scale, maxH = 30 * scale; let changed = false;
      const stack = [];
      for (let y0 = 0; y0 < h; y0++) for (let x0 = 0; x0 < w; x0++) {
        const p0 = y0 * w + x0; if (!yel[p0] || seen[p0]) continue;
        const px = []; let bx0 = x0, bx1 = x0, by0 = y0, by1 = y0, bright = 0; stack.length = 0; stack.push(p0); seen[p0] = 1;
        while (stack.length) {
          const p = stack.pop(), x = p % w, y = (p - x) / w; px.push(p);
          if (Math.max(d[p * 4], d[p * 4 + 1]) >= 225) bright++;
          if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
          if (x > 0 && yel[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
          if (x < w - 1 && yel[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
          if (y > 0 && yel[p - w] && !seen[p - w]) { seen[p - w] = 1; stack.push(p - w); }
          if (y < h - 1 && yel[p + w] && !seen[p + w]) { seen[p + w] = 1; stack.push(p + w); }
        }
        const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
        if (bright >= 40 * scale && bw <= maxW && bh <= maxH && bw >= 4 * scale && bh >= 4 * scale && px.length / (bw * bh) >= 0.1) {
          px.forEach(p => { const m = Math.max(d[p * 4], d[p * 4 + 1]); d[p * 4] = d[p * 4 + 1] = d[p * 4 + 2] = m; });
          changed = true;
        }
      }
      if (changed) ctx.putImageData(img, 0, 0);
    } catch (e) {}
    return c;
  }
  // 문항 그림 맨 위에 앞 칸의 테두리·그림자 조각(가로로 긴 선과 그 끝의 짧은 세로선)이 조금 걸려 있으면 지운다.
  // 맨 위의 첫 덩어리가 가로로 폭의 35% 넘게 이어진 선을 품고 있고, 그 아래가 빈 줄로 끊겨 있을 때만 지운다 (글자 줄은 이어진 긴 선이 없어서 해당 안 됨).
  function eraseTopRemnants(c, scale) {
    try {
      const w = c.width, h = c.height, lim = Math.min(h, Math.round(26 * scale));
      if (h < lim + 6 * scale) return;
      const ctx = c.getContext('2d'), d = ctx.getImageData(0, 0, w, lim + 1).data;
      const rowInfo = [];
      for (let y = 0; y <= lim; y++) {
        let ink = 0, run = 0, best = 0;
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4, v = (d[i] + d[i + 1] + d[i + 2]) / 3;
          if (v < 232) { ink++; run++; if (run > best) best = run; } else run = 0;
        }
        rowInfo.push({ ink: ink, run: best });
      }
      let y = 0; while (y <= lim && rowInfo[y].ink === 0) y++;              // 맨 위 빈 줄
      if (y > lim) return;
      const y0 = y; let longRun = false;
      while (y <= lim && rowInfo[y].ink > 0) { if (rowInfo[y].run > w * 0.35) longRun = true; y++; }
      if (y > lim || !longRun) return;                                         // 덩어리가 안 끝났거나(=내용에 붙어 있음) 긴 선이 없으면 그대로
      let gap = 0; while (y + gap <= lim && rowInfo[y + gap].ink === 0) gap++;
      if (gap < Math.round(2 * scale) && y + gap <= lim) return;               // 아래 내용과 바로 붙어 있으면 건드리지 않는다
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, y + 1);
    } catch (e) {}
  }
  async function renderQuestion(doc, q, scale, trimBottom, markHeads) {
    const parts = [];
    const paint = (c, page, rect) => {
      eraseYellowHighlight(c, scale);
      eraseTopRemnants(c, scale);
      if (!markHeads) return;
      const ctx = c.getContext('2d'); ctx.fillStyle = 'rgb(253,254,255)';
      (q.headMarks || []).forEach(m => { if (m.page === page && m.r[0] >= rect[0] - 2 && m.r[2] <= rect[2] + 2 && m.r[1] >= rect[1] - 2 && m.r[3] <= rect[3] + 2) ctx.fillRect(Math.floor((m.r[0] - rect[0]) * scale), Math.floor((m.r[1] - rect[1]) * scale), Math.ceil((m.r[2] - m.r[0]) * scale) + 1, Math.ceil((m.r[3] - m.r[1]) * scale) + 1); });
    };
    for (const pr of (q.pre || [])) { try { const c = await renderRect(doc, pr.page, pr.rect, scale, trimBottom); paint(c, pr.page, pr.rect); parts.push(c); } catch (e) {} }
    const nPre = parts.length;
    { const c = await renderRect(doc, q.page, q.rect, scale, trimBottom); paint(c, q.page, q.rect); parts.push(c); }
    for (const ex of (q.extra || [])) { try { const c = await renderRect(doc, ex.page, ex.rect, scale, trimBottom); paint(c, ex.page, ex.rect); parts.push(c); } catch (e) {} }
    if (parts.length === 1) { parts[0].mainTop = 0; return parts[0]; }
    const w = Math.max.apply(null, parts.map(c => c.width)), gap = Math.round(3 * scale);
    const h = parts.reduce((a, c) => a + c.height, 0) + gap * (parts.length - 1);
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    let y = 0, mainTop = 0; parts.forEach((c, k) => { if (k === nPre) mainTop = y; ctx.drawImage(c, 0, y); y += c.height + gap; });
    canvas.mainTop = mainTop;
    return canvas;
  }

  // 해설 구간들을 세로로 이어붙인 이미지 하나로 만든다. 원본 문항 번호("7)")는 지워서 새 번호와 안 헷갈리게 한다.
  async function renderExplanation(doc, expl, scale) {
    const parts = [];
    for (let i = 0; i < expl.segments.length; i++) {
      const sg = expl.segments[i];
      let c = await renderRect(doc, sg.page, sg.rect, scale, false);
      if (i === 0 && expl.numRect) {
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        const r = expl.numRect;
        ctx.fillRect((r[0] - sg.rect[0]) * scale, (r[1] - sg.rect[1]) * scale, (r[2] - r[0]) * scale, (r[3] - r[1]) * scale);
      }
      // 해설 상자 바닥까지 넉넉히 잡아두는 경우가 많아서(안 잘리게 하려고), 실제 글자가 끝난 뒤의
      // 빈 여백은 여기서 잘라낸다 — 그래야 다음 문항 해설과 간격이 너무 벌어지지 않는다.
      eraseOrangeEdges(c, scale);                       // 쪽 아래·위의 주황 장식 줄
      c = trimTopWhite(c, Math.round(4 * scale));
      c = trimBottomWhite(c, Math.round(8 * scale));
      parts.push(c);
    }
    if (parts.length === 1) return parts[0];
    const w = Math.max.apply(null, parts.map(c => c.width));
    const h = parts.reduce((a, c) => a + c.height, 0);
    const out = createCanvas(w, h);
    const ctx = out.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    let y = 0;
    parts.forEach(c => { ctx.drawImage(c, 0, y); y += c.height; });
    return out;
  }

  function trimBottomWhite(canvas, pad) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const data = ctx.getImageData(0, 0, w, h).data;
    let last = 0;
    for (let y = h - 1; y >= 0 && !last; y--) {
      const row = y * w * 4;
      for (let x = 0; x < w; x += 2) {
        const i = row + x * 4;
        if (data[i] < 226 || data[i + 1] < 226 || data[i + 2] < 226) { last = y; break; }
      }
    }
    const newH = Math.min(h, Math.max(20, last + pad));
    if (newH >= h - 2) return canvas;
    const out = createCanvas(w, newH);
    out.getContext('2d').drawImage(canvas, 0, 0, w, newH, 0, 0, w, newH);
    return out;
  }

  // trimBottomWhite의 반대 — 위쪽에 생긴 군더더기 빈 여백(다른 요소를 넉넉히 잡으려다 생긴)을 잘라낸다.
  function trimTopWhite(canvas, pad) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const data = ctx.getImageData(0, 0, w, h).data;
    let first = h - 1;
    for (let y = 0; y < h; y++) {
      const row = y * w * 4;
      let found = false;
      for (let x = 0; x < w; x += 2) {
        const i = row + x * 4;
        if (data[i] < 226 || data[i + 1] < 226 || data[i + 2] < 226) { found = true; break; }
      }
      if (found) { first = y; break; }
    }
    const cut = Math.max(0, first - pad);
    if (cut <= 2) return canvas;
    const out = createCanvas(w, h - cut);
    out.getContext('2d').drawImage(canvas, 0, cut, w, h - cut, 0, 0, w, h - cut);
    return out;
  }

  // ── 문제 그림에 딸려 나온 "구분선 조각" 지우기 ──────────────────────────────
  // 원본 시험지 페이지에는 왼쪽·오른쪽 칼럼을 나누는 세로선(과 가끔 가로 구분선)이 있어서, 문항 한 개를
  // 잘라내면 그 선의 조각이 그림 가장자리에 같이 딸려 나온다. 이걸 새 시험지에 그대로 붙이면 문항
  // 옆에 쓸데없는 선이 남으니, 선만 골라서 흰색으로 덮는다. (크기는 그대로 — 번호 위치 좌표가 안 틀어진다)
  //
  // "선"과 "상자 테두리·표·그래프 축"을 구분하는 기준:
  //  - 선은 그림 높이의 대부분을 쭉 이어지고(끊기면 안 되고) 그림 위쪽이나 아래쪽 끝까지 닿는다.
  //  - 상자 테두리나 표는 끝에 가로선이 이어져 붙어 있다 → 그런 건 지우지 않는다.
  function eraseEdgeRules(canvas) {
    const w = canvas.width, h = canvas.height;
    if (w < 60 || h < 60) return canvas;
    const ctx = canvas.getContext('2d');
    let data = ctx.getImageData(0, 0, w, h).data;
    const dark = (x, y) => { const i = (y * w + x) * 4; return data[i] < 205 && data[i + 1] < 205 && data[i + 2] < 205; };

    // 이 칸(열)에서 세로로 가장 길게 이어진 어두운 줄 (3픽셀 안쪽으로 끊긴 건 이어진 것으로 본다)
    function longestRun(x) {
      let best = null, start = -1, last = -1, cnt = 0;
      const close = () => {
        if (start >= 0) {
          const len = last - start + 1;
          if (!best || len > best.len) best = { start: start, end: last, len: len, cover: cnt / len };
        }
        start = -1; cnt = 0;
      };
      for (let y = 0; y < h; y++) {
        if (dark(x, y)) { if (start < 0) start = y; last = y; cnt++; }
        else if (start >= 0 && y - last > 3) close();
      }
      close();
      return best;
    }
    // 세로선 끝에서 가로로 뻗는 선이 있나(= 상자·표 모서리)?  dir: +1 오른쪽, -1 왼쪽
    function hasHorizontalAt(x, y, dir) {
      for (let dy = -2; dy <= 2; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        let n = 0;
        for (let k = 3; k <= 22; k++) { const xx = x + dir * k; if (xx < 0 || xx >= w) break; if (dark(xx, yy)) n++; }
        if (n >= 14) return true;
      }
      return false;
    }
    const win = Math.min(36, Math.floor(w / 6));
    const isRule = (info, x, dir) => {
      if (!info || info.len < 60 || info.cover < 0.85) return false;
      const reaches = info.len >= 0.85 * h || info.start <= 0.12 * h || info.end >= 0.88 * h;
      if (info.len < 0.55 * h || !reaches) return false;
      if (hasHorizontalAt(x, info.start + 1, dir) || hasHorizontalAt(x, info.end - 1, dir)) return false;   // 상자 테두리
      return true;
    };
    const kill = [];                            // 지울 열 범위 [시작, 끝]
    [[0, 1], [w - 1, -1]].forEach(function (side) {
      const x0 = side[0], dir = side[1];
      let group = null;
      for (let k = 0; k < win; k++) {
        const x = x0 + dir * k;
        const info = longestRun(x);
        // 선 안쪽(from edge 쪽이 아니라 그림 안쪽 방향)에서 부딪히는 가로선 검사는 바깥→안쪽 방향(dir)으로
        if (isRule(info, x, dir)) {
          if (!group) group = { a: x, b: x }; else group.b = x;
        } else if (group) { kill.push(group); group = null; }
      }
      if (group) kill.push(group);
    });
    ctx.fillStyle = '#fff';
    kill.forEach(function (g) {
      const lo = Math.min(g.a, g.b), hi = Math.max(g.a, g.b);
      if (hi - lo + 1 > 10) return;             // 너무 두꺼우면 선이 아니라 그림 덩어리 → 건드리지 않는다
      ctx.fillRect(Math.max(0, lo - 1), 0, hi - lo + 3, h);
    });
    data = ctx.getImageData(0, 0, w, h).data;     // 세로선을 지웠으니 다시 읽는다

    // 맨 위·맨 아래 가장자리에 가로로 쭉 이어진 가는 선(이웃 문항과의 구분선)도 지운다.
    function rowRun(y) {
      let n = 0;
      for (let x = 0; x < w; x++) if (dark(x, y)) n++;
      return n / w;
    }
    const rows = [];
    for (let y = 0; y < Math.min(14, Math.floor(h / 8)); y++) rows.push(y);
    for (let y = h - 1; y >= h - Math.min(14, Math.floor(h / 8)); y--) rows.push(y);
    rows.forEach(function (y) {
      if (rowRun(y) >= 0.9) {
        // 양 끝에서 세로로 이어지는 게 있으면 상자의 위/아래 변이니까 건드리지 않는다
        const vertDark = (x) => { let n = 0; const d = y < h / 2 ? 1 : -1; for (let k = 3; k <= 16; k++) { const yy = y + d * k; if (yy >= 0 && yy < h && dark(x, yy)) n++; } return n; };
        if (vertDark(2) >= 10 || vertDark(w - 3) >= 10) return;
        ctx.fillRect(0, y - 1, w, 3);
      }
    });
    return canvas;
  }
  const trimSideLines = eraseEdgeRules;       // 예전 이름 호환

  // 이미 문제은행에 저장돼 있는 그림(base64 PNG)에서도 같은 방법으로 선 조각을 지운다.
  // 문제은행에는 예전 버전으로 저장된 그림이 많아서, 조합할 때 한 번 더 깨끗이 한다.
  // 위쪽·왼쪽은 자르지 않고(번호 위치 좌표 보존), 아래쪽 빈 여백만 정리한다.
  function loadImage(src) {
    if (root.BankCore && root.BankCore._loadImage) return root.BankCore._loadImage(src);
    return new Promise(function (res, rej) {
      const im = new Image();
      const t = setTimeout(function () { rej(new Error('image load timeout')); }, 10000);   // 무한정 기다리지 않게
      im.onload = function () { clearTimeout(t); res(im); };
      im.onerror = function (e) { clearTimeout(t); rej(e); };
      im.src = src;
    });
  }
  async function cleanImageBase64(b64) {
    try {
      const im = await loadImage('data:image/png;base64,' + b64);
      const c = createCanvas(im.width, im.height);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(im, 0, 0);
      eraseEdgeRules(c);
      const t = trimRightWhite(trimBottomWhite(c, 10), 16);
      return { base64: canvasToBase64(t), width: t.width, height: t.height };
    } catch (e) {
      return null;       // 실패하면 원본 그림을 그대로 쓴다
    }
  }

  function canvasToBase64(canvas) {
    const url = canvas.toDataURL('image/png');
    return url.substring(url.indexOf(',') + 1);
  }

  async function textPreview(doc, pageNum, rect, maxLen) {
    const pd = await pageItems(doc, pageNum);
    const inside = pd.items.filter(it => it.x >= rect[0] - 2 && it.x <= rect[2] && it.top >= rect[1] - 2 && it.top <= rect[3]);
    const t = inside.map(it => it.str).join(' ');
    return t.length > maxLen ? t.substring(0, maxLen) + '…' : t;
  }

  async function textPreviewQ(doc, q, maxLen) {
    let t = '';
    for (const pr of (q.pre || [])) t += (t ? ' ' : '') + await textPreview(doc, pr.page, pr.rect, maxLen);
    t += (t ? ' ' : '') + await textPreview(doc, q.page, q.rect, maxLen);
    for (const ex of (q.extra || [])) { if (t.length >= maxLen) break; try { t += ' ' + await textPreview(doc, ex.page, ex.rect, maxLen); } catch (e) {} }
    return t.length > maxLen ? t.substring(0, maxLen) + '…' : t;
  }

  // ── 제목/안내 문구를 이미지로 그려서 PDF에 넣기 (한글 폰트 없이도 되도록) ──
  function headerPng(title, width, subtitle, keep) { return headerPngEx(title, width, subtitle, keep).b64; }
  // 제목 배지 그림 { b64, h(pt) }: 제목이 한 줄에 안 들어가면 칸을 아래로 키워서(높이 62) 두 줄로 쓴다
  function headerPngEx(title, width, subtitle, keepTitle) {
    const scale = 3, FONT = '"Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif', NAVY = '#0B1F5C';
    // 제목 끝의 "(강사용)"·"해설"과 단원 표기("중1-4단원 + 중2-3단원")를 떼어 낸다: 단원은 제목 위 작은 줄로, 나머지는 제목으로
    const origTitle = String(title || ''), keep = !!keepTitle || /기출/.test(origTitle);   // 기출문제는 제목을 건드리지 않는다
    const TAG_RE = /예상|최다|최상|공략|빈출|오답|기본|개념|유형|심화|발전|실력|응용|킬러|고난도/;
    let tags = [], tail = '', main = '';
    const grades = []; (origTitle).replace(/[초중고]\s?\d/g, g => { g = g.replace(/\s/g, ''); if (grades.indexOf(g) < 0) grades.push(g); return g; });
    if (keep) {
      const tm = origTitle.match(/^(.*?)(\s*(?:\(강사용\)|해설|정답))?\s*$/); tail = tm && tm[2] ? ' ' + tm[2].trim() : ''; main = (tm ? tm[1] : origTitle) + tail;
    } else {
      // 제목 모양: 학년 + 단원명 + 세부 제목 + [난이도·유형 표시]  예) "중1 5단원 모의고사 2회 [예상]"
      let t = origTitle.replace(/^\s*[가-힣]{1,6}(?:중학교|고등학교|중|고)(?![가-힣])\s*/, '')                       // 특정 학교 이름은 뺀다
        .replace(/(^|[\s\[(])20\d\d\s*(?:학년도|년도|년)?\s*/g, '$1');                                                // 연도도 뺀다
      const tm = t.match(/^(.*?)(\s*(?:\(강사용\)|해설|정답))?\s*$/); tail = tm && tm[2] ? ' ' + tm[2].trim() : ''; t = tm ? tm[1] : t;
      t = t.replace(/\[[^\]]*\]/g, b => { if (TAG_RE.test(b)) { tags.push(b.replace(/\[\s+/, '[').replace(/\s+\]/, ']')); return ' '; } return b; });   // 표시는 맨 뒤로
      const um0 = origTitle.match(/(\d{1,2}(?:-\d{1,2}){1,3})\s*[.．]\s*(.+?)(?=\s+[초중고]\s?\d|\s+과학(?![가-힣])|\s+Ai(?![A-Za-z])|\s*\[|\s*_|\s*\(|\s*$)/);
      if (um0 && um0[2].trim().length >= 2) t = um0[1] + ' ' + um0[2].trim();                                              // "5-2-1.알짜힘과 힘의 평형 …" → "5-2-1 알짜힘과 힘의 평형"
      t = t.replace(/[초중고]\s?[1-6]\s*-\s*(?=\d)/g, '').replace(/(^|[\s\[(·+,])[초중고]\s?[1-6](?![\d가-힣])\s*/g, '$1')   // 학년 글자는 일단 빼고 맨 앞에 한 번만 붙인다
        .replace(/\[\s*\]|\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim();
      if (!t) t = origTitle;
      main = (grades.length ? grades.slice(0, 3).join('·') + ' ' : '') + t + (tags.length ? ' ' + tags.join(' ') : '') + tail;
    }
    grades.sort((a, b) => ('초중고'.indexOf(a[0]) * 10 + +a.slice(1)) - ('초중고'.indexOf(b[0]) * 10 + +b.slice(1)));
    const gtxt = (grades.length ? grades.slice(0, 3).join('·') : '') + (grades.length ? ' | ' : '') + '과학';
    // 제목 글씨 크기·줄 수를 먼저 정한다: 한 줄(19pt → 13pt) → 안 들어가면 칸을 키워 두 줄(15pt → 13pt) → 그래도 넘치면 … 으로 줄임
    const bw = 84, tx = bw + 8, tw = width - tx - 8, mctx = createCanvas(10, 10).getContext('2d');
    const meas = (f, t) => { mctx.font = 'bold ' + (f * scale) + 'px ' + FONT; return mctx.measureText(t).width / scale; };
    const wrap = f => { const out = []; let cur = ''; for (const ch of Array.from(main)) { if (meas(f, cur + ch) > tw && cur) { out.push(cur); cur = ch; } else cur += ch; } if (cur) out.push(cur); return out; };
    let fs = 19, lines = [main], tall = false;
    while (fs > 13 && meas(fs, main) > tw) fs -= 0.5;
    if (meas(fs, main) > tw) {
      tall = true; fs = 15; lines = wrap(fs);
      if (lines.length > 2) { fs = 13; lines = wrap(fs); }
      if (lines.length > 2) { let t = lines.slice(1).join(''); while (t.length > 2 && meas(fs, t + '…') > tw) t = t.slice(0, -1); lines = [lines[0], t + '…']; }
    }
    const lhh = fs * 1.28, UH = 0;
    const boxH = Math.max(34, Math.round(8 + UH + lines.length * lhh)), HH = boxH + 14, bh = boxH + 10, by = 2, boxX = 56, boxY = 4;
    const c = createCanvas(Math.round(width * scale), HH * scale), ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    // 오른쪽 제목 상자(옅은 파란 테두리) → 그 위에 왼쪽 배지를 겹쳐 그린다 (학년 | 과목)
    ctx.strokeStyle = '#8FA3CC'; ctx.lineWidth = 1.2 * scale; ctx.strokeRect(boxX * scale, boxY * scale, (width - boxX - 1) * scale, boxH * scale);
    ctx.fillStyle = NAVY; ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(0, by * scale, bw * scale, bh * scale, 8 * scale); else ctx.rect(0, by * scale, bw * scale, bh * scale);
    ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let gfs = 17; ctx.font = 'bold ' + (gfs * scale) + 'px ' + FONT;
    while (gfs > 8 && ctx.measureText(gtxt).width > (bw - 8) * scale) { gfs -= 0.5; ctx.font = 'bold ' + (gfs * scale) + 'px ' + FONT; }
    ctx.fillText(gtxt, bw / 2 * scale, (by + bh / 2) * scale);
    // 제목: 상자 가운데
    ctx.fillStyle = '#111'; ctx.font = 'bold ' + (fs * scale) + 'px ' + FONT;
    const cxm = tx + tw / 2, cyb = boxY + UH + (boxH - UH) / 2, lh = fs * 1.28;
    lines.forEach((ln, k2) => ctx.fillText(ln, cxm * scale, (cyb + (k2 - (lines.length - 1) / 2) * lh + 0.5) * scale));
    // 안내 문구는 상자 바로 아래 작게
    ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = '#6B7280'; let sfs = 7, st = subtitle || '※ 문항 왼쪽의 진한 파란 원 번호가 답안 입력 번호입니다. (문항 안에 다른 번호가 보여도 무시하세요)';
    ctx.font = (sfs * scale) + 'px ' + FONT;
    while (sfs > 5.5 && ctx.measureText(st).width > (width - tx) * scale) { sfs -= 0.25; ctx.font = (sfs * scale) + 'px ' + FONT; }
    ctx.fillText(st, tx * scale, (boxY + boxH + 1.5) * scale);
    return { b64: canvasToBase64(c), h: HH };
  }

  // 기출문제 꼬리표 (예: "○○중 2025 1학기 중간 기출"): 한글이라 그림으로 만들어서 붙인다. 크기는 pt 기준.
  function tagPng(text) {
    const sc = 5, fs = 7.5, padX = 3.5, h = 11;
    const font = (fs * sc) + 'px "Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif';
    const m = createCanvas(10, 10).getContext('2d'); m.font = 'bold ' + font;
    const w = Math.ceil(m.measureText(text).width / sc + padX * 2);
    const c = createCanvas(w * sc, h * sc), ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#EAF0FB'; ctx.fillRect(0.5 * sc, 0.5 * sc, c.width - sc, c.height - sc);
    ctx.strokeStyle = '#0B1F5C'; ctx.lineWidth = 0.6 * sc; ctx.strokeRect(0.5 * sc, 0.5 * sc, c.width - sc, c.height - sc);
    ctx.fillStyle = '#0B1F5C'; ctx.font = 'bold ' + font; ctx.textBaseline = 'middle';
    ctx.fillText(text, padX * sc, c.height / 2 + 0.3 * sc);
    return { base64: canvasToBase64(c), w: w, h: h };
  }
  // 문항 그림에 붙일 꼬리표 글자: 기출문제면 "학교·시험 이름 기출", 아니면 빈 글자
  function pastTagText(q) {
    if (!q || q.kind !== '기출') return '';
    // 배지는 "2024년 중계중2-1 중간 기출" 한 가지 모양으로 통일한다 (단원 이름·번호는 붙이지 않는다)
    const sch = String(q.school || '').trim(), src = String(q.source || '').replace(UNIT_TAIL_RE, ' ');
    const both = sch + ' ' + src;
    const ym = (String(q.year || '') + ' ' + both).match(/20\d\d/);
    const year = ym ? ym[0] + '년' : '';
    let name = '';
    const nm = both.match(/([가-힣]{2,5}?)(?:중학교|중)(?![가-힣])/);
    if (nm && !/^(과학|기출|중간|기말)/.test(nm[1])) name = nm[1] + '중';
    else { const tk = (sch.match(/^[가-힣]{2,5}/) || [''])[0]; if (tk && !/^(과학|기출|중간|기말|중등)/.test(tk)) name = /중$/.test(tk) ? tk : tk + '중'; }
    let gs = '';
    const gm = both.match(/(?:^|[^\d])([123])\s*[-－]\s*([12])(?![\d,~]|\s*단원)/);
    if (gm) gs = gm[1] + '-' + gm[2];
    else {
      const g = String(q.grade || '').match(/[123]/), sm = both.match(/([12])\s*학기/);
      if (g && sm) gs = g[0] + '-' + sm[1];
    }
    const tm = both.match(/중간|기말/), term = tm ? tm[0] : '';
    const label = [year, name + gs, term].filter(Boolean).join(' ').trim();
    return (label ? label + ' ' : '') + '기출';
  }
  const UNIT_TAIL_RE = /(?:중\s*[123]\s*[-－]\s*)?\d[\d,~\s]*단원|\+\s*중\s*\d[^\s]*/g;

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  // images: [{ base64, width, height, naturalW, numRect? }] 순서대로 1번부터
  //   naturalW = 원본 크기(pt) 기준 가로, numRect = 이미지 안 "옛 문항 번호"의 위치 [x0,top,x1,bottom] (pt, 이미지 왼쪽 위 기준)
  // 2단으로 배치한다: 왼쪽 단을 위에서 아래로 채우고, 다 차면 오른쪽 단, 그다음 새 페이지.
  // 옛 번호 위치를 아는 문항은 그 자리를 흰색으로 지우고 새 번호(진한 파란 원)를 덮어쓴다.
  // 위치를 모르는 문항(예전에 저장한 것)은 왼쪽 여백에 진한 파란 원을 붙인다.
  // opts: { subtitle, qrReserve(머리글 오른쪽에 비워둘 폭 pt) }
  async function composeExamPdf(PDFLib, title, images, opts) {
    opts = opts || {};
    const { PDFDocument, rgb, StandardFonts } = PDFLib;
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const W = 595.28, H = 841.89;
    const useGutter = images.some(im => !im.numRect);          // 번호 위치를 모르는 문항이 있을 때만 왼쪽 여백을 쓴다
    const marginX = 30, marginBottom = 36, gap = 14, colGap = 14, gutter = useGutter ? 26 : 0;
    const areaW = W - marginX * 2;
    const colW = (areaW - colGap) / 2;
    const colImgW = colW - gutter;
    const colX = [marginX + gutter, marginX + colW + colGap + gutter];
    const subtitle = opts.subtitle || (useGutter
      ? '※ 문항 왼쪽의 진한 파란 원 번호가 답안 입력 번호입니다. (문항 안에 다른 번호가 보여도 무시하세요)'
      : '※ 문항 번호 자리의 진한 파란 원 번호가 답안 입력 번호입니다.');
    const headW = Math.round(areaW - (opts.qrReserve || 0));
    let marginTop = 74;
    const hdr = headerPngEx(title, headW, subtitle, opts.keepTitle), headH = hdr.h;
    marginTop = (opts.marginTop || 74) + 12 + (headH - 48);      // 제목 배지를 12pt 아래로 내렸고, 긴 제목이면 칸이 더 길어진다
    const headImg = await doc.embedPng(b64ToBytes(hdr.b64));
    const maxH = H - marginTop - marginBottom;
    const RED = rgb(0.043, 0.122, 0.361);          // 번호 원·꼬리표: 매우 짙은 파란색
    const GREY = rgb(0.95, 0.95, 0.95);

    let page, ys, col;
    // 가운데 중간선: 문제 그림에 딸려 나온 선 조각은 모두 지우고, 대신 앱이 모든 쪽에 똑같은 선을 직접 긋는다
    // (진짜 시험지처럼 위에서 아래까지 쭉 이어진 가는 선). 그림보다 먼저 그려서 넓은 문항이 선을 덮을 수 있게 한다.
    const drawCenterLine = opts.centerLine !== false;
    const centerX = marginX + colW + colGap / 2;
    function newPage() {
      page = doc.addPage([W, H]);
      page.drawImage(headImg, { x: marginX, y: H - 28 - headH, width: headW, height: headH });
      if (drawCenterLine) {
        page.drawLine({ start: { x: centerX, y: H - marginTop + 4 }, end: { x: centerX, y: marginBottom - 4 },
          thickness: 0.7, color: rgb(0.25, 0.25, 0.25) });
      }
      ys = [H - marginTop, H - marginTop];
      col = 0;
    }
    function label(cx, cy, r, n, subj) {
      const t = String(n), fs = t.length > 2 ? 9 : (t.length > 1 ? 10.5 : 12), tw = font.widthOfTextAtSize(t, fs);
      if (t.length > 2) {            // "3~4" 처럼 한 문항 그림에 문제가 여러 개 들어 있을 때: 둥근 원 대신 길쭉한 빨간 이름표
        page.drawRectangle({ x: cx - tw / 2 - 5, y: cy - r, width: tw + 10, height: r * 2, color: RED });
      } else page.drawCircle({ x: cx, y: cy, size: r, color: RED });
      page.drawText(t, { x: cx - tw / 2, y: cy - fs * 0.34, size: fs, font: font, color: rgb(1, 1, 1) });
      if (subj) {
        // 서술형(주관식)은 OMR 번호처럼 보이지 않게, 배지 밑에 작은 꼬리표를 따로 붙인다
        const tag = '서술형', tfs = 8, ttw = font.widthOfTextAtSize(tag, tfs);
        const tx = cx - ttw / 2 - 3, ty = cy - r - tfs - 5;
        page.drawRectangle({ x: tx, y: ty, width: ttw + 6, height: tfs + 5, color: GREY, borderColor: RED, borderWidth: 0.75 });
        page.drawText(tag, { x: tx + 3, y: ty + 2.2, size: tfs, font: font, color: RED });
      }
    }
    // 왼쪽 여백에 붙이는 번호 (번호 위치를 모를 때)
    function gutterBadge(cx, topY, n, subj) { label(cx, topY - 13, 11, n, subj); }
    // 옛 번호를 흰색으로 지우고 그 자리에 새 번호를 덮는다
    function overlayNumber(x, topY, drawW, im, n, subj) {
      const sc = drawW / im.naturalW, nr = im.numRect;
      const left = x + nr[0] * sc, right = x + nr[2] * sc, top = topY - nr[1] * sc, bottom = topY - nr[3] * sc;
      page.drawRectangle({ x: left - 1.5, y: bottom - 1.5, width: (right - left) + 3, height: (top - bottom) + 3, color: rgb(1, 1, 1) });
      const h = top - bottom;
      const cx = (left + right) / 2, cy = top - h * 0.46;
      label(cx, cy, Math.max(9.5, Math.min(12, h * 0.62)), n, subj);
    }
    function mark(x, topY, drawW, im, n, badgeX) {
      const subj = String(im.answer) === '-';
      if (im.numRect && im.naturalW) overlayNumber(x, topY, drawW, im, n, subj);
      else gutterBadge(badgeX, topY, n, subj);
    }

    // 기출 꼬리표: 문항 그림 바로 위 오른쪽 끝 (문제 내용을 가리지 않게 그림 위에 따로 한 줄을 잡는다)
    const tagCache = {};
    const TAG_H = 11, TAG_GAP = 2;
    async function drawTag(im, rightX, topY) {
      if (!im.tag) return;
      if (!tagCache[im.tag]) { const t = tagPng(im.tag); tagCache[im.tag] = { img: await doc.embedPng(b64ToBytes(t.base64)), w: t.w, h: t.h }; }
      const t = tagCache[im.tag];
      page.drawImage(t.img, { x: rightX - t.w, y: topY - t.h, width: t.w, height: t.h });
    }

    const headBoxes = [];
    for (let i = 0; i < images.length; i++) if (images[i].headRange) headBoxes[i] = await findHeadMarker(images[i].base64);
    newPage();
    for (let i = 0; i < images.length; i++) {
      const im = images[i];
      const img = await doc.embedPng(b64ToBytes(im.base64));
      const extra = im.tag ? TAG_H + TAG_GAP : 0;                 // 꼬리표 줄 높이
      const wide = (im.naturalW || 0) > colImgW * 1.45;
      const targetW = wide ? Math.min(areaW - gutter, im.naturalW) : Math.min(colImgW, im.naturalW || colImgW);
      let drawW = targetW, drawH = im.height * (drawW / im.width);
      if (drawH + extra > maxH) { drawW *= (maxH - extra) / drawH; drawH = maxH - extra; }

      if (wide) {
        let top = Math.min(ys[0], ys[1]);
        if (top - extra - drawH < marginBottom) { newPage(); top = ys[0]; }
        const x = marginX + gutter;
        await drawTag(im, x + drawW, top);
        const imgTop = top - extra;
        page.drawImage(img, { x: x, y: imgTop - drawH, width: drawW, height: drawH });
        mark(x, imgTop, drawW, im, im.num || i + 1, marginX + 11);
        if (headBoxes[i]) drawHeadPatch(page, font, rgb, headBoxes[i], x, imgTop, drawW / im.width, newHeadText(images, im));
        ys[0] = ys[1] = imgTop - drawH - gap;
        col = 0;
      } else {
        if (ys[col] - extra - drawH < marginBottom) {
          if (col === 0) { col = 1; }
          else { newPage(); }
          if (ys[col] - extra - drawH < marginBottom && ys[col] < H - marginTop) { newPage(); }
        }
        const top = ys[col];
        await drawTag(im, colX[col] + drawW, top);
        const imgTop = top - extra;
        page.drawImage(img, { x: colX[col], y: imgTop - drawH, width: drawW, height: drawH });
        mark(colX[col], imgTop, drawW, im, im.num || i + 1, colX[col] - gutter + 11);
        if (headBoxes[i]) drawHeadPatch(page, font, rgb, headBoxes[i], colX[col], imgTop, drawW / im.width, newHeadText(images, im));
        ys[col] = imgTop - drawH - gap;
      }
    }
    return doc;   // 호출한 쪽에서 QR을 찍고 save()
  }

  // ── 객관식 보기 번호(①②③④⑤) 위치 찾기: 문항 그림에서 동그라미 글자(원 안에 숫자가 든 모양)를 찾아 읽는 순서로 번호를 붙인다 ──
  // 돌려주는 값: [{cx, cy, r}] (그림 픽셀 좌표, 1번부터 차례로) 또는 null(확실하지 않을 때 — 그때는 표시하지 않고 정답 글자만 적는다)
  function detectOptionMarkers(canvas) {
    const w = canvas.width, h = canvas.height;
    if (w < 40 || h < 40) return null;
    const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    const ink = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) ink[i] = ((d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3) < 210 ? 1 : 0;
    const lab = new Int32Array(w * h), comps = [];
    const stack = [];
    for (let y0 = 0; y0 < h; y0++) for (let x0 = 0; x0 < w; x0++) {
      const p0 = y0 * w + x0;
      if (!ink[p0] || lab[p0]) continue;
      const id = comps.length + 1; lab[p0] = id; stack.length = 0; stack.push(p0);
      let x1 = x0, x2 = x0, y1 = y0, y2 = y0, area = 0;
      while (stack.length) {
        const p = stack.pop(); area++;
        const px = p % w, py = (p - px) / w;
        if (px < x1) x1 = px; if (px > x2) x2 = px; if (py < y1) y1 = py; if (py > y2) y2 = py;
        for (let dy = -1; dy <= 1; dy++) { const ny = py + dy; if (ny < 0 || ny >= h) continue;
          for (let dx = -1; dx <= 1; dx++) { const nx = px + dx; if (nx < 0 || nx >= w) continue;
            const q = ny * w + nx; if (ink[q] && !lab[q]) { lab[q] = id; stack.push(q); } } }
      }
      comps.push({ x1: x1, x2: x2 + 1, y1: y1, y2: y2 + 1, area: area });
    }
    // 원 후보: 거의 정사각형이고 속이 비어 있으며, 안에 다른 글자(숫자) 덩어리가 들어 있는 것
    const cand = comps.filter(c => {
      const cw = c.x2 - c.x1, ch = c.y2 - c.y1;
      if (cw < 14 || cw > 80 || ch < 14 || ch > 80) return false;
      const asp = cw / ch; if (asp < 0.82 || asp > 1.22) return false;
      if (c.area / (cw * ch) > 0.6) return false;
      // 둘레의 90% 이상이 닫힌 선이어야 원이다 (타원 모양도 허용). 한글 글자는 이런 닫힌 원이 아니다
      const cx = (c.x1 + c.x2) / 2, cy = (c.y1 + c.y2) / 2, rx = cw / 2 - 1.2, ry = ch / 2 - 1.2;
      let hit = 0; const N = 48;
      for (let k = 0; k < N; k++) {
        const a = k / N * 6.2832; let ok = false;
        for (let t = -2; t <= 2 && !ok; t++) { const px = Math.round(cx + (rx + t) * Math.cos(a)), py = Math.round(cy + (ry + t) * Math.sin(a)); if (px >= 0 && py >= 0 && px < w && py < h && ink[py * w + px]) ok = true; }
        if (ok) hit++;
      }
      if (hit / N < 0.78) return false;
      // 보기 번호(①②…)는 줄 맨 앞이거나 왼쪽에 충분한 빈칸이 있다. 보기 글 속의 ㉠㉡ 같은 동그라미 글자는 앞 글자에 바싹 붙어 있어서 걸러낸다
      { const y0 = Math.round(c.y1 + ch * 0.25), y1 = Math.round(c.y2 - ch * 0.25), lim = Math.max(0, Math.round(c.x1 - cw * 0.85));
        for (let xx = c.x1 - 1; xx >= lim; xx--) for (let yy = y0; yy <= y1; yy++) if (ink[yy * w + xx]) return false; }
      // 원 안에 숫자(획)가 있어야 한다: 가운데 부분에 먹물이 있고, 바깥 고리보다 훨씬 적다
      let mid = 0;
      for (let yy = Math.round(cy - ch * 0.22); yy <= Math.round(cy + ch * 0.22); yy++) for (let xx = Math.round(cx - cw * 0.22); xx <= Math.round(cx + cw * 0.22); xx++) if (ink[yy * w + xx]) mid++;
      return mid >= 4;
    });
    if (cand.length < 5) return null;
    // 같은 크기끼리만 (가장 흔한 크기 ±15%)
    // 크기가 비슷한 원 후보끼리 묶어서, 보기 5개 배치가 말이 되는 묶음을 찾는다 (가장 아래쪽 = 보기가 있는 곳)
    const tryGroup = (same, med) => {
      if (same.length < 5) return null;
      // 읽는 순서: 같은 줄(세로 위치가 비슷한 것)끼리 왼쪽부터
      same.forEach(c => { c.cx = (c.x1 + c.x2) / 2; c.cy = (c.y1 + c.y2) / 2; });
      same.sort((a, b) => a.cy - b.cy);
      const rows = [];
      same.forEach(c => { const r = rows.find(r => Math.abs(r.cy - c.cy) < med * 0.6); if (r) { r.items.push(c); r.cy = (r.cy * (r.items.length - 1) + c.cy) / r.items.length; } else rows.push({ cy: c.cy, items: [c] }); });
      const ordered = [];
      rows.forEach(r => r.items.sort((a, b) => a.cx - b.cx).forEach(c => ordered.push(c)));
      // 보기 5개의 배치가 말이 되는 마지막 묶음을 고른다: 세로 한 줄 / 가로 한 줄 / 2~3열 표 모양. (그림·글자 속 동그라미가 섞이면 이 모양이 깨진다)
      const clusterVals = (vals, tol) => { const out = []; vals.slice().sort((p, q) => p - q).forEach(v => { const g = out.find(o => Math.abs(o.v - v) <= tol); if (g) { g.v = (g.v * g.n + v) / (g.n + 1); g.n++; } else out.push({ v: v, n: 1 }); }); return out; };
      const validSet = set => {
        const xs = clusterVals(set.map(c => c.x1), 5), ys = clusterVals(set.map(c => c.cy), med * 0.35);
        if (xs.length === 1) { const sorted = set.slice().sort((p, q) => p.cy - q.cy); for (let i = 1; i < 5; i++) if (sorted[i].cy - sorted[i - 1].cy > med * 4.5) return false; return true; }
        if (ys.length === 1) { const sorted = set.slice().sort((p, q) => p.cx - q.cx); for (let i = 1; i < 5; i++) if (sorted[i].cx - sorted[i - 1].cx > med * 40) return false; return true; }
        if (xs.length <= 3 && ys.length <= 3) {
          const cells = new Set(set.map(c => xs.findIndex(g => Math.abs(g.v - c.x1) <= 5) + ',' + ys.findIndex(g => Math.abs(g.v - c.cy) <= med * 0.35)));
          if (cells.size !== 5) return false;
          const sorted = ys.map(g => g.v).sort((p, q) => p - q); for (let i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] > med * 4) return false;
          return true;
        }
        return false;
      };
      let five = null;
      for (let e = ordered.length; e >= 5 && !five; e--) { const win = ordered.slice(e - 5, e); if (validSet(win)) five = win; }
      return five;

    };
    let best = null;
    cand.forEach(p => {
      const ph = p.y2 - p.y1, g = cand.filter(c => Math.abs((c.y2 - c.y1) - ph) <= ph * 0.12);
      const f = tryGroup(g.slice(), ph);
      if (f && (!best || f[4].cy > best[4].cy + 2 || (Math.abs(f[4].cy - best[4].cy) <= 2 && f.length && g.length > best.n))) { best = f; best.n = g.length; }
    });
    const five = best;
    if (!five) return null;
    return five.map(c => ({ cx: c.cx, cy: c.cy, r: Math.max(c.x2 - c.x1, c.y2 - c.y1) / 2 }));
  }
  async function detectOptionMarkersB64(b64) {
    try {
      const im = await loadImage('data:image/png;base64,' + b64);
      const c = createCanvas(im.width, im.height), ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(im, 0, 0);
      return detectOptionMarkers(c);
    } catch (e) { return null; }
  }


  // ── 강사용 시험지: 문제 바로 밑에 정답(빨간 글씨)과 해설을 붙이고, 객관식 정답 번호에는 빨간 동그라미를 친다 ──
  // items: [{ base64, width, height, naturalW, num, answer, explBase64?, explW?, explH?, tag? }]
  function answerLabelPng(answer, widthPt, numStart) {
    const circ = '①②③④⑤⑥⑦⑧⑨', sc = 4, h = 16;
    const one = a => { const t = String(a == null ? '' : a).replace(/[^0-9\-\/]/g, ''); if (!t) return '?'; if (t === '-') return '서술형'; return t.split('/').filter(Boolean).map(g => g.split('').map(d => circ[parseInt(d, 10) - 1] || d).join(' ')).join(' 또는 '); };
    const t = Array.isArray(answer) ? 'multi' : String(answer == null ? '' : answer).replace(/[^0-9\-\/]/g, '');
    let txt;
    if (Array.isArray(answer)) txt = '정답  ' + answer.map((a, i) => (numStart + i) + '번 ' + one(a)).join('    ');
    else if (!t) txt = '정답: (입력 안 됨)';
    else if (t === '-') txt = '정답: 서술형 (아래 해설 참고)';
    else txt = '정답  ' + t.split('/').filter(Boolean).map(g => g.split('').map(d => circ[parseInt(d, 10) - 1] || d).join(' ')).join('  또는  ');
    const c = createCanvas(Math.round(widthPt * sc), h * sc), ctx = c.getContext('2d');
    ctx.fillStyle = '#FDECEA'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#C1392B'; ctx.fillRect(0, 0, 2.5 * sc, c.height);
    ctx.font = 'bold ' + (10 * sc) + 'px "Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif';
    ctx.textBaseline = 'middle'; ctx.fillText(txt, 7 * sc, c.height / 2 + 0.4 * sc);
    return { base64: canvasToBase64(c), w: widthPt, h: h };
  }
  async function composeTeacherPdf(PDFLib, title, items, opts) {
    opts = opts || {};
    const { PDFDocument, rgb, StandardFonts } = PDFLib;
    const doc = await PDFDocument.create();
    const nfont = await doc.embedFont(StandardFonts.HelveticaBold);
    const W = 595.28, H = 841.89, marginX = 30, marginBottom = 36, gap = 12, colGap = 14;
    const areaW = W - marginX * 2, colW = (areaW - colGap) / 2;
    const colX = [marginX, marginX + colW + colGap];
    const hdr = headerPngEx(title + ' (강사용)', Math.round(areaW), '※ 강사용: 정답(빨간 동그라미)과 해설이 각 문제 바로 아래에 있습니다. 학생에게 나눠주지 마세요.', opts.keepTitle), headH = hdr.h;
    const marginTop = 74 + 12 + (headH - 48), maxH = H - marginTop - marginBottom;
    const headImg = await doc.embedPng(b64ToBytes(hdr.b64));
    const RED = rgb(0.85, 0.1, 0.1);
    let page, ys, col;
    function newPage() {
      page = doc.addPage([W, H]);
      page.drawImage(headImg, { x: marginX, y: H - 28 - headH, width: areaW, height: headH });
      page.drawLine({ start: { x: marginX + colW + colGap / 2, y: H - marginTop + 4 }, end: { x: marginX + colW + colGap / 2, y: marginBottom - 4 }, thickness: 0.7, color: rgb(0.25, 0.25, 0.25) });
      ys = [H - marginTop, H - marginTop]; col = 0;
    }
    // 높이 need 만큼 들어갈 자리를 잡는다 (안 들어가면 다음 단, 다음 쪽)
    function place(need, wide) {
      if (wide) {
        let top = Math.min(ys[0], ys[1]);
        if (top - need < marginBottom) { newPage(); top = ys[0]; }
        col = 0; return { top: top, x: marginX, w: areaW, wide: true };
      }
      if (ys[col] - need < marginBottom) { if (col === 0) col = 1; else newPage(); }
      if (ys[col] - need < marginBottom && ys[col] < H - marginTop) { if (col === 0) col = 1; else newPage(); }
      if (ys[col] - need < marginBottom) { newPage(); }
      return { top: ys[col], x: colX[col], w: colW, wide: false };
    }
    function advance(p, used) { if (p.wide) { ys[0] = ys[1] = p.top - used - gap; } else ys[col] = p.top - used - gap; }
    newPage();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const img = await doc.embedPng(b64ToBytes(it.base64));
      const wide = (it.naturalW || 0) > colW * 1.45;
      const fullW = wide ? areaW : colW;
      let dw = Math.min(fullW, it.naturalW || fullW), dh = it.height * (dw / it.width);
      const lab = answerLabelPng(it.subAnswers || it.answer, dw, it.numStart), labImg = await doc.embedPng(b64ToBytes(lab.base64));
      const TAGH = it.tag ? 13 : 0;                                     // 기출 배지 줄 높이
      const limit = maxH - lab.h - 4 - TAGH;
      if (dh > limit) { dw *= limit / dh; dh = limit; }
      // 문제 + 정답 줄은 한 덩어리 (떨어지지 않게)
      const p = place(dh + lab.h + 4 + TAGH, wide);
      if (it.tag) {                                                        // 학생용 시험지와 같은 "2024년 ○○중2-1 중간 기출" 배지: 그림 위 오른쪽 끝
        const tg = tagPng(it.tag), timg = await doc.embedPng(b64ToBytes(tg.base64));
        page.drawImage(timg, { x: p.x + dw - tg.w, y: p.top - tg.h, width: tg.w, height: tg.h });
        p.top -= TAGH;
      }
      page.drawImage(img, { x: p.x, y: p.top - dh, width: dw, height: dh });
      if (it.headRange && !it.noBadge) { const hb = await findHeadMarker(it.base64); drawHeadPatch(page, nfont, rgb, hb, p.x, p.top, dw / it.width, newHeadText(items, it)); }
      // 학생용 시험지와 같은 번호: 옛 문항 번호를 흰색으로 지우고 그 자리에 진한 파란 원 번호(1,2,3…)를 덮는다
      if (it.num && !it.noBadge) {
        const RB = rgb(0.043, 0.122, 0.361), t = String(it.num), fs = t.length > 2 ? 9 : (t.length > 1 ? 10.5 : 12), tw = nfont.widthOfTextAtSize(t, fs);
        let cx, cy, r;
        if (it.numRect && it.naturalW) {
          const k = dw / it.naturalW, nr = it.numRect, left = p.x + nr[0] * k, right = p.x + nr[2] * k, top = p.top - nr[1] * k, bottom = p.top - nr[3] * k;
          page.drawRectangle({ x: left - 1.5, y: bottom - 1.5, width: (right - left) + 3, height: (top - bottom) + 3, color: rgb(1, 1, 1) });
          cx = (left + right) / 2; cy = top - (top - bottom) * 0.46; r = Math.max(9.5, Math.min(12, (top - bottom) * 0.62));
        } else { cx = p.x + 9; cy = p.top - 11; r = 10; }
        if (t.length > 2) page.drawRectangle({ x: cx - tw / 2 - 5, y: cy - r, width: tw + 10, height: r * 2, color: RB });
        else page.drawCircle({ x: cx, y: cy, size: r, color: RB });
        page.drawText(t, { x: cx - tw / 2, y: cy - fs * 0.34, size: fs, font: nfont, color: rgb(1, 1, 1) });
      }
      // 정답 번호에 빨간 동그라미
      let markers = null; try { markers = it.markers || await detectOptionMarkersB64(it.base64); } catch (e) {}
      const ans = String(it.answer == null ? '' : it.answer).replace(/[^0-9\/]/g, '');
      if (markers && markers.length === 5 && ans && !it.subAnswers) {
        const k = dw / it.width, seen = {};
        ans.split(/[\/]/).join('').split('').forEach(d => {
          const n = parseInt(d, 10); if (!(n >= 1 && n <= 5) || seen[n]) return; seen[n] = 1;
          const m = markers[n - 1], rr = m.r * k * 1.25;
          page.drawEllipse({ x: p.x + m.cx * k, y: p.top - m.cy * k, xScale: rr, yScale: rr, borderColor: RED, borderWidth: 1.6 });
        });
      }
      page.drawImage(labImg, { x: p.x, y: p.top - dh - 2 - lab.h, width: dw, height: lab.h });
      let used = dh + lab.h + 4;
      // 해설 그림: 문제 바로 밑. 자리가 모자라면 다음 단으로 이어서 (해설만 따로 넘어간다)
      if (it.explBase64) {
        const eimg = await doc.embedPng(b64ToBytes(it.explBase64));
        let ew = Math.min(fullW, it.explW / 2.2);
        let eh = it.explH * (ew / it.explW);
        if (eh > maxH) { ew *= maxH / eh; eh = maxH; }
        if (p.top - used - 4 - eh >= marginBottom) {
          page.drawImage(eimg, { x: p.x, y: p.top - used - 4 - eh, width: ew, height: eh });
          used += 4 + eh;
          advance(p, used);
        } else {
          advance(p, used);
          // 한 단에 들어가게 폭을 줄인다 (넓은 문항의 해설이 옆 단 문항을 덮지 않도록)
          let ew2 = Math.min(ew, colW), eh2 = it.explH * (ew2 / it.explW);
          if (eh2 > maxH) { ew2 *= maxH / eh2; eh2 = maxH; }
          const p2 = place(eh2, false);
          page.drawImage(eimg, { x: p2.x, y: p2.top - eh2, width: ew2, height: eh2 });
          advance(p2, eh2);
        }
      } else advance(p, used);
    }
    return doc;
  }

  // ── 오답노트: 학생이 틀린 문항만 모아서 (문제 그림 + 내 답/정답 + 해설 + 다시 풀 빈칸) PDF로 만든다 ──
  // items: [{ base64, width, height, naturalW, entries:[{n, given, answer}], explBase64?, explW?, explH? }]
  // opts: { studentName, examTitle, withExpl, blank(pt) }
  function wrongNoteLabelPng(entries, widthPt) {
    const circ = '①②③④⑤⑥⑦⑧⑨', sc = 4, h = 18, FONT = '"Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif';
    const fmt = a => { const t = String(a == null ? '' : a).replace(/[^0-9\-\/]/g, ''); if (!t) return '(무응답)'; if (t === '-') return '서술형'; return t.split('/').filter(Boolean).map(g => g.split('').map(d => circ[parseInt(d, 10) - 1] || d).join(' ')).join(' 또는 '); };
    const c = createCanvas(Math.round(widthPt * sc), h * sc), ctx = c.getContext('2d');
    ctx.fillStyle = '#F3F4F6'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#0B1F5C'; ctx.fillRect(0, 0, 2.5 * sc, c.height);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    let x = 8 * sc; const cy = c.height / 2 + 0.4 * sc;
    entries.forEach((e, i) => {
      const parts = [];
      if (true) parts.push([e.n + '번  ', '#0B1F5C']);
      parts.push(['내 답 ', '#6B7280'], [fmt(e.given), '#C1392B'], ['   정답 ', '#6B7280'], [fmt(e.answer), '#0B1F5C']);
      if (i < entries.length - 1) parts.push(['      ', '#000']);
      parts.forEach(pt => { ctx.font = 'bold ' + (9.5 * sc) + 'px ' + FONT; ctx.fillStyle = pt[1]; ctx.fillText(pt[0], x, cy); x += ctx.measureText(pt[0]).width; });
    });
    return { base64: canvasToBase64(c), w: widthPt, h: h };
  }
  function wrongNoteHeaderPng(title, sub, widthPt) {
    const sc = 4, h = 30, FONT = '"Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif';
    const c = createCanvas(Math.round(widthPt * sc), h * sc), ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#0B1F5C'; ctx.fillRect(0, 0, 66 * sc, c.height);
    ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.font = 'bold ' + (13 * sc) + 'px ' + FONT;
    ctx.fillText('오답노트', 33 * sc, c.height / 2 + 0.5 * sc);
    ctx.textAlign = 'left';
    let fs = 13, subW = 0;
    ctx.font = (9 * sc) + 'px ' + FONT; subW = ctx.measureText(sub).width / sc;
    const room = widthPt - 66 - 14 - subW - 12;
    ctx.font = 'bold ' + (fs * sc) + 'px ' + FONT;
    while (fs > 8 && ctx.measureText(title).width / sc > room) { fs -= 0.5; ctx.font = 'bold ' + (fs * sc) + 'px ' + FONT; }
    ctx.fillStyle = '#111'; ctx.fillText(title, 78 * sc, c.height / 2 + 0.5 * sc);
    ctx.fillStyle = '#6B7280'; ctx.font = (9 * sc) + 'px ' + FONT; ctx.textAlign = 'right'; ctx.fillText(sub, (widthPt - 2) * sc, c.height / 2 + 0.5 * sc);
    ctx.strokeStyle = '#0B1F5C'; ctx.lineWidth = 1.2 * sc; ctx.beginPath(); ctx.moveTo(0, c.height - 0.6 * sc); ctx.lineTo(c.width, c.height - 0.6 * sc); ctx.stroke();
    return { base64: canvasToBase64(c), w: widthPt, h: h };
  }
  async function composeWrongNotePdf(PDFLib, items, opts) {
    opts = opts || {};
    const { PDFDocument, rgb } = PDFLib;
    const doc = await PDFDocument.create();
    const nfont = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
    const W = 595.28, H = 841.89, marginX = 30, marginBottom = 40, gap = 12, colGap = 14;
    const areaW = W - marginX * 2, colW = (areaW - colGap) / 2, colX = [marginX, marginX + colW + colGap];
    const hdr = wrongNoteHeaderPng((opts.studentName || '') + (opts.examTitle ? '  ·  ' + opts.examTitle : ''), '틀린 ' + (opts.wrongCount != null ? opts.wrongCount : items.length) + '문항' + (opts.scoreText ? '  ·  ' + opts.scoreText : ''), areaW);
    const headImg = await doc.embedPng(b64ToBytes(hdr.base64));
    const marginTop = 28 + hdr.h + 14, maxH = H - marginTop - marginBottom;
    let page, ys, col;
    function newPage() {
      page = doc.addPage([W, H]);
      page.drawImage(headImg, { x: marginX, y: H - 28 - hdr.h, width: areaW, height: hdr.h });
      page.drawLine({ start: { x: marginX + colW + colGap / 2, y: H - marginTop + 4 }, end: { x: marginX + colW + colGap / 2, y: marginBottom - 4 }, thickness: 0.6, color: rgb(0.8, 0.8, 0.8) });
      ys = [H - marginTop, H - marginTop]; col = 0;
    }
    function place(need, wide) {
      if (wide) { let top = Math.min(ys[0], ys[1]); if (top - need < marginBottom) { newPage(); top = ys[0]; } col = 0; return { top: top, x: marginX, w: areaW, wide: true }; }
      if (ys[col] - need < marginBottom) { if (col === 0) col = 1; else newPage(); }
      if (ys[col] - need < marginBottom && ys[col] < H - marginTop) { if (col === 0) col = 1; else newPage(); }
      if (ys[col] - need < marginBottom) newPage();
      return { top: ys[col], x: colX[col], w: colW, wide: false };
    }
    function advance(p, used) { if (p.wide) ys[0] = ys[1] = p.top - used - gap; else ys[col] = p.top - used - gap; }
    newPage();
    const blank = opts.blank || 0;
    for (const it of items) {
      const img = await doc.embedPng(b64ToBytes(it.base64));
      const wide = (it.naturalW || 0) > colW * 1.45, fullW = wide ? areaW : colW;
      let dw = Math.min(fullW, it.naturalW || fullW), dh = it.height * (dw / it.width);
      const lab = wrongNoteLabelPng(it.entries, dw), labImg = await doc.embedPng(b64ToBytes(lab.base64));
      const extra = lab.h + 4 + (blank ? blank + 4 : 0);
      const limit = maxH - extra;
      if (dh > limit) { dw *= limit / dh; dh = limit; }
      const p = place(dh + extra, wide);
      page.drawImage(img, { x: p.x, y: p.top - dh, width: dw, height: dh });
      if (it.numRect && it.naturalW && it.num) {          // 문제은행 문항: 옛 번호를 지우고 시험지 번호(진한 파란 원)를 덮는다
        const RB = rgb(0.043, 0.122, 0.361), t = String(it.num), fs = t.length > 2 ? 9 : (t.length > 1 ? 10.5 : 12), tw = nfont.widthOfTextAtSize(t, fs);
        const k = dw / it.naturalW, nr = it.numRect, left = p.x + nr[0] * k, right = p.x + nr[2] * k, top = p.top - nr[1] * k, bottom = p.top - nr[3] * k;
        page.drawRectangle({ x: left - 1.5, y: bottom - 1.5, width: (right - left) + 3, height: (top - bottom) + 3, color: rgb(1, 1, 1) });
        const cx = (left + right) / 2, cy = top - (top - bottom) * 0.46, r = Math.max(9.5, Math.min(12, (top - bottom) * 0.62));
        if (t.length > 2) page.drawRectangle({ x: cx - tw / 2 - 5, y: cy - r, width: tw + 10, height: r * 2, color: RB }); else page.drawCircle({ x: cx, y: cy, size: r, color: RB });
        page.drawText(t, { x: cx - tw / 2, y: cy - fs * 0.34, size: fs, font: nfont, color: rgb(1, 1, 1) });
      }
      page.drawImage(labImg, { x: p.x, y: p.top - dh - 2 - lab.h, width: dw, height: lab.h });
      let used = dh + lab.h + 4;
      if (blank) {
        page.drawRectangle({ x: p.x, y: p.top - used - blank, width: dw, height: blank, borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.6, borderDashArray: [3, 3] });
        used += blank + 4;
      }
      if (opts.withExpl && it.explBase64) {
        const eimg = await doc.embedPng(b64ToBytes(it.explBase64));
        let ew = Math.min(fullW, it.explW / 2.2), eh = it.explH * (ew / it.explW);
        if (eh > maxH) { ew *= maxH / eh; eh = maxH; }
        if (p.top - used - 4 - eh >= marginBottom) {
          page.drawImage(eimg, { x: p.x, y: p.top - used - 4 - eh, width: ew, height: eh });
          used += 4 + eh; advance(p, used);
        } else {
          advance(p, used);
          let ew2 = Math.min(ew, colW), eh2 = it.explH * (ew2 / it.explW);
          if (eh2 > maxH) { ew2 *= maxH / eh2; eh2 = maxH; }
          const p2 = place(eh2, false);
          page.drawImage(eimg, { x: p2.x, y: p2.top - eh2, width: ew2, height: eh2 });
          advance(p2, eh2);
        }
      } else advance(p, used);
    }
    return doc;
  }

  // 정답표: 선생님이 입력해 둔 정답을 표로 만든다 (해설이 없는 문항도 정답은 꼭 들어간다). 한글이 들어가서 그림으로 그려 넣는다.
  // picks: [{ answer, kind, school, year, unit }] 순서대로 1번부터. 해설 그림 문서(explDoc)가 있으면 정답표 뒤에 이어붙인다.
  async function answerSheetDoc(PDFLib, title, picks, explDoc, sub) {
    const doc = await PDFLib.PDFDocument.create();
    const W = 595.28, H = 841.89, SC = 2.4;
    const N = picks.length, perPage = 80, groups = 5;
    const circ = '①②③④⑤⑥⑦⑧⑨';
    const fmt = a => { const t = String(a == null ? '' : a).replace(/[^0-9\-\/]/g, ''); if (!t) return '(없음)'; if (t === '-') return '서술형'; return t.split('/').filter(Boolean).map(g => g.split('').map(d => circ[parseInt(d, 10) - 1] || d).join(' ')).join(' 또는 '); };
    const FONT = '"Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif';
    for (let start = 0; start < N || start === 0; start += perPage) {
      const chunk = picks.slice(start, start + perPage);
      const c = createCanvas(Math.round(W * SC), Math.round(H * SC)), ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.scale(SC, SC);
      ctx.fillStyle = '#111'; ctx.font = 'bold 18px ' + FONT; ctx.textBaseline = 'top';
      { let tfs = 18; const tt = title + ' 정답'; ctx.font = 'bold ' + tfs + 'px ' + FONT; while (tfs > 10 && ctx.measureText(tt).width > W - 72) { tfs -= 0.5; ctx.font = 'bold ' + tfs + 'px ' + FONT; } ctx.fillText(tt, 36, 34 + (18 - tfs) / 2); }
      ctx.fillStyle = '#6B7280'; ctx.font = '10px ' + FONT;
      ctx.fillText(sub || '※ 번호는 시험지의 진한 파란 원 번호와 같아요.', 36, 60);
      const rows = Math.ceil(chunk.length / groups), rowH = 24, top = 92, gw = (W - 72) / groups;
      chunk.forEach((q, k) => {
        const g = k % groups, r = Math.floor(k / groups);        // 가로로 1 2 3 4 5 / 6 7 8 9 10 … 순서
        const x = 36 + g * gw, y = top + r * rowH;
        ctx.strokeStyle = '#E5E7EB'; ctx.lineWidth = 0.6;
        ctx.beginPath(); ctx.moveTo(x, y + rowH); ctx.lineTo(x + gw - 10, y + rowH); ctx.stroke();
        ctx.fillStyle = '#0B1F5C'; ctx.beginPath(); ctx.arc(x + 10, y + rowH / 2, 9, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 10px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(start + k + 1), x + 10, y + rowH / 2 + 0.5);
        ctx.textAlign = 'left'; ctx.fillStyle = '#111'; ctx.font = 'bold 13px ' + FONT;
        ctx.fillText(fmt(q.answer), x + 28, y + rowH / 2 + 0.5);
        ctx.textBaseline = 'top';
      });
      const page = doc.addPage([W, H]);
      const img = await doc.embedPng(b64ToBytes(canvasToBase64(c)));
      page.drawImage(img, { x: 0, y: 0, width: W, height: H });
      if (start + perPage >= N) break;
    }
    if (explDoc) {
      const copied = await doc.copyPages(explDoc, explDoc.getPageIndices());
      copied.forEach(p => doc.addPage(p));
    }
    return doc;
  }

  // 시험지 PDF 뒤에 해설지 PDF를 그대로 이어붙여서 한 파일로 만든다 (다운로드 한 번으로 끝나게).
  // 시험지 쪽수가 홀수면, 양면 인쇄했을 때 해설지가 시험지 마지막 장 뒷면에 붙지 않도록
  // 빈 페이지를 한 장 끼워서 해설지가 항상 새 장의 앞면부터 시작하게 한다.
  async function mergePdfs(PDFLib, mainDoc, extraDoc) {
    if (!extraDoc) return mainDoc;
    if (mainDoc.getPageCount() % 2 === 1) {
      const last = mainDoc.getPage(mainDoc.getPageCount() - 1);
      const { width, height } = last.getSize();
      mainDoc.addPage([width, height]);   // 빈 페이지 (아무것도 안 그림)
    }
    const idx = extraDoc.getPageIndices();
    const copied = await mainDoc.copyPages(extraDoc, idx);
    copied.forEach(p => mainDoc.addPage(p));
    return mainDoc;
  }

  // 완성된 문서의 모든 쪽 아래에 "N / 전체" 쪽번호를 찍는다. 맨 마지막에, 쪽수가 다 정해진
  // 뒤에 한 번만 호출한다.
  async function addPageNumbers(PDFLib, doc, opts) {
    opts = opts || {};
    const { StandardFonts, rgb } = PDFLib;
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = doc.getPages();
    const total = pages.length;
    // 위·아래 가장자리에 작게 넣는 "이은정 과학" 로고 글자
    let logo = null;
    try {
      const sc = 8, fs = opts.logoSize || 7, f = 'bold ' + (fs * sc) + 'px "Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif';
      const m = createCanvas(10, 10).getContext('2d'); m.font = f;
      const w = Math.ceil(m.measureText('이은정 과학').width / sc) + 2, h = Math.ceil(fs * 1.45);
      const c = createCanvas(w * sc, h * sc), ctx = c.getContext('2d');
      ctx.font = f; ctx.fillStyle = '#0B1F5C'; ctx.textBaseline = 'middle'; ctx.fillText('이은정 과학', sc, h * sc / 2 + sc * 0.3);
      logo = { img: await doc.embedPng(b64ToBytes(canvasToBase64(c))), w: w, h: h };
    } catch (e) { logo = null; }
    pages.forEach((page, i) => {
      const t = (i + 1) + ' / ' + total;
      const fs = 9, tw = font.widthOfTextAtSize(t, fs);
      page.drawText(t, { x: page.getWidth() / 2 - tw / 2, y: 16, size: fs, font: font, color: rgb(0.55, 0.55, 0.55) });
      if (logo) {
        const W = page.getWidth(), H = page.getHeight();
        page.drawImage(logo.img, { x: W / 2 - logo.w / 2, y: H - logo.h - (opts.logoTop || 3), width: logo.w, height: logo.h, opacity: 0.75 });    // 위 가운데
        page.drawImage(logo.img, { x: W - logo.w - 24, y: 11, width: logo.w, height: logo.h, opacity: 0.75 });                      // 아래 오른쪽
      }
    });
  }

  // ── 암호(복사방지)가 걸려서 pdf-lib이 내용을 못 읽는 PDF를 다룬다 ──
  // pdf-lib은 PDF 안의 글자·그림(스트림) 자체를 푸는 기능이 없어서, 암호가 걸린 파일은
  // ignoreEncryption으로 "일단 열기"는 되어도 저장한 결과물이 속 내용은 깨진 채로 나온다.
  // 반면 pdf.js는 화면에 보여주려고 이미 암호를 풀고 있으니(스캔 때 쓰던 바로 그 기능),
  // 그 결과(화면에 그려진 모습)를 그대로 사진처럼 떠서 새 PDF를 만든다. 글자를 선택은
  // 못 하게 되지만, 내용이 깨지지 않고 확실하게 열린다.
  // onlyPages를 주면(배열이 1개 이상) 그 쪽들만 포함한다(해설지 뽑을 때 씀).
  // 안 주면 excludePages만 빼고 전부 포함한다(학생용 시험지 만들 때 씀).
  async function rasterizeToPdf(PDFLib, doc, excludePages, scale, onlyPages) {
    const out = await PDFLib.PDFDocument.create();
    const exclude = new Set(excludePages || []);
    const only = onlyPages && onlyPages.length ? new Set(onlyPages) : null;
    const sc = scale || 2.2;
    for (let p = 1; p <= doc.numPages; p++) {
      if (only ? !only.has(p) : exclude.has(p)) continue;
      const page = await doc.getPage(p);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: sc });
      const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const bytes = b64ToBytes(canvasToBase64(canvas));
      const img = await out.embedPng(bytes);
      const newPage = out.addPage([vp1.width, vp1.height]);
      newPage.drawImage(img, { x: 0, y: 0, width: vp1.width, height: vp1.height });
    }
    return out;
  }

  // pdf-lib으로 이 PDF를 다룰 수 있는지(암호 때문에 내용이 깨지지 않는지) 확인한다.
  // 진짜 열어 보는 것 말고는 확실한 방법이 없어서, 실제로 열어서 /Encrypt 표시가 있는지 본다.
  async function needsRasterize(PDFLib, bytes) {
    try {
      await PDFLib.PDFDocument.load(bytes.slice(0));
      return false;   // 암호가 없으면 평소대로 처리
    } catch (e) {
      return /encrypted/i.test(e.message || '');
    }
  }

  // ── PDF 위에 표시한 "이 자리 지우기" 영역을 실제로 흰색으로 덮는다 ──
  // redactions: [{page, rect:[x0,top,x1,bottom]}] (rect는 페이지 위쪽 기준 좌표, PdfPane이 쓰는 것과 동일)
  // 정답에 노란 형광펜(1 1 0 rg 같은 노란 채우기)이 칠해진 시험지: 쪽 내용의 노란 채우기 색을 흰색으로 바꿔 학생용 PDF에서 정답 표시를 지운다.
  async function stripYellowHighlights(PDFLib, pdfDoc) {
    let n = 0;
    try {
      const { PDFName, PDFRawStream, decodePDFRawStream, PDFArray } = PDFLib;
      const ctx = pdfDoc.context, dec = { decode: b => { let t = ''; for (let i = 0; i < b.length; i += 8192) t += String.fromCharCode.apply(null, b.subarray(i, Math.min(b.length, i + 8192))); return t; } };
      const fix = txt => txt.replace(/(^|[\s\]])(\d*\.?\d+)\s+(\d*\.?\d+)\s+(\d*\.?\d+)\s+(rg|RG|sc|scn)(?=\s|$)/g, (m, pre, a, b, c2, op) => {
        const r = parseFloat(a), g = parseFloat(b), bl = parseFloat(c2);
        if (op !== 'RG' && r >= 0.85 && g >= 0.85 && bl <= 0.35 && Math.abs(r - g) <= 0.12) { n++; return pre + '1 1 1 ' + op; }
        return m;
      });
      for (const page of pdfDoc.getPages()) {
        let cont = page.node.Contents(); if (!cont) continue;
        const list = cont instanceof PDFArray ? cont.asArray().map(r => ctx.lookup(r)) : [cont];
        const before = n; let all = '';
        for (const st of list) { if (!st) continue; const bytes = (st instanceof PDFRawStream) ? decodePDFRawStream(st).decode() : st.getUnencodedContents(); all += dec.decode(bytes) + '\n'; }
        const out = fix(all);
        if (n === before) continue;
        const bytes = new Uint8Array(out.length); for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 255;
        page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(bytes)));
      }
    } catch (e) { console.warn('형광펜 지우기 실패', e); }
    return n;
  }
  function applyRedactions(PDFLib, doc, redactions) {
    const { rgb } = PDFLib;
    (redactions || []).forEach(r => {
      const idx = r.page - 1;
      if (idx < 0 || idx >= doc.getPageCount()) return;
      const page = doc.getPage(idx);
      const h = page.getHeight();
      const [x0, top, x1, bottom] = r.rect;
      page.drawRectangle({
        x: Math.min(x0, x1), y: h - Math.max(top, bottom),
        width: Math.abs(x1 - x0), height: Math.abs(bottom - top),
        color: rgb(1, 1, 1),
      });
    });
  }

  // ── 출처 워터마크·사이트명처럼 흔히 지우고 싶어하는 글자를 자동으로 찾아 위치를 알려준다 ──
  // (정확한 글자를 못 찾아도 괜찮다 — 어차피 선생님이 직접 드래그로 지울 수 있으니, 이건 "그냥 도와주는" 정도)
  const WATERMARK_RE = /족보\s*닷\s*컴|족보닷컴|zocbo|기출비급|교육지대|스카이에듀|이투스|해법교육|해커스|메가스터디|엠베스트|비상교육|천재교육|미래엔|동아출판|지학사|\.com\b|\.co\.kr\b|워터마크|저작권|무단\s*(복제|전재|배포)|콘텐츠산업\s*진흥법|ⓒ|©|copyright/i;
  const NAME_FIELD_RE = /이\s*름\s*[:：]|성\s*명\s*[:：]|반\s*[:：]|번\s*호\s*[:：]/;
  const FOOTER_ZONE = 0.86;      // 쪽 높이의 아래쪽 14%를 "꼬리말 자리"로 본다

  // ── 글자를 줄·문단으로 묶기 ──────────────────────────────────────────────
  // pdf.js는 글자를 짧은 조각(item)으로 돌려주니, 같은 기준선에 있는 것끼리 한 줄로 묶는다.
  function linesOf(pd) {
    const its = pd.items.slice().sort((a, b) => a.base - b.base || a.x - b.x);
    const rows = [];
    its.forEach(it => {
      const last = rows[rows.length - 1];
      const tol = Math.max(1.5, 0.45 * it.size);
      if (last && Math.abs(it.base - last.base) <= tol) {
        last.items.push(it);
        last.base = (last.base * (last.items.length - 1) + it.base) / last.items.length;
      } else rows.push({ items: [it], base: it.base });
    });
    // 같은 높이에 있어도 가로로 멀리 떨어져 있으면(예: 왼쪽 안내문 / 가운데 쪽번호 / 오른쪽 문서번호) 서로 다른 덩어리다
    const lines = [];
    rows.forEach(row => {
      row.items.sort((a, b) => a.x - b.x);
      let cur = null;
      row.items.forEach(it => {
        const gapLimit = Math.max(16, 2.2 * it.size);
        if (cur && it.x - cur.x1 <= gapLimit) { cur.items.push(it); cur.x1 = Math.max(cur.x1, it.x + it.w); }
        else { cur = { items: [it], base: row.base, x1: it.x + it.w }; lines.push(cur); }
      });
    });
    lines.forEach(L => {
      L.x0 = Math.min.apply(null, L.items.map(i => i.x));
      L.x1 = Math.max.apply(null, L.items.map(i => i.x + i.w));
      L.top = Math.min.apply(null, L.items.map(i => i.top));
      L.bottom = Math.max.apply(null, L.items.map(i => i.bottom));
      L.size = L.items.reduce((a, i) => a + i.size, 0) / L.items.length;
    });
    return lines.sort((a, b) => a.top - b.top || a.x0 - b.x0);
  }
  const similarSize = (a, b) => { const r = a / b; return r >= 0.75 && r <= 1.35; };
  const overlapsX = (A, B, tol) => A.x0 <= B.x1 + tol && A.x1 >= B.x0 - tol;

  // 한 줄(line)이 속한 "문단"의 영역을 구한다: 글자 크기가 비슷하고, 줄 간격이 붙어 있고(한 줄 이상 안 떨어짐),
  // 가로로 겹치는 줄들을 위아래로 계속 이어 붙인다.
  function paragraphLines(lines, start) {
    const block = [start];
    let b = { x0: start.x0, x1: start.x1, top: start.top, bottom: start.bottom };
    let grew = true;
    while (grew) {
      grew = false;
      for (const L of lines) {
        if (block.indexOf(L) >= 0 || !similarSize(L.size, start.size) || !overlapsX(L, b, 12)) continue;
        const gap = L.top >= b.bottom ? L.top - b.bottom : (b.top >= L.bottom ? b.top - L.bottom : -1);
        if (gap < 0 || gap > 0.9 * start.size) continue;        // 겹치거나(같은 줄 옆) 너무 떨어진 줄은 다른 문단
        block.push(L);
        b = { x0: Math.min(b.x0, L.x0), x1: Math.max(b.x1, L.x1), top: Math.min(b.top, L.top), bottom: Math.max(b.bottom, L.bottom) };
        grew = true;
      }
    }
    return { lines: block, box: b };
  }

  // 꼬리말 안내문 계산: 꼬리말 자리(쪽 아래쪽)의 줄들을 문단으로 묶고, 바로 옆에 이어 붙은(같은 글자 크기, 14pt 이내)
  // 다른 문단도 같은 안내문의 일부라서 하나로 합친다 (예: 왼쪽 "제작자·보호 기간" + 오른쪽 "무단 복제 금지").
  // 쪽번호처럼 글자 크기가 다른 건 합치지 않는다. 쪽마다 한 번만 계산해서 같은 줄은 어디서 출발해도 같은 영역이 나온다.
  function footerNotices(pd, lines) {
    if (pd._notices) return pd._notices;
    const zone = lines.filter(L => L.top >= pd.H * FOOTER_ZONE);
    const assigned = new Set(), paras = [];
    zone.forEach(L => {
      if (assigned.has(L)) return;
      const blk = paragraphLines(zone, L);
      blk.lines.forEach(x => assigned.add(x));
      paras.push({ lines: new Set(blk.lines), box: blk.box, size: L.size });
    });
    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i < paras.length && !merged; i++) for (let j = i + 1; j < paras.length && !merged; j++) {
        const A = paras[i], B = paras[j];
        if (!similarSize(A.size, B.size)) continue;
        const near = A.box.x0 <= B.box.x1 + 14 && A.box.x1 >= B.box.x0 - 14;
        const vOverlap = Math.min(A.box.bottom, B.box.bottom) - Math.max(A.box.top, B.box.top);
        if (!near || vOverlap < 0.4 * Math.min(A.box.bottom - A.box.top, B.box.bottom - B.box.top)) continue;
        B.lines.forEach(x => A.lines.add(x));
        A.box = { x0: Math.min(A.box.x0, B.box.x0), x1: Math.max(A.box.x1, B.box.x1), top: Math.min(A.box.top, B.box.top), bottom: Math.max(A.box.bottom, B.box.bottom) };
        paras.splice(j, 1); merged = true;
      }
    }
    pd._notices = paras;
    return paras;
  }
  function footerRectAround(pd, lines, line) {
    const n = footerNotices(pd, lines).find(P => P.lines.has(line));
    const box = n ? n.box : { x0: line.x0, x1: line.x1, top: line.top, bottom: line.bottom };
    return [box.x0 - 3, box.top - 2.5, box.x1 + 3, box.bottom + 2.5];
  }

  // ── 족보닷컴·교육지대 같은 출처 표시(로고·일련번호·안내 문구)를 자동으로 찾는다 ──
  // 로고는 그림이라 글자로는 안 잡히지만, 바로 옆에 "I410-141-25-99-091285995" 같은 일련번호 글자가 같은 줄에 있다.
  // 그 줄(로고 + 번호 + 쪽번호) 전체를 지우면 로고도 같이 지워진다.
  const SRC_CODE_RE = /^[A-Za-z0-9]{1,6}(?:-[A-Za-z0-9]{1,12}){3,}$/;
  const SRC_TEXT_RE = /학교별\s*족보|족보\s*닷\s*컴|족보닷컴|교육지대|콘텐츠산업\s*진흥법|제작연월일|zocbo/i;
  function sourceMarkRects(pd) {
    if (pd._srcMarks) return pd._srcMarks;
    const out = [], lines = linesOf(pd);
    lines.forEach(L => {
      const hasCode = L.items.some(it => SRC_CODE_RE.test(it.str.trim()) && /\d/.test(it.str));
      const zoneLow = L.top >= pd.H * 0.88, zoneHigh = L.bottom <= pd.H * 0.07;
      if (hasCode && (zoneLow || zoneHigh)) { out.push({ rect: [0, Math.max(0, L.top - 6), pd.W, zoneLow ? pd.H : L.bottom + 14], text: L.items.map(i => i.str).join(' ').trim().slice(0, 30), kind: 'code' }); return; }
      if (L.items.some(it => SRC_TEXT_RE.test(it.str)) || SRC_TEXT_RE.test(L.items.map(i => i.str).join(''))) {
        const blk = paragraphLines(lines, L);
        if (blk.lines.length > 6) return;
        const b = blk.box;
        // 칸(테두리)이 남지 않도록 사방으로 넉넉히 넓히되, 단 구분선(쪽 가운데)은 넘지 않는다
        const mid = pd.W / 2, G = 9;
        let x0 = b.x0 - 8, x1 = b.x1 + 8;
        if (b.x1 <= mid) x1 = Math.min(x1, mid - G); else if (b.x0 >= mid) x0 = Math.max(x0, mid + G);
        out.push({ rect: [Math.max(0, x0), Math.max(0, b.top - 8), Math.min(pd.W, x1), Math.min(pd.H, b.bottom + 8)], text: L.items.map(i => i.str).join(' ').trim().slice(0, 30), kind: 'text' });
      }
    });
    // 겹치는 것은 하나로
    const uniq = [];
    out.forEach(o => { if (!uniq.some(u => Math.abs(u.rect[1] - o.rect[1]) < 2 && Math.abs(u.rect[3] - o.rect[3]) < 2 && Math.abs(u.rect[0] - o.rect[0]) < 3)) uniq.push(o); });
    // 쪽 아래 출처 표시(안내 문구·일련번호)가 있으면, 그 옆의 작은 로고·마크 그림(글자가 아니라서 안 잡힘)도 같이 지우도록 쪽 맨 아래 띠 전체를 지운다
    const low = uniq.filter(o => o.rect[1] >= pd.H * 0.88);
    if (low.length) {
      const mt = Math.min.apply(null, low.map(o => o.rect[1]));
      let lowB = 0; pd.items.forEach(it => { if (String(it.str).trim() && it.top < mt - 7 && it.bottom > mt - 7 && it.bottom > lowB) lowB = it.bottom; });     // 본문 맨 아래 글자는 지우지 않는다
      const y0 = Math.max(pd.H * 0.9, mt - 7, Math.min(lowB + 0.5, mt - 1));
      const keep = uniq.filter(o => o.rect[1] < pd.H * 0.88);
      keep.push({ rect: [0, y0, pd.W, pd.H], text: low[0].text, kind: 'footer' });
      pd._srcMarks = keep;
      return keep;
    }
    pd._srcMarks = uniq;
    return uniq;
  }
  // 첫 쪽 제목 칸에 "불암중 대비"처럼 특정 학교 이름이 들어간 제목이 있으면 찾는다 (기출문제가 아닌 예상·대비 시험지용)
  const SCHOOL_TITLE_RE = /[가-힣]{1,6}(?:중학교|고등학교|중|고)(?:대비|예상|모의|실전)/;
  async function findSchoolTitle(doc) {
    const pd = await pageItems(doc, 1), lines = linesOf(pd);
    for (const L of lines) {
      if (L.top > pd.H * 0.3) continue;
      const txt = L.items.map(it => it.str).join('').replace(/\s+/g, '');
      if (txt.length > 20 || !SCHOOL_TITLE_RE.test(txt)) continue;
      const others = pd.items.filter(it => L.items.indexOf(it) < 0 && it.bottom > L.top - 4 && it.top < L.bottom + 4 && String(it.str).trim());
      let left = 12, right = pd.W - 12;
      others.forEach(it => { if (it.x + it.w <= L.x0 + 1) left = Math.max(left, it.x + it.w); else if (it.x >= L.x1 - 1) right = Math.min(right, it.x); });
      return { rect: [L.x0, L.top, L.x1, L.bottom], size: L.size, left: left, right: right, pageW: pd.W, pageH: pd.H, text: txt };
    }
    return null;
  }
  // 그 제목을 지우고 그 자리에 시험지 제목(파일 제목)을 넣는다
  async function replaceSchoolTitle(PDFLib, pdfDoc, info, title) {
    if (!info || !title) return false;
    const page = pdfDoc.getPages()[0], k = page.getWidth() / info.pageW;
    const r = info.rect, FONT = '"Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif', sc = 8;
    const cx = (r[0] + r[2]) / 2, availW = Math.max(r[2] - r[0], Math.min(2 * Math.min(cx - info.left, info.right - cx) - 10, 330));
    const lineH = Math.max(10, r[3] - r[1]);
    let fs = Math.min(14, Math.max(9, info.size * 1.05)), lines = [title];
    const m = createCanvas(10, 10).getContext('2d');
    const w1 = f => { m.font = 'bold ' + (f * sc) + 'px ' + FONT; return m.measureText(title).width / sc; };
    while (fs > 9 && w1(fs) > availW) fs -= 0.5;
    if (w1(fs) > availW) {                              // 한 줄에 안 들어가면 두 줄로
      fs = Math.min(fs, 10.5); m.font = 'bold ' + (fs * sc) + 'px ' + FONT; lines = []; let cur = '';
      for (const ch of Array.from(title)) { if (m.measureText(cur + ch).width / sc > availW && cur) { lines.push(cur); cur = ch; } else cur += ch; }
      if (cur) lines.push(cur);
      if (lines.length > 2) { let t = lines.slice(1).join(''); while (t.length > 2 && m.measureText(t + '…').width / sc > availW) t = t.slice(0, -1); lines = [lines[0], t + '…']; }
    }
    const lh = fs * 1.25, W = Math.ceil(Math.max.apply(null, lines.map(t => { m.font = 'bold ' + (fs * sc) + 'px ' + FONT; return m.measureText(t).width / sc; }))) + 2, Hh = Math.ceil(lh * lines.length) + 2;
    const c = createCanvas(W * sc, Hh * sc), ctx = c.getContext('2d');
    ctx.font = 'bold ' + (fs * sc) + 'px ' + FONT; ctx.fillStyle = '#111'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    lines.forEach((t, i) => ctx.fillText(t, W * sc / 2, (lh * (i + 0.5) + 1) * sc));
    const img = await pdfDoc.embedPng(b64ToBytes(canvasToBase64(c)));
    const PH = page.getHeight(), cy = (r[1] + r[3]) / 2;
    // 옛 제목 글자 자리를 흰색으로 덮고(두 줄이면 위아래로 조금 더) 새 제목을 가운데에 올린다
    const padX = 3, padY = 2.5;
    page.drawRectangle({ x: (r[0] - padX) * k, y: PH - (r[3] + padY) * k, width: (r[2] - r[0] + padX * 2) * k, height: (r[3] - r[1] + padY * 2) * k, color: PDFLib.rgb(1, 1, 1) });
    page.drawImage(img, { x: (cx - W / 2) * k, y: PH - (cy + Hh / 2) * k, width: W * k, height: Hh * k });
    return true;
  }
  // 첫 쪽 맨 위의 "제목 칸"(학년·고사 종류·시험 이름·과목·성명이 든 큰 네모)을 찾는다.
  // 기출이 아니면 학교 이름이 있든 없든 이 칸을 통째로 바꾼다.
  async function findTitleBox(doc) {
    const page = await doc.getPage(1), pd = await pageItems(doc, 1);
    const OPS = (typeof pdfjsLib !== 'undefined' && pdfjsLib.OPS) || { save: 10, restore: 11, transform: 12, constructPath: 91 };
    const ol = await page.getOperatorList();
    let ctm = [1, 0, 0, 1, 0, 0]; const stk = [], cands = [], PH = pd.H;
    for (let i = 0; i < ol.fnArray.length; i++) {
      const fn = ol.fnArray[i], a = ol.argsArray[i];
      if (fn === OPS.save) stk.push(ctm.slice());
      else if (fn === OPS.restore) { if (stk.length) ctm = stk.pop(); }
      else if (fn === OPS.transform) { const m = ctm; ctm = [m[0] * a[0] + m[2] * a[1], m[1] * a[0] + m[3] * a[1], m[0] * a[2] + m[2] * a[3], m[1] * a[2] + m[3] * a[3], m[0] * a[4] + m[2] * a[5] + m[4], m[1] * a[4] + m[3] * a[5] + m[5]]; }
      else if (fn === OPS.constructPath && a[1] && a[1].length >= 8) {
        if (Math.abs(ctm[0] - 1) > 0.01 || Math.abs(ctm[3] - 1) > 0.01 || Math.abs(ctm[1]) > 0.01) continue;
        const c = a[1]; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
        for (let j = 0; j + 1 < c.length; j += 2) { const x = c[j] + ctm[4], y = c[j + 1] + ctm[5]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        const top = PH - y1, bot = PH - y0;
        if (x1 - x0 > pd.W * 0.7 && x1 - x0 < pd.W * 0.98 && bot - top >= 30 && bot - top <= 130 && top < PH * 0.2 && bot < PH * 0.25) cands.push({ x0: x0, x1: x1, top: top, bot: bot });
      }
    }
    if (!cands.length) return null;
    cands.sort((p, q) => (q.x1 - q.x0) * (q.bot - q.top) - (p.x1 - p.x0) * (p.bot - p.top));
    const b = cands[0];
    const inside = pd.items.filter(it => String(it.str).trim() && it.x >= b.x0 - 2 && it.x + it.w <= b.x1 + 2 && it.top >= b.top - 2 && it.bottom <= b.bot + 2);
    if (!inside.length) return null;
    if (inside.length < 3) return null;                                  // 글자가 거의 없는 네모는 제목칸이 아니다
    return { rect: [b.x0, b.top, b.x1, b.bot], pageW: pd.W, pageH: pd.H };
  }
  // 제목칸 네모를 못 찾았을 때: 첫 쪽 맨 위에서 글자·그림·도형이 모여 있는 맨 위 덩어리(= 제목 머리 부분)를 찾는다.
  // 아래 본문과 20pt 넘게 떨어져 있을 때만 돌려준다 (본문과 붙어 있으면 위험하니 null).
  async function findHeaderCluster(doc) {
    const page = await doc.getPage(1), pd = await pageItems(doc, 1), PH = pd.H;
    const ext = [];
    pd.items.forEach(it => { if (String(it.str).trim() && it.top < PH * 0.3) ext.push({ t: it.top, b: it.bottom, x0: it.x, x1: it.x + it.w, txt: it.str }); });
    const imgRects = (pd.imgs && pd.imgs.length) ? pd.imgs : await pageImageRects(page, page.getViewport({ scale: 1 }));
    imgRects.forEach(r => { if (r[1] < PH * 0.3 && r[3] - r[1] < PH * 0.3 && (r[2] - r[0]) > 4 && (r[2] - r[0]) < pd.W * 0.97) ext.push({ t: r[1], b: r[3], x0: r[0], x1: r[2] }); });
    const O = (typeof pdfjsLib !== 'undefined' && pdfjsLib.OPS) || { save: 10, restore: 11, transform: 12, constructPath: 91 };
    const ol = await page.getOperatorList(); let ctm = [1, 0, 0, 1, 0, 0]; const stk = [];
    for (let i = 0; i < ol.fnArray.length; i++) {
      const fn = ol.fnArray[i], a = ol.argsArray[i];
      if (fn === O.save) stk.push(ctm.slice()); else if (fn === O.restore) { if (stk.length) ctm = stk.pop(); }
      else if (fn === O.transform) { const m = ctm; ctm = [m[0] * a[0] + m[2] * a[1], m[1] * a[0] + m[3] * a[1], m[0] * a[2] + m[2] * a[3], m[1] * a[2] + m[3] * a[3], m[0] * a[4] + m[2] * a[5] + m[4], m[1] * a[4] + m[3] * a[5] + m[5]]; }
      else if (fn === O.constructPath && a[1] && a[1].length >= 4) {
        const c = a[1]; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
        for (let j = 0; j + 1 < c.length; j += 2) { const x = ctm[0] * c[j] + ctm[2] * c[j + 1] + ctm[4], y = ctm[1] * c[j] + ctm[3] * c[j + 1] + ctm[5]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        const t = PH - y1, b = PH - y0;
        if (x1 - x0 > pd.W * 0.97 && b - t > PH * 0.5) continue;                 // 쪽 전체 바탕
        if (t < PH * 0.3 && t >= 0 && b - t < PH * 0.3) ext.push({ t: t, b: b, x0: x0, x1: x1 });
      }
    }
    if (!ext.length) return null;
    ext.sort((p, q) => p.t - q.t);
    const cl = { t: ext[0].t, b: ext[0].b, x0: ext[0].x0, x1: ext[0].x1 }; let nextT = null;
    for (let i = 1; i < ext.length; i++) {
      const e = ext[i];
      if (e.t - cl.b <= 9 && Math.max(cl.b, e.b) - cl.t <= 80) { cl.b = Math.max(cl.b, e.b); cl.x0 = Math.min(cl.x0, e.x0); cl.x1 = Math.max(cl.x1, e.x1); } else { nextT = e.t; break; }
    }
    if (nextT === null || cl.b - cl.t < 18 || cl.b > PH * 0.22) return null;
    const x0 = Math.max(0, Math.min(cl.x0 - 4, 57)), x1 = Math.min(pd.W, Math.max(cl.x1 + 4, pd.W - 57));
    return { rect: [x0, Math.max(0, cl.t - 3), x1, cl.b + 3], pageW: pd.W, pageH: pd.H };
  }
  // 그 제목 칸을 흰색으로 덮고, 강사용 시험지와 같은 모양의 제목 배지(학년 | 과학 + 시험 제목)를 올린다
  async function replaceTitleBox(PDFLib, pdfDoc, box, title, qr) {
    if (!box || !title) return false;
    const page = pdfDoc.getPages()[0], k = page.getWidth() / box.pageW, PH = page.getHeight(), r = box.rect;
    const w = r[2] - r[0], pad = 2;
    page.drawRectangle({ x: (r[0] - pad) * k, y: PH - (r[3] + pad) * k, width: (w + pad * 2) * k, height: (r[3] - r[1] + pad * 2) * k, color: PDFLib.rgb(1, 1, 1) });
    const h = 48, cy = (r[1] + r[3]) / 2;
    let hw = w;                                                       // QR이 제목 배지 영역을 넘어오면 배지를 QR 앞에서 끝낸다
    if (qr && qr.x0 > r[0] + 200 && qr.x0 < r[2] && qr.bottom > cy - h / 2 - 2 && qr.top < cy + h / 2 + 2) hw = qr.x0 - r[0];
    const hx = headerPngEx(title, Math.round(hw), ' '), img = await pdfDoc.embedPng(b64ToBytes(hx.b64));
    page.drawImage(img, { x: r[0] * k, y: PH - (Math.max(32, cy - hx.h / 2) + hx.h) * k, width: hw * k, height: hx.h * k });
    return true;
  }
  // 제목칸을 못 찾았을 때: 첫 쪽 맨 위에 제목 배지를 그냥 붙인다. 위쪽 여백이 모자라면 첫 쪽 내용을 조금 줄여서 자리를 만든다.
  async function stampTitleHeader(PDFLib, pdfDoc, doc, title, qr) {
    if (!title) return false;
    const pd = await pageItems(doc, 1);
    let topC = pd.H;
    pd.items.forEach(it => { if (String(it.str).trim()) topC = Math.min(topC, it.top); });
    try { ((pd.imgs && pd.imgs.length) ? pd.imgs : await pageImageRects(await doc.getPage(1), (await doc.getPage(1)).getViewport({ scale: 1 }))).forEach(r => { if (!r[4] && r[1] >= 0 && (r[2] - r[0]) > 8) topC = Math.min(topC, r[1]); }); } catch (e) {}
    const page = pdfDoc.getPages()[0], W = page.getWidth(), PH = page.getHeight(), k = PH / pd.H;
    let hw = Math.round(W - 2 * 57);
    if (qr && qr.x0 > 57 + 200 && qr.x0 < 57 + hw && qr.bottom > 18) hw = Math.round(qr.x0 - 57);   // QR이 배지 영역을 넘어오면 QR 앞에서 끝낸다
    const hx = headerPngEx(title, hw, ' '), img = await pdfDoc.embedPng(b64ToBytes(hx.b64)), NEED = 32 + hx.h + 8;
    let target = page;
    if (topC * k < NEED) {
      try {
        const [emb] = await pdfDoc.embedPages([page]);
        const s = (PH - NEED) / PH;
        pdfDoc.removePage(0);
        target = pdfDoc.insertPage(0, [W, PH]);
        target.drawPage(emb, { x: (W - W * s) / 2, y: 0, xScale: s, yScale: s });
      } catch (e) { target = pdfDoc.getPages()[0]; console.warn('첫 쪽 줄이기 실패 — 그냥 위에 붙입니다', e); }
    }
    const top = Math.max(32, Math.min(NEED - hx.h - 6, topC * k - hx.h - 6));
    target.drawImage(img, { x: 57, y: PH - top - hx.h, width: hw, height: hx.h });
    return true;
  }
  // 여러 쪽 맨 위에 똑같이 반복되는 머릿말("불암중 대비" 같은 학교·시험 이름)을 찾는다. 첫 쪽의 제목은 건드리지 않고 2쪽부터만 지운다.
  async function findRunningHeaders(doc) {
    const out = [];
    if (doc.numPages < 4) return out;
    const pages = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const pd = await pageItems(doc, p), lines = linesOf(pd).filter(L => L.top < pd.H * 0.09 && L.bottom < pd.H * 0.11);
      pages.push({ pd: pd, lines: lines });
    }
    const groups = {};
    pages.forEach((pg, i) => pg.lines.forEach(L => {
      const txt = L.items.map(it => it.str).join('').replace(/\s+/g, '');
      if (txt.length < 2 || /^[\d\-–~./|()\s]+$/.test(txt)) return;           // 쪽번호처럼 숫자·기호뿐이면 제외
      if (!/[가-힣]{1,6}(?:중학교|고등학교|중|고)(?![가-힣])/.test(L.items.map(it => it.str).join(' '))) return;           // 특정 학교 이름이 없는 위쪽 제목칸은 건드리지 않는다
      const key = txt + '@' + Math.round(L.top / 4) + ',' + Math.round(L.x0 / 8);
      (groups[key] = groups[key] || []).push({ page: i + 1, L: L });
    }));
    Object.keys(groups).forEach(k => {
      const g = groups[k];
      if (new Set(g.map(x => x.page)).size < 3) return;
      g.forEach(x => {
        if (x.page === 1) return;
        out.push({ page: x.page, rect: [x.L.x0 - 3, x.L.top - 2.5, x.L.x1 + 3, x.L.bottom + 2.5], text: x.L.items.map(i => i.str).join(' ').trim().slice(0, 30), kind: 'header' });
      });
    });
    return out;
  }
  // 쪽 안의 가로·세로 선(네모 테두리 포함)을 모은다. [{o:'h'|'v', a:고정좌표, b0, b1}] (위 기준 좌표)
  async function pageLines(doc, p) {
    doc._lineCache = doc._lineCache || {};
    if (doc._lineCache[p]) return doc._lineCache[p];
    const page = await doc.getPage(p), vp = page.getViewport({ scale: 1 }), PH = vp.height;
    const O = (typeof pdfjsLib !== 'undefined' && pdfjsLib.OPS) || { save: 10, restore: 11, transform: 12, constructPath: 91, moveTo: 13, lineTo: 14, curveTo: 15, curveTo2: 16, curveTo3: 17, closePath: 18, rectangle: 19 };
    const ol = await page.getOperatorList(), out = [];
    let ctm = [1, 0, 0, 1, 0, 0]; const stk = [];
    const add = (x0, y0, x1, y1) => {
      const ax = Math.abs(x1 - x0), ay = Math.abs(y1 - y0);
      if (ax < 1.6 && ay > 6) out.push({ o: 'v', a: (x0 + x1) / 2, b0: PH - Math.max(y0, y1), b1: PH - Math.min(y0, y1) });
      else if (ay < 1.6 && ax > 6) out.push({ o: 'h', a: PH - (y0 + y1) / 2, b0: Math.min(x0, x1), b1: Math.max(x0, x1) });
    };
    for (let i = 0; i < ol.fnArray.length; i++) {
      const fn = ol.fnArray[i], a = ol.argsArray[i];
      if (fn === O.save) stk.push(ctm.slice());
      else if (fn === O.restore) { if (stk.length) ctm = stk.pop(); }
      else if (fn === O.transform) { const m = ctm; ctm = [m[0] * a[0] + m[2] * a[1], m[1] * a[0] + m[3] * a[1], m[0] * a[2] + m[2] * a[3], m[1] * a[2] + m[3] * a[3], m[0] * a[4] + m[2] * a[5] + m[4], m[1] * a[4] + m[3] * a[5] + m[5]]; }
      else if (fn === O.constructPath) {
        if (Math.abs(ctm[0] - 1) > 0.01 || Math.abs(ctm[3] - 1) > 0.01 || Math.abs(ctm[1]) > 0.01 || Math.abs(ctm[2]) > 0.01) continue;
        const ops = a[0], c = a[1]; let k = 0, cx = 0, cy = 0, sx = 0, sy = 0;
        const X = v => v + ctm[4], Y = v => v + ctm[5];
        ops.forEach(op => {
          if (op === O.moveTo) { cx = X(c[k]); cy = Y(c[k + 1]); sx = cx; sy = cy; k += 2; }
          else if (op === O.lineTo) { const nx = X(c[k]), ny = Y(c[k + 1]); add(cx, cy, nx, ny); cx = nx; cy = ny; k += 2; }
          else if (op === O.curveTo) { cx = X(c[k + 4]); cy = Y(c[k + 5]); k += 6; }
          else if (op === O.curveTo2 || op === O.curveTo3) { cx = X(c[k + 2]); cy = Y(c[k + 3]); k += 4; }
          else if (op === O.closePath) { add(cx, cy, sx, sy); cx = sx; cy = sy; }
          else if (op === O.rectangle) { const x = X(c[k]), y = Y(c[k + 1]), w = c[k + 2], h = c[k + 3]; k += 4;
            if (Math.abs(w) < 1.6 || Math.abs(h) < 1.6) add(x, y, x + w, y + h);
            else { add(x, y, x + w, y); add(x + w, y, x + w, y + h); add(x + w, y + h, x, y + h); add(x, y + h, x, y); } }
        });
      }
    }
    doc._lineCache[p] = out;
    return out;
  }
  // 글자 영역(rect) 둘레의 네모 테두리가 있으면 그 테두리까지 포함하는 영역을 돌려준다. 단 구분선(긴 세로선)은 테두리로 보지 않는다.
  async function boxAround(doc, p, rect, pd) {
    const lines = (await pageLines(doc, p)).filter(l => (l.b1 - l.b0) < pd.H * 0.5 || l.o === 'h');
    const [x0, t, x1, b] = rect, MAXD = 40, tol = 4;
    const cover = (l, lo, hi) => l.b0 <= lo + tol && l.b1 >= hi - tol;
    let L = null, R = null, T = null, B = null;
    lines.forEach(l => {
      if (l.o === 'v' && cover(l, t + 2, b - 2)) {
        if (l.a <= x0 + 1 && x0 - l.a <= MAXD && (L === null || l.a > L)) L = l.a;
        if (l.a >= x1 - 1 && l.a - x1 <= MAXD && (R === null || l.a < R)) R = l.a;
      } else if (l.o === 'h' && cover(l, x0 + 2, x1 - 2)) {
        if (l.a <= t + 1 && t - l.a <= MAXD && (T === null || l.a > T)) T = l.a;
        if (l.a >= b - 1 && l.a - b <= MAXD && (B === null || l.a < B)) B = l.a;
      }
    });
    if (L === null || R === null || T === null || B === null) return null;
    const g = 2.5;
    return [Math.max(0, L - g), Math.max(0, T - g), Math.min(pd.W, R + g), Math.min(pd.H, B + g)];
  }
  async function findSourceMarks(doc) {
    const out = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const pd = await pageItems(doc, p);
      for (const m of sourceMarkRects(pd)) {
        let rect = m.rect;
        if (m.kind === 'text') { try { const bx = await boxAround(doc, p, [m.rect[0] + 8, m.rect[1] + 8, m.rect[2] - 8, m.rect[3] - 8], pd); if (bx) rect = bx; } catch (e) {} }
        out.push({ page: p, rect: rect, text: m.text, kind: m.kind });
      }
    }
    try { (await findRunningHeaders(doc)).forEach(m => out.push(m)); } catch (e) {}
    return out;
  }

  // 출처 워터마크·사이트명·이름칸처럼 흔히 지우고 싶어하는 글자를 찾아서 위치를 알려준다.
  // 꼬리말(쪽 맨 아래)에 있으면 그 글자만이 아니라 그 문단 전체 영역을 돌려준다(footer: true).
  async function findWatermarkCandidates(doc) {
    const out = [], seen = new Set();
    for (let p = 1; p <= doc.numPages; p++) {
      const pd = await pageItems(doc, p);
      const lines = linesOf(pd);
      lines.forEach(L => L.items.forEach(it => {
        const t = it.str.trim();
        if (!t || !(WATERMARK_RE.test(t) || NAME_FIELD_RE.test(t))) return;
        const footer = it.top >= pd.H * FOOTER_ZONE;
        const rect = footer ? footerRectAround(pd, lines, L) : [it.x - 2, it.top - 2, it.x + it.w + 2, it.bottom + 2];
        const key = p + ':' + rect.map(v => Math.round(v)).join(',');
        if (seen.has(key)) return;           // 같은 꼬리말 문단에서 여러 번 걸려도 한 번만
        seen.add(key);
        out.push({ page: p, rect: rect, text: t, footer: footer });
      }));
    }
    return out;
  }

  // 선생님이 직접 입력한 문구를 모든 쪽에서 찾는다 (띄어쓰기·대소문자 무시, 여러 조각에 걸쳐 있어도 찾는다).
  // 꼬리말에 있으면 문단 전체, 아니면 그 문구가 차지하는 자리만 돌려준다.
  async function findPhraseMatches(doc, phrase) {
    const norm = x => String(x || '').replace(/\s+/g, '').toLowerCase();
    const target = norm(phrase);
    if (!target) return [];
    const out = [], seen = new Set();
    for (let p = 1; p <= doc.numPages; p++) {
      const pd = await pageItems(doc, p);
      const lines = linesOf(pd);
      lines.forEach(L => {
        let str = '';
        const owner = [];            // 글자 하나하나가 어느 조각의 몇 번째 글자였는지
        L.items.forEach(it => { for (let k = 0; k < it.str.length; k++) { const ch = it.str[k]; if (/\s/.test(ch)) continue; str += ch.toLowerCase(); owner.push({ it: it, k: k }); } });
        let at = str.indexOf(target);
        while (at >= 0) {
          const hit = owner.slice(at, at + target.length);
          const footer = L.top >= pd.H * FOOTER_ZONE;
          let rect;
          if (footer) rect = footerRectAround(pd, lines, L);
          else {
            let x0 = Infinity, x1 = -Infinity;
            hit.forEach(o => {
              const per = o.it.w / Math.max(1, o.it.str.length);
              x0 = Math.min(x0, o.it.x + o.k * per); x1 = Math.max(x1, o.it.x + (o.k + 1) * per);
            });
            rect = [x0 - 2, L.top - 2, x1 + 2, L.bottom + 2];
          }
          const key = p + ':' + rect.map(v => Math.round(v)).join(',');
          if (!seen.has(key)) { seen.add(key); out.push({ page: p, rect: rect, text: phrase, footer: footer }); }
          at = str.indexOf(target, at + target.length);
        }
      });
    }
    return out;
  }

  // ── 글자 내용으로 "비슷한 문제" 찾기 (문제은행 연결 정보가 없는 시험에서 씀) ──
  // 한글은 띄어쓰기로 깔끔하게 안 나뉘어서, 2글자씩 겹쳐 자른 조각(bigram)의 겹치는 정도로 비슷함을 어림한다.
  function bigrams(text) {
    const clean = String(text || '').replace(/[\s\d.,()·%℃∼~\-]/g, '');
    const set = new Set();
    for (let i = 0; i < clean.length - 1; i++) set.add(clean.slice(i, i + 2));
    return set;
  }
  function textSimilarity(a, b) {
    const A = bigrams(a), B = bigrams(b);
    if (!A.size || !B.size) return 0;
    let inter = 0;
    A.forEach(g => { if (B.has(g)) inter++; });
    return inter / (A.size + B.size - inter);   // 자카드 유사도: 0(안 비슷)~1(똑같음)
  }
  // queries: [{num, text}, ...] 틀린 문항들. pool: 문제은행 문항 목록(.id, .textPreview 필요).
  // 각 틀린 문항마다 가장 비슷한 것부터 최대 perQuery개, 전체에서 중복 없이 고른다.
  function findSimilarQuestions(queries, pool, excludeIds, perQuery) {
    const used = new Set(excludeIds || []);
    const picks = [], detail = [];
    queries.forEach(q => {
      const scored = pool.filter(p => !used.has(p.id))
        .map(p => ({ p: p, score: textSimilarity(q.text, p.textPreview) }))
        .sort((a, b) => b.score - a.score);
      const chosen = scored.slice(0, perQuery || 1).filter(s => s.score > 0.04);
      chosen.forEach(c => { picks.push(c.p); used.add(c.p.id); });
      detail.push({ num: q.num, matched: chosen.length });
    });
    return { picks: picks, detail: detail };
  }

  // ── 문제 내용으로 단원 추정 ───────────────────────────────────────────────
  // 이미 단원이 정해진 문제들(예: 문제집 이름으로 분류된 일반 문제)의 글자를 "학습"해서,
  // 새 문제가 어느 단원 문제들과 가장 닮았는지로 단원을 고른다.
  //  · 글자를 2글자씩 겹쳐 자른 조각(bigram)으로 보고, 모든 문제에 흔한 말("다음 중 옳은 것은")은
  //    중요도(IDF)를 낮춰서 "밀도·용해도·반응물" 같은 주제어가 점수를 좌우하게 한다.
  //  · 점수 = 단원 전체 글자와의 코사인 유사도 60% + 그 단원에서 가장 닮은 문제 2개와의 유사도 40%.
  //  · 1등과 2등 차이가 작거나 점수가 낮으면 "확신 낮음"으로 표시한다(화면에서 따로 보여준다).
  const NO_UNIT = '(단원 미지정)';
  // 시험 문제에 단원과 상관없이 늘 나오는 말투("다음 중 옳은 것은?", "있는 대로 고른 것은?")는 빼고 본다.
  // 안 빼면 "…현상으로 옳은 것만을 있는 대로 고른 것은?" 같은 말투가 닮았다는 이유로 엉뚱한 단원이 뽑힌다.
  const EXAM_BOILERPLATE = /다음\s*(?:중|은|과\s*같은|그림|표|글)|이에\s*대한|설명으로|옳은\s*것(?:은|만을|만)?|옳지\s*않은|옳게|바르게|알맞은|있는\s*대로|고른\s*것(?:은|이다)?|모두\s*고른|고르시오|구하시오|쓰시오|서술하시오|나타낸\s*것(?:이다|은)?|그림은|그림과\s*같(?:이|은)|보기|해당하는|짝지은|무엇인가|무엇이라고|하는가|것으로|까닭|이유로|설명한|대한\s*설명|분류한/g;
  function unitTokens(text) {
    const clean = String(text || '').replace(/…$/, '').replace(EXAM_BOILERPLATE, ' ').replace(/[A-Za-z0-9\s.,()·%℃∼~\-?!:;"'’‘“”<>\[\]{}ㄱ-ㅎ①-⑩→+=/]/g, '');
    const out = [];
    for (let i = 0; i < clean.length - 1; i++) out.push(clean.slice(i, i + 2));
    // 글자 하나하나(광·합·성…)도 함께 쓴다. 학습 문제가 적을 때 훨씬 잘 맞는다(실험으로 확인) — 두 번 넣어서 가중을 높인다.
    for (let i = 0; i < clean.length; i++) { out.push('#' + clean[i]); out.push('#' + clean[i]); }
    return out;
  }
  function tfVec(tokens, idf) {
    const v = new Map();
    tokens.forEach(t => v.set(t, (v.get(t) || 0) + 1));
    let n = 0;
    v.forEach((c, t) => { const w = (1 + Math.log(c)) * (idf.get(t) || 0); v.set(t, w); n += w * w; });
    n = Math.sqrt(n) || 1;
    v.forEach((w, t) => v.set(t, w / n));
    return v;
  }
  function dotVec(a, b) { if (a.size > b.size) { const t = a; a = b; b = t; } let d = 0; a.forEach((w, t) => { const o = b.get(t); if (o) d += w * o; }); return d; }

  // queries: [{text, grade?}] 단원을 알고 싶은 문제들 / pool: 단원이 정해진 문제들 [{id, unit, grade, textPreview}]
  // opts: { grade(학습을 이 학년으로 먼저 좁힘), minScore, minMargin, excludeIds(Set) }
  // 돌려주는 값: queries와 같은 순서의 [{unit, grade, score, margin, support, confident, runnerUp}] 와 학습 정보(info)
  function estimateUnits(queries, pool, opts) {
    opts = opts || {};
    const minScore = opts.minScore === undefined ? 0.18 : opts.minScore;
    const minMargin = opts.minMargin === undefined ? 0.04 : opts.minMargin;
    let train = (pool || []).filter(p => p && p.unit && p.unit !== NO_UNIT && unitTokens(p.textPreview).length >= 8 && !(opts.excludeIds && opts.excludeIds.has(p.id)));
    // 목차(단원 이름 + 키워드)는 "정답지 문제"처럼 학습 자료에 같이 넣는다. 길이 제한은 받지 않는다.
    const seeds = (opts.seeds || []).filter(x => x && x.unit && unitTokens(x.textPreview).length >= 2);
    // 문제은행에 "물질의 구성"처럼 번호 없이 저장된 단원은 목차의 "4단원 물질의 구성"으로 합쳐서 센다
    const core = u => String(u || '').replace(/^\s*\d{1,2}(?:-\d+)?\s*(?:단원|[.)])?\s*/, '').replace(/\s+/g, '');
    const canon = {};
    seeds.forEach(sd => { canon[(sd.grade || '') + '|' + core(sd.name)] = sd.unit; if (!canon['|' + core(sd.name)]) canon['|' + core(sd.name)] = sd.unit; });
    train = train.map(p => { const c = canon[(p.grade || '') + '|' + core(p.unit)] || canon['|' + core(p.unit)]; return c ? Object.assign({}, p, { unit: c }) : p; });
    // 목차가 있으면 목차(단원 이름+키워드)만 기준으로 삼는다. 문제은행에 이미 저장된 문항의 단원은 예전 추정이 틀렸을 수 있어서
    // 그걸 기준으로 삼으면 틀린 분류가 틀린 분류를 키운다 (예: 전기와 자기 문제가 빛과 파동으로 계속 나오는 현상).
    train = seeds.length ? seeds.slice() : train.concat(seeds);
    let scopeGrade = '';
    if (opts.grade) {                         // 같은 학년의 학습 문제가 충분하면 그 학년 안에서만 고른다(학년이 다르면 단원 이름이 같아도 내용이 다르다)
      const g = train.filter(p => p.grade === opts.grade);
      if (g.length >= 4) { train = g; scopeGrade = opts.grade; }
    }
    const keyOf = p => (p.grade || '') + '\u0001' + p.unit;
    const info = { trainCount: train.length, unitCount: new Set(train.map(keyOf)).size, scopeGrade: scopeGrade };
    const empty = () => ({ unit: '', grade: '', score: 0, margin: 0, support: 0, confident: false, runnerUp: '' });
    if (train.length < 2) return { results: (queries || []).map(empty), info: info };

    // 중요도(IDF)
    const docs = train.map(p => unitTokens(p.textPreview));
    const df = new Map();
    docs.forEach(d => new Set(d).forEach(t => df.set(t, (df.get(t) || 0) + 1)));
    const idf = new Map(); df.forEach((c, t) => idf.set(t, Math.log((docs.length + 1) / (c + 1)) + 1));
    // 단원별 학습 자료
    const units = new Map();
    train.forEach((p, i) => {
      const k = keyOf(p);
      if (!units.has(k)) units.set(k, { unit: p.unit, grade: p.grade || '', members: [], sum: new Map() });
      const u = units.get(k), v = tfVec(docs[i], idf);
      u.members.push(v);
      v.forEach((w, t) => u.sum.set(t, (u.sum.get(t) || 0) + w));
    });
    units.forEach(u => { let n = 0; u.sum.forEach(w => { n += w * w; }); n = Math.sqrt(n) || 1; u.sum.forEach((w, t) => u.sum.set(t, w / n)); });

    const results = (queries || []).map(q => {
      const toks = unitTokens(q && q.text);
      if (toks.length < 8) return empty();
      const qv = tfVec(toks, idf);
      const scored = [];
      units.forEach(u => {
        const prof = dotVec(qv, u.sum);
        const sims = u.members.map(m => dotVec(qv, m)).sort((a, b) => b - a);
        const top = sims.slice(0, 2).reduce((a, b) => a + b, 0) / Math.min(2, sims.length);
        scored.push({ u: u, score: 0.6 * prof + 0.4 * top });
      });
      scored.sort((a, b) => b.score - a.score);
      const best = scored[0], second = scored[1];
      const margin = second ? best.score - second.score : best.score;
      return { unit: best.u.unit, grade: best.u.grade, score: best.score, margin: margin, support: best.u.members.length,
        confident: best.score >= minScore && (margin >= minMargin || !second), runnerUp: second ? second.u.unit : '' };
    });
    return { results: results, info: info };
  }
  // 소단원 추정: 대단원(unitEntry = parseToc의 한 항목, subs 포함) 안에서 문제 글자가 어느 소단원 키워드와 가까운지 본다.
  // 돌려주는 값: queries와 같은 순서의 소단원 이름(자신 없으면 '' = 대단원 전체)
  function estimateSubs(queries, unitEntry) {
    const subs = (unitEntry && unitEntry.subs) || [];
    if (!subs.length) return (queries || []).map(() => '');
    if (subs.length === 1) return (queries || []).map(() => subs[0].name);
    const seeds = subs.map(sb => ({ grade: unitEntry.grade || '', unit: sb.name, name: sb.bare, id: 'sub:' + sb.name,
      textPreview: [sb.bare, sb.bare, sb.keywords.join(' '), sb.keywords.join(' ')].join(' ') }));
    const r = estimateUnits(queries, [], { seeds: seeds, minScore: 0.12, minMargin: 0.02 });
    return r.results.map(x => (x && x.unit && x.score >= 0.12 && (x.confident || x.margin >= 0.02)) ? x.unit : '');
  }
  // 단원 "이름"만 보고(문제 내용 없이) 목차의 어느 학년 어느 단원인지 찾는다. 예) "물리변화와 화학변화" → 중3 · 1단원 화학 반응의 규칙성
  // 점수: 목차 단원 이름이 그대로 들어 있으면 크게, 키워드가 들어 있으면 글자 수만큼. 근거가 약하거나 두 후보가 비슷하면 모른다고 답한다.
  function matchUnitName(text, toc, hintGrade) {
    const norm = x => String(x || '').replace(/[\s·,.\-_()\[\]\/]+/g, '').replace(/^\d{1,2}(?:\d)?(?:단원)?/, '');
    const t = norm(String(text || '').replace(/^\s*\d{1,2}(?:-\d+)?\s*[.)]?\s*(?:단원)?/, ''));
    if (t.length < 3) return null;
    const scored = [];
    (toc || []).forEach(e => {
      if (hintGrade && e.grade !== hintGrade) return;
      let sc = 0;
      const nm = norm(e.name);
      if (nm.length >= 2 && (t.indexOf(nm) >= 0 || (t.length >= 4 && nm.indexOf(t) >= 0))) sc += 12 + nm.length;
      const kws = String(e.textPreview || '').split(/\s+/).slice(0).filter(Boolean);
      const seen = new Set();
      (e.keywords || []).forEach(k => { const kn = norm(k); if (kn.length >= 2 && !seen.has(kn) && t.indexOf(kn) >= 0) { seen.add(kn); sc += kn.length; } });
      if (sc > 0) scored.push({ e: e, sc: sc });
    });
    scored.sort((a, b) => b.sc - a.sc);
    if (!scored.length || scored[0].sc < 4) return null;
    if (scored[1] && scored[0].sc - scored[1].sc < 2) return null;
    return { grade: scored[0].e.grade, unit: scored[0].e.unit, score: scored[0].sc };
  }
  // 연관 문제 묶기: "위 실험을 바탕으로…"처럼 앞 문항의 자료를 이어 쓰는 문항, "[7~8]" 처럼 범위로 묶인 문항은
  // 앞 문항(대표)과 함께 출제돼야 한다. items: [{num, text}] → { 문항번호: 대표 문항 번호 } (묶인 문항만)
  const DEP_RE = /(위|앞|윗)\s*(의|에서의?)?\s*(실험|결과|과정|조건|사례|상황|자료)|윗글|위\s*글|위\s*(표|그래프|내용)(을|에서|를|와)|(이|위)\s*실험(을|에서)?\s*(바탕|토대)|앞\s*문제/;
  const RANGE_RE = /[\[(【]\s*(\d{1,2})\s*[~∼～\-–]\s*(\d{1,2})\s*(?:번)?\s*[\])】]|(\d{1,2})\s*[~∼～]\s*(\d{1,2})\s*번/g;
  function linkHeads(items) {
    const list = (items || []).slice().sort((a, b) => a.num - b.num), head = {}, byNum = {};
    list.forEach(q => { byNum[q.num] = q; });
    list.forEach(q => {
      const t = String(q.text || '');
      RANGE_RE.lastIndex = 0; let m;
      while ((m = RANGE_RE.exec(t))) {
        const a = parseInt(m[1] || m[3], 10), b = parseInt(m[2] || m[4], 10);
        if (a === q.num && b > a && b - a <= 4) for (let n = a + 1; n <= b; n++) if (byNum[n]) head[n] = head[n] || a;
      }
    });
    list.forEach(q => {
      if (head[q.num] || !byNum[q.num - 1]) return;
      const body = String(q.text || '').replace(/^\s*\d{1,2}\s*[.)]?\s*/, '').slice(0, 60);
      if (DEP_RE.test(body)) head[q.num] = head[q.num - 1] || q.num - 1;
    });
    return head;
  }
  // 문항 글("[26~27] 다음은…")의 맨 앞에 공통 지문 머리글이 있으면 [26, 27]
  function parseHeadRange(text) {
    const t = String(text || '').replace(/\s+/g, '').slice(0, 24);
    const m = /^[※\*★☆◆◇■□●○▶▷☞◎]*[\[［〔【](?:선택형|서술형|서답형|논술형|객관식|주관식)?(\d{1,2})[-~∼–～](\d{1,2})(?:번)?[\]］〕】]/.exec(t);
    if (!m) return null;
    const a = parseInt(m[1], 10), b = parseInt(m[2], 10);
    return (b > a && b - a <= 6) ? [a, b] : null;
  }
  // 그림 안의 머리글 번호 표식(거의 흰색 253,254,255)의 위치 [x0,y0,x1,y1] (px). 없으면 null
  async function findHeadMarker(b64) {
    try {
      const im = await loadImage('data:image/png;base64,' + b64);
      const c = createCanvas(im.width, im.height), ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(im, 0, 0);
      const w = c.width, h = c.height, d = ctx.getImageData(0, 0, w, h).data;
      // 표식 색(253,254,255)과 같은 픽셀이 사진 그림의 흰 배경에도 흩어져 있을 수 있어서, 한 덩어리로 꽉 찬 작은 직사각형만 번호 자리로 인정한다
      const mask = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) mask[i] = (d[i * 4] === 253 && d[i * 4 + 1] === 254 && d[i * 4 + 2] === 255) ? 1 : 0;
      const seen = new Uint8Array(w * h), maxH = 70, maxW = 260;
      let best = null, bestN = 0; const stack = [];
      for (let y0 = 0; y0 < h; y0++) for (let x0 = 0; x0 < w; x0++) {
        const p0 = y0 * w + x0; if (!mask[p0] || seen[p0]) continue;
        let n = 0, bx0 = x0, bx1 = x0, by0 = y0, by1 = y0; stack.length = 0; stack.push(p0); seen[p0] = 1;
        while (stack.length) {
          const p = stack.pop(), px = p % w, py = (p - px) / w; n++;
          if (px < bx0) bx0 = px; if (px > bx1) bx1 = px; if (py < by0) by0 = py; if (py > by1) by1 = py;
          if (px > 0 && mask[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack.push(p - 1); }
          if (px < w - 1 && mask[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack.push(p + 1); }
          if (py > 0 && mask[p - w] && !seen[p - w]) { seen[p - w] = 1; stack.push(p - w); }
          if (py < h - 1 && mask[p + w] && !seen[p + w]) { seen[p + w] = 1; stack.push(p + w); }
        }
        const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
        if (n >= 60 && bw <= maxW && bh <= maxH && n / (bw * bh) >= 0.9 && n > bestN) { best = [bx0, by0, bx1 + 1, by1 + 1]; bestN = n; }
      }
      return best;
    } catch (e) { return null; }
  }
  // 머리글 번호 자리에 새 번호 범위를 쓴다: 같은 시험의 두 문항이 모두 이 시험지에 있을 때만 ("[158~159]"), 아니면 자리만 비워 둔다
  function newHeadText(images, im) {
    const r = im.headRange; if (!r) return '';
    // 같은 시험의 [r0~r1] 번 문항 중 이 시험지에 들어 있는 것들의 새 번호를 쓴다 (일부만 골랐어도 있는 것만: 18~19, 하나뿐이면 18)
    const mem = images.map((o, k) => o && o.srcKey === im.srcKey && o.origNum >= r[0] && o.origNum <= r[1] ? { origNum: o.origNum, num: o.num || String(k + 1) } : null).filter(Boolean).sort((a, b) => a.origNum - b.origNum);
    if (!mem.length) return '';
    const span = o => { const m = String(o.num || '').match(/^(\d+)(?:~(\d+))?$/); return m ? [parseInt(m[1], 10), parseInt(m[2] || m[1], 10)] : null; };
    const sp = mem.map(span);
    if (sp.some(x => !x)) return mem.map(o => String(o.num)).join(',');
    let contiguous = true; for (let k = 1; k < sp.length; k++) if (sp[k][0] !== sp[k - 1][1] + 1) contiguous = false;
    if (sp.length === 1) return sp[0][0] === sp[0][1] ? String(sp[0][0]) : sp[0][0] + '~' + sp[0][1];
    return contiguous ? sp[0][0] + '~' + sp[sp.length - 1][1] : sp.map(x => x[0] === x[1] ? x[0] : x[0] + '~' + x[1]).join(',');
  }
  function drawHeadPatch(page, font, rgb, box, x, topY, kx, txt) {
    if (!box || !txt) return;
    const left = x + box[0] * kx, right = x + box[2] * kx, top = topY - box[1] * kx, bottom = topY - box[3] * kx;
    const h = top - bottom; let fs = Math.min(13, Math.max(6, h * 0.85));
    const tw0 = font.widthOfTextAtSize(txt, fs), room = (right - left) + 1.5;
    if (tw0 > room) fs = Math.max(6, fs * room / tw0);
    const tw = font.widthOfTextAtSize(txt, fs);
    page.drawRectangle({ x: left - 0.3, y: bottom - 1, width: (right - left) + 0.6, height: h + 2, color: rgb(1, 1, 1) });
    page.drawText(txt, { x: (left + right) / 2 - tw / 2, y: bottom + (h - fs * 0.72) / 2, size: fs, font: font, color: rgb(0, 0, 0) });
  }

  // 과학 목차 글 → [{grade, unit, textPreview}]
  // 형식: "[중1]" / "# 중1" 같은 줄이 학년, 그 아래 줄이 단원. 단원 뒤에 ":" 로 키워드를 적으면 분류에 같이 쓴다.
  //   예) 물질의 상태 변화: 융해, 응고, 기화, 액화, 승화, 끓는점
  function parseToc(text) {
    const out = []; let grade = ''; const cnt = {};
    String(text || '').split(/\r?\n/).forEach(raw => {
      let line = raw.trim(); if (!line) return;
      // 들여쓴 줄(공백 2칸 이상·탭)이나 ">"로 시작하는 줄은 바로 위 대단원의 소단원이다.  예)   01 물질의 특성(1): 밀도, 순물질
      if (out.length && /^(\s{2,}|\t|>|└|ㄴ)/.test(raw) && !/^(?:#+\s*|\[|【)/.test(line)) {
        const sl = line.replace(/^[>└ㄴ\s\-*•·▶▷]+/, '');
        const sm = sl.match(/^(\d{1,2})\s*[.)]?\s+(?=\S)/);
        const rest = sm ? sl.slice(sm[0].length) : sl;
        const parts = rest.split(/[:：]/);
        const sname = parts[0].trim(); if (!sname) return;
        const par = out[out.length - 1];
        par.subs = par.subs || [];
        const sno = sm ? parseInt(sm[1], 10) : par.subs.length + 1;
        const skw = (parts[1] || '').split(/[,，、\/]/).map(x => x.trim()).filter(Boolean);
        par.subs.push({ name: (sno < 10 ? '0' : '') + sno + ' ' + sname, bare: sname, no: sno, keywords: skw });
        return;
      }
      const h = line.match(/^(?:#+\s*|\[|【)\s*([^\]】]+?)\s*(?:\]|】)?$/);
      if (h && /^(초|중|고)\s*\d|^(중등|고등|[초중고]\d)/.test(h[1].replace(/\s/g, ''))) { grade = h[1].replace(/\s/g, ''); return; }
      line = line.replace(/^[\s\-*•·▶▷]+/, '');
      let no = 0;
      const nm = line.match(/^(\d{1,2})\s*(?:단원|[.)])?\s+(?=\S)/);            // "4. 물질의 구성" · "4단원 물질의 구성" → 번호 4
      if (nm) { no = parseInt(nm[1], 10); line = line.slice(nm[0].length); }
      else line = line.replace(/^([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+[.)]?|[가-힣][.)])\s+/, '');
      const m = line.split(/[:：]/);
      const name = m[0].trim(); if (!name) return;
      cnt[grade] = (cnt[grade] || 0) + 1;
      if (!no) no = cnt[grade];                                                      // 번호가 없으면 적은 순서대로 1, 2, 3…
      cnt[grade] = Math.max(cnt[grade], no);
      const unit = no + '단원 ' + name;
      const kw = (m[1] || '').split(/[,，、\/]/).map(x => x.trim()).filter(Boolean);
      const body = [name, name, kw.join(' '), kw.join(' ')].join(' ');
      out.push({ grade: grade, unit: unit, name: name, no: no, keywords: kw, textPreview: body, id: 'toc:' + grade + ':' + unit });
    });
    return out;
  }
  // 문항별 추정 결과를 "1-3 단원" 같은 줄(번호 범위 + 단원)로 묶는다. 같은 단원이 이어지는 번호는 한 줄로 합친다.
  // nums[i]는 i번째 결과의 문항 번호. 확신이 낮은 것(onlyConfident)은 건너뛴다.
  function unitsToRanges(nums, results, onlyConfident) {
    const lines = [];
    let cur = null;
    nums.forEach((n, i) => {
      const r = results[i];
      const ok = r && r.unit && (!onlyConfident || r.confident);
      if (!ok) { cur = null; return; }
      if (cur && cur.unit === r.unit && cur.grade === (r.grade || '') && cur.to === n - 1) cur.to = n;
      else { cur = { from: n, to: n, unit: r.unit, grade: r.grade || '' }; lines.push(cur); }
    });
    // 학년이 있으면 "5-6 2학년 4단원 물질의 구성"처럼 학년까지 같이 보여준다 (초6·고1 등은 그대로)
    const gl = g => /^중[123]$/.test(g) ? g.slice(1) + '학년' : g;
    return lines.map(l => (l.from === l.to ? String(l.from) : l.from + '-' + l.to) + ' ' + (l.grade ? gl(l.grade) + ' ' : '') + l.unit).join('\n');
  }



  // ── 정답이 "글자"가 아니라 그림(벡터 도형)으로 그려진 원숫자(③ 등)를 읽는다 ──
  // 한글(HWP)에서 PDF로 내보낸 문제집은 ①~⑤가 글자가 아니라 도형이라 글자 추출로는 비어 있다.
  // 해결: "[정답]" 바로 오른쪽 그림을 떼어서, ①~⑤를 직접 그린 견본과 비교한다. (같은 모양끼리 먼저 묶고, 묶음마다 하나의 숫자를 배정한다)
  function glyphVecFromCanvas(c) {
    const w = c.width, h = c.height, d = c.getContext('2d').getImageData(0, 0, w, h).data;
    const dk = (x, y) => { const i = (y * w + x) * 4; return 1 - (d[i] + d[i + 1] + d[i + 2]) / 765; };
    let x0 = w, x1 = -1, y0 = h, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (dk(x, y) > 0.45) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return null;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (bw < 14 || bh < 14 || bw / bh > 1.35 || bh / bw > 1.35) return null;       // 원 모양(거의 정사각형)이 아니면 숫자 표시가 아니다
    const N = 20, v = new Float32Array(N * N), side = Math.max(bw, bh);
    const ox = x0 - (side - bw) / 2, oy = y0 - (side - bh) / 2;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let sum = 0, cnt = 0;
      const xa = Math.floor(ox + i * side / N), xb = Math.max(xa + 1, Math.floor(ox + (i + 1) * side / N));
      const ya = Math.floor(oy + j * side / N), yb = Math.max(ya + 1, Math.floor(oy + (j + 1) * side / N));
      for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) if (x >= 0 && y >= 0 && x < w && y < h) { sum += dk(x, y); cnt++; }
      // 바깥 동그라미 테두리는 모든 숫자에 똑같아서 구별에 방해가 되니, 안쪽(숫자가 있는 곳)만 본다
      const rr = Math.hypot(i - (N - 1) / 2, j - (N - 1) / 2);
      v[j * N + i] = (cnt && rr <= 7.2) ? sum / cnt : 0;
    }
    // 가벼운 번짐(3x3) 후 평균을 빼고 길이를 1로
    const b = new Float32Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let s2 = 0, n2 = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const x = i + dx, y = j + dy; if (x >= 0 && y >= 0 && x < N && y < N) { s2 += v[y * N + x]; n2++; } }
      b[j * N + i] = s2 / n2;
    }
    return normVec(b);
  }
  function normVec(b) {
    let m = 0; for (let i = 0; i < b.length; i++) m += b[i]; m /= b.length;
    let n = 0; for (let i = 0; i < b.length; i++) { b[i] -= m; n += b[i] * b[i]; }
    n = Math.sqrt(n) || 1; for (let i = 0; i < b.length; i++) b[i] /= n;
    return b;
  }
  const dotv = (a, b) => { let s2 = 0; for (let i = 0; i < a.length; i++) s2 += a[i] * b[i]; return s2; };
  function circledTemplates() {
    const out = [];
    const fonts = ['sans-serif', 'serif', '"Malgun Gothic"', '"Noto Sans KR"', '"Batang"', 'Arial', '"Times New Roman"'];
    fonts.forEach(f => {
      [[400, 0.52], [700, 0.52], [400, 0.64], [700, 0.64], [400, 0.74]].forEach(wf => {
        const wt = wf[0], fsz = wf[1];
        const row = [];
        for (let dgt = 1; dgt <= 5; dgt++) {
          const S = 180, c = createCanvas(S, S), x = c.getContext('2d');
          x.fillStyle = '#fff'; x.fillRect(0, 0, S, S);
          x.strokeStyle = '#000'; x.lineWidth = 7; x.beginPath(); x.arc(S / 2, S / 2, S * 0.42, 0, Math.PI * 2); x.stroke();
          x.fillStyle = '#000'; x.font = wt + ' ' + Math.round(S * fsz) + 'px ' + f; x.textAlign = 'center'; x.textBaseline = 'middle';
          x.fillText(String(dgt), S / 2, S / 2 + S * 0.03);
          row.push(glyphVecFromCanvas(c));
        }
        if (row.every(Boolean)) out.push(row);
      });
    });
    return out;
  }

  // ── 사진(스캔)으로 된 「교과목별 정답/배점」 표 읽기 ──
  // 학교가 나눠 주는 표(문항·배점·정답·복수구분 칸이 4묶음)를 칸 선을 따라 잘라서 숫자 모양을 비교해 읽는다.
  // 숫자 모양은 같은 표의 「문항」 칸(1,2,3…)에서 배운다 — 그래서 글꼴이 달라도 같은 표 안에서는 맞는다.
  async function readScannedAnswerSheet(doc, pageNums) {
    const out = { answers: {}, count: 0, pages: [], note: '' };
    for (const pn of pageNums) {
      let cv;
      try {
        const page = await doc.getPage(pn);
        const vp0 = page.getViewport({ scale: 1 });
        const sc = Math.min(3, 2100 / Math.max(vp0.width, vp0.height) * 1.0) || 2;
        const vp = page.getViewport({ scale: Math.max(1.6, sc) });
        cv = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
        const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
        await page.render({ canvasContext: cx, viewport: vp, canvas: cv }).promise;
      } catch (e) { out.note = 'render: ' + (e && e.message); continue; }
      const r = readSheetCanvas(cv);
      if (r && r.count) { Object.keys(r.answers).forEach(n => { if (!out.answers[n]) out.answers[n] = r.answers[n]; }); out.pages.push(pn); }
      else if (r && r.note) out.note = r.note;
    }
    out.count = Object.keys(out.answers).length;
    return out;
  }
  function readSheetCanvas(cv) {
    const W = cv.width, H = cv.height, d = cv.getContext('2d').getImageData(0, 0, W, H).data;
    const ink = new Uint8Array(W * H), lin = new Uint8Array(W * H);   // ink: 글자, lin: 표 선(흐리게 찍힌 선도 잡는다)
    for (let i = 0, k = 0; i < d.length; i += 4, k++) { const g = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; ink[k] = g < 170 ? 1 : 0; lin[k] = g < 215 ? 1 : 0; }
    // 긴 세로선·가로선 찾기 (선이 1~2px 끊겨도 이어서 센다)
    function runs(isV) {
      const n = isV ? W : H, m = isV ? H : W, res = new Array(n).fill(null).map(() => ({ len: 0, start: 0 }));
      const a0 = Math.floor(n * 0.03), a1 = Math.ceil(n * 0.97), b0 = Math.floor(m * 0.03), b1 = Math.ceil(m * 0.97);   // 스캔 가장자리의 검은 줄은 빼고 본다
      for (let a = a0; a < a1; a++) {
        let best = 0, bs = 0, cur = 0, cs = 0, gap = 0;
        for (let b = b0; b < b1; b++) {
          const v = isV ? lin[b * W + a] : lin[a * W + b];
          if (v) { if (!cur) cs = b; cur += 1 + gap; gap = 0; if (cur > best) { best = cur; bs = cs; } }
          else if (cur) { gap++; if (gap > 2) { cur = 0; gap = 0; } }
        }
        res[a] = { len: best, start: bs };
      }
      return res;
    }
    const vr = runs(true);
    let maxV = 0; vr.forEach(r => { if (r.len > maxV) maxV = r.len; });
    if (maxV < H * 0.15) return { note: '표 선을 못 찾았어요' };
    // 가장 긴 세로선 무리(표 본체) — 길이가 비슷한 것만
    const cand = []; for (let x = 0; x < W; x++) if (vr[x].len >= maxV * 0.8) cand.push(x);
    const vx = []; cand.forEach(x => { if (vx.length && x - vx[vx.length - 1].hi <= 3) vx[vx.length - 1].hi = x; else vx.push({ lo: x, hi: x }); });
    const xs = vx.map(g => Math.round((g.lo + g.hi) / 2));
    if (xs.length < 5 || (xs.length - 1) % 4 !== 0) return { note: '칸 구분선이 예상과 달라요(' + xs.length + '개)' };
    const top = Math.min.apply(null, cand.map(x => vr[x].start)), bot = Math.max.apply(null, cand.map(x => vr[x].start + vr[x].len));
    // 가로선
    const hr = runs(false), tableW = xs[xs.length - 1] - xs[0];
    const ys0 = []; for (let y = Math.max(0, top - 4); y <= Math.min(H - 1, bot + 4); y++) {
      // 표 폭 안에서 선이 차지하는 비율 (군데군데 끊긴 흐린 선도 잡는다)
      let c = 0;
      for (let x = xs[0]; x <= xs[xs.length - 1]; x++) if (lin[y * W + x] || (y > 0 && lin[(y - 1) * W + x]) || lin[(y + 1) * W + x]) c++;
      const best = c;
      if (best >= tableW * 0.8) ys0.push(y);
    }
    const ys = []; ys0.forEach(y => { if (ys.length && y - ys[ys.length - 1].hi <= 3) ys[ys.length - 1].hi = y; else ys.push({ lo: y, hi: y }); });
    let yl = ys.map(g => Math.round((g.lo + g.hi) / 2));
    if (yl.length < 4) return { note: '행 구분선을 못 찾았어요' };
    let hs = []; for (let i = 0; i + 1 < yl.length; i++) hs.push(yl[i + 1] - yl[i]);
    const med = hs.slice().sort((a, b) => a - b)[Math.floor(hs.length / 2)];
    // 데이터 행: 높이가 중앙값과 비슷한 행들 (머리글 행은 더 높다)
    const rows = []; for (let i = 0; i < hs.length; i++) if (Math.abs(hs[i] - med) <= med * 0.25) rows.push([yl[i], yl[i + 1]]);
    if (rows.length < 3) return { note: '문항 행을 못 찾았어요' };
    const blocks = (xs.length - 1) / 4, R = rows.length;
    // 칸 안의 글자 조각(연결 덩어리) 뽑기
    function glyphs(x0, x1, y0, y1) {
      const m = 3, a0 = x0 + m, a1 = x1 - m, b0 = y0 + m, b1 = y1 - m, w = a1 - a0, h = b1 - b0;
      if (w < 4 || h < 4) return [];
      const lab = new Int32Array(w * h), comps = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!ink[(b0 + y) * W + a0 + x] || lab[y * w + x]) continue;
        const id = comps.length + 1, st = [[x, y]]; lab[y * w + x] = id;
        let mnx = x, mxx = x, mny = y, mxy = y; const pts = [];
        while (st.length) {
          const [cx, cy] = st.pop(); pts.push(cx, cy);
          if (cx < mnx) mnx = cx; if (cx > mxx) mxx = cx; if (cy < mny) mny = cy; if (cy > mxy) mxy = cy;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h || lab[ny * w + nx] || !ink[(b0 + ny) * W + a0 + nx]) continue;
            lab[ny * w + nx] = id; st.push([nx, ny]);
          }
        }
        comps.push({ x0: mnx, x1: mxx, y0: mny, y1: mxy, pts: pts });
      }
      return comps.filter(c => (c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1) >= 6);
    }
    const SZ_W = 10, SZ_H = 14;
    function vec(c) {
      const gw = c.x1 - c.x0 + 1, gh = c.y1 - c.y0 + 1, g = new Float32Array(SZ_W * SZ_H);
      // 글자 모양을 격자에 면적 비율로 옮긴다 (해상도가 조금 달라도 같은 값이 나오게)
      for (let i = 0; i < c.pts.length; i += 2) {
        const fx = (c.pts[i] - c.x0 + 0.5) * SZ_W / gw, fy = (c.pts[i + 1] - c.y0 + 0.5) * SZ_H / gh;
        const px = Math.min(SZ_W - 1, Math.floor(fx)), py = Math.min(SZ_H - 1, Math.floor(fy));
        g[py * SZ_W + px] += (SZ_W / gw) * (SZ_H / gh);
      }
      const o = new Float32Array(SZ_W * SZ_H);      // 3x3 번짐
      for (let y = 0; y < SZ_H; y++) for (let x = 0; x < SZ_W; x++) {
        let sum = 0, wsum = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= SZ_W || ny >= SZ_H) continue; const w = (dx ? 1 : 2) * (dy ? 1 : 2); sum += Math.min(1, g[ny * SZ_W + nx]) * w; wsum += w; }
        o[y * SZ_W + x] = sum / wsum;
      }
      return { g: o, ar: gw / gh };
    }
    function dist(a, b) { let s = 0; for (let i = 0; i < a.g.length; i++) { const e = a.g[i] - b.g[i]; s += e * e; } return Math.sqrt(s / a.g.length) + Math.abs(a.ar - b.ar) * 0.25; }
    // 1) 「문항」 칸에서 숫자 모양 배우기 (번호는 1부터 차례로 이어진다고 본다)
    const tpl = {};  // digit -> [vec]
    const cellOf = (b, r, c) => [xs[b * 4 + c], xs[b * 4 + c + 1], rows[r][0], rows[r][1]];
    let learned = 0;
    for (let b = 0; b < blocks; b++) for (let r = 0; r < R; r++) {
      const num = b * R + r + 1, s = String(num), gl = glyphs.apply(null, cellOf(b, r, 0)).sort((p, q) => p.x0 - q.x0);
      if (gl.length !== s.length) continue;
      gl.forEach((g, i) => { (tpl[s[i]] = tpl[s[i]] || []).push(vec(g)); learned++; });
    }
    const have = ['1', '2', '3', '4', '5'].filter(k => tpl[k] && tpl[k].length);
    if (have.length < 5) return { note: '숫자 모양을 배우지 못했어요(' + have.join('') + ')' };
    const answers = {}; let bad = 0;
    for (let b = 0; b < blocks; b++) for (let r = 0; r < R; r++) {
      const num = b * R + r + 1;
      const gl = glyphs.apply(null, cellOf(b, r, 2)).sort((p, q) => p.x0 - q.x0);
      if (!gl.length) continue;
      const hmax = Math.max.apply(null, gl.map(g => g.y1 - g.y0 + 1));
      const digs = gl.filter(g => (g.y1 - g.y0 + 1) >= hmax * 0.6);      // 쉼표 같은 작은 조각은 건너뛴다
      let txt = '', ok = true;
      digs.forEach(g => {
        const v = vec(g); let bk = '', bd = 9;
        Object.keys(tpl).forEach(k => tpl[k].forEach(t => { const dd = dist(v, t); if (dd < bd) { bd = dd; bk = k; } }));
        if (bd > 0.3 || !/[1-5]/.test(bk)) ok = false; else txt += bk;
      });
      if (!ok || !txt) { bad++; continue; }
      // 복수구분 칸에 글자가 있으면 「두 개 모두」 정답
      const hasMulti = glyphs.apply(null, cellOf(b, r, 3)).length > 0;
      const uniq = Array.from(new Set(txt.split('')));
      answers[num] = { text: uniq.join(''), multi: uniq.length > 1, hasMultiMark: hasMulti, fromSheet: true };
    }
    return { answers: answers, count: Object.keys(answers).length, bad: bad, note: bad ? '읽기 어려운 칸 ' + bad + '개는 비워 뒀어요' : '' };
  }


  // ── 정답이 「1) [정답] ④」처럼 번호 뒤에 동그라미 숫자 "그림"으로 들어 있는 해설 쪽 읽기 ──
  // 동그라미 안의 숫자(1~5)를 잘라 글꼴 숫자 모양과 견줘서 읽는다. 확실하지 않으면 '?'로 두어 선생님이 확인하게 한다.
  // pages: 해설 쪽 번호들. 반환: { 번호: { d: '4' | '-' | '?', conf, alt } }  ('-' = 숫자 그림이 없는 글 정답 → 주관식으로 본다)
  const _DIGIT_TPL = {};
  function _digitTemplates() {
    if (_DIGIT_TPL.t) return _DIGIT_TPL.t;
    const tpl = [];
    for (const wt of ['bold', 'normal']) for (const f of ['"Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif', 'serif']) for (const d of '12345') {
      const c = createCanvas(160, 160), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 160, 160); x.fillStyle = '#000';
      x.font = wt + ' 100px ' + f; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(d, 80, 84);
      const v = _inkFeature(c); if (v) tpl.push({ d: d, v: v });
    }
    return (_DIGIT_TPL.t = tpl);
  }
  function _inkFeature(c) {
    const w = c.width, h = c.height, id = c.getContext('2d').getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1; const ink = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (id[i + 3] > 100 && (id[i] + id[i + 1] + id[i + 2]) / 3 < 150) { ink[y * w + x] = 1; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
    if (x1 < 0) return null;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1; if (bw < 3 || bh < 3) return null;
    const N = 16, o = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const ya = y0 + Math.floor(y * bh / N), yb = y0 + Math.max(Math.floor((y + 1) * bh / N), Math.floor(y * bh / N) + 1), xa = x0 + Math.floor(x * bw / N), xb = x0 + Math.max(Math.floor((x + 1) * bw / N), Math.floor(x * bw / N) + 1);
      let sum = 0, n = 0; for (let yy = ya; yy < yb; yy++) for (let xx = xa; xx < xb; xx++) { sum += ink[yy * w + xx]; n++; } o[y * N + x] = sum / n;
    }
    return { f: o, ar: bw / bh };
  }
  function _digitScore(a, b) {
    let da = 0, db = 0, ab = 0; for (let i = 0; i < a.f.length; i++) { da += a.f[i] * a.f[i]; db += b.f[i] * b.f[i]; ab += a.f[i] * b.f[i]; }
    return (ab / Math.sqrt(da * db + 1e-9)) * Math.exp(-2.2 * Math.abs(Math.log(a.ar / b.ar)));
  }
  function _centered(a) { let m = 0; for (let i = 0; i < a.length; i++) m += a[i]; m /= a.length; const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] - m; return o; }
  function _sim(a, b) { let da = 0, db = 0, ab = 0; for (let i = 0; i < a.length; i++) { da += a[i] * a[i]; db += b[i] * b[i]; ab += a[i] * b[i]; } return ab / Math.sqrt(da * db + 1e-9); }
  async function readLabeledImageAnswers(doc, pages, onProgress) {
    const rows = [], items = [], tpl = _digitTemplates().map(t => ({ d: t.d, c: _centered(t.v.f), ar: t.v.ar }));
    let pi = 0;
    for (const p of pages) {
      if (onProgress) onProgress(++pi, pages.length);
      let pd; try { pd = await pageItems(doc, p, true); } catch (e) { continue; }
      const rs = (pd.imgs || []).filter(r => !r[4] && (r[2] - r[0]) < 14 && (r[3] - r[1]) < 14 && (r[2] - r[0]) > 4 && (r[3] - r[1]) > 4);
      // 번호 표지: 「3) [정답]」 한 덩어리이거나, 「3)」 옆에 「정답」 딱지가 따로 있는 두 가지 모양
      const labs = [];
      pd.items.forEach(l => {
        let m = String(l.str).match(/^\s*(\d{1,2})\)\s*\[정답\]\s*([①-⑨](?:[①-⑨,，、·\s]*[①-⑨])*)?/);
        if (m) { labs.push({ n: parseInt(m[1], 10), right: l.x + l.w, top: l.top, bottom: l.bottom, inline: m[2] || '' }); return; }
        m = String(l.str).match(/^\s*(\d{1,2})\)\s*$/);
        if (m) { const t = pd.items.find(q => String(q.str).trim() === '정답' && Math.abs(q.top - l.top) < 5 && q.x >= l.x + l.w - 2 && q.x - (l.x + l.w) < 14); if (t) labs.push({ n: parseInt(m[1], 10), right: t.x + t.w, top: l.top, bottom: l.bottom }); }
      });
      const rowStart = rows.length;
      for (const l of labs) {
        const n = l.n;
        if (l.inline) { rows.push({ p: p, n: n, d: l.inline.split('').filter(ch => /[①-⑨]/.test(ch)).map(ch => String(ch.charCodeAt(0) - 0x2460 + 1)).join(''), conf: 1, text: true }); continue; }
        // 정답이 글자로 적힌 경우: 「①」 한 개, 「①, ⑤」처럼 쉼표로 이어진 여러 개(조각으로 나뉘어 있어도) 모두 모은다
        const sameLine = pd.items.filter(q => Math.abs((q.top + q.bottom) / 2 - (l.top + l.bottom) / 2) < 8 && q.x >= l.right - 3).sort((u, v) => u.x - v.x);
        let run = '', endX = l.right;
        for (const q of sameLine) {
          const t = String(q.str);
          if (!/^[\s①-⑨,，、·]+$/.test(t) || !t.trim()) { if (run) break; else continue; }
          if (q.x - endX > 14) break;
          run += t; endX = q.x + q.w;
        }
        if (/[①-⑨]/.test(run)) { rows.push({ p: p, n: n, d: run.split('').filter(ch => /[①-⑨]/.test(ch)).map(ch => String(ch.charCodeAt(0) - 0x2460 + 1)).join(''), conf: 1, text: true }); continue; }
        const r = rs.filter(q => q[0] > l.right - 3 && q[0] - l.right < 16 && Math.abs((q[1] + q[3]) / 2 - (l.top + l.bottom) / 2) < 8).sort((u, v) => u[0] - v[0])[0];
        if (!r) { rows.push({ p: p, n: n, d: '-', conf: 1 }); continue; }
        const c = await renderRect(doc, p, [r[0] - 0.5, r[1] - 0.5, r[2] + 0.5, r[3] + 0.5], 12, false);
        const ic = createCanvas(c.width, c.height), ix = ic.getContext('2d'); ix.fillStyle = '#fff'; ix.fillRect(0, 0, c.width, c.height);
        const mx = Math.round(c.width * 0.22), my = Math.round(c.height * 0.2);
        ix.drawImage(c, mx, my, c.width - 2 * mx, c.height - 2 * my, mx, my, c.width - 2 * mx, c.height - 2 * my);   // 바깥 동그라미 테두리는 빼고 속의 숫자만
        const v = _inkFeature(ic); const row = { p: p, n: n, d: '?', conf: 0 }; rows.push(row);
        if (v) items.push({ row: row, c: _centered(v.f), ar: v.ar });
      }
      // 사람이 정답을 눈으로 확인할 수 있도록, 이 번호의 「N) [정답]」 줄 주변 위치를 같이 돌려준다
      rows.slice(rowStart).forEach(r => { const lb = labs.find(x => x.n === r.n); if (lb) r.rect = [Math.max(0, lb.right - 80), Math.max(0, lb.top - 6), Math.min(pd.W, lb.right + 300), Math.min(pd.H, lb.top + 64)]; });
    }
    // 같은 숫자 그림끼리 묶는다 (같은 모양이면 거의 똑같이 보인다)
    const cls = [];
    items.forEach(it => {
      let best = null, bs = 0.9;
      cls.forEach(c => { const sc = _sim(it.c, c.mean); if (sc > bs && Math.abs(Math.log(it.ar / c.ar)) < 0.25) { bs = sc; best = c; } });
      if (best) { best.items.push(it); const k = best.items.length; for (let i = 0; i < best.mean.length; i++) best.mean[i] += (it.c[i] - best.mean[i]) / k; }
      else cls.push({ mean: Float32Array.from(it.c), ar: it.ar, items: [it] });
    });
    const score = (c, t) => Math.max(0, _sim(c.mean, t.c)) * Math.exp(-2.2 * Math.abs(Math.log(c.ar / t.ar)));
    const best = cls.map(c => { const per = {}; tpl.forEach(t => { const s = score(c, t); if (!(t.d in per) || s > per[t.d]) per[t.d] = s; }); return per; });
    let assign = null;
    if (cls.length <= 5 && cls.length >= 2) {
      // 숫자 1~5가 한 번씩만 쓰이므로, 합이 가장 높은 짝짓기를 고른다
      let bestSum = -1; const digs = ['1', '2', '3', '4', '5'];
      (function rec(k, used, cur, sum) {
        if (k === cls.length) { if (sum > bestSum) { bestSum = sum; assign = cur.slice(); } return; }
        for (const d of digs) if (!used[d]) { used[d] = 1; cur.push(d); rec(k + 1, used, cur, sum + best[k][d]); cur.pop(); used[d] = 0; }
      })(0, {}, [], 0);
    }
    cls.forEach((c, k) => {
      const per = best[k], ranked = Object.keys(per).sort((a, b) => per[b] - per[a]);
      const d = assign ? assign[k] : ranked[0];
      const conf = per[d] - Math.max.apply(null, Object.keys(per).filter(x => x !== d).map(x => per[x]));
      const ok = assign ? (cls.length === 5 || per[d] >= 0.2) : (per[d] >= 0.25 && conf >= 0.08);
      c.items.forEach(it => { Object.assign(it.row, { d: ok ? d : '?', conf: conf, top: per[d], guess: d, alt: ranked.find(x => x !== d), cluster: k, size: c.items.length }); });
    });
    rows.clusters = cls.map((c, k) => ({ n: c.items.length, d: assign ? assign[k] : null }));
    return rows;
  }

  // ── 교재 한 권(여러 소단원이 25문제씩 이어진 PDF)의 목차 읽기 ──
  // 앞쪽 몇 쪽에서 「최다빈출 공략  1-1.물질의 특성(01)   4~9   357~359」 같은 줄(이름, 문제 쪽, 정답 쪽)을 찾는다.
  async function parseBookToc(doc, maxPages) {
    const secs = []; let unit = null, tocPage = 0; const seen = {};
    const n = Math.min(doc.numPages, maxPages || 8);
    for (let p = 1; p <= n; p++) {
      const pg = await doc.getPage(p), tc = await pg.getTextContent();
      const rows = [];
      tc.items.forEach(it => {
        const y = it.transform[5], x = it.transform[4];
        let r = rows.find(q => Math.abs(q.y - y) < 2.5); if (!r) { r = { y: y, its: [] }; rows.push(r); }
        r.its.push({ x: x, s: it.str, w: it.width });
      });
      rows.sort((a, b) => b.y - a.y).forEach(r => {
        let line = '', prevEnd = null;       // 글자가 한 자씩 따로 들어 있는 목차도 있어서, 공백 조각은 살리고 틈이 벌어지면 띄운다
        r.its.sort((a, b) => a.x - b.x).forEach(i => { if (prevEnd !== null && i.x - prevEnd > 1.5 && !/^\s/.test(i.s) && !/\s$/.test(line)) line += ' '; line += i.s; prevEnd = i.x + i.w; });
        line = line.replace(/\s+/g, ' ').trim();
        let m = line.match(/^(\d+)\s*단원\s+(.+)$/);
        if (m) { unit = { no: parseInt(m[1], 10), name: m[2].trim() }; return; }
        m = line.match(/^(최다빈출|최다오답|최상위)\s*공략\s+(.+?)\s+(\d+)\s*~\s*(\d+)\s+(\d+)\s*~\s*(\d+)$/);
        if (m && unit) {
          const key = m[1] + m[2] + m[3];
          if (seen[key]) return; seen[key] = 1; if (!tocPage) tocPage = p;
          secs.push({ unit: unit.no, unitName: unit.name, tag: m[1], name: m[2].trim(), qa: parseInt(m[3], 10), qb: parseInt(m[4], 10), aa: parseInt(m[5], 10), ab: parseInt(m[6], 10) });
        }
      });
    }
    return { sections: secs, tocPage: tocPage };
  }
  async function readCircledAnswers(doc, scan) {
    const targets = Object.keys(scan.answers || {}).map(Number).filter(n => { const a = scan.answers[n]; return a && !a.text && !a.written && a.mr && a.page; });
    if (targets.length < 3) return 0;
    const samples = [];
    for (const n of targets) {
      const a = scan.answers[n];
      try {
        // 「② 」 하나뿐 아니라 「③, ⑤」처럼 동그라미 숫자 그림이 여러 개 이어진 정답도 읽는다: 줄 오른쪽을 넓게 떼어 글자 덩어리로 나눈 뒤 동그라미 모양만 모은다
        const c = await renderRect(doc, a.page, [a.mr + 3, a.mtop - 3, a.mr + 110, a.mbottom + 3], 6, false);
        const w = c.width, h = c.height, d = c.getContext('2d').getImageData(0, 0, w, h).data;
        const colInk = new Array(w).fill(false);
        for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) { const i = (y * w + x) * 4; if (1 - (d[i] + d[i + 1] + d[i + 2]) / 765 > 0.45) { colInk[x] = true; break; } }
        const blobs = []; let x = 0;
        while (x < w) {
          if (!colInk[x]) { x++; continue; }
          let x0 = x, last = x;
          while (x < w && (colInk[x] || x - last <= 2)) { if (colInk[x]) last = x; x++; }
          blobs.push([x0, last]);
        }
        let k = 0, prevEnd = -1;
        for (const bl of blobs) {
          if (prevEnd >= 0 && bl[0] - prevEnd > 60) break;                     // 멀리 떨어진 글자는 정답이 아니다
          const sub = createCanvas(bl[1] - bl[0] + 1, h), sx = sub.getContext('2d');
          sx.fillStyle = '#fff'; sx.fillRect(0, 0, sub.width, sub.height); sx.drawImage(c, bl[0], 0, sub.width, h, 0, 0, sub.width, h);
          const v = glyphVecFromCanvas(sub);
          if (v) { samples.push({ n: n, k: k++, v: v }); prevEnd = bl[1]; }
          else if (bl[1] - bl[0] < 0.4 * h) { prevEnd = bl[1]; continue; }   // 쉼표·점은 건너뛴다
          else break;                                                          // 동그라미가 아닌 큰 덩어리가 나오면 거기서 끝
        }
      } catch (e) {}
    }
    if (samples.length < 3) return 0;
    // 같은 모양끼리 묶기
    const clusters = [];
    samples.forEach(sm => {
      let best = null, bs = 0.95;
      clusters.forEach(cl => { const s2 = dotv(sm.v, cl.mean); if (s2 > bs) { bs = s2; best = cl; } });
      if (!best) { best = { members: [], sum: new Float32Array(sm.v.length), mean: sm.v }; clusters.push(best); }
      best.members.push(sm); best.sum.forEach((_, i) => { best.sum[i] += sm.v[i]; });
      best.mean = normVec(Float32Array.from(best.sum));
    });
    if (clusters.length > 9) return 0;
    // 숫자는 5가지뿐이니, 5묶음을 넘으면 가장 닮은 두 묶음을 합친다
    while (clusters.length > 5) {
      let bi = 0, bj = 1, bv = -2;
      for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) { const v2 = dotv(clusters[i].mean, clusters[j].mean); if (v2 > bv) { bv = v2; bi = i; bj = j; } }
      const A = clusters[bi], Bc = clusters[bj];
      A.members = A.members.concat(Bc.members); A.sum.forEach((_, k) => { A.sum[k] += Bc.sum[k]; }); A.mean = normVec(Float32Array.from(A.sum));
      clusters.splice(bj, 1);
    }
    const tpls = circledTemplates();
    if (!tpls.length) return 0;
    const score = clusters.map(cl => [1, 2, 3, 4, 5].map(dg => Math.max.apply(null, tpls.map(t => dotv(cl.mean, t[dg - 1])))));
    // 묶음마다 서로 다른 숫자를 배정하는 가장 좋은 조합 (최대 5!가지)
    let bestAssign = null, bestTotal = -9;
    (function rec(i, used, cur, tot) {
      if (i === clusters.length) { if (tot > bestTotal) { bestTotal = tot; bestAssign = cur.slice(); } return; }
      for (let dg = 1; dg <= 5; dg++) if (!used[dg]) { used[dg] = 1; cur.push(dg); rec(i + 1, used, cur, tot + score[i][dg - 1]); cur.pop(); used[dg] = 0; }
    })(0, {}, [], 0);
    if (!bestAssign) return 0;
    let set = 0; const got = {};
    clusters.forEach((cl, i) => {
      const sc = score[i][bestAssign[i] - 1];
      const second = Math.max.apply(null, score[i].filter((_, k) => k !== bestAssign[i] - 1));
      if (sc < 0.5) return;                      // 서로 다른 숫자를 하나씩 배정한 결과라, 한두 개뿐인 묶음도 점수가 어느 정도면 믿는다
      cl.members.forEach(sm => { (got[sm.n] = got[sm.n] || {})[sm.k] = String(bestAssign[i]); });
    });
    // 한 문항의 동그라미 숫자를 전부 읽었을 때만 정답으로 쓴다 (「③, ⑤」 → "35": 둘 다 골라야 정답)
    const got2 = Object.keys(got);
    got2.forEach(n => {
      const per = got[n], cnt = samples.filter(sm => String(sm.n) === n).length;
      if (Object.keys(per).length !== cnt) return;
      scan.answers[n].text = Object.keys(per).sort((x, y) => x - y).map(k => per[k]).join(''); scan.answers[n].fromGlyph = true; set++;
    });
    scan._glyphDebug = { clusters: clusters.map((cl, i) => ({ n: cl.members.length, dg: bestAssign[i], score: score[i].map(x => +x.toFixed(2)) })) };
    return set;
  }

  // ── 정답표(글자로 된 "1 ① 2 ③ ..." 형태) 읽기: 문제 페이지 뒤쪽 페이지에서만 찾는다 ──
  // 과목별 정답표에서 "과학" 열만 읽는다. 열 위치는 머리글 "과학"의 가로 위치로 찾고, 번호는 맨 왼쪽 숫자 열이다.
  async function parseSubjectGrid(doc, p) {
    const pd = await pageItems(doc, p);
    const heads = pd.items.filter(it => it.str.replace(/\s+/g, '') === '과학');
    for (const h of heads) {
      const cx = h.x + h.w / 2;
      const below = pd.items.filter(it => it.top > h.bottom - 1 && /\S/.test(it.str));
      const nums = below.filter(it => /^\d{1,2}$/.test(it.str.trim()));
      if (nums.length < 5) continue;
      const minX = Math.min.apply(null, nums.map(it => it.x));
      const rowNums = nums.filter(it => it.x < minX + 30 && it.x < cx - 20).sort((a, b) => a.top - b.top);
      const out = {};
      for (const r of rowNums) {
        const n = parseInt(r.str.trim(), 10);
        const cells = below.filter(it => it !== r && Math.abs(it.base - r.base) < 5 && Math.abs(it.x + it.w / 2 - cx) < 26);
        if (!cells.length) break;
        const t = cells.map(c => c.str.trim()).join('').replace(/\s+/g, '');
        if (/^[1-5](?:[,，][1-5])*$/.test(t)) out[n] = t.replace(/[,，]/g, '');
        else break;                                    // "이하여백" 등이 나오면 거기까지
      }
      if (Object.keys(out).length >= 5) return out;
    }
    return null;
  }
  // 학교 "교과목별 정답/배점" 표: [문항 | 배점 | 정답 | 복수구분(AND/OR)] 묶음이 가로로 여러 번 반복된다.
  // 정답이 "2,4 AND"이면 둘 다 골라야 정답(복수정답 "24"), "1,2 OR"이면 둘 중 하나만 맞아도 정답이다 (앱은 OR을 지원하지 않아 첫 번호로 채우고 알려 준다).
  async function parseKeyTable(doc, p) {
    const pd = await pageItems(doc, p);
    const heads = pd.items.filter(it => it.str.replace(/\s+/g, '') === '정답' &&
      pd.items.some(o => o.str.replace(/\s+/g, '') === '배점' && Math.abs(o.top - it.top) < 5 && o.x < it.x && it.x - o.x < 60)).sort((a, b) => a.x - b.x);   // 열 머리글의 "배점 | 정답" (제목의 "정답/배점"은 제외)
    if (heads.length < 2) return null;
    const hTop = Math.max.apply(null, heads.map(h => h.top));
    const cxs = heads.map(h => h.x + h.w / 2);
    const gw = cxs.length > 1 ? (cxs[cxs.length - 1] - cxs[0]) / (cxs.length - 1) : 110;
    const rows = [];
    // 같은 쪽 아래에 "서답형" 표가 따로 있으면 거기부터는 읽지 않는다 (서답형 1~4번 배점이 객관식 정답을 덮어쓰던 문제)
    const sd = pd.items.filter(it => it.top > hTop + 20 && it.str.replace(/\s+/g, '') === '서답형').map(it => it.top);
    const lim = sd.length ? Math.min.apply(null, sd) - 2 : Infinity;
    pd.items.filter(it => it.top > hTop + 4 && it.top < lim && /\S/.test(it.str)).sort((a, b) => a.base - b.base).forEach(it => {
      const r = rows.find(x => Math.abs(x.base - it.base) < 3.5);
      if (r) r.items.push(it); else rows.push({ base: it.base, items: [it] });
    });
    const answers = {}, notes = [];
    rows.forEach(r => {
      cxs.forEach(cx => {
        const toks = r.items.filter(it => it.x >= cx - 0.6 * gw && it.x < cx + 0.42 * gw).sort((a, b) => a.x - b.x);
        if (toks.length < 3) return;
        const n = parseInt(toks[0].str.trim(), 10);
        if (!(n >= 1 && n <= 80) || !/^\d{1,2}$/.test(toks[0].str.trim())) return;
        const cand = toks.slice(1).filter(t => /^[1-5](?:\s*[,，]\s*[1-5])*$/.test(t.str.trim()));
        if (!cand.length) return;
        cand.sort((a, b) => Math.abs(a.x + a.w / 2 - cx) - Math.abs(b.x + b.w / 2 - cx));
        const ans = cand[0].str.replace(/\s+/g, '').split(/[,，]/);
        const flag = (toks.find(t => /^(AND|OR)$/i.test(t.str.trim())) || { str: '' }).str.trim().toUpperCase();
        if (ans.length > 1 && flag === 'OR') { answers[n] = ans.join('/'); notes.push(n + '번: ' + ans.join(' 또는 ') + ' 중 하나만 맞아도 정답(OR)으로 입력했어요'); }
        else answers[n] = Array.from(new Set(ans)).sort().join('');
      });
    });
    return Object.keys(answers).length >= 5 ? { answers: answers, notes: notes } : null;
  }
  // ── 정답표가 "그림(이미지)"로 들어 있는 시험지 읽기 ──
  // 글자가 아니라 사진이라 글자 추출로는 안 읽힌다. 표의 칸을 선으로 나누고, 같은 표의 "문항" 열(1, 2, 3 …)에서 숫자 모양 견본을 얻어 정답 열의 숫자를 알아본다.
  // (문항 번호는 1부터 차례로 이어진다고 보고, 칸 수와 맞지 않으면 정답표가 아니라고 보고 포기한다)
  function _inkMap(c) {
    const w = c.width, h = c.height, d = c.getContext('2d').getImageData(0, 0, w, h).data;
    const ink = new Uint8Array(w * h), gray = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) { const g = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 3; gray[i] = g; ink[i] = g < 150 ? 1 : 0; }
    return { w: w, h: h, ink: ink, gray: gray };
  }
  function _runs(flags) {         // true가 이어진 구간의 가운데 위치들
    const out = []; let st = -1;
    for (let i = 0; i <= flags.length; i++) {
      const on = i < flags.length && flags[i];
      if (on && st < 0) st = i;
      if (!on && st >= 0) { out.push(Math.round((st + i - 1) / 2)); st = -1; }
    }
    return out;
  }
  // 칸 안의 글자(연결된 덩어리) 찾기: [{x0,y0,x1,y1}] 왼쪽부터
  function _glyphsIn(M, x0, y0, x1, y1) {
    const w = M.w, seen = new Uint8Array((x1 - x0) * (y1 - y0)), comps = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (!M.ink[y * w + x] || seen[(y - y0) * (x1 - x0) + (x - x0)]) continue;
      const stack = [[x, y]]; seen[(y - y0) * (x1 - x0) + (x - x0)] = 1;
      let bx0 = x, bx1 = x, by0 = y, by1 = y, area = 0;
      while (stack.length) {
        const pt = stack.pop(); area++;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = pt[0] + dx, ny = pt[1] + dy;
          if (nx < x0 || nx >= x1 || ny < y0 || ny >= y1) continue;
          const k = (ny - y0) * (x1 - x0) + (nx - x0);
          if (seen[k] || !M.ink[ny * w + nx]) continue;
          seen[k] = 1; stack.push([nx, ny]);
          if (nx < bx0) bx0 = nx; if (nx > bx1) bx1 = nx; if (ny < by0) by0 = ny; if (ny > by1) by1 = ny;
        }
      }
      if (area >= 8) comps.push({ x0: bx0, y0: by0, x1: bx1 + 1, y1: by1 + 1, area: area });
    }
    return comps.sort((a, b) => a.x0 - b.x0);
  }
  function _digitVec(M, g) {
    const N = 10, H2 = 14, v = new Float32Array(N * H2), gw = g.x1 - g.x0, gh = g.y1 - g.y0;
    for (let j = 0; j < H2; j++) for (let i = 0; i < N; i++) {
      let sum = 0, cnt = 0;
      const xa = Math.floor(g.x0 + i * gw / N), xb = Math.max(xa + 1, Math.floor(g.x0 + (i + 1) * gw / N));
      const ya = Math.floor(g.y0 + j * gh / H2), yb = Math.max(ya + 1, Math.floor(g.y0 + (j + 1) * gh / H2));
      for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) { sum += 1 - M.gray[y * M.w + x] / 255; cnt++; }
      v[j * N + i] = cnt ? sum / cnt : 0;
    }
    // 가로세로 비율도 구별에 쓴다(1은 좁다)
    const out = new Float32Array(v.length + 1); out.set(v); out[v.length] = Math.min(gw / Math.max(1, gh), 1.2) * 0.8;
    return normVec(out);
  }
  async function readImageTable(doc, p, rect, scan) {
    const SC = 5;
    const c = await renderRect(doc, p, rect, SC, false);
    const M = _inkMap(c), w = M.w, h = M.h;
    // 가로줄·세로줄 찾기
    const rowFrac = new Float32Array(h), colFrac = new Float32Array(w);
    for (let y = 0; y < h; y++) { let n = 0; for (let x = 0; x < w; x++) n += M.ink[y * w + x]; rowFrac[y] = n / w; }
    const hl = _runs(Array.from(rowFrac, f => f >= 0.7));
    if (hl.length < 6) return null;
    { const avg = (hl[hl.length - 1] - hl[1]) / Math.max(1, hl.length - 2); if (h - 1 - hl[hl.length - 1] > avg * 0.6 && h - 1 - hl[hl.length - 1] < avg * 1.5) hl.push(h - 1); }   // 그림 맨 아래 줄이 가장자리에 걸려 안 잡힌 경우
    const top = hl[0], bot = hl[hl.length - 1];
    for (let x = 0; x < w; x++) { let n = 0; for (let y = top; y <= bot; y++) n += M.ink[y * w + x]; colFrac[x] = n / Math.max(1, bot - top + 1); }
    const vl = _runs(Array.from(colFrac, f => f >= 0.85));
    // 그림 가장자리에 걸린 맨 오른쪽(또는 왼쪽) 표 테두리는 선으로 안 잡힐 수 있다 → 칸 수가 홀수면 가장자리 선을 보태 본다
    if (vl.length === 4 || vl.length === 6 || vl.length === 8) { if (vl[vl.length - 1] < w - 6) vl.push(w - 1); else if (vl[0] > 6) vl.unshift(0); }
    const ncol = vl.length - 1;
    if (ncol !== 4 && ncol !== 8 && ncol !== 6 && ncol !== 2) return null;
    const rowsN = hl.length - 2;          // 맨 윗줄은 머리글 칸
    if (rowsN < 5) return null;
    // 칸 묶음이 「문항 | 정답」 두 칸씩인 표(문항 정답 문항 정답)와 「문항 | 배점 | 정답 | 복수구분」 네 칸씩인 표를 구분한다:
    // 두 칸 묶음이면 세 번째 칸에도 문항 번호(rowsN+1, rowsN+2 …)가 이어져 있다
    let stride = 4;
    if (ncol === 6 || ncol === 2) stride = 2;
    else if (ncol === 4) {
      const IN0 = 7; let hit = 0, tot0 = 0;
      for (let r = 1; r <= rowsN; r++) {
        const x0 = vl[2] + IN0, x1 = vl[3] - IN0 + 1, y0 = hl[r] + IN0, y1 = hl[r + 1] - IN0 + 1;
        const gs = _glyphsIn(M, x0, y0, x1, y1).filter(g => (g.y1 - g.y0) >= 8);
        tot0++; if (gs.length === String(rowsN + r).length) hit++;
      }
      if (hit >= tot0 * 0.7) stride = 2;
    }
    const blocks = ncol / stride;
    const IN = 7;
    const cell = (r, cc) => ({ x0: vl[cc] + IN, x1: vl[cc + 1] - IN + 1, y0: hl[r] + IN, y1: hl[r + 1] - IN + 1 });
    // 1) 문항 열에서 숫자 견본 만들기
    const samples = {};
    let bad = 0, tot = 0;
    for (let b = 0; b < blocks; b++) for (let r = 1; r <= rowsN; r++) {
      const label = String(b * rowsN + r), cl = cell(r, b * stride);
      const gs = _glyphsIn(M, cl.x0, cl.y0, cl.x1, cl.y1).filter(g => (g.y1 - g.y0) >= 8 * SC / 5 * 1.0);
      tot++;
      if (gs.length !== label.length) { bad++; continue; }
      gs.forEach((g, i) => { const d = label.charAt(i); (samples[d] = samples[d] || []).push(_digitVec(M, g)); });
    }
    if (bad > tot * 0.25 || Object.keys(samples).length < 8) return null;
    const classify = g => {
      let best = '', bs = -9;
      Object.keys(samples).forEach(d => samples[d].forEach(v => { const s2 = dotv(v, _digitVec(M, g)); if (s2 > bs) { bs = s2; best = d; } }));
      return bs > 0.5 ? best : '';
    };
    // 2) 정답(3번째)·복수구분(4번째) 열 읽기
    const answers = {}, notes = [];
    for (let b = 0; b < blocks; b++) for (let r = 1; r <= rowsN; r++) {
      const num = b * rowsN + r;
      const ca = cell(r, b * stride + (stride === 2 ? 1 : 2)), cf = stride === 2 ? { x0: 0, y0: 0, x1: 0, y1: 0 } : cell(r, b * 4 + 3);
      const gs = _glyphsIn(M, ca.x0, ca.y0, ca.x1, ca.y1);
      if (!gs.length) continue;
      const maxH = Math.max.apply(null, gs.map(g => g.y1 - g.y0));
      const parts = []; let curr = '';
      gs.forEach(g => {
        const gh = g.y1 - g.y0;
        if (gh < maxH * 0.55) { if (curr) { parts.push(curr); curr = ''; } return; }       // 쉼표(작은 덩어리)
        curr += classify(g);
      });
      if (curr) parts.push(curr);
      const joined = parts.join('');
      if (!joined || !/^[1-9]+$/.test(joined)) continue;
      const fg = stride === 2 ? [] : _glyphsIn(M, cf.x0, cf.y0, cf.x1, cf.y1).filter(g => g.area >= 12);
      const isOr = fg.length > 0 && fg.length <= 2;       // "OR" = 글자 2개, "AND" = 3개
      if (parts.length > 1 && isOr) { answers[num] = Array.from(new Set(parts)).sort().join('/'); notes.push(num + '번: ' + parts.join(' 또는 ') + ' 중 하나만 맞아도 정답(OR)으로 입력했어요'); }
      else answers[num] = Array.from(new Set(joined.split(''))).sort().join('');
    }
    return Object.keys(answers).length >= 5 ? { answers: answers, notes: notes } : null;
  }
  async function parseImageKeyTable(doc, scan) {
    const lastQ = scan.questionPages && scan.questionPages.length ? Math.max.apply(null, scan.questionPages) : 1;
    for (let p = Math.max(1, lastQ); p <= scan.pageCount; p++) {
      let pd; try { pd = await pageItems(doc, p, true); } catch (e) { continue; }
      const cands = (pd.imgs || []).filter(r => !r[4] && (r[3] - r[1]) >= 100 && (r[2] - r[0]) >= 100 && (r[2] - r[0]) < pd.W * 0.9)
        .sort((a, b) => (b[2] - b[0]) * (b[3] - b[1]) - (a[2] - a[0]) * (a[3] - a[1]));
      for (const r of cands.slice(0, 4)) {
        let res = null; try { res = await readImageTable(doc, p, r, scan); } catch (e) { if (typeof global !== "undefined" && global.__DBG) console.log("readImageTable err", e.stack); }
        if (res) return { answers: res.answers, pages: p > lastQ ? [p] : [], label: p + '쪽 그림 정답표', notes: res.notes };
      }
    }
    return null;
  }

  // 글자로 된 「문항 정답 | 문항 정답」 표 (번호 칸과 정답 칸이 쌍으로 여러 묶음 나란히): 머리글 「문항」「정답」 위치를 기준으로 읽는다.
  // 마지막 문제와 같은 쪽에 붙어 있는 표도 읽는다.
  async function parseNumAnsGrid(doc, p) {
    const pd = await pageItems(doc, p);
    const norm = it => String(it.str).replace(/\s+/g, '');
    const heads = pd.items.filter(it => /^(문항|번호|문번|문항번호)$/.test(norm(it)));
    const ansH = pd.items.filter(it => /^정답$/.test(norm(it)));
    if (heads.length < 1 || !ansH.length) return null;
    const out = {};
    // 같은 높이에 있는 머리글 짝(문항, 정답)을 모은다
    const pairs = [];
    heads.forEach(h => {
      const a = ansH.filter(x => Math.abs(x.top - h.top) < 6 && x.x > h.x).sort((u, v) => u.x - v.x)[0];
      if (a) pairs.push({ h: h, a: a });
    });
    if (!pairs.length) return null;
    const rowsTop = Math.min.apply(null, pairs.map(q => q.h.bottom)) + 1;
    pairs.sort((u, v) => u.h.x - v.h.x);
    pairs.forEach((q, i) => {
      const nx = pairs[i + 1] ? pairs[i + 1].h.x - 4 : q.a.x + 90;
      const numLo = q.h.x - 14, numHi = (q.h.x + q.a.x) / 2 + 4, ansLo = Math.max(numHi, q.a.x - 10), ansHi = Math.min(nx, q.a.x + (q.a.w || 20) + 28);      // 정답 칸만 (사이의 배점 칸은 제외)
      const nums = pd.items.filter(it => it.top > rowsTop && it.x >= numLo && it.x < numHi && /^\d{1,2}$/.test(norm(it)));
      nums.forEach(nm => {
        const n = parseInt(norm(nm), 10);
        const as = pd.items.filter(it => Math.abs(it.top - nm.top) < 5 && it.x >= ansLo && it.x < ansHi).sort((u, v) => u.x - v.x);
        const t = as.map(it => String(it.str)).join('').replace(/[\s,，·/]/g, '');
        if (/^[1-5]{1,5}$/.test(t) && !(n in out)) out[n] = Array.from(new Set(t.split(''))).sort().join('');
        else { const c = t.match(/^[①②③④⑤]{1,5}$/); if (c && !(n in out)) out[n] = multiAnswerText(t) || CIRCLED[t.charAt(0)]; }
      });
    });
    return Object.keys(out).length >= 5 ? out : null;
  }
  // 「문항 | 배점 | 정답 | 복수구분」 글자 표: 한 줄을 (번호, 배점, 정답[, O]) 묶음으로 읽는다. 머리글이 글자로 쪼개져 있어도 된다.
  async function parsePointsTable(doc, p) {
    const pd = await pageItems(doc, p);
    if (!pd.items.some(it => /^배\s*점$/.test(String(it.str).trim()))) return null;
    const its = pd.items.filter(it => String(it.str).trim()).slice().sort((a, b) => a.top - b.top);
    const rows = []; its.forEach(it => { const r = rows[rows.length - 1]; if (r && Math.abs(it.top - r.top) < 4) r.items.push(it); else rows.push({ top: it.top, items: [it] }); });
    const out = {}, notes = [];
    rows.forEach(r => {
      const t = r.items.sort((a, b) => a.x - b.x).map(i => String(i.str).trim()).filter(Boolean);
      for (let i = 0; i + 2 < t.length;) {
        if (/^\d{1,2}$/.test(t[i]) && /^\d(\.\d)?$/.test(t[i + 1]) && /^[1-5](\s*[,，]\s*[1-5])*$/.test(t[i + 2])) {
          const n = parseInt(t[i], 10), parts = t[i + 2].split(/[,，]/).map(x => x.trim());
          let j = i + 3, mark = false, isAnd = false; if (/^(OR|or)$/.test(t[j] || '') || /^[Oo○◯ㅇ]$/.test(t[j] || '')) { mark = true; j++; } else if (/^(AND|and)$/.test(t[j] || '')) { isAnd = true; j++; }
          if (!(n in out)) {
            if (parts.length > 1 && mark) { out[n] = Array.from(new Set(parts)).sort().join('/'); notes.push(n + '번: ' + parts.join(' 또는 ') + ' 중 하나만 맞아도 정답(OR)으로 입력했어요'); }
            else out[n] = Array.from(new Set(parts)).sort().join('');
          }
          i = j;
        } else i++;
      }
    });
    return Object.keys(out).length >= 5 ? { answers: out, notes: notes } : null;
  }
  async function parseAnswerTable(doc, scan) {
    const lastQ = scan.questionPages && scan.questionPages.length ? Math.max.apply(null, scan.questionPages) : 0;
    const found = {}, usedPages = [];
    for (let p = lastQ + 1; p <= scan.pageCount; p++) {
      const pd = await pageItems(doc, p);
      const its = pd.items.slice().sort((a, b) => Math.round(a.top / 4) - Math.round(b.top / 4) || a.x - b.x);
      const text = its.map(i => i.str).join(' ');
      // 번호와 동그라미 숫자의 높이가 조금 달라 글자 순서가 뒤섞이는 표: 번호 바로 오른쪽의 동그라미 숫자를 위치로 짝짓는다 (5쌍 이상 나오면 이쪽을 믿는다)
      const geo = {};
      {
        const nums = pd.items.filter(i => /^\d{1,2}$/.test(i.str)), circ = pd.items.filter(i => /^[①②③④⑤]+$/.test(i.str));
        circ.forEach(c => {
          let best = null, bd = 1e9;
          nums.forEach(nm => { const dx = c.x - (nm.x + nm.w), dy = Math.abs(nm.base - c.base); if (dx > -2 && dx < 45 && dy < 7 && dx + dy < bd) { bd = dx + dy; best = nm; } });
          if (best) { const k = parseInt(best.str, 10); if (!(k in geo)) geo[k] = multiAnswerText(c.str) || CIRCLED[c.str.charAt(0)]; }
        });
      }
      let cnt = 0;
      if (Object.keys(geo).length >= 5) {
        Object.keys(geo).forEach(k => { if (!(k in found)) { found[k] = geo[k]; cnt++; } });
      } else {
        const re = /(\d{1,2})\s*[.)번:]?\s*([①②③④⑤](?:\s*[,，·]?\s*[①②③④⑤])*)/g;
        let m;
        while ((m = re.exec(text))) {
          const n = parseInt(m[1], 10);
          if (!(n in found)) { found[n] = multiAnswerText(m[2]) || CIRCLED[m[2].charAt(0)]; cnt++; }
        }
      }
      if (cnt) usedPages.push(p);
    }
    const out = {}; let n = 1;
    while (found[n]) { out[n] = found[n]; n++; }        // 1번부터 끊기지 않고 이어지는 부분만 인정
    const need = Math.max(5, Math.round((scan.questionCount || 0) * 0.6));
    if (n - 1 < need) {
      // 학교 시험지의 "과목별 정답표"(번호 | 영어 | 과학 | 역사 …) — 과학 칸만 읽는다
      for (let p = Math.max(1, lastQ); p <= scan.pageCount; p++) {
        const pt = await parsePointsTable(doc, p);
        if (pt && Object.keys(pt.answers).length >= need) return { answers: pt.answers, pages: p > lastQ ? [p] : [], notes: pt.notes, label: p + '쪽 정답표' };
      }
      for (let p = lastQ + 1; p <= scan.pageCount; p++) {
        const kt = await parseKeyTable(doc, p);
        if (kt && Object.keys(kt.answers).length >= need) return { answers: kt.answers, pages: [p], notes: kt.notes };
        const g = await parseSubjectGrid(doc, p);
        if (g && Object.keys(g).length >= need) return { answers: g, pages: [p] };
      }
      for (let p = Math.max(1, lastQ); p <= scan.pageCount; p++) {          // 마지막 문제와 같은 쪽에 있는 표도 본다
        const g2 = await parseNumAnsGrid(doc, p);
        if (g2 && Object.keys(g2).length >= Math.min(need, 5)) return { answers: g2, pages: p > lastQ ? [p] : [], label: p + '쪽 정답표' };
      }
      const it = await parseImageKeyTable(doc, scan);
      if (it && Object.keys(it.answers).length >= Math.min(need, 5)) return it;
      return { answers: {}, pages: [] };
    }
    return { answers: out, pages: usedPages };
  }

  // ── 주관식(서술형·단답형) 문항 추정: 문제 글자에 "쓰시오/서술하시오/설명하시오…" 같은 말이 있으면 주관식으로 본다.
  //    ①②③④⑤ 보기가 3개 이상 글자로 읽히면 객관식으로 본다.
  const SUBJ_RE = /서술형|서답형|서술하시오|서술하고|쓰시오|설명하시오|밝히시오|적으시오|말하시오|구하시오|풀이 과정|과정을 쓰|이유를 쓰|쓰고|물음에 답하시오|답하시오|서술|논술|빈칸에?\s*들어갈 말을?\s*쓰|들어갈 말을 쓰/;
  async function subjectiveGuess(doc, scan) {
    const cache = {}, out = {};
    for (const q of scan.questions) {
      const qt = await textInRect(doc, cache, q.page, q.rect);
      const choices = (qt.match(/[①②③④⑤]/g) || []).length;
      const ans = scan.answers && scan.answers[q.num];
      // 정답 자리에 문장이 적혀 있으면(서술형 정답) 문제 안에 ①②③ 단계 표시가 있어도 서술형이다
      out[q.num] = !!(ans && ans.written) || (choices < 3 && SUBJ_RE.test(qt));
    }
    return out;
  }

  // ── 난이도 추정 (외부 AI 없이, 문제·해설의 특징으로 점수를 매긴다) ──
  // 점수가 높을수록 어려운 문항. 절대 기준이 없으니 "같은 문제집 안에서의 상대 순위"로 상·중·하를 나눈다.
  function difficultyScore(qText, eText) {
    const q = qText || '', e = eText || '';
    const qLen = q.replace(/\s/g, '').length, eLen = e.replace(/\s/g, '').length;
    const stm = (q.match(/[ㄱㄴㄷㄹㅁㅂ]\./g) || []).length + (q.match(/\([가나다라마]\)/g) || []).length;
    const calc = /구하|몇 ?g|몇 ?mL|몇 ?%|질량비|부피비|계수의 총합|계산|화학 반응식으로|질량은|비율은|속력|밀도|농도/.test(q);
    const vis = /그림|그래프|모형|표|실험 결과|장치|비율/.test(q);
    const steps = /자료 분석|손풀이|❶|➊/.test(e);
    const sc = Math.min(eLen / 100, 6) + (steps ? 1.5 : 0) + (calc ? 0.8 : 0) + (vis ? 0.5 : 0) +
      Math.min(stm, 6) * 0.15 + qLen / 300;
    return Math.round(sc * 100) / 100;
  }

  async function textInRect(doc, cache, pageNum, rect) {
    if (!cache[pageNum]) cache[pageNum] = await pageItems(doc, pageNum);
    const pd = cache[pageNum];
    const inside = pd.items.filter(it => it.x >= rect[0] - 2 && it.x <= rect[2] && it.top >= rect[1] - 2 && it.top <= rect[3]);
    inside.sort((a, b) => Math.round(a.top / 3) - Math.round(b.top / 3) || a.x - b.x);
    return inside.map(it => it.str).join(' ');
  }

  // scan 결과의 각 문항에 난이도 점수를 붙여서 {문항번호: 점수}로 돌려준다
  async function difficultyScores(doc, scan) {
    const cache = {}, out = {};
    for (const q of scan.questions) {
      const qt = await textInRect(doc, cache, q.page, q.rect);
      let et = '';
      const ex = scan.explanations && scan.explanations[q.num];
      if (ex) for (const sg of ex.segments) et += ' ' + await textInRect(doc, cache, sg.page, sg.rect);
      out[q.num] = difficultyScore(qt, et);
    }
    return out;
  }

  // 점수 목록을 순위로 나눠 상/중/하를 붙인다. topPct·lowPct는 상·하 비율(%)
  function classifyByRank(scores, topPct, lowPct) {
    const idx = scores.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
    const n = idx.length, lo = Math.round(n * lowPct / 100), hi = n - Math.round(n * topPct / 100);
    const res = new Array(n);
    idx.forEach((pair, r) => { res[pair[1]] = r < lo ? '하' : (r >= hi ? '상' : '중'); });
    return res;
  }

  root.BankCore = {
    scanPdf: scanPdf, parseAnswerTable: parseAnswerTable, readCircledAnswers: readCircledAnswers, readLabeledImageAnswers: readLabeledImageAnswers, parseBookToc: parseBookToc, readScannedAnswerSheet: readScannedAnswerSheet, readSheetCanvas: readSheetCanvas, subjectiveGuess: subjectiveGuess, difficultyScores: difficultyScores, difficultyScore: difficultyScore, classifyByRank: classifyByRank, renderRect: renderRect, renderQuestion: renderQuestion, renderExplanation: renderExplanation, canvasToBase64: canvasToBase64,
    textPreview: textPreview, textPreviewQ: textPreviewQ, composeTeacherPdf: composeTeacherPdf, composeWrongNotePdf: composeWrongNotePdf, answerLabelPng: answerLabelPng, composeExamPdf: composeExamPdf, answerSheetDoc: answerSheetDoc, mergePdfs: mergePdfs, addPageNumbers: addPageNumbers,
    textSimilarity: textSimilarity, findSimilarQuestions: findSimilarQuestions,
    _parseKeyTable: parseKeyTable, _parseImageKeyTable: parseImageKeyTable, _readImageTable: readImageTable, detectOptionMarkers: detectOptionMarkers, detectOptionMarkersB64: detectOptionMarkersB64, findSourceMarks: findSourceMarks, sourceMarkRects: sourceMarkRects, applyRedactions: applyRedactions, boxAround: boxAround, stampTitleHeader: stampTitleHeader, _eraseTopRemnants: eraseTopRemnants, _headerPng: headerPng, findHeaderCluster: findHeaderCluster, findTitleBox: findTitleBox, replaceTitleBox: replaceTitleBox, findSchoolTitle: findSchoolTitle, replaceSchoolTitle: replaceSchoolTitle, stripYellowHighlights: stripYellowHighlights, findWatermarkCandidates: findWatermarkCandidates, findPhraseMatches: findPhraseMatches,
    _pageItems: pageItems, eraseEdgeRules: eraseEdgeRules, cleanImageBase64: cleanImageBase64,
    parseHeadRange: parseHeadRange, markAppendedAnswerPages: markAppendedAnswerPages, estimateUnits: estimateUnits, estimateSubs: estimateSubs, linkHeads: linkHeads, selectQuestionSpans: selectQuestionSpans, matchUnitName: matchUnitName, pastTagText: pastTagText, tagPng: tagPng, parseToc: parseToc, unitsToRanges: unitsToRanges, NO_UNIT: NO_UNIT,
    rasterizeToPdf: rasterizeToPdf, needsRasterize: needsRasterize,
    b64ToBytes: b64ToBytes, CROP_SCALE: 2.5,
  };
})(typeof window !== 'undefined' ? window : globalThis);
