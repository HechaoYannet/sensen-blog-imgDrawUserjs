(async () => {
  await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/upng-js@2.1.0/UPNG.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });

  function waitFor(sel, cb, m) {
    m = m || 50; var e = document.querySelector(sel);
    if (e) return cb(e); if (m <= 0) return;
    setTimeout(function(){waitFor(sel,cb,m-1);}, 200);
  }

  function inject() {
    var form = document.getElementById('signatureForm');
    var statusEl = document.getElementById('formStatus');
    var submitBtn = document.getElementById('submitButton');
    if (!form || !statusEl) return;

    var studio = form.parentElement;
    var counter = 0;

    // Test 1: Can we intercept submit on parent?
    studio.addEventListener('submit', function(e) {
      counter++;
      statusEl.textContent = 'DEBUG: parent submit captured! count=' + counter + ' target=' + (e.target === form ? 'FORM' : 'OTHER');
      statusEl.dataset.kind = 'info';
      e.preventDefault();
      e.stopPropagation();
    }, true);

    // Test 2: What about click on submit button?
    submitBtn.addEventListener('click', function(e) {
      statusEl.textContent = 'DEBUG: submit button clicked (capturing) count=' + counter;
      statusEl.dataset.kind = 'info';
      // DON'T prevent default - let it trigger submit
    }, true);

    statusEl.textContent = 'DEBUG: parent+click hijack installed. counter=' + counter;
  }

  waitFor('#signatureForm', inject);
  return 'injected';
})();
