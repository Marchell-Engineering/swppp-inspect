// Voice notes on a bank walk (Brandon, 11/17: "a voice record feature: he talks on site, the recording is kept
// and transcribed into the notes"). The phone only records and keeps the clips; the laptop transcribes them once
// they are filed (tools/walk_notes.py, with the same local Whisper Feed uses for voicemail), so nothing needs
// signal or an outside service on site.
//
// Built for interruption, because a walk means switching to the camera, locking the screen and losing signal:
// - the recorder hands over a piece every 10 s and each piece is added to the clip in IndexedDB at once, so a
//   page the phone kills keeps everything up to the last 10 s;
// - a clip closes every CLIP_MS and the next one starts on the same microphone, so each upload stays small
//   (the upload queue sends one file per request and stops at the first failure);
// - when another app takes the microphone the clip closes and the button says so; a reload finds a clip left
//   open and closes it (closeStale).
//
// Clip record (in the walk record, R.voice): { id, n, started_ms, ended_ms, secs, mime, bytes, open }.
// Its audio lives in the blobs store as `voice:<report id>:<clip id>`.

import { blobs, uid } from './store.js';

export const CLIP_MS = 4 * 60e3;
const SLICE_MS = 10e3;
const BITRATE = 24000;   // mono speech: about 180 kB a minute

export function supported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
}

function pickMime() {
  for (const m of ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm']) {
    try { if (MediaRecorder.isTypeSupported(m)) return m; } catch (e) { /* older browser */ }
  }
  return '';
}

export function extFor(mime) {
  return /mp4|aac/.test(mime || '') ? 'm4a' : /ogg/.test(mime || '') ? 'ogg' : 'webm';
}

export const clipKey = (recId, clipId) => `voice:${recId}:${clipId}`;

export function fmtSecs(s) {
  s = Math.max(0, Math.round(s || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// a clip still marked open when the walk is opened again (the page was killed mid-recording): what was saved stands
export function closeStale(R) {
  let changed = false;
  for (const c of R.voice || []) {
    if (!c.open) continue;
    c.open = false;
    c.ended_ms = c.ended_ms || c.started_ms + (c.secs || 0) * 1000;
    changed = true;
  }
  return changed;
}

// One recording session. opts: { recId, R, save(), onchange(state) }. state: 'idle' | 'starting' | 'recording'
// | 'stopped-by-phone' | 'denied' | 'error'.
export class Recorder {
  constructor(opts) {
    this.o = opts;
    this.state = 'idle';
    this.stream = null;
    this.mr = null;
    this.clip = null;
    this.rollTimer = null;
    this.tick = null;
    this.chain = Promise.resolve();
  }

  set(state, msg) {
    this.state = state;
    this.msg = msg || '';
    if (this.o.onchange) this.o.onchange(state);
  }

  async start() {
    if (this.state === 'recording' || this.state === 'starting') return;
    this.set('starting');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch (e) {
      this.set(e && e.name === 'NotAllowedError' ? 'denied' : 'error', e && e.message);
      return;
    }
    const track = this.stream.getAudioTracks()[0];
    if (track) track.addEventListener('ended', () => this.stop('stopped-by-phone'));
    this.mime = pickMime();
    this.newClip();
    this.set('recording');
    this.tick = setInterval(() => { if (this.o.onchange) this.o.onchange('recording'); }, 1000);
  }

  newClip() {
    const R = this.o.R;
    R.voice = R.voice || [];
    const now = Date.now();
    this.clip = { id: uid(), n: R.voice.length + 1, started_ms: now, ended_ms: null, secs: 0, mime: '', bytes: 0, open: true };
    R.voice.push(this.clip);
    const clip = this.clip;
    let mr;
    try {
      mr = new MediaRecorder(this.stream, { ...(this.mime ? { mimeType: this.mime } : {}), audioBitsPerSecond: BITRATE });
    } catch (e) {
      mr = new MediaRecorder(this.stream);
    }
    this.mr = mr;
    clip.mime = (mr.mimeType || this.mime || 'audio/webm').split(';')[0];
    const parts = [];
    mr.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      parts.push(e.data);
      const blob = new Blob(parts, { type: clip.mime });
      clip.bytes = blob.size;
      clip.secs = (Date.now() - clip.started_ms) / 1000;
      // in order, so a slow write never lands after a newer one
      this.chain = this.chain.then(() => blobs.put(clipKey(this.o.recId, clip.id), blob)).then(() => this.o.save()).catch(() => {});
    };
    mr.onstop = () => {
      clip.open = false;
      clip.ended_ms = Date.now();
      clip.secs = (clip.ended_ms - clip.started_ms) / 1000;
      this.chain = this.chain.then(() => this.o.save());
    };
    mr.start(SLICE_MS);
    clearTimeout(this.rollTimer);
    this.rollTimer = setTimeout(() => this.roll(), CLIP_MS);
  }

  // close this clip and start the next on the same microphone
  roll() {
    if (this.state !== 'recording' || !this.mr) return;
    const old = this.mr;
    this.newClip();
    try { old.stop(); } catch (e) { /* already stopped */ }
  }

  // why: 'idle' when the walker taps Stop, 'stopped-by-phone' when the microphone went away
  async stop(why = 'idle') {
    clearTimeout(this.rollTimer);
    clearInterval(this.tick);
    const mr = this.mr;
    this.mr = null;
    if (mr && mr.state !== 'inactive') {
      await new Promise((resolve) => {
        mr.addEventListener('stop', resolve, { once: true });
        try { mr.requestData(); } catch (e) { /* nothing buffered */ }
        try { mr.stop(); } catch (e) { resolve(); }
      });
    }
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.stream = null;
    await this.chain;
    // a clip with no sound saved at all (stopped in the first moment) is dropped
    const R = this.o.R;
    const empty = (R.voice || []).filter((c) => !c.open && !c.bytes);
    for (const c of empty) await blobs.del(clipKey(this.o.recId, c.id));
    R.voice = (R.voice || []).filter((c) => c.bytes);
    R.voice.forEach((c, i) => { c.n = i + 1; });
    await this.o.save();
    this.set(why);
  }

  elapsed() {
    return this.clip ? (Date.now() - this.clip.started_ms) / 1000 : 0;
  }
}

// all clips' total length
export function totalSecs(R) {
  return (R.voice || []).reduce((t, c) => t + (c.secs || 0), 0);
}
