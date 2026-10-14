// SAADI Business Hub: shared sign-in, data access and chart tooltip.
// Uses the same password key as the Class Capacity page, so signing in once opens every page on this device.
(function(){
"use strict";
const KEY_STORE="saadiCapacityKey";
const SALT="saadi-class-capacity|";
const PLAN_STORE="saadiPlanKey";
const PLAN_SALT="saadi-business-plan|";
const Hub={fs:null,keyId:null,keyDoc:null,dataKey:null,isOwner:false,planKey:null};

Hub.$=id=>document.getElementById(id);
Hub.esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
Hub.todayIso=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};
Hub.fmtDate=(iso,opts)=>{if(!iso)return "";const d=new Date(iso+"T12:00:00");return d.toLocaleDateString("en-GB",opts||{day:"numeric",month:"short",year:"numeric"})};

async function hashPw(pw,salt){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode((salt||SALT)+pw.trim()));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}
function remember(id,yes){try{yes?localStorage.setItem(KEY_STORE,id):localStorage.removeItem(KEY_STORE)}catch(e){}}

Hub.start=function(){
  const cfg=window.SAADI_FIREBASE_CONFIG;
  if(!window.firebase||!cfg||!cfg.apiKey)return false;
  if(!firebase.apps.length)firebase.initializeApp(cfg);
  Hub.fs=firebase.firestore();return true;
};
Hub.open=async function(id,rem){
  let k;
  try{k=await Hub.fs.doc("keys/"+id).get()}catch(e){return "Couldn't reach the database. Check the internet connection and try again."}
  if(!k.exists)return "That password isn't right.";
  Hub.keyId=id;Hub.keyDoc=k.data();Hub.dataKey=Hub.keyDoc.dataKey;Hub.isOwner=Hub.keyDoc.role==="owner";
  remember(id,rem);return "";
};
Hub.openWithPassword=async(pw,rem)=>Hub.open(await hashPw(pw),rem);
Hub.saved=()=>{try{return localStorage.getItem(KEY_STORE)}catch(e){return null}};
Hub.lock=()=>{remember(null,false);try{localStorage.removeItem(PLAN_STORE)}catch(e){}location.reload()};
Hub.doc=p=>Hub.fs.doc(`data/${Hub.dataKey}/${p}`);
Hub.col=p=>Hub.fs.collection(`data/${Hub.dataKey}/${p}`);

/* Wire a standard password panel. onReady runs once signed in. */
Hub.gate=function(onReady){
  const panel=Hub.$("authPanel"),form=Hub.$("authForm"),msg=Hub.$("authMsg");
  if(!Hub.start()){Hub.$("statusNote").hidden=false;Hub.$("statusNote").textContent="Setup needed: firebase-config.js is missing.";return}
  const show=()=>{panel.hidden=false;Hub.$("authPass").focus()};
  form.addEventListener("submit",async e=>{
    e.preventDefault();const pw=Hub.$("authPass").value;
    if(!pw.trim()){msg.textContent="Type the password first.";return}
    Hub.$("authGo").disabled=true;msg.textContent="Checking…";
    const err=await Hub.openWithPassword(pw,Hub.$("authRemember").checked);
    Hub.$("authGo").disabled=false;msg.textContent=err;
    if(!err){Hub.$("authPass").value="";panel.hidden=true;document.body.classList.add("signed-in");onReady()}
  });
  document.querySelectorAll("[data-lock]").forEach(b=>b.onclick=Hub.lock);
  const id=Hub.saved();
  if(id)Hub.open(id,true).then(err=>{if(err){remember(null,false);show()}else{document.body.classList.add("signed-in");onReady()}});
  else show();
};

/* ---------- Business Plan: its own password ----------
   The plan lives under its own random data key, reachable only through the plan password's key document.
   The password is never stored in these files: only a salted hash is used as a document id. */
Hub.planSaved=()=>{try{return localStorage.getItem(PLAN_STORE)}catch(e){return null}};
Hub.openPlan=async function(id,rem){
  let k;
  try{k=await Hub.fs.doc("keys/"+id).get()}catch(e){return "Couldn't reach the database. Try again."}
  if(!k.exists||k.data().kind!=="plan")return "That isn't the Business Plan password.";
  Hub.planKey=k.data().dataKey;
  try{rem?localStorage.setItem(PLAN_STORE,id):localStorage.removeItem(PLAN_STORE)}catch(e){}
  return "";
};
Hub.planDoc=p=>Hub.fs.doc(`data/${Hub.planKey}/${p}`);
Hub.planCol=p=>Hub.fs.collection(`data/${Hub.planKey}/${p}`);
/* Is the plan password set up yet? (a marker in the hub's own data) */
Hub.planIsSetUp=async()=>{try{const m=await Hub.doc("config/planLock").get();return m.exists}catch(e){return true}};
/* One-off: create the plan password and move any plan already saved in the hub area across to it. */
Hub.setUpPlan=async function(pw,who){
  const id=await hashPw(pw,PLAN_SALT);
  const rnd=crypto.getRandomValues(new Uint8Array(24));const dataKey=[...rnd].map(x=>x.toString(16).padStart(2,"0")).join("");
  const ex=await Hub.fs.doc("keys/"+id).get();
  if(ex.exists)return "That password is already in use. Choose another.";
  await Hub.fs.doc("keys/"+id).set({role:"staff",kind:"plan",dataKey,createdAt:new Date().toISOString()});
  const dest=p=>Hub.fs.doc(`data/${dataKey}/${p}`);
  const old=await Hub.col("plan").get();
  const docs=old.docs;
  for(let i=0;i<docs.length;i+=200){const b=Hub.fs.batch();docs.slice(i,i+200).forEach(d=>b.set(dest("plan/"+d.id),d.data()));await b.commit()}
  const meta=await Hub.doc("planMeta/info").get();
  if(meta.exists)await dest("planMeta/info").set(meta.data());
  for(let i=0;i<docs.length;i+=200){const b=Hub.fs.batch();docs.slice(i,i+200).forEach(d=>b.delete(d.ref));await b.commit()}
  if(meta.exists)await Hub.doc("planMeta/info").delete();
  await Hub.doc("config/planLock").set({setAt:new Date().toISOString(),setBy:who||"",moved:docs.length});
  Hub.planKey=dataKey;
  try{localStorage.setItem(PLAN_STORE,id)}catch(e){}
  return "";
};
/* Second gate on the Business Plan page. Expects #planPanel with #planForm, #planPass, #planPass2Row, #planPass2, #planRemember, #planGo, #planMsg, #planTitle, #planIntro. */
Hub.planGate=async function(onReady){
  const saved=Hub.planSaved();
  if(saved&&!(await Hub.openPlan(saved,true)))return onReady();
  const setUp=await Hub.planIsSetUp();
  const panel=Hub.$("planPanel"),msg=Hub.$("planMsg");
  if(!setUp){
    Hub.$("planTitle").textContent="Set the Business Plan password";
    Hub.$("planIntro").textContent="The Business Plan has its own password, separate from the Hub. Choose it now. Anyone opening the plan will need it. It can't be recovered, so keep a note of it.";
    Hub.$("planPass2Row").hidden=false;Hub.$("planGo").textContent="Set password";
  }
  panel.hidden=false;Hub.$("planPass").focus();
  Hub.$("planForm").addEventListener("submit",async e=>{
    e.preventDefault();const pw=Hub.$("planPass").value;
    if(!pw.trim()){msg.textContent="Type the password first.";return}
    Hub.$("planGo").disabled=true;msg.textContent=setUp?"Checking…":"Setting up and moving the plan across…";
    let err;
    try{
      if(setUp)err=await Hub.openPlan(await hashPw(pw,PLAN_SALT),Hub.$("planRemember").checked);
      else if(pw!==Hub.$("planPass2").value)err="The two passwords don't match.";
      else if(pw.trim().length<6)err="Use at least 6 characters.";
      else err=await Hub.setUpPlan(pw,(Hub.$("myName")&&Hub.$("myName").value)||"");
    }catch(x){err="Something went wrong ("+(x.code||"error")+"). Try again."}
    Hub.$("planGo").disabled=false;msg.textContent=err;
    if(!err){Hub.$("planPass").value="";Hub.$("planPass2").value="";panel.hidden=true;onReady()}
  });
};

/* Tooltip for any element with data-tip (charts). */
Hub.tooltips=function(){
  let tip=document.createElement("div");tip.className="tip";tip.setAttribute("role","tooltip");tip.hidden=true;document.body.appendChild(tip);
  const place=(x,y)=>{const w=tip.offsetWidth,h=tip.offsetHeight;let left=x+14,top=y-h-10;
    if(left+w>innerWidth-8)left=x-w-14;if(left<8)left=8;if(top<8)top=y+16;tip.style.left=left+"px";tip.style.top=top+"px"};
  document.addEventListener("pointerover",e=>{const t=e.target.closest("[data-tip]");if(!t){tip.hidden=true;return}tip.innerHTML=t.dataset.tip;tip.hidden=false;place(e.clientX,e.clientY)});
  document.addEventListener("pointermove",e=>{if(!tip.hidden)place(e.clientX,e.clientY)});
  document.addEventListener("focusin",e=>{const t=e.target.closest("[data-tip]");if(!t)return;tip.innerHTML=t.dataset.tip;tip.hidden=false;const r=t.getBoundingClientRect();place(r.left+r.width/2,r.top)});
  document.addEventListener("focusout",()=>{tip.hidden=true});
  window.addEventListener("scroll",()=>{tip.hidden=true},{passive:true});
};

window.Hub=Hub;
})();
