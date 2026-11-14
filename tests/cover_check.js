// 표지 겹침 점검: 단원 1~16개로 표지를 그려 보고, 목차 칸 아래쪽이 '강사용/학생용' 표시 자리를 침범하지 않는지 확인한다.
// 사용: (grader 폴더에서) python3 -m http.server 8772 & node tests/cover_check.js   (playwright 필요)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(), pg = await (await b.newContext()).newPage();
  await pg.addInitScript(() => { localStorage.setItem('teacher_pw', 'x'); sessionStorage.setItem('teacher_pw', 'x'); });
  await pg.goto('http://localhost:8772/book_register.html'); await pg.waitForTimeout(1500);
  const bad = await pg.evaluate(() => {
    const out = [], H = 842, W = 595, labelTop = H * 0.845 - 26 - 4;      // 강사용/학생용 표시 윗선
    for (let n = 1; n <= 16; n++) {
      const secs = Array.from({ length: n }, (_, i) => ({ name: (i + 1) + '. 매우 긴 단원 이름 테스트 ' + i, tag: '', order: i, unit: i + 1, unitName: '매우 긴 단원 이름 테스트 ' + i }));
      const cv = coverCanvas('중1 과학 내신대비', secs, W, H), c = cv.getContext('2d'), K = cv.width / W;
      // 표시 자리 바로 위 띠(가로 전체)에 흰 카드 바깥(배경)이 아닌 진한 글자색 픽셀이 있으면 겹친 것
      const y0 = Math.round((labelTop - 8) * K), h = Math.round(8 * K), d = c.getImageData(Math.round(W * 0.3 * K), y0, Math.round(W * 0.4 * K), h).data;
      let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 90 && d[i + 1] < 90 && d[i + 2] < 120) dark++;
      if (dark > 0) out.push(n);
    }
    return out;
  });
  console.log(bad.length ? '겹침 발생 단원 수: ' + bad.join(',') : '표지 겹침 없음 (1~16개 단원)');
  await b.close(); process.exit(bad.length ? 1 : 0);
})();
