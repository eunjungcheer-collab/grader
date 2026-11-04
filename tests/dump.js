const fs=require('fs');global.window=global;
const pdfjs=require('pdfjs-dist/legacy/build/pdf.js');
(async()=>{const doc=await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(process.argv[2])),useSystemFonts:true}).promise;
const p=+process.argv[3];const pg=await doc.getPage(p);const vp=pg.getViewport({scale:1});const tc=await pg.getTextContent();
console.log('size',vp.width,vp.height,'items',tc.items.length);
tc.items.slice(0,+process.argv[4]||80).forEach(i=>console.log(Math.round(i.transform[4]),Math.round(vp.height-i.transform[5]),JSON.stringify(i.str)));
})();
