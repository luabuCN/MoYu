'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {Resvg} = require('@resvg/resvg-js');

const directory = path.resolve(__dirname,'..','assets','brand');
const svg = fs.readFileSync(path.join(directory,'logo.svg'),'utf8');
// electron-builder converts the 1024px source into a native macOS ICNS icon.
fs.writeFileSync(path.join(directory, 'app.png'), new Resvg(svg,{fitTo:{mode:'width',value:1024}}).render().asPng());
const sizes = [16,20,24,32,40,48,64,128,256];
const images = sizes.map(size => {
  const png = new Resvg(svg,{fitTo:{mode:'width',value:size}}).render().asPng();
  fs.writeFileSync(path.join(directory,`app-${size}.png`),png);
  return {size,png};
});

// ICO frames contain the same SVG rendered at each Windows/DPI icon size.
const header = Buffer.alloc(6 + images.length * 16);
header.writeUInt16LE(1,2);
header.writeUInt16LE(images.length,4);
let offset = header.length;
for (let index=0; index<images.length; index++) {
  const {size,png} = images[index];
  const position = 6 + index * 16;
  header[position] = size === 256 ? 0 : size;
  header[position + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1,position + 4);
  header.writeUInt16LE(32,position + 6);
  header.writeUInt32LE(png.length,position + 8);
  header.writeUInt32LE(offset,position + 12);
  offset += png.length;
}
fs.writeFileSync(path.join(directory,'app.ico'),Buffer.concat([header,...images.map(image => image.png)]));
console.log(`品牌图标已生成：SVG、${sizes.length} 种 PNG 尺寸和 Windows ICO`);
