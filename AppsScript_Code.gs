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
    switch (action) {
      case 'login': result = actionLogin_(params); break;
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

function actionListExams_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const examsData = ss.getSheetByName(SHEET_EXAMS).getDataRange().getValues();
  const scoresData = ss.getSheetByName(SHEET_SCORES).getDataRange().getValues();

  const countByExam = {};
  for (let i = 1; i < scoresData.length; i++) {
    const eid = String(scoresData[i][0]);
    countByExam[eid] = (countByExam[eid] || 0) + 1;
  }

  const exams = [];
  for (let i = 1; i < examsData.length; i++) {
    const row = examsData[i];
    exams.push({
      id: row[0], title: row[1],
      answerCount: examAnswers_(row).length,
      subjectiveCount: subjectiveNumbers_(examAnswers_(row)).length,
      createdAt: row[3], pdfUrl: row[5],
      hasRecipe: !!row[8] && !((safeJson_(row[8], null) || {}).book),
      bookTitle: ((safeJson_(row[8], null) || {}).bookTitle) || '',
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
  const studentAnswers = (p.answers || []).map(normAns_);   // 복수정답은 "35"처럼 정리해서 비교
  let score = 0, objective = 0;
  for (let i = 0; i < correctAnswers.length; i++) {
    if (isSubjective_(correctAnswers[i])) continue;      // 주관식은 자동 채점에서 뺀다
    objective++;
    if (ansMatches_(studentAnswers[i], correctAnswers[i])) score++;
  }

  // 100점 만점 환산 (객관식만 채점, 주관식은 합산하지 않음)
  const score100 = objective ? Math.round(score / objective * 100) : 0;

  const scoresSheet = ss.getSheetByName(SHEET_SCORES);
  scoresSheet.appendRow([
    p.id, p.studentName || '이름없음', studentAnswers.join(','),
    score, objective, new Date().toISOString(), score100,
  ]);

  return {
    ok: true, score: score, total: objective, score100: score100, subjective: subjectiveNumbers_(correctAnswers),
    correctAnswers: correctAnswers, studentAnswers: studentAnswers,
    explUrl: found.row[6] || '',
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

function actionSaveQuestions_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
  const folder = getBankFolder_();
  try {
    if (folder.getSharingAccess() !== DriveApp.Access.ANYONE_WITH_LINK) folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {}
  const state = {};
  const sheet = questionsSheet_();
  const rows = [];
  (p.questions || []).forEach(function (q) {
    const blob = Utilities.newBlob(Utilities.base64Decode(q.imageBase64), 'image/png', q.id + '.png');
    const file = makeBankFile_(folder, blob, state);
    let explId = '';
    if (q.explBase64) {
      const eb = Utilities.newBlob(Utilities.base64Decode(q.explBase64), 'image/png', q.id + '_expl.png');
      const ef = makeBankFile_(folder, eb, state);
      explId = ef.getId();
    }
    rows.push([q.id, q.unit, normAns_(q.answer), q.source || '', q.textPreview || '', new Date().toISOString(), file.getId(), explId, q.difficulty || '', (q.diffScore === undefined || q.diffScore === null) ? '' : q.diffScore,
      q.numRect ? JSON.stringify(q.numRect) : '', q.explNumRect ? JSON.stringify(q.explNumRect) : '',
      cleanText_(q.grade, 20), normKind_(q.kind), cleanText_(q.school, 80), normYear_(q.year), numOrBlank_(q.num), numOrBlank_(q.head), cleanText_(q.sub, 80), q.auto ? (Number(q.auto) || 1) : '']);
  });
  if (rows.length) {
    // 여러 저장 요청이 동시에 와도 행이 겹쳐 쓰이지 않게, 시트에 쓰는 순간만 잠근다
    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try { sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 20).setValues(rows); }
    finally { lock.releaseLock(); }
  }
  return { ok: true, saved: rows.length };
}

// 시트에 JSON 문자열로 저장한 [x0,top,x1,bottom]을 배열로 읽는다 (없거나 깨졌으면 null)
function parseRect_(v) {
  if (!v) return null;
  try { const a = JSON.parse(v); return (Array.isArray(a) && a.length === 4 && a.every(function (n) { return isFinite(n); })) ? a : null; } catch (e) { return null; }
}

function actionListQuestions_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
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

function actionListSubmissions_(p) {
  if (!checkPassword_(p.password)) return { ok: false, error: '로그인이 필요해요.' };
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
    subs.push({
      examId: r[0], examTitle: ex ? ex.title : '(삭제된 시험)', studentName: r[1],
      answers: r[2], score: r[3], total: r[4], submittedAt: r[5],
      score100: (r[6] === '' || r[6] === undefined) ? score100_(Number(r[3]), Number(r[4])) : Number(r[6]),
      correctAnswers: ex ? ex.correctAnswers : [],
      sourceQuestionIds: ex ? ex.sourceQuestionIds : [],
    });
  }
  subs.reverse();  // 최신 순
  return { ok: true, submissions: subs };
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
