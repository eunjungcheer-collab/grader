const WORD_JUNG_API = /(밤|낮|새벽|한밤|하는|하던|되는|있는|없는|공부|수업|식사|여행|운전|근무|방송|통화|작업|실험|관찰|측정|비행|운동|활동|학습|설명|조사|검사|회의|상담|출장|휴식|휴가|연습|훈련|제작|제조|생산|사용|이용|운영|운행|공사|수리|점검|준비|예약|접수|처리|진료|치료|입원|재판|연구|개발|발표|촬영|녹화|방영|전송|이동|보관|운반|작동|가동|통신|거래|판매|영업|주문|배송|검토|심사|논의|토론)중$/;      // 학교 이름이 아닌 「~중」 낱말 (pdfui.js의 WORD_JUNG와 같은 목록)
// Apps Script 웹앱 호출 헬퍼.
// Content-Type을 지정하지 않아야(text/plain 기본값) CORS preflight 없이 바로 호출된다.
// ── 문제은행 목록 캐시: 문항이 수천 개가 되어도 페이지를 옮길 때마다 전부 다시 내려받지 않게 한다 ──
// 문항을 저장·수정·삭제하면 바로 비우고, 그 밖에는 10분 동안 재사용한다. (params.fresh = true 이면 항상 새로 받는다)
const _QC_KEY = 'qbank_cache_v1', _QC_TTL = 10 * 60 * 1000;
let _qcMem = null;
function _qcGet() {
  const now = Date.now();
  let dirty = 0; try { dirty = Number(localStorage.getItem('qbank_dirty') || 0); } catch (e) {}      // 다른 창에서 문제은행을 바꿨으면(이름 바꾸기·삭제 등) 이 창에 저장해 둔 목록도 버린다
  if (_qcMem && _qcMem.t < dirty) _qcMem = null;
  if (_qcMem && now - _qcMem.t < _QC_TTL) return _qcMem.q;
  try {
    const raw = sessionStorage.getItem(_QC_KEY);
    if (raw) { const o = JSON.parse(raw); if (o && now - o.t < _QC_TTL && o.t >= dirty && Array.isArray(o.q)) { _qcMem = o; return o.q; } }
  } catch (e) {}
  return null;
}
function _qcSet(q) {
  _qcMem = { t: Date.now(), q: q };
  try { sessionStorage.setItem(_QC_KEY, JSON.stringify(_qcMem)); } catch (e) {}      // 너무 커서 안 들어가면 메모리에만 둔다
}
function _qcClear() { _qcMem = null; try { localStorage.setItem('qbank_dirty', String(Date.now())); } catch (e) {} try { sessionStorage.removeItem(_QC_KEY); } catch (e) {} }
window.clearQuestionCache = _qcClear;
const _QC_WRITE_RE = /^(saveQuestions|updateQuestions?|deleteQuestions?|renameBook|linkBook|deleteExams?)$/;      // 문제은행 문항이 바뀔 수 있는 작업 뒤에는 저장해 둔 문항 목록을 버린다

// ── 미리 받아 두기: 홈 화면에서 자주 가는 화면의 목록을 조용히 받아 두면, 그 화면을 열 때 바로 쓴다 (2분 안, 쓰기 작업이 있으면 버림) ──
const _PF_KEY = 'pf_v1', _PF_TTL = 120000, _PF_OK = /^(listExams|listAssignments|listSubmissions|retryLog|getRosters|listAlerts)$/;
const _PF_READ = /^(list|get|stu|weak|review|noticeRoster|bankUnitMap|stats|retryLog|homeBadges|teacher|login|suggestName)/;
let _pfMem = null;
function _pfLoad() { if (_pfMem) return _pfMem; try { _pfMem = JSON.parse(sessionStorage.getItem(_PF_KEY) || '{}'); } catch (e) { _pfMem = {}; } return _pfMem; }
function _pfSave() { try { sessionStorage.setItem(_PF_KEY, JSON.stringify(_pfMem)); } catch (e) { try { sessionStorage.removeItem(_PF_KEY); } catch (e2) {} } }
function _pfKey(action, params) { return action + '|' + JSON.stringify(params || {}); }
function _pfGet(action, params) { const m = _pfLoad(), c = m[_pfKey(action, params)]; return c && Date.now() - c.t < _PF_TTL ? c.v : null; }
function _pfClear() { _pfMem = {}; try { sessionStorage.removeItem(_PF_KEY); } catch (e) {} try { Object.keys(localStorage).forEach(k => { if (k.indexOf('swr_') === 0) localStorage.removeItem(k); }); } catch (e) {} }
async function prefetchApis(list) {
  if (!getTeacherPassword()) return;
  const pw = getTeacherPassword();
  for (const action of list) {
    const params = { password: pw };
    if (_pfGet(action, params)) continue;
    try { const out = await _callApiRaw(action, params); if (out && out.ok) { _pfLoad()[_pfKey(action, params)] = { t: Date.now(), v: out }; _pfSave(); } } catch (e) {}
  }
}
window.prefetchApis = prefetchApis;

// 지난번 결과가 있으면 먼저 그려 주고(render 한 번), 최신 결과가 오면 달라진 경우에만 다시 그린다(render 두 번째). 오류는 호출한 쪽 catch 로 간다.
async function callApiSWR(action, params, render) {
  const p2 = Object.assign({}, params || {}); delete p2.password;
  const key = 'swr_' + action + '|' + JSON.stringify(p2);
  let cached = null; try { cached = JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) {}
  let drew = false;
  if (cached && cached.ok) { try { render(cached); drew = true; } catch (e) {} }
  const fresh = await callApi(action, params);
  if (fresh && fresh.ok) {
    try { localStorage.setItem(key, JSON.stringify(fresh)); } catch (e) {}
    if (!drew || JSON.stringify(cached) !== JSON.stringify(fresh)) render(fresh);
  } else if (!drew) render(fresh);
  return fresh;
}
window.callApiSWR = callApiSWR;

// ── 학생 답안 제출: 서버가 바쁘거나(선생님이 시험지를 올리는 중 등) 연결이 잠깐 끊겨도 같은 제출 번호(sid)로 몇 번 더 보낸다.
//    서버는 같은 sid를 한 번만 저장하므로 다시 보내도 기록이 두 번 생기지 않는다. 입력한 답은 화면에 그대로 둔다.
function newSubmitId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
async function submitWithRetry(action, params, onWait) {
  const waits = [2000, 4000, 7000, 10000, 15000]; let last = null;
  for (let i = 0; i <= waits.length; i++) {
    try {
      const r = await callApi(action, params);
      if (r && r.ok) return r;
      last = r;
      if (!/바빠|잠금|lock|timeout|시간|Exception|Service|too many|서버|연결/i.test(String((r && r.error) || ''))) return r;      // 틀린 이름 등 다시 보내도 안 되는 오류는 바로 알려 준다
    } catch (e) { last = { ok: false, error: (e && e.message) || String(e) }; }
    if (i < waits.length) { if (onWait) { try { onWait(i + 1, waits.length); } catch (e) {} } await new Promise(res => setTimeout(res, waits[i])); }
  }
  return last;
}
window.newSubmitId = newSubmitId;
window.submitWithRetry = submitWithRetry;

// 저장이 끝나기 전에 창을 닫거나 다른 화면으로 나가면 방금 고른 값이 사라진다 → 저장 중인 요청이 있으면 나가기 전에 경고한다
const _SAVE_GUARD_RE = /^(updateQuestions?|updateExamAnswers|updateExamTitle|saveQuestions|deleteQuestions?|deleteExams?|saveRedoUnits)$/;
window.__savePending = 0; window.__saveDirty = 0;
// 저장 요청을 하나씩 기록한다: 진행 중인 것(너무 오래 멈춘 것은 제외)과 실패한 것. 「나갈까요?」 경고는 정말 저장 중이거나 실패한 게 있을 때만 뜬다
const _pend = {}; let _pendId = 0; window.__saveFails = {};
function _pendLive() { const now = Date.now(); let n = 0; Object.keys(_pend).forEach(function (k) { if (now - _pend[k] < 150000) n++; }); return n; }
window.savePendingCount = function () { return _pendLive() + (window.__saveDirty || 0); };
window.saveFailCount = function () { return Object.keys(window.__saveFails).length; };
function _chip(kind, text) {
  try {
    let c = document.getElementById('save-chip');
    if (!c) { if (!document.body) return; c = document.createElement('div'); c.id = 'save-chip'; c.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:99999;padding:8px 14px;border-radius:999px;font:700 14px/1.3 sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.25);display:none;cursor:default;'; c.addEventListener('click', function () { if (!_pendLive()) c.style.display = 'none'; }); document.body.appendChild(c); }
    c.style.display = ''; c.textContent = text;
    c.style.background = kind === 'bad' ? '#C1392B' : kind === 'ok' ? '#1f6f4a' : '#1D4ED8'; c.style.color = '#fff';
    clearTimeout(c._t); if (kind === 'ok') c._t = setTimeout(function () { c.style.display = 'none'; }, 2500);
  } catch (e) {}
}
function _chipRefresh() {
  const n = _pendLive(), f = window.saveFailCount();
  if (n) _chip('wait', '💾 저장 중... (' + n + ')'); else if (f) _chip('bad', '⚠️ 저장이 안 된 게 있어요 — 다시 시도해 주세요'); else _chip('ok', '✅ 모두 저장됨');
}
window.addEventListener('beforeunload', function (e) { if (window.savePendingCount() > 0 || window.saveFailCount() > 0) { e.preventDefault(); e.returnValue = '아직 저장이 되지 않았어요'; return e.returnValue; } });
// 저장 중에 같은 앱 안의 다른 화면으로 가려 하면, 브라우저 경고 대신 앱이 저장이 끝나기를 기다렸다가 결과를 알려 주고 이동한다
let _navWaiting = false;
async function _waitSavedThen(go) {
  if (_navWaiting) return; _navWaiting = true;
  _chip('wait', '💾 저장을 마무리하는 중... 끝나면 자동으로 이동해요');
  const t0 = Date.now(); while (_pendLive() > 0 && Date.now() - t0 < 120000) await new Promise(function (r) { setTimeout(r, 200); });
  _navWaiting = false;
  if (window.saveFailCount() > 0 || _pendLive() > 0) {
    const why = window.saveFailCount() ? Object.keys(window.__saveFails).map(function (k) { return window.__saveFails[k]; }).join('\n') : '서버가 오래 응답하지 않아요.';
    _chipRefresh();
    if (!confirm('⚠️ 저장이 끝나지 않은 게 있어요.\n' + why + '\n\n그래도 이 화면에서 나갈까요? (취소하면 그대로 있어요)')) return;
    window.__saveFails = {}; _pendId = 0; Object.keys(_pend).forEach(function (k) { delete _pend[k]; });
  } else _chip('ok', '✅ 저장 확인 완료');
  go();
}
document.addEventListener('click', function (ev) {
  if (ev.defaultPrevented || ev.button || ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
  const a = ev.target && ev.target.closest ? ev.target.closest('a[href]') : null;
  if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
  const h = a.getAttribute('href') || ''; if (!h || h[0] === '#' || /^(javascript|mailto|tel):/i.test(h)) return;
  if (!(window.savePendingCount() > 0)) return;
  ev.preventDefault(); _waitSavedThen(function () { location.href = a.href; });
}, true);
try { const _hb = history.back.bind(history); history.back = function () { if (window.savePendingCount() > 0) _waitSavedThen(_hb); else _hb(); }; } catch (e) {}
window.warnIfSaving = function () { if (window.savePendingCount() > 0) { alert('⏳ 아직 저장이 되지 않았어요.\n\n「✅ 저장됨」 표시가 뜰 때까지 잠깐만 기다린 뒤에 나가 주세요.'); return true; } return false; };
// 서버가 바빠서(잠금 시간초과 등) 실패하면 잠시 뒤 자동으로 다시 보낸다 (저장처럼 한 번 더 보내도 안전한 요청에만 쓴다)
async function callApiRetry(action, params, tries, onWait) {
  tries = tries || 4; let r = null;
  for (let i = 0; i < tries; i++) {
    try { r = await callApi(action, params); } catch (e) { r = { ok: false, error: (e && e.message) || String(e) }; }
    if (r && r.ok) return r;
    if (i === tries - 1 || !/잠금|lock|시간초과|timeout|Exception|서버에 연결|fetch|network/i.test(String((r && r.error) || ''))) break;
    if (onWait) { try { onWait(i + 1, tries - 1); } catch (e) {} }
    await new Promise(res => setTimeout(res, 2500 * (i + 1)));
  }
  return r;
}
async function callApi(action, params) {
  if (_PF_OK.test(action)) { const hit = _pfGet(action, params); if (hit) return JSON.parse(JSON.stringify(hit)); }
  else if (!_PF_READ.test(action)) _pfClear();
  if (action === 'listQuestions' && !(params && params.fresh)) {
    const c = _qcGet();
    if (c) return { ok: true, questions: c.slice(), cached: true };
  }
  if (_QC_WRITE_RE.test(action)) _qcClear();
  const _wr = _SAVE_GUARD_RE.test(action), _id = ++_pendId; if (_wr) { _pend[_id] = Date.now(); _chipRefresh(); }
  let out, _err = null; try { out = await _callApiRaw(action, params); } catch (e) { _err = e; } finally { if (_wr) delete _pend[_id]; }
  if (_wr) { if (_err || !out || out.ok === false) window.__saveFails[action] = (_err && _err.message) || (out && out.error) || '저장 실패'; else delete window.__saveFails[action]; _chipRefresh(); }
  if (_err) throw _err;
  if (action === 'listQuestions' && out && out.ok && Array.isArray(out.questions)) _qcSet(out.questions);
  if (_QC_WRITE_RE.test(action)) _qcClear();
  return out;
}
// ── 오프라인 대기열: 인터넷이 끊겼을 때 한 저장·수정(두 번 실행돼도 안전한 것만)을 기기에 보관했다가 연결되면 자동 전송 ──
const _OFFQ_KEY = 'offq_v1', _OFFQ_OK = /^(updateExamTitle|updateExamAnswers|updateSubmissionScore|updateQuestions?|setRosters|setAlertSettings|setToc|setPresets|setStuOptions|deleteAssignment|createAssignments|approveStudent)$/;
function _offqLoad() { try { return JSON.parse(localStorage.getItem(_OFFQ_KEY) || '[]'); } catch (e) { return []; } }
function _offqSave(q) { try { localStorage.setItem(_OFFQ_KEY, JSON.stringify(q)); } catch (e) {} _offqBanner(); }
function _offqAdd(payload) { const q = _offqLoad(); q.push({ t: Date.now(), p: payload }); _offqSave(q); }
function _offqBanner() {
  try {
    const n = _offqLoad().length; let el = document.getElementById('offq-banner');
    if (!n) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'offq-banner'; el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#FEF3C7;color:#7A4B00;padding:8px 12px;font-size:13px;text-align:center;border-top:1px solid #F5D77A;'; document.body.appendChild(el); }
    el.textContent = '📴 인터넷이 끊겨서 저장 ' + n + '건이 대기 중이에요. 연결되면 자동으로 보내요.';
  } catch (e) {}
}
let _offqBusy = false;
async function offqFlush() {
  if (_offqBusy || !navigator.onLine) return; const q = _offqLoad(); if (!q.length) { _offqBanner(); return; }
  _offqBusy = true;
  try {
    while (q.length) {
      try { const r = await fetch(window.APP_CONFIG.API_URL, { method: 'POST', body: JSON.stringify(q[0].p) }); if (!r.ok) break; await r.json(); }
      catch (e) { break; }
      q.shift(); _offqSave(q);
    }
    if (!q.length) { try { Object.keys(localStorage).forEach(k => { if (k.indexOf('swr_') === 0) localStorage.removeItem(k); }); } catch (e) {} }
  } finally { _offqBusy = false; _offqBanner(); }
}
window.offqFlush = offqFlush;
window.addEventListener('online', offqFlush);
window.addEventListener('load', () => { _offqBanner(); setTimeout(offqFlush, 1500); });

async function _callApiRaw(action, params) {
  const payload = Object.assign({ action: action }, params || {});
  // 조회(list/get)는 같은 요청을 다시 보내도 안전하니, 일시적인 네트워크 오류면 한 번 더 시도한다.
  // (저장·삭제 같은 건 두 번 실행되면 안 되니 다시 시도하지 않는다)
  const retryable = /^(list|get)/.test(action);
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(window.APP_CONFIG.API_URL, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error('서버 요청에 실패했어요 (' + res.status + ')');
      }
      const out = await res.json();
      // 다른 기기에서 비밀번호를 바꾼 경우 등: 저장된 로그인이 맞지 않으면 지우고 로그인 화면으로 보낸다
      if (out && out.ok === false && out.error === '로그인이 필요해요.' && action !== 'login' && !/teacher_login/.test(location.pathname)) { clearTeacherLogin(); goLogin(); }
      if (out && out.error === 'unknown action') {
        throw new Error('서버(Apps Script)가 옛날 버전이에요. 새 AppsScript_Code.gs를 붙여넣고 "배포 관리 → 편집 → 새 버전"으로 다시 배포해주세요. (모르는 기능: ' + action + ')');
      }
      return out;
    } catch (e) {
      const network = e instanceof TypeError;          // "Failed to fetch" 같은 네트워크·보안 규칙 오류
      if (retryable && attempt < 1 && (network || e instanceof SyntaxError)) {
        await new Promise(r => setTimeout(r, 800));
        continue;
      }
      if (network && _OFFQ_OK.test(action) && !navigator.onLine) { _offqAdd(payload); return { ok: true, queued: true }; }   // 인터넷이 끊긴 채 한 저장은 보관했다가 연결되면 자동으로 보낸다
      if (network) throw new Error('서버에 연결하지 못했어요. 인터넷 연결과, Apps Script를 "새 버전으로 배포"했는지 확인해주세요.');
      if (e instanceof SyntaxError) throw new Error('서버가 이상한 응답을 줬어요(Apps Script에서 오류가 났을 수 있어요).');
      throw e;
    }
  }
}

// 로그인 상태: 이 탭에서만 유지(sessionStorage) 또는 이 기기에서 계속 유지(localStorage, 「이 기기에서 로그인 유지」를 켠 경우)
function getTeacherPassword() {
  let pw = '';
  try { pw = sessionStorage.getItem('teacher_pw') || ''; } catch (e) {}
  if (pw) return pw;
  try { pw = localStorage.getItem('teacher_pw_keep') || ''; } catch (e) {}
  if (pw) { try { sessionStorage.setItem('teacher_pw', pw); } catch (e) {} }
  return pw;
}
function setTeacherPassword(pw, keep) {
  try { sessionStorage.setItem('teacher_pw', pw); } catch (e) {}
  try { if (keep) localStorage.setItem('teacher_pw_keep', pw); else localStorage.removeItem('teacher_pw_keep'); } catch (e) {}
}
function isTeacherKept() { try { return !!localStorage.getItem('teacher_pw_keep'); } catch (e) { return false; } }
function clearTeacherLogin() {
  try { sessionStorage.removeItem('teacher_pw'); } catch (e) {}
  try { localStorage.removeItem('teacher_pw_keep'); } catch (e) {}
}
function goLogin() {
  try { sessionStorage.setItem('login_next', location.pathname.replace(/^.*\//, '') + location.search); } catch (e) {}
  location.href = 'teacher_login.html';
}

function requireLogin() {
  if (!getTeacherPassword()) {
    goLogin();
  }
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' +
    String(d.getDate()).padStart(2, '0') + ' ' +
    String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}


// 100점 만점 환산 (객관식 정답 수 / 객관식 문항 수). 객관식이 없으면 null
function to100(score, total) {
  return Number(total) > 0 ? Math.round(Number(score) / Number(total) * 100) : null;
}

// ── 정답이 여러 개인 문항(복수정답) ──
// 저장 형식: 정답 숫자를 이어붙인 "35" (3번과 5번을 모두 골라야 정답). 주관식은 "-".
// "3,5" · "③⑤" · "53" 어떻게 들어와도 "35"로 정리한다(1~9만, 중복 제거, 오름차순).
function normAnswer(a) {
  let s = String(a === undefined || a === null ? '' : a).trim();
  if (s === '-') return '-';
  s = s.replace(/[①-⑨]/g, function (c) { return String(c.charCodeAt(0) - 0x2460 + 1); });
  // "1/2" = 1번 또는 2번 중 하나만 맞아도 정답 (OR). 각 덩어리는 "35"처럼 모두 골라야 하는 복수정답일 수 있다.
  const parts = s.split('/').map(normOne_).filter(String);
  const seenP = {}, uniq = [];
  parts.forEach(function (x) { if (!seenP[x]) { seenP[x] = 1; uniq.push(x); } });
  return uniq.sort().join('/');
}
function normOne_(s) {
  const ds = String(s).match(/[1-9]/g) || [];
  const seen = {}, out = [];
  ds.forEach(function (d) { if (!seen[d]) { seen[d] = 1; out.push(d); } });
  return out.sort().join('');
}
// 학생 답이 정답과 맞는지 (정답이 "1/2"면 둘 중 하나만 같아도 맞음)
function answerMatches(given, correct) {
  const g = normAnswer(given), c = normAnswer(correct);
  if (!g || !c || c === '-') return false;
  return c.split('/').indexOf(g) >= 0;
}
// 「안 푸는 문항」: 학생이 뺀 번호는 답 대신 '~'로 보관한다 (채점·오답 집계에서 제외)
function isSkipAns(a) { return String(a === undefined || a === null ? '' : a).trim() === '~'; }
// "1-10, 15" · "1~10" 같은 입력에서 번호 모음을 만든다 (max를 넘는 번호는 버림)
function parseNumSet(text, max) {
  const out = new Set();
  String(text || '').replace(/[~∼～–—]/g, '-').replace(/\s*-\s*/g, '-').split(/[,，\s]+/).forEach(function (t) {
    const m = t.match(/^(\d{1,3})(?:-(\d{1,3}))?$/); if (!m) return;
    const a = parseInt(m[1], 10), b = m[2] ? parseInt(m[2], 10) : a;
    for (let k = Math.min(a, b); k <= Math.max(a, b) && k <= max; k++) if (k >= 1) out.add(k);
  });
  return out;
}
// 교재 번호(예: 51번)로 적은 「안 푸는 문항」을 이 시험의 위치(1부터)로 바꾼다. nums가 없으면 그냥 1~count
function parseNumSetLabeled(text, nums, count) {
  if (!nums || !nums.length) return parseNumSet(text, count);
  const mx = Math.max.apply(null, nums), want = parseNumSet(text, mx), out = new Set();
  nums.forEach(function (n, i) { if (want.has(Number(n))) out.add(i + 1); });
  return out;
}
// 화면에 보여줄 모양: "35" → "3, 5", "1/2" → "1 또는 2", "-" → "주관식"
function fmtAnswer(a) {
  const n = normAnswer(a);
  if (n === '-') return '주관식';
  return n.split('/').map(function (x) { return x.split('').join(', '); }).join(' 또는 ');
}

// 화면에 글자를 넣을 때 <, & 같은 문자가 깨지지 않게 바꿔준다 (모든 화면이 쓰는 공용 함수라 여기 둔다)

// ── 문제은행 문항의 정답을 시험지 정답표에서 찾는 공용 도구 (조합 화면·문제은행 목록에서 같이 쓴다) ──
// 시험지 이름 비교용: 이름 끝에 자동으로 붙는 「중1-2,4,6단원」 꼬리와 공백·대소문자를 뺀다. 다시 등록할 때 단원을 바꾸면 꼬리만 달라져서 같은 시험지가 다른 이름으로 보이던 문제를 막는다
function srcKey(t) { return String(t || '').replace(/\s+/g, ' ').trim().replace(/(?:\s+(?:\+\s*)?(?:[초중고]\d\s*-\s*)?\d+(?:\s*,\s*\d+)*\s*단원)+\s*$/, '').replace(/\s+/g, '').toLowerCase(); }
function sameSrc(a, b) { const x = srcKey(a), y = srcKey(b); return !!x && x === y; }
function ansAlnum(t) { return String(t || '').replace(/[^0-9A-Za-z가-힣]/g, ''); }
function ansOk(a) { return /^[1-5]{1,5}(\/[1-5]{1,5})*$/.test(String(a || '')); }
// 학교 이름 줄기(예: 「중평중」 → 「중평」): 「2학기 중간고사」의 「기 중」처럼 낱말 속 「중」은 건너뛴다
function ansStem(q) {
  const t = String(q.school || '') + ' ' + String(q.source || ''), re = /([가-힣]{2,4}?)중(?![가-힣])/g; let m;
  while ((m = re.exec(t))) { if (!/^(과학|기출|중등|학기|시험|정답|문제|단원|학년|내신|고사)/.test(m[1]) && !/(학기|고사|정답지|문제지|학년|단원)$/.test(m[1])) return m[1]; }
  return '';
}
function ansYear(q) { const m = (String(q.year || '') + ' ' + String(q.source || '')).match(/20\d\d/); return m ? m[0] : ''; }
// 문제 글자가 같은지: 앞의 번호·기호를 떼고 앞 15자가 서로의 글자 안에 들어 있으면 같은 문항으로 본다
function ansTextKey(t) { return ansAlnum(t).replace(/^\d{1,3}/, '').slice(0, 15); }
function ansTextHit(bankText, examText) { const k = ansTextKey(bankText); if (k.length < 12) return false; const e = ansAlnum(examText); return e.indexOf(k) >= 0; }
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// ── 문제은행 분류: 학년 → 단원, 일반 / 기출 ──
var GRADE_ORDER = ['초6', '중1', '중2', '중3', '공통과학', '고1', '고2', '고3', '기타'];
// 화면에 보여줄 순서 번호 (학년이 비어있는 "미분류"는 맨 뒤)
function gradeRank(g) { if (!g) return 99; const i = GRADE_ORDER.indexOf(g); return i < 0 ? 50 : i; }
// 같은 이름의 단원이 학년마다 있을 수 있어서(예: 중1·중2의 "물질의 특성"), 학년을 앞에 붙인 글자를 "단원 키"로 쓴다.
// 학년이 없는 예전 문항은 단원 글자 그대로(= 예전과 똑같이 동작).
function unitKey(q) { return q.grade ? q.grade + ' · ' + q.unit : String(q.unit); }
function isPastExam(q) { return q && q.kind === '기출'; }
async function renameBookFlow(oldN) {
  const nn = prompt('"' + oldN + '"의 새 교재 이름을 입력하세요.\n(문제은행 문항과 이 교재로 등록한 시험지 제목이 함께 바뀌어요. 이미 나눠 준 QR은 그대로 동작해요.)', oldN);
  if (!nn || !nn.trim() || nn.trim() === oldN) return false;
  try {
    const r = await callApi('renameBook', { password: getTeacherPassword(), oldName: oldN, newName: nn.trim() });
    if (!r.ok) throw new Error(r.error || '바꾸지 못했어요');
    alert('바꿨어요: 문제은행 문항 ' + r.questions + '개, 시험지 ' + r.exams + '개' + (r.questions === 0 ? '\n(문제은행에서 이 이름으로 시작하는 문항을 찾지 못했어요)' : ''));
    return true;
  } catch (e) { alert('교재 이름을 바꾸지 못했어요: ' + e.message + '\n(Apps Script를 새 버전으로 배포했는지 확인해 주세요)'); return false; }
}
// 교재 문항을 문제은행에서 지운 뒤, 그 교재로 등록된 시험지도 같이 지울지 묻는다 (시험지는 QR·제출 기록이 걸려 있어서 자동으로 지우지는 않는다)
async function offerDeleteBookExams(names) {
  try {
    const set = new Set(names), le = await callApi('listExams', { password: getTeacherPassword() });
    const exs = ((le && le.exams) || []).filter(e => e.recipeLabel && set.has(String(e.bookTitle || '').trim()));
    if (!exs.length) return 0;
    const subs = exs.reduce((a, e) => a + (e.submissionCount || 0), 0);
    if (!confirm('문제은행에서 지운 교재로 등록된 시험지가 ' + exs.length + '개 남아 있어요 (학생 제출 ' + subs + '건).\n\n이 시험지도 함께 삭제할까요?\n· [확인] 시험지도 삭제 (QR은 더 이상 안 열려요. 제출 기록은 남아요)\n· [취소] 시험지는 남겨 둠')) return 0;
    busyStart(); let n = 0;
    try { for (let i = 0; i < exs.length; i += 40) { const r = await callApi('deleteExams', { password: getTeacherPassword(), ids: exs.slice(i, i + 40).map(e => e.id), deleteSubmissions: false }); if (!r.ok) throw new Error(r.error || '시험지 삭제 실패'); n += Math.min(40, exs.length - i); } }
    finally { busyEnd(); }
    alert('시험지 ' + n + '개를 삭제했어요.'); return n;
  } catch (e) { alert('시험지 삭제 중 오류가 났어요: ' + e.message); return 0; }
}
// 오래 걸리는 삭제·변경 중에 창을 닫거나 이동하면 중간에 멈추므로, 그동안 나가려 하면 브라우저가 한 번 물어보게 한다
let _busyN = 0;
function _busyGuard(e) { e.preventDefault(); e.returnValue = ''; return ''; }
// 오래 걸리는 삭제·변경 중에는 화면 한가운데에 진행 상황 창을 띄운다 (버튼 글자가 「삭제 중... 3/20」처럼 바뀌면 그대로 따라 보여 준다)
let _busyBox = null, _busyObs = null;
function _busyShow(text) {
  try {
    if (!_busyBox) {
      _busyBox = document.createElement('div'); _busyBox.id = 'busy-box';
      _busyBox.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:20px;';
      _busyBox.innerHTML = '<div style="background:#fff;border-radius:16px;padding:26px 30px;max-width:420px;width:100%;text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.35);"><div class="busy-spin" style="width:42px;height:42px;margin:0 auto 14px;border:5px solid #dbe4ff;border-top-color:#1D4ED8;border-radius:50%;animation:busyspin 0.9s linear infinite;"></div><div id="busy-msg" style="font-size:20px;font-weight:800;color:#0B1F5C;word-break:keep-all;"></div><div style="margin-top:10px;font-size:14px;color:#6B7280;">끝날 때까지 창을 닫거나 다른 화면으로 이동하지 마세요.</div></div>';
      if (!document.getElementById('busy-style')) { const st = document.createElement('style'); st.id = 'busy-style'; st.textContent = '@keyframes busyspin{to{transform:rotate(360deg)}}'; document.head.appendChild(st); }
      document.body.appendChild(_busyBox);
    }
    document.getElementById('busy-msg').textContent = text || '처리 중...';
  } catch (e) {}
}
function busyMsg(text) { if (_busyN > 0) _busyShow(text); }
function busyStart(text) {
  if (!_busyN++) {
    window.addEventListener('beforeunload', _busyGuard);
    _busyShow(text || '삭제 중...');
    try {
      _busyObs = new MutationObserver(function (muts) {
        for (const m of muts) { const el = m.target && (m.target.nodeType === 1 ? m.target : m.target.parentElement); if (!el || (_busyBox && _busyBox.contains(el))) continue;
          const t = (el.textContent || '').trim(); if (t.length < 80 && /삭제 중|정리 중|삭제하는 중|\d+\s*\/\s*\d+/.test(t)) { _busyShow(t.replace(/\(창을 닫지 마세요\)/, '').trim()); } }
      });
      _busyObs.observe(document.body, { childList: true, characterData: true, subtree: true });
    } catch (e) {}
  }
}
function busyEnd() {
  if (_busyN > 0 && !--_busyN) {
    window.removeEventListener('beforeunload', _busyGuard);
    try { if (_busyObs) _busyObs.disconnect(); _busyObs = null; if (_busyBox) { _busyBox.remove(); _busyBox = null; } } catch (e) {}
  }
}
function isBookQ(q) { return q && q.kind === '교재'; }
// 교재 문제의 교재 이름: 출처 「교재이름 4-1. 단원이름 최다빈출공략」에서 소단원 번호 앞부분
function bookNameOf(q) { const s = String(q.source || ''), m = s.match(/^(.*?)\s*\d{1,2}(?:\s*-\s*\d{1,2}){0,2}\s*\.(?!\d)/); return ((m ? m[1] : s) || '').trim() || '(교재 이름 없음)'; }
// "1단원" < "2단원" < "10단원", "4-1." < "4-2." 처럼 숫자를 숫자답게 정렬
function naturalCompare(a, b) { return String(a).localeCompare(String(b), 'ko', { numeric: true }); }

// PDF 파일 이름에서 학년·단원(·기출 여부)을 추정해 미리 채워준다. (틀릴 수 있어서 화면에서 고칠 수 있게 한다)
//  "[강남 3구 유형공략] 4-1.입자의 운동과 물질의 상태(02) 중1 과학 [25문제] [Q].pdf" → 중1 / 4-1. 입자의 운동과 물질의 상태
//  "중2_1단원_전범위_모의고사1_난이도_중.pdf" → 중2 / 1단원
//  "중등 과학(공통) 홍길동 중2 8단원 은하와 우주 2026 09 23" → 중2 / 8단원 은하와 우주
// 글자 속에서 학년을 찾는다 (중학교 과학 기준): "3학년", "제 3 학년", "(3학년)", "과학3", "중3" … ("2023학년도"의 3은 제외)
function gradeFromText(t) {
  t = String(t || '');
  let m = t.match(/(?:공통|통합)\s*과학/); if (m) return '고1';        // 공통과학1·2, 통합과학 → 고1
  m = t.match(/(?<![\d가-힣])고\s*([123])(?!\s*학기|\d)/); if (m) return '고' + m[1];
  m = t.match(/(?<![\d가-힣])중\s*([123])(?!\s*학기|\d)/); if (m) return '중' + m[1];
  m = t.match(/(?<!\d)([123])\s*학년(?!도)/); if (m) return '중' + m[1];
  m = t.match(/과학\s*\(?\s*([123])(?![\d학])/); if (m) return '중' + m[1];
  return '';
}
function guessMeta(fileName) {
  let s = String(fileName || '').replace(/\.pdf$/i, '').replace(/_/g, ' ');
  const GR = /(초\s*6|중\s*[123]|고\s*[123]|공통\s*과학)/g;
  // 학년: "중2", "중 2", "고1" … 단, "다라중 2학기"·"가나중 2025"의 "중 2"는 학교 이름 + 학기·연도라서 학년이 아니다
  let grade = '', m;
  while ((m = GR.exec(s))) {
    const after = s.slice(m.index + m[0].length);
    if (/^\s*학기/.test(after) || /^\d/.test(after)) continue;
    grade = m[1].replace(/\s+/g, ''); break;
  }
  if (!grade) grade = gradeFromText(s);       // "3학년" → 중3 (중학교 과학 기준)
  const ym = s.match(/(?:^|[^\d])(20\d\d)(?!\d)/); const year = ym ? ym[1] : '';
  const schoolInName = typeof extractSchoolYear === 'function' && !!extractSchoolYear(s).school;      // 파일 이름에 "중계중" 같은 학교 이름이 있으면 학교 시험지
  const kind = (!/모의\s*(고사|평가|시험)|모평|변형|유사|대비|예상\s*문제|적중|실전/.test(s) && (/기출|중간고사|기말고사|수행평가|학교\s*시험|(?:^|\s)(?:중간|기말)(?:\s|$)/.test(s) || schoolInName)) ? '기출' : '일반';   // 모의고사는 기출이 아니다
  const stripGrade = x => x.replace(/(초\s*6|중\s*[123]|고\s*[123])(?!\d|\s*학기)/g, ' ').replace(/(?<!\d)[123]\s*학년(?!도)/g, ' ').replace(/공통\s*과학/g, ' ');

  if (kind === '기출') {
    // 학교 기출은 한 파일에 여러 단원이 섞여 있어서 파일 이름으로 단원을 알 수 없다 → 단원은 비워두고(문항별로 지정),
    // 학년·과목 표시를 뺀 나머지(학교·시험 이름)를 학교 칸에 넣는다.
    // 괄호 안에 학교 이름이 있으면(예: "… 과학 (불암중)") 버리지 않고 살린다. 그 밖의 괄호([출판사]·(01) 등)는 버린다.
    let sc = s.replace(/\[[^\]]*\]/g, ' ').replace(/\(([^)]*)\)/g, (mm, inner) => /(중학교|중|고등학교|고)\s*$/.test(inner.trim()) ? ' ' + inner + ' ' : ' ');
    sc = stripGrade(sc).replace(/(^|\s)과학(?=\s|$)/g, ' ').replace(/기출\s*문제|기출/g, ' ').replace(/중등|\bPDF\b/gi, ' ');
    sc = sc.replace(/20\d\d\s*(학년도|년도|년)?/g, ' ').replace(/\s+/g, ' ').trim();
    let sm = sc.match(/(^|\s)([가-힣]{2,6}(?:중학교|중))(?=\s|$)/);
    if (sm && !/중학교$/.test(sm[2]) && WORD_JUNG_API.test(sm[2])) sm = null;      // 「한밤중」·「공부중」 같은 낱말은 학교 이름이 아니다                     // 학교 이름은 맨 앞으로: "불암중 1학기 기말고사"
    if (sm && sm[2] !== '중등' && !/^중[123]?$/.test(sm[2])) sc = (sm[2] + ' ' + sc.replace(sm[0], ' ')).replace(/\s+/g, ' ').trim();
    return { grade: grade, unit: '', kind: kind, school: sc, year: year };
  }

  let t = s.replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ');            // [출판사]·[Q]·(01) 같은 꼬리표
  t = stripGrade(t);
  t = t.replace(/\d{4}\s+\d{1,2}\s+\d{1,2}/g, ' ');                              // 날짜 2026 09 23
  t = t.replace(/모의고사(\s*\d+(?!\s*단원|\d))?|전범위|난이도\s*\S*|중등|중학교|고등학교|유형공략/g, ' ');
  t = t.replace(/(^|\s)과학(?=\s|$)/g, ' ');                                      // 낱말로 따로 있는 "과학"만 (과학과 안전 같은 건 그대로)
  t = t.replace(/\s+/g, ' ').trim();
  const dm = t.match(/\d+\s*단원.*$/);                                            // "N단원"이 있으면 그 앞(사람 이름 등)은 버린다
  if (dm) t = dm[0].replace(/\s+/g, ' ').trim();
  t = t.replace(/^(\d+(?:-\d+)?)\.\s*/, '$1. ');                                  // "4-1.입자" → "4-1. 입자"
  return { grade: grade, unit: t, kind: kind, school: '', year: '' };
}
// 문항 옆에 붙일 분류 꼬리표(학년 / 기출 / 학교) HTML
function classTagsHtml(q) {
  return (q.grade ? '<span class="tag-grade">' + escapeHtml(q.grade) + '</span>' : '') +
    (isPastExam(q) ? '<span class="tag-past">기출</span>' : '') + (isBookQ(q) ? '<span class="tag-book">📚 ' + escapeHtml(bookNameOf(q)) + '</span>' : '') +
    (isPastExam(q) && q.year ? '<span class="tag-school">' + escapeHtml(q.year) + '</span>' : '') +
    (isPastExam(q) && q.school ? '<span class="tag-school">' + escapeHtml(q.school) + '</span>' : '');
}


// ── 시험지를 지울 때 그 시험에서 문제은행에 저장한 문제도 같이 지울지 묻는다 ──
// 시험을 등록하면서 저장된 문제(출처 = 시험 이름)만 찾는다. 문제은행에서 골라 조합한 시험(hasRecipe)은 원래 문제를 빌려 쓴 것이라 건드리지 않는다.
// exams: [{ title, hasRecipe }]. 지울 문제가 있고 선생님이 「확인」을 누르면, 시험지를 지운 뒤 호출할 함수를 돌려준다(아니면 null).
// 문제은행에서 지울 수 있는 문제를 찾는다 → { ids } 또는 null (같은 이름의 시험지가 남아 있으면 그 문제는 건드리지 않는다)
async function findBankDeletion(exams, allExams) {
  try {
    if (!allExams) { try { const le = await callApi('listExams', { password: getTeacherPassword() }); if (le && le.ok) allExams = le.exams; } catch (e) {} }
    const targets = (exams || []).filter(e => !e.hasRecipe);
    if (!targets.length) return null;
    const r = await callApi('listQuestions', { password: getTeacherPassword() });
    if (!r || !r.ok) return null;
    const titles = new Set(targets.map(e => String(e.title).trim()));
    const gone = new Set(targets.map(e => String(e.id)));
    const keep = new Set((allExams || []).filter(e => !gone.has(String(e.id))).map(e => String(e.title).trim()));
    const titleOf = q => { const s = String(q.source || '').trim(); return titles.has(s) ? s : (q.kind === '교재' && titles.has(s + '공략') ? s + '공략' : ''); };
    const qs = r.questions.filter(q => { const t = titleOf(q); return t && !keep.has(t); });
    // 같은 제목의 시험지가 하나 남아 있어도, 그 시험지가 쓰지 않는 겹친 문항(여러 번 등록하며 쌓인 것)은 지울 수 있다
    const stay = (allExams || []).filter(e => !gone.has(String(e.id)) && titles.has(String(e.title).trim()));
    if (stay.length && stay.length <= 40) {
      const used = new Set(); let ok = true;
      for (const e of stay) { try { const d = await callApi('getExamDetail', { password: getTeacherPassword(), id: e.id }); if (!d.ok || !(d.sourceQuestionIds || []).length) { ok = false; break; } (d.sourceQuestionIds || []).forEach(id => used.add(id)); } catch (er) { ok = false; break; } }
      if (ok && used.size) r.questions.forEach(q => { const t = titleOf(q); if (t && keep.has(t) && !used.has(q.id) && !qs.includes(q)) qs.push(q); });
    }
    return qs.length ? { ids: qs.map(q => q.id) } : null;
  } catch (e) { return null; }
}
// 시험지를 지울 때 묻는 것을 한 번에 묻는다: 제출 기록도 지울지, 문제은행의 문제도 지울지 (각각 체크로 고른다)
// 돌려주는 값: 취소면 null, 아니면 { scores: 제출 기록도 삭제?, bankDel: 문제은행 정리 함수 또는 null }
async function askDeleteExams(exams, allExams, opt) {
  const list = (exams || []).filter(Boolean);
  const fb = (opt && opt.noBank) ? null : await findBankDeletion(list, allExams);
  const subs = list.reduce((t, e) => t + (Number(e.submissionCount) || 0), 0), hasSubInfo = list.some(e => e.submissionCount !== undefined);
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:10000; display:flex; align-items:center; justify-content:center; padding:16px;';
    const names = list.slice(0, 3).map(e => '· ' + escapeHtml(e.title)).join('<br>') + (list.length > 3 ? '<br>… 외 ' + (list.length - 3) + '개' : '');
    ov.innerHTML = '<div style="background:#fff; border-radius:14px; padding:18px 18px 14px; width:min(460px,100%); box-shadow:0 10px 40px rgba(0,0,0,.3); font-size:14px; line-height:1.55;">' +
      '<b style="font-size:16px;">시험지 ' + list.length + '개를 삭제할까요?</b><div style="margin:8px 0; color:#374151; font-size:13px;">' + names + '</div>' +
      (list.some(e => e.bookTitle && !e.hasRecipe) ? '<div style="margin:8px 0; padding:9px 11px; border-radius:8px; background:#FDECEA; border:1px solid #C1392B; color:#8F2A20; font-size:13px; line-height:1.5;">⚠️ <b>교재 QR이 걸린 시험지가 있어요.</b> 이미 나눠 준 교재라면 삭제하는 순간 그 단원 QR이 「존재하지 않는 시험」이 돼요.<br>정답만 고치려면 삭제하지 말고 <b>「단원·정답 수정」</b>을 쓰세요. (시험 번호가 그대로라 QR이 계속 열려요)<br>삭제한 뒤 다시 등록했다면 30일 안에 「데이터 관리 → 예전 QR 이어붙이기」로 살릴 수 있어요.</div>' : '') +
      '<label style="display:flex; gap:8px; align-items:flex-start; margin:10px 0;"><input type="checkbox" id="dx-sc" style="margin-top:4px;"><span><b>제출 기록(학생 점수)도 함께 삭제</b><br><span style="color:#6B7280; font-size:12px;">' + (hasSubInfo ? '제출 ' + subs + '건 · ' : '') + '체크하지 않으면 시험지만 지우고 기록은 남겨요.</span></span></label>' +
      (fb ? '<label style="display:flex; gap:8px; align-items:flex-start; margin:10px 0;"><input type="checkbox" id="dx-bk" style="margin-top:4px;"><span><b>문제은행의 문제 ' + fb.ids.length + '개도 함께 삭제</b><br><span style="color:#6B7280; font-size:12px;">되돌릴 수 없어요. 체크하지 않으면 문제는 문제은행에 남아요.</span></span></label>' : '<div style="color:#6B7280; font-size:12px; margin:8px 0;">문제은행에서 같이 지울 문제는 없어요.</div>') +
      '<div style="display:flex; gap:8px; justify-content:flex-end; margin-top:12px;"><button type="button" class="btn outline" id="dx-no" style="padding:8px 16px;">취소</button><button type="button" class="btn danger" id="dx-ok" style="padding:8px 16px;">삭제</button></div></div>';
    document.body.appendChild(ov);
    const close = v => { ov.remove(); resolve(v); };
    ov.querySelector('#dx-no').addEventListener('click', () => close(null));
    ov.querySelector('#dx-ok').addEventListener('click', () => {
      const scores = ov.querySelector('#dx-sc').checked, bk = ov.querySelector('#dx-bk');
      const ids = fb && bk && bk.checked ? fb.ids : null;
      close({ scores: scores, bankDel: ids ? async function () { for (let i = 0; i < ids.length; i += 40) { const d = await callApi('deleteQuestions', { password: getTeacherPassword(), ids: ids.slice(i, i + 40) }); if (!d.ok) throw new Error(d.error || '문제은행 삭제 실패'); } return ids.length; } : null });
    });
  });
}


// 구글 드라이브 파일을 구글에서 바로 받아 Blob으로 돌려준다 (구글 다운로드 링크는 한글 파일 이름이 깨져서, 이름은 우리가 직접 붙여 저장한다)
// 서버(Apps Script)가 옛날 버전이거나 막히면 null을 돌려주니, 호출한 쪽에서 예전 방식으로 넘어가면 된다.
async function driveDirectBlob(fileId, onProg) {
  try {
    const tk = await callApi('driveToken', { password: getTeacherPassword() }); if (!tk || !tk.ok || !tk.token) return null;
    const resp = await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?alt=media&supportsAllDrives=true', { headers: { Authorization: 'Bearer ' + tk.token } });
    if (!resp.ok || !resp.body) return null;
    const tot = parseInt(resp.headers.get('Content-Length') || '0', 10), rd = resp.body.getReader(), chunks = []; let got = 0;
    for (;;) { const r = await rd.read(); if (r.done) break; chunks.push(r.value); got += r.value.length; if (onProg) onProg(got, tot); }
    return new Blob(chunks, { type: 'application/pdf' });
  } catch (e) { console.warn('driveDirectBlob', e); return null; }
}
