/* Convert the Hub's imported termly rota (data/<key>/rota/<term>) into SAADI Team's rota:
 *   rotaTerms/<tid>            the term: its weeks (Monday dates, labels, notes)
 *   rotaSlots/<tid>-<d>-<n>    one slot = day + time + class + role, with its USUAL people (the template)
 *   rotaWeeks/<tid>_<monday>   only what's different that week (cover, closures, one-offs)
 * Times: from the role ("Open (9am)"), the class ("11am Preschool", "Novice 4:00-5:15") or the session ("4:00 PM").
 * A class that runs over several session rows (squads) gets one hour-slot per row.
 * Usage: node rota-from-sheet.js <path to fsadmin.js> [--write]
 */
"use strict";
const fs = require(process.argv[2]);
const WRITE = process.argv.includes("--write");
const vm = require("vm");
const ctx = { window: {}, console };
vm.createContext(ctx);
vm.runInContext(require("fs").readFileSync(require("path").join(__dirname, "..", "staffing-core.js"), "utf8"), ctx);
const ST = ctx.window.ST;

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const hm = m => m == null ? null : String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
// "4:00 PM", "11am", "11:45am", "8:30am/8:45am" -> minutes after midnight (first time found). pmHint: assume pm for 1-7 o'clock
function time(s, pmHint) {
  const m = String(s || "").match(/(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/i);
  if (!m || (!m[2] && !m[3])) return null;
  let h = +m[1] % 12; const ap = (m[3] || "").toLowerCase();
  if (ap === "pm" || (!ap && pmHint && h >= 1 && h <= 8)) h += 12;
  return h * 60 + (+m[2] || 0);
}
function range(cls, pm) { // "Novice 4:00-5:15", "MAG Juniors 6-8pm", "Rec Plus 5:15pm-6:30pm"
  const t = String(cls).match(/(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)\s*-\s*(\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?)/i);
  if (!t) return null;
  const endPm = /pm/i.test(t[2]) || pm;
  let a = time(t[1].includes(":") || /am|pm/i.test(t[1]) ? t[1] : t[1] + ":00", endPm), b = time(t[2].includes(":") || /am|pm/i.test(t[2]) ? t[2] : t[2] + ":00", endPm);
  if (a == null || b == null) return null;
  if (b <= a) b += 720;
  return [a, b];
}
const baseName = cls => String(cls).replace(/\s*\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?\s*-\s*\d{1,2}(?:[:.]\d{2})?\s*(?:am|pm)?\s*$/i, "").trim().toLowerCase();
function defaultMins(cls) {
  const c = cls.toLowerCase();
  if (/pre\s*-?\s*school/.test(c)) return 45; if (/play\s*gym|novice/.test(c)) return 75;
  if (/parent\s*&?\s*child|home\s*ed/.test(c)) return 45;
  if (/\bgroup\b|recreational/.test(c)) return 60; return 60;
}
const mode = arr => { const c = {}; arr.forEach(x => c[x] = (c[x] || 0) + 1); return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ""; };
const mondayOf = iso => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); };

(async () => {
  await fs.init();
  const src = (await fs.query("rota", true)).filter(d => /^data\/[^/]+\/rota\//.test(d.path)).sort((a, b) => String(b.importedAt).localeCompare(String(a.importedAt)))[0];
  if (!src) throw new Error("No imported rota in the Hub");
  const cfg = (await fs.query("config", true)).find(d => /^data\/[^/]+\/config\/staffing$/.test(d.path)) || {};
  const people = (await fs.query("people")).filter(p => p.status !== "leaver");
  const staff = people.map(p => ({ id: String(p.breatheId), first: p.firstName, known: p.knownAs, last: p.lastName }));
  const map = cfg.names || {};
  const pidOf = tok => { const s = ST.matchName(tok, staff, map); return s && !s.ignore ? "b" + s.id : s && s.ignore ? "ignore" : null; };

  const tid = src.key.replace(/-?staffing-?/, "-").replace(/^-|-$/g, "") || src.key; // "autumn-term-2026"
  const slots = {}, weeks = {}, unmatched = {};
  const termMondays = new Map();
  let noTime = 0;
  // a day with nobody on it at all that week = closed (half term, bank holiday), recorded once for the day
  const closed = {};
  DAYS.forEach((day, di) => {
    const D = src.days[day]; if (!D) return;
    D.weeks.forEach((w, wi) => {
      if (!w.date || D.rows.some(r => ST.namesIn(r.cells[wi] || "").length)) return;
      closed[`${di}_${w.date}`] = 1;
      const key = `rotaWeeks/${tid}_${mondayOf(w.date)}`;
      const wk = weeks[key] = weeks[key] || { term: tid, monday: mondayOf(w.date), changes: {}, closed: {}, updatedBy: "rota-import" };
      wk.closed[String(di)] = [w.label, w.note].filter(x => x && !/^week\s*\d+$/i.test(x)).join(" · ") || "Closed";
    });
  });
  DAYS.forEach((day, di) => {
    const D = src.days[day]; if (!D) return;
    D.weeks.forEach(w => { if (!w.date) return; const m = mondayOf(w.date); if (!termMondays.has(m) || di === 0) termMondays.set(m, { monday: m, label: w.label || "", note: w.note || "" }); });
    // which session rows each class appears in, to cut multi-hour classes into hour-slots
    const sessStart = r => time(r.session, true);
    const rowsOf = {}; D.rows.forEach(r => (rowsOf[baseName(r.cls)] = rowsOf[baseName(r.cls)] || []).push(sessStart(r)));
    D.rows.forEach((r, i) => {
      const pm = /pm/i.test(r.session) || /^\d/.test(r.session) && time(r.session, true) >= 720;
      const rg = range(r.cls, pm || /pm/i.test(r.cls));
      let start = time(r.role, false) ?? (/^\d/.test(r.cls) ? time(r.cls, false) : null) ?? sessStart(r);
      if (rg && start != null && rg[0] > start) start = rg[0];
      let end = null;
      if (start != null) {
        const later = (rowsOf[baseName(r.cls)] || []).filter(t => t != null && t > start).sort((a, b) => a - b)[0];
        const saved = (src.mins || {})[[day, r.session, r.cls, r.cls === "Desk/Reception" ? r.role : ""].join("|")];
        if (later && rg) end = Math.min(later, rg[1]);
        else if (rg) end = rg[1];
        else end = start + (saved != null && saved !== "" ? +saved : defaultMins(r.cls));
      }
      if (start == null) noTime++;
      const cellPids = t => ST.namesIn(t).map(tok => { const p = pidOf(tok); if (!p) unmatched[tok] = (unmatched[tok] || 0) + 1; return p; }).filter(p => p && p !== "ignore");
      const sid = `${tid}-${di}-${String(i).padStart(3, "0")}`;
      // the usual people = the most common SET of people over the open weeks (spelling differences don't count)
      const open = D.weeks.map((w, wi) => ({ w, wi })).filter(x => x.w.date && !closed[`${di}_${x.w.date}`]);
      const keyOf = t => cellPids(t).slice().sort().join(",") + (ST.namesIn(t).some(tok => !pidOf(tok)) ? "|" + t : "");
      const usualKey = mode(open.map(x => keyOf((r.cells[x.wi] || "").trim())));
      const usualText = mode(open.map(x => (r.cells[x.wi] || "").trim()).filter(t => keyOf(t) === usualKey));
      const extra = t => /\d|from|until|till|@|\(|staying|leaving|only|then/i.test(t); // part-shifts and notes are worth keeping
      slots[`rotaSlots/${sid}`] = {
        term: tid, day: di, order: i, session: r.session, cls: r.cls, role: r.role, colour: r.colour || null, termly: r.termly || null,
        position: ST.positionFor(r), start: hm(start), end: hm(end), usual: cellPids(usualText), usualText: usualText || null,
        source: "sheet", updatedBy: "rota-import"
      };
      open.forEach(({ w, wi }) => {
        const t = (r.cells[wi] || "").trim();
        if (keyOf(t) === usualKey && (t === usualText || !extra(t))) return;
        const key = `rotaWeeks/${tid}_${mondayOf(w.date)}`;
        const wk = weeks[key] = weeks[key] || { term: tid, monday: mondayOf(w.date), changes: {}, closed: {}, updatedBy: "rota-import" };
        wk.changes[sid] = { people: cellPids(t), text: t || null };
      });
    });
  });
  const wl = [...termMondays.values()].sort((a, b) => a.monday.localeCompare(b.monday));
  const term = { name: src.title.replace(/staffing\s*/i, "").trim(), weeks: wl, start: wl[0].monday, end: wl[wl.length - 1].monday,
    source: "sheet", importedFrom: src.key, updatedBy: "rota-import" };

  // hours per person in a typical week (template), for a sanity check
  const hrs = {};
  Object.values(slots).forEach(s => { if (!s.start || !s.end) return; const m = (+s.end.slice(0, 2) * 60 + +s.end.slice(3)) - (+s.start.slice(0, 2) * 60 + +s.start.slice(3)); s.usual.forEach(p => hrs[p] = (hrs[p] || 0) + m); });
  const h = Object.values(hrs).map(m => m / 60).sort((a, b) => a - b);
  console.log(`term ${tid}: "${term.name}", ${wl.length} weeks ${term.start} .. ${term.end}`);
  console.log(`slots: ${Object.keys(slots).length}, without a time: ${noTime}, weeks with changes: ${Object.keys(weeks).length}, changes: ${Object.values(weeks).reduce((t, w) => t + Object.keys(w.changes).length, 0)}`);
  console.log(`people on the usual week: ${h.length}; hours/week min ${h[0]?.toFixed(1)}, median ${h[Math.floor(h.length / 2)]?.toFixed(1)}, max ${h[h.length - 1]?.toFixed(1)}, total ${h.reduce((a, b) => a + b, 0).toFixed(0)}`);
  console.log(`unmatched name tokens: ${Object.keys(unmatched).length} distinct, ${Object.values(unmatched).reduce((a, b) => a + b, 0)} uses`);
  if (process.argv.includes("--show-unmatched")) console.log(Object.entries(unmatched).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} (${n})`).join(", "));
  const times = {}; Object.values(slots).forEach(s => { const k = `${DAYS[s.day].slice(0, 3)} ${s.session} | ${s.cls}`; times[k] = times[k] || `${s.start}-${s.end}`; });
  if (process.argv.includes("--show-times")) Object.entries(times).forEach(([k, v]) => console.log("  ", v, k));
  if (WRITE) {
    const n = await fs.writeAll({ [`rotaTerms/${tid}`]: term, ...slots, ...weeks });
    console.log("written:", n, "documents");
  }
})().catch(e => { console.error("ERR", e.stack); process.exit(1); });
