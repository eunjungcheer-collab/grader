// 표지 도안(새 표지 그림 만들기) — book_register.html 과 cover_edit.html 이 같이 쓴다
const COVER_COLORS = { pink: ['#E4566D', '#FDEBEE', '#B93A50'], blue: ['#2F7BC0', '#E4F0FA', '#1D5A93'], purple: ['#7A55C2', '#EFE9FA', '#59399A'], teal: ['#139186', '#E0F4F1', '#0C6B62'], orange: ['#E8833A', '#FFF1E4', '#B8641F'], green: ['#2E9E5B', '#E3F5EA', '#1F7A44'], navy: ['#0B1F5C', '#E6EAF6', '#08153F'], red: ['#D63A3A', '#FDE8E8', '#A82626'] };
function savedCoverLogo() { try { return JSON.parse(localStorage.getItem('cover_logo') || 'null'); } catch (e) { return null; } }
function coverCanvas(bookName, secs, W, H, design, colorKey, opts) {
  const O = opts || {}, LG = Object.assign({}, savedCoverLogo() || {}, O.logo || {});      // 로고 글자: 저장해 둔 것 → 이번에 입력한 것 순      // 표지 목차 칸 조절: fs(글자 배율) · row(줄 간격 배율, 칸 안에서만) · cols('auto'|1|2) · dy(칸 위치 위아래 이동)
  const K = 3, cv = document.createElement('canvas'); cv.width = Math.round(W * K); cv.height = Math.round(H * K);
  const x = cv.getContext('2d'); x.scale(K, K);
  const pal = /중\s*1/.test(bookName) ? { main: '#E4566D', soft: '#FDEBEE', deep: '#B93A50', grade: '중학교 1학년' }
    : /중\s*2/.test(bookName) ? { main: '#2F7BC0', soft: '#E4F0FA', deep: '#1D5A93', grade: '중학교 2학년' }
    : /중\s*3/.test(bookName) ? { main: '#7A55C2', soft: '#EFE9FA', deep: '#59399A', grade: '중학교 3학년' }
    : /고\s*1|공통|통합/.test(bookName) ? { main: '#139186', soft: '#E0F4F1', deep: '#0C6B62', grade: '고등학교 1학년' }
    : { main: '#0B1F5C', soft: '#E6EAF6', deep: '#08153F', grade: '' };
  if (colorKey && COVER_COLORS[colorKey]) { const cc = COVER_COLORS[colorKey]; pal.main = cc[0]; pal.soft = cc[1]; pal.deep = cc[2]; }
  // 교재 종류(파일 이름에서 읽음): 종류마다 이름·색을 달리한다
  const typeMap = [[/보충/, '보충', { '중1': ['#F08A3C', '#FFF1E4', '#C2631F'], '중2': ['#14A3A3', '#E1F5F5', '#0B7A7A'], '중3': ['#C2459B', '#FBE9F4', '#97307A'], '고': ['#D9822B', '#FDF0E0', '#A8631A'] }], [/심화/, '심화', { '중1': ['#8A4FD0', '#F0E8FB', '#6A35AA'], '중2': ['#1F8F5F', '#E2F5EC', '#146C47'], '중3': ['#D6553A', '#FDEAE5', '#A83E27'], '고': ['#3B5BDB', '#E7ECFD', '#2742A8'] }], [/기출/, '기출', {}], [/개념|기본/, '개념', {}]];
  const tm = typeMap.find(m => m[0].test(bookName)), typeLabel = tm ? tm[1] : '내신대비';
  // 색은 학년 고유색 그대로 둔다(교재 종류로 색을 바꾸면 다른 학년과 헷갈림). 종류는 '채운 이름표'로 구분한다.
  const typeChip = !!tm;
  const FONT = '"Noto Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif';
  const hex2 = h => [1, 3, 5].map(o => parseInt(h.slice(o, o + 2), 16)), mixW = (h, k) => { const c = hex2(h); return 'rgb(' + c.map(v => Math.round(v + (255 - v) * k)).join(',') + ')'; };
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  { const hh = H * 0.47, g = x.createLinearGradient(0, 0, 0, hh); g.addColorStop(0, mixW(pal.main, 0.74)); g.addColorStop(1, mixW(pal.main, 0.9)); x.fillStyle = g; x.beginPath(); x.roundRect(0, 0, W, hh, [0, 0, 64, 64]); x.fill();
    x.save(); x.beginPath(); x.roundRect(0, 0, W, hh, [0, 0, 64, 64]); x.clip(); x.strokeStyle = pal.main; x.globalAlpha = 0.2; x.lineWidth = 1.4; [48, 84, 120, 158].forEach(r => { x.beginPath(); x.arc(W * 0.86, H * 0.12, r, 0, 7); x.stroke(); }); x.restore(); x.globalAlpha = 1; }
  // 배경 무늬: 학년마다 다른 과학 그림 (선만 아주 연하게)
  const kind = /중\s*1/.test(bookName) ? 1 : /중\s*2/.test(bookName) ? 2 : /중\s*3/.test(bookName) ? 3 : /고\s*1|공통|통합/.test(bookName) ? 4 : 0;
  const A = v => Math.min(0.75, v * 2.1), LW = v => v * 1.5;      // 무늬를 눈에 보이게 진하게
  x.save(); x.strokeStyle = pal.main; x.fillStyle = pal.main; x.lineCap = 'round'; x.lineJoin = 'round';
  x.beginPath(); x.rect(0, 0, W, H * 0.45); x.clip();      // 무늬는 위쪽 색 블록 안에만 (아래 빈 곳에 작은 그림·물결은 넣지 않는다)
  const hexP = (cx, cy, r) => { x.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i + Math.PI / 6; x[i ? 'lineTo' : 'moveTo'](cx + r * Math.cos(a), cy + r * Math.sin(a)); } x.closePath(); x.stroke(); };
  const dot = (cx, cy, r) => { x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill(); };
  const orbit = (cx, cy, rx, ry, rot) => { x.beginPath(); x.ellipse(cx, cy, rx, ry, rot, 0, 7); x.stroke(); };
  const atom = (cx, cy, s) => { x.globalAlpha = A(0.2); x.lineWidth = LW(1.4); for (let k = 0; k < 3; k++) orbit(cx, cy, s, s * 0.36, Math.PI / 3 * k); x.globalAlpha = A(0.3); dot(cx, cy, s * 0.1); [[0.9, 0.2], [-0.55, 0.65], [-0.3, -0.85]].forEach(e => dot(cx + e[0] * s * 0.95, cy + e[1] * s * 0.34, s * 0.055)); };
  const molecule = (cx, cy, r) => { x.globalAlpha = A(0.2); x.lineWidth = LW(1.5); const dx = r * Math.sqrt(3); hexP(cx, cy, r); hexP(cx + dx, cy, r); hexP(cx + dx / 2, cy + r * 1.5, r); x.globalAlpha = A(0.32); [[cx, cy - r], [cx + dx, cy - r], [cx + dx * 1.5, cy + r * 0.5], [cx - dx / 2, cy + r * 0.5], [cx + dx / 2, cy + r * 2.5]].forEach(q => dot(q[0], q[1], r * 0.14)); };
  const helix = (cx, y0, y1, amp, wl) => { x.globalAlpha = A(0.2); x.lineWidth = LW(1.6); [0, Math.PI].forEach(ph => { x.beginPath(); for (let y = y0; y <= y1; y += 3) { const xx = cx + amp * Math.sin((y - y0) / wl * 2 * Math.PI + ph); x[y === y0 ? 'moveTo' : 'lineTo'](xx, y); } x.stroke(); }); x.lineWidth = LW(1); for (let y = y0; y <= y1; y += wl / 6) { const a1 = cx + amp * Math.sin((y - y0) / wl * 2 * Math.PI), a2 = cx - (a1 - cx); x.beginPath(); x.moveTo(a1, y); x.lineTo(a2, y); x.stroke(); } };
  const wave = (y0, amp, wl, x0, x1, n) => { for (let k = 0; k < n; k++) { x.globalAlpha = A(0.2 - k * 0.04); x.lineWidth = LW(1.5); x.beginPath(); for (let xx = x0; xx <= x1; xx += 3) { const yy = y0 + k * 14 + amp * Math.sin((xx - x0) / wl * 2 * Math.PI + k * 0.6); x[xx === x0 ? 'moveTo' : 'lineTo'](xx, yy); } x.stroke(); } };
  const flask = (cx, cy, s) => { x.globalAlpha = A(0.22); x.lineWidth = LW(1.6); x.beginPath(); x.moveTo(cx - s * 0.18, cy - s * 0.5); x.lineTo(cx - s * 0.18, cy - s * 0.1); x.lineTo(cx - s * 0.5, cy + s * 0.5); x.quadraticCurveTo(cx - s * 0.55, cy + s * 0.6, cx - s * 0.4, cy + s * 0.6); x.lineTo(cx + s * 0.4, cy + s * 0.6); x.quadraticCurveTo(cx + s * 0.55, cy + s * 0.6, cx + s * 0.5, cy + s * 0.5); x.lineTo(cx + s * 0.18, cy - s * 0.1); x.lineTo(cx + s * 0.18, cy - s * 0.5); x.stroke(); x.beginPath(); x.moveTo(cx - s * 0.26, cy - s * 0.5); x.lineTo(cx + s * 0.26, cy - s * 0.5); x.stroke(); x.beginPath(); x.moveTo(cx - s * 0.34, cy + s * 0.25); x.lineTo(cx + s * 0.34, cy + s * 0.25); x.stroke(); x.globalAlpha = A(0.3); dot(cx - s * 0.1, cy + s * 0.4, s * 0.05); dot(cx + s * 0.12, cy + s * 0.33, s * 0.035); dot(cx + s * 0.02, cy + s * 0.5, s * 0.03); };
  const grid = (x0, y0, cols, rows, r) => { x.globalAlpha = A(0.14); x.lineWidth = LW(1.2); const dx = r * Math.sqrt(3); for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) hexP(x0 + i * dx + (j % 2 ? dx / 2 : 0), y0 + j * r * 1.5, r); };
  const stars = (pts) => { x.globalAlpha = A(0.3); pts.forEach(q => dot(q[0], q[1], q[2])); };
  const tubes = (cx, cy, s) => { x.lineWidth = LW(1.6); [[-1, 1.0, 0.55], [0, 1.25, 0.4], [1, 0.9, 0.7]].forEach(q => { const tx = cx + q[0] * s * 0.42, top = cy - s * 0.5, bot = cy + s * q[1] * 0.5; x.globalAlpha = A(0.22); x.beginPath(); x.moveTo(tx - s * 0.13, top); x.lineTo(tx - s * 0.13, bot - s * 0.13); x.arc(tx, bot - s * 0.13, s * 0.13, Math.PI, 0, true); x.lineTo(tx + s * 0.13, top); x.stroke(); x.beginPath(); x.moveTo(tx - s * 0.17, top); x.lineTo(tx + s * 0.17, top); x.stroke(); x.globalAlpha = A(0.14); x.fillRect(tx - s * 0.11, bot - s * q[2] * 0.4, s * 0.22, s * q[2] * 0.4 - s * 0.01); }); x.globalAlpha = A(0.25); x.beginPath(); x.moveTo(cx - s * 0.75, cy + s * 0.78); x.lineTo(cx + s * 0.75, cy + s * 0.78); x.stroke(); };
  const circuit = (cx, cy, s) => { x.globalAlpha = A(0.22); x.lineWidth = LW(1.6); x.strokeRect(cx - s * 0.6, cy - s * 0.4, s * 1.2, s * 0.8); x.fillStyle = '#fff'; x.fillRect(cx - s * 0.16, cy - s * 0.46, s * 0.32, s * 0.12); x.beginPath(); x.arc(cx, cy + s * 0.4, s * 0.2, 0, 7); x.fillStyle = pal.main; x.globalAlpha = A(0.08); x.fill(); x.globalAlpha = A(0.25); x.stroke(); x.beginPath(); x.moveTo(cx - s * 0.1, cy + s * 0.5); x.lineTo(cx, cy + s * 0.3); x.lineTo(cx + s * 0.1, cy + s * 0.5); x.stroke(); x.fillStyle = pal.main; x.globalAlpha = A(0.32); dot(cx - s * 0.6, cy - s * 0.4, 4); dot(cx + s * 0.6, cy - s * 0.4, 4); dot(cx - s * 0.6, cy + s * 0.4, 4); dot(cx + s * 0.6, cy + s * 0.4, 4); x.globalAlpha = A(0.18); for (let k = 1; k <= 3; k++) { x.beginPath(); x.arc(cx + s * 0.95, cy - s * 0.15, s * 0.14 * k, -Math.PI / 2.2, Math.PI / 2.2); x.stroke(); } };
  const planet = (cx, cy, s) => { x.globalAlpha = A(0.2); x.lineWidth = LW(1.6); x.beginPath(); x.arc(cx, cy, s * 0.42, 0, 7); x.stroke(); x.globalAlpha = A(0.1); x.fill(); x.globalAlpha = A(0.24); x.lineWidth = LW(1.6); orbit(cx, cy, s * 0.85, s * 0.2, -0.35); x.globalAlpha = A(0.14); x.lineWidth = LW(1); orbit(cx, cy, s * 0.95, s * 0.25, -0.35); x.globalAlpha = A(0.3); dot(cx + s * 0.78, cy - s * 0.38, s * 0.04); };
  const constel = (pts) => { x.globalAlpha = A(0.2); x.lineWidth = LW(1.2); x.beginPath(); pts.forEach((q, i) => x[i ? 'lineTo' : 'moveTo'](q[0], q[1])); x.stroke(); x.globalAlpha = A(0.34); pts.forEach(q => dot(q[0], q[1], 3.2)); };
  const ripples = (cx, cy, r0, n, gap) => { x.lineWidth = LW(1.4); for (let k = 0; k < n; k++) { x.globalAlpha = A(0.2 - k * 0.025); x.beginPath(); x.arc(cx, cy, r0 + k * gap, 0, 7); x.stroke(); } };
  const tk = typeLabel === '보충' ? 1 : typeLabel === '심화' ? 2 : 0;
  const DSG = design && design !== 'auto' ? design : '';
  if (DSG) {
    if (DSG === 'mol') { molecule(W * 0.64, H * 0.05, 34); flask(W * 0.86, H * 0.2, 90); }
    else if (DSG === 'atom') { atom(W * 0.78, H * 0.13, 110); atom(W * 0.12, H * 0.775, 56); }
    else if (DSG === 'dna') { helix(W * 0.86, 20, 240, 26, 110); helix(W * 0.12, H * 0.72, H * 0.72 + 100, 16, 70); }
    else if (DSG === 'hex') { grid(W * 0.55, 18, 6, 6, 26); atom(W * 0.14, H * 0.775, 56); }
    else if (DSG === 'tubes') { tubes(W * 0.8, H * 0.14, 120); constel([[W * 0.08, H * 0.74], [W * 0.17, H * 0.7], [W * 0.26, H * 0.76], [W * 0.33, H * 0.7]]); }
    else if (DSG === 'circuit') { circuit(W * 0.78, H * 0.13, 110); planet(W * 0.14, H * 0.78, 70); }
    else if (DSG === 'planet') { planet(W * 0.8, H * 0.14, 120); tubes(W * 0.13, H * 0.76, 80); }
    else if (DSG === 'ripple') { ripples(W * 0.84, H * 0.14, 24, 6, 20); constel([[W * 0.56, H * 0.06], [W * 0.64, H * 0.1], [W * 0.7, H * 0.05], [W * 0.78, H * 0.09]]); planet(W * 0.14, H * 0.78, 80); }
    else if (DSG === 'star') { constel([[W * 0.5, H * 0.07], [W * 0.62, H * 0.12], [W * 0.7, H * 0.06], [W * 0.82, H * 0.11], [W * 0.9, H * 0.19]]); constel([[W * 0.07, H * 0.72], [W * 0.18, H * 0.76], [W * 0.27, H * 0.7]]); ripples(W * 0.9, H * 0.19, 10, 3, 14); }
    wave(H * 0.965, 6, 110, 0, W, 2); stars([[W * 0.5, H * 0.2, 2.5], [W * 0.95, H * 0.34, 2], [W * 0.3, H * 0.74, 2]]);
  } else if (tk === 1) {
    if (kind === 2) { circuit(W * 0.78, H * 0.13, 110); planet(W * 0.14, H * 0.78, 70); }
    else if (kind === 3) { planet(W * 0.8, H * 0.14, 120); tubes(W * 0.13, H * 0.76, 80); }
    else if (kind === 4) { tubes(W * 0.8, H * 0.13, 120); grid(W * 0.05, H * 0.7, 3, 3, 24); }
    else { tubes(W * 0.8, H * 0.14, 120); constel([[W * 0.08, H * 0.74], [W * 0.17, H * 0.7], [W * 0.26, H * 0.76], [W * 0.33, H * 0.7]]); }
    wave(H * 0.965, 6, 90, 0, W, 2); stars([[W * 0.5, H * 0.07, 2.5], [W * 0.95, H * 0.34, 2]]);
  } else if (tk === 2) {
    ripples(W * 0.84, H * 0.14, 24, 6, 20); constel([[W * 0.56, H * 0.06], [W * 0.64, H * 0.1], [W * 0.7, H * 0.05], [W * 0.78, H * 0.09]]);
    planet(W * 0.14, H * 0.78, 80); stars([[W * 0.5, H * 0.2, 2.5], [W * 0.93, H * 0.36, 2]]);
  } else
  if (kind === 1) { molecule(W * 0.64, H * 0.05, 34); flask(W * 0.86, H * 0.2, 90); wave(H * 0.965, 6, 120, 0, W, 2); stars([[W * 0.55, H * 0.2, 2.5], [W * 0.93, H * 0.08, 2], [W * 0.1, H * 0.78, 2.5]]); }
  else if (kind === 2) { atom(W * 0.78, H * 0.13, 110); atom(W * 0.12, H * 0.775, 56); wave(H * 0.965, 6, 150, 0, W, 2); stars([[W * 0.5, H * 0.08, 2.5], [W * 0.95, H * 0.3, 2], [W * 0.3, H * 0.74, 2]]); }
  else if (kind === 3) { helix(W * 0.86, 20, 240, 26, 110); helix(W * 0.12, H * 0.72, H * 0.72 + 100, 16, 70); wave(H * 0.965, 6, 130, 0, W, 2); stars([[W * 0.7, H * 0.06, 2.5], [W * 0.62, H * 0.2, 2], [W * 0.08, H * 0.7, 2.5]]); }
  else if (kind === 4) { grid(W * 0.55, 18, 6, 6, 26); atom(W * 0.14, H * 0.775, 56); stars([[W * 0.5, H * 0.18, 2.5], [W * 0.93, H * 0.34, 2], [W * 0.35, H * 0.72, 2]]); }
  else { grid(W * 0.5, 20, 6, 5, 28); atom(W * 0.86, H * 0.2, 70); }
  x.restore(); x.globalAlpha = 1;
  const pill = (t, cx, cy) => { x.font = '700 15px ' + FONT; const w = x.measureText(t).width + 36; x.fillStyle = '#fff'; x.strokeStyle = pal.main; x.lineWidth = 1.6; x.beginPath(); x.roundRect(cx, cy, w, 34, 17); x.fill(); x.fillStyle = pal.main; x.textBaseline = 'middle'; x.fillText(t, cx + 18, cy + 17); };
  const ml = 54; if (pal.grade) pill(pal.grade + ' · ' + typeLabel, ml, 74);
  const subj = (bookName.replace(/내신대비|교재|보충|심화|기출|개념|기본/g, ' ').replace(/\s+/g, ' ').trim() || '과학'), base = /과학/.test(subj) ? subj : subj + ' 과학';
  x.textBaseline = 'alphabetic'; x.fillStyle = pal.main;
  // 제목이 길면 표지 밖으로 넘어가지 않게 글자를 줄이고, 그래도 안 되면 두 줄로 나눈다
  { const maxW = W - ml * 2 - 8, fw = fs => { x.font = '900 ' + fs + 'px ' + FONT; return x.measureText(base).width; };
    let fs = 72; while (fs > 46 && fw(fs) > maxW) fs -= 2;
    if (fw(fs) <= maxW) { x.font = '900 ' + fs + 'px ' + FONT; x.fillText(base, ml, 250); window._coverTitle = { x: ml, right: ml + x.measureText(base).width, baseline: 250, size: fs, H: H }; }
    else {
      const words = base.split(' '); let best = 1, bd = 1e9;      // 두 줄로 나눌 자리: 두 줄 길이가 비슷한 공백
      for (let k = 1; k < words.length; k++) { const d = Math.abs(x.measureText(words.slice(0, k).join(' ')).width - x.measureText(words.slice(k).join(' ')).width); if (d < bd) { bd = d; best = k; } }
      const l1 = words.slice(0, best).join(' '), l2 = words.slice(best).join(' ') || '';
      let f2 = 54; const wd = f => { x.font = '900 ' + f + 'px ' + FONT; return Math.max(x.measureText(l1).width, x.measureText(l2).width); };
      while (f2 > 30 && wd(f2) > maxW) f2 -= 2;
      x.font = '900 ' + f2 + 'px ' + FONT; x.fillText(l1, ml, 202); if (l2) x.fillText(l2, ml, 258);
      window._coverTitle = { x: ml, right: ml + x.measureText(l2 || l1).width, baseline: l2 ? 258 : 202, size: f2, H: H };
    } }
  if (typeChip) { x.font = '800 38px ' + FONT; const tw = x.measureText(typeLabel + ' 교재').width; x.fillStyle = pal.main; x.beginPath(); x.roundRect(ml - 14, 278, tw + 28, 50, 12); x.fill(); x.fillStyle = '#fff'; x.fillText(typeLabel + ' 교재', ml, 314); }
  else { x.fillStyle = '#17203A'; x.font = '800 40px ' + FONT; x.fillText(typeLabel + ' 교재', ml, 312); }
  x.fillStyle = pal.main; x.fillRect(ml, 338, 74, 5);
  // CONTENTS
  const units = []; const seen = {};
  const uinfoC = unitInfoFor(secs);
  secs.forEach(s => { const ui = uinfoC(s), k = ui.no + '|' + ui.name; if (!seen[k] && (ui.name || ui.no)) { seen[k] = 1; units.push({ n: toRoman(ui.no), t: ui.name || '' }); } });
  // 목차 칸 크기는 단원 수에 맞춘다: 아래쪽 '강사용/학생용' 표시 자리(H*0.155 위치)와 맨 아래 글자를 침범하지 않는 범위 안에서만 그린다. 모자라면 줄 간격을 줄이고, 그래도 모자라면 두 열로 나눈다.
  const free = (O.dy || 0) > 0 || (O.bh && O.bh !== 1) || (O.bw && O.bw !== 1), list = units.slice(0, 16), by = 372 + (O.dy || 0), cardLimit = free ? H - 96 : H * (1 - 0.155) - 26 - 16, avail = cardLimit - by - 64 - 14;
  const twoCol = O.cols === 2 ? true : O.cols === 1 ? false : list.length * 30 > avail, perCol = twoCol ? Math.ceil(list.length / 2) : list.length, fit = avail / perCol, rowH = Math.max(10, Math.min(fit, (O.cols ? Math.min(40, fit) : Math.max(18, Math.min(40, fit))) * (O.row || 1)));
  const baseH = 64 + perCol * rowH + 10, boxH = Math.max(80, Math.min(baseH * (O.bh || 1), Math.max(80, cardLimit - by))), rowH2 = (boxH - 74) / perCol, fullW = W - ml * 2, boxW = Math.min(W - 20, Math.max(200, fullW * (O.bw || 1))), bx = ml + (fullW - boxW) / 2;
  x.shadowColor = 'rgba(20,30,60,.14)'; x.shadowBlur = 24; x.shadowOffsetY = 8; x.fillStyle = '#fff'; x.beginPath(); x.roundRect(bx, by, boxW, boxH, 22); x.fill(); x.shadowColor = 'transparent';
  x.fillStyle = pal.deep; x.font = '800 13px ' + FONT; x.fillText('C O N T E N T S', bx + 28, by + 38);
  list.forEach((u, i) => {
    const col = twoCol ? Math.floor(i / perCol) : 0, ri = twoCol ? i % perCol : i, colW = (boxW - 56) / (twoCol ? 2 : 1), x0 = bx + 28 + col * colW;
    const cy = by + 64 + ri * rowH2, bh = Math.min(28, Math.max(12, rowH2 - 6)), fs = Math.max(9, Math.min(24, Math.max(11, Math.min(18, rowH * 0.45)) * (O.fs || 1))), tw = Math.min(46, bh * 1.65);
    x.fillStyle = pal.main; x.beginPath(); x.roundRect(x0, cy - 8, tw, bh, 8); x.fill();
    x.fillStyle = '#fff'; x.font = '800 ' + Math.round(fs * 0.9) + 'px ' + FONT; x.textAlign = 'center'; x.fillText(String(u.n || i + 1), x0 + tw / 2, cy - 8 + bh / 2 + fs * 0.33);
    x.textAlign = 'left'; x.fillStyle = '#17203A'; x.font = '700 ' + Math.round(fs) + 'px ' + FONT;
    let nm = u.t, maxw = colW - tw - 24; while (nm.length > 2 && x.measureText(nm).width > maxw) nm = nm.slice(0, -1); if (nm !== u.t) nm += '…';
    x.fillText(nm, x0 + tw + 14, cy - 8 + bh / 2 + fs * 0.33);
    if (ri < perCol - 1 && !twoCol) { x.fillStyle = '#E8EAF0'; x.fillRect(x0 + tw + 14, cy - 8 + bh + 4, colW - tw - 14, 1); }
  });
  x.fillStyle = pal.main; x.font = '800 20px ' + FONT; x.fillText(LG.main != null && LG.main !== '' ? LG.main : '이은정 과학', ml, H - 62);
  x.fillStyle = '#7B8197'; x.font = '600 10.5px ' + FONT; x.fillText(LG.sub != null ? LG.sub : 'MIDDLE SCHOOL SCIENCE · EXAM PREP', ml, H - 44);
  { const gl = pal.grade ? (/중/.test(pal.grade) ? pal.grade.replace(/\D/g, '') : '') : ''; const ct = LG.chip != null && LG.chip !== '' ? LG.chip : ('SCIENCE ' + gl).trim(); x.font = '800 13px ' + FONT; const cw = x.measureText(ct).width + 34; x.fillStyle = '#1F2A44'; x.beginPath(); x.roundRect(W - ml - cw, H - 78, cw, 34, 10); x.fill(); x.fillStyle = '#fff'; x.textAlign = 'center'; x.fillText(ct, W - ml - cw / 2, H - 56); x.textAlign = 'left'; }
  return cv;
}
// 단원 번호·이름: 소단원 이름 앞의 숫자(예: '4-1.', '4.')로 단원을 정하고, 단원 이름은 같은 단원 소단원들의 공통 제목(최다오답·최상위 등)으로 정한다
function unitInfoFor(secs) {
  const cnt = {}, numOf = s => { const m = String(s.name || '').match(/^\s*(\d{1,2})\s*(?:-\s*\d+)?\s*[.．]/); return m ? parseInt(m[1], 10) : (parseInt(s.unit, 10) || 0); };
  secs.forEach(s => { const n = numOf(s), m = String(s.name || '').match(/^\s*\d{1,2}\s*[.．]\s*(.+?)\s*(?:\(\s*\d+\s*\))?\s*$/); if (n && m && !/-/.test(String(s.name).split(/[.．]/)[0])) { cnt[n] = cnt[n] || {}; cnt[n][m[1]] = (cnt[n][m[1]] || 0) + 1; } });
  const nameOf = {}; Object.keys(cnt).forEach(n => { nameOf[n] = Object.keys(cnt[n]).sort((a, b) => cnt[n][b] - cnt[n][a])[0]; });
  return s => { const n = numOf(s); return { no: n || s.unit, name: (n && nameOf[n]) || s.unitName || '' }; };
}
const toRoman = v => v;      // 단원 번호는 로마 숫자 대신 1, 2, 3 으로 쓴다(선생님 요청)
