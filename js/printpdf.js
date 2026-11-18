/* PDF를 내려받지 않고 바로 인쇄: 쪽마다 그림으로 바꿔 숨은 창에 넣고 브라우저 인쇄를 부른다 (pdf.js 필요)
   브라우저가 인쇄 창을 반드시 띄우니, 「인쇄」를 한 번 누르면 돼요. (Edge/Chrome을 --kiosk-printing 으로 켜면 창 없이 바로 나가요) */
async function printPdfBytes(bytes, onProg) {
  if (!window.pdfjsLib) throw new Error('인쇄 준비가 안 됐어요 (pdf.js)');
  const doc = await pdfjsLib.getDocument({ data: bytes.slice ? bytes.slice(0) : bytes }).promise, n = doc.numPages;
  if (n > 120 && !confirm('쪽수가 ' + n + '쪽으로 많아서 준비에 시간이 걸려요. 계속할까요?')) return false;
  const urls = []; let w0 = 0, h0 = 0;
  for (let i = 1; i <= n; i++) {
    const pg = await doc.getPage(i), vp1 = pg.getViewport({ scale: 1 }), sc = 2.1, vp = pg.getViewport({ scale: sc });
    if (i === 1) { w0 = vp1.width; h0 = vp1.height; }
    const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
    await pg.render({ canvasContext: cx, viewport: vp }).promise;
    urls.push(await new Promise(r => cv.toBlob(b => r(URL.createObjectURL(b)), 'image/jpeg', 0.92)));
    cv.width = cv.height = 1; if (onProg) onProg(i, n);
  }
  const fr = document.createElement('iframe'); fr.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;';
  document.body.appendChild(fr);
  const d = fr.contentDocument; d.open();
  d.write('<!doctype html><html><head><meta charset="utf-8"><style>@page{size:' + w0 + 'pt ' + h0 + 'pt;margin:0}html,body{margin:0;padding:0}img{display:block;width:' + w0 + 'pt;height:' + h0 + 'pt;page-break-after:always;break-after:page}img:last-child{page-break-after:auto;break-after:auto}</style></head><body>' + urls.map(u => '<img src="' + u + '">').join('') + '</body></html>'); d.close();
  await Promise.all(Array.from(d.images).map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; })));
  const cleanup = () => { try { fr.remove(); } catch (e) {} urls.forEach(u => URL.revokeObjectURL(u)); };
  fr.contentWindow.addEventListener('afterprint', () => setTimeout(cleanup, 500));
  setTimeout(cleanup, 10 * 60 * 1000);
  fr.contentWindow.focus(); fr.contentWindow.print();
  return true;
}

