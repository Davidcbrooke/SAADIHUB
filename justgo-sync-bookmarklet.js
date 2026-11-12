// "Send to SAADI Hub" bookmarklet: readable source.
// The hub page (class-capacity.html) builds the bookmark link from this file's code, so edit here
// and run `node build-bookmarklet.js` to refresh the link in class-capacity.html.
// Keep every comment on a line of its own: the build joins the code into one line.
//
// What it does, from anywhere in JustGo > Class Management:
//   1. covers the JustGo page with a small progress panel, so the tab stays in front while it works
//      (Chrome stops loading lists in background tabs, which is why it no longer opens the hub straight away),
//   2. works out which terms to read: the term view pinned as the default (e.g. Autumn 2026),
//      the Rolling Term with the WAG / MAG squads, and whatever view is open now,
//   3. loads all of those terms together in a copy of the class list behind the panel and scrolls it until every class has loaded,
//   4. takes the same text a select-all copy would give (class, time, group, Booked / Available / Trial / Wait List, term),
//   5. only when every class is in, offers an "Open SAADI Hub" button, which sends the list to the hub
//      in the address after "#jg=" (that part never leaves the browser).
// It reads only; it never clicks or changes anything in JustGo. No member names or personal details are read.
(async () => {
  const HUB = "https://hub.saadigymnastics.co.uk/class-capacity.html";
  // JustGo's id for "Rolling Term (SAADI)", where the WAG / MAG squads live.
  const ROLLING_TERM = "182";
  const path = (location.pathname.match(/^.*\/ClassManagement\/class\/[^/]+\//i) || [])[0];
  if (!path) { alert("Open JustGo > Class Management (the class list) first, then click 'Send to SAADI Hub' again."); return; }
  if (document.getElementById("saadiSync")) return;
  const frames = [];
  const ov = document.createElement("div");
  ov.id = "saadiSync";
  ov.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(255,255,255,.97);display:flex;align-items:center;justify-content:center;font:16px/1.45 Roboto,Arial,sans-serif;color:#222";
  ov.innerHTML = '<div style="max-width:440px;text-align:center;padding:28px;border-radius:16px;box-shadow:0 6px 30px rgba(0,0,0,.15);background:#fff"><div style="font-weight:700;font-size:20px;color:#d4066a;margin-bottom:8px">Send to SAADI Hub</div><div id="saadiSyncMsg">Finding this term\'s classes&hellip;</div><div id="saadiSyncSub" style="font-size:13px;color:#666;margin-top:6px">Keep this tab open until it finishes.</div><div id="saadiSyncBtns" style="margin-top:18px"></div></div>';
  document.body.appendChild(ov);
  const say = (t, sub) => { ov.querySelector("#saadiSyncMsg").textContent = t; ov.querySelector("#saadiSyncSub").textContent = sub || ""; };
  const close = () => { frames.forEach(f => f.remove()); ov.remove(); };
  const btn = (label, fn, primary) => { const b = document.createElement("button"); b.textContent = label; b.style.cssText = "margin:4px;padding:10px 20px;border-radius:999px;border:0;font:inherit;font-weight:700;cursor:pointer;" + (primary ? "background:#d4066a;color:#fff" : "background:#eee;color:#222"); b.onclick = fn; ov.querySelector("#saadiSyncBtns").appendChild(b); };
  btn("Cancel", close);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const termsOf = s => (decodeURIComponent((s.match(/[?&]term=([^&]*)/) || [])[1] || "")).split("|").filter(Boolean);
  // The copy sits on screen, just behind the panel, so Chrome keeps loading it.
  const frame = src => { const f = document.createElement("iframe"); f.style.cssText = "position:fixed;left:0;top:0;width:100vw;height:100vh;border:0;z-index:2147483646"; f.src = src; document.body.appendChild(f); frames.push(f); return f; };
  const terms = new Set([ROLLING_TERM, ...termsOf(location.search)]);
  // The default (pinned) view: open the class list with no term and see which terms it picks.
  let f = frame(path);
  for (let i = 0; i < 30; i++) { await wait(500); try { const t = termsOf(f.contentWindow.location.search); if (t.length) { t.forEach(x => terms.add(x)); break; } } catch (e) {} }
  f.remove();
  if (!document.getElementById("saadiSync")) return;
  say("Loading every class…", "Keep this tab open until it finishes.");
  f = frame(path + "?term=" + encodeURIComponent([...terms].join("|")));
  let doc = null;
  for (let i = 0; i < 40 && !doc; i++) { await wait(500); try { const d = f.contentDocument.querySelector("iframe").contentDocument; if (d.querySelectorAll("tbody tr").length) doc = d; } catch (e) {} }
  if (!doc) { say("JustGo didn't load the class list in time.", "Close this, wait a moment and click Send to SAADI Hub again."); return; }
  await wait(800);
  const rows = () => doc.querySelectorAll("tbody tr");
  const total = +((doc.body.innerText.match(/\d+\s*-\s*\d+\s+of\s+(\d+)/) || [])[1]) || 0;
  const box = [...doc.querySelectorAll("*")]
    .filter(e => e.scrollHeight > e.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(e).overflowY))
    .sort((a, b) => b.querySelectorAll("tr").length - a.querySelectorAll("tr").length)[0];
  let last = -1, same = 0;
  while (same < 6 && !(total && rows().length >= total) && document.getElementById("saadiSync")) {
    if (box) box.scrollTop = box.scrollHeight;
    say("Loading every class… " + rows().length + (total ? " of " + total : ""), "Keep this tab open until it finishes.");
    await wait(700);
    const n = rows().length;
    same = n === last ? same + 1 : 0;
    last = n;
  }
  if (!document.getElementById("saadiSync")) return;
  const n = rows().length;
  if (total && n < total) { say("Only " + n + " of " + total + " classes loaded.", "Close this, keep the JustGo tab in front, and click Send to SAADI Hub again."); return; }
  const text = [...rows()].map(r => r.innerText).join("\n").split("\n").map(s => s.trim()).filter(Boolean).join("\n");
  frames.forEach(x => x.remove());
  const url = HUB + "#jg=" + encodeURIComponent(JSON.stringify({ v: 3, at: new Date().toISOString(), n, total, terms: [...terms], text }));
  say("All " + n + " classes are ready.", "Open the hub, check the summary and press Save week.");
  ov.querySelector("#saadiSyncBtns").innerHTML = "";
  btn("Open SAADI Hub", () => { const w = window.open(url, "saadiHubSync"); if (!w) location.href = url; close(); }, true);
  btn("Cancel", close);
})();
