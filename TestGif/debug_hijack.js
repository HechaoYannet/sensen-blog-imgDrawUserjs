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
    var submitBtn = document.getElementById("submitButton");
    var statusEl = document.getElementById("formStatus");
    if (!submitBtn || !statusEl) return;

    window._pendingGif = function() { return pendingGif; };
    window._setPendingGif = function(v) { pendingGif = v; };

    submitBtn.addEventListener("click", function(e) {
      statusEl.textContent = "DEBUG: click captured, pendingGif=" + (pendingGif ? "SET("+pendingGif.frames.length+" frames)" : "NULL");
      statusEl.dataset.kind = "info";
      e.preventDefault();
      e.stopPropagation();
    }, true);

    statusEl.textContent = "DEBUG: click hijack installed";
  }

  waitFor("#submitButton", inject);
  return "injected";
})();
