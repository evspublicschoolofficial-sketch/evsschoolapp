const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  table[i] = c;
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const crcVal = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crcVal, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function createPng(width, height, getPixel) {
  const rowSize = width * 4;
  const rawData = Buffer.alloc((rowSize + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (rowSize + 1);
    rawData[rowOffset] = 0; // Filter type 0: None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = getPixel(x, y, width, height);
      const pxOffset = rowOffset + 1 + x * 4;
      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
      rawData[pxOffset + 3] = a;
    }
  }

  const compressed = zlib.deflateSync(rawData);
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bits per channel
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', compressed),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
}

// Letter bit patterns for "EVS" on a 5x7 grid
const FONT = {
  E: [
    [1,1,1,1,1],
    [1,0,0,0,0],
    [1,0,0,0,0],
    [1,1,1,1,0],
    [1,0,0,0,0],
    [1,0,0,0,0],
    [1,1,1,1,1],
  ],
  V: [
    [1,0,0,0,1],
    [1,0,0,0,1],
    [1,0,0,0,1],
    [1,0,0,0,1],
    [1,0,0,0,1],
    [0,1,0,1,0],
    [0,0,1,0,0],
  ],
  S: [
    [0,1,1,1,1],
    [1,0,0,0,0],
    [1,0,0,0,0],
    [0,1,1,1,0],
    [0,0,0,0,1],
    [0,0,0,0,1],
    [1,1,1,1,0],
  ]
};

function renderIcon(size, isMaskable = false) {
  return createPng(size, size, (x, y, w, h) => {
    // Normal coordinates from -1 to 1
    const nx = (x / w) * 2 - 1;
    const ny = (y / h) * 2 - 1;
    const dist = Math.sqrt(nx * nx + ny * ny);

    // Background gradient: Navy #0c2340 to deep blue #10316b
    const bgRad = Math.sqrt(nx * nx + (ny + 0.3) * (ny + 0.3));
    let r = Math.round(12 + (1 - Math.min(bgRad, 1)) * 20);
    let g = Math.round(35 + (1 - Math.min(bgRad, 1)) * 30);
    let b = Math.round(64 + (1 - Math.min(bgRad, 1)) * 60);
    let a = 255;

    // Outer rounded rect / circle border
    // Safe radius
    const maxRadius = isMaskable ? 0.72 : 0.88;
    const ringRadius = isMaskable ? 0.68 : 0.84;
    const ringInner = isMaskable ? 0.64 : 0.79;

    // Gold decorative outer ring
    if (dist >= ringInner && dist <= ringRadius) {
      return [245, 158, 11, 255]; // Gold #f59e0b
    }
    // Thin bright gold line inside
    if (dist >= ringInner - 0.02 && dist < ringInner) {
      return [252, 211, 77, 255]; // Bright gold #fcd34d
    }

    // Inside crest: decorative school building / graduation roof
    // Roof triangle at ny around -0.45 to -0.25
    if (ny >= -0.45 && ny <= -0.22) {
      const roofHalfW = (ny - (-0.45)) * 1.5;
      if (Math.abs(nx) <= roofHalfW) {
        return [245, 158, 11, 255]; // Gold roof
      }
    }
    // School pillared arch or book body
    if (ny > -0.22 && ny <= -0.05) {
      if (Math.abs(nx) <= 0.32) {
        // Pillars
        const inPillar = (Math.abs(nx) >= 0.05 && Math.abs(nx) <= 0.12) || 
                         (Math.abs(nx) >= 0.22 && Math.abs(nx) <= 0.29) ||
                         (Math.abs(nx) <= 0.02);
        if (inPillar) {
          return [254, 243, 199, 255]; // Warm cream
        }
        return [16, 49, 107, 255]; // Inner arch
      }
    }
    // Base of school
    if (ny > -0.05 && ny <= -0.01) {
      if (Math.abs(nx) <= 0.36) {
        return [245, 158, 11, 255];
      }
    }

    // "EVS" Typography in center (ny between 0.06 and 0.42)
    const textYMin = 0.08;
    const textYMax = 0.40;
    if (ny >= textYMin && ny <= textYMax) {
      const normY = (ny - textYMin) / (textYMax - textYMin);
      const row = Math.floor(normY * 7);

      // Letter widths and positions
      // E: nx from -0.36 to -0.14
      // V: nx from -0.11 to 0.11
      // S: nx from 0.14 to 0.36
      let charGrid = null;
      let col = -1;

      if (nx >= -0.36 && nx <= -0.14) {
        charGrid = FONT.E;
        col = Math.floor(((nx - (-0.36)) / 0.22) * 5);
      } else if (nx >= -0.11 && nx <= 0.11) {
        charGrid = FONT.V;
        col = Math.floor(((nx - (-0.11)) / 0.22) * 5);
      } else if (nx >= 0.14 && nx <= 0.36) {
        charGrid = FONT.S;
        col = Math.floor(((nx - 0.14) / 0.22) * 5);
      }

      if (charGrid && row >= 0 && row < 7 && col >= 0 && col < 5) {
        if (charGrid[row][col] === 1) {
          return [253, 230, 138, 255]; // Golden text
        }
      }
    }

    // Subtitle banner at bottom (ny between 0.46 and 0.58)
    if (ny >= 0.46 && ny <= 0.58 && Math.abs(nx) <= 0.42) {
      return [245, 158, 11, 255]; // Gold banner
    }
    // Inner text dot dashes on banner
    if (ny >= 0.50 && ny <= 0.54 && Math.abs(nx) <= 0.38) {
      return [12, 35, 64, 255]; // Navy bar text
    }

    return [r, g, b, a];
  });
}

const publicDir = path.resolve(__dirname, '../public');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}

console.log('Generating PWA and Apple Touch Icons...');

// 1. Apple Touch Icon 180x180 (Required for iOS)
const appleIcon180 = renderIcon(180, false);
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon.png'), appleIcon180);
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon-180x180.png'), appleIcon180);
console.log('✓ apple-touch-icon.png (180x180)');

// 2. Additional Apple sizes
const appleIcon152 = renderIcon(152, false);
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon-152x152.png'), appleIcon152);
const appleIcon120 = renderIcon(120, false);
fs.writeFileSync(path.join(publicDir, 'apple-touch-icon-120x120.png'), appleIcon120);
console.log('✓ apple-touch-icon-152x152.png & 120x120.png');

// 3. PWA Icons 192x192 & 512x512
const pwa192 = renderIcon(192, false);
fs.writeFileSync(path.join(publicDir, 'pwa-192x192.png'), pwa192);
console.log('✓ pwa-192x192.png');

const pwa512 = renderIcon(512, false);
fs.writeFileSync(path.join(publicDir, 'pwa-512x512.png'), pwa512);
console.log('✓ pwa-512x512.png');

// 4. Maskable 512x512 (with safe margins for Android)
const pwaMaskable512 = renderIcon(512, true);
fs.writeFileSync(path.join(publicDir, 'pwa-maskable-512x512.png'), pwaMaskable512);
console.log('✓ pwa-maskable-512x512.png');

// 5. Favicon
const favicon = renderIcon(64, false);
fs.writeFileSync(path.join(publicDir, 'favicon.png'), favicon);
console.log('✓ favicon.png');

// 6. SVG Icon for desktop browsers
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0c2340"/>
      <stop offset="50%" stop-color="#10316b"/>
      <stop offset="100%" stop-color="#06162a"/>
    </linearGradient>
    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fcd34d"/>
      <stop offset="100%" stop-color="#d97706"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bgGrad)"/>
  <circle cx="256" cy="235" r="148" fill="none" stroke="url(#goldGrad)" stroke-width="8"/>
  <circle cx="256" cy="235" r="136" fill="#ffffff" fill-opacity="0.05"/>
  <!-- School Emblem Roof -->
  <path d="M 256 120 L 350 170 L 256 220 L 162 170 Z" fill="url(#goldGrad)"/>
  <!-- Emblem Pillars -->
  <path d="M 190 200 L 190 250 C 190 278 226 298 256 298 C 286 298 322 278 322 250 L 322 200 L 256 235 Z" fill="#f8fafc"/>
  <path d="M 355 178 L 355 255 L 347 255 L 347 182 Z" fill="url(#goldGrad)"/>
  <!-- Typography -->
  <text x="256" y="348" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-weight="900" font-size="56" fill="#fbbf24" text-anchor="middle" letter-spacing="4">E.V.S.</text>
  <text x="256" y="392" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-weight="800" font-size="22" fill="#f1f5f9" text-anchor="middle" letter-spacing="3">PUBLIC SCHOOL</text>
  <rect x="136" y="415" width="240" height="28" rx="14" fill="#f59e0b"/>
  <text x="256" y="434" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-weight="800" font-size="12" fill="#0c2340" text-anchor="middle" letter-spacing="2">OFFICIAL PORTAL</text>
</svg>`;
fs.writeFileSync(path.join(publicDir, 'icon.svg'), svgContent);
console.log('✓ icon.svg');

console.log('All icons generated successfully!');
