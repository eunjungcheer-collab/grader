const fs=require('fs');global.window=global;global.requestAnimationFrame=f=>setTimeout(f,0);const {createCanvas}=require('@napi-rs/canvas');
const pdfjs=require('pdfjs-dist/legacy/build/pdf.js');
class NCF{create(w,h){const c=createCanvas(w,h);return{canvas:c,context:c.getContext('2d')}}reset(o,w,h){o.canvas.width=w;o.canvas.height=h}destroy(o){o.canvas.width=0}}
(async()=>{const doc=await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(process.argv[2])),useSystemFonts:true,canvasFactory:new NCF()}).promise;
const pg=await doc.getPage(+process.argv[3]);const vp=pg.getViewport({scale:2});const c=createCanvas(vp.width,vp.height);
await pg.render({canvasContext:c.getContext('2d'),viewport:vp,canvasFactory:new NCF()}).promise;fs.writeFileSync(process.argv[4],c.toBuffer('image/png'));})();
