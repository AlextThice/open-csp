import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { Buffer } from 'node:buffer';

// A small deterministic renderer for this project's own vector geometry.
// No WinSCP artwork, external fonts, image services or native dependencies.
const root = fileURLToPath(new URL('../build-resources/', import.meta.url));
const crc32 = (buffer) => {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
};
const chunk = (name, data) => {
  const type = Buffer.from(name);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, checksum]);
};
const inside = (x, y, points) => {
  let result = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const [ax, ay] = points[index];
    const [bx, by] = points[previous];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) result = !result;
  }
  return result;
};
const color = (hex) =>
  [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
function png(size, design) {
  const background = color(design.background);
  const shapes = design.shapes.map((shape) => ({ ...shape, rgb: color(shape.color) }));
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const total = [0, 0, 0, 0];
      for (const dy of [0.25, 0.75]) {
        for (const dx of [0.25, 0.75]) {
          const x = ((column + dx) * 100) / size;
          const y = ((row + dy) * 100) / size;
          if (x < 3 || x > 97 || y < 3 || y > 97) continue;
          const distanceX = Math.max(19 - x, 0, x - 81);
          const distanceY = Math.max(19 - y, 0, y - 81);
          if (distanceX ** 2 + distanceY ** 2 > 16 ** 2) continue;
          let rgb = background;
          for (const shape of shapes) if (inside(x, y, shape.points)) rgb = shape.rgb;
          for (let component = 0; component < 3; component++) total[component] += rgb[component];
          total[3] += 255;
        }
      }
      const offset = row * (size * 4 + 1) + 1 + column * 4;
      for (let component = 0; component < 3; component++)
        pixels[offset + component] = total[3] ? Math.round((total[component] * 255) / total[3]) : 0;
      pixels[offset + 3] = Math.round(total[3] / 4);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export async function generateIcons() {
  const design = JSON.parse(await readFile(join(root, 'icon-shapes.json'), 'utf8'));
  const destination = join(root, 'generated');
  await mkdir(join(destination, 'icons'), { recursive: true });
  const images = new Map();
  for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) {
    const image = png(size, design);
    images.set(size, image);
    await writeFile(join(destination, 'icons', `${size}x${size}.png`), image);
  }
  await writeFile(join(destination, 'icon.png'), images.get(512));
  const icoSizes = [16, 32, 48, 64, 128, 256];
  const icoHeader = Buffer.alloc(6 + 16 * icoSizes.length);
  icoHeader.writeUInt16LE(1, 2);
  icoHeader.writeUInt16LE(icoSizes.length, 4);
  let offset = icoHeader.length;
  for (const [index, size] of icoSizes.entries()) {
    const entry = 6 + index * 16;
    icoHeader[entry] = icoHeader[entry + 1] = size % 256;
    icoHeader.writeUInt16LE(1, entry + 4);
    icoHeader.writeUInt16LE(32, entry + 6);
    icoHeader.writeUInt32LE(images.get(size).length, entry + 8);
    icoHeader.writeUInt32LE(offset, entry + 12);
    offset += images.get(size).length;
  }
  await writeFile(
    join(destination, 'icon.ico'),
    Buffer.concat([icoHeader, ...icoSizes.map((size) => images.get(size))]),
  );
  const elements = [
    [128, 'ic07'],
    [256, 'ic08'],
    [512, 'ic09'],
    [1024, 'ic10'],
  ].map(([size, type]) => {
    const data = images.get(size);
    const header = Buffer.alloc(8);
    header.write(type);
    header.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([header, data]);
  });
  const icnsHeader = Buffer.alloc(8);
  icnsHeader.write('icns');
  icnsHeader.writeUInt32BE(8 + elements.reduce((sum, element) => sum + element.length, 0), 4);
  await writeFile(join(destination, 'icon.icns'), Buffer.concat([icnsHeader, ...elements]));
  const paths = design.shapes
    .map(
      (shape) =>
        `<polygon fill="${shape.color}" points="${shape.points.map((point) => point.join(',')).join(' ')}"/>`,
    )
    .join('');
  await writeFile(
    join(destination, 'icon.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="3" y="3" width="94" height="94" rx="16" fill="${design.background}"/>${paths}</svg>\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await generateIcons();
