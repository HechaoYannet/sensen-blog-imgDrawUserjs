// Minimal test: does parent-element capturing work after injecting upload button?
(async () => {
  await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/upng-js@2.1.0/UPNG.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });

  var pendingGif = null;

  function waitFor(sel, cb, m) {
    m = m || 50; var e = document.querySelector(sel);
    if (e) return cb(e); if (m <= 0) return;
    setTimeout(function(){waitFor(sel,cb,m-1);}, 200);
  }

  function inject() {
    var form = document.getElementById('signatureForm');
    var statusEl = document.getElementById('formStatus');
    var submitBtn = document.getElementById('submitButton');
    var formActions = document.querySelector('.form-actions');
    if (!form || !statusEl || !submitBtn || !formActions) { statusEl.textContent = 'DEBUG: MISSING ELEMENTS'; return; }

    // Add upload button (same as userscript)
    var file = document.createElement('input');
    file.type = 'file'; file.accept = 'image/*'; file.style.display = 'none';
    document.body.appendChild(file);

    var uploadBtn = document.createElement('button');
    uploadBtn.className = 'wall-button secondary';
    uploadBtn.type = 'button';
    uploadBtn.setAttribute('data-astro-cid-3pxndrdx', '');
    uploadBtn.textContent = '上传图片';
    formActions.insertBefore(uploadBtn, submitBtn);

    // Add a dummy test file handler
    uploadBtn.addEventListener('click', function() {
      file.click();
    });

    file.addEventListener('change', async function() {
      var f = file.files[0];
      if (!f) return;
      file.value = '';
      if (f.type === 'image/gif') {
        statusEl.textContent = 'DEBUG: GIF selected, setting pendingGif...';
        statusEl.dataset.kind = 'info';
        // Simulate a pending GIF
        pendingGif = { frames: [{},{},{}], framesCount: 3 };
        window.__pg = pendingGif;
        statusEl.textContent = 'DEBUG: pendingGif SET (' + pendingGif.framesCount + ' frames)';
      } else {
        pendingGif = null;
        statusEl.textContent = 'DEBUG: static image selected, pendingGif=NULL';
      }
    });

    // Parent capturing listener
    var studio = form.parentElement;
    studio.addEventListener('submit', function(e) {
      statusEl.textContent = 'SUBMIT INTERCEPTED! pendingGif=' + (pendingGif ? 'SET('+pendingGif.framesCount+')' : 'NULL');
      statusEl.dataset.kind = 'success';
      if (pendingGif) {
        e.preventDefault();
        e.stopPropagation();
        pendingGif = null;
        statusEl.textContent = 'UPLOAD SIMULATED! (intercepted submit)';
      }
    }, true);

    statusEl.textContent = 'DEBUG: 3 buttons, parent capture ready. pendingGif=NULL';
  }

  waitFor('#signatureForm', inject);
  return 'injected';
})();
