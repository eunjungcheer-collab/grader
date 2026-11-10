// 사진(스캔)으로 된 시험지의 글자를 읽는다 (브라우저 안에서 tesseract.js로 읽고, 인터넷에 올리지 않는다).
// 글자가 없는 쪽에서만 쓰이며, 읽은 글자 위치를 PDF 글자와 같은 모양으로 돌려줘서 문항 자르기가 그대로 동작한다.
(function (root) {
  let workerP = null;
  const base = () => new URL('js/vendor/tesseract/', document.baseURI).href;
  function loadScript(src) { return new Promise((res, rej) => { if (root.Tesseract) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('글자 읽기 모듈을 불러오지 못했어요')); document.head.appendChild(s); }); }
  async function getWorker() {
    if (!workerP) workerP = (async () => {
      await loadScript(base() + 'tesseract.min.js');
      return await root.Tesseract.createWorker('kor', 1, { workerPath: base() + 'worker.min.js', corePath: base(), langPath: base(), gzip: true, cacheMethod: 'none' });
    })();
    return workerP;
  }
  // canvas → [{ text, x0, y0, x1, y1, conf }] (캔버스 픽셀 좌표)
  async function words(canvas) {
    const w = await getWorker();
    const r = await w.recognize(canvas, {}, { blocks: true });
    const out = [];
    ((r.data && r.data.blocks) || []).forEach(b => b.paragraphs.forEach(p => p.lines.forEach(l => l.words.forEach(x => { if (x.text && x.text.trim()) out.push({ text: x.text.trim(), x0: x.bbox.x0, y0: x.bbox.y0, x1: x.bbox.x1, y1: x.bbox.y1, conf: x.confidence }); }))));
    return out;
  }
  // 숫자만 읽는 모드 (문항 번호 자리 좁은 띠를 읽을 때): 번호 "3." 처럼 본문 읽기에서 놓친 것을 되찾는다
  async function digitWords(canvas) {
    const w = await getWorker();
    await w.setParameters({ tessedit_char_whitelist: '0123456789.', tessedit_pageseg_mode: '6' });
    try {
      const r = await w.recognize(canvas, {}, { blocks: true });
      const out = [];
      ((r.data && r.data.blocks) || []).forEach(b => b.paragraphs.forEach(p => p.lines.forEach(l => l.words.forEach(x => { if (x.text && x.text.trim()) out.push({ text: x.text.trim(), x0: x.bbox.x0, y0: x.bbox.y0, x1: x.bbox.x1, y1: x.bbox.y1, conf: x.confidence }); }))));
      return out;
    } finally { await w.setParameters({ tessedit_char_whitelist: '', tessedit_pageseg_mode: '3' }); }
  }
  root.OcrLite = { words: words, digitWords: digitWords };
})(typeof window !== 'undefined' ? window : globalThis);
