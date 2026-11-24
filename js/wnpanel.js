/* 시험 기록 · 알림 화면 공용: 학생 이름으로 기록 찾기 + 오답노트/다시풀기 합쳐 받기 */
(function () {
const g = id => document.getElementById(id), E = escapeHtml, nk = x => String(x).replace(/\s+/g, '').toLowerCase();
const F = iso => { const d = new Date(iso); if (isNaN(d)) return String(iso); const p = n => String(n).padStart(2, '0'); return (d.getMonth() + 1) + '/' + d.getDate() + '(' + '일월화수목금토'[d.getDay()] + ') ' + p(d.getHours()) + ':' + p(d.getMinutes()); };
window.WN_SEL = {}; window.wnKey = s => [s.examId, s.studentName, s.submittedAt].join('|');
const WN_SEL = window.WN_SEL, wnKey = window.wnKey;
let GETALL = null;
// ── 오답노트 · 오답문제 다시풀기 만들기 ──
let FULL = null, FULL_AT = 0, WN_BUSY = false;
// 학생 이름으로 거른 기록만 서버에서 받는다 (서버가 옛날 버전이면 전체를 받아 여기서 거른다)
async function subsOf(q) {
  if (GETALL) return fullSubs();
  const res = await callApi('listSubmissions', { password: getTeacherPassword(), student: q }); if (!res.ok) throw new Error(res.error || '제출 기록을 불러오지 못했어요');
  const arr = wnHydrate(res); LAST = arr; if (!res.filtered) { FULL = arr; FULL_AT = Date.now(); } return arr;
}
let LAST = [];
// 만들 기록들이 이미 불러온 학생 기록 안에 다 있으면 그걸 쓰고, 없으면 전체를 불러온다
async function subsForKeys(keys) {
  const have = {}; LAST.forEach(x => { have[wnKey(x)] = 1; });
  return keys.every(k => have[k]) ? LAST : fullSubs();
}
async function fullSubs() {
  if (GETALL) { const a = await GETALL(); if (a && a.length) return a; }
  if (FULL && Date.now() - FULL_AT < 60000) return FULL;
  const res = await callApi('listSubmissions', { password: getTeacherPassword() }); if (!res.ok) throw new Error(res.error || '제출 기록을 불러오지 못했어요');
  FULL = wnHydrate(res); FULL_AT = Date.now(); return FULL;
}

/* 만드는 동안 화면 가운데에 진행 창을 띄운다 (목록 아래쪽 진행바는 스크롤해야 보여서 진행 중인지 알 수 없었다) */
function wnModalOpen(title) {
  let m = document.getElementById('wn-modal'); if (m) m.remove();
  m = document.createElement('div'); m.id = 'wn-modal';
  m.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:16px;';
  m.innerHTML = '<div style="background:#fff;border-radius:14px;padding:22px 22px 18px;max-width:440px;width:100%;box-shadow:0 12px 40px rgba(0,0,0,.3);"><div id="wn-m-title" style="font-size:18px;font-weight:800;color:#1F3A6B;">' + title + '</div><div id="wn-m-bar" style="height:18px;background:#e6e1d6;border-radius:10px;overflow:hidden;margin:14px 0 8px;"><div id="wn-m-fill" style="height:100%;width:0;background:#1f6f4a;transition:width .5s linear;"></div></div><div id="wn-m-msg" style="font-size:14px;line-height:1.5;color:#374151;word-break:break-all;min-height:42px;"></div><div style="text-align:right;margin-top:10px;"><button type="button" id="wn-m-close" class="btn outline" style="padding:8px 18px;display:none;">닫기</button></div></div>';
  document.body.appendChild(m);
  const close = () => { m.remove(); };
  m.querySelector('#wn-m-close').addEventListener('click', close);
  return { bar: m.querySelector('#wn-m-bar'), fill: m.querySelector('#wn-m-fill'), msg: m.querySelector('#wn-m-msg'), title: m.querySelector('#wn-m-title'), btn: m.querySelector('#wn-m-close'), close: close };
}
async function runWn(kind, keys, doPrint) {
  if (WN_BUSY) { alert('지금 만드는 중이에요. 끝난 뒤에 눌러 주세요.'); return; }
  const files = { student: g('wn-f-student').checked, answers: g('wn-f-answers').checked && kind === 'retry', teacher: g('wn-f-teacher').checked };
  if (!files.student && !files.answers && !files.teacher) { alert('받을 파일을 하나 이상 골라 주세요.'); return; }
  if (!keys.length) { alert('위에서 학생 기록을 먼저 체크해 주세요.'); return; }
  WN_BUSY = true; document.querySelectorAll('#fx-box button, .wn-one, .wn-one-p').forEach(b => b.disabled = true);
  const M = wnModalOpen(doPrint ? '🖨️ 인쇄 준비 중이에요' : '⏳ 파일 만드는 중이에요 (창을 닫지 마세요)'), msg = M.msg, bar = M.bar, fill = M.fill;
  bar.style.display = ''; fill.style.width = '0'; const T0 = Date.now(); let G = 1, gi = 0, frac = 0, last = '';
  const paint = () => { const f = (gi + frac) / G, el = (Date.now() - T0) / 1000; let eta = ''; if (f > 0.05 && el > 6) { const sec = Math.round(el * (1 - f) / f); eta = ' · 약 ' + (sec >= 60 ? Math.floor(sec / 60) + '분 ' + (sec % 60) + '초' : sec + '초') + ' 남음(대략)'; } fill.style.width = Math.min(100, Math.round(f * 100)) + '%'; msg.textContent = last + '  [' + Math.floor(f * 100) + '%' + eta + ']'; };
  const tick = setInterval(paint, 1000), say = t => { last = t; paint(); };
  try {
    last = '제출 기록을 불러오는 중...'; paint();
    const subs = await subsForKeys(keys), recs = [];
    keys.forEach(k => { const hit = subs.find(x => wnKey(x) === k) || subs.find(x => String(x.examId) === k.split('|')[0] && x.studentName === k.split('|')[1] && Math.abs(new Date(x.submittedAt) - new Date(k.split('|')[2])) < 1000); if (hit) recs.push(hit); });
    if (!recs.length) throw new Error('선택한 기록을 찾지 못했어요. 화면을 새로고침한 뒤 다시 해 주세요.');
    const R = parseInt((g('wn-round') || {}).value, 10) || 1;
    const groups = {}; recs.forEach(x => { (groups[x.studentName] = groups[x.studentName] || []).push(x); });
    const names = Object.keys(groups); G = names.length; const done = [], notes = [];
    for (gi = 0; gi < names.length; gi++) {
      const gr = groups[names[gi]]; frac = 0;
      const out = await wnBuild(gr, kind, files, { oneFile: g('wn-one').checked, withExpl: g('wn-expl').checked, blank: parseInt(g('wn-blank').value, 10) || 0, subs: subs, round: R }, t => { last = names[gi] + ' · ' + t; paint(); }, f => { frac = f; paint(); });
      notes.push.apply(notes, out.notes);
      for (const f of ['combined', 'student', 'answers', 'teacher']) if (out[f]) { if (doPrint) { say('🖨️ 인쇄 준비 중... (' + wnFileName(kind, f, out.used, R) + ')'); await printPdfBytes(out[f], (i, n) => say('🖨️ 인쇄 준비 중... ' + i + '/' + n + '쪽')); done.push('🖨️ ' + wnFileName(kind, f, out.used, R)); continue; } wnDownload(out[f], wnFileName(kind, f, out.used, R)); done.push(wnFileName(kind, f, out.used, R)); await new Promise(r => setTimeout(r, 1300)); }
    }
    fill.style.width = '100%'; clearInterval(tick);
    msg.innerHTML = '✅ ' + done.length + '개를 처리했어요 (🖨️는 인쇄 창으로 보냈어요).<br>' + done.map(E).join('<br>') + (notes.length ? '<br><span style="color:#B45309;">참고: ' + notes.map(E).join(' / ') + '</span>' : '');
    M.title.textContent = '✅ 끝났어요'; M.btn.style.display = '';
  } catch (err) { clearInterval(tick); bar.style.display = 'none'; M.title.textContent = '⚠️ 문제가 생겼어요'; M.btn.style.display = ''; msg.innerHTML = '<span style="color:#C1392B;">' + E(err.message || err) + '</span>'; }
  WN_BUSY = false; document.querySelectorAll('#fx-box button, .wn-one, .wn-one-p').forEach(b => b.disabled = false);
}
// ── 학생 이름 검색 / 알림을 눌러 들어왔을 때: 그 학생 기록만 보기 ──
async function showStudent(q, sub) {
  const body = g('fx-body'); if (!nk(q)) { body.innerHTML = '<span class="hint">이름을 쓰면 그 학생의 시험 기록만 나와요.</span>'; return; }
  body.textContent = '기록을 불러오는 중...';
  try {
    const all = await subsOf(q), hit = all.filter(x => nk(x.studentName).includes(nk(q)));
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
      return '<div style="border-top:1px solid var(--line);padding:6px 0;display:flex;gap:8px;align-items:center;flex-wrap:wrap;' + (hl ? 'background:#f1f8f3;' : '') + '"><input type="checkbox" class="wn-chk" data-k="' + E(k) + '"' + (WN_SEL[k] ? ' checked' : '') + '><span style="flex:1;min-width:150px;"><span style="display:inline-block;padding:2px 10px;border-radius:999px;font-weight:800;font-size:18px;line-height:1.3;color:#fff;background:' + (sc100 >= 90 ? '#1f7a4d' : sc100 >= 70 ? '#1F3A6B' : '#C1392B') + ';">' + sc100 + '점</span> <span style="font-weight:600;color:#475569;">' + s.score + '/' + s.total + '</span><div style="margin-top:2px;"><b>' + E(s.examTitle) + '</b> <span class="hint" style="margin:0;">' + F(s.submittedAt) + '</span></div></span>' + (bad ? '<span style="display:inline-flex;gap:4px;white-space:nowrap;"><button type="button" class="btn outline wn-one" data-kind="note" data-k="' + E(k) + '" style="padding:4px 10px;">📓 오답노트</button><button type="button" class="btn outline wn-one-p" data-kind="note" data-k="' + E(k) + '" style="padding:4px 8px;" title="오답노트 인쇄">🖨️</button></span><span style="display:inline-flex;gap:4px;white-space:nowrap;"><button type="button" class="btn outline wn-one" data-kind="retry" data-k="' + E(k) + '" style="padding:4px 10px;">🔁 다시풀기</button><button type="button" class="btn outline wn-one-p" data-kind="retry" data-k="' + E(k) + '" style="padding:4px 8px;" title="다시풀기 인쇄">🖨️</button></span>' : '<span class="hint" style="margin:0;">만점</span>') + '</div>'; };
    body.innerHTML = '<div style="font-weight:700;margin-bottom:2px;">👤 ' + E(who) + ' · 시험 기록 ' + mine.length + '건</div>' +
      window.wnTeacherToggleHtml() +
      (cur ? '<div style="font-weight:700;color:#1f6f4a;margin-top:6px;">⬇️ 이번에 제출한 시험</div>' + row(cur, true) + '<div style="font-weight:700;margin:12px 0 2px;">🗂️ 이전 시험 기록 ' + rest.length + '건</div>' : '') +
      rest.map(s => row(s, false)).join('') +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;"><button type="button" class="btn outline" id="fx-all" style="padding:6px 12px;">틀린 기록 전부 체크</button></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;"><button type="button" class="btn primary" id="fx-note" style="padding:10px 16px;font-size:15px;">📓 체크한 시험 오답노트 받기</button><button type="button" class="btn primary" id="fx-retry" style="padding:10px 16px;font-size:15px;">🔁 체크한 시험 다시풀기 받기</button></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;"><button type="button" class="btn outline" id="fx-note-p" style="padding:8px 14px;">🖨️ 오답노트 인쇄</button><button type="button" class="btn outline" id="fx-retry-p" style="padding:8px 14px;">🖨️ 다시풀기 인쇄</button></div><div class="hint" style="margin-top:4px;">🖨️는 학생용만 인쇄 창으로 보내요 (강사용은 파일로 받아져요).</div>';
    window.wnTeacherBind(body);
    body.querySelectorAll('.wn-chk').forEach(c => c.addEventListener('change', () => { if (c.checked) WN_SEL[c.dataset.k] = 1; else delete WN_SEL[c.dataset.k]; }));
    body.querySelectorAll('.wn-one').forEach(b => b.addEventListener('click', () => runWn(b.dataset.kind, [b.dataset.k])));
    body.querySelectorAll('.wn-one-p').forEach(b => b.addEventListener('click', () => runWn(b.dataset.kind, [b.dataset.k], true)));
    const allBtn = g('fx-all'), chks = () => Array.from(body.querySelectorAll('.wn-chk')).filter(c => !c.disabled);
    const sync = () => { const on = chks().length > 0 && chks().every(c => c.checked); allBtn.textContent = on ? '✅ 전부 체크됨 (누르면 해제)' : '틀린 기록 전부 체크'; };
    allBtn.addEventListener('click', () => { const on = chks().length > 0 && chks().every(c => c.checked); chks().forEach(c => { c.checked = !on; if (c.checked) WN_SEL[c.dataset.k] = 1; else delete WN_SEL[c.dataset.k]; }); sync(); });
    body.querySelectorAll('.wn-chk').forEach(c => c.addEventListener('change', sync)); sync();
    g('fx-note').addEventListener('click', () => runWn('note', Object.keys(WN_SEL).filter(k => mine.some(x => wnKey(x) === k))));
    g('fx-retry').addEventListener('click', () => runWn('retry', Object.keys(WN_SEL).filter(k => mine.some(x => wnKey(x) === k))));
    const mk = () => Object.keys(WN_SEL).filter(k => mine.some(x => wnKey(x) === k));
    g('fx-note-p').addEventListener('click', () => runWn('note', mk(), true));
    g('fx-retry-p').addEventListener('click', () => runWn('retry', mk(), true));
  } catch (err) { body.innerHTML = '<span style="color:#C1392B;">' + E(err.message || err) + '</span>'; }
}

const PANEL_HTML = '<div class="card" id="fx-box" style="border:2px solid #1f6f4a;"><div style="font-size:17px;font-weight:800;">📓 오답노트 · 🔁 다시풀기 만들기</div><div style="margin-top:10px;"><b>① 학생 이름</b></div><input id="fx-q" list="fx-names" placeholder="이름을 쓰세요 (일부만 써도 돼요)" autocomplete="off" style="display:block;width:100%;box-sizing:border-box;margin-top:6px;padding:10px;font-size:16px;"><datalist id="fx-names"></datalist><div style="margin-top:14px;"><b>② 시험 고르기</b> <span class="hint" style="margin:0;">(체크하면 여러 시험이 한 PDF로 합쳐져요)</span></div><div id="fx-body" class="hint" style="margin-top:6px;">위에 학생 이름을 쓰면 그 학생의 시험 기록이 나와요.</div><div id="wn-box" style="margin-top:14px;"><b>③ 받기 설정</b><div style="margin:6px 0;"><label style="display:flex;align-items:center;gap:10px;font-weight:800;font-size:16px;color:#5B21B6;padding:8px 12px;background:#F5F3FF;border:2px solid #7C3AED;border-radius:10px;">회차 <select id="wn-round" style="font-size:16px;padding:4px 8px;"><option value="1" selected>1차 (처음 시험에서 틀린 문제)</option><option value="2">2차 (1차 다시풀기에서 또 틀린 문제)</option><option value="3">3차 (2차 다시풀기에서 또 틀린 문제)</option></select></label><div class="hint" style="margin:4px 0 8px;">2차·3차는 학생이 앞 회차 다시풀기를 푼 뒤에 만들 수 있어요. 다시풀기 QR로 풀면 「2차 점수」「3차 점수」가 기록돼요.</div></div><div style="margin:6px 0;"><label style="display:flex;align-items:center;gap:10px;font-weight:800;font-size:17px;color:#1F3A6B;padding:10px 12px;background:#F3F7FF;border:2px solid #1F3A6B;border-radius:10px;cursor:pointer;"><input type="checkbox" id="wn-f-teacher" style="width:24px;height:24px;flex:none;"> 강사용도 같이 <span style="font-weight:500;font-size:13px;color:#475569;">(끄면 학생용만)</span></label></div><input type="checkbox" id="wn-f-student" checked style="display:none"><input type="checkbox" id="wn-f-answers" checked style="display:none"><details style="margin-top:4px;"><summary style="cursor:pointer;color:#1F3A6B;font-size:14px;">⚙️ 세부 설정 (보통은 안 건드려도 돼요)</summary><div style="margin:8px 0 0 4px;"><label style="font-weight:400;display:block;margin:4px 0;"><input type="checkbox" id="wn-expl" checked> 오답노트에 해설 넣기</label><label style="font-weight:400;display:block;margin:4px 0;"><input type="checkbox" id="wn-one" checked> 다시풀기는 학생용+정답·해설을 한 파일로 (정답은 새 장 앞면부터)</label><label style="font-weight:400;display:block;margin:4px 0;">오답노트 쓰는 빈칸 크기 <select id="wn-blank"><option value="0">없음</option><option value="60">작게</option><option value="110" selected>보통</option><option value="170">넓게</option></select></label></div></details><div id="wn-bar" style="display:none;height:14px;background:#e6e1d6;border-radius:8px;overflow:hidden;margin:10px 0 4px;"><div id="wn-fill" style="height:100%;width:0;background:#1f6f4a;transition:width .5s linear;"></div></div><div id="wn-msg" class="hint" style="margin-top:6px;"></div></div></div>';

/* 「강사용도 같이」 선택 칸을 시험 목록 바로 위에도 둔다 (줄마다 있는 받기·인쇄 버튼을 누르기 전에 보이도록). 모든 칸이 서로 같은 값을 가진다 */
window.wnTeacherToggleHtml = function () { return '<label class="wn-tsync" style="display:flex;align-items:center;gap:10px;margin:10px 0;padding:12px 14px;background:#F3F7FF;border:2px solid #1F3A6B;border-radius:10px;font-weight:800;font-size:17px;color:#1F3A6B;cursor:pointer;"><input type="checkbox" class="wn-tsync-c" style="width:24px;height:24px;flex:none;" ' + (window.__wnTeacher === true ? 'checked' : '') + '> 강사용도 같이 <span style="font-weight:400;color:#475569;">(끄면 학생용만)</span></label>'; };
window.wnTeacherBind = function (root) {
  const main = document.getElementById('wn-f-teacher');
  const all = () => Array.from(document.querySelectorAll('.wn-tsync-c'));
  const set = v => { window.__wnTeacher = v; all().forEach(c => { c.checked = v; }); if (main) main.checked = v; };
  if (main && window.__wnTeacher != null) main.checked = window.__wnTeacher;
  (root || document).querySelectorAll('.wn-tsync-c').forEach(c => { if (!c.dataset.b) { c.dataset.b = 1; c.checked = main ? main.checked : c.checked; c.addEventListener('change', () => set(c.checked)); } });
  if (main && !main.dataset.b) { main.dataset.b = 1; main.addEventListener('change', () => set(main.checked)); }
};
window.runWn = runWn; window.wnShowStudent = function (name, sub) { g('fx-q').value = name; return showStudent(name, sub).then(() => g('fx-box').scrollIntoView({ block: 'start', behavior: 'smooth' })); };
window.wnPanelMount = function (host, opts) {
  GETALL = (opts && opts.getAll) || null;
  host.innerHTML = PANEL_HTML;


let fxT = null, fxLoaded = false;
g('fx-q').addEventListener('input', () => { clearTimeout(fxT); fxT = setTimeout(() => showStudent(g('fx-q').value), 400); });
g('fx-q').addEventListener('focus', async () => {
  if (fxLoaded) return; fxLoaded = true;
  try {
    let names; const r = GETALL ? null : await callApi('studentNames', { password: getTeacherPassword() });
    if (r && r.ok) names = r.names; else { const all = await fullSubs(); names = all.map(x => x.studentName).filter((n, i, a) => n && a.indexOf(n) === i).sort(); }
    g('fx-names').innerHTML = names.map(n => '<option value="' + E(n) + '">').join('');
  } catch (x) { fxLoaded = false; }
});
setTimeout(function () { const q = new URLSearchParams(location.search), stu = q.get('stu'); if (!stu) return; g('fx-q').value = stu; showStudent(stu, q.get('sub')).then(() => g('fx-box').scrollIntoView({ block: 'start' })); }, 0);

};
})();
