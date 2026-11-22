// The upload steps, shared by the app (js/api.js imports this file) and the offline layer (sw.js loads it with
// importScripts), so a report uploads the same way with the app open or in the background (Brandon, 11/21:
// "can the app be revised to upload automatically in the background?"). Plain script, no import/export, so both
// can load it; it hangs one object on the global: SwpppUpload.
//
// Background upload is Chrome's Background Sync (Android). Safari on an iPhone doesn't have it: there the app
// uploads while it is open, as before.
//
// One uploader at a time per phone: both sides take the same Web Lock, so the app and the background never push
// the same report at once.
(function (g) {
  'use strict';

  const LOCK = 'swppp-upload';
  const SYNC_TAG = 'swppp-upload';

  // A paused pass (the background ran out of its time) isn't a failure: the next pass picks up there.
  class Paused extends Error {
    constructor() { super('paused'); this.name = 'Paused'; }
  }

  // Base64 without FileReader, so it works the same in the offline layer.
  async function toBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  // A plain-text POST to the Google script (no CORS preflight). `signal` lets the app stop it when it hands off.
  async function post(url, payload, timeoutMs, signal) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const stop = () => ctl.abort();
    if (signal) {
      if (signal.aborted) ctl.abort();
      else signal.addEventListener('abort', stop);
    }
    try {
      const r = await fetch(url, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        redirect: 'follow',
        signal: ctl.signal,
      });
      if (!r.ok) throw new Error(`server said ${r.status}`);
      const out = await r.json();
      if (!out.ok) throw new Error(out.error || 'server refused');
      return out;
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', stop);
    }
  }

  // Upload one signed report, resuming where any earlier pass stopped. The record is read fresh from the phone's
  // store, so progress either side made counts. io: { code, call(payload, timeoutMs), getReport(id), putReport(r),
  // getBlob(key), toBase64(blob), stop() }. stop() returning true pauses between steps (throws Paused).
  // Returns the script's answer to 'finish', or null when the report isn't waiting any more.
  async function uploadOne(id, io, say) {
    say = say || (() => {});
    const r = await io.getReport(id);
    if (!r || r.status !== 'signed') return null;
    const halt = () => { if (io.stop && io.stop()) throw new Paused(); };
    r.upload = r.upload || { begun: false, done: [] };
    if (!r.upload.begun) {
      halt();
      say('Starting upload');
      await io.call({ action: 'begin', code: io.code, report: r.data, meta: r.meta }, 60000);
      r.upload.begun = true;
      await io.putReport(r);
    }
    const files = r.files || [];
    for (const [i, f] of files.entries()) {
      if (r.upload.done.includes(f.name)) continue;
      halt();
      say(`Uploading ${i + 1} of ${files.length}`);
      const blob = await io.getBlob(f.key);
      if (!blob) throw new Error(`missing ${f.name} on this phone`);
      await io.call({ action: 'file', code: io.code, report_id: r.id, name: f.name, kind: f.kind, mime: blob.type || f.mime, data: await (io.toBase64 || toBase64)(blob) }, 180000);
      r.upload.done.push(f.name);
      await io.putReport(r);
    }
    halt();
    say('Filing the report');
    const out = await io.call({ action: 'finish', code: io.code, report_id: r.id }, 120000);
    r.status = 'filed';
    r.filed = { at: Date.now(), pdf_url: out.pdf_url || null, folder_url: out.folder_url || null, drafted: !!out.drafted, email: out.email || null };
    await io.putReport(r);
    say('Filed');
    return out;
  }

  // Run fn(true) holding the upload lock, or fn(false) if it can't be had within waitMs (0: don't wait).
  // A phone without Web Locks (an iPhone before iOS 15.4) has no background upload either, so it just runs.
  async function withLock(waitMs, fn) {
    const locks = g.navigator && g.navigator.locks;
    if (!locks) return fn(true);
    if (!waitMs) return locks.request(LOCK, { ifAvailable: true }, (lock) => fn(!!lock));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), waitMs);
    let held = false;
    try {
      return await locks.request(LOCK, { signal: ctl.signal }, (lock) => { held = true; clearTimeout(timer); return fn(!!lock); });
    } catch (e) {
      if (!held && e && e.name === 'AbortError') return fn(false);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  g.SwpppUpload = { LOCK, SYNC_TAG, Paused, toBase64, post, uploadOne, withLock };
})(self);
