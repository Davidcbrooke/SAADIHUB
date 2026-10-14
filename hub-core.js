// SAADI Business Hub: shared sign-in, data access and chart tooltip.
// Uses the same password key as the Class Capacity page, so signing in once opens every page on this device.
(function(){
"use strict";
const KEY_STORE="saadiCapacityKey";
const SALT="saadi-class-capacity|";
const Hub={fs:null,keyId:null,keyDoc:null,dataKey:null,isOwner:false};

Hub.$=id=>document.getElementById(id);
Hub.esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
Hub.todayIso=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};
Hub.fmtDate=(iso,opts)=>{if(!iso)return "";const d=new Date(iso+"T12:00:00");return d.toLocaleDateString("en-GB",opts||{day:"numeric",month:"short",year:"numeric"})};

async function hashPw(pw){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(SALT+pw.trim()));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}
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
Hub.lock=()=>{remember(null,false);location.reload()};
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
