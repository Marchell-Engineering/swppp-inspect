// Photos, GPS and the signature pad.

// A camera photo is 3-8 MB; the stored copy is 1600 px on the long side (about 300-500 KB), plenty for a
// report and quick to upload over one bar of signal. The PDF gets a smaller copy made at print time.
export async function shrinkPhoto(file, maxSide = 1600, quality = 0.82) {
  const bmp = await loadBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', quality));
  return { blob, width: w, height: h };
}

async function loadBitmap(file) {
  if (window.createImageBitmap) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) { /* fall back to an <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// A JPEG data URL of a stored photo at a given size, for the PDF.
export async function photoDataUrl(blob, maxSide = 900, quality = 0.72) {
  const { blob: small } = await shrinkPhoto(blob, maxSide, quality);
  return blobToDataUrl(small);
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function blobToBase64(blob) {
  const url = await blobToDataUrl(blob);
  return url.slice(url.indexOf(',') + 1);
}

// Where a photo was taken, from the GPS the camera wrote into it (Brandon, 11/16: "can the GPS pull from the
// photo instead of the location the phone was in"). A JPEG's EXIF GPS block, read off the original file before
// it is shrunk. Many phones strip it when a web page picks a photo, so this is often null; never throws.
export async function exifGps(file) {
  try {
    const v = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null;
    let o = 2;
    while (o + 4 <= v.byteLength) {
      const marker = v.getUint16(o);
      const len = v.getUint16(o + 2);
      if (marker === 0xffe1 && v.getUint32(o + 4) === 0x45786966) return tiffGps(v, o + 10);   // 'Exif'
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) return null;
      o += 2 + len;
    }
  } catch (e) { /* not a JPEG we can read */ }
  return null;
}

function tiffGps(v, t) {
  const le = v.getUint16(t) === 0x4949;
  const u16 = (o) => v.getUint16(t + o, le);
  const u32 = (o) => v.getUint32(t + o, le);
  const tags = (ifd) => {
    const out = {};
    for (let i = 0, n = u16(ifd); i < n; i++) {
      const e = ifd + 2 + i * 12;
      out[u16(e)] = { type: u16(e + 2), count: u32(e + 4), at: e + 8 };
    }
    return out;
  };
  const gpsPtr = tags(u32(4))[0x8825];
  if (!gpsPtr) return null;
  const g = tags(u32(gpsPtr.at));
  const ref = (k) => (g[k] ? String.fromCharCode(v.getUint8(t + g[k].at)) : '');
  const dms = (k) => {
    if (!g[k] || g[k].type !== 5 || g[k].count < 3) return null;
    const at = u32(g[k].at);
    const r = (i) => { const d = u32(at + i * 8 + 4); return d ? u32(at + i * 8) / d : 0; };
    return r(0) + r(1) / 60 + r(2) / 3600;
  };
  let lat = dms(2);
  let lon = dms(4);
  if (lat === null || lon === null || (lat === 0 && lon === 0)) return null;
  if (ref(1) === 'S') lat = -lat;
  if (ref(3) === 'W') lon = -lon;
  return { lat, lon, acc: null, from: 'photo' };
}

// metres between two fixes
export function metres(a, b) {
  const rad = Math.PI / 180;
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad);
  const y = (b.lat - a.lat) * rad;
  return Math.sqrt(x * x + y * y) * 6371e3;
}

// GPS works with no cell signal; it just takes longer to lock on. Never throws: no fix is fine.
export function where(timeoutMs = 15000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, acc: Math.round(p.coords.accuracy), at: p.timestamp }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 },
    );
  });
}

// A finger signature on a canvas.
export class SigPad {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.strokes = 0;
    this.drawing = false;
    this.resize();
    const pos = (e) => {
      const r = this.c.getBoundingClientRect();
      return [(e.clientX - r.left) * (this.c.width / r.width), (e.clientY - r.top) * (this.c.height / r.height)];
    };
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      this.drawing = true;
      this.strokes += 1;
      const [x, y] = pos(e);
      this.ctx.beginPath();
      this.ctx.moveTo(x, y);
      this.ctx.lineTo(x + 0.1, y + 0.1);
      this.ctx.stroke();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.drawing) return;
      e.preventDefault();
      const [x, y] = pos(e);
      this.ctx.lineTo(x, y);
      this.ctx.stroke();
    });
    const up = () => { this.drawing = false; if (this.onchange) this.onchange(); };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  }

  resize() {
    const r = this.c.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    this.c.width = Math.max(300, Math.round(r.width * ratio));
    this.c.height = Math.max(120, Math.round(r.height * ratio));
    this.ctx.lineWidth = 2.5 * ratio;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    this.ctx.strokeStyle = '#10204a';
    this.clear();
  }

  clear() {
    this.ctx.fillStyle = '#fff';
    this.ctx.fillRect(0, 0, this.c.width, this.c.height);
    this.strokes = 0;
    if (this.onchange) this.onchange();
  }

  isEmpty() {
    return this.strokes === 0;
  }

  toBlob() {
    return new Promise((res) => this.c.toBlob(res, 'image/png'));
  }
}
