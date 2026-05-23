// ==UserScript==
// @name         签名墙 - 图片上传
// @namespace    https://msensen.top/
// @version      1.0
// @description  为涂鸦签名墙添加上传图片功能：点击按钮选择图片，自动适配画布尺寸
// @author       You
// @match        https://msensen.top/signature-wall*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  function waitFor(sel, cb, max = 50) {
    const el = document.querySelector(sel);
    if (el) return cb(el);
    if (max <= 0) return;
    setTimeout(() => waitFor(sel, cb, max - 1), 200);
  }

  function inject() {
    const canvas = document.getElementById('signatureCanvas');
    const placeholder = document.getElementById('canvasPlaceholder');
    const formActions = document.querySelector('.form-actions');

    if (!canvas || !placeholder || !formActions) return;

    // ---- create upload button ----
    const btn = document.createElement('button');
    btn.className = 'wall-button primary';
    btn.type = 'button';
    btn.setAttribute('data-astro-cid-3pxndrdx', '');
    btn.textContent = '上传图片';
    btn.title = '选择一张图片贴到画布上';

    // ---- hidden file picker ----
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'image/*';
    file.style.display = 'none';
    document.body.appendChild(file);

    btn.addEventListener('click', () => file.click());

    // ---- expand grid to fit 3 buttons (desktop only; mobile keeps 1-col) ----
    const gridFix = document.createElement('style');
    gridFix.textContent = `@media(min-width:521px){.form-actions[data-astro-cid-3pxndrdx]{grid-template-columns:repeat(3,1fr)}}`;
    document.head.appendChild(gridFix);

    // ---- insert button into the action row ----
    formActions.insertBefore(btn, formActions.firstChild);

    // ---- handle file selection ----
    file.addEventListener('change', () => {
      const f = file.files[0];
      if (!f) return;

      const img = new Image();
      img.onload = () => {
        const ctx = canvas.getContext('2d');
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
        const dw = rect.width;
        const dh = rect.height;

        // scale to fit canvas, keep aspect ratio
        const scale = Math.min(dw / img.width, dh / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        const x = (dw - w) / 2;
        const y = (dh - h) / 2;

        // draw
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, dw, dh);
        ctx.drawImage(img, x, y, w, h);

        // hide placeholder, mark canvas as "dirty"
        placeholder.hidden = true;

        // fire a minimal pointer event so the page's internal dirty flag flips
        const cx = rect.left + dw / 2;
        const cy = rect.top + dh / 2;
        canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, pointerId: 99, bubbles: true }));
        canvas.dispatchEvent(new PointerEvent('pointerup',   { clientX: cx, clientY: cy, pointerId: 99, bubbles: true }));

        file.value = ''; // allow re-selecting the same file
        URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(f);
    });
  }

  // page is Astro SSR + client hydrate; poll until canvas is ready
  waitFor('#signatureCanvas', inject);
})();
