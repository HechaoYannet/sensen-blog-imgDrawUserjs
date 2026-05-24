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
    var nicknameInput = document.getElementById('nicknameInput');
    if (!form || !statusEl || !submitBtn) return;

    var studio = form.parentElement;
    statusEl.textContent = 'DEBUG: form found, parent=' + (studio ? studio.className : 'NULL');

    studio.addEventListener('submit', function(e) {
      statusEl.textContent = 'DEBUG: parent submit FIRED! pendingGif=' + (pendingGif ? 'SET' : 'NULL') + ' target=' + (e.target.id || e.target.className);
      statusEl.dataset.kind = 'info';
      e.preventDefault();
      e.stopPropagation();
    }, true);

    // Also try capturing on form itself
    form.addEventListener('submit', function(e) {
      statusEl.textContent = 'DEBUG: FORM submit FIRED (capturing)! pendingGif=' + (pendingGif ? 'SET' : 'NULL');
      statusEl.dataset.kind = 'info';
      e.preventDefault();
      e.stopImmediatePropagation();
    }, true);

    // Set up a test pendingGif
    window._pg = function() { return pendingGif; };
    window._spg = function(v) { pendingGif = v; statusEl.textContent = 'DEBUG: pendingGif set to ' + (v ? 'obj' : 'null'); };
  }

  waitFor('#signatureForm', inject);
  return 'injected';
})();
