// 제출 전 확인 단계: 입력한 답을 한 번 더 보여 주고 「이대로 제출」 / 「고치러 돌아가기」를 고르게 한다. (제출한 뒤에는 고치기 어렵기 때문)
// items: [{label:'3번', ans:'②'|'' , skip:false}] / title: 단원 이름(선택). 이대로 제출하면 true.
function confirmAnswers(sections) {
  return new Promise(function (resolve) {
    var esc = function (t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:12px;';
    var html = '<div style="background:#fff;border-radius:14px;max-width:560px;width:100%;max-height:90vh;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,.3);">' +
      '<div style="padding:16px 18px 6px;"><b style="font-size:18px;">제출하기 전에 확인해 주세요</b><p style="margin:6px 0 0;font-size:14px;line-height:1.5;color:#B42318;">제출하면 바로 채점되고, 그 뒤에는 마음대로 고칠 수 없어요. 번호와 답이 맞는지 한 번 더 봐 주세요.</p></div>' +
      '<div style="padding:8px 18px;overflow:auto;flex:1;">';
    sections.forEach(function (sec) {
      if (sec.title) html += '<div style="font-weight:700;margin:10px 0 4px;">' + esc(sec.title) + '</div>';
      html += '<div style="display:flex;flex-wrap:wrap;gap:6px;">';
      sec.items.forEach(function (it) {
        var bg = it.skip ? '#F3F4F6' : it.ans ? '#EEF2FF' : '#FDECEA', col = it.skip ? '#9CA3AF' : '#111';
        html += '<div style="min-width:58px;text-align:center;border-radius:8px;padding:4px 6px;background:' + bg + ';color:' + col + ';font-size:13px;"><div style="font-size:11px;opacity:.7;">' + esc(it.label) + '</div><b style="font-size:16px;">' + (it.skip ? '안 품' : it.ans ? esc(it.ans) : '비어 있음') + '</b></div>';
      });
      html += '</div>';
    });
    html += '</div><div style="display:flex;gap:8px;padding:12px 18px 16px;"><button type="button" id="ca-back" class="btn outline" style="flex:1;">← 고치러 돌아가기</button><button type="button" id="ca-ok" class="btn primary" style="flex:1;">이대로 제출</button></div></div>';
    ov.innerHTML = html; document.body.appendChild(ov);
    var done = function (v) { ov.remove(); resolve(v); };
    ov.querySelector('#ca-back').onclick = function () { done(false); };
    ov.querySelector('#ca-ok').onclick = function () { done(true); };
  });
}

// 마킹 실수 수정: 선생님 승인 뒤에만 고칠 수 있다. 요청을 보내고, 승인됐는지 확인한다.
// 요청은 기기에 기억해 두므로(sx_last_<id>.fixReq) 나중에 같은 기기에서 시험지를 다시 열어도 승인 확인 버튼이 보인다.
function sxMarkFixReq(examId, on) {
  try { var k = 'sx_last_' + examId, o = JSON.parse(localStorage.getItem(k) || 'null'); if (o) { o.fixReq = !!on; localStorage.setItem(k, JSON.stringify(o)); } } catch (e) {}
}
async function sxRequestFix(examId, name, submittedAt, msgEl) {
  msgEl.textContent = '요청을 보내는 중…';
  var r = await callApi('requestFix', { id: examId, studentName: name, submittedAt: submittedAt });
  if (!r.ok) { msgEl.textContent = '⚠️ ' + (r.error || '요청을 보내지 못했어요.'); return false; }
  sxMarkFixReq(examId, true);
  msgEl.textContent = '✅ 선생님께 수정 요청을 보냈어요. 선생님이 승인하면 「승인 확인」을 눌러 고칠 수 있어요. (승인 후 하루 안, 한 번만)';
  return true;
}
// 승인되었으면 goFn()을 부른다
async function sxCheckFix(examId, name, submittedAt, msgEl, goFn) {
  msgEl.textContent = '확인하는 중…';
  var r = await callApi('getFixStatus', { id: examId, studentName: name, submittedAt: submittedAt });
  if (!r.ok) { msgEl.textContent = '⚠️ ' + (r.error || '확인하지 못했어요.'); return; }
  if (r.edited) { sxMarkFixReq(examId, false); msgEl.textContent = '이미 한 번 고쳤어요. 더 고칠 수 없어요.'; return; }
  if (r.approved) goFn(); else msgEl.textContent = r.requested ? '아직 선생님이 승인하지 않았어요. 조금 뒤에 다시 눌러 보세요.' : '수정 요청이 없어요. 먼저 「수정 요청하기」를 눌러 주세요.';
}
