// 시계 모양 시간 고르기: 입력칸을 누르면 시계가 떠서 시(hour) → 분(minute) 순서로 눌러 고른다.
// 사용: ClockPicker.attach(inputEl, { onChange })   — inputEl.value 는 "HH:MM"(24시간) 로 유지된다.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const css = '.cp-ov{position:fixed;inset:0;z-index:10000;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:12px;}' +
    '.cp-box{background:#fff;border-radius:16px;padding:18px 16px 14px;width:min(340px,100%);box-shadow:0 10px 40px rgba(0,0,0,.25);text-align:center;font-family:inherit;}' +
    '.cp-tip{font-size:13px;color:#475569;margin:0 0 10px;}' +
    '.cp-ap{display:flex;gap:8px;justify-content:center;margin-bottom:10px;}' +
    '.cp-ap button{border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:7px 18px;font-size:14px;cursor:pointer;}' +
    '.cp-ap button.on{background:#6B8FC4;color:#fff;border-color:#6B8FC4;font-weight:700;}' +
    '.cp-dial{touch-action:none;display:block;margin:0 auto;}' +
    '.cp-disp{display:flex;align-items:center;justify-content:center;gap:4px;margin:12px 0 4px;font-size:34px;font-weight:700;color:#1e293b;}' +
    '.cp-disp span{padding:2px 12px;border-radius:8px;cursor:pointer;min-width:56px;}' +
    '.cp-disp span.on{background:#D6E0F2;color:#1F3A6B;}' +
    '.cp-help{font-size:12px;color:#64748b;margin:6px 0 12px;line-height:1.5;}' +
    '.cp-btns{display:flex;gap:8px;}.cp-btns button{flex:1;padding:11px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;font-size:15px;cursor:pointer;}' +
    '.cp-btns button.ok{background:#6B8FC4;color:#fff;border-color:#6B8FC4;font-weight:700;}';
  let styled = false;
  function addStyle() { if (styled) return; styled = true; const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); }
  const pad = n => String(n).padStart(2, '0');
  function open(initial, done) {
    addStyle();
    let h24 = 18, mi = 0, mode = 'h';
    const m = /^(\d{1,2}):(\d{2})$/.exec(initial || ''); if (m) { h24 = +m[1] % 24; mi = +m[2] % 60; }
    const ov = document.createElement('div'); ov.className = 'cp-ov';
    ov.innerHTML = '<div class="cp-box"><div class="cp-tip"></div><div class="cp-ap"><button type="button" data-ap="am">오전</button><button type="button" data-ap="pm">오후</button></div><svg class="cp-dial" width="260" height="260" viewBox="0 0 260 260"></svg><div class="cp-disp"><span data-m="h"></span>:<span data-m="m"></span></div><div class="cp-help">시간을 다시 누르면 시(hour)를, 분을 다시 누르면 분(minute)을 고칠 수 있어요</div><div class="cp-btns"><button type="button" class="no">취소</button><button type="button" class="ok">확인</button></div></div>';
    document.body.appendChild(ov);
    const svg = ov.querySelector('svg'), C = 130, R = 96;
    const el = (n, a) => { const e = document.createElementNS(NS, n); Object.keys(a).forEach(k => e.setAttribute(k, a[k])); return e; };
    function pos(k, r) { const a = k * Math.PI / 6 - Math.PI / 2; return [C + r * Math.cos(a), C + r * Math.sin(a)]; }
    function draw() {
      svg.innerHTML = ''; svg.appendChild(el('circle', { cx: C, cy: C, r: 124, fill: '#D3DEF0', stroke: '#B8C6DD' }));
      const h12 = (h24 % 12) || 12, sel = mode === 'h' ? h12 : mi;
      const ang = mode === 'h' ? (h12 % 12) * 30 : mi * 6, rad = (ang - 90) * Math.PI / 180;
      const hx = C + R * Math.cos(rad), hy = C + R * Math.sin(rad);
      svg.appendChild(el('line', { x1: C, y1: C, x2: hx, y2: hy, stroke: '#6B8FC4', 'stroke-width': 2.5 }));
      svg.appendChild(el('circle', { cx: C, cy: C, r: 4, fill: '#6B8FC4' }));
      svg.appendChild(el('circle', { cx: hx, cy: hy, r: 18, fill: '#6B8FC4' }));
      for (let k = 1; k <= 12; k++) {
        const [x, y] = pos(k, R), val = mode === 'h' ? k : (k % 12) * 5, on = (mode === 'h' ? h12 === k : mi === val);
        const t = el('text', { x: x, y: y + 5, 'text-anchor': 'middle', 'font-size': 16, fill: on ? '#fff' : '#1e293b', 'font-weight': on ? 700 : 400, 'pointer-events': 'none' });
        t.textContent = mode === 'h' ? k : pad(val); svg.appendChild(t);
      }
      if (mode === 'm' && mi % 5 !== 0) { const t = el('text', { x: hx, y: hy + 5, 'text-anchor': 'middle', 'font-size': 14, fill: '#fff', 'font-weight': 700, 'pointer-events': 'none' }); t.textContent = pad(mi); svg.appendChild(t); }
      ov.querySelector('.cp-tip').textContent = mode === 'h' ? '시(hour)를 눌러주세요' : '분(minute)을 눌러주세요';
      ov.querySelector('[data-ap=am]').classList.toggle('on', h24 < 12); ov.querySelector('[data-ap=pm]').classList.toggle('on', h24 >= 12);
      const hs = ov.querySelector('[data-m=h]'), ms = ov.querySelector('[data-m=m]');
      hs.textContent = pad(h24); ms.textContent = pad(mi); hs.classList.toggle('on', mode === 'h'); ms.classList.toggle('on', mode === 'm');
    }
    function fromEvent(ev) {
      const r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) * 260 / r.width - C, y = (ev.clientY - r.top) * 260 / r.height - C;
      let deg = Math.atan2(y, x) * 180 / Math.PI + 90; if (deg < 0) deg += 360;
      if (mode === 'h') { const h = Math.round(deg / 30) % 12 || 12; const pm = h24 >= 12; h24 = (h % 12) + (pm ? 12 : 0); }
      else mi = Math.round(deg / 6) % 60;
    }
    let drag = false;
    svg.addEventListener('pointerdown', ev => { drag = true; try { svg.setPointerCapture(ev.pointerId); } catch (e) {} fromEvent(ev); draw(); });
    svg.addEventListener('pointermove', ev => { if (!drag) return; fromEvent(ev); draw(); });
    svg.addEventListener('pointerup', () => { if (!drag) return; drag = false; if (mode === 'h') { mode = 'm'; draw(); } });
    ov.querySelectorAll('[data-ap]').forEach(b => b.addEventListener('click', () => { const h12 = h24 % 12; h24 = h12 + (b.dataset.ap === 'pm' ? 12 : 0); draw(); }));
    ov.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => { mode = b.dataset.m; draw(); }));
    const close = () => ov.remove();
    ov.querySelector('.no').addEventListener('click', close);
    ov.addEventListener('pointerdown', ev => { if (ev.target === ov) close(); });
    ov.querySelector('.ok').addEventListener('click', () => { close(); done(pad(h24) + ':' + pad(mi)); });
    draw();
  }
  function label(v) { const m = /^(\d{1,2}):(\d{2})$/.exec(v || ''); if (!m) return ''; const h = +m[1]; return (h < 12 ? '오전 ' : '오후 ') + ((h % 12) || 12) + ':' + m[2]; }
  function attach(inp, opts) {
    opts = opts || {}; inp.readOnly = true; inp.style.cursor = 'pointer'; inp.setAttribute('inputmode', 'none');
    const show = () => { inp.value = label(inp.dataset.t || ''); };
    inp.setValue = v => { inp.dataset.t = v || ''; show(); };
    inp.getTime = () => inp.dataset.t || '';
    const go = () => open(inp.dataset.t || '', v => { inp.setValue(v); if (opts.onChange) opts.onChange(v); });
    inp.addEventListener('click', go); inp.addEventListener('focus', () => { inp.blur(); });
    show();
  }
  window.ClockPicker = { attach: attach, open: open, label: label };
})();
