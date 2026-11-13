// "Send to SAADI Hub" bookmarklet: readable source.
// The hub page (class-capacity.html) builds the bookmark link from this file's code, so edit here
// and run `node build-bookmarklet.js` to refresh the link in class-capacity.html.
// Keep every comment on a line of its own, and end every statement with ; or }: the build joins the code into one line.
//
// What it does, from anywhere in JustGo > Class Management:
//   1. covers the JustGo page with a small progress panel, so the tab stays in front while it works
//      (Chrome stops loading lists in background tabs, which is why it no longer opens the hub straight away),
//   2. works out which terms to read: every term running today from JustGo's Term list (Recreational, Pre-school, Novice...),
//      the term view pinned as the default, the Rolling Term with the WAG / MAG squads, and whatever view is open now,
//   3. loads all of those terms together in a copy of the class list behind the panel and scrolls it until every class has loaded,
//   4. takes the same text a select-all copy would give (class, time, group, Booked / Available / Trial / Wait List, term),
//      plus each class's public booking link (what JustGo's "Copy Link" gives), for the Enquiry Desk emails,
//   5. Term Renewals: when next term's classes are set up (e.g. Spring), reads the registers of this term's termly classes
//      and next term's classes (child, parent's first name and email, trial / pay-as-you-go), so the hub can show who has renewed,
//   6. only when every class is in, offers an "Open SAADI Hub" button, which sends it all to the hub
//      in the address after "#jg=" (that part never leaves the browser).
// It reads only; it never clicks Book, Cancel or anything that changes JustGo.
(async () => {
  const HUB = "https://hub.saadigymnastics.co.uk/class-capacity.html";
  const API = "https://justgorestapi-prod.justgo.com/api/v1/class-management/get-attendee-occurrence-calendar-view";
  // JustGo's id for "Rolling Term (SAADI)", where the WAG / MAG squads live.
  const ROLLING_TERM = "182";
  const path = (location.pathname.match(/^.*\/ClassManagement\/class\/[^/]+\//i) || [])[0];
  if (!path) { alert("Open JustGo > Class Management (the class list) first, then click 'Send to SAADI Hub' again."); return; }
  if (document.getElementById("saadiSync")) return;
  const club = path.split("/").filter(Boolean).pop();
  const frames = [];
  const ov = document.createElement("div");
  ov.id = "saadiSync";
  ov.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(255,255,255,.97);display:flex;align-items:center;justify-content:center;font:16px/1.45 Roboto,Arial,sans-serif;color:#222";
  ov.innerHTML = '<div style="max-width:440px;text-align:center;padding:28px;border-radius:16px;box-shadow:0 6px 30px rgba(0,0,0,.15);background:#fff"><div style="font-weight:700;font-size:20px;color:#d4066a;margin-bottom:8px">Send to SAADI Hub</div><div id="saadiSyncMsg">Finding this term\'s classes&hellip;</div><div id="saadiSyncSub" style="font-size:13px;color:#666;margin-top:6px">Keep this tab open until it finishes.</div><div id="saadiSyncBtns" style="margin-top:18px"></div></div>';
  document.body.appendChild(ov);
  const alive = () => !!document.getElementById("saadiSync");
  const say = (t, sub) => { ov.querySelector("#saadiSyncMsg").textContent = t; ov.querySelector("#saadiSyncSub").textContent = sub === undefined ? "Keep this tab open until it finishes." : sub; };
  const close = () => { frames.forEach(f => f.remove()); ov.remove(); };
  const btn = (label, fn, primary) => { const b = document.createElement("button"); b.textContent = label; b.style.cssText = "margin:4px;padding:10px 20px;border-radius:999px;border:0;font:inherit;font-weight:700;cursor:pointer;" + (primary ? "background:#d4066a;color:#fff" : "background:#eee;color:#222"); b.onclick = fn; ov.querySelector("#saadiSyncBtns").appendChild(b); };
  btn("Cancel", close);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const termsOf = s => (decodeURIComponent((s.match(/[?&]term=([^&]*)/) || [])[1] || "")).split("|").filter(Boolean);
  // The copies sit on screen, just behind the panel, so Chrome keeps loading them.
  const frame = src => { const f = document.createElement("iframe"); f.style.cssText = "position:fixed;left:0;top:0;width:100vw;height:100vh;border:0;z-index:2147483646"; f.src = src; document.body.appendChild(f); frames.push(f); return f; };
  const inner = f => { try { const i = f.contentDocument.querySelector("iframe"); return i ? i.contentDocument : null; } catch (e) { return null; } };
  // The data JustGo's own table holds (React keeps it on the table rows).
  const tableData = (d, test) => { const tr = d && d.querySelector("tbody tr"); if (!tr) return null; let fb = tr[Object.keys(tr).find(k => k.startsWith("__reactFiber"))]; for (let j = 0; j < 25 && fb; j++, fb = fb.return) { const pr = fb.memoizedProps; if (pr && Array.isArray(pr.data) && pr.data[0] && test(pr.data[0])) return pr.data; } return null; };
  // Open the class list for some terms and scroll it until every class has loaded.
  const loadList = async (termIds, label) => {
    const fr = frame(path + "?term=" + encodeURIComponent(termIds.join("|")));
    let d = null;
    for (let i = 0; i < 40 && !d; i++) { await wait(500); const x = inner(fr); if (x && x.querySelectorAll("tbody tr").length) d = x; }
    if (!d) return null;
    await wait(800);
    const rows = () => d.querySelectorAll("tbody tr");
    const total = +((d.body.innerText.match(/\d+\s*-\s*\d+\s+of\s+(\d+)/) || [])[1]) || 0;
    const box = [...d.querySelectorAll("*")].filter(e => e.scrollHeight > e.clientHeight + 20 && /auto|scroll/.test(getComputedStyle(e).overflowY)).sort((a, b) => b.querySelectorAll("tr").length - a.querySelectorAll("tr").length)[0];
    let last = -1, same = 0;
    while (same < 6 && !(total && rows().length >= total) && alive()) {
      if (box) box.scrollTop = box.scrollHeight;
      say(label + " " + rows().length + (total ? " of " + total : ""));
      await wait(700);
      const n = rows().length;
      same = n === last ? same + 1 : 0;
      last = n;
    }
    return { d, fr, n: rows().length, total, rows };
  };
  const terms = new Set([ROLLING_TERM, ...termsOf(location.search)]);
  // The default (pinned) view: open the class list with no term and see which terms it picks.
  let f = frame(path);
  for (let i = 0; i < 30; i++) { await wait(500); try { const t = termsOf(f.contentWindow.location.search); if (t.length) { t.forEach(x => terms.add(x)); break; } } catch (e) {} }
  f.remove();
  if (!alive()) return;
  // Every term running today (e.g. Novice has its own term, and Spring terms take over in January), read from JustGo's own Term list.
  say("Finding this term's classes…");
  let termList = null;
  // JustGo's Term page can be slow: wait up to 25 seconds, and try a second time before carrying on without it.
  for (let attempt = 0; attempt < 2 && !termList && alive(); attempt++) {
    f = frame(path + "term");
    for (let i = 0; i < 50 && !termList; i++) { await wait(500); termList = tableData(inner(f), o => "ClassTermId" in o); }
    if (!termList) f.remove();
  }
  const now = new Date();
  if (termList) termList.forEach(t => { if (!t.IsDeleted && new Date(t.StartDate) <= now && new Date(t.EndDate) >= now) terms.add(String(t.ClassTermId)); });
  frames.forEach(x => x.remove());
  if (!alive()) return;
  const main = await loadList([...terms], "Loading every class…");
  if (!main) { say("JustGo didn't load the class list in time.", "Close this, wait a moment and click Send to SAADI Hub again."); return; }
  if (!alive()) return;
  const n = main.n, total = main.total;
  if (total && n < total) { say("Only " + n + " of " + total + " classes loaded.", "Close this, keep the JustGo tab in front, and click Send to SAADI Hub again."); return; }
  const text = [...main.rows()].map(r => r.innerText).join("\n").split("\n").map(s => s.trim()).filter(Boolean).join("\n");
  // Each class's public booking page (the same link as JustGo's "Copy Link"): read from the class list's own data.
  const data = tableData(main.d, o => o.SessionGuid) || [];
  const links = data.map(o => [o.DayOfWeek, o.SessionName, o.SessionGuid]);
  main.fr.remove();
  // ---------- Term renewals ----------
  let ren = null, renNote = "";
  try {
    const day = 864e5, len = t => (new Date(t.EndDate) - new Date(t.StartDate)) / day;
    const termly = t => !t.IsDeleted && len(t) >= 28 && len(t) <= 200 && !/full\s*year/i.test(t.Name);
    const cur = (termList || []).filter(t => termly(t) && new Date(t.StartDate) <= now && new Date(t.EndDate) >= now);
    const curEnd = Math.max(0, ...cur.map(t => +new Date(t.EndDate)));
    // Next term: starts once this term has (nearly) finished, so one-off terms running alongside this one aren't counted.
    const nxt = (termList || []).filter(t => termly(t) && new Date(t.StartDate) > now && +new Date(t.StartDate) >= curEnd - 7 * day && +new Date(t.StartDate) <= curEnd + 45 * day);
    if (cur.length && nxt.length && alive()) {
      const nextList = await loadList(nxt.map(t => String(t.ClassTermId)), "Loading next term's classes…");
      const nextData = nextList ? (tableData(nextList.d, o => o.SessionGuid) || []) : [];
      if (nextList) nextList.fr.remove();
      const curIds = new Set(cur.map(t => t.ClassTermId)), nxtIds = new Set(nxt.map(t => t.ClassTermId));
      const sessions = data.filter(o => curIds.has(o.TermId)).map(o => [o, "c"]).concat(nextData.filter(o => nxtIds.has(o.TermId)).map(o => [o, "n"]));
      sessions.forEach(([o, k]) => { o.__k = k; });
      // JustGo's register service needs the same sign-in headers its own register page sends: open one register and borrow them.
      say("Reading the class registers…");
      let H = null;
      if (sessions.length) {
        const rf = frame(path + "attendee/" + sessions[0][0].SessionGuid);
        for (let i = 0; i < 40 && !H; i++) {
          await wait(500);
          try {
            const w = rf.contentDocument.querySelector("iframe").contentWindow;
            if (!w.__saadiHook) {
              const R = [...w.document.querySelectorAll("*")].find(e => !e.children.length && e.innerText && e.innerText.trim() === "Refresh");
              if (!R) continue;
              w.__saadiHook = 1;
              const X = w.XMLHttpRequest.prototype, sh = X.setRequestHeader, sd = X.send;
              X.setRequestHeader = function (k, v) { (this.__h = this.__h || {})[k] = v; return sh.apply(this, arguments); };
              X.send = function (b) { if (/sessionGuid/.test(String(b))) this.addEventListener("load", () => { w.__saadiH = this.__h; }); return sd.apply(this, arguments); };
              (R.closest("button") || R).click();
            }
            H = w.__saadiH || null;
          } catch (e) {}
        }
        rf.remove();
      }
      if (H && alive()) {
        const get = async g => {
          let all = [], p = 1;
          for (;;) {
            const r = await fetch(API, { method: "POST", headers: H, body: JSON.stringify({ sessionGuid: g, ownerGuid: club, occurrenceIds: "", rowsPerPage: 100, pageNumber: p, isActiveMemberOnly: true, filterValue: "" }) });
            const j = await r.json(), v = (j && j.value) || { attendees: [], totalCount: 0 };
            all = all.concat(v.attendees || []);
            if (all.length >= v.totalCount || !(v.attendees || []).length || p > 5) break;
            p++;
          }
          return all;
        };
        const kids = {}, rows = [], cls = [];
        const queue = sessions.map((s, i) => [s, i]);
        let done = 0;
        sessions.forEach(([o, k]) => { const sc = (o.Schedules || [])[0] || {}; cls.push([o.SessionGuid, k, o.TermName, o.DayOfWeek, sc.StartTime || "", sc.EndTime || "", o.SessionName, typeof o.ColorName === "string" ? o.ColorName : "", o.AgeGroupName || ""]); });
        await Promise.all(Array.from({ length: 8 }, async () => {
          while (queue.length && alive()) {
            const [[o], i] = queue.shift();
            try {
              (await get(o.SessionGuid)).forEach(a => {
                if (a.isCancelled) return;
                const id = String(a.memberId || a.entityid);
                const fl = a.hasTrial ? "T" : String(a.chipStatus || "").toUpperCase() === "PAYG" ? "P" : "";
                // Names and emails only for termly places this term and bookings next term; trials and pay-as-you-go are just counted.
                if (!kids[id] && (fl === "" || o.__k === "n")) kids[id] = [a.firstName || "", a.lastName || "", a.parentFirstname || "", a.parentEmailAddress || a.emailAddress || "", a.age || ""];
                rows.push([i, fl === "" || o.__k === "n" ? id : "", fl]);
              });
            } catch (e) {}
            done++;
            say("Reading the class registers… " + done + " of " + sessions.length);
          }
        }));
        ren = { v: 1, at: new Date().toISOString(), club, cur: cur.map(t => [t.ClassTermId, t.Name, t.StartDate, t.EndDate]), next: nxt.map(t => [t.ClassTermId, t.Name, t.StartDate, t.EndDate]), cls, kids, rows };
        renNote = " Renewals: " + Object.keys(kids).length + " children.";
      } else renNote = " (Couldn't read the registers for renewals this time.)";
    }
  } catch (e) { renNote = " (Couldn't read the registers for renewals this time.)"; }
  if (!alive()) return;
  frames.forEach(x => x.remove());
  const url = HUB + "#jg=" + encodeURIComponent(JSON.stringify({ v: 5, at: new Date().toISOString(), n, total, terms: [...terms], text, club, links, ren }));
  say("All " + n + " classes are ready." + renNote, "Open the hub, check the summary and press Save week.");
  ov.querySelector("#saadiSyncBtns").innerHTML = "";
  btn("Open SAADI Hub", () => { const w = window.open(url, "saadiHubSync"); if (!w) location.href = url; close(); }, true);
  btn("Cancel", close);
})();
