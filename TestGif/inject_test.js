(async () => {
  // Load pako
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js";
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
  // Load UPNG.js
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/upng-js@2.1.0/UPNG.js";
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });

  // ── Everything below is the userscript body (no @require header) ──
  const API = 'https://msensen.top/api/signature-wall';
  const MAX_PX = 160;

  function parseGIF(buffer) {
    const d = new Uint8Array(buffer);
    let p = 6;
    const width = d[p] | (d[p+1] << 8); p += 2;
    const height = d[p] | (d[p+1] << 8); p += 2;
    const flags = d[p]; p += 1;
    p += 2;
    let gct = null;
    if (flags & 0x80) { const sz = 3 * (2 << (flags & 0x07)); gct = d.slice(p, p + sz); p += sz; }
    const frames = [], delays = [];
    let transparentIdx = -1, disposal = 0;
    while (p < d.length) {
      const bt = d[p]; p++;
      if (bt === 0x3B) break;
      if (bt === 0x2C) {
        const left = d[p] | (d[p+1] << 8); p += 2;
        const top = d[p] | (d[p+1] << 8); p += 2;
        const iw = d[p] | (d[p+1] << 8); p += 2;
        const ih = d[p] | (d[p+1] << 8); p += 2;
        const fl = d[p]; p += 1;
        let lct = null;
        if (fl & 0x80) { const sz = 3 * (2 << (fl & 0x07)); lct = d.slice(p, p + sz); p += sz; }
        const interlaced = !!(fl & 0x40);
        const palette = lct || gct;
        const minCodeSize = d[p]; p++;
        const lzwBytes = [];
        while (true) { const len = d[p]; p++; if (len === 0) break; for (let i = 0; i < len; i++) lzwBytes.push(d[p+i]); p += len; }
        const pixels = lzwDecode(lzwBytes, minCodeSize, palette, transparentIdx, iw, ih, interlaced);
        frames.push({ rgba: pixels, w: iw, h: ih, left, top, disposal });
        while (delays.length < frames.length) delays.push(10);
      } else if (bt === 0x21) {
        const et = d[p]; p++;
        if (et === 0xF9) { p++; const pk = d[p]; p++; const delay = d[p] | (d[p+1] << 8); p += 2; transparentIdx = (pk & 0x01) ? d[p] : -1; p++; disposal = (pk >> 2) & 0x07; p++; delays.push(delay || 10); }
        else { while (p < d.length) { const len = d[p]; p++; if (len === 0) break; p += len; } }
      }
    }
    return { width, height, frames, delays };
  }

  function lzwDecode(data, minCodeSize, palette, transparentIdx, fw, fh, interlaced) {
    const clearCode = 1 << minCodeSize, eoiCode = clearCode + 1;
    let codeSize = minCodeSize + 1, maxCode = (1 << codeSize) - 1, nextCode = eoiCode + 1;
    const bits = [];
    for (let i = 0; i < data.length; i++) for (let j = 0; j < 8; j++) bits.push((data[i] >> j) & 1);
    let bp = 0;
    function readCode() { let c = 0; for (let i = 0; i < codeSize; i++) { if (bp >= bits.length) return -1; c |= bits[bp++] << i; } return c; }
    const table = new Map();
    for (let i = 0; i < clearCode; i++) table.set(i, [i]);
    let prevBytes = null;
    const output = [];
    while (true) {
      const code = readCode();
      if (code < 0 || code === eoiCode) break;
      if (code === clearCode) { table.clear(); for (let i = 0; i < clearCode; i++) table.set(i, [i]); nextCode = eoiCode + 1; codeSize = minCodeSize + 1; maxCode = (1 << codeSize) - 1; prevBytes = null; continue; }
      let entry;
      if (table.has(code)) { entry = table.get(code); }
      else if (code === nextCode && prevBytes) { entry = prevBytes.concat([prevBytes[0]]); }
      else { break; }
      for (let i = 0; i < entry.length; i++) output.push(entry[i]);
      if (prevBytes && nextCode < 4096) { table.set(nextCode, prevBytes.concat([entry[0]])); nextCode++; if (nextCode > maxCode && codeSize < 12) { codeSize++; maxCode = (1 << codeSize) - 1; } }
      prevBytes = entry;
    }
    const rgba = new Uint8Array(fw * fh * 4);
    const totalPixels = fw * fh;
    const pixels = output.slice(0, totalPixels);
    const rawIdx = new Uint16Array(fw * fh);
    if (interlaced) {
      const passes = [[0,8],[4,8],[2,4],[1,2]]; let idx = 0;
      for (const [start, step] of passes) for (let y = start; y < fh; y += step) for (let x = 0; x < fw; x++) rawIdx[y * fw + x] = idx++;
    } else { for (let i = 0; i < fw * fh; i++) rawIdx[i] = i; }
    for (let i = 0; i < Math.min(pixels.length, totalPixels); i++) {
      const colorIdx = pixels[i], pi = rawIdx[i] * 4;
      if (colorIdx === transparentIdx) { rgba[pi]=rgba[pi+1]=rgba[pi+2]=rgba[pi+3]=0; }
      else if (palette && colorIdx * 3 + 2 < palette.length) { rgba[pi]=palette[colorIdx*3]; rgba[pi+1]=palette[colorIdx*3+1]; rgba[pi+2]=palette[colorIdx*3+2]; rgba[pi+3]=255; }
      else { rgba[pi]=rgba[pi+1]=rgba[pi+2]=0; rgba[pi+3]=255; }
    }
    return rgba;
  }

  // ── Page inject ──
  function waitFor(sel, cb, max) {
    max = max || 50;
    const el = document.querySelector(sel);
    if (el) return cb(el);
    if (max <= 0) return;
    setTimeout(function () { waitFor(sel, cb, max - 1); }, 200);
  }

  function setStatus(el, msg, kind) { el.textContent = msg; el.dataset.kind = kind; }

  function inject() {
    const canvas = document.getElementById('signatureCanvas');
    const placeholder = document.getElementById('canvasPlaceholder');
    const formActions = document.querySelector('.form-actions');
    const statusEl = document.getElementById('formStatus');
    const submitBtn = document.getElementById('submitButton');
    const clearBtn = document.getElementById('clearButton');
    if (!canvas || !placeholder || !formActions) return;

    const gridFix = document.createElement('style');
    gridFix.textContent = '@media(min-width:521px){.form-actions[data-astro-cid-3pxndrdx]{grid-template-columns:repeat(4,1fr)}}';
    document.head.appendChild(gridFix);

    const file = document.createElement('input');
    file.type = 'file'; file.accept = 'image/*'; file.style.display = 'none';
    document.body.appendChild(file);

    const imgBtn = document.createElement('button');
    imgBtn.className = 'wall-button secondary'; imgBtn.type = 'button';
    imgBtn.setAttribute('data-astro-cid-3pxndrdx', '');
    imgBtn.textContent = '上传图片'; imgBtn.title = '静态图片贴到画布';
    imgBtn.addEventListener('click', () => { file.dataset.mode = 'static'; file.accept = 'image/png,image/jpeg,image/webp'; file.click(); });

    const gifBtn = document.createElement('button');
    gifBtn.className = 'wall-button secondary'; gifBtn.type = 'button';
    gifBtn.setAttribute('data-astro-cid-3pxndrdx', '');
    gifBtn.textContent = '上传动图'; gifBtn.title = 'GIF 转 APNG';
    gifBtn.addEventListener('click', () => { file.dataset.mode = 'gif'; file.accept = 'image/gif'; file.click(); });

    formActions.insertBefore(gifBtn, formActions.firstChild);
    formActions.insertBefore(imgBtn, formActions.firstChild);

    file.addEventListener('change', () => {
      const f = file.files[0];
      if (!f) return;
      if (file.dataset.mode === 'gif') handleGifUpload(f, statusEl, submitBtn, clearBtn);
      else handleStatic(f, canvas, placeholder);
      file.value = '';
    });
  }

  function handleStatic(f, canvas, placeholder) {
    const img = new Image();
    img.onload = () => {
      const ctx = canvas.getContext('2d'), rect = canvas.getBoundingClientRect();
      const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
      const dw = rect.width, dh = rect.height;
      const scale = Math.min(dw / img.width, dh / img.height);
      const w = img.width * scale, h = img.height * scale;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, dw, dh);
      ctx.drawImage(img, (dw-w)/2, (dh-h)/2, w, h);
      placeholder.hidden = true;
      const cx = rect.left + dw/2, cy = rect.top + dh/2;
      canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, pointerId: 99, bubbles: true }));
      canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: cx, clientY: cy, pointerId: 99, bubbles: true }));
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(f);
  }

  async function handleGifUpload(f, statusEl, submitBtn, clearBtn) {
    if (typeof UPNG === 'undefined') { setStatus(statusEl, '编码库未加载', 'error'); return; }
    setStatus(statusEl, '正在解析动图...', 'info');
    submitBtn.disabled = clearBtn.disabled = true;
    try {
      const buf = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsArrayBuffer(f); });
      const gif = parseGIF(buf);
      const numFrames = gif.frames.length;
      if (numFrames < 2) { setStatus(statusEl, '不是动图', 'error'); submitBtn.disabled = clearBtn.disabled = false; return; }
      if (numFrames > 200) { setStatus(statusEl, '帧数过多', 'error'); submitBtn.disabled = clearBtn.disabled = false; return; }
      const w = gif.width, h = gif.height;
      let rw = w, rh = h;
      if (Math.max(w, h) > MAX_PX) { const s = MAX_PX / Math.max(w, h); rw = Math.round(w*s); rh = Math.round(h*s); }
      setStatus(statusEl, `转换 ${numFrames} 帧...`, 'info');

      const canvasBuf = new Uint8Array(rw * rh * 4);
      const apngFrames = [], apngDelays = [];
      for (let i = 0; i < numFrames; i++) {
        const frame = gif.frames[i];
        let rgba = frame.rgba;
        const sl = Math.round(frame.left * rw / w), st = Math.round(frame.top * rh / h);
        const sfw = Math.round(frame.w * rw / w), sfh = Math.round(frame.h * rh / h);
        if (frame.w !== sfw || frame.h !== sfh) {
          const dst = new Uint8Array(sfw * sfh * 4);
          const xr = frame.w / sfw, yr = frame.h / sfh;
          for (let dy = 0; dy < sfh; dy++) for (let dx = 0; dx < sfw; dx++) {
            const sx = Math.floor(dx*xr), sy = Math.floor(dy*yr);
            const si = (sy*frame.w+sx)*4, di = (dy*sfw+dx)*4;
            dst[di]=rgba[si]; dst[di+1]=rgba[si+1]; dst[di+2]=rgba[si+2]; dst[di+3]=rgba[si+3];
          }
          rgba = dst;
        }
        if (i === 0 || frame.disposal === 2) canvasBuf.fill(0);
        for (let dy = 0; dy < sfh; dy++) {
          if (st + dy >= rh) break;
          for (let dx = 0; dx < sfw; dx++) {
            if (sl + dx >= rw) break;
            const si = (dy*sfw+dx)*4, di = ((st+dy)*rw+(sl+dx))*4;
            if (rgba[si+3] > 128) { canvasBuf[di]=rgba[si]; canvasBuf[di+1]=rgba[si+1]; canvasBuf[di+2]=rgba[si+2]; canvasBuf[di+3]=255; }
          }
        }
        apngFrames.push(new Uint8Array(canvasBuf));
        apngDelays.push((gif.delays[i]||10)*10);
      }

      setStatus(statusEl, '编码中...', 'info');
      const apngBuf = UPNG.encode(apngFrames, rw, rh, 256, apngDelays);
      if (apngBuf.byteLength > 2*1024*1024) { setStatus(statusEl, '文件过大', 'error'); submitBtn.disabled = clearBtn.disabled = false; return; }

      setStatus(statusEl, '上传中...', 'info');
      let binary = ''; const bytes = new Uint8Array(apngBuf);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const dataUrl = 'data:image/png;base64,' + btoa(binary);
      const nickname = (document.getElementById('nicknameInput')||{}).value || '';

      const res = await fetch(API+'/signatures', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({nickname,imageDataUrl:dataUrl,website:''}) });
      const data = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(data.error||'fail');

      setStatus(statusEl, `动图已上墙 (${numFrames}帧, ${(apngBuf.byteLength/1024).toFixed(0)}KB)`, 'success');

      const grid = document.getElementById('signatureGrid'), count = document.getElementById('wallCount');
      if (grid && data.signature) {
        const emptyEl = grid.querySelector('.empty-wall'); if (emptyEl) emptyEl.remove();
        const card = document.createElement('article'); card.className = 'signature-card just-posted';
        const img = document.createElement('img');
        img.src = (data.signature.imageUrl||'').indexOf('http')===0 ? data.signature.imageUrl : API+data.signature.imageUrl.replace('/api/signature-wall','');
        img.alt = (data.signature.nickname||'匿名')+' 的签名'; img.loading = 'lazy';
        const meta = document.createElement('div'); meta.className = 'signature-meta';
        const strong = document.createElement('strong'); strong.textContent = data.signature.nickname||'匿名访客';
        const time = document.createElement('time'); time.dateTime = data.signature.createdAt;
        time.textContent = new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(data.signature.createdAt));
        meta.appendChild(strong); meta.appendChild(time); card.appendChild(img); card.appendChild(meta);
        grid.insertBefore(card, grid.firstChild);
        if (count) count.textContent = grid.querySelectorAll('.signature-card:not(.skeleton-card)').length + ' 张';
      }
    } catch(err) { setStatus(statusEl, err.message||'转换失败', 'error'); }
    finally { submitBtn.disabled = false; clearBtn.disabled = false; }
  }

  waitFor('#signatureCanvas', inject);
  return 'injected';
})();
