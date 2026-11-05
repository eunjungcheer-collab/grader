/**
 * 자동채점 시스템 — Apps Script 백엔드
 *
 * 사용 방법:
 * 1. 새 Google Sheet를 만든다.
 * 2. 확장 프로그램 → Apps Script 를 연다.
 * 3. 이 파일 내용 전체를 복사해서 Code.gs에 붙여넣는다.
 * 4. 상단 실행 드롭다운에서 setup 함수를 한 번 실행한다 (시트 탭 자동 생성 + 초기 비밀번호 설정).
 *    처음 실행 시 권한 승인 창이 뜨면 허용한다.
 * 5. 배포 → 새 배포 → 유형: 웹 앱
 *    - 실행할 사용자: 나(본인)
 *    - 액세스 권한이 있는 사용자: 모든 사용자(익명 사용자 포함)
 *    - 배포를 누르면 웹 앱 URL이 나온다. 이 URL을 js/config.js의 API_URL에 붙여넣는다.
 * 6. 코드를 수정할 때마다 "새 배포"가 아니라 기존 배포에서 "배포 관리 → 수정 → 새 버전"으로
 *    업데이트해야 URL이 안 바뀐다.
 */

const SHEET_EXAMS = 'Exams';
const SHEET_SCORES = 'Scores';
const SHEET_QUESTIONS = 'Questions';
const SHEET_ROSTER = 'Rosters';          // 반 명단 (반 이름, 학생 이름 목록)
const SHEET_ASSIGN = 'Assignments';     // 시험 예약: 어느 학생이 언제까지 어떤 시험을 내야 하는지
const DRIVE_FOLDER_NAME = '자동채점_시험지PDF';
const BANK_FOLDER_NAME = '자동채점_문제은행이미지';

// ── 실행: 시트 탭과 기본 비밀번호를 만든다 (여러 번 실행해도 기존 데이터는 지워지지 않는다) ──
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, SHEET_EXAMS, ['id', 'title', 'answers', 'createdAt', 'pdfFileId', 'pdfUrl']);
  ensureSheet_(ss, SHEET_SCORES, ['examId', 'studentName', 'answers', 'score', 'total', 'submittedAt']);
  ensureSheet_(ss, SHEET_QUESTIONS, ['id', 'unit', 'answer', 'source', 'textPreview', 'createdAt', 'fileId']);

  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TEACHER_PASSWORD')) {
    props.setProperty('TEACHER_PASSWORD', 'changeme');  // 배포 후 반드시 앱에서 변경하세요
  }
  // 해설지용 열 머리글 (기존 시트에도 안전하게 추가)
  ss.getSheetByName(SHEET_QUESTIONS).getRange(1, 8).setValue('explFileId');
  ss.getSheetByName(SHEET_SCORES).getRange(1, 7).setValue('score100');
  ss.getSheetByName(SHEET_QUESTIONS).getRange(1, 9).setValue('difficulty');
  ss.getSheetByName(SHEET_QUESTIONS).getRange(1, 10).setValue('diffScore');
  ss.getSheetByName(SHEET_QUESTIONS).getRange(1, 11).setValue('numRect');
  ss.getSheetByName(SHEET_QUESTIONS).getRange(1, 12).setValue('explNumRect');
  ss.getSheetByName(SHEET_QUESTIONS).getRange(1, 13).setValue('grade');    // 학년 (중1, 중2 …)
  ss.getSheetByName(SHEET_QUESTIONS).getRange(1, 14).setValue('kind');     // 구분 (일반 / 기출)
  ss.getSheetByName(SHEET_QUESTIONS).getRange(1, 15).setValue('school');   // 기출문제의 학교·시험 이름
  ss.getSheetByName(SHEET_QUESTIONS).getRange(1, 16).setValue('year');     // 기출문제 출제년도
  ss.getSheetByName(SHEET_EXAMS).getRange(1, 7).setValue('explUrl');
  ss.getSheetByName(SHEET_EXAMS).getRange(1, 8).setValue('sourceQuestionIds');
  ss.getSheetByName(SHEET_EXAMS).getRange(1, 9).setValue('composeRecipe');
  ss.getSheetByName(SHEET_EXAMS).getRange(1, 10).setValue('questionTexts');
  assignSheet_();
  Logger.log('설정 완료. (이미 있던 데이터는 그대로 유지돼요)');
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.appendRow(headers);
  return sh;
}

function getBankFolder_() {
  const it = DriveApp.getFoldersByName(BANK_FOLDER_NAME);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(BANK_FOLDER_NAME);
}

function getOrCreateFolder_() {
  const it = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
  if (it.hasNext()) return it.next();
  return DriveApp.createFolder(DRIVE_FOLDER_NAME);
}

function checkPassword_(pw) {
  const stored = PropertiesService.getScriptProperties().getProperty('TEACHER_PASSWORD');
  return pw === stored;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  return handle_(e);
}
function doPost(e) {
  return handle_(e);
}

function handle_(e) {
  try {
    let params = {};
    if (e.postData && e.postData.contents) {
      params = JSON.parse(e.postData.contents);
    } else {
      params = e.parameter;
    }
    const action = params.action;
    let result;
    if (!/^(list|get|stu(Status|Home|Weak|Wrong|Login|PushInfo)|weakReport|reviewReport|noticeRoster|bankUnitMap|stats|retryLog|teacherPushInfo|suggestName|homeBadges|login)/.test(String(action))) bustCache_();
    switch (action) {
      case 'login': result = actionLogin_(params); break;
      case 'backupNow': result = actionBackupNow_(params); break;
      case 'listHistory': result = actionListHistory_(params); break;
      case 'startNewTerm': result = actionStartNewTerm_(params); break;
      case 'changePassword': result = actionChangePassword_(params); break;
      case 'createExam': result = actionCreateExam_(params); break;
      case 'listExams': result = actionListExams_(params); break;
      case 'getExamPublic': result = actionGetExamPublic_(params); break;
      case 'getBookPublic': result = actionGetBookPublic_(params); break;
      case 'getExamDetail': result = actionGetExamDetail_(params); break;
      case 'submitAnswer': result = actionSubmitAnswer_(params); break;
      case 'listSubmissions': result = actionListSubmissions_(params); break;
      case 'deleteSubmission': result = actionDeleteSubmission_(params); break;
      case 'updateSubmissionScore': result = actionUpdateSubmissionScore_(params); break;
      case 'attachExplanation': result = actionAttachExplanation_(params); break;
      case 'saveQuestions': result = actionSaveQuestions_(params); break;
      case 'listQuestions': result = actionListQuestions_(params); break;
      case 'listTaxonomy': result = actionListTaxonomy_(params); break;
      case 'updateQuestion': result = actionUpdateQuestion_(params); break;
      case 'getToc': result = actionGetToc_(params); break;
      case 'setToc': result = actionSetToc_(params); break;
      case 'getPresets': result = actionGetPresets_(params); break;
      case 'setPresets': result = actionSetPresets_(params); break;
      case 'updateQuestions': result = actionUpdateQuestions_(params); break;
      case 'deleteQuestions': result = actionDeleteQuestions_(params); break;
      case 'updateExamAnswers': result = actionUpdateExamAnswers_(params); break;
      case 'deleteExam': result = actionDeleteExam_(params); break;
      case 'deleteExams': result = actionDeleteExams_(params); break;
      case 'getExamPdf': result = actionGetExamPdf_(params); break;
      case 'deleteQuestion': result = actionDeleteQuestion_(params); break;
      case 'getQuestionImages': result = actionGetQuestionImages_(params); break;
      case 'getRosters': result = actionGetRosters_(params); break;
      case 'noticeRoster': result = actionNoticeRoster_(params); break;
      case 'setRosters': result = actionSetRosters_(params); break;
      case 'getDeadline': result = actionGetDeadline_(params); break;
      case 'createAssignments': result = actionCreateAssignments_(params); break;
      case 'listAssignments': result = actionListAssignments_(params); break;
      case 'deleteAssignment': result = actionDeleteAssignment_(params); break;
      case 'getAlertSettings': result = actionGetAlertSettings_(params); break;
      case 'setAlertSettings': result = actionSetAlertSettings_(params); break;
      case 'listAlerts': result = actionListAlerts_(params); break;
      case 'installAlertTrigger': result = actionInstallAlertTrigger_(params); break;
      case 'resendMissMail': result = actionResendMissMail_(params); break;
      case 'stuStatus': result = actionStuStatus_(params); break;
      case 'stuRegister': result = actionStuRegister_(params); break;
      case 'stuLogin': result = actionStuLogin_(params); break;
      case 'stuHome': result = actionStuHome_(params); break;
      case 'stuWrong': result = actionStuWrong_(params); break;
      case 'resetStudentPin': result = actionResetStudentPin_(params); break;
      case 'stuSaveToken': result = actionStuSaveToken_(params); break;
      case 'stuPushInfo': result = actionStuPushInfo_(params); break;
      case 'setPushConfig': result = actionSetPushConfig_(params); break;
      case 'approveStudent': result = actionApproveStudent_(params); break;
      case 'installBackup': result = actionInstallBackup_(params); break;
      case 'retryCheck': result = actionRetryCheck_(params); break;
      case 'retryLog': result = actionRetryLog_(params); break;
      case 'weakReport': result = actionWeakReport_(params); break;
      case 'teacherPushInfo': result = actionTeacherPushInfo_(params); break;
      case 'teacherSaveToken': result = actionTeacherSaveToken_(params); break;
      case 'stuWeak': result = actionStuWeak_(params); break;
      case 'stuClear': result = actionStuClear_(params); break;
      case 'reviewReport': result = actionReviewReport_(params); break;
      case 'homeBadges': result = actionHomeBadges_(params); break;
      case 'bankUnitMap': result = actionBankUnitMap_(params); break;
      case 'suggestName': result = actionSuggestName_(params); break;
      case 'setStuOptions': result = actionSetStuOptions_(params); break;
      case 'statsOverview': result = actionStatsOverview_(params); break;
      case 'statsExam': result = actionStatsExam_(params); break;
      case 'listStudents': result = actionListStudents_(params); break;
      default: result = { ok: false, error: 'unknown action' };
    }
    return json_(result);
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function actionLogin_(p) {
  return { ok: checkPassword_(p.password) };
}

function actionChangePassword_(p) {
  if (!checkPassword_(p.oldPassword)) return { ok: false, error: '기존 비밀번호가 틀렸어요.' };
  PropertiesService.getScriptProperties().setProperty('TEACHER_PASSWORD', p.newPassword);
  return { ok: true };
}

function actionCreateExam_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  let fileId = '', pdfUrl = '';
  if (p.pdfBase64) {
    const folder = getOrCreateFolder_();
    const bytes = Utilities.base64Decode(p.pdfBase64);
    const blob = Utilities.newBlob(bytes, 'application/pdf', (p.filename || 'exam') + '.pdf');
    const file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    fileId = file.getId();
    pdfUrl = 'https://drive.google.com/uc?export=download&id=' + fileId;
  }
  const answersCell = (p.answers || []).map(normAns_).join(',');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_EXAMS);
  sheet.appendRow([p.id, p.title, answersCell, new Date().toISOString(), fileId, pdfUrl, '',
    p.sourceQuestionIds ? JSON.stringify(p.sourceQuestionIds) : '',
    p.composeRecipe ? JSON.stringify(p.composeRecipe) : '',
    p.questionTexts ? JSON.stringify(p.questionTexts) : '']);
  return { ok: true, id: p.id, pdfUrl: pdfUrl };
}

// 시험의 정답 배열 (주관식 문항은 '-'로 표시되어 있고, 자동 채점에서 빠진다)
// 시트 칸에 남은 값이 JSON이 아니어도(예전 버전 흔적 등) 죽지 않고 안전하게 읽는다
function safeJson_(v, fallback) {
  if (!v) return fallback;
  try { return JSON.parse(v); } catch (e) { return fallback; }
}

function examAnswers_(row) {
  return String(row[2]).split(',').filter(String);
}
function isSubjective_(a) { return String(a) === '-'; }
// 정답 문자열을 정리한다: "3,5"·"③⑤"·"53" → "35" (1~9 숫자만, 중복 제거, 오름차순). 주관식은 '-' 그대로.
// 정답이 여러 개인 문항(예: 3번과 5번을 모두 골라야 정답)은 이렇게 숫자를 이어붙인 "35"로 저장한다.
function normAns_(a) {
  let s = String(a === undefined || a === null ? '' : a).trim();
  if (s === '-') return '-';
  s = s.replace(/[①-⑨]/g, function (c) { return String(c.charCodeAt(0) - 0x2460 + 1); });
  // "1/2" = 1번 또는 2번 중 하나만 맞아도 정답(OR)
  const seenP = {}, uniq = [];
  s.split('/').forEach(function (part) {
    const ds = part.match(/[1-9]/g) || [];
    const seen = {}, out = [];
    ds.forEach(function (d) { if (!seen[d]) { seen[d] = 1; out.push(d); } });
    const x = out.sort().join('');
    if (x && !seenP[x]) { seenP[x] = 1; uniq.push(x); }
  });
  return uniq.sort().join('/');
}
// 학생 답이 정답과 맞는지 (정답이 "1/2"면 둘 중 하나만 같아도 맞음)
function ansMatches_(student, correct) {
  const c = normAns_(correct);
  if (student === undefined || student === '' || !c || c === '-') return false;
  return c.split('/').indexOf(normAns_(student)) >= 0;
}
// 학년·구분·학교 글자 정리 (앞뒤 공백 제거, 너무 길면 자름). 구분은 "기출" 아니면 모두 "일반".
function cleanText_(v, max) { return String(v === undefined || v === null ? '' : v).trim().slice(0, max || 120); }
// 출제년도: 숫자 4자리(2000~2099)만 받는다. 아니면 빈 값
function normYear_(v) { const m = String(v === undefined || v === null ? '' : v).match(/20\d\d/); return m ? m[0] : ''; }
function numOrBlank_(v) { const n = parseInt(v, 10); return n > 0 ? n : ''; }
function normKind_(v) { v = String(v || ''); return v.indexOf('교재') >= 0 ? '교재' : (v.indexOf('기출') >= 0 ? '기출' : '일반'); }

// 정답이 2개 이상인(복수정답) 문항 번호 (1부터)
function multiNumbers_(answers) {
  const out = [];
  answers.forEach(function (a, i) { if (!isSubjective_(a) && String(a).length > 1) out.push(i + 1); });
  return out;
}
// 객관식 정답 비율을 100점 만점으로 환산 (예: 25문항 중 22개 → 88점). 객관식이 없으면 0
function score100_(score, total) { return total > 0 ? Math.round(score / total * 100) : 0; }

function subjectiveNumbers_(answers) {
  const out = [];
  answers.forEach(function (a, i) { if (isSubjective_(a)) out.push(i + 1); });
  return out;
}

function findExamRow_(sheet, examId) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(examId)) return { rowIndex: i + 1, row: data[i] };
  }
  return null;
}

const CACHE_KEYS_ = ['c_listExams', 'c_weak_count'];
function bustCache_() { try { const c = CacheService.getScriptCache(); c.removeAll(CACHE_KEYS_); c.put('dver', String(Date.now()) + Math.floor(Math.random() * 1000), 21600); } catch (e) {} }
// 데이터가 바뀔 때마다 번호가 바뀌는 버전. 이 번호를 키에 넣어 두면, 쓰기가 있는 순간 옛 캐시는 저절로 안 쓰인다
function dataVer_() { try { const c = CacheService.getScriptCache(); let v = c.get('dver'); if (!v) { v = String(Date.now()); c.put('dver', v, 21600); } return v; } catch (e) { return '0'; } }
// 100KB 가 넘는 결과는 조각으로 나눠 저장한다
function bigPut_(key, obj, ttl) {
  try {
    const t = JSON.stringify(obj), size = 90000, n = Math.ceil(t.length / size); if (n > 40) return;
    const c = CacheService.getScriptCache(), m = {}; m[key + '#n'] = String(n);
    for (let i = 0; i < n; i++) m[key + '#' + i] = t.substr(i * size, size);
    c.putAll(m, ttl);
  } catch (e) {}
}
function bigGet_(key) {
  try {
    const c = CacheService.getScriptCache(), n = Number(c.get(key + '#n') || 0); if (!n) return null;
    const ks = []; for (let i = 0; i < n; i++) ks.push(key + '#' + i);
    const m = c.getAll(ks); let t = ''; for (let i = 0; i < n; i++) { const part = m[key + '#' + i]; if (part === undefined || part === null) return null; t += part; }
    return JSON.parse(t);
  } catch (e) { return null; }
}
function cachePut_(k, obj, ttl) { try { const t = JSON.stringify(obj); if (t.length < 90000) CacheService.getScriptCache().put(k, t, ttl); } catch (e) {} }
function cacheGet_(k) { try { const t = CacheService.getScriptCache().get(k); return t ? JSON.parse(t) : null; } catch (e) { return null; } }
function actionListExams_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const hit = cacheGet_('c_listExams'); if (hit) return hit;
  const out = listExamsBuild_(); cachePut_('c_listExams', out, 120); return out;
}
function listExamsBuild_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const examsData = ss.getSheetByName(SHEET_EXAMS).getDataRange().getValues();
  const scoresSheet = ss.getSheetByName(SHEET_SCORES), sLast = scoresSheet.getLastRow();

  const countByExam = {};      // 제출 수만 필요해서 시험 ID 열만 읽는다 (답안 열까지 전부 읽으면 기록이 쌓일수록 느려져요)
  if (sLast >= 2) scoresSheet.getRange(2, 1, sLast - 1, 1).getValues().forEach(function (r) {
    const eid = String(r[0]); countByExam[eid] = (countByExam[eid] || 0) + 1;
  });

  const exams = [];
  for (let i = 1; i < examsData.length; i++) {
    const row = examsData[i];
    const ans = examAnswers_(row);
    const rc = row[8] ? safeJson_(row[8], null) : null;      // 조합 기록(JSON)은 한 번만 해석한다
    exams.push({
      id: row[0], title: row[1],
      answerCount: ans.length,
      subjectiveCount: subjectiveNumbers_(ans).length,
      createdAt: row[3], pdfUrl: row[5],
      hasRecipe: !!row[8] && !(rc && rc.book),
      bookTitle: (rc && rc.bookTitle) || '',
      submissionCount: countByExam[String(row[0])] || 0,
    });
  }
  exams.reverse();  // 최신 순
  return { ok: true, exams: exams };
}

function actionGetExamPublic_(p) {
  // 학생용: 정답은 절대 내려주지 않고, 문항 수만 알려준다.
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const found = findExamRow_(ss.getSheetByName(SHEET_EXAMS), p.id);
  if (!found) return { ok: false, error: '존재하지 않는 시험이에요.' };
  const answers = examAnswers_(found.row);
  const rc = safeJson_(found.row[8], null);
  return { ok: true, title: found.row[1], answerCount: answers.length, subjective: subjectiveNumbers_(answers), multi: multiNumbers_(answers), book: (rc && rc.book) ? String(rc.book) : '' };
}

// 교재 한 권(여러 단원 시험)의 단원 목록: 학생이 한 화면에서 여러 단원을 골라 한꺼번에 채점할 수 있게 한다. 정답은 내려주지 않는다.
function actionGetBookPublic_(p) {
  const data = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_EXAMS).getDataRange().getValues();
  const exams = []; let bookTitle = '';
  for (let i = 1; i < data.length; i++) {
    const rc = safeJson_(data[i][8], null);
    if (!rc || !rc.book || String(rc.book) !== String(p.book)) continue;
    bookTitle = rc.bookTitle || bookTitle;
    exams.push({ id: data[i][0], title: data[i][1], label: rc.label || data[i][1], unit: rc.unit || '', unitName: rc.unitName || '', tag: rc.tag || '', order: Number(rc.order) || i, count: examAnswers_(data[i]).length });
  }
  if (!exams.length) return { ok: false, error: '이 교재의 단원 정보를 찾지 못했어요.' };
  exams.sort(function (a, b) { return a.order - b.order; });
  return { ok: true, bookTitle: bookTitle, exams: exams };
}

function actionGetExamDetail_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const found = findExamRow_(ss.getSheetByName(SHEET_EXAMS), p.id);
  if (!found) return { ok: false, error: '존재하지 않는 시험이에요.' };

  const scoresData = ss.getSheetByName(SHEET_SCORES).getDataRange().getValues();
  const submissions = [];
  for (let i = 1; i < scoresData.length; i++) {
    if (String(scoresData[i][0]) === String(p.id)) {
      submissions.push({
        studentName: scoresData[i][1], answers: scoresData[i][2],
        score: scoresData[i][3], total: scoresData[i][4], submittedAt: scoresData[i][5],
        score100: (scoresData[i][6] === '' || scoresData[i][6] === undefined) ? (Number(scoresData[i][4]) ? Math.round(Number(scoresData[i][3]) / Number(scoresData[i][4]) * 100) : 0) : Number(scoresData[i][6]),
      });
    }
  }
  submissions.reverse();

  return {
    ok: true, id: found.row[0], title: found.row[1],
    answers: examAnswers_(found.row),
    createdAt: found.row[3], pdfUrl: found.row[5], explUrl: found.row[6] || '',
    sourceQuestionIds: safeJson_(found.row[7], []),
    composeRecipe: safeJson_(found.row[8], null),
    questionTexts: safeJson_(found.row[9], []),
    submissions: submissions,
  };
}

function actionSubmitAnswer_(p) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const found = findExamRow_(ss.getSheetByName(SHEET_EXAMS), p.id);
  if (!found) return { ok: false, error: '존재하지 않는 시험이에요.' };

  const correctAnswers = examAnswers_(found.row);
  // 학생이 「안 푸는 문항」으로 뺀 번호는 답 대신 '~'로 온다 → 채점·문항 수에서 뺀다
  const studentAnswers = (p.answers || []).map(function (a) { return String(a === undefined || a === null ? '' : a).trim() === '~' ? '~' : normAns_(a); });   // 복수정답은 "35"처럼 정리해서 비교
  let score = 0, objective = 0;
  const skipped = [], results = [];      // results: 문항별 'subj'(주관식)·'skip'(안 푼 문항)·'ok'(맞음)·'x'(틀림) — 정답 자체는 학생에게 보내지 않는다
  for (let i = 0; i < correctAnswers.length; i++) {
    if (isSubjective_(correctAnswers[i])) { results.push('subj'); continue; }      // 주관식은 자동 채점에서 뺀다
    if (studentAnswers[i] === '~') { skipped.push(i + 1); results.push('skip'); continue; }
    objective++;
    if (ansMatches_(studentAnswers[i], correctAnswers[i])) { score++; results.push('ok'); } else results.push('x');
  }

  // 100점 만점 환산 (객관식만 채점, 주관식은 합산하지 않음)
  const score100 = objective ? Math.round(score / objective * 100) : 0;

  const scoresSheet = ss.getSheetByName(SHEET_SCORES);
  scoresSheet.appendRow([
    p.id, p.studentName || '이름없음', studentAnswers.join(','),
    score, objective, new Date().toISOString(), score100,
  ]);
  try { afterSubmit_(ss, found, p, score, objective, score100); } catch (e) {}      // 알림 때문에 제출이 실패하면 안 된다

  return {
    ok: true, score: score, total: objective, score100: score100, subjective: subjectiveNumbers_(correctAnswers), skipped: skipped,
    results: results, studentAnswers: studentAnswers,
  };
}


// ────────────── 문제은행 ──────────────
function questionsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ensureSheet_(ss, SHEET_QUESTIONS, ['id', 'unit', 'answer', 'source', 'textPreview', 'createdAt', 'fileId']);
  if (sh.getMaxColumns() < 20) sh.insertColumnsAfter(sh.getMaxColumns(), 20 - sh.getMaxColumns());   // 20열(year·num·head·sub·auto)까지 보장
  if (!sh.getRange(1, 16).getValue()) sh.getRange(1, 16).setValue('year');
  if (!sh.getRange(1, 17).getValue()) sh.getRange(1, 17).setValue('num');      // 원래 시험지에서의 문항 번호
  if (!sh.getRange(1, 18).getValue()) sh.getRange(1, 18).setValue('head');     // 연관 문제의 대표(첫) 문항 번호 (없으면 빈칸)
  if (!sh.getRange(1, 19).getValue()) sh.getRange(1, 19).setValue('sub');      // 소단원 이름 (없으면 빈칸 = 대단원 전체)
  if (!sh.getRange(1, 20).getValue()) sh.getRange(1, 20).setValue('auto');     // 소단원을 자동 추정으로 채웠으면 1 (사람이 고치면 빈칸)
  return sh;
}

// 저장 속도: 파일마다 setSharing을 부르면 파일당 1~2초가 더 걸린다.
// 폴더 전체를 "링크가 있는 누구나 보기"로 한 번만 열어 두면 안에 만든 파일은 그 권한을 이어받으므로, 파일별 공유 설정을 건너뛴다.
// (첫 파일이 실제로 이어받았는지 확인해서, 아니면 예전처럼 파일마다 설정한다)
function makeBankFile_(folder, blob, state) {
  const file = folder.createFile(blob);
  if (state.inherit === undefined) {
    let ok = false;
    try { ok = file.getSharingAccess() === DriveApp.Access.ANYONE_WITH_LINK; } catch (e) {}
    state.inherit = ok;
  }
  if (!state.inherit) file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file;
}

// 한 번만 실행하세요: 위쪽 함수 선택 칸에서 authorizeFetch를 고르고 ▶ 실행 → "권한 검토"에서 허용.
// (그림을 드라이브에 빠르게 올리는 방식은 "외부 서비스에 연결" 권한이 있어야 쓸 수 있어요)
function authorizeFetch() {
  const r = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/about?fields=user', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  Logger.log('응답 코드: ' + r.getResponseCode() + ' (200이면 빠른 방식을 쓸 수 있어요. 403이면 아래 내용을 보내 주세요)\n' + r.getContentText().slice(0, 300));
}

// 그림 파일 여러 개를 드라이브에 동시에 올린다 (UrlFetchApp.fetchAll). 드라이브 API를 쓸 수 없거나 일부가 실패하면 그 파일만 예전 방식(DriveApp)으로 올린다.
function uploadBankFiles_(folder, jobs, state) {
  const ids = new Array(jobs.length);
  const cache = CacheService.getScriptCache();
  let restOk = !cache.get('noDriveRest');
  if (restOk && jobs.length) {
    try {
      const token = ScriptApp.getOAuthToken(), fid = folder.getId();
      const reqs = jobs.map(function (j) {
        const B = 'bnd' + Utilities.getUuid().replace(/-/g, '');
        const body = '--' + B + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify({ name: j.name, parents: [fid], mimeType: 'image/png' }) +
          '\r\n--' + B + '\r\nContent-Type: image/png\r\nContent-Transfer-Encoding: base64\r\n\r\n' + j.b64 + '\r\n--' + B + '--';
        return { url: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id', method: 'post', contentType: 'multipart/related; boundary=' + B,
          payload: body, headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true };
      });
      const resps = UrlFetchApp.fetchAll(reqs);
      let denied = 0;
      state.rest = state.rest || { fast: 0, slow: 0, code: '', msg: '' };
      resps.forEach(function (r, k) {
        if (r.getResponseCode() === 200) { try { ids[k] = JSON.parse(r.getContentText()).id; state.rest.fast++; } catch (e) {} }
        else { state.rest.code = String(r.getResponseCode()); if (!state.rest.msg) state.rest.msg = r.getContentText().replace(/\s+/g, ' ').slice(0, 160); if (r.getResponseCode() === 401 || r.getResponseCode() === 403) denied++; }
      });
      if (denied === resps.length) cache.put('noDriveRest', '1', 600);      // 드라이브 API를 못 쓰는 설정이면 한동안 시도하지 않는다
      // 폴더 공유를 이어받았는지 한 번만 확인 (아니면 파일마다 공유 설정)
      const first = ids.filter(function (x) { return x; })[0];
      if (first && state.inherit === undefined) {
        let ok = false;
        try { ok = DriveApp.getFileById(first).getSharingAccess() === DriveApp.Access.ANYONE_WITH_LINK; } catch (e) {}
        state.inherit = ok;
      }
      if (first && !state.inherit) ids.forEach(function (id) { if (id) { try { DriveApp.getFileById(id).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {} } });
    } catch (e) { state.rest = state.rest || { fast: 0, slow: 0, code: '', msg: '' }; state.rest.code = 'error'; state.rest.msg = String(e && e.message || e).slice(0, 160); /* 아래에서 실패한 것을 예전 방식으로 올린다 */ }
  }
  state.rest = state.rest || { fast: 0, slow: 0, code: '', msg: '' };
  if (!restOk && !state.rest.code) state.rest.code = 'skip';       // 최근에 막혀서 빠른 방식을 건너뛰었다
  jobs.forEach(function (j, k) {
    if (ids[k]) return;
    state.rest.slow++;
    const blob = Utilities.newBlob(Utilities.base64Decode(j.b64), 'image/png', j.name);
    ids[k] = makeBankFile_(folder, blob, state).getId();
  });
  return ids;
}

function actionSaveQuestions_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const folder = getBankFolder_();
  try {
    if (folder.getSharingAccess() !== DriveApp.Access.ANYONE_WITH_LINK) folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {}
  const state = {};
  const sheet = questionsSheet_();
  const rows = [];
  const qs = p.questions || [];
  // 저장 속도: 문항 그림(과 해설 그림)을 한 번에 모아서 드라이브에 동시에 올린다 (하나씩 올리면 파일당 1~3초씩 걸린다)
  const jobs = [];
  qs.forEach(function (q, i) {
    jobs.push({ qi: i, kind: 'q', name: q.id + '.png', b64: q.imageBase64 });
    if (q.explBase64) jobs.push({ qi: i, kind: 'e', name: q.id + '_expl.png', b64: q.explBase64 });
  });
  const T0 = Date.now();
  const ids = uploadBankFiles_(folder, jobs, state);
  const msUp = Date.now() - T0;
  qs.forEach(function (q, i) {
    let fileId = '', explId = '';
    jobs.forEach(function (j, k) { if (j.qi === i) { if (j.kind === 'q') fileId = ids[k]; else explId = ids[k]; } });
    rows.push([q.id, q.unit, normAns_(q.answer), q.source || '', q.textPreview || '', new Date().toISOString(), fileId, explId, q.difficulty || '', (q.diffScore === undefined || q.diffScore === null) ? '' : q.diffScore,
      q.numRect ? JSON.stringify(q.numRect) : '', q.explNumRect ? JSON.stringify(q.explNumRect) : '',
      cleanText_(q.grade, 20), normKind_(q.kind), cleanText_(q.school, 80), normYear_(q.year), numOrBlank_(q.num), numOrBlank_(q.head), cleanText_(q.sub, 80), q.auto ? (Number(q.auto) || 1) : '']);
  });
  let msLock = 0, msSheet = 0;
  if (rows.length) {
    // 여러 저장 요청이 동시에 와도 행이 겹쳐 쓰이지 않게, 시트에 쓰는 순간만 잠근다
    const lock = LockService.getScriptLock();
    const L0 = Date.now();
    lock.waitLock(30000);
    msLock = Date.now() - L0;
    const S0 = Date.now();
    try { sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 20).setValues(rows); }
    finally { lock.releaseLock(); }
    msSheet = Date.now() - S0;
  }
  // 걸린 시간(밀리초)을 같이 돌려준다: 드라이브에 그림 올리기 / 시트 쓰기 차례 기다리기 / 시트 쓰기 — 어디서 느린지 화면의 ⏱ 표에서 볼 수 있게
  return { ok: true, saved: rows.length, ms: { up: msUp, lock: msLock, sheet: msSheet, total: Date.now() - T0, files: jobs.length, fast: (state.rest && state.rest.fast) || 0, slow: (state.rest && state.rest.slow) || 0, code: (state.rest && state.rest.code) || '', msg: (state.rest && state.rest.msg) || '' } };
}

// 시트에 JSON 문자열로 저장한 [x0,top,x1,bottom]을 배열로 읽는다 (없거나 깨졌으면 null)
function parseRect_(v) {
  if (!v) return null;
  try { const a = JSON.parse(v); return (Array.isArray(a) && a.length === 4 && a.every(function (n) { return isFinite(n); })) ? a : null; } catch (e) { return null; }
}

function actionListQuestions_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const ck = 'lq_' + dataVer_(), hit = bigGet_(ck); if (hit) return hit;
  const out = listQuestionsBuild_(); bigPut_(ck, out, 600); return out;
}
function listQuestionsBuild_() {
  const data = questionsSheet_().getDataRange().getValues();
  const questions = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    questions.push({ id: r[0], unit: r[1], answer: String(r[2]), source: r[3], textPreview: r[4], createdAt: r[5], fileId: r[6], explFileId: r[7] || '', difficulty: r[8] || '', diffScore: (r[9] === '' || r[9] === undefined) ? null : Number(r[9]),
      numRect: parseRect_(r[10]), explNumRect: parseRect_(r[11]),
      grade: String(r[12] || ''), kind: normKind_(r[13]), school: String(r[14] || ''), year: normYear_(r[15]), num: Number(r[16]) || 0, head: Number(r[17]) || 0, sub: String(r[18] || ''), auto: Number(r[19]) || 0 });
  }
  return { ok: true, questions: questions };
}

function findQuestionRow_(sheet, id) {
  const ids = sheet.getRange(1, 1, Math.max(1, sheet.getLastRow()), 1).getValues();
  for (let i = 1; i < ids.length; i++) if (String(ids[i][0]) === String(id)) return i + 1;
  return -1;
}

function actionUpdateQuestion_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const sheet = questionsSheet_();
  const row = findQuestionRow_(sheet, p.id);
  if (row < 0) return { ok: false, error: '문항을 찾을 수 없어요.' };
  if (p.unit !== undefined) sheet.getRange(row, 2).setValue(p.unit);
  if (p.answer !== undefined) sheet.getRange(row, 3).setValue(normAns_(p.answer));
  if (p.difficulty !== undefined) sheet.getRange(row, 9).setValue(String(p.difficulty));
  if (p.grade !== undefined) sheet.getRange(row, 13).setValue(cleanText_(p.grade, 20));
  if (p.kind !== undefined) sheet.getRange(row, 14).setValue(normKind_(p.kind));
  if (p.school !== undefined) sheet.getRange(row, 15).setValue(cleanText_(p.school, 80));
  if (p.sub !== undefined) sheet.getRange(row, 19).setValue(cleanText_(p.sub, 80));
  if (p.auto !== undefined) sheet.getRange(row, 20).setValue(Number(p.auto) || '');
  if (p.year !== undefined) sheet.getRange(row, 16).setValue(normYear_(p.year));
  return { ok: true };
}

function actionDeleteQuestion_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const sheet = questionsSheet_();
  const row = findQuestionRow_(sheet, p.id);
  if (row < 0) return { ok: true };
  const fileId = sheet.getRange(row, 7).getValue();
  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {}
  const explId = sheet.getRange(row, 8).getValue();
  if (explId) { try { DriveApp.getFileById(explId).setTrashed(true); } catch (e) {} }
  sheet.deleteRow(row);
  return { ok: true };
}

function actionGetQuestionImages_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const images = (p.fileIds || []).map(function (fid) {
    const blob = DriveApp.getFileById(fid).getBlob();
    return { fileId: fid, base64: Utilities.base64Encode(blob.getBytes()) };
  });
  return { ok: true, images: images };
}


// 시험에 해설지 PDF를 붙인다 (시험 등록 직후 호출)
function actionAttachExplanation_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_EXAMS);
  const found = findExamRow_(sheet, p.id);
  if (!found) return { ok: false, error: '존재하지 않는 시험이에요.' };
  const blob = Utilities.newBlob(Utilities.base64Decode(p.explBase64), 'application/pdf', (p.filename || 'exam') + '_해설.pdf');
  const file = getOrCreateFolder_().createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const url = 'https://drive.google.com/file/d/' + file.getId() + '/view';
  sheet.getRange(found.rowIndex, 7).setValue(url);
  return { ok: true, explUrl: url };
}


// 여러 문항의 단원·정답·난이도를 한 번에 바꾼다.
// 문항 수와 상관없이 시트 접근은 "읽기 1번 + 쓰기 최대 2번"이라 빠르다.
// updates: [{id, unit?, answer?, difficulty?}, ...]
// 문항 수가 아무리 많아도(수백~수천), 이 함수의 속도는 "이번에 바뀐 문항 수"에만 좌우되게 만든다.
// 예전에는 정답 하나만 고쳐도 전체 시트를 통째로 다시 썼는데, 그러면 문항이 많아질수록 느려졌다.
function actionUpdateQuestions_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const updates = p.updates || [];
  if (!updates.length) return { ok: true, updated: 0 };
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = questionsSheet_();
    const last = sheet.getLastRow();
    if (last < 2) return { ok: true, updated: 0 };
    // id는 A열 하나만 읽어서 각 id가 몇 번째 행인지만 파악한다 (전체 9열을 읽지 않음)
    const ids = sheet.getRange(2, 1, last - 1, 1).getValues();
    const rowOf = {};
    for (let i = 0; i < ids.length; i++) rowOf[String(ids[i][0])] = i + 2;

    const BULK_THRESHOLD = 30;  // 자동분류처럼 한 번에 많이 바뀔 때만 "전체 다시 쓰기" 방식을 쓴다
    let n = 0;
    if (updates.length > BULK_THRESHOLD) {
      const data = sheet.getRange(2, 1, last - 1, 9).getValues();
      const idxOf = {};
      for (let i = 0; i < data.length; i++) idxOf[String(data[i][0])] = i;
      let ua = false, df = false;
      updates.forEach(function (u) {
        const i = idxOf[String(u.id)];
        if (i === undefined) return;
        if (u.unit !== undefined) { data[i][1] = String(u.unit); ua = true; }
        if (u.answer !== undefined) { data[i][2] = normAns_(u.answer); ua = true; }
        if (u.difficulty !== undefined) { data[i][8] = String(u.difficulty); df = true; }
        n++;
      });
      if (ua) sheet.getRange(2, 2, data.length, 2).setValues(data.map(function (r) { return [r[1], r[2]]; }));
      if (df) sheet.getRange(2, 9, data.length, 1).setValues(data.map(function (r) { return [r[8]]; }));
      // 학년·구분·학교(13~15열)는 따로 읽고 따로 쓴다
      if (updates.some(function (u) { return u.grade !== undefined || u.kind !== undefined || u.school !== undefined || u.year !== undefined; })) {
        const meta = sheet.getRange(2, 13, last - 1, 4).getValues();
        updates.forEach(function (u) {
          const i = idxOf[String(u.id)];
          if (i === undefined) return;
          if (u.grade !== undefined) meta[i][0] = cleanText_(u.grade, 20);
          if (u.kind !== undefined) meta[i][1] = normKind_(u.kind);
          if (u.school !== undefined) meta[i][2] = cleanText_(u.school, 80);
          if (u.year !== undefined) meta[i][3] = normYear_(u.year);
        });
        sheet.getRange(2, 13, last - 1, 4).setValues(meta);
      }
      if (updates.some(function (u) { return u.sub !== undefined; })) {
        const subs = sheet.getRange(2, 19, last - 1, 1).getValues();
        updates.forEach(function (u) { const i = idxOf[String(u.id)]; if (i !== undefined && u.sub !== undefined) subs[i][0] = cleanText_(u.sub, 80); });
        sheet.getRange(2, 19, last - 1, 1).setValues(subs);
      }
      if (updates.some(function (u) { return u.auto !== undefined; })) {
        const au = sheet.getRange(2, 20, last - 1, 1).getValues();
        updates.forEach(function (u) { const i = idxOf[String(u.id)]; if (i !== undefined && u.auto !== undefined) au[i][0] = Number(u.auto) || ''; });
        sheet.getRange(2, 20, last - 1, 1).setValues(au);
      }
    } else {
      // 바뀐 행만 콕 집어서 쓴다 → 문제은행 전체 크기와 상관없이 항상 빠르다
      updates.forEach(function (u) {
        const row = rowOf[String(u.id)];
        if (!row) return;
        if (u.unit !== undefined) sheet.getRange(row, 2).setValue(String(u.unit));
        if (u.answer !== undefined) sheet.getRange(row, 3).setValue(normAns_(u.answer));
        if (u.difficulty !== undefined) sheet.getRange(row, 9).setValue(String(u.difficulty));
        if (u.grade !== undefined) sheet.getRange(row, 13).setValue(cleanText_(u.grade, 20));
        if (u.kind !== undefined) sheet.getRange(row, 14).setValue(normKind_(u.kind));
        if (u.school !== undefined) sheet.getRange(row, 15).setValue(cleanText_(u.school, 80));
        if (u.year !== undefined) sheet.getRange(row, 16).setValue(normYear_(u.year));
        if (u.sub !== undefined) sheet.getRange(row, 19).setValue(cleanText_(u.sub, 80));
        if (u.auto !== undefined) sheet.getRange(row, 20).setValue(Number(u.auto) || '');
        n++;
      });
    }
    return { ok: true, updated: n };
  } finally {
    lock.releaseLock();
  }
}

// ────────────── 문항 구성 프리셋 (기초/기본/심화의 상·중·하 %) ──────────────
function actionGetPresets_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const raw = PropertiesService.getScriptProperties().getProperty('PRESETS');
  let presets = null;
  try { presets = raw ? JSON.parse(raw) : null; } catch (e) {}
  return { ok: true, presets: presets };
}

function actionSetPresets_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const clean = {};
  const src = p.presets || {};
  Object.keys(src).forEach(function (name) {
    const v = src[name] || {};
    const row = { '상': Number(v['상']), '중': Number(v['중']), '하': Number(v['하']) };
    if (['상', '중', '하'].some(function (k) { return !isFinite(row[k]) || row[k] < 0; })) return;
    clean[String(name)] = row;
  });
  if (!Object.keys(clean).length) return { ok: false, error: '저장할 프리셋이 없어요.' };
  PropertiesService.getScriptProperties().setProperty('PRESETS', JSON.stringify(clean));
  return { ok: true, presets: clean };
}


// ────────────── 시험기록(제출 내역) 관리 ──────────────
// 제출 행에는 별도 id가 없어서, (시험id + 학생이름 + 제출시각)을 고유 키로 써서 찾는다.
// 제출시각은 초 단위까지 기록되므로 사실상 겹치지 않는다.
function findSubmissionRow_(sheet, examId, studentName, submittedAt) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(examId) && String(data[i][1]) === String(studentName) && String(data[i][5]) === String(submittedAt)) {
      return { rowIndex: i + 1, row: data[i] };
    }
  }
  return null;
}

// ────────────── 백업 · 새 학기 ──────────────
// 이 스프레드시트 전체(시험지·학생 기록·문제은행 목록)를 복사본으로 만들어 드라이브의 「자동채점 백업」 폴더에 둔다.
function makeBackup_(label) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const it = DriveApp.getFoldersByName('자동채점 백업');
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder('자동채점 백업');
  const stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HHmm');
  const file = DriveApp.getFileById(ss.getId()).makeCopy('자동채점 백업 ' + stamp + (label ? ' ' + label : ''), folder);
  return { name: file.getName(), url: 'https://docs.google.com/spreadsheets/d/' + file.getId() + '/edit', folderUrl: folder.getUrl() };
}

function actionBackupNow_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  try { const b = makeBackup_(cleanText_(p.label, 30)); return { ok: true, backup: b }; }
  catch (e) { return { ok: false, error: '백업을 만들지 못했어요: ' + e.message }; }
}

// 이름의 공백을 없애 같은 학생으로 묶는다 ("홍 길동"과 "홍길동")
function histName_(n) { return String(n === undefined || n === null ? '' : n).replace(/\s+/g, ''); }

// 학생 제출 기록을 (학생, 월)별 점수 합계·횟수로 줄여서 「history」 시트에 더한다. 시트: 학생 | 월(yyyy-MM) | 점수합(100점 환산) | 횟수 | 표시 이름
function foldIntoHistory_(scoresSheet) {
  const last = scoresSheet.getLastRow();
  if (last < 2) return;
  const data = scoresSheet.getRange(2, 1, last - 1, 7).getValues();
  const add = {};
  data.forEach(function (r) {
    const name = histName_(r[1]);
    if (!name || name === '이름없음' || !r[5]) return;
    const total = Number(r[4]);
    if (!total) return;                                  // 객관식이 없는 시험은 점수가 없다
    let sc = (r[6] === '' || r[6] === undefined) ? Math.round(Number(r[3]) / total * 100) : Number(r[6]);
    if (!isFinite(sc)) return;
    const d = new Date(r[5]);
    if (isNaN(d.getTime())) return;
    const month = Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM'), key = name + '|' + month;
    const o = add[key] || (add[key] = { name: name, shown: String(r[1]).trim(), month: month, sum: 0, n: 0 });
    o.sum += sc; o.n++;
  });
  const keys = Object.keys(add);
  if (!keys.length) return;
  const sh = ensureSheet_(SpreadsheetApp.getActiveSpreadsheet(), 'history', ['student', 'month', 'sum', 'count', 'shownName']);
  const lastH = sh.getLastRow();
  const rows = lastH > 1 ? sh.getRange(2, 1, lastH - 1, 5).getValues() : [];
  const idx = {};
  rows.forEach(function (r, i) { idx[String(r[0]) + '|' + String(r[1])] = i; });
  keys.forEach(function (k) {
    const o = add[k];
    if (idx[k] !== undefined) { const r = rows[idx[k]]; r[2] = Number(r[2]) + o.sum; r[3] = Number(r[3]) + o.n; }
    else rows.push([o.name, o.month, o.sum, o.n, o.shown]);
  });
  sh.getRange(2, 1, rows.length, 5).setValues(rows);
}

function actionListHistory_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('history');
  if (!sh || sh.getLastRow() < 2) return { ok: true, history: [] };
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
  return { ok: true, history: rows.map(function (r) { return { name: String(r[0]), month: String(r[1]), sum: Number(r[2]) || 0, count: Number(r[3]) || 0, shown: String(r[4] || r[0]) }; }) };
}

// 새 학기 시작: 먼저 전체 백업을 만들고, 백업이 성공했을 때만 학생 제출 기록을 비운다. (시험지·문제은행·QR은 그대로 쓴다)
function actionStartNewTerm_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  if (p.confirm !== 'yes') return { ok: false, error: '확인 표시가 없어서 중단했어요.' };
  const noBackup = p.mode === 'delete';       // 'delete': 백업 없이 기록만 지운다 (기본은 백업 후 비우기)
  let backup = null;
  if (!noBackup) {
    try { backup = makeBackup_(cleanText_(p.label, 30) || '새학기 전'); }
    catch (e) { return { ok: false, error: '백업을 만들지 못해서 기록은 지우지 않았어요: ' + e.message }; }
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  let removed = 0;
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SCORES);
    const last = sh.getLastRow();
    // 기록을 비우기 전에 학생별·월별 평균을 「history」 시트에 남긴다 (성적 추이 그래프가 지난 학기까지 이어지게). 실패하면 기록은 지우지 않는다.
    if (!(noBackup && p.keepHistory === false)) {      // 백업 없이 지울 때도 기본으로 월별 성적 요약은 남긴다 (그래프용) — 「요약도 지우기」를 고르면 남기지 않는다
      try { foldIntoHistory_(sh); }
      catch (e) { return { ok: false, error: '월별 성적을 보관하지 못해서 기록은 지우지 않았어요' + (backup ? ' (백업은 만들었어요)' : '') + ': ' + e.message, backup: backup }; }
    }
    if (last > 1) { removed = last - 1; sh.deleteRows(2, removed); }
    // 오답 복습 기록(맞힘/틀림)도 같이 비운다 — 지난 학기 시험의 기록이라 새 학기에는 쓸모가 없고, 쌓이면 느려진다 (백업에는 남아 있어요)
    ['Cleared', 'ReviewFail'].forEach(function (nm) { try { const rs = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nm); if (rs && rs.getLastRow() > 1) rs.deleteRows(2, rs.getLastRow() - 1); } catch (e) {} });
  } finally { lock.releaseLock(); }
  bustCache_();
  return { ok: true, removed: removed, backup: backup };
}

// 문제은행 문항 id → 학년·단원만 (기록 화면에서 단원 집계용. 전체 문제 목록보다 훨씬 가벼워요)
function actionBankUnitMap_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const sh = questionsSheet_(), last = sh.getLastRow();
  if (last < 2) return { ok: true, items: [] };
  const rows = sh.getRange(2, 1, last - 1, 13).getValues();
  return { ok: true, items: rows.filter(function (r) { return r[0]; }).map(function (r) { return [String(r[0]), String(r[1]), String(r[12] || '')]; }) };
}
function actionListSubmissions_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const ck = 'ls_' + dataVer_(), hit = bigGet_(ck); if (hit) return hit;
  const out = listSubmissionsBuild_(); bigPut_(ck, out, 300); return out;
}
function listSubmissionsBuild_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const examsData = ss.getSheetByName(SHEET_EXAMS).getDataRange().getValues();
  const examOf = {};
  for (let i = 1; i < examsData.length; i++) {
    const row = examsData[i];
    examOf[String(row[0])] = {
      title: row[1], correctAnswers: examAnswers_(row),
      sourceQuestionIds: safeJson_(row[7], []),
    };
  }

  const scoresData = ss.getSheetByName(SHEET_SCORES).getDataRange().getValues();
  const subs = [];
  for (let i = 1; i < scoresData.length; i++) {
    const r = scoresData[i];
    const ex = examOf[String(r[0])];
    subs.push({      // 시험마다 같은 정답·문항 목록을 줄마다 반복해서 보내면 느려서, 아래 exams에 한 번만 담는다
      examId: r[0], studentName: r[1],
      answers: r[2], score: r[3], total: r[4], submittedAt: r[5],
      score100: (r[6] === '' || r[6] === undefined) ? score100_(Number(r[3]), Number(r[4])) : Number(r[6]),
    });
  }
  subs.reverse();  // 최신 순
  const exams = {};
  Object.keys(examOf).forEach(function (id) { exams[id] = { title: examOf[id].title, correctAnswers: examOf[id].correctAnswers, sourceQuestionIds: examOf[id].sourceQuestionIds }; });
  return { ok: true, submissions: subs, exams: exams };
}

function actionDeleteSubmission_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SCORES);
  const found = findSubmissionRow_(sheet, p.examId, p.studentName, p.submittedAt);
  if (!found) return { ok: false, error: '기록을 찾을 수 없어요. (이미 삭제되었거나 목록이 바뀌었을 수 있어요)' };
  sheet.deleteRow(found.rowIndex);
  return { ok: true };
}

// 이미 등록한 시험의 정답을 고친다. 문항 수는 그대로여야 하고, 이미 제출된 학생 기록도 새 정답으로 다시 채점한다.
function actionUpdateExamAnswers_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const exams = ss.getSheetByName(SHEET_EXAMS);
  const found = findExamRow_(exams, p.id);
  if (!found) return { ok: false, error: '존재하지 않는 시험이에요.' };
  const old = examAnswers_(found.row);
  const next = (p.answers || []).map(normAns_);
  if (next.length !== old.length) return { ok: false, error: '문항 수(' + old.length + '개)는 바꿀 수 없어요.' };
  if (next.some(function (a) { return !a; })) return { ok: false, error: '비어 있는 정답이 있어요. 주관식은 - 로 적어 주세요.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    exams.getRange(found.rowIndex, 3).setValue(next.join(','));
    const sheet = ss.getSheetByName(SHEET_SCORES);
    const last = sheet.getLastRow();
    let regraded = 0;
    if (last >= 2) {
      const data = sheet.getRange(2, 1, last - 1, 7).getValues();
      const out = [];
      for (let i = 0; i < data.length; i++) {
        const r = data[i];
        if (String(r[0]) === String(p.id)) {
          const given = String(r[2]).split(',');
          let score = 0, objective = 0;
          for (let k = 0; k < next.length; k++) {
            if (isSubjective_(next[k])) continue;
            if (String(given[k]).trim() === '~') continue;       // 학생이 안 푼다고 뺀 문항
            objective++;
            if (ansMatches_(given[k], next[k])) score++;
          }
          out.push([score, objective, r[5], objective ? Math.round(score / objective * 100) : 0]);
          regraded++;
        } else out.push([r[3], r[4], r[5], r[6]]);
      }
      sheet.getRange(2, 4, out.length, 4).setValues(out);
    }
    return { ok: true, regraded: regraded };
  } finally { lock.releaseLock(); }
}

function actionUpdateSubmissionScore_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SCORES);
  const found = findSubmissionRow_(sheet, p.examId, p.studentName, p.submittedAt);
  if (!found) return { ok: false, error: '기록을 찾을 수 없어요. (이미 삭제되었거나 목록이 바뀌었을 수 있어요)' };
  const score = Math.max(0, parseInt(p.score, 10) || 0);
  const total = Math.max(0, parseInt(p.total, 10) || 0);
  if (total > 0 && score > total) return { ok: false, error: '정답 수가 전체 문항 수보다 클 수 없어요.' };
  const s100 = score100_(score, total);
  sheet.getRange(found.rowIndex, 4, 1, 4).setValues([[score, total, found.row[5], s100]]);
  return { ok: true, score: score, total: total, score100: s100 };
}


// 문제은행 문항 여러 개를 한 번에 지운다 (한 개씩 지우는 것보다 훨씬 빠르다 — 행을 뒤에서부터
// 지워서 번호가 밀리는 문제를 피한다)
function actionDeleteQuestions_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const ids = p.ids || [];
  if (!ids.length) return { ok: true, deleted: 0 };
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = questionsSheet_();
    const last = sheet.getLastRow();
    if (last < 2) return { ok: true, deleted: 0 };
    const data = sheet.getRange(2, 1, last - 1, 8).getValues();
    const want = {}; ids.forEach(function (id) { want[String(id)] = true; });
    const rowsToDelete = [];
    for (let i = 0; i < data.length; i++) {
      if (!want[String(data[i][0])]) continue;
      rowsToDelete.push(i + 2);
      const fileId = data[i][6], explId = data[i][7];
      if (fileId) { try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {} }
      if (explId) { try { DriveApp.getFileById(explId).setTrashed(true); } catch (e) {} }
    }
    rowsToDelete.sort(function (a, b) { return b - a; }).forEach(function (r) { sheet.deleteRow(r); });
    return { ok: true, deleted: rowsToDelete.length };
  } finally {
    lock.releaseLock();
  }
}

// 드라이브 주소에서 파일 id를 뽑는다
function fileIdFromUrl_(u) { const m = String(u || '').match(/[-\w]{25,}/); return m ? m[0] : ''; }

// 시험지 여러 개를 한꺼번에 지운다 (PDF·해설 파일 + 원하면 제출 기록까지)
function actionDeleteExams_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const ids = p.ids || [];
  if (!ids.length) return { ok: true, deleted: 0, removedScores: 0 };
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const examsSheet = ss.getSheetByName(SHEET_EXAMS);
    const want = {}; ids.forEach(function (id) { want[String(id)] = true; });
    const data = examsSheet.getDataRange().getValues();
    const rows = [];
    for (let i = 1; i < data.length; i++) {
      if (!want[String(data[i][0])]) continue;
      rows.push(i + 1);
      const pdfId = data[i][4], explId = fileIdFromUrl_(data[i][6]);
      if (pdfId) { try { DriveApp.getFileById(pdfId).setTrashed(true); } catch (e) {} }
      if (explId) { try { DriveApp.getFileById(explId).setTrashed(true); } catch (e) {} }
    }
    rows.sort(function (a, b) { return b - a; }).forEach(function (r) { examsSheet.deleteRow(r); });
    let removedScores = 0;
    if (p.deleteSubmissions) {
      const scoresSheet = ss.getSheetByName(SHEET_SCORES);
      const sd = scoresSheet.getDataRange().getValues();
      for (let i = sd.length - 1; i >= 1; i--) {
        if (want[String(sd[i][0])]) { scoresSheet.deleteRow(i + 1); removedScores++; }
      }
    }
    return { ok: true, deleted: rows.length, removedScores: removedScores };
  } finally {
    lock.releaseLock();
  }
}

// 등록된 시험지를 지운다 (PDF/해설 파일 + 제출 기록까지 함께 정리)
function actionDeleteExam_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const examsSheet = ss.getSheetByName(SHEET_EXAMS);
  const found = findExamRow_(examsSheet, p.id);
  if (!found) return { ok: false, error: '존재하지 않는 시험이에요.' };
  const fileId = found.row[4], explId1 = fileIdFromUrl_(found.row[6]);
  if (fileId) { try { DriveApp.getFileById(fileId).setTrashed(true); } catch (e) {} }
  if (explId1) { try { DriveApp.getFileById(explId1).setTrashed(true); } catch (e) {} }
  examsSheet.deleteRow(found.rowIndex);

  let removedScores = 0;
  if (p.deleteSubmissions) {
    const scoresSheet = ss.getSheetByName(SHEET_SCORES);
    const data = scoresSheet.getDataRange().getValues();
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0]) === String(p.id)) { scoresSheet.deleteRow(i + 1); removedScores++; }
    }
  }
  return { ok: true, removedScores: removedScores };
}


// 등록된 시험지 PDF를 base64로 내려준다.
// 브라우저가 구글 드라이브 주소를 직접 읽으면 보안 규칙(CORS)에 막혀서("Failed to fetch"),
// 서버를 거쳐서 받는다. (비슷한 문제 찾기가 예전 시험의 PDF 글자를 다시 읽을 때 쓴다)
function actionGetExamPdf_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const found = findExamRow_(ss.getSheetByName(SHEET_EXAMS), p.id);
  if (!found) return { ok: false, error: '존재하지 않는 시험이에요.' };
  const fileId = found.row[4];
  if (!fileId) return { ok: false, error: '시험지 PDF 파일을 찾을 수 없어요.' };
  let bytes;
  try { bytes = DriveApp.getFileById(fileId).getBlob().getBytes(); }
  catch (e) { return { ok: false, error: '드라이브에서 PDF를 읽지 못했어요. (파일이 지워졌을 수 있어요)' }; }
  if (bytes.length > 30 * 1024 * 1024) return { ok: false, error: 'PDF가 너무 커서(30MB 초과) 불러올 수 없어요.' };
  return { ok: true, base64: Utilities.base64Encode(bytes) };
}


// 문제은행에 이미 있는 분류(학년·단원·구분·학교)와 문항 수. 가져오기 화면의 자동완성 후보로 쓴다.
// (문항 전체를 내려받지 않아서 listQuestions보다 가볍다)
function actionListTaxonomy_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const sheet = questionsSheet_();
  const last = sheet.getLastRow();
  if (last < 2) return { ok: true, taxonomy: [] };
  const data = sheet.getRange(2, 1, last - 1, 16).getValues();
  const seen = {}, out = [];
  data.forEach(function (r) {
    const grade = String(r[12] || ''), unit = String(r[1] || ''), kind = normKind_(r[13]), school = String(r[14] || '');
    const key = [grade, unit, kind, school].join('\u0001');
    if (!seen[key]) { seen[key] = { grade: grade, unit: unit, kind: kind, school: school, count: 0 }; out.push(seen[key]); }
    seen[key].count++;
  });
  return { ok: true, taxonomy: out };
}


// ────────────── 과학 목차 (단원 이름 목록; 문제 단원 분류의 기준) ──────────────
function actionGetToc_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const raw = PropertiesService.getScriptProperties().getProperty('TOC_TEXT') || '';
  return { ok: true, text: raw };
}

function actionSetToc_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const text = String(p.text || '');
  if (text.length > 8500) return { ok: false, error: '목차가 너무 길어요(8,500자까지). 키워드를 줄여주세요.' };
  PropertiesService.getScriptProperties().setProperty('TOC_TEXT', text);
  return { ok: true };
}


// ────────────── 시험 예약 · 알림 ──────────────
// 시험 예약: (시험, 학생 이름, 제출 기한). 학생이 제출하면 '제출', 기한이 지나도 안 내면 '미제출'로 바뀌고 선생님께 알려요.
const ASSIGN_HEADERS = ['id', 'examId', 'studentName', 'deadline', 'createdAt', 'status', 'notifiedAt', 'submittedAt', 'remindedAt', 'remind1At', 'remind2At'];
function assignSheet_() { const sh = ensureSheet_(SpreadsheetApp.getActiveSpreadsheet(), SHEET_ASSIGN, ASSIGN_HEADERS); if (sh.getMaxColumns() < ASSIGN_HEADERS.length) sh.insertColumnsAfter(sh.getMaxColumns(), ASSIGN_HEADERS.length - sh.getMaxColumns()); if (!sh.getRange(1, 9).getValue()) sh.getRange(1, 9).setValue('remindedAt'); if (!sh.getRange(1, 10).getValue()) sh.getRange(1, 10).setValue('remind1At'); if (!sh.getRange(1, 11).getValue()) sh.getRange(1, 11).setValue('remind2At'); return sh; }
function nameKey_(n) { return String(n === undefined || n === null ? '' : n).replace(/\s+/g, '').toLowerCase(); }
function fmtKst_(iso) { try { return Utilities.formatDate(new Date(iso), 'Asia/Seoul', 'M/d(E) HH:mm'); } catch (e) { return String(iso); } }
function alertSettings_() {
  const pr = PropertiesService.getScriptProperties();
  let email = pr.getProperty('ALERT_EMAIL') || '';
  if (!email) { try { email = Session.getEffectiveUser().getEmail() || ''; } catch (e) {} }
  return { email: email, notifySubmit: pr.getProperty('ALERT_SUBMIT') !== 'off', notifyMiss: pr.getProperty('ALERT_MISS') !== 'off' };
}
let LAST_MAIL_ERR = '';
function sendAlertMail_(subject, body) {
  LAST_MAIL_ERR = '';
  const st = alertSettings_();
  if (!st.email) { LAST_MAIL_ERR = '받을 이메일 주소가 없어요.'; return false; }
  try { MailApp.sendEmail({ to: st.email, subject: subject, body: body, name: '자동채점 시스템' }); return true; } catch (e) { LAST_MAIL_ERR = String(e && e.message ? e.message : e); return false; }
}
function examTitleOf_(ss, examId) {
  const f = findExamRow_(ss.getSheetByName(SHEET_EXAMS), examId);
  return f ? String(f.row[1]) : '(삭제된 시험)';
}

// 학생이 제출한 직후: 예약 상태 갱신 + 선생님께 이메일
function afterSubmit_(ss, found, p, score, objective, score100) {
  const title = String(found.row[1]), name = String(p.studentName || '이름없음');
  const now = new Date();
  const sh = assignSheet_(), last = sh.getLastRow();
  let reserved = false, late = false;
  if (last >= 2) {
    const data = sh.getRange(2, 1, last - 1, ASSIGN_HEADERS.length).getValues();
    for (let i = 0; i < data.length; i++) {
      const r = data[i];
      if (String(r[1]) !== String(p.id) || nameKey_(r[2]) !== nameKey_(name)) continue;
      if (String(r[5]) === 'done' || String(r[5]) === 'late') continue;
      reserved = true;
      const isLate = now.getTime() > new Date(r[3]).getTime();
      if (isLate) late = true;
      sh.getRange(i + 2, 6).setValue(isLate ? 'late' : 'done');
      sh.getRange(i + 2, 8).setValue(now.toISOString());
      break;
    }
  }
  let repText = '';
  try {
    const wk = weakOfStudent_(ss, name); repText = weakText_(wk, title);
    if (!repText && wk.weakUnits.length) repText = weakText_({ repeatQ: [], weakUnits: wk.weakUnits }, '');
    if (repText) pushToStudent_(name, '🔁 반복해서 틀리는 문제가 있어요', repText + ' — 앱에서 「틀린 것 다시 풀기」를 해 보세요');
  } catch (e) {}
  let lowText = '';
  try {      // 낮은 점수: 70점 미만이거나, 이 학생의 바로 전 시험보다 20점 이상 떨어졌을 때
    if (objective > 0) {
      const sd = ss.getSheetByName(SHEET_SCORES).getDataRange().getValues(), kk = nameKey_(name);
      let skipped = false, prev = null;
      for (let i = sd.length - 1; i >= 1; i--) { if (nameKey_(sd[i][1]) !== kk) continue; if (!skipped) { skipped = true; continue; } prev = (sd[i][6] === '' || sd[i][6] === undefined) ? score100_(Number(sd[i][3]), Number(sd[i][4])) : Number(sd[i][6]); break; }
      const bits = [];
      if (score100 < 70) bits.push('70점 미만');
      if (prev !== null && prev - score100 >= 20) bits.push('지난 시험보다 ' + (prev - score100) + '점 하락');
      lowText = bits.join(' · ');
    }
  } catch (e) {}
  try { pushToTeacher_((lowText ? '📉 ' : '📝 ') + name + ' 학생 제출 · ' + score100 + '점' + (lowText ? ' (' + lowText + ')' : ''), title + '\n' + score + '/' + objective + (late ? ' · 기한 지남' : '') + (repText ? '\n⚠️ 반복 오답: ' + repText : '')); } catch (e) {}
  if (alertSettings_().notifySubmit) {
    sendAlertMail_('[자동채점] ' + name + ' 학생이 시험을 제출했어요' + (late ? ' (기한 지남)' : '') + (repText ? ' ⚠️ 반복 오답' : ''),
      name + ' 학생이 「' + title + '」을 제출했어요.\n점수: ' + score + '/' + objective + ' (' + score100 + '점)' + (reserved ? (late ? '\n※ 예약한 기한이 지난 뒤에 제출했어요.' : '\n※ 예약한 기한 안에 제출했어요.') : '') + '\n제출 시각: ' + fmtKst_(now.toISOString()) + (lowText ? '\n📉 낮은 점수: ' + lowText : '') + (repText ? '\n⚠️ 반복 오답: ' + repText : ''));
  }
}

function actionCreateAssignments_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!findExamRow_(ss.getSheetByName(SHEET_EXAMS), p.examId)) return { ok: false, error: '존재하지 않는 시험이에요.' };
  const dl = new Date(p.deadline);
  if (isNaN(dl.getTime())) return { ok: false, error: '기한이 올바르지 않아요.' };
  const names = (p.students || []).map(function (n) { return String(n).trim(); }).filter(Boolean);
  if (!names.length) return { ok: false, error: '학생 이름을 한 명 이상 적어 주세요.' };
  const sh = assignSheet_(), now = new Date().toISOString(), rows = [];
  const exist = {};
  const last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, 1, last - 1, 3).getValues().forEach(function (r) { exist[String(r[1]) + '|' + nameKey_(r[2])] = 1; });
  let skipped = 0;
  names.forEach(function (n, i) {
    const k = String(p.examId) + '|' + nameKey_(n);
    if (exist[k]) { skipped++; return; }
    exist[k] = 1;
    rows.push(['a' + Date.now().toString(36) + i + Math.random().toString(36).slice(2, 5), p.examId, n, dl.toISOString(), now, 'wait', '', '', '', '', '']);
  });
  if (rows.length) sh.getRange(sh.getLastRow() + 1, 1, rows.length, ASSIGN_HEADERS.length).setValues(rows);
  try { const ttl = examTitleOf_(ss, p.examId); rows.forEach(function (r) { pushToStudent_(r[2], '📝 새 시험이 예약됐어요', ttl + ' · ' + fmtKst_(r[3]) + '까지 제출'); }); } catch (e) {}
  return { ok: true, added: rows.length, skipped: skipped };
}

// 상태: 이미 제출한 학생이면 예약 이후 제출 기록으로 보정해서 돌려준다
function actionListAssignments_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = assignSheet_(), last = sh.getLastRow();
  const out = [];
  if (last >= 2) {
    const titleOf = {};
    ss.getSheetByName(SHEET_EXAMS).getDataRange().getValues().slice(1).forEach(function (r) { titleOf[String(r[0])] = String(r[1]); });
    sh.getRange(2, 1, last - 1, ASSIGN_HEADERS.length).getValues().forEach(function (r) {
      out.push({ id: r[0], examId: r[1], examTitle: titleOf[String(r[1])] || '(삭제된 시험)', studentName: r[2], deadline: r[3], createdAt: r[4], status: String(r[5] || 'wait'), notifiedAt: r[6], submittedAt: r[7] });
    });
  }
  out.sort(function (a, b) { return String(b.deadline).localeCompare(String(a.deadline)); });
  return { ok: true, assignments: out };
}

function actionDeleteAssignment_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const sh = assignSheet_(), last = sh.getLastRow();
  if (last < 2) return { ok: true, removed: 0 };
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]) === String(p.id)) { sh.deleteRow(i + 2); return { ok: true, removed: 1 }; }
  return { ok: true, removed: 0 };
}

function actionGetAlertSettings_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const st = alertSettings_();
  let trig = false;
  try { trig = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'checkDeadlines_'; }); } catch (e) {}
  let lm = null; try { lm = JSON.parse(PropertiesService.getScriptProperties().getProperty('LAST_MISS_MAIL') || 'null'); } catch (e) {}
  return { ok: true, email: st.email, notifySubmit: st.notifySubmit, notifyMiss: st.notifyMiss, triggerOn: trig, lastMissMail: lm, backupOn: hasTrigger_('autoBackup_') };
}

function actionSetAlertSettings_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const pr = PropertiesService.getScriptProperties();
  if (p.email !== undefined) {
    const e = String(p.email).trim();
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return { ok: false, error: '이메일 주소가 올바르지 않아요.' };
    pr.setProperty('ALERT_EMAIL', e);
  }
  if (p.notifySubmit !== undefined) pr.setProperty('ALERT_SUBMIT', p.notifySubmit ? 'on' : 'off');
  if (p.notifyMiss !== undefined) pr.setProperty('ALERT_MISS', p.notifyMiss ? 'on' : 'off');
  let sent = false;
  if (p.test) sent = sendAlertMail_('[자동채점] 알림 메일 테스트', '이 메일이 보이면 알림 메일이 잘 가는 거예요.');
  return { ok: true, testSent: sent, testError: sent ? '' : LAST_MAIL_ERR };
}

// 앱 안 알림: since(ISO) 이후 새 제출 + 기한이 지난 미제출
function actionListAlerts_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  checkDeadlines_();      // 트리거가 없어도, 앱을 열 때마다 기한이 지난 것을 바로 반영한다
  ensureDailyReview_();
  const since = p.since ? new Date(p.since).getTime() : 0;
  const titleOf = {};
  ss.getSheetByName(SHEET_EXAMS).getDataRange().getValues().slice(1).forEach(function (r) { titleOf[String(r[0])] = String(r[1]); });
  const recent = [];
  const sd = ss.getSheetByName(SHEET_SCORES).getDataRange().getValues();
  for (let i = sd.length - 1; i >= 1 && recent.length < 50; i--) {
    const t = new Date(sd[i][5]).getTime();
    if (!(t > since)) { if (since) break; }
    recent.push({ examId: sd[i][0], examTitle: titleOf[String(sd[i][0])] || '(삭제된 시험)', studentName: sd[i][1], score: sd[i][3], total: sd[i][4], score100: sd[i][6], submittedAt: sd[i][5] });
  }
  const missed = [];
  const sh = assignSheet_(), last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, 1, last - 1, ASSIGN_HEADERS.length).getValues().forEach(function (r) {
    if (String(r[5]) === 'missed') missed.push({ id: r[0], examId: r[1], examTitle: titleOf[String(r[1])] || '(삭제된 시험)', studentName: r[2], deadline: r[3] });
  });
  return { ok: true, recent: recent, missed: missed, now: new Date().toISOString() };
}

// 기한이 지났는데 제출하지 않은 예약 → '미제출'로 바꾸고 선생님께 메일 1통 (10분마다 자동 실행 + 앱을 열 때)
function checkDeadlines_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = assignSheet_(), last = sh.getLastRow();
    if (last < 2) return;
    const data = sh.getRange(2, 1, last - 1, ASSIGN_HEADERS.length).getValues();
    const now = Date.now(), nowIso = new Date().toISOString(), newly = [];
    let scores = null;
    for (let i = 0; i < data.length; i++) {
      const r = data[i];
      if (String(r[5]) !== 'wait' || !(new Date(r[3]).getTime() < now)) continue;
      if (!scores) scores = ss.getSheetByName(SHEET_SCORES).getDataRange().getValues();
      let sub = null;      // 앱 밖에서 제출 기록이 이미 있으면 제출로 본다
      for (let k = scores.length - 1; k >= 1; k--) if (String(scores[k][0]) === String(r[1]) && nameKey_(scores[k][1]) === nameKey_(r[2]) && new Date(scores[k][5]).getTime() >= new Date(r[4]).getTime()) { sub = scores[k][5]; break; }
      if (sub) { sh.getRange(i + 2, 6).setValue(new Date(sub).getTime() > new Date(r[3]).getTime() ? 'late' : 'done'); sh.getRange(i + 2, 8).setValue(String(sub)); continue; }
      sh.getRange(i + 2, 6).setValue('missed'); sh.getRange(i + 2, 7).setValue(nowIso);
      newly.push({ name: r[2], exam: examTitleOf_(ss, r[1]), deadline: r[3] });
    }
    try { if (newly.length) pushToTeacher_('⏰ 미제출 학생 ' + newly.length + '명', newly.slice(0, 6).map(function (x) { return x.name + ' — ' + x.exam; }).join('\n') + (newly.length > 6 ? '\n외 ' + (newly.length - 6) + '명' : '')); } catch (e) {}
    try { newly.forEach(function (x) { pushToStudent_(x.name, '⏰ 제출 기한이 지났어요', x.exam + ' · 지금 바로 제출해 주세요'); }); } catch (e) {}
    try { remindSoon_(sh, data, ss); } catch (e) {}
    try { deadlineSummary_(ss, sh); } catch (e) {}
    if (newly.length && alertSettings_().notifyMiss) {
      const okMail = sendAlertMail_('[자동채점] 기한 안에 제출하지 않은 학생 ' + newly.length + '명',
        newly.map(function (x) { return '· ' + x.name + ' — ' + x.exam + ' (기한 ' + fmtKst_(x.deadline) + ')'; }).join('\n') + '\n\n앱의 「시험 예약·알림」에서 카카오톡 안내 문구를 복사해 보낼 수 있어요.');
      PropertiesService.getScriptProperties().setProperty('LAST_MISS_MAIL', JSON.stringify({ at: nowIso, ok: !!okMail, err: LAST_MAIL_ERR, n: newly.length }));
    } else if (newly.length) {
      PropertiesService.getScriptProperties().setProperty('LAST_MISS_MAIL', JSON.stringify({ at: nowIso, ok: false, err: '「기한이 지났는데 안 낸 학생이 있으면 메일 받기」가 꺼져 있어요.', n: newly.length }));
    }
  } finally { lock.releaseLock(); }
}

// 마감 요약: 같은 시험·같은 기한의 예약이 모두 정리(제출/기한 지남)되면 선생님께 한 번만 알려 준다 (최근 24시간 안에 마감된 것만)
function deadlineSummary_(ss, sh) {
  const last = sh.getLastRow(); if (last < 2) return;
  const pr = PropertiesService.getScriptProperties(), done = safeJson_(pr.getProperty('SUMMARIZED'), []);
  const rows = sh.getRange(2, 1, last - 1, ASSIGN_HEADERS.length).getValues(), now = Date.now(), groups = {};
  rows.forEach(function (r) { const dl = new Date(r[3]).getTime(); if (!r[1] || isNaN(dl) || dl > now || now - dl > 24 * 3600 * 1000) return; const k = r[1] + '|' + r[3]; (groups[k] = groups[k] || []).push(r); });
  const keys = Object.keys(groups).filter(function (k) { return done.indexOf(k) < 0 && groups[k].every(function (r) { return String(r[5]) !== 'wait'; }); });
  if (!keys.length) return;
  const sd = ss.getSheetByName(SHEET_SCORES).getDataRange().getValues();
  keys.forEach(function (k) {
    const g = groups[k], examId = k.split('|')[0], title = examTitleOf_(ss, examId), scores = [], miss = [];
    g.forEach(function (r) {
      if (String(r[5]) === 'missed') { miss.push(r[2]); return; }
      for (let i = sd.length - 1; i >= 1; i--) if (String(sd[i][0]) === String(examId) && nameKey_(sd[i][1]) === nameKey_(r[2])) { scores.push((sd[i][6] === '' || sd[i][6] === undefined) ? score100_(Number(sd[i][3]), Number(sd[i][4])) : Number(sd[i][6])); break; }
    });
    const avg = scores.length ? Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length) : null;
    pushToTeacher_('📋 마감: ' + title, g.length + '명 중 ' + (g.length - miss.length) + '명 제출' + (avg !== null ? ' · 평균 ' + avg + '점' : '') + (miss.length ? '\n미제출: ' + miss.slice(0, 8).join(', ') + (miss.length > 8 ? ' 외 ' + (miss.length - 8) + '명' : '') : '\n전원 제출 🎉'));
    done.push(k);
  });
  pr.setProperty('SUMMARIZED', JSON.stringify(done.slice(-150)));
}
function actionResendMissMail_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const ss = SpreadsheetApp.getActiveSpreadsheet(), sh = assignSheet_(), last = sh.getLastRow(), list = [];
  if (last >= 2) sh.getRange(2, 1, last - 1, ASSIGN_HEADERS.length).getValues().forEach(function (r) {
    if (String(r[5]) === 'missed') list.push('· ' + r[2] + ' — ' + examTitleOf_(ss, r[1]) + ' (기한 ' + fmtKst_(r[3]) + ')');
  });
  if (!list.length) return { ok: true, sent: false, error: '미제출 학생이 없어요.' };
  const ok = sendAlertMail_('[자동채점] 미제출 학생 ' + list.length + '명 (다시 보내기)', list.join('\n'));
  PropertiesService.getScriptProperties().setProperty('LAST_MISS_MAIL', JSON.stringify({ at: new Date().toISOString(), ok: !!ok, err: LAST_MAIL_ERR, n: list.length }));
  return { ok: true, sent: !!ok, error: ok ? '' : LAST_MAIL_ERR, n: list.length };
}

// 10분마다 checkDeadlines_ 를 실행하는 시간 트리거 (여러 번 눌러도 하나만 만든다)
function installAlertTrigger_() {
  const has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'checkDeadlines_'; });
  if (!has) ScriptApp.newTrigger('checkDeadlines_').timeBased().everyMinutes(10).create();
  return true;
}
function actionInstallAlertTrigger_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  try { installAlertTrigger_(); return { ok: true }; } catch (e) { return { ok: false, error: '자동 확인을 켜지 못했어요: ' + e.message }; }
}
// ▶ 편집기에서 이 함수를 한 번 실행해 권한을 허용하세요 (메일 보내기 · 자동 실행 권한)
function setupAlerts() {
  assignSheet_();
  installAlertTrigger_();
  ensureDailyReview_();
  if (!hasTrigger_('autoBackup_')) ScriptApp.newTrigger('autoBackup_').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).create();
  MailApp.getRemainingDailyQuota();
  Logger.log('알림 설정 완료. 이제 웹 앱을 새 버전으로 배포하세요.');
}


// ────────────── 반 명단 · 학생 화면의 제출 기한 ──────────────
function actionGetRosters_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const sh = ensureSheet_(SpreadsheetApp.getActiveSpreadsheet(), SHEET_ROSTER, ['className', 'students']), last = sh.getLastRow();
  const out = [];
  if (last >= 2) sh.getRange(2, 1, last - 1, 2).getValues().forEach(function (r) {
    if (!String(r[0]).trim()) return;
    out.push({ name: String(r[0]), students: safeJson_(r[1], []) });
  });
  return { ok: true, rosters: out };
}
// 알림장 앱 학생 명단 (30분 캐시. 느린 외부 호출이라 반 명단과 따로 불러온다)
function actionNoticeRoster_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  try { const nn = noticeNames_(!!p.refresh); return nn.length ? { ok: true, roster: { name: '📒 알림장 전체', students: nn, auto: true } } : { ok: true, roster: null, noticeError: '알림장에서 학생을 찾지 못했어요' }; }
  catch (e) { return { ok: true, roster: null, noticeError: '알림장 연동 실패: ' + e.message }; }
}
function actionSetRosters_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const sh = ensureSheet_(SpreadsheetApp.getActiveSpreadsheet(), SHEET_ROSTER, ['className', 'students']);
  const list = (p.rosters || []).map(function (r) {
    const seen = {}, names = [];
    (r.students || []).forEach(function (n) { n = String(n).trim(); const k = nameKey_(n); if (n && !seen[k]) { seen[k] = 1; names.push(n); } });
    return [String(r.name || '').trim().slice(0, 40), JSON.stringify(names)];
  }).filter(function (r) { return r[0]; });
  const last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, 1, last - 1, 2).clearContent();
  if (list.length) sh.getRange(2, 1, list.length, 2).setValues(list);
  return { ok: true, count: list.length };
}
// 학생 시험 화면용(로그인 없음): 이 시험에 예약된 이 학생의 제출 기한만 돌려준다
function actionGetDeadline_(p) {
  const key = nameKey_(p.studentName);
  if (!p.examId || !key) return { ok: true, deadline: '' };
  const sh = assignSheet_(), last = sh.getLastRow();
  if (last < 2) return { ok: true, deadline: '' };
  const rows = sh.getRange(2, 1, last - 1, ASSIGN_HEADERS.length).getValues();
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (String(r[1]) === String(p.examId) && nameKey_(r[2]) === key && (String(r[5]) === 'wait' || String(r[5]) === 'missed')) return { ok: true, deadline: r[3] };
  }
  return { ok: true, deadline: '' };
}


// ────────────── 학생용 앱 (이름 + 4자리 숫자로 로그인) ──────────────
const SHEET_STU = 'Students';
function stuSheet_() { return ensureSheet_(SpreadsheetApp.getActiveSpreadsheet(), SHEET_STU, ['name', 'salt', 'hash', 'createdAt', 'lastLogin', 'tokens', 'status']); }
function stuFind_(name) {
  const sh = stuSheet_(), last = sh.getLastRow(), key = nameKey_(name);
  if (last < 2 || !key) return null;
  const rows = sh.getRange(2, 1, last - 1, 7).getValues();
  for (let i = 0; i < rows.length; i++) if (nameKey_(rows[i][0]) === key) return { rowIndex: i + 2, row: rows[i] };
  return null;
}
function stuHash_(salt, pin, name) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + String(pin) + '|' + nameKey_(name));
  return bytes.map(function (b) { return ('0' + (b < 0 ? b + 256 : b).toString(16)).slice(-2); }).join('');
}
// 가입할 수 있는 학생 = 반 명단에 있거나 시험 예약에 이름이 있는 학생
function stuAllowed_(name) {
  const key = nameKey_(name); if (!key) return false;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rs = ss.getSheetByName(SHEET_ROSTER);
  if (rs && rs.getLastRow() >= 2) {
    const rows = rs.getRange(2, 1, rs.getLastRow() - 1, 2).getValues();
    for (let i = 0; i < rows.length; i++) { const list = safeJson_(rows[i][1], []); for (let k = 0; k < list.length; k++) if (nameKey_(list[k]) === key) return true; }
  }
  const sh = assignSheet_();
  if (sh.getLastRow() >= 2) {
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
    for (let i = 0; i < rows.length; i++) if (nameKey_(rows[i][2]) === key) return true;
  }
  try { const nn = noticeNames_(); for (let i = 0; i < nn.length; i++) if (nameKey_(nn[i]) === key) return true; } catch (e) {}
  return false;
}
// 알림장 앱(Apps Script)의 학생 명단을 가져온다. 5분 동안 캐시. 주소는 스크립트 속성 NOTICE_URL로 바꿀 수 있다.
const NOTICE_URL_DEFAULT = 'https://script.google.com/macros/s/AKfycbypEPpo_ah7GwsKXHm7K8gnrWkhHtJcSyafLysb2_-5B5Wq9tf1rdc8NQXmG22YvOUg/exec';
function noticeNames_(force) {
  const cache = CacheService.getScriptCache();
  if (!force) { const c = cache.get('notice_names'); if (c) { try { return JSON.parse(c); } catch (e) {} } }
  const url = PropertiesService.getScriptProperties().getProperty('NOTICE_URL') || NOTICE_URL_DEFAULT;
  const res = UrlFetchApp.fetch(url + (url.indexOf('?') < 0 ? '?' : '&') + 'action=getData', { muteHttpExceptions: true, followRedirects: true });
  const d = JSON.parse(res.getContentText());
  const arr = d.students || (d.data && d.data.students) || [];
  const seen = {}, names = [];
  arr.forEach(function (x) { const n = String(typeof x === 'string' ? x : (x['이름'] || x.name || '')).trim(), k = nameKey_(n); if (n && !seen[k]) { seen[k] = 1; names.push(n); } });
  if (names.length) { try { cache.put('notice_names', JSON.stringify(names), 1800); } catch (e) {} }
  return names;
}
// 이름·번호 확인. 5번 틀리면 10분 동안 잠근다.
function stuAuth_(p) {
  const key = nameKey_(p.name);
  if (!key || !/^\d{4}$/.test(String(p.pin || ''))) return { ok: false, error: '이름과 4자리 숫자를 입력해 주세요.' };
  const cache = CacheService.getScriptCache(), ck = 'stufail_' + key;
  if (Number(cache.get(ck) || 0) >= 5) return { ok: false, locked: true, error: '여러 번 틀려서 10분 동안 잠겼어요. 잠시 뒤에 다시 해 주세요. (급하면 선생님께 말씀드리세요)' };
  const f = stuFind_(p.name);
  if (!f) return { ok: false, notRegistered: true, error: '아직 가입하지 않은 이름이에요.' };
  if (String(f.row[6]) === 'pending') return { ok: false, pending: true, error: '선생님이 승인하면 들어올 수 있어요. 조금만 기다려 주세요.' };
  if (stuHash_(String(f.row[1]), p.pin, p.name) !== String(f.row[2])) {
    cache.put(ck, String(Number(cache.get(ck) || 0) + 1), 600);
    return { ok: false, error: '이름 또는 4자리 숫자가 맞지 않아요.' };
  }
  cache.remove(ck);
  return { ok: true, display: String(f.row[0]), rowIndex: f.rowIndex };
}
function actionStuClear_(p) {
  const a = stuAuth_(p); if (!a.ok) return a;
  const n = Number(p.n); if (!p.examId || !(n >= 1)) return { ok: false, error: '문항 정보가 없어요.' };
  const okFlag = !(p.ok === false || p.ok === 'false');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet_(ss, okFlag ? 'Cleared' : 'ReviewFail', ['examId', 'name', 'n', 'at']).appendRow([String(p.examId), a.display, n, new Date().toISOString()]);
  return { ok: true };
}
function actionStuWeak_(p) {
  const a = stuAuth_(p); if (!a.ok) return a;
  const ck = 'sw_' + dataVer_() + '_' + nameKey_(a.display), hit = cacheGet_(ck); if (hit) return hit;
  const ss0 = SpreadsheetApp.getActiveSpreadsheet();
  const out = { ok: true, weak: weakOfStudent_(ss0, a.display), review: reviewProgress_(ss0, a.display) };
  cachePut_(ck, out, 300); return out;
}
function actionStuStatus_(p) {
  const name = String(p.name || '').trim();
  if (!nameKey_(name)) return { ok: false, error: '이름을 입력해 주세요.' };
  const f = stuFind_(name); return { ok: true, allowed: stuAllowed_(name), registered: !!f, pending: !!f && String(f.row[6]) === 'pending' };
}
function actionStuRegister_(p) {
  const name = String(p.name || '').trim(), pin = String(p.pin || '');
  if (!nameKey_(name)) return { ok: false, error: '이름을 입력해 주세요.' };
  if (!/^\d{4}$/.test(pin)) return { ok: false, error: '숫자 4자리로 정해 주세요.' };
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    if (stuFind_(name)) return { ok: false, error: '이미 가입한 이름이에요. 번호를 잊었으면 선생님께 초기화를 부탁하세요.' };
    const salt = Utilities.getUuid();
    stuSheet_().appendRow([name, salt, stuHash_(salt, pin, name), new Date().toISOString(), '', '[]', 'pending']);
  } finally { lock.releaseLock(); }
  try { pushToTeacher_('🙋 가입 신청이 왔어요', name + ' 학생이 가입을 신청했어요' + (stuAllowed_(name) ? '' : '\n⚠️ 반/알림장 명단에 없는 이름이에요') + '\n앱의 「학생용 앱」에서 승인해 주세요'); } catch (e) {}
  return { ok: true, display: name, pending: true };
}
function actionStuLogin_(p) {
  const a = stuAuth_(p); if (!a.ok) return a;
  stuSheet_().getRange(a.rowIndex, 5).setValue(new Date().toISOString());
  return { ok: true, display: a.display };
}
// 학생 홈: 내게 예약된 시험(제출 기한), 전체 시험 목록, 내 제출 기록
function actionStuHome_(p) {
  const a = stuAuth_(p); if (!a.ok) return a;
  const key = nameKey_(a.display);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try { const cc = CacheService.getScriptCache(); if (!cc.get('cd_run')) { cc.put('cd_run', '1', 60); checkDeadlines_(); } } catch (e) {}
  if (p.login) { try { stuSheet_().getRange(a.rowIndex, 5).setValue(new Date().toISOString()); } catch (e) {} }
  const ed = ss.getSheetByName(SHEET_EXAMS).getDataRange().getValues();
  const titleOf = {}, exams = [];
  for (let i = 1; i < ed.length; i++) {
    const r = ed[i]; if (!r[0]) continue;
    titleOf[String(r[0])] = String(r[1]);
    const rc = safeJson_(r[8], null);
    exams.push({ id: String(r[0]), title: String(r[1]), count: examAnswers_(r).length, createdAt: r[3], book: (rc && rc.book) ? String(rc.book) : '' });
  }
  const sd = ss.getSheetByName(SHEET_SCORES).getDataRange().getValues(), records = [], doneIds = {}, best = {};
  for (let i = sd.length - 1; i >= 1; i--) {
    if (nameKey_(sd[i][1]) !== key) continue;
    const id = String(sd[i][0]);
    records.push({ examId: id, title: titleOf[id] || '(삭제된 시험)', score: sd[i][3], total: sd[i][4], score100: sd[i][6], submittedAt: sd[i][5] });
    doneIds[id] = 1; if (best[id] === undefined || sd[i][6] > best[id]) best[id] = sd[i][6];
  }
  const asg = [], sh = assignSheet_();
  if (sh.getLastRow() >= 2) sh.getRange(2, 1, sh.getLastRow() - 1, ASSIGN_HEADERS.length).getValues().forEach(function (r) {
    if (nameKey_(r[2]) !== key || !titleOf[String(r[1])]) return;
    asg.push({ examId: String(r[1]), title: titleOf[String(r[1])], deadline: r[3], status: String(r[5]), submittedAt: String(r[7] || '') });
  });
  asg.sort(function (x, y) { return new Date(x.deadline) - new Date(y.deadline); });
  exams.sort(function (x, y) { return new Date(y.createdAt) - new Date(x.createdAt); });
  const list = exams.slice(0, 120).map(function (e) { e.done = !!doneIds[e.id]; e.best = best[e.id] === undefined ? null : best[e.id]; return e; });
  const pending = asg.filter(function (x) { return x.status === 'wait' || x.status === 'missed'; });
  return { ok: true, display: a.display, now: new Date().toISOString(), assignments: asg, pendingCount: pending.length, exams: [], records: records.slice(0, 300) };
}
// 오답 복습: 이 시험의 내 가장 최근 제출에서 틀린 문항 (문제 그림 + 내 답 + 정답)

// 시험 제목 ↔ 문제은행 출처(파일 이름 등)를 느슨하게 맞춘다: .pdf·괄호·공백·특수문자를 빼고 비교, 한쪽이 다른 쪽을 포함하면 같은 시험으로 본다
function normTitle_(t) {
  return String(t || '').toLowerCase().replace(/\.pdf$/i, '').replace(/[\(\[（【][^\)\]）】]*[\)\]）】]/g, '').replace(/[\s_\-·.,~!@#$%^&*+=:;'"]+/g, '');
}
function sameTitle_(a, b) {
  const x = normTitle_(a), y = normTitle_(b);
  if (!x || !y) return false;
  if (x === y) return true;
  return Math.min(x.length, y.length) >= 6 && (x.indexOf(y) >= 0 || y.indexOf(x) >= 0);
}
// 이 시험의 문항 번호 → 문제은행 문항. 문제은행에서 조합한 시험은 sourceQuestionIds, 업로드한 시험은 출처 이름으로 찾는다.
function bankMapForExam_(qrows, title, srcIds, count) {
  const map = {}, byId = {};
  qrows.forEach(function (r) { if (r[0]) byId[String(r[0])] = r; });
  if (srcIds && srcIds.length === count) srcIds.forEach(function (id, i) { if (byId[String(id)]) map[i + 1] = byId[String(id)]; });
  const exact = {}, loose = {};
  qrows.forEach(function (r) {
    const n = Number(r[16]) || 0; if (n < 1) return;
    const src = String(r[3] || '');
    if (src === title) exact[n] = r; else if (sameTitle_(src, title) && !loose[n]) loose[n] = r;
  });
  for (let n = 1; n <= count; n++) if (!map[n]) { const r = exact[n] || loose[n]; if (r) map[n] = r; }
  return map;
}
function actionStuWrong_(p) {
  const a = stuAuth_(p); if (!a.ok) return a;
  const ck = 'sx_' + dataVer_() + '_' + nameKey_(a.display) + '_' + p.examId, hit = cacheGet_(ck); if (hit) return hit;
  const out = stuWrongBuild_(p, a); if (out && out.ok) cachePut_(ck, out, 300); return out;
}
function stuWrongBuild_(p, a) {
  const key = nameKey_(a.display), ss = SpreadsheetApp.getActiveSpreadsheet();
  const found = findExamRow_(ss.getSheetByName(SHEET_EXAMS), p.examId);
  if (!found) return { ok: false, error: '존재하지 않는 시험이에요.' };
  const sd = ss.getSheetByName(SHEET_SCORES).getDataRange().getValues();
  let mine = null;
  for (let i = sd.length - 1; i >= 1; i--) if (String(sd[i][0]) === String(p.examId) && nameKey_(sd[i][1]) === key) { mine = sd[i]; break; }
  if (!mine) return { ok: false, error: '아직 이 시험을 제출하지 않았어요.' };
  const correct = examAnswers_(found.row), my = String(mine[2]).split(',');
  const title = String(found.row[1]);
  const qd = questionsSheet_().getDataRange().getValues().slice(1), byNum = {};
  const bm = bankMapForExam_(qd, title, safeJson_(found.row[7], []), correct.length);
  Object.keys(bm).forEach(function (n) { byNum[n] = { fileId: String(bm[n][6] || ''), explFileId: String(bm[n][7] || '') }; });
  const hide = stuRevealHidden_(p.examId), evM = reviewEvents_(ss, key);
  const wrong = [];
  for (let i = 0; i < correct.length; i++) {
    if (isSubjective_(correct[i]) || my[i] === '~' || my[i] === undefined || my[i] === '') continue;
    if (ansMatches_(normAns_(my[i]), correct[i])) continue;
    const q = byNum[i + 1] || {}, itS = itemState_(evM[key + '|' + p.examId + '|' + (i + 1)], new Date(mine[5]).getTime(), Date.now());
    wrong.push({ n: i + 1, mine: my[i], correct: hide ? '' : correct[i], fileId: q.fileId || '', explFileId: hide ? '' : (q.explFileId || ''), done: itS.state === 'solved' || itS.state === 'mastered', state: itS.state, dueInDays: itS.dueInDays });
  }
  return { ok: true, title: title, submittedAt: mine[5], score100: mine[6], total: mine[4], wrong: wrong, hidden: hide, pdfUrl: found.row[4] ? 'https://drive.google.com/file/d/' + found.row[4] + '/view' : '' };
}
// 강사용: 학생 번호 초기화 / 가입한 학생 목록
function actionResetStudentPin_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const f = stuFind_(p.name);
  if (!f) return { ok: false, error: '가입한 학생이 아니에요.' };
  stuSheet_().deleteRow(f.rowIndex);
  CacheService.getScriptCache().remove('stufail_' + nameKey_(p.name));
  return { ok: true };
}
function actionListStudents_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const sh = stuSheet_(), out = [];
  if (sh.getLastRow() >= 2) sh.getRange(2, 1, sh.getLastRow() - 1, 7).getValues().forEach(function (r) { out.push({ name: String(r[0]), offRoster: !stuAllowed_(String(r[0])), createdAt: r[3], lastLogin: r[4], pending: String(r[6]) === 'pending', push: safeJson_(r[5], []).length > 0 }); });
  return { ok: true, students: out, reveal: PropertiesService.getScriptProperties().getProperty('STU_REVEAL') || 'always' };
}


// ────────────── 학생 알림 (Firebase 푸시) ──────────────
// 기한 3시간 안으로 남았는데 아직 안 낸 학생에게 한 번만 알려 준다 (10분마다 도는 checkDeadlines_ 에서 호출)
function remindSoon_(sh, data, ss) {
  const now = Date.now();
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    if (String(r[5]) === 'missed' && !r[10]) {          // 기한이 지나고 하루 뒤에도 못 냈으면 한 번 더 (3일 넘게 지난 건 보내지 않아요)
      const past = now - new Date(r[3]).getTime();
      if (past >= 24 * 3600 * 1000 && past <= 72 * 3600 * 1000) {
        sh.getRange(i + 2, 11).setValue(new Date().toISOString());
        pushToStudent_(r[2], '📌 아직 제출하지 않은 시험이 있어요', examTitleOf_(ss, r[1]) + ' · 기한이 지났어도 지금 제출하면 선생님이 확인해요');
      }
      continue;
    }
    if (String(r[5]) !== 'wait') continue;
    const left = new Date(r[3]).getTime() - now;
    if (!(left > 0)) continue;
    const title = examTitleOf_(ss, r[1]);
    if (!r[8] && left <= 3 * 3600 * 1000) {          // 기한 3시간 안: 한 번
      sh.getRange(i + 2, 9).setValue(new Date().toISOString());
      if (left <= 3600 * 1000) { sh.getRange(i + 2, 10).setValue(new Date().toISOString()); pushToStudent_(r[2], '⏰ 제출 기한 1시간 전이에요', title + ' · ' + fmtKst_(r[3]) + '까지 · 지금 제출해 주세요'); }
      else pushToStudent_(r[2], '⏳ 곧 제출 기한이에요', title + ' · ' + fmtKst_(r[3]) + '까지');
    } else if (r[8] && !r[9] && left <= 3600 * 1000) {      // 기한 1시간 안: 한 번 더
      sh.getRange(i + 2, 10).setValue(new Date().toISOString());
      pushToStudent_(r[2], '⏰ 제출 기한 1시간 전이에요', title + ' · ' + fmtKst_(r[3]) + '까지 · 지금 제출해 주세요');
    }
  }
}
function pendingCountFor_(name) {
  const key = nameKey_(name), sh = assignSheet_();
  if (sh.getLastRow() < 2) return 0;
  return sh.getRange(2, 1, sh.getLastRow() - 1, ASSIGN_HEADERS.length).getValues().filter(function (r) { return nameKey_(r[2]) === key && (String(r[5]) === 'wait' || String(r[5]) === 'missed'); }).length;
}
function fcmAccessToken_() {
  const pr = PropertiesService.getScriptProperties(), raw = pr.getProperty('FCM_SA');
  if (!raw) return null;
  const cache = CacheService.getScriptCache(), c = cache.get('fcm_at');
  if (c) return c;
  const sa = JSON.parse(raw), now = Math.floor(Date.now() / 1000);
  const b64 = function (o) { return Utilities.base64EncodeWebSafe(typeof o === 'string' ? o : JSON.stringify(o)).replace(/=+$/, ''); };
  const unsigned = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 });
  const sig = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(unsigned, sa.private_key)).replace(/=+$/, '');
  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', { method: 'post', payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + sig }, muteHttpExceptions: true });
  const j = JSON.parse(res.getContentText() || '{}');
  if (!j.access_token) throw new Error('FCM 인증 실패: ' + (j.error_description || j.error || res.getResponseCode()));
  cache.put('fcm_at', j.access_token, 3300);
  return j.access_token;
}
function stuTokens_(name) {
  const f = stuFind_(name); if (!f) return null;
  const list = safeJson_(f.row[5], []);
  return { rowIndex: f.rowIndex, tokens: Array.isArray(list) ? list : [] };
}
function pushToStudent_(name, title, body) {
  const pr = PropertiesService.getScriptProperties();
  if (!pr.getProperty('FCM_SA')) return false;
  const st = stuTokens_(name); if (!st || !st.tokens.length) return false;
  const pid = JSON.parse(pr.getProperty('FCM_SA')).project_id, at = fcmAccessToken_(), url = pr.getProperty('STU_APP_URL') || '';
  const count = String(pendingCountFor_(name)), keep = []; let okCount = 0; PUSH_LAST_ERR = '';
  st.tokens.forEach(function (tk) {
    const res = UrlFetchApp.fetch('https://fcm.googleapis.com/v1/projects/' + pid + '/messages:send', {
      method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + at }, muteHttpExceptions: true,
      payload: JSON.stringify({ message: { token: tk, data: { title: title, body: body, url: url, count: count } } })
    });
    const code = res.getResponseCode();
    if (code !== 200) PUSH_LAST_ERR = 'FCM ' + code + ': ' + String(res.getContentText()).slice(0, 240); else okCount++;
    if (code === 200 || !(code === 404 || code === 400)) keep.push(tk);      // 만료된 기기(404/400)만 목록에서 뺀다
  });
  if (keep.length !== st.tokens.length) stuSheet_().getRange(st.rowIndex, 6).setValue(JSON.stringify(keep));
  return okCount > 0;
}
let PUSH_LAST_ERR = '';
// ───────── 강사용 푸시 (선생님 폰·컴퓨터) ─────────
function teacherTokens_() { return safeJson_(PropertiesService.getScriptProperties().getProperty('TEACHER_TOKENS'), []); }
function missedCount_() { try { const sh = assignSheet_(), last = sh.getLastRow(); if (last < 2) return 0; let n = 0; sh.getRange(2, 6, last - 1, 1).getValues().forEach(function (r) { if (String(r[0]) === 'missed') n++; }); return n; } catch (e) { return 0; } }
function pushToTeacher_(title, body) {
  const pr = PropertiesService.getScriptProperties();
  if (!pr.getProperty('FCM_SA')) return false;
  const tokens = teacherTokens_(); if (!tokens.length) return false;
  const pid = JSON.parse(pr.getProperty('FCM_SA')).project_id, at = fcmAccessToken_(), url = pr.getProperty('TEACHER_APP_URL') || '', count = String(missedCount_()), keep = [];
  let okCount = 0; PUSH_LAST_ERR = '';
  tokens.forEach(function (tk) {
    const res = UrlFetchApp.fetch('https://fcm.googleapis.com/v1/projects/' + pid + '/messages:send', {
      method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + at }, muteHttpExceptions: true,
      payload: JSON.stringify({ message: { token: tk, data: { title: title, body: body, url: url, count: count, icon: 'icons/icon-192.png' } } })
    });
    const code = res.getResponseCode();
    if (code !== 200) PUSH_LAST_ERR = 'FCM ' + code + ': ' + String(res.getContentText()).slice(0, 240); else okCount++;
    if (code === 200 || !(code === 404 || code === 400)) keep.push(tk);
  });
  if (keep.length !== tokens.length) pr.setProperty('TEACHER_TOKENS', JSON.stringify(keep));
  return okCount > 0;
}
function actionTeacherPushInfo_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const pr = PropertiesService.getScriptProperties();
  return { ok: true, enabled: !!pr.getProperty('FCM_SA') && !!pr.getProperty('FCM_WEB'), web: safeJson_(pr.getProperty('FCM_WEB'), null), devices: teacherTokens_().length };
}
function actionTeacherSaveToken_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const tk = String(p.token || '').trim(); if (!tk) return { ok: false, error: '기기 정보가 없어요.' };
  const pr = PropertiesService.getScriptProperties();
  const list = teacherTokens_().filter(function (x) { return x !== tk; }); list.push(tk);
  pr.setProperty('TEACHER_TOKENS', JSON.stringify(list.slice(-5)));
  if (p.appUrl) pr.setProperty('TEACHER_APP_URL', String(p.appUrl));
  let tested = false;
  if (p.test) { try { tested = pushToTeacher_('🔔 선생님 알림이 켜졌어요', '학생이 제출하거나 기한을 놓치면 이렇게 알려 드려요.'); } catch (e) {} }
  return { ok: true, tested: tested, error: tested || !p.test ? '' : PUSH_LAST_ERR };
}
function actionStuSaveToken_(p) {
  const a = stuAuth_(p); if (!a.ok) return a;
  const tk = String(p.token || '').trim(); if (!tk) return { ok: false, error: '기기 정보가 없어요.' };
  const sh = stuSheet_(), cur = safeJson_(sh.getRange(a.rowIndex, 6).getValue(), []);
  const list = (Array.isArray(cur) ? cur : []).filter(function (x) { return x !== tk; }); list.push(tk);
  sh.getRange(a.rowIndex, 6).setValue(JSON.stringify(list.slice(-4)));         // 학생 한 명당 기기 4대까지
  if (p.appUrl) PropertiesService.getScriptProperties().setProperty('STU_APP_URL', String(p.appUrl));
  return { ok: true, push: !!PropertiesService.getScriptProperties().getProperty('FCM_SA') };
}
function actionStuPushInfo_(p) {
  const pr = PropertiesService.getScriptProperties();
  return { ok: true, enabled: !!pr.getProperty('FCM_SA') && !!pr.getProperty('FCM_WEB'), web: safeJson_(pr.getProperty('FCM_WEB'), null) };
}
// 강사용: 푸시 설정 저장 (Firebase 서비스 계정 JSON) / 테스트
function actionSetPushConfig_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const pr = PropertiesService.getScriptProperties();
  if (p.serviceAccount !== undefined) {
    const t = String(p.serviceAccount).trim();
    if (!t) { pr.deleteProperty('FCM_SA'); CacheService.getScriptCache().remove('fcm_at'); return { ok: true, enabled: false }; }
    let j; try { j = JSON.parse(t); } catch (e) { return { ok: false, error: 'JSON 형식이 아니에요. 파일 내용을 통째로 붙여넣어 주세요.' }; }
    if (!j.private_key || !j.client_email || !j.project_id) return { ok: false, error: '서비스 계정 JSON이 아니에요. (private_key, client_email, project_id가 있어야 해요)' };
    pr.setProperty('FCM_SA', JSON.stringify(j)); CacheService.getScriptCache().remove('fcm_at');
  }
  if (p.webConfig !== undefined) {
    const t = String(p.webConfig).trim();
    if (!t) pr.deleteProperty('FCM_WEB');
    else {
      let j = null;
      try { j = JSON.parse(t); } catch (e) {
        // 파이어베이스가 보여 주는 자바스크립트 모양(const firebaseConfig = { apiKey: "..", ... })도 받아 준다
        const o = {}; t.replace(/(\w+)\s*:\s*["']([^"']+)["']/g, function (m, k, v) { o[k] = v; return m; }); j = o;
      }
      if (!j || !j.apiKey || !j.projectId || !j.messagingSenderId || !j.appId) return { ok: false, error: '웹 앱 설정에 apiKey, projectId, messagingSenderId, appId가 모두 있어야 해요.' };
      if (p.vapidKey) j.vapidKey = String(p.vapidKey).trim();
      if (!j.vapidKey) return { ok: false, error: '웹 푸시 인증서 키(VAPID 키)가 필요해요.' };
      pr.setProperty('FCM_WEB', JSON.stringify(j));
    }
  }
  if (p.testName) {
    try { const ok = pushToStudent_(p.testName, '🔔 테스트 알림', '알림이 잘 오고 있어요!'); return { ok: true, enabled: true, tested: ok, error: ok ? '' : (PUSH_LAST_ERR || '그 학생은 아직 알림을 켜지 않았어요.') }; }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
  }
  return { ok: true, enabled: !!pr.getProperty('FCM_SA'), webOk: !!pr.getProperty('FCM_WEB') };
}

function actionApproveStudent_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const names = p.all ? null : [].concat(p.name);
  const sh = stuSheet_(), last = sh.getLastRow(); let n = 0;
  if (last >= 2) sh.getRange(2, 1, last - 1, 7).getValues().forEach(function (r, i) {
    if (String(r[6]) !== 'pending') return;
    if (names && names.map(nameKey_).indexOf(nameKey_(r[0])) < 0) return;
    sh.getRange(i + 2, 7).setValue('ok'); n++;
  });
  return { ok: true, approved: n };
}


// ────────────── 보완: 자동 백업 · 이름 추천 · 정답 공개 시점 · 통계 ──────────────
function hasTrigger_(fn) {
  try { return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === fn; }); } catch (e) { return false; }
}
// 매주 일요일 새벽에 시트를 통째로 복사해 두고, 자동 백업은 최근 8개만 남긴다
function autoBackup_() {
  makeBackup_('자동');
  const it = DriveApp.getFoldersByName('자동채점 백업');
  if (!it.hasNext()) return;
  const files = [], fi = it.next().getFiles();
  while (fi.hasNext()) { const f = fi.next(); if (/ 자동$/.test(f.getName())) files.push(f); }
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  files.slice(8).forEach(function (f) { f.setTrashed(true); });
}
function actionInstallBackup_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  try {
    if (!hasTrigger_('autoBackup_')) ScriptApp.newTrigger('autoBackup_').timeBased().onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(3).create();
    return { ok: true };
  } catch (e) { return { ok: false, error: '자동 백업을 켜지 못했어요: ' + e.message + ' (편집기에서 setupAlerts를 한 번 실행해 권한을 허용해 주세요)' }; }
}
function lev_(a, b) {
  const m = a.length, n = b.length; if (!m) return n; if (!n) return m;
  let prev = []; for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[n];
}
// 시험 화면에서 이름을 잘못 적은 것 같으면 비슷한 이름을 추천한다 (반 명단·예약·가입 학생 기준)
function actionSuggestName_(p) {
  const key = nameKey_(p.name); if (key.length < 2) return { ok: true, exact: false, suggestions: [] };
  const known = {}, ss = SpreadsheetApp.getActiveSpreadsheet();
  const rs = ss.getSheetByName(SHEET_ROSTER);
  if (rs && rs.getLastRow() >= 2) rs.getRange(2, 1, rs.getLastRow() - 1, 2).getValues().forEach(function (r) { safeJson_(r[1], []).forEach(function (n) { known[nameKey_(n)] = String(n).trim(); }); });
  const sh = assignSheet_();
  if (sh.getLastRow() >= 2) sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function (r) { if (!p.examId || String(r[1]) === String(p.examId)) known[nameKey_(r[2])] = String(r[2]).trim(); });
  if (known[key]) return { ok: true, exact: true, name: known[key], suggestions: [] };
  const out = [];
  Object.keys(known).forEach(function (k) { if (Math.abs(k.length - key.length) <= 1 && lev_(k, key) <= 1) out.push(known[k]); });
  return { ok: true, exact: false, suggestions: out.slice(0, 3) };
}
function actionSetStuOptions_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  if (p.reveal === 'always' || p.reveal === 'after') PropertiesService.getScriptProperties().setProperty('STU_REVEAL', p.reveal);
  return { ok: true, reveal: PropertiesService.getScriptProperties().getProperty('STU_REVEAL') || 'always' };
}
// 정답 공개를 「기한 뒤」로 해 두었고, 이 시험에 아직 기한이 안 지난 예약이 있으면 정답을 가린다
function stuRevealHidden_(examId) {
  if ((PropertiesService.getScriptProperties().getProperty('STU_REVEAL') || 'always') !== 'after') return false;
  const sh = assignSheet_(); if (sh.getLastRow() < 2) return false;
  const now = Date.now();
  return sh.getRange(2, 1, sh.getLastRow() - 1, ASSIGN_HEADERS.length).getValues().some(function (r) { return String(r[1]) === String(examId) && String(r[5]) === 'wait' && new Date(r[3]).getTime() > now; });
}

// 통계: 시험별 제출 수·평균, 오래 안 낸 학생
function actionStatsOverview_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ed = ss.getSheetByName(SHEET_EXAMS).getDataRange().getValues(), sd = ss.getSheetByName(SHEET_SCORES).getDataRange().getValues();
  const agg = {};
  for (let i = 1; i < sd.length; i++) { const id = String(sd[i][0]), a = agg[id] || (agg[id] = { n: 0, sum: 0, cnt: 0 }); a.n++; if (Number(sd[i][4])) { a.sum += Number(sd[i][6]) || 0; a.cnt++; } }
  const exams = [];
  for (let i = 1; i < ed.length; i++) { const id = String(ed[i][0]); if (!id) continue; const a = agg[id] || { n: 0, sum: 0, cnt: 0 }; exams.push({ id: id, title: String(ed[i][1]), createdAt: ed[i][3], submissions: a.n, avg: a.cnt ? Math.round(a.sum / a.cnt) : null }); }
  exams.sort(function (x, y) { return new Date(y.createdAt) - new Date(x.createdAt); });
  const miss = {}, sh = assignSheet_();
  if (sh.getLastRow() >= 2) sh.getRange(2, 1, sh.getLastRow() - 1, ASSIGN_HEADERS.length).getValues().forEach(function (r) {
    const st = String(r[5]); const m = miss[nameKey_(r[2])] || (miss[nameKey_(r[2])] = { name: String(r[2]), missed: 0, late: 0, total: 0 });
    m.total++; if (st === 'missed') m.missed++; if (st === 'late') m.late++;
  });
  const overdue = Object.keys(miss).map(function (k) { return miss[k]; }).filter(function (m) { return m.missed || m.late; }).sort(function (a, b) { return (b.missed * 2 + b.late) - (a.missed * 2 + a.late); }).slice(0, 15);
  return { ok: true, exams: exams.slice(0, 60), overdue: overdue };
}
// 한 시험: 문항별 정답률(자주 틀리는 문항), 학생별 점수 (학생마다 가장 최근 제출만)
function actionStatsExam_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const found = findExamRow_(ss.getSheetByName(SHEET_EXAMS), p.id);
  if (!found) return { ok: false, error: '존재하지 않는 시험이에요.' };
  const correct = examAnswers_(found.row), sd = ss.getSheetByName(SHEET_SCORES).getDataRange().getValues(), latest = {};
  for (let i = 1; i < sd.length; i++) if (String(sd[i][0]) === String(p.id)) latest[nameKey_(sd[i][1])] = sd[i];
  const q = correct.map(function () { return { ok: 0, x: 0, wrongAns: {} }; }), students = [];
  Object.keys(latest).forEach(function (k) {
    const r = latest[k], my = String(r[2]).split(',');
    for (let i = 0; i < correct.length; i++) {
      if (isSubjective_(correct[i]) || my[i] === '~' || my[i] === undefined || my[i] === '') continue;
      if (ansMatches_(normAns_(my[i]), correct[i])) q[i].ok++; else { q[i].x++; q[i].wrongAns[my[i]] = (q[i].wrongAns[my[i]] || 0) + 1; }
    }
    students.push({ name: String(r[1]), score100: Number(r[6]) || 0, score: r[3], total: r[4], at: r[5] });
  });
  const items = q.map(function (o, i) {
    const n = o.ok + o.x; let top = '', tc = 0; Object.keys(o.wrongAns).forEach(function (a) { if (o.wrongAns[a] > tc) { tc = o.wrongAns[a]; top = a; } });
    return { n: i + 1, answer: correct[i], tried: n, rate: n ? Math.round(o.ok / n * 100) : null, topWrong: top, topWrongCount: tc, subjective: isSubjective_(correct[i]) };
  });
  students.sort(function (a, b) { return b.score100 - a.score100; });
  return { ok: true, title: String(found.row[1]), items: items, students: students };
}

// 오답노트 QR: 틀린 문항만 다시 풀어 보기. 정답은 알려주지 않고 맞았는지(ok/x)만 돌려준다. 시험 점수 기록에는 넣지 않고 「Retries」 시트에만 남긴다.
function actionRetryCheck_(p) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const found = findExamRow_(ss.getSheetByName(SHEET_EXAMS), p.id);
  if (!found) return { ok: false, error: '존재하지 않는 시험이에요.' };
  const correct = examAnswers_(found.row), results = {};
  let okN = 0, tried = 0;
  (p.answers || []).forEach(function (it) {
    const n = Number(it.n); if (!(n >= 1 && n <= correct.length)) return;
    if (isSubjective_(correct[n - 1])) { results[n] = 'subj'; return; }
    const a = normAns_(it.a);
    if (!a) return;
    tried++;
    if (ansMatches_(a, correct[n - 1])) { results[n] = 'ok'; okN++; } else results[n] = 'x';
  });
  try {
    const sh = ensureSheet_(ss, 'Retries', ['examId', 'studentName', 'tried', 'correct', 'at']);
    sh.appendRow([p.id, String(p.studentName || '이름없음'), tried, okN, new Date().toISOString()]);
    if (p.studentName) { const cl = ensureSheet_(ss, 'Cleared', ['examId', 'name', 'n', 'at']), nowIso = new Date().toISOString(); Object.keys(results).forEach(function (n) { if (results[n] === 'ok') cl.appendRow([String(p.id), String(p.studentName).trim(), Number(n), nowIso]); else if (results[n] === 'x') ensureSheet_(ss, 'ReviewFail', ['examId', 'name', 'n', 'at']).appendRow([String(p.id), String(p.studentName).trim(), Number(n), nowIso]); }); }
  } catch (e) {}
  return { ok: true, results: results, tried: tried, correct: okN };
}

// 오답 다시 풀기 기록 조회 (강사용): 시험 기록 화면에 「오답노트」 배지로 함께 보여준다
function actionRetryLog_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('Retries');
  if (!sh) return { ok: true, rows: [] };
  const titleOf = {};
  ss.getSheetByName(SHEET_EXAMS).getDataRange().getValues().slice(1).forEach(function (r) { titleOf[String(r[0])] = String(r[1]); });
  const rows = sh.getDataRange().getValues().slice(1).map(function (r) {
    return { examId: String(r[0]), examTitle: titleOf[String(r[0])] || '(삭제된 시험)', studentName: String(r[1]), total: Number(r[2]) || 0, score: Number(r[3]) || 0, submittedAt: String(r[4]) };
  });
  rows.reverse();
  return { ok: true, rows: rows.slice(0, 300) };
}

// ───────── 약점 분석: 오답률 높은 문항 · 반복 오답 ─────────
// 시험 문항 → 문제은행 문항 연결: 문제은행에서 조합한 시험은 sourceQuestionIds로, 시험지로 올린 시험은 (시험 제목, 번호)로 찾는다.
// 반환: items(문항별 오답 통계, onlyKey 없을 때만), students(학생별 반복 오답·약점 단원)
const WEAK_Q_REPEAT = 2;      // 같은 문항을 이 횟수 이상 틀리면 "반복 오답"
const WEAK_UNIT_SCORE = 70;   // 한 시험에서 한 단원 점수가 이 점수 미만이고
const WEAK_UNIT_EXAMS = 2;    // 그런 시험이 이 개수 이상이면 "약점 단원" (단원 문항이 2개 이상인 시험만 셈)
function weakBuild_(ss, onlyKey) {
  const exam = {};
  ss.getSheetByName(SHEET_EXAMS).getDataRange().getValues().slice(1).forEach(function (r) {
    if (!r[0]) return;
    exam[String(r[0])] = { id: String(r[0]), title: String(r[1]), correct: examAnswers_(r), src: safeJson_(r[7], []) };
  });
  const qById = {}, qByTN = {};
  questionsSheet_().getDataRange().getValues().slice(1).forEach(function (r) {
    if (!r[0]) return;
    const q = { id: String(r[0]), unit: String(r[1] || ''), source: String(r[3] || ''), fileId: String(r[6] || ''), grade: String(r[12] || ''), num: Number(r[16]) || 0 };
    qById[q.id] = q; if (q.source && q.num > 0) qByTN[q.source + '|' + q.num] = q;
  });
  const qrowsAll = questionsSheet_().getDataRange().getValues().slice(1), bmCache = {};
  const resolve = function (e, n) {
    if (e.src.length === e.correct.length && e.src[n - 1] && qById[String(e.src[n - 1])]) return qById[String(e.src[n - 1])];
    if (!bmCache[e.id]) { const m = bankMapForExam_(qrowsAll, e.title, [], e.correct.length), o = {}; Object.keys(m).forEach(function (k) { o[k] = qById[String(m[k][0])]; }); bmCache[e.id] = o; }
    return bmCache[e.id][n] || qByTN[e.title + '|' + n] || null;
  };
  const clr = {};      // 학생이 다시 풀어서 맞힌 기록 (이름|시험|번호 → 마지막으로 맞힌 시각). 그 뒤로 또 틀리지 않았다면 반복 오답에서 뺀다
  try { const cs = ss.getSheetByName('Cleared'); if (cs && cs.getLastRow() >= 2) cs.getRange(2, 1, cs.getLastRow() - 1, 4).getValues().forEach(function (r) { const k = nameKey_(r[1]) + '|' + r[0] + '|' + r[2], t = new Date(r[3]).getTime(); if (!(clr[k] >= t)) clr[k] = t; }); } catch (e) {}
  const items = {}, stu = {};
  ss.getSheetByName(SHEET_SCORES).getDataRange().getValues().slice(1).forEach(function (r) {
    const e = exam[String(r[0])]; if (!e) return;
    const key = nameKey_(r[1]), mine = !onlyKey || key === onlyKey;
    if (onlyKey && !mine) return;
    const given = String(r[2]).split(',');
    const st = mine ? (stu[key] || (stu[key] = { name: String(r[1]), q: {}, ue: {}, seen: {}, subs: 0 })) : null;
    const cur = {}, rts = new Date(r[5]).getTime();
    if (st) st.subs++;
    for (let n = 1; n <= e.correct.length; n++) {
      const c = e.correct[n - 1]; if (isSubjective_(c)) continue;
      const g = (given[n - 1] || '').trim(); if (g === '~') continue;
      const bq = resolve(e, n), ik = bq ? bq.id : (e.id + '|' + n), bad = !ansMatches_(g, c);
      if (!onlyKey) {
        const it = items[ik] || (items[ik] = { key: ik, qid: bq ? bq.id : '', examTitle: e.title, n: n, unit: bq ? bq.unit : '', grade: bq ? bq.grade : '', fileId: bq ? bq.fileId : '', tried: 0, wrong: 0 });
        it.tried++; if (bad) it.wrong++;
      }
      if (st) {
        if (bq) st.seen[bq.id] = 1;
        const badEff = bad && !(clr[key + '|' + e.id + '|' + n] >= rts);      // 다시 풀어서 맞힌 문항은 맞은 것으로 본다
        if (badEff) {
          const x = st.q[ik] || (st.q[ik] = { qid: bq ? bq.id : '', examTitle: e.title, n: n, unit: bq ? bq.unit : '', times: 0 });
          x.times++;
        }
        if (bq && bq.unit) { const u = cur[bq.unit] || (cur[bq.unit] = { tried: 0, wrong: 0 }); u.tried++; if (badEff) u.wrong++; }
      }
    }
    if (st) Object.keys(cur).forEach(function (un) { (st.ue[un] = st.ue[un] || {})[e.id] = cur[un]; });      // 같은 시험을 다시 냈으면 가장 최근 점수로 바꾼다
  });
  const students = {};
  Object.keys(stu).forEach(function (k) {
    const st = stu[k];
    const repeatQ = Object.keys(st.q).map(function (x) { return st.q[x]; }).filter(function (x) { return x.times >= WEAK_Q_REPEAT; }).sort(function (a, b) { return b.times - a.times; });
    const weakUnits = Object.keys(st.ue).map(function (un) {
      const low = Object.keys(st.ue[un]).map(function (id) { return st.ue[un][id]; }).filter(function (u) { return u.tried >= 2 && (u.tried - u.wrong) / u.tried * 100 < WEAK_UNIT_SCORE; });
      return { unit: un, count: low.length, avg: low.length ? Math.round(low.reduce(function (a, u) { return a + (u.tried - u.wrong) / u.tried * 100; }, 0) / low.length) : 0 };
    }).filter(function (u) { return u.count >= WEAK_UNIT_EXAMS; }).sort(function (a, b) { return b.count - a.count || a.avg - b.avg; });
    students[k] = { name: st.name, repeatQ: repeatQ, weakUnits: weakUnits, seen: st.seen };
  });
  return { items: Object.keys(items).map(function (k) { return items[k]; }), students: students, qById: qById };
}

// 강사용: 오답률 높은 문항 + 반복 오답 학생(유사 문항 후보 포함)
function actionWeakReport_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  if (p.countOnly) { const c = cacheGet_('c_weak_count'); if (c) return c; }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const w = weakBuild_(ss, '');
  const minTried = Math.max(1, Number(p.minTried) || 3), minRate = Math.max(1, Math.min(100, Number(p.minRate) || 50));
  const hard = w.items.filter(function (i) { return i.tried >= minTried && i.wrong / i.tried * 100 >= minRate; })
    .map(function (i) { i.rate = Math.round(i.wrong / i.tried * 100); return i; })
    .sort(function (a, b) { return b.rate - a.rate || b.tried - a.tried; }).slice(0, 120);
  const byUnit = {};
  Object.keys(w.qById).forEach(function (id) { const q = w.qById[id]; if (q.unit) (byUnit[q.unit] = byUnit[q.unit] || []).push(id); });
  const students = [];
  Object.keys(w.students).forEach(function (k) {
    const st = w.students[k];
    if (!st.repeatQ.length && !st.weakUnits.length) return;
    const similar = [];
    st.weakUnits.forEach(function (u) { (byUnit[u.unit] || []).filter(function (id) { return !st.seen[id]; }).slice(0, 8).forEach(function (id) { similar.push(id); }); });
    students.push({ name: st.name, repeatQ: st.repeatQ.slice(0, 10), weakUnits: st.weakUnits, similarIds: similar });
  });
  students.sort(function (a, b) { return (b.repeatQ.length + b.weakUnits.length) - (a.repeatQ.length + a.weakUnits.length); });
  const out = { ok: true, hard: hard, students: students, count: students.length };
  if (p.countOnly) { const lite = { ok: true, hard: [], students: [], count: students.length }; cachePut_('c_weak_count', lite, 600); return lite; }
  return out;
}

// 한 학생의 반복 오답 요약 (학생 앱·제출 알림용)
function weakOfStudent_(ss, name) {
  try { const w = weakBuild_(ss, nameKey_(name)), st = w.students[nameKey_(name)]; return st ? { repeatQ: st.repeatQ.slice(0, 5), weakUnits: st.weakUnits.slice(0, 3) } : { repeatQ: [], weakUnits: [] }; } catch (e) { return { repeatQ: [], weakUnits: [] }; }
}
function weakText_(wk, examTitle) {
  const bits = [];
  wk.repeatQ.forEach(function (x) { if (!examTitle || x.examTitle === examTitle) bits.push(x.examTitle + ' ' + x.n + '번(' + x.times + '번째 오답)'); });
  wk.weakUnits.forEach(function (u) { bits.push('「' + u.unit + '」 단원 ' + u.count + '개 시험에서 ' + WEAK_UNIT_SCORE + '점 미만'); });
  return bits.slice(0, 4).join(', ');
}


// ────────────── 오답 복습 (간격 복습 · 연속 일수 · 칭찬) ──────────────
// 흐름: 못 푼 문제(todo) → 다시 풀어서 맞힘(solved, 3일 뒤 다시 확인) → 3일 뒤 다시 맞힘(mastered 완전 해결)
//       중간에 한 번이라도 틀리면 다시 todo.  solved 상태로 3일이 지나면 due(다시 확인할 문제)로 바뀐다.
const REVIEW_GAP_MS = 3 * 24 * 3600 * 1000;
// 맞힘(Cleared)/틀림(ReviewFail) 기록 → "이름|시험|번호" 별 시간순 목록. onlyKey 가 있으면 그 학생 것만.
function reviewEvents_(ss, onlyKey) {
  const out = {};
  [['Cleared', true], ['ReviewFail', false]].forEach(function (d) {
    try {
      const sh = ss.getSheetByName(d[0]); if (!sh || sh.getLastRow() < 2) return;
      sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues().forEach(function (r) {
        const k = nameKey_(r[1]); if (onlyKey && k !== onlyKey) return;
        const t = new Date(r[3]).getTime(); if (!t) return;
        const id = k + '|' + r[0] + '|' + r[2];
        (out[id] || (out[id] = [])).push({ t: t, ok: d[1] });
      });
    } catch (e) {}
  });
  Object.keys(out).forEach(function (k) { out[k].sort(function (a, b) { return a.t - b.t; }); });
  return out;
}
function itemState_(evs, subTs, now) {
  let stage = 'todo', solvedAt = 0;
  (evs || []).forEach(function (e) {
    if (e.t < subTs) return;
    if (!e.ok) { stage = 'todo'; solvedAt = 0; return; }
    if (stage === 'todo') { stage = 'solved'; solvedAt = e.t; }
    else if (stage === 'solved' && e.t - solvedAt >= REVIEW_GAP_MS) stage = 'mastered';
  });
  if (stage === 'solved') {
    const left = solvedAt + REVIEW_GAP_MS - now;
    if (left <= 0) return { state: 'due', dueInDays: 0 };
    return { state: 'solved', dueInDays: Math.ceil(left / (24 * 3600 * 1000)) };
  }
  return { state: stage, dueInDays: 0 };
}
function kstDay_(t) { return Utilities.formatDate(new Date(t), 'Asia/Seoul', 'yyyy-MM-dd'); }
// 학생별 복습 현황 (onlyKey 없으면 전체 학생)
function reviewCore_(ss, onlyKey) {
  const now = Date.now(), evM = reviewEvents_(ss, onlyKey);
  const exam = {};
  ss.getSheetByName(SHEET_EXAMS).getDataRange().getValues().slice(1).forEach(function (r) { if (r[0]) exam[String(r[0])] = { title: String(r[1]), correct: examAnswers_(r) }; });
  const latest = {};
  ss.getSheetByName(SHEET_SCORES).getDataRange().getValues().slice(1).forEach(function (r) {
    const key = nameKey_(r[1]); if (!key || (onlyKey && key !== onlyKey) || !exam[String(r[0])]) return;
    const id = key + '|' + r[0], t = new Date(r[5]).getTime() || 0;
    if (!latest[id] || t >= latest[id].t) latest[id] = { key: key, name: String(r[1]), examId: String(r[0]), given: String(r[2]).split(','), t: t };
  });
  const stu = {};
  const get = function (key, name) { return stu[key] || (stu[key] = { name: name, total: 0, todo: 0, due: 0, solved: 0, mastered: 0, okTotal: 0, byExam: {}, days: {}, lastAt: 0 }); };
  Object.keys(latest).forEach(function (id) {
    const L = latest[id], e = exam[L.examId], s = get(L.key, L.name);
    for (let i = 0; i < e.correct.length; i++) {
      const c = e.correct[i], g = L.given[i];
      if (isSubjective_(c) || g === '~' || g === undefined || g === '') continue;
      if (ansMatches_(normAns_(g), c)) continue;
      const st = itemState_(evM[L.key + '|' + L.examId + '|' + (i + 1)], L.t, now);
      s.total++; s[st.state]++;
      const b = s.byExam[L.examId] || (s.byExam[L.examId] = { total: 0, done: 0 });
      b.total++; if (st.state === 'solved' || st.state === 'mastered') b.done++;
    }
  });
  Object.keys(evM).forEach(function (k) {
    const key = k.split('|')[0], s = stu[key]; if (!s) return;
    evM[k].forEach(function (e) { s.days[kstDay_(e.t)] = 1; if (e.ok) s.okTotal++; if (e.t > s.lastAt) s.lastAt = e.t; });
  });
  const today = kstDay_(now), yest = kstDay_(now - 24 * 3600 * 1000);
  Object.keys(stu).forEach(function (key) {
    const s = stu[key]; let streak = 0, t = s.days[today] ? now : (s.days[yest] ? now - 24 * 3600 * 1000 : 0);
    while (t && s.days[kstDay_(t)]) { streak++; t -= 24 * 3600 * 1000; }
    s.streak = streak; s.today = !!s.days[today];
  });
  return stu;
}
// 학생 화면용
function reviewProgress_(ss, name) {
  const key = nameKey_(name);
  try {
    const s = reviewCore_(ss, key)[key];
    if (!s) return { total: 0, done: 0, todo: 0, due: 0, mastered: 0, streak: 0, okTotal: 0, today: false, byExam: {} };
    return { total: s.total, done: s.solved + s.mastered, todo: s.todo, due: s.due, mastered: s.mastered, streak: s.streak, okTotal: s.okTotal, today: s.today, byExam: s.byExam };
  } catch (e) { return { total: 0, done: 0, todo: 0, due: 0, mastered: 0, streak: 0, okTotal: 0, today: false, byExam: {} }; }
}
// 선생님용: 학생별 복습 현황
function actionReviewReport_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const ss = SpreadsheetApp.getActiveSpreadsheet(), st = reviewCore_(ss, null), now = Date.now();
  const rows = Object.keys(st).map(function (k) {
    const s = st[k];
    return { name: s.name, total: s.total, todo: s.todo, due: s.due, solved: s.solved, mastered: s.mastered, streak: s.streak, okTotal: s.okTotal, lastAt: s.lastAt ? new Date(s.lastAt).toISOString() : '', idleDays: s.lastAt ? Math.floor((now - s.lastAt) / (24 * 3600 * 1000)) : null };
  }).filter(function (r) { return r.total > 0; });
  rows.sort(function (a, b) { return (b.todo + b.due) - (a.todo + a.due); });
  return { ok: true, rows: rows };
}
// 매일 저녁 6시: 복습할 문제가 남은 학생에게 푸시
function dailyReviewPush_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(), st = reviewCore_(ss, null);
  Object.keys(st).forEach(function (k) {
    const s = st[k], left = s.todo + s.due; if (!left || s.today) return;
    const body = s.due ? '다시 확인할 문제 ' + s.due + '개 포함 · 5분이면 끝나요' : '틀린 문제 다시 풀면 점점 줄어들어요';
    const head = s.streak > 0 ? '🔥 ' + s.streak + '일 연속 복습 중! 오늘 복습할 문제 ' + left + '개' : '📝 오늘 복습할 문제 ' + left + '개';
    try { pushToStudent_(s.name, head, body); } catch (e) {}
  });
}
function ensureDailyReview_() {
  try {
    const c = CacheService.getScriptCache(); if (c.get('daily_rv')) return;
    if (!hasTrigger_('dailyReviewPush_')) ScriptApp.newTrigger('dailyReviewPush_').timeBased().everyDays(1).atHour(18).inTimezone('Asia/Seoul').create();
    c.put('daily_rv', '1', 21600);
  } catch (e) {}
}


// 홈 화면 배지(새 제출·미제출, 가입 승인 대기, 반복 오답)를 한 번에 — 요청을 3번 보내던 것을 1번으로
function actionHomeBadges_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const out = { ok: true };
  try { out.alerts = actionListAlerts_(p); } catch (e) { out.alerts = null; }
  try { const r = actionListStudents_(p); out.pending = r.ok ? r.students.filter(function (x) { return x.pending; }).length : 0; } catch (e) { out.pending = 0; }
  try { const w = actionWeakReport_({ password: p.password, countOnly: true }); out.weak = w.ok ? w.count : 0; } catch (e) { out.weak = 0; }
  return out;
}
