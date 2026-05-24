// ==UserScript==
// @name         签名墙 - 图片上传 & 动图转换
// @namespace    https://msensen.top/
// @version      2.0
// @description  上传静态图片到画布；上传 GIF 自动转为 APNG 贴到墙上
// @author       You
// @match        https://msensen.top/signature-wall*
// @require      https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js
// @require      https://cdn.jsdelivr.net/npm/upng-js@2.1.0/UPNG.js
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const API = 'https://msensen.top/api/signature-wall';
  const MAX_PX = 200; // max frame dimension before resize

  // ═══════════════════════════════════════════════════════════════
  //  Minimal GIF parser  (no external dependency)
  // ═══════════════════════════════════════════════════════════════
  function parseGIF(buffer) {
    const d = new Uint8Array(buffer);
    let p = 6; // skip "GIF89a" / "GIF87a"

    // Logical Screen Descriptor
    const width  = d[p] | (d[p+1] << 8); p += 2;
    const height = d[p] | (d[p+1] << 8); p += 2;
    const flags  = d[p]; p += 1;
    p += 2; // bg color + pixel aspect

    // Global Color Table
    let gct = null;
    if (flags & 0x80) {
      const sz = 3 * (2 << (flags & 0x07));
      gct = d.slice(p, p + sz); p += sz;
    }

    const frames = [];
    const delays = [];
    let transparentIdx = -1;
    let disposal = 0;

    while (p < d.length) {
      const bt = d[p]; p++;
      if (bt === 0x3B) break;          // trailer
      if (bt === 0x2C) {                // image descriptor
        const left = d[p] | (d[p+1] << 8); p += 2;
        const top  = d[p] | (d[p+1] << 8); p += 2;
        const iw   = d[p] | (d[p+1] << 8); p += 2;
        const ih   = d[p] | (d[p+1] << 8); p += 2;
        const fl   = d[p]; p += 1;

        let lct = null;
        if (fl & 0x80) {
          const sz = 3 * (2 << (fl & 0x07));
          lct = d.slice(p, p + sz); p += sz;
        }
        const interlaced = !!(fl & 0x40);
        const palette = lct || gct;

        // Read LZW sub-blocks
        const minCodeSize = d[p]; p++;
        const lzwBytes = [];
        while (true) {
          const len = d[p]; p++;
          if (len === 0) break;
          for (let i = 0; i < len; i++) lzwBytes.push(d[p + i]);
          p += len;
        }

        const pixels = lzwDecode(lzwBytes, minCodeSize, palette, transparentIdx, iw, ih, interlaced);
        frames.push({ rgba: pixels, w: iw, h: ih, left, top, disposal });
        // ensure delay is set for this frame
        while (delays.length < frames.length) delays.push(10);
      } else if (bt === 0x21) {         // extension
        const et = d[p]; p++;
        if (et === 0xF9) {              // graphic control
          p++;                           // block size (4)
          const pk = d[p]; p++;
          const delay = d[p] | (d[p+1] << 8); p += 2;
          transparentIdx = (pk & 0x01) ? d[p] : -1; p++;
          disposal = (pk >> 2) & 0x07;
          p++;                           // terminator
          delays.push(delay || 10);
        } else {
          // skip unknown extension
          while (p < d.length) {
            const len = d[p]; p++;
            if (len === 0) break;
            p += len;
          }
        }
      }
    }
    return { width, height, frames, delays };
  }

  function lzwDecode(data, minCodeSize, palette, transparentIdx, fw, fh, interlaced) {
    const clearCode = 1 << minCodeSize;
    const eoiCode   = clearCode + 1;
    let codeSize    = minCodeSize + 1;
    let maxCode     = (1 << codeSize) - 1;
    let nextCode    = eoiCode + 1;

    // Build bits array
    const bits = [];
    for (let i = 0; i < data.length; i++) {
      for (let j = 0; j < 8; j++) bits.push((data[i] >> j) & 1);
    }

    let bp = 0;
    function readCode() {
      let c = 0;
      for (let i = 0; i < codeSize; i++) {
        if (bp >= bits.length) return -1;
        c |= bits[bp++] << i;
      }
      return c;
    }

    // Initialize table
    const table = new Map();
    for (let i = 0; i < clearCode; i++) table.set(i, [i]);

    let prevBytes = null;
    const output = [];

    while (true) {
      const code = readCode();
      if (code < 0 || code === eoiCode) break;
      if (code === clearCode) {
        table.clear();
        for (let i = 0; i < clearCode; i++) table.set(i, [i]);
        nextCode = eoiCode + 1;
        codeSize = minCodeSize + 1;
        maxCode  = (1 << codeSize) - 1;
        prevBytes = null;
        continue;
      }

      let entry;
      if (table.has(code)) {
        entry = table.get(code);
      } else if (code === nextCode && prevBytes) {
        entry = prevBytes.concat([prevBytes[0]]);
      } else {
        break;
      }

      for (let i = 0; i < entry.length; i++) output.push(entry[i]);

      if (prevBytes && nextCode < 4096) {
        table.set(nextCode, prevBytes.concat([entry[0]]));
        nextCode++;
        if (nextCode > maxCode && codeSize < 12) {
          codeSize++;
          maxCode = (1 << codeSize) - 1;
        }
      }
      prevBytes = entry;
    }

    // Build RGBA from indexed pixels
    const rgba = new Uint8Array(fw * fh * 4);
    const totalPixels = fw * fh;
    const pixels = output.slice(0, totalPixels);

    // Deinterlace if needed
    let idx = 0;
    const rawIdx = new Uint16Array(fw * fh);
    if (interlaced) {
      const passes = [[0,8],[4,8],[2,4],[1,2]];
      for (const [start, step] of passes) {
        for (let y = start; y < fh; y += step) {
          for (let x = 0; x < fw; x++) {
            rawIdx[y * fw + x] = idx++;
          }
        }
      }
    } else {
      for (let i = 0; i < fw * fh; i++) rawIdx[i] = i;
    }

    for (let i = 0; i < Math.min(pixels.length, totalPixels); i++) {
      const colorIdx = pixels[i];
      const pi = rawIdx[i] * 4;
      if (colorIdx === transparentIdx) {
        rgba[pi] = rgba[pi+1] = rgba[pi+2] = rgba[pi+3] = 0;
      } else if (palette && colorIdx * 3 + 2 < palette.length) {
        rgba[pi]   = palette[colorIdx * 3];
        rgba[pi+1] = palette[colorIdx * 3 + 1];
        rgba[pi+2] = palette[colorIdx * 3 + 2];
        rgba[pi+3] = 255;
      } else {
        rgba[pi] = rgba[pi+1] = rgba[pi+2] = 0; rgba[pi+3] = 255;
      }
    }
    return rgba;
  }

  // ═══════════════════════════════════════════════════════════════
  //  Page injection
  // ═══════════════════════════════════════════════════════════════

  function waitFor(sel, cb, max) {
    max = max || 50;
    const el = document.querySelector(sel);
    if (el) return cb(el);
    if (max <= 0) return;
    setTimeout(function () { waitFor(sel, cb, max - 1); }, 200);
  }

  function setStatus(el, msg, kind) {
    el.textContent = msg;
    el.dataset.kind = kind;
  }

  function inject() {
    const canvas      = document.getElementById('signatureCanvas');
    const placeholder = document.getElementById('canvasPlaceholder');
    const formActions = document.querySelector('.form-actions');
    const statusEl    = document.getElementById('formStatus');
    const submitBtn   = document.getElementById('submitButton');
    const clearBtn    = document.getElementById('clearButton');

    if (!canvas || !placeholder || !formActions) return;

    // 4-column grid on desktop
    var gridFix = document.createElement('style');
    gridFix.textContent = '@media(min-width:521px){.form-actions[data-astro-cid-3pxndrdx]{grid-template-columns:repeat(4,1fr)}}';
    document.head.appendChild(gridFix);

    // Hidden shared file picker
    var file = document.createElement('input');
    file.type = 'file';
    file.accept = 'image/*';
    file.style.display = 'none';
    document.body.appendChild(file);

    // "上传图片" button
    var imgBtn = document.createElement('button');
    imgBtn.className = 'wall-button secondary';
    imgBtn.type = 'button';
    imgBtn.setAttribute('data-astro-cid-3pxndrdx', '');
    imgBtn.textContent = '上传图片';
    imgBtn.title = '选择静态图片贴到画布';
    imgBtn.addEventListener('click', function () {
      file.dataset.mode = 'static';
      file.accept = 'image/png,image/jpeg,image/webp';
      file.click();
    });

    // "上传动图" button
    var gifBtn = document.createElement('button');
    gifBtn.className = 'wall-button secondary';
    gifBtn.type = 'button';
    gifBtn.setAttribute('data-astro-cid-3pxndrdx', '');
    gifBtn.textContent = '上传动图';
    gifBtn.title = '选择 GIF，自动转 APNG';
    gifBtn.addEventListener('click', function () {
      file.dataset.mode = 'gif';
      file.accept = 'image/gif';
      file.click();
    });

    formActions.insertBefore(gifBtn, formActions.firstChild);
    formActions.insertBefore(imgBtn, formActions.firstChild);

    // File handler
    file.addEventListener('change', function () {
      var f = file.files[0];
      if (!f) return;
      if (file.dataset.mode === 'gif') {
        handleGifUpload(f, statusEl, submitBtn, clearBtn);
      } else {
        handleStaticImage(f, canvas, placeholder);
      }
      file.value = '';
    });
  }

  // ── Static image → canvas ──────────────────────────────────────
  function handleStaticImage(f, canvas, placeholder) {
    var img = new Image();
    img.onload = function () {
      var ctx  = canvas.getContext('2d');
      var rect = canvas.getBoundingClientRect();
      var dpr  = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
      var dw = rect.width, dh = rect.height;
      var scale = Math.min(dw / img.width, dh / img.height);
      var w = img.width * scale, h = img.height * scale;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, dw, dh);
      ctx.drawImage(img, (dw - w) / 2, (dh - h) / 2, w, h);
      placeholder.hidden = true;

      var cx = rect.left + dw / 2, cy = rect.top + dh / 2;
      canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, pointerId: 99, bubbles: true }));
      canvas.dispatchEvent(new PointerEvent('pointerup',   { clientX: cx, clientY: cy, pointerId: 99, bubbles: true }));
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(f);
  }

  // ── GIF → APNG → direct POST ──────────────────────────────────
  async function handleGifUpload(f, statusEl, submitBtn, clearBtn) {
    if (typeof UPNG === 'undefined') {
      setStatus(statusEl, '动图编码库加载失败，请刷新后重试', 'error');
      return;
    }

    setStatus(statusEl, '正在解析动图...', 'info');
    submitBtn.disabled = true;
    clearBtn.disabled = true;

    try {
      var buf = await readAsArrayBuffer(f);
      var gif = parseGIF(buf);
      var numFrames = gif.frames.length;

      if (numFrames < 2) {
        setStatus(statusEl, '不是动图（仅 1 帧），请用"上传图片"', 'error');
        submitBtn.disabled = false;
        clearBtn.disabled = false;
        return;
      }
      if (numFrames > 200) {
        setStatus(statusEl, '帧数过多 (' + numFrames + ')，请精简到 200 帧以内', 'error');
        submitBtn.disabled = false;
        clearBtn.disabled = false;
        return;
      }

      var w = gif.width, h = gif.height;
      var rw = w, rh = h;
      if (Math.max(w, h) > MAX_PX) {
        var s = MAX_PX / Math.max(w, h);
        rw = Math.round(w * s);
        rh = Math.round(h * s);
      }

      setStatus(statusEl, '正在转换 ' + numFrames + ' 帧...', 'info');

      // Composite frames onto a canvas
      var canvasBuffer = new Uint8Array(rw * rh * 4);
      var apngFrames = [];
      var apngDelays = [];

      for (var i = 0; i < numFrames; i++) {
        var frame = gif.frames[i];
        var rgba = frame.rgba;
        var fw = frame.w, fh = frame.h;
        var left = frame.left, top = frame.top;

        // Scale
        var sl = Math.round(left * rw / w);
        var st = Math.round(top * rh / h);
        var sfw = Math.round(fw * rw / w);
        var sfh = Math.round(fh * rh / h);

        if (fw !== sfw || fh !== sfh) {
          rgba = resizeRGBA(rgba, fw, fh, sfw, sfh);
        }

        // Composite
        if (i === 0 || frame.disposal === 2) {
          canvasBuffer.fill(0);
        }

        for (var dy = 0; dy < sfh; dy++) {
          if (st + dy >= rh) break;
          for (var dx = 0; dx < sfw; dx++) {
            if (sl + dx >= rw) break;
            var si = (dy * sfw + dx) * 4;
            var di = ((st + dy) * rw + (sl + dx)) * 4;
            var a = rgba[si + 3];
            if (a > 128) {
              canvasBuffer[di] = rgba[si];
              canvasBuffer[di+1] = rgba[si+1];
              canvasBuffer[di+2] = rgba[si+2];
              canvasBuffer[di+3] = 255;
            }
          }
        }

        apngFrames.push(new Uint8Array(canvasBuffer));
        apngDelays.push((gif.delays[i] || 10) * 10); // cs → ms
      }

      // Encode APNG
      setStatus(statusEl, '正在编码...', 'info');
      var apngBuf = UPNG.encode(apngFrames, rw, rh, 256, apngDelays);

      if (apngBuf.byteLength > 900 * 1024) {
        setStatus(statusEl, '文件过大 (' + (apngBuf.byteLength / 1024 / 1024).toFixed(1) + 'MB)，请用更小的动图', 'error');
        submitBtn.disabled = false;
        clearBtn.disabled = false;
        return;
      }

      // Upload
      setStatus(statusEl, '正在上传...', 'info');
      var b64 = arrayBufferToBase64(apngBuf);
      var dataUrl = 'data:image/png;base64,' + b64;
      var nickname = document.getElementById('nicknameInput') ? document.getElementById('nicknameInput').value : '';

      var res = await fetch(API + '/signatures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: nickname, imageDataUrl: dataUrl, website: '' }),
      });

      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        if (res.status === 413) throw new Error('文件过大，服务器拒绝。请选用更小的动图');
        throw new Error(data.error || '上传失败 (' + res.status + ')');
      }

      setStatus(statusEl, '动图已上墙 (' + numFrames + ' 帧, ' + (apngBuf.byteLength / 1024).toFixed(0) + 'KB)', 'success');

      // Insert card at top of wall
      var grid  = document.getElementById('signatureGrid');
      var count = document.getElementById('wallCount');
      if (grid && data.signature) {
        var emptyEl = grid.querySelector('.empty-wall');
        if (emptyEl) emptyEl.remove();
        grid.insertBefore(buildCard(data.signature, true), grid.firstChild);
        if (count) {
          count.textContent = grid.querySelectorAll('.signature-card:not(.skeleton-card)').length + ' 张';
        }
      }
    } catch (err) {
      setStatus(statusEl, err.message || '转换失败', 'error');
    } finally {
      submitBtn.disabled = false;
      clearBtn.disabled = false;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────
  function readAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = reject;
      r.readAsArrayBuffer(file);
    });
  }

  function arrayBufferToBase64(buffer) {
    var bytes = new Uint8Array(buffer);
    var binary = '';
    for (var i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  function resizeRGBA(src, sw, sh, dw, dh) {
    var dst = new Uint8Array(dw * dh * 4);
    var xr = sw / dw, yr = sh / dh;
    for (var dy = 0; dy < dh; dy++) {
      for (var dx = 0; dx < dw; dx++) {
        var sx = Math.floor(dx * xr), sy = Math.floor(dy * yr);
        var si = (sy * sw + sx) * 4, di = (dy * dw + dx) * 4;
        dst[di]=src[si]; dst[di+1]=src[si+1]; dst[di+2]=src[si+2]; dst[di+3]=src[si+3];
      }
    }
    return dst;
  }

  function buildCard(sig, justPosted) {
    var card = document.createElement('article');
    card.className = 'signature-card' + (justPosted ? ' just-posted' : '');

    var img = document.createElement('img');
    img.src = sig.imageUrl.indexOf('http') === 0 ? sig.imageUrl : API + sig.imageUrl.replace('/api/signature-wall', '');
    img.alt = (sig.nickname || '匿名访客') + ' 的签名';
    img.loading = 'lazy';

    var meta = document.createElement('div');
    meta.className = 'signature-meta';

    var strong = document.createElement('strong');
    strong.textContent = sig.nickname || '匿名访客';

    var time = document.createElement('time');
    time.dateTime = sig.createdAt;
    time.textContent = new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(sig.createdAt));

    meta.appendChild(strong);
    meta.appendChild(time);
    card.appendChild(img);
    card.appendChild(meta);
    return card;
  }

  waitFor('#signatureCanvas', inject);
})();
