/* SAADI Team sign-in for Hub pages that hold staff data (People, Rota).
 * Each manager signs in as themselves with a 6-digit emailed code, never the shared Hub password.
 * Usage: TeamAuth.start({ need: ["manager","owner"], onReady: ({auth, db, fn, uid, pid, role}) => ... })
 * The page needs: #authPanel (empty section), #main (hidden until ready), optional #notManager, #signOut.
 */
(function () {
"use strict";
const $ = id => document.getElementById(id);
const TeamAuth = {};
TeamAuth.start = function (opts) {
  firebase.initializeApp(window.SAADI_FIREBASE_CONFIG);
  const auth = firebase.auth(), db = firebase.firestore(), fn = firebase.app().functions("europe-west2");
  const panel = $("authPanel");
  panel.innerHTML = `<h2>Sign in as yourself</h2>
    <p class="muted" style="margin:0">This page holds staff information, so it needs your own sign-in, not the Hub password. We'll email you a 6-digit code.</p>
    <form id="taEmail" class="wrap" style="gap:12px;margin:0">
      <label class="f" for="taE">Your work email <input type="email" id="taE" autocomplete="email" required></label>
      <div class="row"><button class="primary" id="taSend">Email me a code</button><span id="taM1" class="muted" aria-live="polite"></span></div></form>
    <form id="taCode" class="wrap" style="gap:12px;margin:0" hidden>
      <label class="f" for="taC">6-digit code <input id="taC" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required style="letter-spacing:8px;font-size:24px;text-align:center;font-weight:700;max-width:220px"></label>
      <div class="row"><button class="primary" id="taGo">Sign in</button><button type="button" id="taBack">Different email</button><span id="taM2" class="muted" aria-live="polite"></span></div></form>`;
  let email = "";
  $("taEmail").onsubmit = async e => { e.preventDefault(); email = $("taE").value.trim(); $("taSend").disabled = true; $("taM1").textContent = "Sending…";
    try { await fn.httpsCallable("sendCode")({ email }); $("taEmail").hidden = true; $("taCode").hidden = false; $("taC").focus(); $("taM1").textContent = ""; }
    catch (err) { $("taM1").textContent = err.message; } $("taSend").disabled = false; };
  $("taBack").onclick = () => { $("taCode").hidden = true; $("taEmail").hidden = false; };
  $("taCode").onsubmit = async e => { e.preventDefault(); $("taGo").disabled = true; $("taM2").textContent = "";
    try { const r = await fn.httpsCallable("verifyCode")({ email, code: $("taC").value }); await auth.signInWithCustomToken(r.data.token); }
    catch (err) { $("taM2").textContent = err.message; } $("taGo").disabled = false; };
  const out = () => auth.signOut().then(() => location.reload());
  if ($("signOut")) $("signOut").onclick = out;
  const nm = $("notManager");
  if (nm) { const b = document.createElement("button"); b.type = "button"; b.className = "primary"; b.textContent = "Sign in with a different email"; b.onclick = out; nm.appendChild(b); }
  // page.html?signout = sign out and come back clean (a way out if a button can't be seen)
  if (/[?&]signout\b/.test(location.search)) { auth.signOut().then(() => location.replace(location.pathname)); return; }
  auth.onAuthStateChanged(async u => {
    if (!u) { panel.hidden = false; $("main").hidden = true; if (nm) nm.hidden = true; document.body.classList.remove("signed-in"); return; }
    const t = await u.getIdTokenResult(true), role = t.claims.role || "";
    panel.hidden = true; document.body.classList.add("signed-in");
    if (opts.need && !opts.need.includes(role)) { if (nm) { nm.hidden = false; const p = nm.querySelector(".muted"); if (p && !nm.dataset.who) { nm.dataset.who = 1; p.insertAdjacentHTML("afterbegin", `You're signed in as <b>${(u.email || t.claims.email || "a staff member").replace(/[<>&]/g, "")}</b>, which has staff access only. `); } } return; }
    $("main").hidden = false;
    opts.onReady({ auth, db, fn, uid: u.uid, pid: t.claims.pid, role });
  });
};
window.TeamAuth = TeamAuth;
})();
