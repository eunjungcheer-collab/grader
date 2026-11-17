/* 시험 기록 · 알림 화면 공용: 학생 이름으로 기록 찾기 + 오답노트/다시풀기 합쳐 받기 */
(function () {
const g = id => document.getElementById(id), E = escapeHtml, nk = x => String(x).replace(/\s+/g, '').toLowerCase();
const F = iso => { const d = new Date(iso); if (isNaN(d)) return String(iso); const p = n => String(n).padStart(2, '0'); return (d.getMonth() + 1) + '/' + d.getDate() + '(' + '일월화수목금토'[d.getDay()] + ') ' + p(d.getHours()) + ':' + p(d.getMinutes()); };
window.WN_SEL = {}; window.wnKey = s => [s.examId, s.studentName, s.submittedAt].join('|');
const WN_SEL = window.WN_SEL, wnKey = window.wnKey;
let GETALL = null;
// ── 오답노트 · 오답문제 다시풀기 만들기 ──
let FULL = null, FULL_AT = 0, WN_BUSY = false;
async function fullSubs() {
  if (GETALL) { const a = await GETALL(); if (a && a.length) return a; }
  if (FULL && Date.now() - FULL_AT < 60000) return FULL;
  const res = await callApi('listSubmissions', { password: getTeacherPassword() }); if (!res.ok) throw new Error(res.error || '제출 기록을 불러오지 못했어요');
  FULL = wnHydrate(res); FULL_AT = Date.now(); return FULL;
}
async function runWn(kind, keys) {
  if (WN_BUSY) { alert('지금 만드는 중이에요. 끝난 뒤에 눌러 주세요.'); return; }
  const msg = g('wn-msg'), bar = g('wn-bar'), fill = g('wn-fill');
  const files = { student: g('wn-f-student').checked, answers: g('wn-f-answers').checked && kind === 'retry', teacher: g('wn-f-teacher').checked };
  if (!files.student && !files.answers && !files.teacher) { alert('받을 파일을 하나 이상 골라 주세요.'); return; }
  if (!keys.length) { alert('위에서 학생 기록을 먼저 체크해 주세요.'); return; }
  WN_BUSY = true; document.querySelectorAll('#wn-box button, .wn-one').forEach(b => b.disabled = true);
  bar.style.display = ''; fill.style.width = '0'; const T0 = Date.now(); let G = 1, gi = 0, frac = 0, last = '';
  const paint = () => { const f = (gi + frac) / G, el = (Date.now() - T0) / 1000; let eta = ''; if (f > 0.05 && el > 6) { const sec = Math.round(el * (1 - f) / f); eta = ' · 약 ' + (sec >= 60 ? Math.floor(sec / 60) + '분 ' + (sec % 60) + '초' : sec + '초') + ' 남음(대략)'; } fill.style.width = Math.min(100, Math.round(f * 100)) + '%'; msg.textContent = last + '  [' + Math.floor(f * 100) + '%' + eta + ']'; };
  const tick = setInterval(paint, 1000);
  try {
    last = '제출 기록을 불러오는 중...'; paint();
    const subs = await fullSubs(), recs = [];
    keys.forEach(k => { const hit = subs.find(x => wnKey(x) === k) || subs.find(x => String(x.examId) === k.split('|')[0] && x.studentName === k.split('|')[1] && Math.abs(new Date(x.submittedAt) - new Date(k.split('|')[2])) < 1000); if (hit) recs.push(hit); });
    if (!recs.length) throw new Error('선택한 기록을 찾지 못했어요. 화면을 새로고침한 뒤 다시 해 주세요.');
    const groups = {}; recs.forEach(x => { (groups[x.studentName] = groups[x.studentName] || []).push(x); });
    const names = Object.keys(groups); G = names.length; const done = [], notes = [];
    for (gi = 0; gi < names.length; gi++) {
      const gr = groups[names[gi]]; frac = 0;
      const out = await wnBuild(gr, kind, files, { oneFile: g('wn-one').checked, withExpl: g('wn-expl').checked, blank: parseInt(g('wn-blank').value, 10) || 0, subs: subs }, t => { last = names[gi] + ' · ' + t; paint(); }, f => { frac = f; paint(); });
      notes.push.apply(notes, out.notes);
      for (const f of ['combined', 'student', 'answers', 'teacher']) if (out[f]) { wnDownload(out[f], wnFileName(kind, f, out.used)); done.push(wnFileName(kind, f, out.used)); await new Promise(r => setTimeout(r, 1300)); }
    }
    fill.style.width = '100%'; clearInterval(tick);
    msg.innerHTML = '✅ ' + done.length + '개 파일을 내려받았어요.<br>' + done.map(E).join('<br>') + (notes.length ? '<br><span style="color:#B45309;">참고: ' + notes.map(E).join(' / ') + '</span>' : '');
    setTimeout(() => { bar.style.display = 'none'; }, 3000);
  } catch (err) { clearInterval(tick); bar.style.display = 'none'; msg.innerHTML = '<span style="color:#C1392B;">⚠️ ' + E(err.message || err) + '</span>'; }
  WN_BUSY = false; document.querySelectorAll('#wn-box button, .wn-one').forEach(b => b.disabled = false);
}
// ── 학생 이름 검색 / 알림을 눌러 들어왔을 때: 그 학생 기록만 보기 ──
async function showStudent(q, sub) {
  const body = g('fx-body'); if (!nk(q)) { body.innerHTML = '<span class="hint">이름을 쓰면 그 학생의 시험 기록만 나와요.</span>'; return; }
  body.textContent = '기록을 불러오는 중...';
  try {
    const all = await fullSubs(), hit = all.filter(x => nk(x.studentName).includes(nk(q)));
    const names = hit.map(x => x.studentName).filter((n, i, a) => a.indexOf(n) === i);
    if (!names.length) { body.textContent = '「' + q + '」 학생의 제출 기록을 찾지 못했어요.'; return; }
    const exact = names.find(n => nk(n) === nk(q));
    if (names.length > 1 && !exact) {
      body.innerHTML = '<div style="margin-bottom:6px;">여러 학생이 검색돼요. 누구인지 눌러 주세요.</div>' + names.map(n => '<button type="button" class="btn outline fx-pick" data-n="' + E(n) + '" style="padding:5px 12px;margin:0 6px 6px 0;">' + E(n) + '</button>').join('');
      body.querySelectorAll('.fx-pick').forEach(b => b.addEventListener('click', () => { g('fx-q').value = b.dataset.n; showStudent(b.dataset.n); })); return;
    }
    const who = exact || names[0], mine = hit.filter(x => x.studentName === who).sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    const cur = sub ? mine.find(x => String(x.examId) === sub) : null, rest = mine.filter(x => x !== cur);
    const row = (s, hl) => { const k = wnKey(s), bad = Number(s.score) < Number(s.total), sc100 = (s.score100 !== undefined && s.score100 !== '' && !isNaN(Number(s.score100))) ? Math.round(Number(s.score100)) : (Number(s.total) ? Math.round(Number(s.score) / Number(s.total) * 100) : 0);
      return '<div style="border-top:1px solid var(--line);padding:6px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap;' + (hl ? 'background:#f1f8f3;' : '') + '"><input type="checkbox" class="wn-chk" data-k="' + E(k) + '"' + (WN_SEL[k] ? ' checked' : '') + '><span style="flex:1;min-width:150px;"><span style="display:inline-block;padding:2px 10px;border-radius:999px;font-weight:800;font-size:18px;line-height:1.3;color:#fff;background:' + (sc100 >= 90 ? '#1f7a4d' : sc100 >= 70 ? '#1F3A6B' : '#C1392B') + ';">' + sc100 + '점</span> <span style="font-weight:600;color:#475569;">' + s.score + '/' + s.total + '</span><div style="margin-top:2px;"><b>' + E(s.examTitle) + '</b> <span class="hint" style="margin:0;">' + F(s.submittedAt) + '</span></div></span>' + (bad ? '<button type="button" class="btn outline wn-one" data-kind="note" data-k="' + E(k) + '" style="padding:4px 10px;">📓 오답노트</button><button type="button" class="btn outline wn-one" data-kind="retry" data-k="' + E(k) + '" style="padding:4px 10px;">🔁 다시풀기</button>' : '<span class="hint" style="margin:0;">만점</span>') + '</div>'; };
    body.innerHTML = '<div style="font-weight:700;margin-bottom:2px;">👤 ' + E(who) + ' · 시험 기록 ' + mine.length + '건</div>' +
      (cur ? '<div style="font-weight:700;color:#1f6f4a;margin-top:6px;">⬇️ 이번에 제출한 시험</div>' + row(cur, true) + '<div style="font-weight:700;margin:12px 0 2px;">🗂️ 이전 시험 기록 ' + rest.length + '건</div>' : '') +
      rest.map(s => row(s, false)).join('') +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;"><button type="button" class="btn outline" id="fx-all" style="padding:6px 12px;">틀린 기록 전부 선택</button><button type="button" class="btn primary" id="fx-note" style="padding:6px 12px;">📓 선택 오답노트 합쳐 받기</button><button type="button" class="btn primary" id="fx-retry" style="padding:6px 12px;">🔁 선택 다시풀기 합쳐 받기</button></div><div class="hint" style="margin-top:6px;">받을 파일(학생용·정답해설·강사용)과 옵션은 아래 「오답노트·다시풀기」 카드에서 고르세요.</div>';
    body.querySelectorAll('.wn-chk').forEach(c => c.addEventListener('change', () => { if (c.checked) WN_SEL[c.dataset.k] = 1; else delete WN_SEL[c.dataset.k]; }));
    body.querySelectorAll('.wn-one').forEach(b => b.addEventListener('click', () => runWn(b.dataset.kind, [b.dataset.k])));
    g('fx-all').addEventListener('click', () => body.querySelectorAll('.wn-chk').forEach(c => { c.checked = true; WN_SEL[c.dataset.k] = 1; }));
    g('fx-note').addEventListener('click', () => runWn('note', Object.keys(WN_SEL).filter(k => mine.some(x => wnKey(x) === k))));
    g('fx-retry').addEventListener('click', () => runWn('retry', Object.keys(WN_SEL).filter(k => mine.some(x => wnKey(x) === k))));
  } catch (err) { body.innerHTML = '<span style="color:#C1392B;">' + E(err.message || err) + '</span>'; }
}

const PANEL_HTML = '<div class="card" id="fx-box" style="border:2px solid #1f6f4a;"><b id="fx-title">🔎 학생 이름으로 기록 찾기 · 오답노트/다시풀기 받기</b>\n    <input id="fx-q" list="fx-names" placeholder="학생 이름 (일부만 써도 돼요)" autocomplete="off" style="display:block;width:100%;box-sizing:border-box;margin-top:8px;padding:9px 10px;font-size:15px;"><datalist id="fx-names"></datalist>\n    <div id="fx-body" class="hint" style="margin-top:8px;">이름을 쓰면 그 학생의 시험 기록만 나와요. 거기서 여러 시험을 골라 한꺼번에 받을 수 있어요.</div></div>\n\n  <div class="card" id="wn-box">\n    <b>📓 오답노트 · 🔁 오답문제 다시풀기</b>\n    <div class="hint" style="margin:4px 0 8px;">학생 기록을 <b>체크</b>하고 아래 버튼을 누르면, 그 학생의 틀린 문제를 <b>한 PDF로 합쳐</b> 인쇄할 수 있게 만들어요. (기록 옆 버튼은 그 한 건만 만들어요. 여러 학생을 체크하면 학생마다 따로 만들어요.)</div>\n    <div style="margin:6px 0;"><b style="font-size:14px;">받을 파일</b><br>\n      <label style="margin-right:14px;font-weight:400;"><input type="checkbox" id="wn-f-student" checked> 학생용</label>\n      <label style="margin-right:14px;font-weight:400;"><input type="checkbox" id="wn-f-answers" checked> 정답·해설지 <span class="hint" style="margin:0;">(다시풀기만 따로 · 오답노트는 학생용 뒤쪽에 들어가요)</span></label>\n      <label style="font-weight:400;"><input type="checkbox" id="wn-f-teacher" checked> 강사용</label></div>\n    <div style="margin:6px 0;"><label style="margin-right:14px;font-weight:400;"><input type="checkbox" id="wn-expl" checked> 오답노트 학생용에 해설 포함</label>\n      <label style="margin-right:14px;font-weight:400;"><input type="checkbox" id="wn-one" checked> 다시풀기: 학생용+정답·해설을 한 파일로 <span class="hint" style="margin:0;">(정답은 새 장 앞면부터 — 학생용이 5쪽이면 6쪽 빈 쪽, 7쪽부터 정답)</span></label>\n      <label style="font-weight:400;">다시 풀 빈칸 <select id="wn-blank"><option value="0">없음</option><option value="60">작게</option><option value="110" selected>보통</option><option value="170">넓게</option></select></label></div>\n    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">\n      <button type="button" class="btn primary" id="wn-go-note" style="padding:8px 14px;">📓 선택한 기록 오답노트로 합쳐 받기</button>\n      <button type="button" class="btn primary" id="wn-go-retry" style="padding:8px 14px;">🔁 선택한 기록 오답문제 다시풀기로 합쳐 받기</button>\n      <button type="button" class="btn outline" id="wn-clear" style="padding:8px 14px;">선택 해제</button></div>\n    <div id="wn-bar" style="display:none;height:14px;background:#e6e1d6;border-radius:8px;overflow:hidden;margin:10px 0 4px;"><div id="wn-fill" style="height:100%;width:0;background:#1f6f4a;transition:width .5s linear;"></div></div>\n    <div id="wn-msg" class="hint" style="margin-top:6px;"></div>\n    <div class="hint" style="margin-top:6px;">📓 오답노트 = 틀린 문제 + 내가 쓴 답(정답은 맨 뒤) · 🔁 다시풀기 = 틀린 문제만(내 답·정답 표시 없음), 정답·해설은 따로 · 강사용 = 문제마다 정답(오답노트는 내 답도) + 해설</div>\n  </div>';
window.runWn = runWn; window.wnShowStudent = function (name, sub) { g('fx-q').value = name; return showStudent(name, sub).then(() => g('fx-box').scrollIntoView({ block: 'start', behavior: 'smooth' })); };
window.wnPanelMount = function (host, opts) {
  GETALL = (opts && opts.getAll) || null;
  host.innerHTML = PANEL_HTML;
g('wn-go-note').addEventListener('click', () => runWn('note', Object.keys(WN_SEL)));
g('wn-go-retry').addEventListener('click', () => runWn('retry', Object.keys(WN_SEL)));
g('wn-clear').addEventListener('click', () => { Object.keys(WN_SEL).forEach(k => delete WN_SEL[k]); document.querySelectorAll('.wn-chk').forEach(c => { c.checked = false; }); });


  g('wn-go-note').disabled = false;
let fxT = null, fxLoaded = false;
g('fx-q').addEventListener('input', () => { clearTimeout(fxT); fxT = setTimeout(() => showStudent(g('fx-q').value), 400); });
g('fx-q').addEventListener('focus', async () => {
  if (fxLoaded) return; fxLoaded = true;
  try { const all = await fullSubs(); g('fx-names').innerHTML = all.map(x => x.studentName).filter((n, i, a) => n && a.indexOf(n) === i).sort().map(n => '<option value="' + E(n) + '">').join(''); } catch (x) { fxLoaded = false; }
});
setTimeout(function () { const q = new URLSearchParams(location.search), stu = q.get('stu'); if (!stu) return; g('fx-q').value = stu; showStudent(stu, q.get('sub')).then(() => g('fx-box').scrollIntoView({ block: 'start' })); }, 0);

};
})();
