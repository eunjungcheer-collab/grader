window.APP_BUILD = '202610150090';
function renderHeader(opts) {
  const isLoggedIn = !!getTeacherPassword();
  const authHtml = isLoggedIn ? `
    <div class="topbar-auth">
      <a href="teacher_change_password.html" class="logout-link">비밀번호 변경</a>
      <span class="topbar-divider">|</span>
      <a href="#" id="logout-link" class="logout-link">로그아웃</a>
    </div>` : '';

  document.body.insertAdjacentHTML('afterbegin', `
    <div class="wrap${opts && opts.wide ? ' wide' : ''}${opts && opts.wider ? ' wider' : ''}">
      <header class="topbar">
        <div class="topbar-inner">
          <a href="index.html" class="brand">📝 자동채점 시스템</a><span style="font-size:10px; color:#9CA3AF; margin-left:6px;">v${window.APP_BUILD}</span>
          ${authHtml}
        </div>
      </header>
      <main id="main-content"></main>
    </div>
  `);

  const logoutLink = document.getElementById('logout-link');
  if (logoutLink) {
    logoutLink.addEventListener('click', function (e) {
      e.preventDefault();
      sessionStorage.removeItem('teacher_pw');
      location.href = 'teacher_login.html';
    });
  }

  // 페이지 본문(<body> 안에 미리 넣어둔 template#page-content)을 main으로 옮긴다.
  const tpl = document.getElementById('page-content');
  if (tpl) {
    document.getElementById('main-content').appendChild(tpl.content.cloneNode(true));
    tpl.remove();
  }
}


// 자동 등록이 끝나고 넘어온 화면 위쪽에 결과 요약을 띄운다 (닫기 전까지 남아 있다)
document.addEventListener('DOMContentLoaded', () => {
  let raw = null; try { raw = sessionStorage.getItem('autoRegSummary'); if (raw) sessionStorage.removeItem('autoRegSummary'); } catch (e) {}
  if (!raw) return;
  let d; try { d = JSON.parse(raw); } catch (e) { return; }
  const esc = v => String(v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed; top:56px; left:50%; transform:translateX(-50%); width:min(680px, 94vw); max-height:70vh; overflow:auto; z-index:9999; background:#fff; border:2px solid #0B1F5C; border-radius:12px; padding:14px 16px; box-shadow:0 8px 30px rgba(0,0,0,.25); font-size:14px; line-height:1.6;';
  const list = (t, arr, col) => arr && arr.length ? '<div style="margin-top:8px;"><b style="color:' + col + ';">' + t + '</b><br>' + arr.map(esc).join('<br>') + '</div>' : '';
  box.innerHTML = '<div style="display:flex; justify-content:space-between; align-items:center;"><b style="font-size:16px;">⚡ 자동 등록이 끝났어요</b><button type="button" style="border:0; background:none; font-size:20px; cursor:pointer;">✕</button></div>' +
    '<div style="margin-top:6px;">✅ ' + (d.ok || 0) + '개 등록' + ((d.skipped || []).length ? ' · ⏭ ' + d.skipped.length + '개 건너뜀' : '') + ((d.stuck || []).length ? ' · ⚠️ ' + d.stuck.length + '개 직접 확인 필요' : '') + '</div>' +
    (d.unassigned ? '<div style="margin-top:6px;">📂 단원을 못 정한 문항 <b>' + d.unassigned + '개</b> — 아래 화면에 그 문항만 모아 두었어요. 단원을 골라 주세요.</div>' : '') +
    list('직접 확인 필요 (이 파일들만 다시 올려 정답을 채워 주세요)', d.stuck, '#C1392B') + list('건너뜀', d.skipped, '#6B7280') + list('알림', d.notes, '#B45309');
  box.querySelector('button').addEventListener('click', () => box.remove());
  document.body.appendChild(box);
});
