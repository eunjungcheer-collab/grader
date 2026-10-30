// Apps Script 웹앱 호출 헬퍼.
// Content-Type을 지정하지 않아야(text/plain 기본값) CORS preflight 없이 바로 호출된다.
// ── 문제은행 목록 캐시: 문항이 수천 개가 되어도 페이지를 옮길 때마다 전부 다시 내려받지 않게 한다 ──
// 문항을 저장·수정·삭제하면 바로 비우고, 그 밖에는 10분 동안 재사용한다. (params.fresh = true 이면 항상 새로 받는다)
const _QC_KEY = 'qbank_cache_v1', _QC_TTL = 10 * 60 * 1000;
let _qcMem = null;
function _qcGet() {
  const now = Date.now();
  if (_qcMem && now - _qcMem.t < _QC_TTL) return _qcMem.q;
  try {
    const raw = sessionStorage.getItem(_QC_KEY);
    if (raw) { const o = JSON.parse(raw); if (o && now - o.t < _QC_TTL && Array.isArray(o.q)) { _qcMem = o; return o.q; } }
  } catch (e) {}
  return null;
}
function _qcSet(q) {
  _qcMem = { t: Date.now(), q: q };
  try { sessionStorage.setItem(_QC_KEY, JSON.stringify(_qcMem)); } catch (e) {}      // 너무 커서 안 들어가면 메모리에만 둔다
}
function _qcClear() { _qcMem = null; try { sessionStorage.removeItem(_QC_KEY); } catch (e) {} }
window.clearQuestionCache = _qcClear;
const _QC_WRITE_RE = /^(saveQuestions|updateQuestions?|deleteQuestions?)$/;

async function callApi(action, params) {
  if (action === 'listQuestions' && !(params && params.fresh)) {
    const c = _qcGet();
    if (c) return { ok: true, questions: c.slice(), cached: true };
  }
  if (_QC_WRITE_RE.test(action)) _qcClear();
  const out = await _callApiRaw(action, params);
  if (action === 'listQuestions' && out && out.ok && Array.isArray(out.questions)) _qcSet(out.questions);
  if (_QC_WRITE_RE.test(action)) _qcClear();
  return out;
}
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
      if (network) throw new Error('서버에 연결하지 못했어요. 인터넷 연결과, Apps Script를 "새 버전으로 배포"했는지 확인해주세요.');
      if (e instanceof SyntaxError) throw new Error('서버가 이상한 응답을 줬어요(Apps Script에서 오류가 났을 수 있어요).');
      throw e;
    }
  }
}

function getTeacherPassword() {
  return sessionStorage.getItem('teacher_pw') || '';
}

function requireLogin() {
  if (!getTeacherPassword()) {
    location.href = 'teacher_login.html';
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
// 화면에 보여줄 모양: "35" → "3, 5", "1/2" → "1 또는 2", "-" → "주관식"
function fmtAnswer(a) {
  const n = normAnswer(a);
  if (n === '-') return '주관식';
  return n.split('/').map(function (x) { return x.split('').join(', '); }).join(' 또는 ');
}

// 화면에 글자를 넣을 때 <, & 같은 문자가 깨지지 않게 바꿔준다 (모든 화면이 쓰는 공용 함수라 여기 둔다)
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
function isBookQ(q) { return q && q.kind === '교재'; }
// "1단원" < "2단원" < "10단원", "4-1." < "4-2." 처럼 숫자를 숫자답게 정렬
function naturalCompare(a, b) { return String(a).localeCompare(String(b), 'ko', { numeric: true }); }

// PDF 파일 이름에서 학년·단원(·기출 여부)을 추정해 미리 채워준다. (틀릴 수 있어서 화면에서 고칠 수 있게 한다)
//  "[강남 3구 유형공략] 4-1.입자의 운동과 물질의 상태(02) 중1 과학 [25문제] [Q].pdf" → 중1 / 4-1. 입자의 운동과 물질의 상태
//  "중2_1단원_전범위_모의고사1_난이도_중.pdf" → 중2 / 1단원
//  "중등 과학(공통) 홍길동 중2 8단원 은하와 우주 2026 09 23" → 중2 / 8단원 은하와 우주
// 글자 속에서 학년을 찾는다 (중학교 과학 기준): "3학년", "제 3 학년", "(3학년)", "과학3", "중3" … ("2023학년도"의 3은 제외)
function gradeFromText(t) {
  t = String(t || '');
  let m = t.match(/(?<![\d가-힣])중\s*([123])(?!\s*학기|\d)/); if (m) return '중' + m[1];
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
    const sm = sc.match(/(^|\s)([가-힣]{2,6}(?:중학교|중))(?=\s|$)/);                     // 학교 이름은 맨 앞으로: "불암중 1학기 기말고사"
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
    (isPastExam(q) ? '<span class="tag-past">기출</span>' : '') + (isBookQ(q) ? '<span class="tag-book">내신교재</span>' : '') +
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
    const qs = r.questions.filter(q => { const s = String(q.source || '').trim(); const t = titles.has(s) ? s : (q.kind === '교재' && titles.has(s + '공략') ? s + '공략' : ''); return t && !keep.has(t); });
    return qs.length ? { ids: qs.map(q => q.id) } : null;
  } catch (e) { return null; }
}
// 시험지를 지울 때 묻는 것을 한 번에 묻는다: 제출 기록도 지울지, 문제은행의 문제도 지울지 (각각 체크로 고른다)
// 돌려주는 값: 취소면 null, 아니면 { scores: 제출 기록도 삭제?, bankDel: 문제은행 정리 함수 또는 null }
async function askDeleteExams(exams, allExams) {
  const list = (exams || []).filter(Boolean);
  const fb = await findBankDeletion(list, allExams);
  const subs = list.reduce((t, e) => t + (Number(e.submissionCount) || 0), 0), hasSubInfo = list.some(e => e.submissionCount !== undefined);
  return new Promise(resolve => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:10000; display:flex; align-items:center; justify-content:center; padding:16px;';
    const names = list.slice(0, 3).map(e => '· ' + escapeHtml(e.title)).join('<br>') + (list.length > 3 ? '<br>… 외 ' + (list.length - 3) + '개' : '');
    ov.innerHTML = '<div style="background:#fff; border-radius:14px; padding:18px 18px 14px; width:min(460px,100%); box-shadow:0 10px 40px rgba(0,0,0,.3); font-size:14px; line-height:1.55;">' +
      '<b style="font-size:16px;">시험지 ' + list.length + '개를 삭제할까요?</b><div style="margin:8px 0; color:#374151; font-size:13px;">' + names + '</div>' +
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
