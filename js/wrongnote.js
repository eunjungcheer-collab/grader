// 오답노트 · 오답문제 다시풀기 공용 코드 (시험 기록 · 시험 알림 화면에서 같이 쓴다)
function itemResults(s) {
  const correct = s.correctAnswers || [], given = String(s.answers || '').split(',');
  return correct.map((c, i) => ({ n: i + 1, given: (given[i] || '').trim(), correct: c, subj: c === '-', skip: isSkipAns(given[i]), ok: c !== '-' && answerMatches(given[i], c) }));
}
function wrongNumsOf(s) { return itemResults(s).filter(r => !r.subj && !r.skip && !r.ok).map(r => r.n); }
// listSubmissions 결과에 시험 제목·정답·출제 문항 id를 붙인다
let WN_EXAMS = {};      // 시험 id → { sourceQuestionIds } (같은 문제를 다른 시험에서 또 틀렸는지 세는 데 쓴다)
function wnHydrate(res) {
  const ex = res.exams || {}; Object.keys(ex).forEach(k => { WN_EXAMS[k] = ex[k]; });
  return (res.submissions || []).map(r => {
    const e = ex[String(r.examId)];
    if (e) { if (r.examTitle === undefined) r.examTitle = e.title; if (!r.correctAnswers) r.correctAnswers = e.correctAnswers || []; if (!r.sourceQuestionIds) r.sourceQuestionIds = e.sourceQuestionIds || []; }
    else if (r.examTitle === undefined) { r.examTitle = '(삭제된 시험)'; r.correctAnswers = r.correctAnswers || []; r.sourceQuestionIds = r.sourceQuestionIds || []; }
    return r;
  });
}
function rangeInfo(q, picks) {
  const m = String(q.textPreview || '').match(/^\s*[\[(【]\s*(\d{1,2})\s*[~∼～\-–]\s*(\d{1,2})\s*(?:번)?\s*[\])】]/);
  if (!m) return null;
  const k = parseInt(m[2], 10) - parseInt(m[1], 10) + 1;
  if (!(k >= 2 && k <= 4)) return null;
  const a0 = parseInt(m[1], 10), b0 = parseInt(m[2], 10);
  if (picks && picks.some(o => o !== q && o.source === q.source && o.num > a0 && o.num <= b0)) return null;
  const ans = String(q.answer || '').trim();
  let parts = null;
  if (/^\d+$/.test(ans) && ans.length === k) parts = ans.split('');
  else if (/^[\d\-]+([,\s]+[\d\-]+)+$/.test(ans)) parts = ans.split(/[,\s]+/);
  return parts && parts.length === k ? { k: k } : null;
}
async function wnGather(s, opt, say, ctx) {
  ctx = ctx || {}; let wnNote = '';
  const wrong = itemResults(s).filter(r => !r.subj && !r.skip && !r.ok && (!opt.onlyNums || opt.onlyNums.indexOf(r.n) >= 0));
  if (!wrong.length) throw new Error(opt.onlyNums ? (opt.round || 2) + '차 다시풀기에서 처음에 틀린 문항이 없어요.' : '틀린 문항이 없어요.');
  const wrongBy = {}; wrong.forEach(r => { wrongBy[r.n] = r; });
  const entryOf = r => ({ n: r.n, given: r.given, answer: r.correct });
  const items = [], B = 5;
  if (s.sourceQuestionIds && s.sourceQuestionIds.length) {
    // 문제은행에서 출제한 시험: 은행의 문항 그림을 쓴다
    say('문제은행 불러오는 중...');
    const lq = ctx.lq || (ctx.lq = await callApi('listQuestions', { password: getTeacherPassword() }));
    if (!lq.ok) { ctx.lq = null; throw new Error(lq.error || '문제은행을 불러오지 못했어요'); }
    const byId = {}; lq.questions.forEach(q => { byId[q.id] = q; });
    let picks = s.sourceQuestionIds.map(id => byId[id]);
    if (picks.some(q => !q)) {
      // 시험지에 적힌 문항 id가 은행에 없으면 ① 교재 시험지는 이름(출처)+번호로, ② 시험을 등록할 때 저장해 둔 문항 글자로 은행의 같은 문항을 찾아 쓴다
      // (「중복 정리」로 같은 글자의 문항이 하나만 남은 경우에도 남은 문항이 같은 그림이라 그대로 쓸 수 있다)
      const t = String(s.examTitle || '').trim(), by = {}, byText = {};
      lq.questions.filter(q => q.kind === '교재' && q.num && (String(q.source || '').trim() === t || String(q.source || '').trim() + '공략' === t))
        .sort((x, y) => String(x.createdAt).localeCompare(String(y.createdAt))).forEach(q => { by[q.num] = q; });
      lq.questions.forEach(q => { const k = dupKey(q.textPreview); if (k.length >= 25 && (!byText[k] || q.kind === '교재')) byText[k] = q; });
      let texts = [];
      try { const d = await callApi('getExamDetail', { password: getTeacherPassword(), id: s.examId }); if (d.ok) texts = d.questionTexts || []; } catch (e) {}
      picks = picks.map((q, i) => { if (q) return q; if (by[i + 1]) return by[i + 1]; const k = dupKey(texts[i]); return (k.length >= 25 && byText[k]) || null; });
    }
    const lostWrong = [];
    picks = picks.map((q, i) => { if (q) return q; if (wrongBy[i + 1]) lostWrong.push(i + 1); return { __missing: true }; });
    if (lostWrong.length) wnNote = '문제은행에 없어서 빠진 문항: ' + lostWrong.join(', ') + '번';
    if (lostWrong.length && lostWrong.length >= wrong.length) throw new Error('틀린 문항(' + lostWrong.join(', ') + '번)의 문제가 문제은행에 없어요. 같은 글자의 문항도 찾지 못했어요. 교재 등록에서 이 단원을 다시 등록하면 복구돼요.');
    let n = 1; const need = [];
    picks.forEach(q => {
      if (q.__missing) { n++; return; }
      const ri = rangeInfo(q, picks), k = ri ? ri.k : 1, entries = [];
      for (let j = 0; j < k; j++) if (wrongBy[n + j]) entries.push(entryOf(wrongBy[n + j]));
      if (entries.length) need.push({ q: q, entries: entries, num: k > 1 ? n + '~' + (n + k - 1) : String(n) });
      n += k;
    });
    if (n - 1 !== (s.correctAnswers || []).length) throw new Error('문항 번호가 시험 정보와 맞지 않아 만들 수 없어요.');
    const fetchImgs = async (ids, label) => {
      const out = {};
      for (let a = 0; a < ids.length; a += B) {
        say(label + ' 불러오는 중... ' + Math.min(a + B, ids.length) + '/' + ids.length);
        const r = await callApi('getQuestionImages', { password: getTeacherPassword(), fileIds: ids.slice(a, a + B) });
        if (!r.ok) throw new Error(r.error || '이미지를 불러오지 못했어요');
        for (const im of r.images) { const c = await BankCore.cleanImageBase64(im.base64); out[im.fileId] = c ? { b64: c.base64, w: c.width, h: c.height } : { b64: im.base64, w: pngSize(BankCore.b64ToBytes(im.base64)).width, h: pngSize(BankCore.b64ToBytes(im.base64)).height }; }
      }
      return out;
    };
    const qi = await fetchImgs(need.map(x => x.q.fileId), '문항 이미지');
    const ei = opt.withExpl ? await fetchImgs(need.filter(x => x.q.explFileId).map(x => x.q.explFileId), '해설 이미지') : {};
    need.forEach(x => {
      const im = qi[x.q.fileId]; if (!im) return;
      const it = { base64: im.b64, width: im.w, height: im.h, naturalW: im.w / BankCore.CROP_SCALE, entries: x.entries, num: x.num, numRect: x.q.numRect || null };
      const ex = x.q.explFileId && ei[x.q.explFileId]; if (ex) { it.explBase64 = ex.b64; it.explW = ex.w; it.explH = ex.h; }
      items.push(it);
    });
  } else {
    // 새로 등록한 PDF 시험: 등록된 PDF에서 틀린 문항을 잘라 쓴다
    say('시험지 PDF 불러오는 중...');
    const pr = await callApi('getExamPdf', { password: getTeacherPassword(), id: s.examId });
    if (!pr.ok) throw new Error(pr.error || 'PDF를 불러오지 못했어요.');
    const doc = await pdfjsLib.getDocument({ data: BankCore.b64ToBytes(pr.base64) }).promise;
    say('문항 찾는 중...');
    const scan = await BankCore.scanPdf(doc);
    const miss = [];
    for (const r of wrong) {
      const q = scan.questions.find(x => x.num === r.n);
      if (!q) { miss.push(r.n); continue; }
      say(r.n + '번 문항 자르는 중...');
      const cv = await BankCore.renderQuestion(doc, q, BankCore.CROP_SCALE, true);
      const it = { base64: BankCore.canvasToBase64(cv), width: cv.width, height: cv.height, naturalW: cv.width / BankCore.CROP_SCALE, entries: [entryOf(r)] };
      const ex = opt.withExpl && scan.explanations && scan.explanations[r.n];
      if (ex) { try { const ec = await BankCore.renderExplanation(doc, ex, 2.2); it.explBase64 = BankCore.canvasToBase64(ec); it.explW = ec.width; it.explH = ec.height; } catch (e) {} }
      items.push(it);
    }
    if (!items.length) throw new Error('시험지에서 틀린 문항을 찾지 못했어요. (스캔·이미지 PDF는 지원이 어려워요)');
    if (miss.length) say(miss.join(', ') + '번은 찾지 못해 빠졌어요');
  }
  return { items: items, wrong: wrong, note: wnNote };
}

// ── 한 건의 기록에서 만들 PDF 문서들 ──
//  kind 'note'  : 오답노트(내 답 표시) — student: 문제+내 답(+해설) / teacher: 내 답과 정답을 같이 적고 해설을 붙인 강사용
//  kind 'retry' : 오답문제 다시풀기(내 답·정답 표시 없음) — student: 틀린 문제만 / answers: 정답표+해설 / teacher: 문제 아래 정답 표시 + 해설
async function wnComposeDocs(s, g, kind, files, opt, qrBase64) {
  const RL = (opt.round || 1) + '차 ', base = { studentName: s.studentName, examTitle: s.examTitle, wrongCount: g.wrong.length, blank: opt.blank || 0, qrBase64: qrBase64 }, out = {}, C = o => BankCore.composeWrongNotePdf(PDFLib, g.items, Object.assign({}, base, o));
  // 강사용: 다른 시험지 강사용과 똑같이 — 문제 바로 밑에 정답(빨간 글씨)+해설, 객관식 정답 번호에 빨간 동그라미
  const T = (label, withGiven) => BankCore.composeTeacherPdf(PDFLib, s.studentName + ' · ' + s.examTitle + ' ' + label, g.items.map(it => {
    const es = it.entries || [], single = es.length === 1 && !/~/.test(String(it.num || ''));
    const o = { base64: it.base64, width: it.width, height: it.height, naturalW: it.naturalW, num: it.num, numRect: it.numRect, explBase64: it.explBase64, explW: it.explW, explH: it.explH, wrongTimes: it.wrongTimes };
    if (single) { o.answer = es[0].answer; if (withGiven) o.givenAns = es[0].given; } else { o.subAnswers = es.map(x => x.answer); o.subNums = es.map(x => x.n); o.numStart = es.length ? es[0].n : 1; }
    return o;
  }), { keepTitle: false });
  if (kind === 'note') {
    const sc = s.total ? s.score100 + '점' : '';
    if (files.student) out.student = await C({ scoreText: (opt.round || 1) > 1 ? '' : sc, withExpl: !!opt.withExpl, labelMode: 'given', kindLabel: RL + '오답노트' });
    if (files.teacher) out.teacher = await T(RL + '오답노트', true);
  } else {
    if (files.student) out.student = await C({ withExpl: false, answersAtEnd: false, labelMode: 'none', blank: 0, kindLabel: RL + '다시풀기' });
    if (files.answers) out.answers = await C({ withExpl: true, part: 'answers', kindLabel: '정답·해설' });
    if (files.teacher) out.teacher = await T(RL + '다시풀기', false);
  }
  return out;
}
// 여러 문서를 한 PDF로 합친다 (앞 문서가 홀수 쪽이면 빈 쪽을 끼워 다음 시험이 새 장 앞면에서 시작하게 한다)
async function wnMerge(docs) {
  const out = await PDFLib.PDFDocument.create();
  for (let i = 0; i < docs.length; i++) {
    const pgs = await out.copyPages(docs[i], docs[i].getPageIndices()); pgs.forEach(p => out.addPage(p));
    if (i < docs.length - 1 && out.getPageCount() % 2 === 1) out.addPage([595.28, 841.89]);
  }
  return out;
}
// 한 학생의 기록 여러 건 → 파일 종류별로 하나의 PDF(합본). records: 제출 기록(listSubmissions 형식)
// 반환: { student?:Uint8Array, answers?:Uint8Array, teacher?:Uint8Array, notes:[], used:[기록들] }
async function wnBuild(records, kind, files, opt, say, prog) {
  const ctx = {}, parts = { student: [], answers: [], teacher: [] }, notes = [], used = [];
  const recs = records.slice().sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt)), N = recs.length;
  const R = Math.max(1, Math.min(8, parseInt(opt.round, 10) || 1)); let roundRows = null; opt = Object.assign({}, opt, { round: R });
  const needExpl = !!(files.teacher || (kind === 'retry' && files.answers) || (kind === 'note' && opt.withExpl));
  for (let ri = 0; ri < N; ri++) {
    const s = recs[ri], tag = N > 1 ? '(' + (ri + 1) + '/' + N + ') ' + s.examTitle + ' · ' : '';
    const P = f => { if (prog) prog((ri + f) / N); };
    try {
      P(0.02);
      let counts = null; try { counts = opt.counts || await wnLoadCounts(opt.subs); } catch (e) { counts = null; }
      let onlyNums = null;
      if (R > 1) {        // N차 오답노트 = (N-1)번째 다시 풀기에서 「처음 고른 답」이 틀린 문항
        if (!roundRows) { const rr = await callApi('retryRounds', { password: getTeacherPassword() }); roundRows = (rr && rr.ok) ? rr.rows : []; }
        const nk = wnNameKey(s.studentName);
        onlyNums = roundRows.filter(r => String(r[0]) === String(s.examId) && wnNameKey(r[1]) === nk && Number(r[2]) === R && r[4] === 'x').map(r => Number(r[3]));
        if (!onlyNums.length) throw new Error(R + '차 오답노트: 학생이 아직 ' + R + '차 다시풀기를 풀지 않았거나 틀린 문항이 없어요. (먼저 ' + (R - 1) + '차 오답노트로 다시풀기를 풀게 해 주세요)');
      }
      const g = await wnGather(s, { withExpl: needExpl, onlyNums: onlyNums, round: R }, t => { say(tag + t); const m = /(\d+)\/(\d+)/.exec(t); P(0.05 + (m ? 0.7 * (+m[1] / +m[2]) : 0.3)); }, ctx);
      if (counts) g.items.forEach(it => { it.wrongTimes = Math.max(1, Math.max.apply(null, (it.entries || []).map(en => counts(s.studentName, s.examId, en.n)))); });
      if (g.note) notes.push(s.examTitle + ': ' + g.note);
      let qr = '';
      try { const u = new URL('student_retry.html', location.href).href + '?id=' + encodeURIComponent(s.examId) + '&n=' + g.wrong.map(r => r.n).join(',') + '&r=' + (R + 1) + '&name=' + encodeURIComponent(s.studentName); qr = (await QRCode.toDataURL(u, { width: 300, margin: 1 })).split(',')[1]; } catch (e) { qr = ''; }
      say(tag + 'PDF 만드는 중...'); P(0.85);
      const d = await wnComposeDocs(s, g, kind, files, opt, qr);
      Object.keys(d).forEach(k => parts[k].push(d[k])); used.push(s);
    } catch (e) { if (N === 1) throw e; notes.push(s.examTitle + ': ' + e.message); }
    P(1);
  }
  if (!used.length) throw new Error(notes.join(' / ') || '만들 수 있는 기록이 없어요.');
  const out = { notes: notes, used: used };
  const one = kind === 'retry' && opt.oneFile && parts.student.length && parts.answers.length;
  if (one) {      // 학생용 + 정답·해설을 한 파일로: 정답·해설은 새 장의 앞면(홀수 쪽)에서 시작 — 학생용이 5쪽이면 6쪽은 빈 쪽, 7쪽부터 정답
    say('학생용과 정답·해설을 한 파일로 합치는 중...');
    const st = parts.student.length > 1 ? await wnMerge(parts.student) : parts.student[0], an = parts.answers.length > 1 ? await wnMerge(parts.answers) : parts.answers[0];
    const m = await wnMerge([st, an]); await BankCore.addPageNumbers(PDFLib, m); out.combined = await m.save();
  }
  for (const k of ['student', 'answers', 'teacher']) {
    if (!parts[k].length || (one && k !== 'teacher')) continue;
    say('PDF 합치는 중...'); const m = parts[k].length > 1 ? await wnMerge(parts[k]) : parts[k][0];
    await BankCore.addPageNumbers(PDFLib, m); out[k] = await m.save();
  }
  return out;
}
const WN_NAME = { note: { student: '오답노트', teacher: '오답노트_강사용' }, retry: { combined: '다시풀기_학생용', student: '다시풀기_학생용', answers: '다시풀기_정답해설', teacher: '다시풀기_강사용' } };
function wnFileName(kind, file, records, round) {
  const sorted = records.slice().sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt)), who = sorted[0].studentName, what = records.length > 1 ? '합본(' + sorted[0].examTitle + ' 외 ' + (records.length - 1) + '개)' : sorted[0].examTitle;
  return (who + '_' + what + '_' + ((round || 1) + '차_') + WN_NAME[kind][file]).replace(/[\\/:*?"<>|]/g, ' ') + '.pdf';
}
function wnDownload(bytes, name) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 15000);
}

// ── 「N번 틀림」 세기: 한 학생이 같은 문제를 틀린 횟수 = 제출 기록에서 틀린 횟수 + 다시 풀기에서 또 틀린 횟수 ──
const wnQKey = (examId, n) => { const e = WN_EXAMS[String(examId)], q = e && e.sourceQuestionIds && e.sourceQuestionIds[n - 1]; return q ? 'q:' + q : 'e:' + examId + ':' + n; };
const wnNameKey = n => String(n || '').replace(/\s+/g, '').toLowerCase();
let WN_CNT = null;
async function wnLoadCounts(subs) {
  if (WN_CNT && Date.now() - WN_CNT.at < 60000) return WN_CNT.fn;
  if (!subs) { const res = await callApi('listSubmissions', { password: getTeacherPassword() }); if (!res.ok) throw new Error(res.error || '제출 기록을 불러오지 못했어요'); subs = wnHydrate(res); }
  let rw = []; try { const r = await callApi('retryWrongLog', { password: getTeacherPassword() }); if (r && r.ok) rw = r.rows || []; } catch (e) { rw = []; }
  const cnt = {}, add = (name, key) => { const m = cnt[wnNameKey(name)] = cnt[wnNameKey(name)] || {}; m[key] = (m[key] || 0) + 1; };
  subs.forEach(s => itemResults(s).forEach(r => { if (!r.subj && !r.skip && !r.ok) add(s.studentName, wnQKey(s.examId, r.n)); }));
  rw.forEach(r => add(r[1], wnQKey(r[0], r[2])));
  const fn = (name, examId, n) => ((cnt[wnNameKey(name)] || {})[wnQKey(examId, n)]) || 0;
  WN_CNT = { at: Date.now(), fn: fn }; return fn;
}
