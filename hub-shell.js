// SAADI Business Hub: the shared layout on every page.
// A slim top bar (logo, page name on phones, Lock), a menu grouped by job with live counts, and a clean page heading.
// Each page keeps its own header in the HTML; this moves that page's controls (week picker, "Updating as", Lock...)
// into the new layout and hides the rest, so every existing button keeps working exactly as before.
// Works on its own (Class Capacity doesn't load hub-core.js).
(function(){
"use strict";
const PAGES = [
  {group: "", items: [
    {href: "index.html", name: "Today", desc: "What needs doing and how the club is doing, at a glance.", icon: "home"}]},
  {group: "Front desk", items: [
    {href: "enquiry-desk.html", name: "Enquiry Desk", desc: "Answer enquiries, send trial invites and follow up until families join.", icon: "chat", badge: "enq"},
    {href: "email-assistant.html", name: "Email Assistant", desc: "Replies Claude has drafted for reception@: check, edit and send.", icon: "mail", badge: "mail"},
    {href: "failed-payments.html", name: "Failed Payments", desc: "Payments that didn't go through, and a friendly offer to help.", icon: "card", badge: "pay"},
    {href: "term-renewals.html", name: "Term Renewals", desc: "Who has booked next term, and reminders for families who haven't.", icon: "repeat"}]},
  {group: "Business", items: [
    {href: "class-capacity.html", name: "Class Capacity", desc: "How full every class is: empty places and waiting lists, week by week.", icon: "chart"},
    {href: "business-plan.html", name: "Business Plan", desc: "Every objective with its owner, due date and progress.", icon: "target"},
    {href: "calendar.html", name: "Club Calendar", desc: "Term dates, assessments and competitions, with clashes flagged.", icon: "calendar"}]},
  {group: "Team", items: [
    {href: "rota.html", name: "Rota", desc: "Calendar of everyone's shifts. Red = needs cover: offer it to the same band, one band down or one person.", icon: "calendar"},
    {href: "shifts.html", name: "Shift offers", desc: "Staff who've offered to cover a shift: give it to one person and the rota updates.", icon: "repeat"},
    {href: "people.html", name: "People", desc: "Everything about each member of staff: details, contract, band, working days, groups, holiday. Approve time off.", icon: "people"},
    {href: "documents.html", name: "Documents", desc: "Contracts to sign and company documents everyone must read: who's signed, who's read, and reminders.", icon: "doc"},
    {href: "payroll.html", name: "Payroll", desc: "Month-end hours, holiday and sickness (SSP) for everyone, ready for QuickBooks payroll.", icon: "chart"}]}
];
const ICONS = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.8 7L4 20l1-4.5A8 8 0 1 1 21 12z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6 15h4"/>',
  repeat: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2a5 5 0 0 1 5.5 4.8"/>',
  doc: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'
};
const icon = (k, cls) => `<svg class="${cls || "ic"}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k]}</svg>`;
const here = (location.pathname.split("/").pop() || "index.html").toLowerCase();
const all = PAGES.flatMap(g => g.items);
const page = all.find(p => p.href === here) || (here === "staffing.html" ? {href: here, name: "Staffing", desc: "The old cover page and the pay scale (Wages)."} : all[0]);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));

function build(){
  const old = document.querySelector("header.top");
  if (!old || document.getElementById("hubTop")) return;
  document.body.classList.add("shell");

  // top bar
  const top = document.createElement("header");
  top.id = "hubTop";
  top.innerHTML = `<button type="button" class="menu-btn" id="hubMenuBtn" aria-label="Menu" aria-expanded="false">${icon("menu")}</button>
    <a class="hub-brand" href="index.html"><img src="saadi-logo-white.png" alt="SAADI Gymnastics" width="34" height="32"><span><b>SAADI</b> Business Hub</span></a>
    <span class="top-page">${esc(page.name)}</span><span class="top-right" id="hubTopRight"></span>`;
  document.body.prepend(top);

  // menu
  const nav = document.createElement("nav");
  nav.id = "hubSide"; nav.setAttribute("aria-label", "Hub pages");
  nav.innerHTML = PAGES.map(g => `${g.group ? `<div class="side-group">${esc(g.group)}</div>` : ""}` +
    g.items.map(p => `<a href="${p.href}"${p === page ? ' aria-current="page"' : ""}>${icon(p.icon)}<span>${esc(p.name)}</span>${p.badge ? `<em class="badge" data-badge="${p.badge}" hidden></em>` : ""}</a>`).join("")).join("") +
    `<div class="side-foot">SAADI Gymnastics · Redbourn</div>`;
  document.body.prepend(nav);
  const scrim = document.createElement("div"); scrim.id = "hubScrim"; document.body.prepend(scrim);
  const setOpen = o => { document.body.classList.toggle("nav-open", o); top.querySelector("#hubMenuBtn").setAttribute("aria-expanded", String(o)); };
  top.querySelector("#hubMenuBtn").onclick = () => setOpen(!document.body.classList.contains("nav-open"));
  scrim.onclick = () => setOpen(false);

  // page heading: name, one line about the page, and the page's own controls
  const head = document.createElement("div");
  head.className = "page-head";
  head.innerHTML = `<div class="ph-text"><h1>${esc(page.name === "Today" ? "Today" : page.name)}</h1><p>${esc(page.desc)}</p></div><div class="ph-actions" id="hubActions"></div>`;
  const actions = head.querySelector("#hubActions"), right = top.querySelector("#hubTopRight");

  // Lock goes in the top bar; the page's other controls go in the heading
  // pages with their own sign-in (Rota, People) keep "Sign out"; Hub-password pages say "Lock"
  old.querySelectorAll("[data-lock], #signOut").forEach(b => { const own = b.id === "signOut"; b.classList.add("lock-btn"); b.innerHTML = icon("lock", "ic sm") + `<span>${own ? "Sign out" : "Lock"}</span>`; right.appendChild(b); });
  const controls = old.querySelector("#appControls");
  if (controls) actions.appendChild(controls);
  old.querySelectorAll(".head-right > *").forEach(el => { if (!el.classList.contains("hubnav")) actions.appendChild(el); });

  // the old header stays in the page (pages still refer to parts of it) but out of sight
  const hold = document.createElement("div"); hold.hidden = true; hold.id = "oldHeader";
  old.parentNode.insertBefore(head, old);
  hold.appendChild(old); document.body.appendChild(hold);
}

/* ---------- live counts on the menu ---------- */
const todayIso = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
function setBadge(k, n, title){
  document.querySelectorAll(`[data-badge="${k}"]`).forEach(b => { b.hidden = !n; b.textContent = n > 99 ? "99+" : n; b.title = title || ""; });
  document.dispatchEvent(new CustomEvent("hub-count", {detail: {k, n}}));
}
const loadScript = src => new Promise(res => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = res; document.head.appendChild(s); });
let started = false;
async function badges(){
  if (started || !window.firebase || !window.SAADI_FIREBASE_CONFIG) return;
  let id = null; try { id = localStorage.getItem("saadiCapacityKey"); } catch (e) {}
  const signedIn = window.Hub && Hub.dataKey && Hub.keyDoc && Hub.keyDoc.kind !== "plan" ? Hub.dataKey : null;
  if (!id && !signedIn) return;
  started = true;
  if (!firebase.apps.length) firebase.initializeApp(window.SAADI_FIREBASE_CONFIG);
  window.hubFirestore=window.hubFirestore||function(){const f=firebase.firestore();if(!window.__hubCache){window.__hubCache=1;try{f.enablePersistence({synchronizeTabs:true}).catch(()=>{})}catch(e){}}return f};
  window.hubOnce=window.hubOnce||(q=>new Promise((ok,no)=>{let u=()=>{};u=q.onSnapshot({includeMetadataChanges:true},s=>{if(!s.metadata.fromCache){u();ok(s)}},no)}));
  const fs = hubFirestore();
  let dk = signedIn;
  if (!dk) try { const k = await fs.doc("keys/" + id).get(); dk = k.exists && k.data().dataKey; } catch (e) {}
  if (!dk) { started = false; return; }
  const D = p => fs.doc(`data/${dk}/${p}`), C = p => fs.collection(`data/${dk}/${p}`);
  // Email Assistant: replies waiting (its own section of the database)
  D("config/emailAssist").get().then(d => {
    const key = d.exists && d.data().key; if (!key) return;
    fs.collection(`data/${key}/emailAssist`).where("status", "in", ["new", "waiting"]).onSnapshot(s => {
      const a = s.docs.map(x => x.data()), person = a.filter(x => x.status === "waiting" && x.needsPerson).length, ready = a.filter(x => x.status === "waiting" && !x.needsPerson).length;
      setBadge("mail", person + ready, `${person} need a person, ${ready} ready to send`);
      document.dispatchEvent(new CustomEvent("hub-count", {detail: {k: "mailPerson", n: person}}));
      document.dispatchEvent(new CustomEvent("hub-count", {detail: {k: "mailReady", n: ready}}));
    }, () => {});
  }).catch(() => {});
  // Failed Payments: same sums as the page
  if (!window.PayCore) await loadScript("payments-core.js?v=1");
  if (window.PayCore) {
    let PAY = null, LOG = {};
    const show = () => { if (!PAY) return; const t = PayCore.summary(PAY, LOG); setBadge("pay", t.one + t.reg, `${t.one} class payments not completed, ${t.reg} regular payments failing`); };
    D("payments/latest").onSnapshot(d => { try { PAY = d.exists ? JSON.parse(d.data().json) : null; } catch (e) { PAY = null; } show(); }, () => {});
    C("paymentEmails").onSnapshot(s => { LOG = {}; s.docs.forEach(x => LOG[x.id] = x.data()); show(); }, () => {});
  }
  // Enquiry Desk: follow-ups due today
  if (!window.EQ) await loadScript("enquiry-core.js?v=20");
  if (window.EQ) Promise.all([D("config/enquiryDesk").get().catch(() => null), hubOnce(C("enquiries"))]).then(([d, q]) => {
    const S = EQ.settings(d && d.exists ? d.data() : {}), recs = q.docs.map(x => ({id: x.id, ...x.data()}));
    const due = EQ.actions(recs, S, todayIso()).filter(a => a.dueNow).length;
    setBadge("enq", due, `${due} follow-up${due === 1 ? "" : "s"} due`);
  }).catch(() => {});
}

function start(){
  build();
  badges();
  // pages ask for the password first: start the counts once it's been entered
  const t = setInterval(() => { if (started) return clearInterval(t); badges(); }, 3000);
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
window.HubShell = {setBadge};
})();
