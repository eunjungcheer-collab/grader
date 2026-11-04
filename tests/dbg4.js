const fs=require('fs');const {createCanvas}=require('@napi-rs/canvas');
global.window=global;global.requestAnimationFrame=f=>setTimeout(f,0);
const pdfjs=require('pdfjs-dist/legacy/build/pdf.js');global.pdfjsLib=pdfjs;
require('../js/bankcore.js');const B=global.BankCore;
B._createCanvas=(w,h)=>{const c=createCanvas(w,h);c.toDataURL=c.toDataURL.bind(c);return c};
class NCF{create(w,h){const c=createCanvas(w,h);return{canvas:c,context:c.getContext('2d')}}reset(o,w,h){o.canvas.width=w;o.canvas.height=h}destroy(o){o.canvas.width=0}}
(async()=>{const doc=await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(process.argv[2])),useSystemFonts:true,canvasFactory:new NCF()}).promise;
const sc=await B.scanPdf(doc);const ks=Object.keys(sc.answers);const cs=[];const only=(process.argv[3]||'').split(',').filter(Boolean);
for(const k of ks){if(only.length&&!only.includes(k))continue;const a=sc.answers[k];cs.push(await B.renderRect(doc,a.page,a.g?a.g:[a.mr+3,a.mtop-3,a.mr+250,a.mbottom+3],6,false));}
const W=Math.max(...cs.map(c=>c.width)),H=cs.reduce((t,c)=>t+c.height+4,0);const o=createCanvas(W,H);const g=o.getContext('2d');g.fillStyle='#eee';g.fillRect(0,0,W,H);let y=0;cs.forEach(c=>{g.drawImage(c,0,y);y+=c.height+4});
fs.writeFileSync('/tmp/ten/m.png',o.toBuffer('image/png'));console.log(ks.length,JSON.stringify(sc.answers[ks[0]].g),cs[0].width,cs[0].height);})();
