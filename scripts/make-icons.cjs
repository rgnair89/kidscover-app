// Draws the app's icons, in code, the same way the app draws everything else: nothing to license, nothing to
// download, and one command to redraw them all if the mark ever changes. Run: node scripts/make-icons.cjs
//
// The mark is the one the app already shows beside its name: a school under a sunshine-yellow roof, with a coral
// door, on the brand violet. It says "a school" at 48 pixels on a home screen, which is the only size that matters.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const VIOLET = [0x5b, 0x4b, 0xdb];
const SUN = [0xff, 0xc8, 0x57];
const CORAL = [0xff, 0x7a, 0x59];
const WHITE = [0xff, 0xff, 0xff];
// the windows are cut out of the white wall: on the violet square that is the square's own colour, but on a layer
// that will be laid over violet by the phone itself, they need to be a shade deeper or they disappear
const VIOLET_DEEP = [0x40, 0x32, 0xa8];

// ---- the shapes, in a 32x32 square, exactly as LogoMark draws them ------------------------------------------------
const roundedSquare = (r) => (x, y) => {
  if (x < 0 || y < 0 || x > 32 || y > 32) return false;
  const cx = Math.min(Math.max(x, r), 32 - r);
  const cy = Math.min(Math.max(y, r), 32 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const rect = (x0, y0, w, h, r = 0) => (x, y) => {
  if (x < x0 || y < y0 || x > x0 + w || y > y0 + h) return false;
  const cx = Math.min(Math.max(x, x0 + r), x0 + w - r);
  const cy = Math.min(Math.max(y, y0 + r), y0 + h - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
// the roof: a triangle, given as three corners
const triangle = (ax, ay, bx, by, cx, cy) => {
  const side = (px, py, x1, y1, x2, y2) => (x2 - x1) * (py - y1) - (y2 - y1) * (px - x1);
  return (x, y) => {
    const d1 = side(x, y, ax, ay, bx, by);
    const d2 = side(x, y, bx, by, cx, cy);
    const d3 = side(x, y, cx, cy, ax, ay);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
};

// The school itself, painted in order. `plain` leaves out the violet square, for the layers that sit on a background
// of their own; `silhouette` is the one Android wants for a notification: one white shape, nothing else.
function markLayers({ plain = false, silhouette = false } = {}) {
  const pole = rect(15.7, 2.6, 0.7, 4.2, 0.3);
  const flag = rect(16.4, 2.9, 3.4, 2.1, 0.5);
  const roof = triangle(4, 15.5, 16, 6.4, 28, 15.5);
  const body = rect(8, 15, 16, 10.5, 1.5);
  // four windows in a row, the way a school front looks, so the two-eyes-and-a-mouth reading never happens
  const windows = [9.6, 13, 16.4, 19.8].map((x) => rect(x, 17.1, 2.6, 2.3, 0.5));
  const door = rect(14.2, 20.8, 3.6, 4.7, 0.9);
  if (silhouette) return [[roof, WHITE], [body, WHITE], [pole, WHITE], [flag, WHITE]];
  const layers = plain ? [] : [[roundedSquare(9), VIOLET]];
  const pane = plain ? VIOLET_DEEP : VIOLET;
  return layers.concat([
    [pole, WHITE], [flag, CORAL],
    [roof, SUN], [body, WHITE],
    ...windows.map((w) => [w, pane]),
    [door, CORAL],
  ]);
}

// ---- turning shapes into pixels -----------------------------------------------------------------------------------
// Four samples across and four down for every pixel, so the roof's slope and the rounded corners come out smooth.
function draw(size, layers, { scale = 1, background = null }) {
  const px = Buffer.alloc(size * size * 4, 0);
  const SUB = 4;
  const span = 32 / scale;              // how much of the 32-wide drawing fits across the image
  const offset = (32 - span) / 2;       // centred, so a smaller mark sits in the middle of its square
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SUB; sy++) {
        for (let sx = 0; sx < SUB; sx++) {
          const x = offset + ((col + (sx + 0.5) / SUB) / size) * span;
          const y = offset + ((row + (sy + 0.5) / SUB) / size) * span;
          let colour = background;
          for (const [inside, paint] of layers) if (inside(x, y)) colour = paint;
          if (colour) { r += colour[0]; g += colour[1]; b += colour[2]; a += 255; }
        }
      }
      const n = SUB * SUB;
      const i = (row * size + col) * 4;
      if (a > 0) {
        // the colour is the average of the samples that were painted; the transparency is how many of them were
        px[i] = Math.round(r / (a / 255));
        px[i + 1] = Math.round(g / (a / 255));
        px[i + 2] = Math.round(b / (a / 255));
        px[i + 3] = Math.round(a / n);
      }
    }
  }
  return px;
}

// ---- a PNG, by hand ------------------------------------------------------------------------------------------------
const CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();
const chunk = (type, data) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(CRC(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
};
function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // eight bits a channel
  ihdr[9] = 6;    // red, green, blue and transparency
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let row = 0; row < size; row++) {
    raw[row * (size * 4 + 1)] = 0;   // this row is stored as it is, with no filtering
    pixels.copy(raw, row * (size * 4 + 1) + 1, row * size * 4, (row + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- the five files the app asks for ---------------------------------------------------------------------------
// icon            the square iOS and the app stores show; no transparency, no rounded corners of its own
// adaptive-icon   the Android foreground, which the phone may crop to a circle: the mark sits well inside it
// splash-icon     what shows while the app starts, on the violet given in app.json
// favicon         the browser tab, when the app is opened on the web
// notification-icon  Android draws this as one flat white shape, so it is given as one
const FILES = [
  ['icon.png', 1024, markLayers(), { scale: 1, background: VIOLET }],
  ['adaptive-icon.png', 1024, markLayers({ plain: true }), { scale: 0.58 }],
  ['splash-icon.png', 512, markLayers({ plain: true }), { scale: 0.8 }],
  ['favicon.png', 64, markLayers(), { scale: 1, background: VIOLET }],
  ['notification-icon.png', 96, markLayers({ silhouette: true }), { scale: 0.8 }],
];

const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
for (const [name, size, layers, how] of FILES) {
  const file = path.join(out, name);
  fs.writeFileSync(file, png(size, draw(size, layers, how)));
  console.log(`${name}  ${size}x${size}  ${fs.statSync(file).size} bytes`);
}
