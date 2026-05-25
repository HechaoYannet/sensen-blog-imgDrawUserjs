// ==UserScript==
// @name         签名墙 - 图片上传
// @namespace    https://msensen.top/
// @version      2.3
// @description  为涂鸦签名墙添加上传图片与 GIF 动图功能
// @author       UnSultan
// @match        https://msensen.top/signature-wall*
// @require      https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js
// @require      https://cdn.jsdelivr.net/npm/upng-js@2.1.0/UPNG.js
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  var API = 'https://msensen.top/api/signature-wall';
  var MAX_PX = 200;

  // ═══════════════════════════════════════════════════════════════
  //  Minimal GIF parser
  // ═══════════════════════════════════════════════════════════════
  function parseGIF(buffer) {
    var d = new Uint8Array(buffer), p = 6;
    var width = d[p] | (d[p+1] << 8); p += 2;
    var height = d[p] | (d[p+1] << 8); p += 2;
    var flags = d[p]; p += 1; p += 2;
    var gct = null;
    if (flags & 0x80) { var sz = 3 * (2 << (flags & 0x07)); gct = d.slice(p, p + sz); p += sz; }
    var frames = [], delays = [];
    var transparentIdx = -1, disposal = 0;
    while (p < d.length) {
      var bt = d[p]; p++;
      if (bt === 0x3B) break;
      if (bt === 0x2C) {
        var left = d[p] | (d[p+1] << 8); p += 2;
        var top = d[p] | (d[p+1] << 8); p += 2;
        var iw = d[p] | (d[p+1] << 8); p += 2;
        var ih = d[p] | (d[p+1] << 8); p += 2;
        var fl = d[p]; p += 1;
        var lct = null;
        if (fl & 0x80) { var lsz = 3 * (2 << (fl & 0x07)); lct = d.slice(p, p + lsz); p += lsz; }
        var interlaced = !!(fl & 0x40);
        var palette = lct || gct;
        var minCodeSize = d[p]; p++;
        var lzwBytes = [];
        while (true) { var len = d[p]; p++; if (len === 0) break; for (var li = 0; li < len; li++) lzwBytes.push(d[p+li]); p += len; }
        var rgba = lzwDecode(lzwBytes, minCodeSize, palette, transparentIdx, iw, ih, interlaced);
        frames.push({ rgba: rgba, w: iw, h: ih, left: left, top: top, disposal: disposal });
        while (delays.length < frames.length) delays.push(10);
      } else if (bt === 0x21) {
        var et = d[p]; p++;
        if (et === 0xF9) { p++; var pk = d[p]; p++; var delay = d[p] | (d[p+1] << 8); p += 2; transparentIdx = (pk & 0x01) ? d[p] : -1; p++; disposal = (pk >> 2) & 0x07; p++; delays.push(delay || 10); }
        else { while (p < d.length) { var slen = d[p]; p++; if (slen === 0) break; p += slen; } }
      }
    }
    return { width: width, height: height, frames: frames, delays: delays };
  }

  function lzwDecode(data, minCodeSize, palette, transparentIdx, fw, fh, interlaced) {
    var clearCode = 1 << minCodeSize, eoiCode = clearCode + 1;
    var codeSize = minCodeSize + 1, maxCode = (1 << codeSize) - 1, nextCode = eoiCode + 1;
    var bits = [];
    for (var i = 0; i < data.length; i++) for (var j = 0; j < 8; j++) bits.push((data[i] >> j) & 1);
    var bp = 0;
    function readCode() { var c = 0; for (var i = 0; i < codeSize; i++) { if (bp >= bits.length) return -1; c |= bits[bp++] << i; } return c; }
    var table = new Map();
    for (var ti = 0; ti < clearCode; ti++) table.set(ti, [ti]);
    var prevBytes = null, output = [];
    while (true) {
      var code = readCode();
      if (code < 0 || code === eoiCode) break;
      if (code === clearCode) { table.clear(); for (var ci = 0; ci < clearCode; ci++) table.set(ci, [ci]); nextCode = eoiCode + 1; codeSize = minCodeSize + 1; maxCode = (1 << codeSize) - 1; prevBytes = null; continue; }
      var entry;
      if (table.has(code)) { entry = table.get(code); }
      else if (code === nextCode && prevBytes) { entry = prevBytes.concat([prevBytes[0]]); }
      else { break; }
      for (var ei = 0; ei < entry.length; ei++) output.push(entry[ei]);
      if (prevBytes && nextCode < 4096) { table.set(nextCode, prevBytes.concat([entry[0]])); nextCode++; if (nextCode > maxCode && codeSize < 12) { codeSize++; maxCode = (1 << codeSize) - 1; } }
      prevBytes = entry;
    }
    var rgba = new Uint8Array(fw * fh * 4);
    var pixels = output.slice(0, fw * fh);
    var rawIdx = new Uint16Array(fw * fh);
    if (interlaced) {
      var passes = [[0,8],[4,8],[2,4],[1,2]], idx = 0;
      for (var pi = 0; pi < passes.length; pi++) for (var y = passes[pi][0]; y < fh; y += passes[pi][1]) for (var x = 0; x < fw; x++) rawIdx[y * fw + x] = idx++;
    } else { for (var ri = 0; ri < fw * fh; ri++) rawIdx[ri] = ri; }
    for (var oi = 0; oi < Math.min(pixels.length, fw * fh); oi++) {
      var colorIdx = pixels[oi], ri2 = rawIdx[oi] * 4;
      if (colorIdx === transparentIdx) { rgba[ri2]=rgba[ri2+1]=rgba[ri2+2]=rgba[ri2+3]=0; }
      else if (palette && colorIdx * 3 + 2 < palette.length) { rgba[ri2]=palette[colorIdx*3]; rgba[ri2+1]=palette[colorIdx*3+1]; rgba[ri2+2]=palette[colorIdx*3+2]; rgba[ri2+3]=255; }
      else { rgba[ri2]=rgba[ri2+1]=rgba[ri2+2]=0; rgba[ri2+3]=255; }
    }
    return rgba;
  }

  // ═══════════════════════════════════════════════════════════════
  //  Page injection
  // ═══════════════════════════════════════════════════════════════

  var pendingGif   = null;  // GIF data pending submission
  var pendingImage = null;  // { type: 'static'|'frame', data } for resize redraw

  function waitFor(sel, cb, max) {
    max = max || 50;
    var el = document.querySelector(sel);
    if (el) return cb(el);
    if (max <= 0) return;
    setTimeout(function () { waitFor(sel, cb, max - 1); }, 200);
  }

  function inject() {
    var canvas      = document.getElementById('signatureCanvas');
    var placeholder = document.getElementById('canvasPlaceholder');
    var formActions = document.querySelector('.form-actions');
    var form        = document.getElementById('signatureForm');
    var statusEl    = document.getElementById('formStatus');
    var submitBtn   = document.getElementById('submitButton');
    var clearBtn    = document.getElementById('clearButton');
    var nicknameInput = document.getElementById('nicknameInput');

    if (!canvas || !placeholder || !formActions || !form) return;

    // ── 0. Expand grid to 2 columns ──────────────────────────────
    var gridFix = document.createElement('style');
    gridFix.textContent = '@media(min-width:521px){.form-actions{grid-template-columns:repeat(2,1fr)}}';
    document.head.appendChild(gridFix);

    // ── 1. Single upload button ──────────────────────────────────
    var file = document.createElement('input');
    file.type = 'file'; file.accept = 'image/*'; file.style.display = 'none';
    document.body.appendChild(file);

    var uploadBtn = document.createElement('button');
    uploadBtn.className = 'wall-button secondary';
    uploadBtn.type = 'button';
    uploadBtn.textContent = '上传图片';
    uploadBtn.title = '选择图片贴到画布，GIF 自动转为动图';
    uploadBtn.addEventListener('click', function () { file.click(); });

    formActions.insertBefore(uploadBtn, submitBtn);

    // ── 2. Clear button also clears pending state ─────────────────
    clearBtn.addEventListener('click', function () {
      pendingGif = null;
      pendingImage = null;
    });

    // ── 3. File handler ──────────────────────────────────────────
    file.addEventListener('change', function () {
      var f = file.files[0];
      if (!f) return;
      file.value = '';

      if (f.type === 'image/gif' || f.name.toLowerCase().endsWith('.gif')) {
        pendingImage = null;
        loadGifToPending(f, canvas, placeholder, statusEl, submitBtn, clearBtn);
      } else {
        pendingGif = null;
        loadStaticToPending(f, canvas, placeholder, submitBtn, clearBtn);
      }
    });

    // ── 4. ResizeObserver: re-draw after canvas resize ───────────
    var redrawScheduled = false;
    var resizeObserver = new ResizeObserver(function () {
      if (redrawScheduled) return;
      redrawScheduled = true;
      requestAnimationFrame(function () {
        redrawScheduled = false;
        if (pendingImage) {
          redrawPending(canvas, placeholder, submitBtn, clearBtn);
        }
      });
    });
    resizeObserver.observe(canvas);

    // ── 5. Hijack form submit for GIF / static image ─────────────
    var studio = form.parentElement;
    studio.addEventListener('submit', function (e) {
      if (pendingGif) {
        e.preventDefault();
        e.stopPropagation();
        submitGif(statusEl, submitBtn, clearBtn, nicknameInput);
        return;
      }
      if (pendingImage && pendingImage.type === 'static') {
        e.preventDefault();
        e.stopPropagation();
        submitStatic(statusEl, submitBtn, clearBtn, nicknameInput, canvas);
        return;
      }
    }, true);
  }

  // ── Static image → store & draw ────────────────────────────────
  function loadStaticToPending(f, canvas, placeholder, submitBtn, clearBtn) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        pendingImage = { type: 'static', img: img, fileUrl: reader.result };
        drawStaticImage(img, canvas, placeholder);
        submitBtn.disabled = false;
        clearBtn.disabled = false;
        URL.revokeObjectURL(img.src);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
  }

  function drawStaticImage(img, canvas, placeholder) {
    var ctx = canvas.getContext('2d');
    var rect = canvas.getBoundingClientRect();
    var dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
    var dw = rect.width, dh = rect.height;
    var scale = Math.min(dw / img.width, dh / img.height);
    var w = img.width * scale, h = img.height * scale;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, dw, dh);
    ctx.drawImage(img, (dw - w) / 2, (dh - h) / 2, w, h);
    placeholder.hidden = true;
  }

  // ── GIF → parse & queue ────────────────────────────────────────
  function loadGifToPending(f, canvas, placeholder, statusEl, submitBtn, clearBtn) {
    setStatus(statusEl, '正在解析动图...', 'info');
    submitBtn.disabled = true;
    clearBtn.disabled = true;

    var reader = new FileReader();
    reader.onload = function () {
      try {
        var gif = parseGIF(reader.result);
        if (gif.frames.length < 2) {
          setStatus(statusEl, '不是动图（仅 1 帧），已作为静态图加载', 'info');
          drawGifFrame(gif, 0, canvas, placeholder);
          pendingImage = { type: 'gifFrame', gif: gif, frameIdx: 0 };
          pendingGif = null;
          fireDirty(canvas);
          submitBtn.disabled = false; clearBtn.disabled = false;
          return;
        }
        if (gif.frames.length > 200) {
          setStatus(statusEl, '帧数过多 (' + gif.frames.length + ')，请精简到 200 帧以内', 'error');
          submitBtn.disabled = false; clearBtn.disabled = false;
          return;
        }

        pendingGif = gif;
        pendingImage = { type: 'gifFrame', gif: gif, frameIdx: 0 };
        drawGifFrame(gif, 0, canvas, placeholder);
        fireDirty(canvas);

        setStatus(statusEl, '已加载动图 (' + gif.frames.length + ' 帧, ' + gif.width + 'x' + gif.height + ')，填写昵称后点「贴到墙上」', 'success');
        submitBtn.disabled = false; clearBtn.disabled = false;
      } catch (err) {
        setStatus(statusEl, '动图解析失败: ' + (err.message || '未知错误'), 'error');
        submitBtn.disabled = false; clearBtn.disabled = false;
      }
    };
    reader.onerror = function () {
      setStatus(statusEl, '文件读取失败', 'error');
      submitBtn.disabled = false; clearBtn.disabled = false;
    };
    reader.readAsArrayBuffer(f);
  }

  function drawGifFrame(gif, frameIdx, canvas, placeholder) {
    var frame = gif.frames[frameIdx];
    var ctx = canvas.getContext('2d');
    var rect = canvas.getBoundingClientRect();
    var dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
    var dw = rect.width, dh = rect.height;
    var scaleW = frame.w, scaleH = frame.h;
    if (frame.w > dw || frame.h > dh) { var s = Math.min(dw / frame.w, dh / frame.h); scaleW = Math.round(frame.w * s); scaleH = Math.round(frame.h * s); }

    var tmp = document.createElement('canvas');
    tmp.width = frame.w; tmp.height = frame.h;
    var tmpCtx = tmp.getContext('2d');
    var imgData = tmpCtx.createImageData(frame.w, frame.h);
    imgData.data.set(frame.rgba);
    tmpCtx.putImageData(imgData, 0, 0);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, dw, dh);
    ctx.drawImage(tmp, (dw - scaleW) / 2, (dh - scaleH) / 2, scaleW, scaleH);
    placeholder.hidden = true;
  }

  // ── Re-draw after canvas resize ─────────────────────────────────
  function redrawPending(canvas, placeholder, submitBtn, clearBtn) {
    if (!pendingImage) return;
    if (pendingImage.type === 'static') {
      drawStaticImage(pendingImage.img, canvas, placeholder);
      submitBtn.disabled = false;
      clearBtn.disabled = false;
    } else if (pendingImage.type === 'gifFrame') {
      drawGifFrame(pendingImage.gif, pendingImage.frameIdx, canvas, placeholder);
      fireDirty(canvas);
    }
  }

  // ── Fire synthetic pointer event to flip page's dirty flag ─────
  function fireDirty(canvas) {
    var rect = canvas.getBoundingClientRect();
    var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    var base = { clientX: cx, clientY: cy, pointerId: 98, pointerType: 'pen', isPrimary: true, pressure: 0.5, bubbles: true };
    canvas.dispatchEvent(new PointerEvent('pointerdown', base));
    canvas.dispatchEvent(new PointerEvent('pointermove', Object.assign({}, base, { clientX: cx + 5, clientY: cy + 5 })));
    canvas.dispatchEvent(new PointerEvent('pointerup',   Object.assign({}, base, { clientX: cx + 5, clientY: cy + 5 })));
  }

  // ── Submit static image ─────────────────────────────────────────
  async function submitStatic(statusEl, submitBtn, clearBtn, nicknameInput, canvas) {
    setStatus(statusEl, '正在上传...', 'info');
    submitBtn.disabled = true;
    clearBtn.disabled = true;

    try {
      // Convert canvas to blob, try WebP then JPEG
      var blob = await canvasToBlob(canvas, 'image/webp', 0.78);
      if (!blob || blob.size > 520 * 1024) blob = await canvasToBlob(canvas, 'image/jpeg', 0.78);
      if (!blob || blob.size > 620 * 1024) blob = await canvasToBlob(canvas, 'image/jpeg', 0.64);
      if (!blob || blob.size > 680 * 1024) throw new Error('图片还是太大了，请清空后画得简单一点');

      var dataUrl = await blobToDataUrl(blob);
      var nickname = nicknameInput ? nicknameInput.value : '';

      var res = await fetch(API + '/signatures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: nickname, imageDataUrl: dataUrl, website: '' }),
      });

      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        if (res.status === 413) throw new Error('文件过大，服务器拒绝');
        throw new Error(data.error || '上传失败 (' + res.status + ')');
      }

      setStatus(statusEl, '已贴上墙。', 'success');

      var grid = document.getElementById('signatureGrid'), count = document.getElementById('wallCount');
      if (grid && data.signature) {
        var emptyEl = grid.querySelector('.empty-wall'); if (emptyEl) emptyEl.remove();
        grid.insertBefore(buildCard(data.signature, true), grid.firstChild);
        if (count) count.textContent = grid.querySelectorAll('.signature-card:not(.skeleton-card)').length + ' 张';
      }

      pendingGif = null; pendingImage = null;
      if (nicknameInput) nicknameInput.value = '';
    } catch (err) {
      setStatus(statusEl, err.message || '上传失败', 'error');
    } finally {
      submitBtn.disabled = false; clearBtn.disabled = false;
    }
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise(function (resolve) {
      canvas.toBlob(resolve, type, quality);
    });
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // ── Convert pending GIF & POST ─────────────────────────────────
  async function submitGif(statusEl, submitBtn, clearBtn, nicknameInput) {
    if (typeof UPNG === 'undefined') {
      setStatus(statusEl, '动图编码库加载失败，请刷新后重试', 'error');
      return;
    }
    var gif = pendingGif;
    if (!gif) return;

    setStatus(statusEl, '正在转换 ' + gif.frames.length + ' 帧...', 'info');
    submitBtn.disabled = true;
    clearBtn.disabled = true;

    try {
      var w = gif.width, h = gif.height, rw = w, rh = h;
      if (Math.max(w, h) > MAX_PX) { var s = MAX_PX / Math.max(w, h); rw = Math.round(w * s); rh = Math.round(h * s); }

      var canvasBuf = new Uint8Array(rw * rh * 4);
      var apngFrames = [], apngDelays = [];

      for (var i = 0; i < gif.frames.length; i++) {
        var frame = gif.frames[i], rgba = frame.rgba;
        var sl = Math.round(frame.left * rw / w), st = Math.round(frame.top * rh / h);
        var sfw = Math.round(frame.w * rw / w), sfh = Math.round(frame.h * rh / h);
        if (frame.w !== sfw || frame.h !== sfh) rgba = resizeRGBA(rgba, frame.w, frame.h, sfw, sfh);
        if (i === 0 || frame.disposal === 2) canvasBuf.fill(0);
        for (var dy = 0; dy < sfh; dy++) {
          if (st + dy >= rh) break;
          for (var dx = 0; dx < sfw; dx++) {
            if (sl + dx >= rw) break;
            var si = (dy * sfw + dx) * 4, di = ((st + dy) * rw + (sl + dx)) * 4;
            if (rgba[si + 3] > 128) { canvasBuf[di]=rgba[si]; canvasBuf[di+1]=rgba[si+1]; canvasBuf[di+2]=rgba[si+2]; canvasBuf[di+3]=255; }
          }
        }
        apngFrames.push(new Uint8Array(canvasBuf));
        apngDelays.push((gif.delays[i] || 10) * 10);
      }

      setStatus(statusEl, '正在编码...', 'info');
      var apngBuf = UPNG.encode(apngFrames, rw, rh, 256, apngDelays);

      if (apngBuf.byteLength > 900 * 1024) {
        setStatus(statusEl, '文件过大 (' + (apngBuf.byteLength / 1024 / 1024).toFixed(1) + 'MB)，请用更小的动图', 'error');
        submitBtn.disabled = false; clearBtn.disabled = false;
        return;
      }

      setStatus(statusEl, '正在上传...', 'info');
      var binary = '', bytes = new Uint8Array(apngBuf);
      for (var bi = 0; bi < bytes.length; bi++) binary += String.fromCharCode(bytes[bi]);
      var dataUrl = 'data:image/png;base64,' + btoa(binary);
      var nickname = nicknameInput ? nicknameInput.value : '';

      var res = await fetch(API + '/signatures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: nickname, imageDataUrl: dataUrl, website: '' }),
      });

      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        if (res.status === 413) throw new Error('文件过大，服务器拒绝');
        throw new Error(data.error || '上传失败 (' + res.status + ')');
      }

      setStatus(statusEl, '动图已上墙 (' + gif.frames.length + ' 帧, ' + (apngBuf.byteLength / 1024).toFixed(0) + 'KB)', 'success');

      var grid = document.getElementById('signatureGrid'), count = document.getElementById('wallCount');
      if (grid && data.signature) {
        var emptyEl = grid.querySelector('.empty-wall'); if (emptyEl) emptyEl.remove();
        grid.insertBefore(buildCard(data.signature, true), grid.firstChild);
        if (count) count.textContent = grid.querySelectorAll('.signature-card:not(.skeleton-card)').length + ' 张';
      }

      pendingGif = null; pendingImage = null;
      if (nicknameInput) nicknameInput.value = '';
    } catch (err) {
      setStatus(statusEl, err.message || '转换失败', 'error');
    } finally {
      submitBtn.disabled = false; clearBtn.disabled = false;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────
  function setStatus(el, msg, kind) { el.textContent = msg; el.dataset.kind = kind; }

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
    time.textContent = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(sig.createdAt));
    meta.appendChild(strong); meta.appendChild(time);
    card.appendChild(img); card.appendChild(meta);
    return card;
  }

  waitFor('#signatureCanvas', inject);
})();
