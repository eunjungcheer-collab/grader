// 인식 점검 스크립트 — 시험지 PDF 모음 폴더에서 문항 수·정답이 예전과 같은지 확인한다.
// 사용법 (개발용, 앱 배포에는 필요 없음):
//   npm i pdfjs-dist@3.11.174 @napi-rs/canvas
//   node regress.js <PDF 폴더> --update     # 지금 결과를 기준으로 저장 (baseline.json)
//   node regress.js <PDF 폴더>              # 기준과 비교해서 달라진 것만 출력
const fs = require('fs'), path = require('path');
const { createCanvas } = require('@napi-rs/canvas');
global.window = global; global.requestAnimationFrame = f => setTimeout(f, 0);
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js'); global.pdfjsLib = pdfjs;
require('../js/bankcore.js'); const B = global.BankCore;
B._createCanvas = (w, h) => { const c = createCanvas(w, h); c.toDataURL = c.toDataURL.bind(c); return c; };
class NCF { create(w, h) { const c = createCanvas(w, h); return { canvas: c, context: c.getContext('2d') }; } reset(o, w, h) { o.canvas.width = w; o.canvas.height = h; } destroy(o) { o.canvas.width = 0; o.canvas.height = 0; } }
(async () => {
  const dir = process.argv[2], update = process.argv.includes('--update');
  const base = path.join(__dirname, 'baseline.json');
  const old = fs.existsSync(base) ? JSON.parse(fs.readFileSync(base, 'utf8')) : {};
  const now = {};
  for (const f of fs.readdirSync(dir).filter(x => /\.pdf$/i.test(x)).sort()) {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(path.join(dir, f))), useSystemFonts: true, canvasFactory: new NCF() }).promise;
    const sc = await B.scanPdf(doc);
    try { const t = await B.parseAnswerTable(doc, sc); if (t) Object.keys(t.answers).forEach(n => { if (!sc.answers[n]) sc.answers[n] = { text: t.answers[n] }; else if (!sc.answers[n].text) sc.answers[n].text = t.answers[n]; }); } catch (e) {}
    try { await B.readCircledAnswers(doc, sc); } catch (e) {}
    now[f.slice(0, 8)] = { q: sc.questions.map(q => q.num).join(','), a: Object.keys(sc.answers).sort((x, y) => x - y).map(n => n + '=' + (sc.answers[n].text || '')).join(' '), e: Object.keys(sc.explanations || {}).length };
  }
  if (update) { fs.writeFileSync(base, JSON.stringify(now, null, 1)); console.log('기준 저장:', Object.keys(now).length, '개 파일'); return; }
  let bad = 0;
  for (const k of Object.keys(now)) {
    const o = old[k]; if (!o) { console.log('새 파일', k); continue; }
    ['q', 'a', 'e'].forEach(f => { if (String(o[f]) !== String(now[k][f])) { bad++; console.log('달라짐', k, f, '\n  전:', String(o[f]).slice(0, 120), '\n  후:', String(now[k][f]).slice(0, 120)); } });
  }
  console.log(bad ? '❌ 달라진 항목 ' + bad + '개' : '✅ 모두 기준과 같아요');
})();
