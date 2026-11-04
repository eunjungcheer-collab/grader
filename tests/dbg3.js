const fs=require('fs');const {createCanvas}=require('@napi-rs/canvas');
global.window=global;global.requestAnimationFrame=f=>setTimeout(f,0);
const pdfjs=require('pdfjs-dist/legacy/build/pdf.js');global.pdfjsLib=pdfjs;
require('../js/bankcore.js');const B=global.BankCore;
B._createCanvas=(w,h)=>{const c=createCanvas(w,h);c.toDataURL=c.toDataURL.bind(c);return c};
class NCF{create(w,h){const c=createCanvas(w,h);return{canvas:c,context:c.getContext('2d')}}reset(o,w,h){o.canvas.width=w;o.canvas.height=h}destroy(o){o.canvas.width=0}}
(async()=>{const doc=await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(process.argv[2])),useSystemFonts:true,canvasFactory:new NCF()}).promise;
const sc=await B.scanPdf(doc);
const n=await B.readCircledAnswers(doc,sc);console.log('set',n,'samples',sc._gs,'clusters',sc._gc,JSON.stringify(sc._glyphDebug||null));
console.log(Object.keys(sc.answers).map(k=>k+'='+sc.answers[k].text).join(' '));
const a=sc.answers[+(process.argv[3]||1)];const c=await B.renderRect(doc,a.page,a.g,6,false);fs.writeFileSync('/tmp/ten/g1.png',c.toBuffer('image/png'));})();
