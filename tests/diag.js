const fs = require('fs'), path = require('path');
const { createCanvas } = require('@napi-rs/canvas');
global.window = global; global.requestAnimationFrame = f => setTimeout(f, 0);
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js'); global.pdfjsLib = pdfjs;
require('../js/bankcore.js'); const B = global.BankCore;
B._createCanvas = (w, h) => { const c = createCanvas(w, h); c.toDataURL = c.toDataURL.bind(c); return c; };
class NCF { create(w, h) { const c = createCanvas(w, h); return { canvas: c, context: c.getContext('2d') }; } reset(o, w, h) { o.canvas.width = w; o.canvas.height = h; } destroy(o) { o.canvas.width = 0; o.canvas.height = 0; } }
(async () => {
  const dir = process.argv[2];
  for (const f of fs.readdirSync(dir).filter(x => /\.pdf$/i.test(x)).sort()) {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(path.join(dir, f))), useSystemFonts: true, canvasFactory: new NCF() }).promise;
    const sc = await B.scanPdf(doc);
    let tbl = null; try { tbl = await B.parseAnswerTable(doc, sc); } catch (e) {}
    const withText0 = Object.keys(sc.answers).filter(n => sc.answers[n].text).length;
    const withRect0 = Object.keys(sc.answers).filter(n => sc.answers[n].rect).length;
    let g = 0; try { g = await B.readCircledAnswers(doc, sc); } catch (e) { g = 'ERR ' + e.message; }
    const text = Object.keys(sc.answers).filter(n => sc.answers[n].text).length;
    console.log(f.slice(0, 8), 'pages', sc.pageCount, 'Q', sc.questions.length, '/', sc.questionCount, 'ansPages', JSON.stringify(sc.answerPages), 'ans(text,rect) before', withText0, withRect0, 'table', tbl ? Object.keys(tbl.answers).length : 0, 'glyph', g, 'textAfter', text, 'expl', Object.keys(sc.explanations || {}).length);
  }
})();
