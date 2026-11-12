// "Send to SAADI Hub" bookmarklet: readable source.
// The hub page (class-capacity.html) builds the bookmark link from this file's code, so edit here
// and run `node build-bookmarklet.js` to refresh the link in class-capacity.html.
//
// What it does, from anywhere in JustGo > Class Management:
//   1. opens the SAADI Hub in a new tab straight away (so the browser doesn't block the pop-up),
//   2. works out which terms to read: the term view pinned as the default (e.g. Autumn 2026),
//      the Rolling Term with the WAG / MAG squads, and whatever view is open now,
//   3. loads all of those terms together in a hidden copy of the class list and scrolls it until every class has loaded,
//   4. takes the same text a select-all copy would give (class, time, group, Booked / Available / Trial / Wait List, term),
//   5. sends it to the hub in the address after "#jg=", which never leaves the browser.
// It reads only; it never clicks or changes anything in JustGo. No member names or personal details are read.
(async () => {
  const HUB = "https://hub.saadigymnastics.co.uk/class-capacity.html";
  // JustGo's id for "Rolling Term (SAADI)", where the WAG / MAG squads live.
  const ROLLING_TERM = "182";
  const w = window.open("about:blank", "saadiHubSync");
  const fail = msg => { if (w) w.close(); alert(msg); };
  const path = (location.pathname.match(/^.*\/ClassManagement\/class\/[^/]+\//i) || [])[0];
  if (!path) return fail("Open JustGo > Class Management (the class list) first, then click 'Send to SAADI Hub' again.");
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const termsOf = s => (decodeURIComponent((s.match(/[?&]term=([^&]*)/) || [])[1] || "")).split("|").filter(Boolean);
  const frame = src => { const f = document.createElement("iframe"); f.style.cssText = "position:fixed;left:-3000px;top:0;width:1200px;height:900px"; f.src = src; document.body.appendChild(f); return f; };
  const terms = new Set([ROLLING_TERM, ...termsOf(location.search)]);
  // The default (pinned) view: open the class list with no term and see which terms it picks.
  let f = frame(path);
  for (let i = 0; i < 30; i++) { await wait(500); try { const t = termsOf(f.contentWindow.location.search); if (t.length) { t.forEach(x => terms.add(x)); break; } } catch (e) {} }
  f.remove();
  // All terms together.
  f = frame(path + "?term=" + encodeURIComponent([...terms].join("|")));
  let doc = null;
  for (let i = 0; i < 40 && !doc; i++) { await wait(500); try { const d = f.contentDocument.querySelector("iframe").contentDocument; if (d.querySelectorAll("tbody tr").length) doc = d; } catch (e) {} }
  if (!doc) { f.remove(); return fail("JustGo didn't load the class list in time. Wait a moment and click 'Send to SAADI Hub' again."); }
  await wait(800);
  const rows = () => doc.querySelectorAll("tbody tr");
  const total = +((doc.body.innerText.match(/\d+\s*-\s*\d+\s+of\s+(\d+)/) || [])[1]) || 0;
  const box = [...doc.querySelectorAll("*")]
    .filter(e => e.scrollHeight > e.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(e).overflowY))
    .sort((a, b) => b.querySelectorAll("tr").length - a.querySelectorAll("tr").length)[0];
  let last = -1, same = 0;
  while (same < 4 && !(total && rows().length >= total)) {
    if (box) box.scrollTop = box.scrollHeight;
    await wait(700);
    const n = rows().length;
    same = n === last ? same + 1 : 0;
    last = n;
  }
  const n = rows().length;
  const text = [...rows()].map(r => r.innerText).join("\n").split("\n").map(s => s.trim()).filter(Boolean).join("\n");
  f.remove();
  const url = HUB + "#jg=" + encodeURIComponent(JSON.stringify({ v: 2, at: new Date().toISOString(), n, total, terms: [...terms], text }));
  if (w && !w.closed) w.location.href = url;
  else alert("Your browser blocked the SAADI Hub tab. Allow pop-ups for this site, then click 'Send to SAADI Hub' again.");
})();
