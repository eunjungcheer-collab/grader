const fs=require('fs');const {createCanvas}=require('@napi-rs/canvas');
global.window=global;global.requestAnimationFrame=f=>setTimeout(f,0);
const pdfjs=require('pdfjs-dist/legacy/build/pdf.js');global.pdfjsLib=pdfjs;
require('../js/bankcore.js');const B=global.BankCore;
B._createCanvas=(w,h)=>{const c=createCanvas(w,h);c.toDataURL=c.toDataURL.bind(c);return c};
class NCF{create(w,h){const c=createCanvas(w,h);return{canvas:c,context:c.getContext('2d')}}reset(o,w,h){o.canvas.width=w;o.canvas.height=h}destroy(o){o.canvas.width=0}}
(async()=>{const doc=await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(process.argv[2])),useSystemFonts:true,canvasFactory:new NCF()}).promise;
const sc=await B.scanPdf(doc);const a=sc.answers[1];console.log(JSON.stringify(a));
const c=await B.renderRect(doc,a.page,a.g,6,false);fs.writeFileSync('/tmp/ten/g1.png',c.toBuffer('image/png'));console.log(c.width,c.height);
const a2=sc.answers[2];const c2=await B.renderRect(doc,a2.page,a2.g,6,false);fs.writeFileSync('/tmp/ten/g2.png',c2.toBuffer('image/png'));})();
