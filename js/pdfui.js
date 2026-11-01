// PDF 관련 화면들이 같이 쓰는 도구 모음
const PDFJS_VERSION = '3.11.174';

function setupPdfJs() {
  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('js/vendor/pdf.worker.min.js', location.href).href;
  }
}

async function loadPdfDoc(file) {
  const bytes = await file.arrayBuffer();
  // pdf.js가 버퍼를 가져가 버리므로 원본은 복사해 둔다
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
  return { doc: doc, bytes: bytes };
}

function showSpinner(msg) {
  let el = document.getElementById('spinner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'spinner';
    el.className = 'spinner-overlay';
    document.body.appendChild(el);
  }
  el.innerHTML = '<div style="font-size:28px">⏳</div><div id="spinner-msg">' + msg + '</div>';
}
function updateSpinner(msg) {
  const m = document.getElementById('spinner-msg');
  if (m) m.textContent = msg;
}
function hideSpinner() {
  const el = document.getElementById('spinner');
  if (el) el.remove();
}

/**
 * 정답 입력칸(.ans-input)들을 화면 순서대로 묶어서:
 *  - 숫자 1글자를 치면 자동으로 다음 칸으로 이동
 *  - 백스페이스(빈 칸에서)는 이전 칸, 엔터/방향키는 이동
 *  - 칸에 들어가면 내용을 전부 선택 (그냥 덮어쓰기)
 */
// 입력한 숫자(또는 "주관식" 표시)를 화면 가운데에 잠깐 크게 보여준다 — 작은 칸에 입력하다
// 실수로 다른 숫자를 누르는 걸 바로 알아챌 수 있게.
let flashEl = null, flashTimer = null;
function flashBigNumber(ch) {
  if (!flashEl) {
    flashEl = document.createElement('div');
    flashEl.className = 'big-flash';
    document.body.appendChild(flashEl);
  }
  const isSubj = ch === '-';
  const t = isSubj ? '주관식' : (String(ch).length > 1 ? String(ch).split('').join(',') : String(ch));
  flashEl.textContent = t;
  // 한 자리면 아주 크게, 여러 개(3,5 / 2,4,5)면 칸에 맞게 조금 줄인다
  flashEl.style.fontSize = isSubj ? '34px' : (t.length <= 1 ? '' : (t.length <= 3 ? '80px' : (t.length <= 5 ? '60px' : '44px')));
  flashEl.classList.remove('show'); void flashEl.offsetWidth;  // 애니메이션 다시 시작되게 리플로우
  flashEl.classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { if (flashEl) flashEl.classList.remove('show'); }, isSubj || t.length > 1 ? 800 : 450);
}

// 복수정답(정답이 2개 이상) 모드를 켜고 끈다. 켜면 한 칸에 숫자를 여러 개 넣을 수 있고(예: 3과 5 → "35"),
// 숫자를 눌러도 자동으로 다음 칸으로 넘어가지 않는다(Enter·Space·방향키로 넘어간다).
// 복수정답 칸에서 입력 중인 글자를 정리한다. "/"는 "또는"(둘 중 하나만 맞아도 정답): "1/2". 끝의 "/"는 다음 숫자를 기다리는 중이라 남긴다.
function typedAnswer(raw) {
  const n = normAnswer(raw);
  return n && /\/\s*$/.test(raw) ? n + '/' : n;
}
// "/" 키: 복수정답 칸에 내용이 있으면 "또는" 구분자를 넣는다. 그 외에는 복수정답 모드를 켜고 끈다.
function slashInsertsOr(input) {
  return input.dataset.multi === '1' && /[1-9]$/.test(input.value);
}
function setMulti(input, on, container) {
  const box = container || (input.closest && (input.closest('.abox') || input.closest('.qc') || input.closest('.qcard'))) || input.parentElement;
  if (on) {
    if (input.dataset) input.dataset.multi = '1';
    if (input.removeAttribute) input.removeAttribute('maxlength');
  } else {
    if (input.dataset) delete input.dataset.multi;
    if (String(input.value).length > 1 && input.value !== '-') input.value = String(input.value).charAt(0);
  }
  if (box) {
    box.classList.toggle('is-multi', !!on);
    const tog = box.querySelector('.multi-tog'); if (tog) tog.classList.toggle('on', !!on);
    const chk = box.querySelector('.multichk'); if (chk) chk.checked = !!on;
  }
}
// 칸에 정답 값을 넣는다 (여러 개면 자동으로 복수정답 모드로)
function setAnswerValue(input, a, container) {
  const v = a === '-' ? '-' : normAnswer(a);
  if (v === '-') { setSubjective(input, true, container); return; }
  if (input.disabled) setSubjective(input, false, container);
  setMulti(input, v.length > 1, container);
  input.value = v;
}

// 절대좌표 rect를 base(보통 문항 crop 영역)의 왼쪽위를 0,0으로 하는 상대좌표로 바꾼다.
// 문제은행에 번호 위치(numRect)를 저장할 때, 나중에 crop 이미지 안에서 그 번호가
// 어디 있는지 알아야 해서(새 번호로 덮어쓸 때) 이렇게 상대좌표로 저장해둔다.
function relRect(nr, base) {
  if (!nr || !base) return null;
  const r = v => Math.round(v * 10) / 10;
  return [r(nr[0] - base[0]), r(nr[1] - base[1]), r(nr[2] - base[0]), r(nr[3] - base[1])];
}

// 문항 그림 위에 공통 지문 그림이 붙어 있으면(canvas.mainTop) 번호 위치도 그만큼 아래로 내려간다
function relNum(q, canvas) {
  const r = relRect(q.numRect, q.rect);
  const off = canvas && canvas.mainTop ? canvas.mainTop / (BankCore.CROP_SCALE || 2.5) : 0;
  return r && off ? [r[0], Math.round((r[1] + off) * 10) / 10, r[2], Math.round((r[3] + off) * 10) / 10] : r;
}

function attachAnswerAdvance(root) {
  const inputs = Array.from(root.querySelectorAll('input.ans-input'));
  // 주관식(회색·비활성)으로 표시된 칸은 건너뛰고 다음/이전 "입력 가능한" 칸으로 간다
  const step = (i, dir) => { for (let j = i + dir; j >= 0 && j < inputs.length; j += dir) if (!inputs[j].disabled) return inputs[j]; return null; };
  inputs.forEach(function (input, i) {
    if (input.value && normAnswer(input.value).length > 1) setMulti(input, true);   // 이미 정답이 여러 개로 채워진 칸
    input.addEventListener('focus', function () { input.select(); });
    input.addEventListener('input', function (e) {
      const multi = input.dataset.multi === '1';
      // ③ 같은 동그라미 숫자를 붙여넣어도 숫자로 바꿔서 받는다
      const raw = input.value.replace(/[①-⑨]/g, function (c) { return String(c.charCodeAt(0) - 0x2460 + 1); });
      if (raw.indexOf('-') >= 0) {                                   // '-' = 주관식
        if (multi) setMulti(input, false);
        input.value = '-';
        flashBigNumber('-');
        const nxs = step(i, 1); if (nxs) nxs.focus();
        return;
      }
      const digits = raw.replace(/[^0-9]/g, '');
      const pasted = !!(e && e.inputType && /Paste|Drop/.test(e.inputType));
      if (multi || (pasted && digits.length > 1)) {                  // 복수정답: 이어붙이고 정리, 자동으로 안 넘어감
        if (!multi) setMulti(input, true);
        input.value = typedAnswer(raw.replace(/[^0-9\/]/g, ''));
        if (input.value) flashBigNumber(input.value);
        return;
      }
      input.value = digits.slice(-1);                                 // 보통은 한 자리
      if (input.value) flashBigNumber(input.value);
      const nx = step(i, 1);
      if (input.value && nx) nx.focus();
    });
    input.addEventListener('keydown', function (e) {
      let t = null;
      const multi = input.dataset.multi === '1';
      if (e.key === '/' && slashInsertsOr(input)) { e.preventDefault(); input.value += '/'; return; }   // 1/2 = 둘 중 하나만 맞아도 정답
      if (e.key === '+' || e.key === ',' || e.key === '/') {         // 이 칸을 복수정답 칸으로 켜고 끄는 단축키
        e.preventDefault();
        setMulti(input, !multi);
        const n = input.value.length; try { input.setSelectionRange(n, n); } catch (err) {}
        return;
      }
      if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowRight' || (multi && e.key === ' ')) { e.preventDefault(); t = step(i, 1); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); t = step(i, -1); }
      else if (e.key === 'Backspace' && !input.value) t = step(i, -1);
      if (t) t.focus();
    });
  });
  return inputs;
}

// 주관식 표시: 입력칸을 회색으로 비활성화하고 값을 '-'로 둔다 (자동 채점에서 빠짐). 끄면 다시 입력 가능.
function setSubjective(input, on, container) {
  if (on && input.dataset && input.dataset.multi === '1') setMulti(input, false, container);
  input.disabled = !!on;
  input.value = on ? '-' : '';
  (container || input.parentElement).classList.toggle('is-sub', !!on);
  input.classList.toggle('filled', !!on);
}

// 시험지 PDF의 첫 페이지에 QR을 찍는다.
// opts: { size: QR 한 변(pt, 기본 60), corner: 'top-right'|'top-left'|'bottom-right'|'bottom-left', margin: 가장자리에서 띄울 거리(pt, 기본 10) }
function qrPlacement(pageW, pageH, opts) {
  const size = (opts && opts.size) || 60, m = (opts && opts.margin != null) ? opts.margin : 10, corner = (opts && opts.corner) || 'top-right';
  const x = corner.indexOf('right') >= 0 ? pageW - size - m : m;
  const y = corner.indexOf('top') >= 0 ? pageH - size - m : m;       // PDF 좌표는 아래가 0
  return { x: x, y: y, size: size };
}
async function stampQrOnDoc(pdfDoc, url, opts) { return stampQrOnPage(pdfDoc, 0, url, opts); }
// 지정한 쪽(0부터)에 QR을 찍는다. opts.caption 으로 안내 문구를 바꿀 수 있다.
async function stampQrOnPage(pdfDoc, pageIndex, url, opts) {
  const qrDataUrl = await QRCode.toDataURL(url, { width: 300, margin: 1 });
  const qrBytes = new Uint8Array(await (await fetch(qrDataUrl)).arrayBuffer());
  const qrImage = await pdfDoc.embedPng(qrBytes);
  const first = pdfDoc.getPages()[pageIndex || 0];
  const pl = qrPlacement(first.getWidth(), first.getHeight(), opts);
  first.drawImage(qrImage, { x: pl.x, y: pl.y, width: pl.size, height: pl.size });
  // QR 안내: 쪽 맨 위(아래 모서리면 맨 아래) 가장자리에 한 줄로 작게 — 제목 상자나 지문을 가리지 않게 QR 옆이 아니라 여백에 넣는다
  try {
    const sc = 8, fs = 7, text = (opts && opts.caption) || 'QR코드로 답안 입력하세요', font = 'bold ' + (fs * sc) + 'px "Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif';
    const c = document.createElement('canvas'), m = c.getContext('2d'); m.font = font;
    const tw = Math.ceil(m.measureText(text).width / sc) + 2, th = 10;
    c.width = tw * sc; c.height = th * sc;
    const ctx = c.getContext('2d'); ctx.font = font; ctx.fillStyle = '#0B1F5C'; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
    ctx.fillText(text, c.width - sc, c.height / 2 + sc * 0.3);
    const img = await pdfDoc.embedPng(new Uint8Array(await (await fetch(c.toDataURL('image/png'))).arrayBuffer()));
    const corner = (opts && opts.corner) || 'top-right', right = corner.indexOf('right') >= 0, top = corner.indexOf('top') >= 0;
    const hx = right ? Math.max(2, pl.x - 4 - tw) : Math.min(first.getWidth() - tw - 2, pl.x + pl.size + 4);
    const hy = top ? first.getHeight() - th - 2 : 2;
    first.drawImage(img, { x: hx, y: hy, width: tw, height: th });
  } catch (e) { console.warn('QR 안내 문구를 넣지 못했어요', e); }
}

function studentLinkFor(examId, page) {
  return location.origin + location.pathname.replace(/[^/]*$/, '') + 'student_exam.html?id=' + examId;
}

function genExamId() {
  return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function pngSize(bytes) {
  // PNG 헤더(IHDR)에서 가로·세로를 읽는다
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

function driveThumb(fileId, width) {
  return 'https://drive.google.com/thumbnail?id=' + fileId + '&sz=w' + (width || 500);
}

// (escapeHtml은 모든 화면이 불러오는 api.js로 옮겼어요)

function baseNoExt(filename) {
  return filename.replace(/\.pdf$/i, '').replace(/_+/g, ' ').replace(/(\d)-(?=\d)/g, '$1\u0001').replace(/-+/g, ' ').replace(/\u0001/g, '-').replace(/\s+/g, ' ').trim();
}


// 붙여넣은 정답 글을 해석한다.
//  - "1③ 2① 3④", "1. 3 / 2. 1", "1) ③" 처럼 번호가 붙어 있으면 번호 기준으로
//  - "31425", "3 1 4 2 5", "③①④②⑤" 처럼 답만 나열되어 있으면 순서대로
function parseBulkAnswers(text) {
  const CIR = { '①': '1', '②': '2', '③': '3', '④': '4', '⑤': '5', '⑥': '6', '⑦': '7', '⑧': '8', '⑨': '9' };
  const t = String(text || '');
  const pairs = [];
  // 정답은 한 개(③ / 3), 또는 여러 개: 동그라미 숫자가 이어진 것(③⑤ · ③, ⑤)이나 숫자를 , + / 로 이은 것(3,5).
  // "1. 3, 2. 1"처럼 다음 번호가 따라오는 쉼표는 정답 구분으로 보지 않는다.
  const re = /(\d{1,3})\s*([.)번:\-]?)\s*([①-⑨](?:[\s,，·+\/]*[①-⑨])*|[1-9](?:\s*[,，·+\/]\s*[1-9](?![0-9]|[ \t]*[.)번:]))*)(?![0-9])/g;
  let m;
  while ((m = re.exec(t))) pairs.push({ n: parseInt(m[1], 10), sep: m[2], a: normAnswer(m[3]), circ: /[①-⑨]/.test(m[3]) });
  const strong = pairs.filter(p => p.circ || p.sep);
  if (strong.length >= 2 && strong.length >= pairs.length * 0.6) {
    const byN = {};
    strong.forEach(p => { if (!(p.n in byN)) byN[p.n] = p.a; });
    let max = 0;
    Object.keys(byN).forEach(k => { max = Math.max(max, parseInt(k, 10)); });
    const arr = [];
    for (let i = 1; i <= max; i++) arr.push(byN[i] || '');
    return { mode: 'pairs', answers: arr };
  }
  const seq = (t.match(/[①-⑨]|[1-9]|[-×주]/g) || []).map(c => CIR[c] || (/[-×주]/.test(c) ? '-' : c));
  return { mode: 'seq', answers: seq };
}

// 해석한 결과를 입력칸(input 배열)에 채우고, 몇 개를 채웠는지 돌려준다
function fillAnswersFromText(text, inputs) {
  const r = parseBulkAnswers(text);
  let n = 0;
  r.answers.forEach((a, i) => {
    const inp = inputs[i];
    if (!inp || !a) return;
    const box = inp.closest ? (inp.closest('.abox') || inp.closest('.qc') || inp.parentElement) : inp.parentElement;
    if (a === '-') setSubjective(inp, true, box);
    else { setAnswerValue(inp, a, box); inp.dispatchEvent(new Event('input', { bubbles: false })); }
    n++;
  });
  return { filled: n, parsed: r.answers.length, mode: r.mode };
}


// 그림을 누르면 화면 가득 크게 보여주고, 다시 누르면 닫는다
function zoomImg(src) {
  const ov = document.createElement('div');
  ov.className = 'zoom-ov';
  ov.innerHTML = '<img src="' + src + '">';
  ov.addEventListener('click', () => ov.remove());
  document.body.appendChild(ov);
}

// ── 분류 입력칸 (학년 / 단원 / 일반·기출 / 학교·시험): 문제은행 가져오기·새 시험지 등록에서 같이 쓴다 ──
// prefix: 이 입력칸 묶음의 이름(같은 화면에 여러 묶음이 있어도 안 겹치게)
function classifyFormHtml(prefix, meta) {
  meta = meta || {};
  const opt = (v, label, cur) => '<option value="' + escapeHtml(v) + '"' + (v === cur ? ' selected' : '') + '>' + escapeHtml(label) + '</option>';
  const isPast = meta.kind === '기출';
  return '<div class="cls-form" data-prefix="' + prefix + '">' +
    '<div class="cls-field"><label>학년</label><select class="cls-grade" id="' + prefix + '-grade">' +
      opt('', '(선택 안 함)', meta.grade || '') + GRADE_ORDER.map(g => opt(g, g, meta.grade || '')).join('') + '</select></div>' +
    '<div class="cls-field cls-wide"><label>단원 <span class="hint" style="margin:0;">앞에 번호를 붙이면 순서대로 정렬돼요 (예: 1. 물질의 특성)</span></label>' +
      '<input type="text" class="cls-unit" id="' + prefix + '-unit" list="dl-units" value="' + escapeHtml(meta.unit || '') + '" placeholder="예: 1. 물질의 특성"></div>' +
    '<div class="cls-field"><label>구분</label><select class="cls-kind" id="' + prefix + '-kind">' +
      opt('일반', '일반 문제', isPast ? '기출' : '일반') + opt('기출', '기출문제', isPast ? '기출' : '일반') + '</select></div>' +
    '<div class="cls-field cls-school-wrap" style="' + (isPast ? '' : 'display:none;') + '"><label>출제년도</label>' +
      '<input type="text" class="cls-year" id="' + prefix + '-year" inputmode="numeric" maxlength="4" value="' + escapeHtml(meta.year || '') + '" placeholder="예: 2025" style="max-width:90px;"></div>' +
    '<div class="cls-field cls-wide cls-school-wrap" style="' + (isPast ? '' : 'display:none;') + '"><label>학교·시험 이름 <span class="hint" style="margin:0;">기출문제일 때</span></label>' +
      '<input type="text" class="cls-school" id="' + prefix + '-school" list="dl-schools" value="' + escapeHtml(meta.school || '') + '" placeholder="예: ○○중 2025 1학기 중간"></div>' +
  '</div>';
}
// 구분을 기출로 바꾸면 학교 칸을 보여주고, 값이 바뀔 때마다 onChange(meta)를 부른다
function wireClassify(root, prefix, onChange) {
  const g = id => root.querySelector('#' + prefix + '-' + id);
  // 기출 여부 확인 줄: 지금 어느 쪽으로 저장되는지 보여 주고, 버튼 하나로 바꿀 수 있다 (이름에 변형·유사·대비·모의고사가 있으면 일반으로 시작한다)
  const form = root.querySelector('[data-prefix="' + prefix + '"]');
  let note = null;
  if (form && g('kind')) {
    note = document.createElement('div');
    note.className = 'cls-field cls-wide kind-note';
    note.style.cssText = 'flex-basis:100%; margin-top:2px; font-size:13px;';
    form.appendChild(note);
  }
  const renderNote = () => {
    if (!note) return;
    const past = g('kind').value === '기출', why = form.dataset.kindWhy || '';
    note.innerHTML = (past
      ? '<span style="color:#C1392B; font-weight:700;">🏫 지금 「기출문제」로 저장돼요.</span> 변형·유사·대비·모의고사 문제라면 기출이 아니에요. '
        + '<button type="button" class="btn outline kn-btn" data-to="일반" style="padding:5px 10px; margin-left:4px;">기출 해제 (일반 문제로)</button>'
      : '<span style="font-weight:700;">📘 지금 「일반 문제」로 저장돼요.</span> ' + (why ? escapeHtml(why) + ' ' : '') + '학교 시험에서 실제로 나온 기출이면 '
        + '<button type="button" class="btn outline kn-btn" data-to="기출" style="padding:5px 10px; margin-left:4px;">기출문제로 저장</button>');
    note.querySelectorAll('.kn-btn').forEach(b => b.addEventListener('click', () => {
      const k = g('kind'); k.value = b.dataset.to; k.dataset.touched = '1';
      k.dispatchEvent(new Event('change', { bubbles: true }));
    }));
  };
  const fire = () => { renderNote(); (() => { const wrap = root.querySelector('[data-prefix="' + prefix + '"] .cls-school-wrap'); if (wrap) wrap.style.display = g('kind').value === '기출' ? '' : 'none'; if (onChange) onChange(readClassify(root, prefix)); })(); };
  renderNote();
  ['grade', 'unit', 'kind', 'school', 'year'].forEach(k => { const el = g(k); if (el) { el.addEventListener('input', fire); el.addEventListener('change', fire); } });
}
function readClassify(root, prefix) {
  const g = id => { const el = root.querySelector('#' + prefix + '-' + id); return el ? el.value.trim() : ''; };
  const kind = g('kind') === '기출' ? '기출' : '일반';
  return { grade: g('grade'), unit: g('unit'), kind: kind, school: kind === '기출' ? g('school') : '', year: kind === '기출' ? (g('year').match(/20\d\d/) || [''])[0] : '' };
}
// "1-8 물질의 상태 변화" / "9~15번 여러 가지 힘" / "20 에너지" 처럼 줄(또는 ;)마다 "번호 범위 + 단원"을 적은 글을 읽는다.
// 한 파일에 여러 단원이 섞인 학교 기출문제에서, 문항마다 단원을 따로 치지 않고 한 번에 지정할 때 쓴다.
function parseUnitRanges(text) {
  const out = [], bad = [];
  String(text || '').split(/[\n;]+/).forEach(line => {
    const l = line.trim();
    if (!l) return;
    const m = l.match(/^(\d{1,3})\s*(?:[-~∼–]\s*(\d{1,3}))?\s*번?\s*[:=,]?\s*(.+)$/);
    if (!m || !m[3].trim()) { bad.push(l); return; }
    let a = parseInt(m[1], 10), b = m[2] ? parseInt(m[2], 10) : a;
    if (b < a) { const t = a; a = b; b = t; }
    let unit = m[3].trim(), grade = '';
    const gm = unit.match(/^(초\s*6|중\s*([123])|고\s*([123])|([123])\s*학년)\s+(.+)$/);       // "2학년 4단원 물질의 구성" → 학년 + 단원
    if (gm) {
      grade = gm[4] ? '중' + gm[4] : gm[1].replace(/\s+/g, '');
      unit = gm[5].trim();
    }
    out.push({ from: a, to: b, unit: unit, grade: grade });
  });
  return { ranges: out, bad: bad };
}

// 단원 추정에 "정답지"로 쓸 수 있는 문제만 고른다: 단원이 있고(미지정 제외),
// 학년이 정해졌거나 단원 이름이 파일 이름 그대로가 아닌 것. (분류 안 된 예전 문항은 단원 칸에 PDF 제목이 들어 있어서,
// 그걸 정답으로 쓰면 "문제집 제목"을 단원으로 추정해 버린다.)
function trainableQuestions(list) {
  // 학교 기출문제(kind=기출)는 단원을 문항마다 추정·수정해 둔 것이라 믿을 수 없다 → 비교 기준(정답지)에서 뺀다. 목차와 일반 문제집으로만 비교한다.
  return (list || []).filter(q => q && q.unit && q.unit !== '(단원 미지정)' && q.kind !== '기출' && (q.grade || String(q.unit) !== String(q.source)));
}
// 추정 결과 한 줄 요약
function estimateSummary(results, info) {
  const readable = results.filter(r => r.unit).length;
  const hi = results.filter(r => r.confident).length;
  return { total: results.length, readable: readable, unreadable: results.length - readable, confident: hi, low: readable - hi };
}

// 문제은행에 이미 있는 단원·학교 이름을 자동완성 후보로 채운다 (한 번만 불러온다)
let taxonomyLoaded = false;
function loadTaxonomyDatalists() {
  if (!document.getElementById('dl-units')) {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<datalist id="dl-units"></datalist><datalist id="dl-schools"></datalist>';
    document.body.appendChild(wrap);
  }
  if (taxonomyLoaded) return Promise.resolve();
  taxonomyLoaded = true;
  return callApi('listTaxonomy', { password: getTeacherPassword() }).then(res => {
    if (!res || !res.ok) return;
    const units = Array.from(new Set(res.taxonomy.map(t => t.unit).filter(Boolean))).sort(naturalCompare);
    const schools = Array.from(new Set(res.taxonomy.map(t => t.school).filter(Boolean))).sort(naturalCompare);
    window._taxUnits = units;
    document.getElementById('dl-units').innerHTML = units.map(u => '<option value="' + escapeHtml(u) + '">').join('');
    document.getElementById('dl-schools').innerHTML = schools.map(u => '<option value="' + escapeHtml(u) + '">').join('');
  }).catch(() => { taxonomyLoaded = false; });
}


// ── 과학 목차: 서버(없으면 이 브라우저)에 글로 저장해 두고, 단원 추정할 때 기준으로 쓴다 ──
const DEFAULT_TOC = `[중1]
과학과 인류의 지속가능한 삶 (탐구): 탐구, 과학적 탐구 방법, 지속가능발전, 변인 통제, 가설, 대조군, 실험군, 탐구 설계
  01 과학과 인류의 지속가능한 삶: 과학, 지속가능, 지속가능발전, 과학 기술, 인류, 삶, 탐구, 과학적 탐구
생물의 구성과 다양성: 세포, 조직, 기관, 기관계, 개체, 세포막, 핵, 엽록체, 미토콘드리아, 현미경, 생물 다양성, 분류, 종, 계, 식물, 동물, 균계, 원생생물, 원핵생물
  01 생물의 구성: 세포, 조직, 기관, 기관계, 개체, 세포막, 핵, 엽록체, 미토콘드리아, 세포 관찰, 현미경, 식물의 구성, 동물의 구성
  02 생물다양성과 분류: 생물 다양성, 분류, 분류 기준, 종, 속, 과, 목, 강, 문, 계, 5계, 원핵생물, 원생생물, 균계, 식물계, 동물계, 종 다양성, 생태계 다양성, 유전적 다양성
  03 생물다양성보전: 생물 다양성 보전, 멸종 위기, 멸종, 서식지 파괴, 외래종, 남획, 환경 오염, 보전 방안, 생물 다양성 위기
열: 온도, 열평형, 전도, 대류, 복사, 비열, 열용량, 열팽창, 단열, 열의 이동, 열량
  01 열의 이동: 열의 이동, 온도, 열평형, 전도, 대류, 복사, 단열, 열량, 온도계, 입자 운동, 접촉
  02 비열과 열팽창: 비열, 열용량, 열팽창, 팽창, 바이메탈, 액체의 비열, 비열 비교, 질량, 열팽창 관찰
물질의 상태 변화: 융해, 응고, 기화, 액화, 승화, 융해열, 기화열, 끓는점, 녹는점, 입자 배열, 고체, 액체, 기체, 증발, 물질의 상태, 입자의 운동, 입자 모형, 확산, 증발, 입자 사이의 거리, 입자 배열, 상태 변화, 물질의 세 가지 상태
  01 물질을 구성하는 입자의 운동: 입자의 운동, 확산, 증발, 브라운 운동, 입자, 입자 배열, 잉크 확산, 향수
  02 물질의 상태와 상태 변화: 고체, 액체, 기체, 융해, 응고, 기화, 액화, 승화, 상태 변화, 입자 배열, 드라이아이스, 부피 변화, 질량 변화
  03 상태 변화와 열에너지: 융해열, 응고열, 기화열, 액화열, 상태 변화와 열에너지, 끓는점, 녹는점, 가열 곡선, 냉각 곡선, 온도 변화 측정, 열에너지 출입
힘의 작용: 힘, 중력, 탄성력, 마찰력, 합력, 힘의 평형, 질량, 무게, 부력, 훅의 법칙, 힘의 표시
  01 힘의 표현과 평형: 힘의 표현, 힘의 3요소, 힘의 크기, 힘의 방향, 작용점, 합력, 힘의 합성, 힘의 평형, 알짜힘
  02 여러 가지 힘: 중력, 탄성력, 마찰력, 훅의 법칙, 용수철, 용수철저울, 무게, 질량, 부력, 탄성, 접촉면, 나무 도막
  03 힘의 작용과 운동 상태 변화: 운동 상태 변화, 속력 변화, 운동 방향 변화, 힘과 운동, 관성, 알짜힘, 물체의 운동
기체의 성질: 보일 법칙, 샤를 법칙, 기체의 압력, 기체의 부피, 온도, 기체 분자 운동, 압력과 부피, 기체의 압력, 입자의 운동과 기체, 보일, 샤를
  01 기체의 압력: 기체의 압력, 압력, 대기압, 기체 분자 운동, 기체 분자, 충돌, 단위 넓이
  02 기체의 압력과 온도, 부피 관계: 보일 법칙, 샤를 법칙, 압력과 부피, 온도와 부피, 기체의 부피, 기체 부피 변화, 피스톤, 일정한 온도, 일정한 압력
태양계: 지구의 자전, 지구의 공전, 달의 위상, 일식, 월식, 행성, 금성, 화성, 태양의 활동, 흑점, 코로나, 별의 일주 운동, 남중 고도, 계절
  01 태양계의 구성: 태양계, 태양, 행성, 지구형 행성, 목성형 행성, 금성, 화성, 수성, 목성, 토성, 흑점, 코로나, 태양의 활동, 위성
  02 지구의 운동: 지구의 자전, 지구의 공전, 일주 운동, 연주 운동, 별자리, 계절 변화, 황도 12궁, 태양의 연주 운동
  03 달의 운동: 달의 위상, 일식, 월식, 삭, 망, 달의 공전, 달의 모양, 상현달, 하현달, 보름달, 그믐달
[중2]
물질의 특성: 순물질, 혼합물, 밀도, 끓는점, 녹는점, 용해도, 어는점, 증류, 거름, 크로마토그래피, 재결정, 혼합물의 분리, 용매, 용질, 물질의 분류, 물질 분리, 혼합물의 분리, 순물질과 혼합물, 물질의 특성
  01 물질의 특성: 순물질, 혼합물, 균일 혼합물, 불균일 혼합물, 물질의 특성, 밀도, 끓는점, 녹는점, 어는점, 물질의 밀도, 밀도 측정, 용해도, 용해, 용액, 용질, 용매, 포화 용액, 고체의 용해도, 기체의 용해도, 용해도 곡선, 온도에 따른 용해도, 물질의 상태가 변하는 온도
  02 혼합물의 분리: 혼합물의 분리, 거름, 증류, 분별 증류, 끓는점 차, 밀도 차, 물과 식용유, 분별 깔때기, 물과 에탄올, 물과 메탄올, 크로마토그래피, 재결정, 추출, 여러 가지 혼합물의 분리, 색소 분리, 거름종이, 순수한 질산 칼륨
지권의 변화: 광물, 암석, 화성암, 퇴적암, 변성암, 풍화, 침식, 퇴적, 지층, 암석의 순환, 판, 판 구조론, 화산, 지진, 마그마, 지각 변동, 지구계, 지구의 구성, 암석의 종류, 지각 변동, 판의 경계
  01 지권의 구성: 지권, 지구 내부, 지각, 맨틀, 외핵, 내핵, 광물, 광물의 특성, 조암 광물, 지진파, 지권의 구성
  02 암석의 종류와 순환: 암석, 화성암, 퇴적암, 변성암, 암석의 순환, 암석의 분류, 풍화, 침식, 퇴적, 화강암, 현무암, 편마암, 석회암, 사암
  03 대륙 이동과 판의 경계: 대륙 이동설, 판 구조론, 판, 해양판, 대륙판, 판의 경계, 화산대, 지진대, 화산, 지진, 맨틀 대류, 해저 확장, 베게너
빛과 파동: 빛의 직진, 빛의 반사, 반사 법칙, 입사각, 반사각, 평면거울, 빛의 굴절, 굴절각, 전반사, 볼록 렌즈, 오목 렌즈, 초점, 실상, 허상, 렌즈의 상, 빛의 합성, 빛의 삼원색, 물체의 색, 프리즘, 빛의 분산, 광원, 파동, 횡파, 종파, 진폭, 파장, 진동수, 주기, 소리, 음파, 소리의 3요소, 소리의 세기, 소리의 높이, 음색, 매질
  01 물체를 보는 과정과 상: 빛의 직진, 빛의 반사, 빛의 굴절, 반사 법칙, 입사각, 반사각, 굴절각, 평면거울, 볼록 렌즈, 상, 실상, 허상, 전반사, 렌즈
  02 물체의 색과 빛의 합성: 빛의 3원색, 빛의 합성, 물체의 색, 색광, 색 필터, 흰색 빛, 보색, 합성, 빨강, 초록, 파랑, 이차색, 프리즘, 빛의 분산
  03 파동과 소리: 파동, 진폭, 파장, 주기, 진동수, 소리, 소리의 3요소, 소리의 세기, 소리의 높낮이, 음색, 매질, 횡파, 종파, 음파, 공기 중 소리
물질의 구성: 원소, 원자, 분자, 이온, 원자핵, 전자, 불꽃 반응, 선 스펙트럼, 원소 기호, 분자식, 이온식, 원자 모형
  01 원소와 화합물: 원소, 화합물, 원자, 분자, 원자 모형, 원소 기호, 불꽃 반응, 선 스펙트럼, 물의 전기 분해, 원소의 종류, 원소 확인, 분자식
  02 물질의 구성 입자: 이온, 양이온, 음이온, 이온식, 전하, 전자, 원자핵, 이온의 이동, 이온의 전하, 앙금 생성 반응, 앙금, 이온 확인, 수산화 이온, 염화 이온
식물과 에너지 (광합성): 광합성, 엽록체, 증산 작용, 기공, 포도당, 이산화탄소, 물, 산소, 녹말, 뿌리, 줄기, 잎, 광합성 속도, 식물의 호흡
  01 광합성: 광합성, 엽록체, 포도당, 이산화탄소, 광합성 산물, 광합성 조건, 빛의 세기, 녹말, 요오드 반응, 광합성 속도, 광합성 확인, 대조 실험
  02 식물의 호흡: 식물의 호흡, 호흡, 기공, 증산 작용, 식물의 에너지, 광합성과 호흡, 잎, 뿌리, 줄기, 물의 이동, 증산
동물과 에너지 (소화·순환·호흡·배설): 소화, 소화 효소, 영양소, 순환계, 심장, 혈액, 혈관, 호흡, 폐, 기체 교환, 배설, 콩팥, 노폐물, 탄수화물, 단백질, 지방, 소화 기관, 순환 기관, 호흡 기관, 배설 기관, 혈액 순환, 영양소
  01 소화: 소화, 소화 효소, 영양소, 탄수화물, 단백질, 지방, 비타민, 무기염류, 아밀레이스, 펩신, 라이페이스, 소화 기관, 간, 쓸개, 이자, 소장, 위
  02 순환: 순환, 순환계, 심장, 혈액, 혈관, 동맥, 정맥, 모세 혈관, 적혈구, 백혈구, 혈소판, 혈장, 혈액 순환, 폐순환, 온몸순환, 심방, 심실
  03 호흡: 호흡, 호흡계, 폐, 폐포, 기관, 기관지, 가로막, 갈비뼈, 기체 교환, 들숨, 날숨, 폐 모형, 호흡 운동, 세포 호흡
  04 배설: 배설, 배설계, 콩팥, 오줌, 노폐물, 요소, 암모니아, 여과, 재흡수, 분비, 네프론, 사구체, 보면주머니, 방광, 요관
전기와 자기: 정전기, 마찰 전기, 대전, 전하, 전자, 전류, 전압, 저항, 옴의 법칙, 전기 회로, 직렬연결, 병렬연결, 전기 에너지, 전력, 직류, 전원 장치, 스위치, 도선, 전류의 자기 작용, 자기장, 자기력선, 나침반, 자석, 전자석, 솔레노이드, 코일, 전동기, 자기장 속에서 전류가 받는 힘, 전자기 유도, 유도 전류, 검류계
  01 전기의 발생: 정전기, 마찰 전기, 대전, 대전체, 전하, 전자, 전기력, 정전기 유도, 검전기, 원자, 전하의 이동, 전기 현상, 박리
  02 전기 회로와 에너지: 전류, 전압, 저항, 옴의 법칙, 전기 회로, 직렬연결, 병렬연결, 전기 에너지, 전력, 전력량, 전류계, 전압계, 도선, 전기 기구, 저항의 연결
  03 전류의 자기 작용: 전류의 자기 작용, 자기장, 자기력선, 나침반, 자석, 전자석, 솔레노이드, 코일, 전동기, 자기장 속에서 전류가 받는 힘, 전자기 유도, 유도 전류, 직선 도선, 원형 도선, 오른손
별과 우주: 별의 거리, 연주 시차, 겉보기 등급, 절대 등급, 별의 색, 은하, 은하수, 우주 팽창, 성단, 성운, 별의 진화, 광년
  01 별까지의 거리: 별의 거리, 연주 시차, 시차, 광년, 파섹, 별까지의 거리, 시차 측정, 가까운 별
  02 별의 특성: 별의 밝기, 겉보기 등급, 절대 등급, 별의 색, 표면 온도, 등급, 별의 특성, 거리와 밝기, 1등급, 별의 크기
  03 우리은하와 우주 탐사: 우리은하, 은하, 은하수, 외부 은하, 성단, 성운, 우주 팽창, 우주 탐사, 우주 망원경, 우주 왕복선, 인공위성, 우주 정거장, 우주 쓰레기, 우주 탐사선
[중3]
화학 반응의 규칙성: 질량 보존 법칙, 일정 성분비 법칙, 기체 반응 법칙, 아보가드로 법칙, 화학 반응식, 화학 반응, 계수, 반응물, 생성물, 분자 수, 물리 변화, 화학 변화, 물리변화와 화학변화, 물질의 변화, 화학 반응식, 원자의 종류와 개수, 질량비
  01 물질 변화와 화학 반응식: 물리 변화, 화학 변화, 화학 반응, 화학 반응식, 계수, 반응물, 생성물, 원자의 종류와 개수, 화학 반응식 완성, 화학 반응 구분
  02 화학 반응의 규칙: 질량 보존 법칙, 일정 성분비 법칙, 기체 반응 법칙, 아보가드로 법칙, 질량비, 부피비, 분자 수, 앙금 생성 반응, 기체 발생 반응, 반응 전후 질량
  03 화학 반응과 열에너지: 발열 반응, 흡열 반응, 열에너지, 열의 출입, 온도 변화, 손난로, 냉찜질 팩, 열 출입, 화학 반응에서 열에너지, 철가루, 수산화 바륨
날씨와 기후 변화: 기압, 바람, 기단, 전선, 한랭 전선, 온난 전선, 구름, 강수, 습도, 포화 수증기량, 이슬점, 저기압, 고기압, 일기도, 기후 변화, 지구 온난화, 온실 효과, 엘니뇨, 기상, 대기, 대기 대순환, 일기 예보
  01 기권과 기상 변화: 기권, 기권의 층상 구조, 대류권, 성층권, 중간권, 열권, 복사 평형, 지구 복사, 태양 복사, 온실 효과, 지구 온난화, 기온 분포
  02 대기 중의 물: 구름, 강수, 습도, 포화 수증기량, 이슬점, 수증기, 상대 습도, 구름 생성, 구름 발생, 단열 팽창, 과냉각, 비, 눈, 안개, 응결
  03 기압과 바람: 기압, 바람, 기압 차, 고기압, 저기압, 풍향, 풍속, 해륙풍, 계절풍, 지상풍, 대기 대순환, 지균풍, 바람 발생
  04 날씨의 변화: 기단, 전선, 한랭 전선, 온난 전선, 일기도, 일기 예보, 우리나라 날씨, 시베리아 기단, 장마, 태풍, 편서풍, 날씨 변화, 예보
수권과 해수의 순환: 해수의 층상 구조, 염분, 표층 해류, 심층 순환, 조석, 조류, 한류, 난류, 수온, 수자원, 물의 순환
  01 수권의 분포와 활용: 수권, 해수, 담수, 빙하, 지하수, 수자원, 물 이용, 수권의 분포, 물의 순환, 수자원 활용, 호수, 하천수
  02 해수의 특성: 해수의 층상 구조, 혼합층, 수온 약층, 심해층, 염분, 염류, 염분비 일정 법칙, 수온, 표층 해수, 해수 염분
  03 해수의 순환: 표층 해류, 심층 순환, 조석, 조류, 한류, 난류, 해류, 만조, 간조, 조차, 사리, 조금, 해수의 순환, 해수 이동, 열 수송
운동과 에너지: 속력, 등속 운동, 자유 낙하, 가속도, 중력 가속도, 일, 운동 에너지, 위치 에너지, 역학적 에너지, 에너지 보존, 낙하, 속도 시간 그래프, 거리 시간 그래프, 운동, 속력, 일과 에너지, 힘과 운동
  01 물체의 운동: 속력, 등속 운동, 자유 낙하, 가속도, 중력 가속도, 속도 시간 그래프, 거리 시간 그래프, 낙하, 속도 변화, 시간 기록계, 기록 테이프, 등가속도, 쇠구슬
  02 일과 에너지: 일, 일의 양, 운동 에너지, 위치 에너지, 일의 원리, 일률, 도르래, 힘과 이동 거리, 중력이 한 일, 에너지, 일과 에너지
  03 역학적 에너지 전환과 보존: 역학적 에너지, 에너지 보존, 에너지 전환, 역학적 에너지 보존 법칙, 낙하 운동, 롤러코스터, 진자, 위치 에너지 감소, 운동 에너지 증가
자극과 반응: 감각 기관, 눈, 귀, 코, 피부, 뉴런, 중추 신경계, 말초 신경계, 반사, 호르몬, 내분비샘, 항상성, 자극, 반응, 인슐린, 체온 조절, 시각, 청각
  01 감각 기관: 감각 기관, 눈, 귀, 코, 혀, 피부, 시각, 청각, 후각, 미각, 촉각, 홍채, 수정체, 망막, 달팽이관, 고막, 명암 조절, 거리 조절
  02 신경계와 호르몬: 뉴런, 중추 신경계, 말초 신경계, 반사, 의식적 반응, 호르몬, 내분비샘, 항상성, 인슐린, 글루카곤, 체온 조절, 대뇌, 소뇌, 연수, 척수, 자극 전달 경로
생식과 유전: 세포 분열, 체세포 분열, 감수 분열, 염색체, 유전자, 수정, 발생, 멘델, 우성, 열성, 유전, 가계도, 사람의 유전, 대립유전자, 생식세포, 유전자형, 표현형, 유전, 염색체, 생식과 발생, 사람의 유전
  01 세포 분열: 세포 분열, 체세포 분열, 감수 분열, 염색체, 염색 분체, 유전자, 핵분열, 세포질 분열, 상동 염색체, 생식세포, 생식세포 분열, DNA, 2가 염색체, 분열 과정
  02 사람의 발생: 수정, 발생, 수정란, 난자, 정자, 난할, 착상, 배아, 태아, 임신, 사람의 발생, 태반, 수정 과정, 배란, 월경
  03 멘델의 유전 원리: 멘델, 우성, 열성, 분리의 법칙, 독립의 법칙, 우열의 원리, 유전, 대립유전자, 유전자형, 표현형, 순종, 잡종, 완두, 교배, 퍼네트 사각형
  04 사람의 유전: 사람의 유전, 가계도, 상염색체, 성염색체, 혈액형, ABO식, 적록 색맹, 반성 유전, 유전병, 쌍둥이 연구, 유전 연구 방법, 가계도 조사, 혈우병
재해·재난과 안전: 자연재해, 지진, 태풍, 화산, 해일, 재난, 안전, 대처 방법, 지진 대피, 내진 설계
  01 재해·재난과 안전: 자연재해, 지진, 태풍, 화산, 해일, 재난, 안전, 대처 방법, 지진 대피, 내진 설계, 재해, 재난 안전
과학과 나의 미래: 과학 기술, 미래 직업, 첨단 과학, 과학 윤리, 과학의 발전, 진로
  01 과학과 나의 미래: 과학 기술, 미래 직업, 첨단 과학, 과학 윤리, 과학의 발전, 진로, 미래
`;
// 저장해 둔 목차에 소단원이 없으면, 기본 목차(오투 중학과학 목차 기준)의 소단원을 같은 학년·같은 이름의 대단원에 붙여 준다.
function withDefaultSubs(list) {
  let def = [];
  try { def = BankCore.parseToc(DEFAULT_TOC); } catch (e) {}
  const core = x => String(x || '').replace(/\([^)]*\)/g, '').replace(/\s+/g, '');
  (list || []).forEach(t => {
    const d = def.find(x => x.grade === t.grade && core(x.name) === core(t.name));
    // 중2 「물질의 특성」은 소단원을 두 개(물질의 특성 / 혼합물의 분리)로만 쓴다 — 예전에 저장된 네 갈래(1)(2)는 새 분류로 바꾼다
    if (d && t.grade === '중2' && core(t.name) === '물질의특성' && t.subs && t.subs.length > 2 && t.subs.some(x => /\([12]\)/.test(JSON.stringify(x)))) { t.subs = d.subs; return; }
    if (t.subs && t.subs.length) return;
    if (d && d.subs && d.subs.length) t.subs = d.subs;
  });
  return list;
}
let _tocCache = null;
async function loadTocText() {
  if (_tocCache !== null) return _tocCache;
  let text = '';
  try { text = localStorage.getItem('toc_text') || ''; } catch (e) {}
  try {
    const r = await callApi('getToc', { password: getTeacherPassword() });
    if (r && r.ok) text = r.text || '';
  } catch (e) {}
  if (!text.trim()) text = DEFAULT_TOC;   // 저장된 목차가 없으면 기본 목차(중1~중3)를 쓴다
  _tocCache = text; return text;
}
async function saveTocText(text) {
  _tocCache = text;
  try { localStorage.setItem('toc_text', text); } catch (e) {}
  const r = await callApi('setToc', { password: getTeacherPassword(), text: text });
  if (!r || !r.ok) throw new Error((r && r.error) || '목차를 서버에 저장하지 못했어요.');
}
async function tocSeeds() {
  try { return BankCore.parseToc(await loadTocText()); } catch (e) { return []; }
}

// ── 단원 입력칸 자동완성: 같은 줄·같은 폼에서 고른 학년의 "전범위" 단원을 목차 순서대로 보여준다 ──
// (학년을 안 골랐으면 모든 학년의 단원을 "중2 · 4단원 물질의 구성" 식으로 보여준다)
let _tocParsed = null;
function _gradeSelectFor(el) {
  let n = el.parentElement;
  while (n && n !== document.body) {
    const s = n.querySelector('select.cls-grade, select.g, select#bc-grade');
    if (s) return s;
    n = n.parentElement;
  }
  const all = document.querySelectorAll('select.cls-grade');
  return all.length === 1 ? all[0] : null;
}
async function refreshUnitDatalist(el) {
  const dl = document.getElementById('dl-units'); if (!dl) return;
  if (!_tocParsed) { try { _tocParsed = withDefaultSubs(BankCore.parseToc(await loadTocText())); } catch (e) { _tocParsed = []; } }
  const sel = _gradeSelectFor(el), g = sel && sel.value && sel.value !== '__clear__' ? sel.value : '';
  const own = _tocParsed.filter(t => !g || t.grade === g);
  const seen = new Set(), opts = [];
  own.forEach(t => {
    if (seen.has(t.grade + '|' + t.unit)) return; seen.add(t.grade + '|' + t.unit);
    opts.push('<option value="' + escapeHtml(t.unit) + '" label="' + escapeHtml(g ? t.grade : t.grade + ' · ' + t.unit) + '">');
  });
  // 이미 문제은행에 쓰인 단원 이름도 뒤에 붙인다 (목차에 없는 것만)
  const have = new Set(own.map(t => t.unit));
  (window._taxUnits || []).forEach(u => { if (!have.has(u)) opts.push('<option value="' + escapeHtml(u) + '">'); });
  dl.innerHTML = opts.join('');
}
document.addEventListener('focusin', e => {
  const el = e.target;
  if (el && el.matches && el.matches('input[list="dl-units"]')) refreshUnitDatalist(el);
});

// 파일 이름에서 얻은 분류(guessMeta 결과)를 목차로 다듬는다: 단원 이름이 목차에 있으면 목차 이름으로, 학년이 비었으면 단원에서 학년을 알아낸다
function refineMeta(m) {
  // 「2-2-1.물질의 …」「7-1-1.지구의 …」「4-1.입자의 …」처럼 파일 이름이 "대단원-소단원[-번호].이름"이면, 맨 앞 숫자가 대단원이다 → 그 단원으로 넣는다
  if (m && m.kind !== '기출' && m.unit && _tocParsed && _tocParsed.length) {
    const pm = /^\s*(\d{1,2})\s*-\s*\d{1,2}(?:\s*-\s*\d{1,2})?\s*[.．]/.exec(m.unit);
    if (pm) {
      const t = tocUnitByNo(_tocParsed, m.grade, parseInt(pm[1], 10));
      if (t) { m.unit = t.unit; if (!m.grade) m.grade = t.grade; return m; }
    }
  }
  if (m && m.kind !== '기출' && m.unit && _tocParsed && _tocParsed.length) {
    const mm = BankCore.matchUnitName(m.unit, _tocParsed, m.grade) || BankCore.matchUnitName(m.unit, _tocParsed);
    if (mm && (!m.grade || mm.grade === m.grade)) { m.unit = mm.unit; if (!m.grade) m.grade = mm.grade; }
  }
  return m;
}
// ── 제목·파일 이름·PDF 첫머리에 적힌 단원 번호 읽기 ──
// "3,4,5,7단원" → [3,4,5,7], "3~5단원" → [3,4,5], "중1 3단원 열" → [3]. ("4-1. 입자…"처럼 단원이라는 글자가 없는 번호는 무시)
function parseUnitNums(text) {
  const out = new Set();
  const re = /(\d{1,2}(?:\s*[,，·、]\s*\d{1,2})*)(?:\s*[~∼～]\s*(\d{1,2}))?\s*단원/g; let m;
  const src = String(text || '').replace(/\+\s*[초중고]\d\s*-\s*\d+(?:\s*,\s*\d+)*\s*단원/g, ' ');       // "+ 중3-2단원" 같은 다른 학년 단원 표시는 시험 학년의 단원으로 세지 않는다
  while ((m = re.exec(src))) {
    const list = m[1].split(/[,，·、]/).map(x => parseInt(x, 10));
    if (m[2]) { const a = list[list.length - 1], b = parseInt(m[2], 10); for (let k = a; k <= b && k - a < 15; k++) list.push(k); }
    list.forEach(n => { if (n >= 1 && n <= 20) out.add(n); });
  }
  // 「6-1-1.기체의 압력과 부피」「1-1.물질의 특성」처럼 "대단원-소단원[-번호].이름" 으로 시작하는 문제집 파일 이름: 맨 앞 숫자가 대단원이다 ("단원"이라는 글자가 없는 경우에만 쓴다)
  if (!out.size) {
    const pm = /(?:^|[\s_\]\[(])(\d{1,2})\s*-\s*\d{1,2}(?:\s*-\s*\d{1,2})?\s*[.．]\s*(?!중간|기말|학기|고사|평가|모의|\d)[가-힣A-Za-z]/.exec(src);
    if (pm) { const n = parseInt(pm[1], 10); if (n >= 1 && n <= 20) out.add(n); }
  }
  return Array.from(out).sort((a, b) => a - b);
}
// PDF 1쪽 맨 위쪽(머리글)에 찍힌 글자 — "중2 과학 3,4,5,7단원" 같은 제목이 여기 있는 경우가 많다
async function pdfHeaderText(doc) {
  try {
    const pg = await doc.getPage(1), vh = pg.getViewport({ scale: 1 }).height;
    const tc = await pg.getTextContent();
    return tc.items.filter(it => it.transform && vh - it.transform[5] < vh * 0.16).map(it => it.str).join(' ');
  } catch (e) { return ''; }
}
// 목차에서 (학년, 번호)로 단원을 찾는다. 학년을 모르면 번호가 같은 단원이 한 학년뿐일 때만 돌려준다.
function tocUnitByNo(toc, grade, no) {
  const c = (toc || []).filter(t => t.no === no && (!grade || t.grade === grade));
  return c.length === 1 || (grade && c.length) ? c[0] : null;
}
// 추정 결과 중 비어 있는 문항(그림뿐인 문제 등)은 바로 앞(없으면 뒤) 문항의 단원으로 채운다 — 문제집·시험지는 단원 순서대로 나오기 때문. 확신 낮음으로 표시.
function fillBlankUnits(results) {
  let prev = null;
  results.forEach(r => { if (r && r.unit) prev = r; else if (prev && r) { r.unit = prev.unit; r.grade = prev.grade; r.confident = false; r.filled = true; } });
  let next = null;
  for (let i = results.length - 1; i >= 0; i--) { const r = results[i]; if (r && r.unit) next = r; else if (next && r) { r.unit = next.unit; r.grade = next.grade; r.confident = false; r.filled = true; } }
  return results;
}
// 시험지 이름 끝에 붙일 "중2-3,5,7단원" 글자. rows: [{ unit, grade }]
function unitSuffixText(rows, defaultGrade) {
  const by = {};
  rows.forEach(r => {
    const m = String(r.unit || '').match(/^\s*(\d+)\s*단원/); if (!m) return;
    const g = r.grade || defaultGrade || ''; (by[g] = by[g] || new Set()).add(parseInt(m[1], 10));
  });
  const keys = Object.keys(by);
  // 시험 학년(또는 단원이 가장 많은 학년)을 먼저, 다른 학년 단원은 "+ 중3-2단원"처럼 뒤에 붙인다
  const main = by[defaultGrade] ? defaultGrade : keys.slice().sort((a, b) => by[b].size - by[a].size || a.localeCompare(b))[0];
  const order = [main].concat(keys.filter(k => k !== main).sort());
  return order.filter(k => k !== undefined).map(g => (g ? g + '-' : '') + Array.from(by[g]).sort((a, b) => a - b).join(',') + '단원').join(' + ');
}
const UNIT_SUFFIX_RE = /(?:\s+(?:\+\s*)?(?:[초중고]\d\s*-\s*)?\d+(?:\s*,\s*\d+)*\s*단원)+\s*$/;

// ── 문항 번호별 단원 고르기(클릭 목록) ──
async function ensureToc() {
  if (!_tocParsed) { try { _tocParsed = withDefaultSubs(BankCore.parseToc(await loadTocText())); } catch (e) { _tocParsed = []; } }
  return _tocParsed;
}
// 목록에 보일 단원 옵션: 학년을 알면 그 학년 전범위(목차 순서), 모르면 모든 학년("중2 · 4단원 …")
function unitSelectOptions(grade, cur, curGrade) {
  const toc = _tocParsed || [];
  const own = toc.filter(t => !grade || t.grade === grade);
  const others = grade ? toc.filter(t => t.grade !== grade) : [];     // 다른 학년 단원도 고를 수 있게 (예: 중2 시험에 중1 내용이 섞인 경우)
  const html = ['<option value="">(단원 미지정)</option>'];
  let found = !cur, used = false;
  const opt = (t, label) => {
    let sel = '';
    if (cur && !used && t.unit === cur && (!curGrade || t.grade === curGrade)) { sel = ' selected'; used = true; found = true; }
    return '<option value="' + escapeHtml(t.unit) + '" data-g="' + escapeHtml(t.grade) + '"' + sel + '>' + escapeHtml(label) + '</option>';
  };
  // 현재 값이 다른 학년 단원이면 그쪽을 먼저 선택 처리할 수 있도록, 학년 지정이 있으면 해당 학년에서만 고른다
  own.forEach(t => html.push(opt(t, grade ? t.unit : t.grade + ' · ' + t.unit)));
  if (others.length) {
    html.push('<optgroup label="다른 학년 단원">');
    others.forEach(t => html.push(opt(t, t.grade + ' · ' + t.unit)));
    html.push('</optgroup>');
  }
  if (!found) html.push('<option value="' + escapeHtml(cur) + '" data-g="" selected>' + escapeHtml(cur) + '</option>');
  return html.join('');
}
// ── 소단원 ──
// 목차의 대단원 항목(unit)을 찾는다 (학년을 알면 그 학년 안에서). 번호 없이 저장된 이름("물질의 구성")도 같은 이름이면 찾는다.
function tocEntryFor(grade, unit) {
  const toc = _tocParsed || []; if (!unit) return null;
  let e = toc.find(t => t.unit === unit && (!grade || !t.grade || t.grade === grade));
  if (!e) {
    const core = x => String(x).replace(/^\s*\d{1,2}(?:-\d+)?\s*(?:단원|[.)])?\s*/, '').replace(/\s+/g, '');
    e = toc.find(t => core(t.unit) === core(unit) && (!grade || t.grade === grade));
  }
  return e || null;
}
// 소단원 선택칸을 만든다. 목차에 소단원이 없으면 칸을 숨긴다. cur이 목록에 있으면 유지.
function refreshSubSelect(sel, entry, cur) {
  if (!sel) return;
  const subs = (entry && entry.subs) || [];
  const html = ['<option value="">소단원: 대단원 전체</option>'];
  let found = !cur;
  subs.forEach(sb => { const on = sb.name === cur; if (on) found = true; html.push('<option value="' + escapeHtml(sb.name) + '"' + (on ? ' selected' : '') + '>' + escapeHtml(sb.name) + '</option>'); });
  if (!found && cur) html.push('<option value="' + escapeHtml(cur) + '" selected>' + escapeHtml(cur) + '</option>');
  sel.innerHTML = html.join('');
  const wrap = sel.closest('.sub-wrap') || sel;
  wrap.style.display = (subs.length || cur) ? '' : 'none';
}
function unitSelectValue(sel) {
  const o = sel.options[sel.selectedIndex];
  return { unit: sel.value, grade: o ? (o.dataset.g || '') : '' };
}
// 값을 코드로 바꿀 때: 목록에 없으면 옵션을 추가해서라도 선택해 보이게 한다
function setUnitSelect(sel, unit, grade) {
  unit = unit || '';
  if (sel && sel.dataset) delete sel.dataset.auto;       // 프로그램이 다시 지정하면 '자동 추정' 표시는 일단 지운다(추정으로 채운 곳은 호출한 쪽이 다시 붙인다)
  let o = Array.from(sel.options).find(x => x.value === unit && (!grade || !x.dataset.g || x.dataset.g === grade));
  if (!o && unit) { o = document.createElement('option'); o.value = unit; o.textContent = unit; o.dataset.g = grade || ''; sel.appendChild(o); }
  sel.value = unit;
}

// ── 중복 문항 거르기: 이미 문제은행에 있는 문항(같은 글자)은 다시 저장하지 않는다 ──
const dupKey = t => String(t || '').replace(/[^0-9A-Za-z가-힣]/g, '').slice(0, 40);
async function existingPreviewKeys() {
  const keys = new Set();
  try {
    const r = await callApi('listQuestions', { password: getTeacherPassword() });
    if (r && r.ok) r.questions.forEach(q => { const k = dupKey(q.textPreview); if (k.length >= 25) keys.add(k); });
  } catch (e) {}
  return keys;
}
function isDupPreview(text, keys) { const k = dupKey(text); return k.length >= 25 && keys.has(k); }


// ── 문제지와 정답지가 따로 올라온 경우: 문항이 하나도 없는 파일(또는 이름에 정답·해설이 있고 문항이 거의 없는 파일)을 정답지로 보고 문제지와 짝짓는다 ──
// entries: [{name, scan}] → 각 entry에 isAnswer를 달고, {answerOf: 문제지 인덱스 → 정답지 인덱스(없으면 -1)}를 돌려준다
function pairAnswerFiles(entries) {
  const NAME_RE = /정답|해설|답지|답안|answer|key/i;
  entries.forEach(e => { e.isAnswer = (e.scan.questions.length === 0) || (NAME_RE.test(e.name) && e.scan.questions.length <= 2 && Object.keys(e.scan.answers || {}).length > e.scan.questions.length); });
  if (!entries.some(e => !e.isAnswer)) entries.forEach(e => { e.isAnswer = false; });          // 문제지가 하나도 없으면 전부 문제지로 취급(원래 동작)
  const norm = n => String(n).replace(/\.pdf$/i, '').replace(/정답\s*및\s*해설|정답과\s*해설|정답|해설|답지|답안|문제지|문제|answers?|keys?|questions?|[\s_\-()\[\].,+]/gi, '').toLowerCase();
  const common = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };
  const answerOf = {}, used = {};
  entries.forEach((e, i) => { answerOf[i] = -1; });
  const qIdx = entries.map((e, i) => i).filter(i => !entries[i].isAnswer);
  const aIdx = entries.map((e, i) => i).filter(i => entries[i].isAnswer);
  aIdx.forEach(ai => {
    let best = -1, bs = -Infinity;
    qIdx.forEach(qi => {
      let sc = common(norm(entries[qi].name), norm(entries[ai].name)) * 10 - Math.abs(qi - ai) - (used[qi] ? 1000 : 0);
      if (sc > bs) { bs = sc; best = qi; }
    });
    if (best >= 0) { answerOf[best] = ai; used[best] = 1; }
  });
  return { answerOf: answerOf };
}

// PDF 첫 쪽들의 글자에서 학교 이름(예: 불암중)과 시험 연도(예: 2025학년도)를 찾는다
// 시험지 머리글이 학교 시험지처럼 생겼는지: "2학기 중간고사 / 과목: 과학 / 제2학년 / 2024년 9월 30일 / 2교시" 같은 문구
function looksLikeSchoolExam(txt) {
  const t = String(txt || '').replace(/\s+/g, ' ');
  const term = /[12]\s*학기\s*(중간|기말)|(중간|기말)\s*(고사|평가)/.test(t);
  const hints = (/\d\s*교시/.test(t) ? 1 : 0) + (/과목\s*[:：]?/.test(t) ? 1 : 0) + (/20\d\d\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일/.test(t) ? 1 : 0) + (/제?\s*[123]\s*학년/.test(t) ? 1 : 0);
  const ym = t.match(/(20\d\d)\s*(학년도|년도|년)/);
  return { exam: term && hints >= 2, year: ym ? ym[1] : '' };
}
// 「학교·시험」 칸에 학교 이름이 빠져 있으면(예: "2-2학기 중간고사") 앞에 붙인다 → "상명중 2-2학기 중간고사"
function withSchoolName(field, name) {
  field = String(field || '').trim();
  if (!name) return field;
  const stem = String(name).replace(/중(학교)?$/, '');
  if (stem && field.replace(/\s+/g, '').indexOf(stem) >= 0) return field;
  return (name + ' ' + field).trim();
}
// "한밤중"·"공부중"처럼 학교 이름이 아니라 그냥 낱말인 "~중"
const WORD_JUNG = /(밤|낮|새벽|한밤|하는|하던|되는|있는|없는|공부|수업|식사|여행|운전|근무|방송|통화|작업|실험|관찰|측정|비행|운동|활동|학습|설명|조사|검사|회의|상담|출장|휴식|휴가|연습|훈련|제작|제조|생산|사용|이용|운영|운행|공사|수리|점검|준비|예약|접수|처리|진료|치료|입원|재판|연구|개발|발표|촬영|녹화|방영|전송|이동|보관|운반|작동|가동|통신|거래|판매|영업|주문|배송|검토|심사|논의|토론)중$/;
function extractSchoolYear(txt) {
  const BAD = /^(집중|도중|그중|수중|공중|심중|열중|가운데중|진행중|연구중|계속중|사용중|이중|무중|개중|평중|대중|비중|산중|운중|입중|합중|가중|체중|혼중|초중|고중)$/;   // 정확히 이 글자뿐일 때만("중평중"의 "평중" 같은 이름 끝 글자 때문에 학교를 놓치지 않게)
  let school = '';
  const t1 = txt.replace(/\s+/g, ' ');
  let m, re = /(^|[^가-힣])([가-힣]{2,5}?)(중학교(?=[에의은는가를과도로]|[^가-힣]|$)|중(?![가-힣]))/g;
  while ((m = re.exec(t1))) { const nm = m[2] + '중'; if ((!/^중학교/.test(m[3]) && (BAD.test(nm) || WORD_JUNG.test(nm))) || /^(고|초|중등|과학|학원)/.test(m[2]) && m[2].length < 3) continue; school = nm; break; }
  let year = '';
  const ym = t1.match(/(20\d\d)\s*(학년도|년도|년)/); if (ym) year = ym[1] + (ym[2] === '년' ? '년' : '학년도');
  return { school: school, year: year, mock: /모의\s*(고사|평가|시험)|모평|변형|유사|대비|예상\s*문제|적중|실전/.test(txt) };   // 모의고사·변형·유사·대비 문제는 학교 기출이 아니다 (이름에 학교가 있어도)
}

// 시험 학년의 단원으로 먼저 추정하고, 다른 학년 목차와 비교해서 "확실히 더 잘 맞는" 문항만 다른 학년 단원으로 바꾼다
// (예: 중2 시험에 중3 단원 문제가 섞인 경우). 반환: BankCore.estimateUnits와 같은 모양
function estimateUnitsMixed(texts, grade, allSeeds) {
  const own = BankCore.estimateUnits(texts, [], { grade: grade, seeds: allSeeds.filter(t => !t.grade || !grade || t.grade === grade) });
  if (!grade) return own;
  const all = BankCore.estimateUnits(texts, [], { grade: '', seeds: allSeeds });
  const results = own.results.map((r, k) => {
    const a = all.results[k];
    if (a && a.unit && a.grade && a.grade !== grade && a.confident && (!r || !r.unit || !r.confident || a.score >= r.score * 1.2)) return a;
    return r;
  });
  return { results: results, info: own.info };
}

// ── 다른 화면으로 파일 넘기기 (단원 판별 → 시험지 등록/문제은행) : 브라우저 저장소(IndexedDB)에 잠깐 맡겼다가 받는다 ──
function _hoDb() {
  return new Promise((res, rej) => { const rq = indexedDB.open('handoff_db', 1); rq.onupgradeneeded = () => rq.result.createObjectStore('f'); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
}
async function handoffSave(files) {     // files: [{name, bytes(ArrayBuffer|Uint8Array)}]
  const db = await _hoDb();
  await new Promise((res, rej) => { const tx = db.transaction('f', 'readwrite'); tx.objectStore('f').put(files.map(f => ({ name: f.name, blob: new Blob([f.bytes], { type: 'application/pdf' }) })), 'cur'); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
async function handoffLoad() {          // 한 번 받으면 지운다. 없으면 []
  try {
    const db = await _hoDb();
    const list = await new Promise((res, rej) => { const rq = db.transaction('f').objectStore('f').get('cur'); rq.onsuccess = () => res(rq.result || []); rq.onerror = () => rej(rq.error); });
    await new Promise(res => { const tx = db.transaction('f', 'readwrite'); tx.objectStore('f').delete('cur'); tx.oncomplete = res; tx.onerror = res; });
    return list.map(x => new File([x.blob], x.name, { type: 'application/pdf' }));
  } catch (e) { return []; }
}
// 강사용 PDF를 이 브라우저에 보관해 두었다가, 등록 완료 화면에서 학생용을 받을 때 같이 받게 한다 (examId 별)
async function teacherPdfSave(examId, name, bytes) {
  const db = await _hoDb();
  await new Promise((res, rej) => { const tx = db.transaction('f', 'readwrite'); tx.objectStore('f').put({ name: name, blob: new Blob([bytes], { type: 'application/pdf' }) }, 'teacher_' + examId); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
async function teacherPdfGet(examId) {
  try {
    const db = await _hoDb();
    return await new Promise((res, rej) => { const rq = db.transaction('f').objectStore('f').get('teacher_' + examId); rq.onsuccess = () => res(rq.result || null); rq.onerror = () => rej(rq.error); });
  } catch (e) { return null; }
}
function handoffInto(inputId, afterFn) {
  if (!/[?&]handoff=1/.test(location.search)) return;
  handoffLoad().then(fl => {
    if (!fl.length) return;
    const dt = new DataTransfer(); fl.forEach(f => dt.items.add(f));
    const el = document.getElementById(inputId); el.files = dt.files; afterFn(el);
  });
}


// ── 정답 칸을 번호와 함께 펼쳐서 보여 주고 고칠 수 있게 한다 ──
// box: 담을 요소, answers: 정답 배열(문자열). 칸을 고치면 answers 배열이 바로 바뀌고 onChange(answers)가 불린다.
// 이상한 값(? 또는 형식이 안 맞는 값)은 빨갛게, 주관식('-')은 노랗게 보인다.
const ANS_CELL_OK = /^([1-9]{1,5}(\/[1-9]{1,5})*|-)$/;
function paintAnswerCell(inp) {
  const v = inp.value.trim();
  inp.classList.toggle('bad', !ANS_CELL_OK.test(v));
  inp.classList.toggle('sub', v === '-');
}
function buildAnswerGrid(box, answers, onChange) {
  box.classList.add('ag');
  box.innerHTML = '';
  answers.forEach((a, i) => {
    const cell = document.createElement('div'); cell.className = 'ag-cell';
    cell.innerHTML = '<span class="ag-n">' + (i + 1) + '</span><input type="text" class="ag-in" value="' + escapeHtml(a) + '" maxlength="12" inputmode="numeric">';
    const inp = cell.querySelector('input'); paintAnswerCell(inp);
    inp.addEventListener('input', () => { answers[i] = inp.value.trim(); paintAnswerCell(inp); if (onChange) onChange(answers); });
    inp.addEventListener('focus', () => inp.select());
    box.appendChild(cell);
  });
}
