/* SAADI Team: draw-your-signature pad (finger, pen or mouse) + PDF helpers. Used by team/ and documents.html.
 * const pad = SignPad(canvas); pad.empty(); pad.clear(); pad.png() -> "data:image/png;base64,..." (trimmed, transparent)
 */
(function () {
"use strict";
window.SignPad = function (cv) {
  const ctx = cv.getContext("2d");
  let strokes = 0, drawing = false, last = null;
  function size() {
    const r = cv.getBoundingClientRect(), dpr = Math.max(1, window.devicePixelRatio || 1);
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.lineWidth = 2.4; ctx.lineCap = ctx.lineJoin = "round"; ctx.strokeStyle = "#1d1d1f";
    strokes = 0;
  }
  const pt = e => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  cv.style.touchAction = "none";
  cv.addEventListener("pointerdown", e => { drawing = true; last = pt(e); cv.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.arc(last.x, last.y, 1.1, 0, 7); ctx.fillStyle = "#1d1d1f"; ctx.fill(); strokes++; });
  cv.addEventListener("pointermove", e => { if (!drawing) return; const p = pt(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; strokes++; });
  const up = () => { drawing = false; };
  cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
  size();
  return {
    clear: size,
    empty: () => strokes < 8,
    png() { // crop to the ink so the certificate shows the signature nicely
      const w = cv.width, h = cv.height, d = ctx.getImageData(0, 0, w, h).data;
      let x0 = w, y0 = h, x1 = 0, y1 = 0;
      for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (d[(y * w + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 <= x0) return cv.toDataURL("image/png");
      const pad = 8, c = document.createElement("canvas"); c.width = x1 - x0 + pad * 2; c.height = y1 - y0 + pad * 2;
      c.getContext("2d").drawImage(cv, x0 - pad, y0 - pad, c.width, c.height, 0, 0, c.width, c.height);
      return c.toDataURL("image/png");
    }
  };
};
window.PdfFile = {
  // File -> base64 (no data: prefix)
  toB64: f => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.onerror = no; r.readAsDataURL(f); }),
  blob: b64 => { const s = atob(b64), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return new Blob([a], { type: "application/pdf" }); },
  download(b64, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(PdfFile.blob(b64)); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000); },
  open(b64) { const u = URL.createObjectURL(PdfFile.blob(b64)); window.open(u, "_blank"); setTimeout(() => URL.revokeObjectURL(u), 60000); },
  safeName: t => String(t || "document").replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || "document"
};
})();
