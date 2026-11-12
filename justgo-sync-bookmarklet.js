// "Send to SAADI Hub" bookmarklet: readable source.
// The hub page (class-capacity.html) builds the bookmark link from this file's code, so edit here
// and run `node build-bookmarklet.js` to refresh the link in class-capacity.html.
//
// What it does, on JustGo > Class Management:
//   1. opens the SAADI Hub in a new tab straight away (so the browser doesn't block the pop-up),
//   2. scrolls the JustGo class list until every class has loaded,
//   3. takes the same text a select-all copy would give (class, time, group, Booked / Available / Trial / Wait List, term),
//   4. sends it to the hub in the address after "#jg=", which never leaves the browser.
// It reads only; it never clicks or changes anything in JustGo. No member names or personal details are read.
(async () => {
  const HUB = "https://hub.saadigymnastics.co.uk/class-capacity.html";
  const w = window.open("about:blank", "saadiHubSync");
  let doc = document;
  const fr = document.querySelector('iframe[src*="ClassManagement"]');
  try { if (fr && fr.contentDocument) doc = fr.contentDocument; } catch (e) {}
  const rows = () => doc.querySelectorAll("tbody tr");
  if (!/ClassManagement/i.test(location.href) || !rows().length) {
    if (w) w.close();
    alert("Open JustGo > Class Management (the class list) first, then click 'Send to SAADI Hub' again.");
    return;
  }
  const m = (doc.body.innerText.match(/\d+\s*-\s*\d+\s+of\s+(\d+)/) || [])[1];
  const total = +m || 0;
  const box = [...doc.querySelectorAll("*")]
    .filter(e => e.scrollHeight > e.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(e).overflowY))
    .sort((a, b) => b.querySelectorAll("tr").length - a.querySelectorAll("tr").length)[0];
  let last = -1, same = 0;
  while (same < 4 && !(total && rows().length >= total)) {
    if (box) box.scrollTop = box.scrollHeight;
    await new Promise(r => setTimeout(r, 700));
    const n = rows().length;
    same = n === last ? same + 1 : 0;
    last = n;
  }
  const text = [...rows()].map(r => r.innerText).join("\n").split("\n").map(s => s.trim()).filter(Boolean).join("\n");
  const url = HUB + "#jg=" + encodeURIComponent(JSON.stringify({ v: 1, at: new Date().toISOString(), n: rows().length, total, text }));
  if (w && !w.closed) w.location.href = url;
  else alert("Your browser blocked the SAADI Hub tab. Allow pop-ups for this site, then click 'Send to SAADI Hub' again.");
})();
