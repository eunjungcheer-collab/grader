/* PDF를 내려받지 않고 바로 인쇄: 쪽마다 그림으로 바꿔 숨은 창에 넣고 브라우저 인쇄를 부른다 (pdf.js 필요)
   브라우저가 인쇄 창을 반드시 띄우니, 「인쇄」를 한 번 누르면 돼요. (Edge/Chrome을 --kiosk-printing 으로 켜면 창 없이 바로 나가요) */
async function printPdfRaster(bytes, onProg) {
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


/* 시험용: PDF를 그림으로 바꾸지 않고 그대로 숨은 창에 넣어 인쇄 (브라우저 PDF 뷰어가 처리). 벡터라 더 선명하지만 브라우저에 따라 안 될 수 있음 */
async function printPdfNative(bytes) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const fr = document.createElement('iframe'); fr.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;';
  document.body.appendChild(fr);
  const cleanup = () => { try { fr.remove(); } catch (e) {} URL.revokeObjectURL(url); };
  await new Promise((res, rej) => { fr.onload = res; fr.onerror = () => rej(new Error('PDF를 불러오지 못했어요.')); fr.src = url; setTimeout(() => rej(new Error('PDF 뷰어가 열리지 않았어요 (20초).')), 20000); }).catch(e => { cleanup(); throw e; });
  await new Promise(r => setTimeout(r, 1200)); // 뷰어가 쪽을 그릴 시간
  try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { cleanup(); throw new Error('이 브라우저에서는 숨은 창 인쇄가 막혀 있어요: ' + e.message); }
  setTimeout(cleanup, 10 * 60 * 1000);
  return true;
}

/* 인쇄 방식: 기본은 「빠른 인쇄」(PDF를 그대로), 안 되면 자동으로 「그림으로 바꿔 인쇄」(예전 방식). 데이터 관리에서 고를 수 있다 */
function printMode() { try { return localStorage.getItem('printMode') === 'raster' ? 'raster' : 'fast'; } catch (e) { return 'fast'; } }
function _printToast(text) {
  let t = document.getElementById('print-toast');
  if (!text) { if (t) t.remove(); return; }
  if (!t) { t = document.createElement('div'); t.id = 'print-toast'; t.style.cssText = 'position:fixed;left:50%;top:18px;transform:translateX(-50%);z-index:99999;background:#1F3A6B;color:#fff;padding:12px 18px;border-radius:10px;font-weight:700;font-size:15px;box-shadow:0 4px 16px rgba(0,0,0,.3);max-width:90vw;text-align:center;'; document.body.appendChild(t); }
  t.textContent = text;
}
async function printPdfBytes(bytes, onProg) {
  if (printMode() === 'fast') {
    try { _printToast('🖨️ 인쇄 창을 여는 중이에요... 쪽수가 많으면 10~20초 걸려요'); const r = await printPdfNative(bytes); _printToast(''); return r; }
    catch (e) { _printToast(''); try { console.warn('빠른 인쇄 실패 → 예전 방식으로 인쇄', e); } catch (_) {} }
  }
  if (!window.pdfjsLib && typeof setupPdfJs === 'function') { try { setupPdfJs(); } catch (e) {} }
  return printPdfRaster(bytes, onProg);
}
