// SAADI Hub: failed payments, worked out the same way on the Failed Payments page and the Hub home page.
// Input: payments/latest (saved by the "Send to SAADI Hub" JustGo button) and the paymentEmails log.
(function(root){
"use strict";
const clean=s=>String(s||"").replace(/\s+/g," ").trim();
const keyOf=s=>clean(s).toLowerCase().replace(/[^a-z0-9@.]+/g,"-").slice(0,140);
const titleish=s=>clean(s).replace(/ \| /g,", ").toLowerCase().replace(/\b([a-z])/g,c=>c.toUpperCase()).replace(/\b(Am|Pm)\b/g,c=>c.toLowerCase()).replace(/\b(\d+(?:\.\d+)?)(Am|Pm)\b/gi,(m,a,b)=>a+b.toLowerCase());

/* "AGED 3 AND 4 YEARS | WEDS 11AM | MIXED  (Child Name) - Preschool Classes for 3-5 Y..." -> class, child, group.
   The child can also come at the very end ("One to one ... - One 2 One Private Coaching (C2025…) (Child)"). */
function splitItem(s){
  s=clean(String(s||"").replace(/\s*\(C\d{8,}[^)]*\)/g,""));
  let child="";const end=s.match(/^(.*)\(([^()]*)\)\s*$/);
  const dash=s.indexOf(" - ");let head=dash>-1?s.slice(0,dash):s, group=dash>-1?s.slice(dash+3):"";
  const hm=head.match(/^(.*)\(([^()]*)\)\s*$/);
  if(hm){head=hm[1];child=hm[2]}else if(end&&dash>-1&&group.endsWith(")")){const gm=group.match(/^(.*)\(([^()]*)\)\s*$/);if(gm){group=gm[1];child=gm[2]}}
  const cls=head.replace(/\|\s*MIXED\s*$/i,"").replace(/\s*\|\s*$/,"").trim();
  return {cls,child:clean(child),group:clean(group.replace(/\s*\([^()]*\)\s*$/,""))};
}
/* failure-log entries for card payments at checkout are one-off payments, not regular ones */
const isCheckout=desc=>/PendingCardCapture/i.test(desc);
/* Affected plans are separated by "|" with no spaces (class names contain " | " with spaces) */
const plansOf=desc=>(String(desc).split(/Affected Plans:/i)[1]||"").split(/(?<! )\|(?! )/).map(clean).filter(Boolean);

function oneOff(PAY){
  const by={};
  ((PAY&&PAY.one)||[]).forEach(([ref,date,total,items,payer,email])=>{
    String(items||"").split("\n").filter(Boolean).forEach(it=>{
      const x=splitItem(it);const k="o-"+keyOf(email+"-"+x.child+"-"+x.cls);
      const r=by[k]||(by[k]={key:k,type:"one",payer,email,child:x.child,cls:x.cls,group:x.group,amount:total,dates:[],refs:[]});
      r.dates.push(date);r.refs.push(ref);if(date>=Math.max(...r.dates))r.amount=total;
    });
  });
  ((PAY&&PAY.reg)||[]).filter(x=>isCheckout(x[3])).forEach(([ref,date,amount,desc,payer,email])=>{
    plansOf(desc).forEach(it=>{
      const x=splitItem(it);const k="o-"+keyOf(email+"-"+x.child+"-"+x.cls);
      const r=by[k]||(by[k]={key:k,type:"one",payer,email,child:x.child,cls:x.cls,group:x.group,amount,dates:[],refs:[]});
      r.dates.push(date);r.refs.push(ref);
    });
  });
  return Object.values(by);
}
/* "Payment Failed for PR… because Payment Unsuccessful - Refused by Card Issuer. Please use an alternative card.\n Affected Plans:\nPLAN (Child) - Group (C…)|PLAN2 (Child)" */
function regular(PAY){
  const by={};
  ((PAY&&PAY.reg)||[]).filter(x=>!isCheckout(x[3])&&plansOf(x[3]).length&&x[2]).forEach(([ref,date,amount,desc,payer,email,owner])=>{
    const reason=clean((String(desc).match(/because\s+([\s\S]*?)\s*Affected Plans:/i)||[,""])[1]).replace(/^Payment Unsuccessful\s*-\s*/i,"").replace(/\.\s*Please.*$/i,"");
    const plans=plansOf(desc);
    const x=splitItem(plans[0]||"");const k="r-"+keyOf(owner+"-"+x.cls+"-"+x.child);
    const r=by[k]||(by[k]={key:k,type:"reg",payer,email,child:x.child,cls:x.cls,group:x.group,amount,reason,extra:plans.length-1,dates:[],refs:[]});
    r.dates.push(date);r.refs.push(ref);if(date>=Math.max(...r.dates)){r.amount=amount;r.reason=reason||r.reason}
  });
  return Object.values(by);
}
/* open (not emailed or sorted), again (failed after the email), emailed, sorted */
function stateOf(r,LOG){
  const L=(LOG||{})[r.key], last=Math.max(...r.dates);
  if(L&&L.status==="sorted"&&(L.at||0)>=last)return "sorted";
  if(L&&L.status==="emailed")return last>(L.at||0)?"again":"emailed";
  return "open";
}
/* Headline numbers for the Hub home page */
function summary(PAY,LOG){
  const isOpen=r=>["open","again"].includes(stateOf(r,LOG));
  const one=oneOff(PAY), reg=regular(PAY);
  const sum=a=>a.reduce((t,r)=>t+(+r.amount||0),0);
  const o=one.filter(isOpen), g=reg.filter(isOpen);
  const emailed=Object.values(LOG||{}).filter(l=>l.status==="emailed"&&Date.now()-(l.at||0)<30*864e5).length;
  return {one:o.length, reg:g.length, value:sum(o)+sum(g), emailed};
}
root.PayCore={clean,keyOf,titleish,splitItem,oneOff,regular,stateOf,summary};
})(typeof window!=="undefined"?window:globalThis);
