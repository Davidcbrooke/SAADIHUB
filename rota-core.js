/* SAADI Team rota: shared logic for the managers' editor (rota.html) and the staff app (team/).
 * Term  = rotaTerms/<tid>   {name, weeks:[{monday,label,note}]}
 * Slot  = rotaSlots/<sid>   {term, day 0=Mon..6=Sun, order, session, cls, role, colour, start "16:00", end "17:00", usual:[pid], usualText}
 * Week  = rotaWeeks/<tid>_<monday> {changes:{sid:{people:[pid], text}}, closed:{day:"Half term"}}
 * A week only stores what's different, so the usual people fill every week automatically.
 */
(function () {
"use strict";
const RC = {};
RC.DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
RC.iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
RC.monday = iso => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return RC.iso(d); };
RC.addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return RC.iso(d); };
RC.dayIdx = iso => (new Date(iso + "T12:00:00").getDay() + 6) % 7;
RC.mins = t => t ? (+t.slice(0, 2)) * 60 + (+t.slice(3, 5)) : null;
RC.hhmm = m => m == null ? "" : String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
RC.nice = t => { if (!t) return "?"; let h = +t.slice(0, 2); const m = t.slice(3, 5), ap = h >= 12 ? "pm" : "am"; h = h % 12 || 12; return h + (m !== "00" ? ":" + m : "") + ap; };
RC.hours = m => { const h = Math.floor(m / 60), r = m % 60; return h + "h" + (r ? " " + String(r).padStart(2, "0") : ""); };
RC.weekId = (tid, monday) => `${tid}_${monday}`;
RC.termFor = (terms, iso) => terms.find(t => t.weeks && t.weeks.some(w => w.monday === RC.monday(iso))) || null;

/* who's on a slot in a given week: the week's change if there is one, else the usual people */
RC.on = (slot, week) => {
  const c = week && week.changes && week.changes[slot.id];
  if (c) return { people: c.people || [], text: c.text || "", changed: true };
  return { people: slot.usual || [], text: slot.usualText || "", changed: false };
};
RC.closed = (week, day) => week && week.closed && week.closed[String(day)];

/* a person's shifts from `from` for `n` days: slots joined into continuous blocks (gaps up to 15 min count as continuous) */
RC.shiftsFor = (pid, slots, weeks, terms, from, n) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const date = RC.addDays(from, i), term = RC.termFor(terms, date);
    if (!term) continue;
    const day = RC.dayIdx(date), week = weeks[RC.weekId(term.id, RC.monday(date))];
    if (RC.closed(week, day)) continue;
    const mine = slots.filter(s => s.term === term.id && s.day === day && s.start && s.end && RC.on(s, week).people.includes(pid))
      .map(s => ({ s, a: RC.mins(s.start), b: RC.mins(s.end), note: RC.on(s, week).text }))
      .sort((x, y) => x.a - y.a || x.b - y.b);
    const blocks = [];
    mine.forEach(x => {
      const last = blocks[blocks.length - 1];
      if (last && x.a <= last.b + 15) { last.b = Math.max(last.b, x.b); last.items.push(x); }
      else blocks.push({ a: x.a, b: x.b, items: [x] });
    });
    blocks.forEach(b => out.push({ date, start: RC.hhmm(b.a), end: RC.hhmm(b.b), mins: b.b - b.a, items: b.items.map(x => ({ cls: x.s.cls, role: x.s.role, start: x.s.start, end: x.s.end, colour: x.s.colour, note: x.note })) }));
  }
  return out;
};

/* hours per person for one week (minutes, counting each person's joined-up blocks so overlaps aren't double counted) */
RC.weekHours = (term, slots, week, monday) => {
  const tot = {};
  const people = new Set(); slots.forEach(s => RC.on(s, week).people.forEach(p => people.add(p)));
  people.forEach(pid => {
    RC.shiftsFor(pid, slots, { [RC.weekId(term.id, monday)]: week }, [term], monday, 7)
      .forEach(b => tot[pid] = (tot[pid] || 0) + b.mins);
  });
  return tot;
};

/* calendar file (.ics) for a list of shifts */
RC.ics = (shifts, name) => {
  const z = s => s.replace(/[-:]/g, "");
  const ev = shifts.map((s, i) => [
    "BEGIN:VEVENT", `UID:saadi-${s.date}-${s.start}-${i}@saadigymnastics.co.uk`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
    `DTSTART;TZID=Europe/London:${z(s.date)}T${z(s.start)}00`, `DTEND;TZID=Europe/London:${z(s.date)}T${z(s.end)}00`,
    `SUMMARY:SAADI: ${s.items.map(x => x.cls).filter((v, j, a) => a.indexOf(v) === j).join(", ")}`.slice(0, 200),
    `DESCRIPTION:${s.items.map(x => `${RC.nice(x.start)} ${x.cls} (${x.role})`).join("\\n")}`.slice(0, 900),
    "LOCATION:SAADI Gymnastics\\, Redbourn AL3 7PP", "END:VEVENT"].join("\r\n"));
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SAADI Team//EN", `X-WR-CALNAME:${name || "SAADI shifts"}`, ...ev, "END:VCALENDAR"].join("\r\n");
};

/* load a term's slots and weeks (Firestore compat db) */
RC.load = async (db, tid) => {
  const [s, w] = await Promise.all([db.collection("rotaSlots").where("term", "==", tid).get(), db.collection("rotaWeeks").where("term", "==", tid).get()]);
  const weeks = {}; w.docs.forEach(d => weeks[d.id] = { id: d.id, ...d.data() });
  return { slots: s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.day - b.day || a.order - b.order), weeks };
};
window.RC = RC;
})();
