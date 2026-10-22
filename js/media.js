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
