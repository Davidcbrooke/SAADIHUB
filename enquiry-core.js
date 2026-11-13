// SAADI Enquiry Desk: the rules behind the page (class matching, follow-up actions, emails, results).
// No page code in here, so it can be tested on its own (node test-enquiry.js).
(function(root){
"use strict";
const EQ={};
const DAY=864e5;
const DAYS=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const DAYNAME={Mon:"Monday",Tue:"Tuesday",Wed:"Wednesday",Thu:"Thursday",Fri:"Friday",Sat:"Saturday",Sun:"Sunday"};
EQ.DAYS=DAYS;EQ.DAYNAME=DAYNAME;
EQ.BAND_COLOURS={Orange:"#f28c28",Yellow:"#f2c200",Blue:"#2f7de1",Red:"#d62d3b",Green:"#2e9e5b",Purple:"#8a4fd1"};

/* ---------- settings ---------- */
EQ.DEFAULTS={
  fromName:"SAADI Gymnastics",
  sender:"reception@saadigymnastics.co.uk",  // emails must go out from this Google account
  mailerFrom:"",            // the account the connected mailer actually sends from (filled in by the test)
  replyTo:"reception@saadigymnastics.co.uk",
  signOff:"The SAADI Gymnastics team",
  mailerUrl:"", mailerToken:"",
  logoUrl:"https://hub.saadigymnastics.co.uk/saadi-logo-white.png",
  trialLink:"",            // fallback only: each class's own JustGo booking page is used automatically
  joinLink:"",             // fallback only
  groupLinks:{},           // optional per-group trial links, e.g. {"Pre School":"https://..."}
  reminderDays:3,          // trial not booked: send the reminder this many days after the invite
  noReplyCloseDays:7,      // close as "no response" this many days after the reminder
  questionsDays:2,         // place not booked: send the "any questions?" email this many days after the book-your-place email
  lostCloseDays:7,         // close as "didn't join" this many days after the questions email
  offerGroups:{"Recreational":true,"Pre School":true,"Parent and Child":true,"Youth Gym":true,"Adult":true,
    "Novice":false,"Novice Plus":false,"Advanced Recreational":false},
  // Used only when a class name doesn't say which ages or school years it's for. Ages in years.
  groupAges:{"Parent and Child":[1,3],"Pre School":[2,4],"Recreational":[4,11],"Youth Gym":[11,17],"Adult":[16,99],
    "Novice":[5,11],"Novice Plus":[5,11],"Advanced Recreational":[6,14],"Play Gym":[0,4]},
  templates:{}             // overrides of EQ.TEMPLATES, by type
};
EQ.settings=function(saved){
  const s=JSON.parse(JSON.stringify(EQ.DEFAULTS));
  if(saved)for(const k in saved){
    if(saved[k]&&typeof saved[k]==="object"&&!Array.isArray(saved[k])&&s[k]&&typeof s[k]==="object")Object.assign(s[k],saved[k]);
    else if(saved[k]!==undefined&&saved[k]!==null)s[k]=saved[k];
  }
  return s;
};

/* ---------- dates ---------- */
const iso=d=>{d=new Date(d);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};
EQ.iso=iso;
const atNoon=s=>{if(s instanceof Date){const d=new Date(s);d.setHours(12,0,0,0);return d}return new Date(String(s).slice(0,10)+"T12:00:00")};
EQ.addDays=(s,n)=>iso(atNoon(s).getTime()+n*DAY);
EQ.daysBetween=(a,b)=>Math.round((atNoon(b)-atNoon(a))/DAY);
EQ.fmt=(s,o)=>s?atNoon(s).toLocaleDateString("en-GB",o||{weekday:"short",day:"numeric",month:"short"}):"";

/* ---------- ages and school years (England) ----------
   Reception = 0, Year 1 = 1 ... Pre-school (aged 3-4, the year before Reception) = -1.
   A child starts Reception in the September after they turn 4. */
function acStart(d){d=atNoon(d);return d.getMonth()>=8?d.getFullYear():d.getFullYear()-1}
EQ.schoolYearFromDob=(dob,on)=>acStart(on||new Date())-acStart(dob)-5;
EQ.ageOn=(dob,on)=>{const a=atNoon(dob),b=atNoon(on||new Date());let y=b.getFullYear()-a.getFullYear();if(b.getMonth()<a.getMonth()||(b.getMonth()===a.getMonth()&&b.getDate()<a.getDate()))y--;return y};
/* A child "aged X" today could be in one of two school years. */
EQ.yearsForAge=(age,on)=>{
  on=atNoon(on||new Date());
  const youngest=new Date(on);youngest.setFullYear(on.getFullYear()-age);            // turned X today
  const oldest=new Date(on);oldest.setFullYear(on.getFullYear()-age-1);oldest.setDate(oldest.getDate()+1); // turns X+1 tomorrow
  const a=EQ.schoolYearFromDob(oldest,on),b=EQ.schoolYearFromDob(youngest,on);
  const out=[];for(let y=Math.min(a,b);y<=Math.max(a,b);y++)out.push(y);return out;
};
EQ.yearLabel=y=>y<=-2?"Under 3s":y===-1?"Pre-school":y===0?"Reception":y>=14?"Adult":"Year "+y;
/* Who is the child? {age, dob} -> {ages:[..], years:[..], label} */
EQ.child=function(q,on){
  if(q.dob){const age=EQ.ageOn(q.dob,on),y=EQ.schoolYearFromDob(q.dob,on);return{ages:[age],years:[y],label:`${age} (${EQ.yearLabel(y)})`}}
  const age=+q.age;if(!isFinite(age)||q.age===""||q.age==null)return null;
  const years=EQ.yearsForAge(age,on);
  return{ages:[age],years,label:`${age} (${[...new Set(years.map(EQ.yearLabel))].join(" or ")})`};
};

/* ---------- reading a JustGo class ---------- */
EQ.classYears=c=>{
  const n=(String(c.name||"").split("|")[0]).toUpperCase();const ys=[];
  let m=n.match(/RECEPTION\s*(?:-|–|TO|&|AND)\s*(?:YEARS?|YR)?\s*(\d{1,2})/);
  if(m){for(let y=0;y<=+m[1];y++)ys.push(y)}
  else{
    if(/RECEPTION/.test(n))ys.push(0);
    m=n.match(/(?:YEARS?|YRS?)\s*(\d{1,2})\s*(?:-|–|&|AND|TO)?\s*(?:YEARS?|YRS?)?\s*(\d{1,2})?\s*(\+)?/);
    if(m){const a=+m[1],b=m[2]?+m[2]:(m[3]?13:a);for(let y=a;y<=b;y++)ys.push(y)}
  }
  return [...new Set(ys)].sort((a,b)=>a-b);
};
EQ.yearsText=ys=>{if(!ys.length)return"";const a=ys[0],b=ys[ys.length-1];
  if(a===b)return EQ.yearLabel(a);if(b>=13&&a>0)return `Year ${a}+`;
  return a<=0?`${EQ.yearLabel(a)}–Year ${b}`:`Years ${a}–${b}`};
EQ.classAges=(c,s)=>{
  const n=String(c.name||"").split("|")[0].toUpperCase();
  if(/\bADULT/.test(n))return[16,99];
  let m=n.match(/AGE[DS]?\s*(\d{1,2})\s*(?:-|–|TO|AND|&)\s*(\d{1,2})/)||n.match(/\b(\d{1,2})\s*(?:-|–|TO)\s*(\d{1,2})\s*(?:YRS?|YEARS?)\b/);
  if(m)return[+m[1],+m[2]];
  m=n.match(/AGE[DS]?\s*(\d{1,2})\s*(\+)?/);if(m)return[+m[1],m[2]?99:+m[1]];
  m=n.match(/\b(\d{1,2})\s*(?:YRS?|YEARS?)?\s*\+/);if(m)return[+m[1],99];
  return (s&&s.groupAges&&s.groupAges[c.group])||null;
};
EQ.genderOf=c=>{const n=String(c.name||"")+" "+String(c.group||"");const g=/\bgirls?\b|\bwomen'?s?\b|\bWAG\b/i.test(n),b=/\bboys?\b|\bmen'?s?\b|\bMAG\b/i.test(n);return g&&!b?"girl":b&&!g?"boy":"mixed"};
EQ.classKey=c=>[c.day,c.time,c.name,c.term].join("|");
EQ.shortTime=t=>String(t||"").split(" - ")[0].replace(/^0/,"").replace(/:00\s*/,"").replace(/\s+/g,"").toLowerCase();
EQ.classTitle=c=>(String(c.name||"").split("|")[0].trim()||c.group);
EQ.prettyTime=t=>{const parts=String(t||"").split(/\s*-\s*/).map(x=>{const m=x.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);if(!m)return{t:x,ap:""};return{t:(+m[1])+(m[2]==="00"?"":":"+m[2]),ap:(m[3]||"").toLowerCase()}});
  if(parts.length===2&&parts[0].ap===parts[1].ap)return `${parts[0].t}–${parts[1].t}${parts[1].ap}`;return parts.map(p=>p.t+p.ap).join("–")};
EQ.classWhen=c=>`${DAYNAME[c.day]||c.day} ${EQ.prettyTime(c.time)}`;

/* Find the JustGo class a free-text label refers to, e.g. "Mon 4-5pm Year 1 Yellow". */
EQ.findClass=function(label,classes){
  if(!label)return null;const L=String(label);
  const exact=(classes||[]).find(c=>`${c.day} ${EQ.prettyTime(c.time)} ${EQ.classTitle(c)}`===L);if(exact)return exact;
  const day=(L.match(/\b(mon|tue|wed|thu|fri|sat|sun)/i)||[])[1];
  const words=(L.toUpperCase().replace(/\b\d{1,2}([:.]\d{2})?\s*(AM|PM)?\s*[-–]\s*\d{1,2}([:.]\d{2})?\s*(AM|PM)\b/g," ").match(/[A-Z]{2,}|\d+\+?/g)||[])
    .filter(w=>!/^(MON|TUE|TUES|WED|WEDS|THU|THUR|THURS|FRI|SAT|SUN|MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY|AND|THE|TO|AM|PM)$/.test(w));
  let best=null,bs=0;
  (classes||[]).forEach(c=>{if(day&&String(c.day).toLowerCase()!==day.toLowerCase())return;
    const n=" "+String(c.name||"").toUpperCase().replace(/[|&,]/g," ").replace(/\s+/g," ")+" ";
    const sc=words.filter(w=>n.includes(" "+w+" ")||n.includes(" "+w.replace("+"," +")+" ")).length;
    if(sc>bs){bs=sc;best=c}});
  return bs>=Math.min(2,words.length)?best:null;
};
/* The booking page for a family: their trial class's JustGo page. */
EQ.joinLinkFor=(r,classes,s)=>r.joinLink||((EQ.findClass(r.trialClass,classes)||{}).link)||((r.classes||[])[0]||{}).link||s.joinLink||s.trialLink||"";

/* ---------- the answer: which classes could this child join? ----------
   q = {age|dob, gender: "girl"|"boy"|"", term?}. Returns {child, space:[...], full:[...], other:[...]} */
EQ.match=function(classes,q,s,on){
  const child=EQ.child(q,on);if(!child)return null;
  const res={child,space:[],full:[]};
  (classes||[]).forEach(c=>{
    if(c.legacy)return;
    if(!s.offerGroups[c.group])return;
    if(q.term&&c.term!==q.term)return;
    const g=EQ.genderOf(c);if(q.gender&&g!=="mixed"&&g!==q.gender)return;
    const ys=EQ.classYears(c);let ok,why;
    if(ys.length){ok=ys.some(y=>child.years.includes(y));why=EQ.yearsText(ys)}
    else{const r=EQ.classAges(c,s);if(!r)return;ok=child.ages.some(a=>a>=r[0]&&a<=r[1]);why=r[1]>=99?`${r[0]}+`:`ages ${r[0]}–${r[1]}`}
    if(!ok)return;
    const row={...c,key:EQ.classKey(c),gender:g,fits:why};
    (c.avail>0?res.space:res.full).push(row);
  });
  const ord=(a,b)=>DAYS.indexOf(a.day)-DAYS.indexOf(b.day)||mins(a.time)-mins(b.time);
  res.space.sort(ord);res.full.sort((a,b)=>a.wl-b.wl||ord(a,b));
  return res;
};
function mins(t){const m=String(t).match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);if(!m)return 0;let h=+m[1]%12;if(m[3]&&/pm/i.test(m[3]))h+=12;else if(!m[3])h=+m[1];return h*60+ +m[2]}
EQ.mins=mins;

/* Quick reply for phone, Facebook or Instagram messages (plain text). */
EQ.quickReply=function(res,q){
  if(!res)return"";
  const who=q.childName||(q.gender==="boy"?"your son":q.gender==="girl"?"your daughter":"your child");
  if(res.space.length){
    const lines=res.space.slice(0,6).map(c=>`• ${EQ.classWhen(c)}: ${EQ.classTitle(c)}`);
    return `Hi! Yes, we have space for ${who} (age ${res.child.ages[0]}). These classes have places right now:\n${lines.join("\n")}\n\nWe'd love to see ${q.childName||"them"} at a trial session. If you send us your email address, we'll send the link to book.`;
  }
  if(res.full.length)return `Hi! Thanks for getting in touch. Our classes for age ${res.child.ages[0]} are full at the moment, but we can add ${who} to the waiting list and let you know as soon as a place opens up. Can you send us your email address?`;
  return `Hi! Thanks for getting in touch. We don't have a class for age ${res.child.ages[0]} running at the moment. Can you send us your email address so we can let you know when one opens?`;
};

/* ---------- the follow-up journey ----------
   stage: invited -> reminded -> trial_booked -> booking_sent -> questions_sent -> joined | lost | no_response
          plus "enquiry" (logged, no email yet) and "waitlist". */
EQ.STAGES={
  enquiry:{label:"Enquiry",tone:"none"},
  invited:{label:"Trial invite sent",tone:"warn"},
  reminded:{label:"Reminder sent",tone:"warn"},
  trial_booked:{label:"Trial booked",tone:"good"},
  booking_sent:{label:"Asked to book place",tone:"warn"},
  questions_sent:{label:"Questions email sent",tone:"warn"},
  waitlist:{label:"Waiting list",tone:"none"},
  joined:{label:"Joined",tone:"good"},
  lost:{label:"Didn't join",tone:"bad"},
  no_response:{label:"No response",tone:"bad"}
};
EQ.OPEN=["enquiry","invited","reminded","trial_booked","booking_sent","questions_sent"];
EQ.isOpen=r=>EQ.OPEN.includes(r.stage);
const lastEmail=(r,type)=>{const e=(r.emails||[]).filter(x=>x.type===type).pop();return e?e.at.slice(0,10):null};
/* What needs doing next, and when. {text, due, buttons:[{act,label,primary}]} */
EQ.next=function(r,s,today){
  today=today||iso(new Date());
  const B=(act,label,primary)=>({act,label,primary:!!primary});
  switch(r.stage){
    case"enquiry":return{text:"Send the trial invite",due:r.createdAt.slice(0,10),buttons:[B("invite","Send trial invite",1),B("trialBooked","Trial booked"),B("close","Close")]};
    case"invited":{const due=EQ.addDays(lastEmail(r,"invite")||r.createdAt,s.reminderDays);
      return{text:"Not booked a trial yet? Send a reminder",due,buttons:[B("reminder","Send reminder",today>=due),B("trialBooked","Trial booked",today<due),B("close","Close")]}}
    case"reminded":{const due=EQ.addDays(lastEmail(r,"reminder")||r.updatedAt,s.noReplyCloseDays);
      return{text:"Still no trial booked: call, or close as no response",due,buttons:[B("trialBooked","Trial booked",1),B("noResponse","Close: no response"),B("reminder","Send again")]}}
    case"trial_booked":{const due=r.trialDate||today;
      return{text:r.trialDate&&r.trialDate>today?`Trial on ${EQ.fmt(r.trialDate)}${r.trialClass?" ("+r.trialClass+")":""}`:"Trial done: ask them to book their place within 24 hours",
        due,buttons:[B("booking","Send book-your-place email",today>=due),B("joined","Booked a place"),B("noShow","Didn't attend"),B("trialBooked","Change trial date")]}}
    case"booking_sent":{const due=EQ.addDays(lastEmail(r,"booking")||r.updatedAt,s.questionsDays);
      return{text:"Place not booked yet? Send the any-questions email",due,buttons:[B("joined","Booked a place",today<due),B("questions","Send questions email",today>=due),B("close","Close")]}}
    case"questions_sent":{const due=EQ.addDays(lastEmail(r,"questions")||r.updatedAt,s.lostCloseDays);
      return{text:"Last chance: call them, or close as didn't join",due,buttons:[B("joined","Booked a place",1),B("lost","Close: didn't join")]}}
    default:return null;
  }
};
/* All open actions, soonest first. */
EQ.actions=function(recs,s,today){
  today=today||iso(new Date());
  return recs.filter(EQ.isOpen).map(r=>{const n=EQ.next(r,s,today);return n&&{r,...n,overdue:n.due<today,dueNow:n.due<=today}}).filter(Boolean)
    .sort((a,b)=>a.due.localeCompare(b.due));
};

/* ---------- emails ---------- */
EQ.TEMPLATES={
  invite:{label:"1. Trial invite",subject:"Your trial session at SAADI Gymnastics",heading:"Come and try gymnastics at SAADI!",
    body:"Hi {parentName},\n\nThank you for asking about gymnastics for {childName}. Great news: we have space in the classes below. Click a class to book {childName}'s trial session.\n\n{classes}\n\nAt the trial, {childName} will join the class with our coaches, so you can both see how it feels. Please wear comfortable clothes (shorts or leggings and a t-shirt), tie long hair back, take off any jewellery and bring a water bottle.\n\nIf you have any questions, just reply to this email."},
  reminder:{label:"2. Trial reminder",subject:"Still keen to try gymnastics, {childName}?",heading:"There's still space for {childName}",
    body:"Hi {parentName},\n\nWe sent you the link to book a trial for {childName} a few days ago, and we didn't want you to miss out. Classes do fill up, so here are the classes with space again:\n\n{classes}\n\nIf the days or times don't suit you, just reply and tell us what would work. We'll do our best to find the right class."},
  booking:{label:"3. Book your place (24 hours)",subject:"Book {childName}'s place at SAADI",heading:"We loved meeting {childName}!",
    body:"Hi {parentName},\n\nThank you for bringing {childName} to the trial session{trialClassText}. We'd love {childName} to join us.\n\nWe're holding {childName}'s place for the next 24 hours. Please book it before {holdUntil} so it doesn't go to the next child on our list.\n\n{bookButton}\n\nIf you have any questions about the class, just reply to this email."},
  questions:{label:"4. Any questions?",subject:"Any questions about {childName}'s class?",heading:"Can we help with anything?",
    body:"Hi {parentName},\n\nWe noticed {childName}'s place hasn't been booked yet, so we wanted to check in. Is there anything we can help with? We're happy to answer questions about the class, the coaches, the day and time, or anything else.\n\nIf you'd like the place, you can still book it here while there's space:\n\n{bookButton}\n\nJust reply to this email and a member of our team will get back to you."},
  noshow:{label:"Missed trial: rebook",subject:"Sorry we missed {childName} at the trial",heading:"Let's find another time",
    body:"Hi {parentName},\n\nWe were sorry not to see {childName} at the trial session. These things happen! If you'd still like to try gymnastics, you can book another trial here:\n\n{classes}\n\nOr just reply and tell us which day suits you best."}
};
EQ.template=(type,s)=>Object.assign({},EQ.TEMPLATES[type],(s.templates||{})[type]||{});
const escH=x=>String(x==null?"":x).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
EQ.linkFor=(c,s)=>(c&&c.link)||(c&&s.groupLinks&&s.groupLinks[c.group])||s.trialLink||"";
function btn(href,label){
  if(!href)return `<p style="margin:16px 0;font-weight:700">${escH(label)}: please reply to this email and we'll book it for you.</p>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0"><tr><td style="border-radius:999px;background:#d4066a"><a href="${escH(href)}" style="display:inline-block;padding:13px 26px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:999px">${escH(label)}</a></td></tr></table>`;
}
function classCards(r,s){
  const cs=(r.classes||[]);
  if(!cs.length)return btn(s.trialLink,"Book a trial");
  return cs.map(c=>{const col=EQ.BAND_COLOURS[c.band]||"#f20779";const href=EQ.linkFor(c,s);
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;border:1px solid #eadfe7;border-left:6px solid ${col};border-radius:10px"><tr><td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif">
      <div style="font-size:17px;font-weight:700;color:#1d1a1f">${escH(EQ.classWhen(c))}</div>
      <div style="font-size:15px;color:#4a444e;margin:2px 0 10px">${escH(EQ.classTitle(c))}${c.term?` · ${escH(c.term)}`:""}</div>
      ${href?`<a href="${escH(href)}" style="display:inline-block;padding:9px 18px;background:#d4066a;color:#ffffff;font-weight:700;font-size:14px;text-decoration:none;border-radius:999px">Book this trial</a>`:`<span style="font-size:14px;font-weight:700;color:#d4066a">Reply to this email to book this trial</span>`}
    </td></tr></table>`}).join("");
}
EQ.fill=(t,r,s,extra)=>{
  const holdUntil=EQ.fmt(EQ.addDays(r.bookingFrom||iso(new Date()),1),{weekday:"long",day:"numeric",month:"long"});
  const v=Object.assign({parentName:r.parentName||"there",childName:r.childName||"your child",trialClassText:r.trialClass?` (${r.trialClass})`:"",holdUntil,
    trialDate:r.trialDate?EQ.fmt(r.trialDate,{weekday:"long",day:"numeric",month:"long"}):""},extra||{});
  return String(t).replace(/\{(\w+)\}/g,(m,k)=>k in v?v[k]:m);
};
/* Build an email: {subject, html, text} */
EQ.email=function(type,r,s){
  const t=EQ.template(type,s);
  const subject=EQ.fill(t.subject,r,s);
  const joinLink=r.joinLink||((r.classes||[])[0]||{}).link||s.joinLink||s.trialLink||"";
  const blocks={classes:"\u0000classes\u0000",bookButton:"\u0000book\u0000"};
  const bodyTxt=EQ.fill(t.body,r,s,blocks);
  const paras=bodyTxt.split(/\n{2,}/).map(p=>{
    if(p.trim()==="\u0000classes\u0000")return classCards(r,s);
    if(p.trim()==="\u0000book\u0000")return btn(joinLink,"Book "+(r.childName?r.childName+"'s":"the")+" place");
    return `<p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#1d1a1f">${escH(p).replace(/\n/g,"<br>")}</p>`;
  }).join("");
  const html=EQ.shell(subject,EQ.fill(t.heading,r,s),paras,s);
  const text=bodyTxt.replace("\u0000classes\u0000",(r.classes||[]).map(c=>`- ${EQ.classWhen(c)}: ${EQ.classTitle(c)} ${EQ.linkFor(c,s)}`).join("\n"))
    .replace("\u0000book\u0000",joinLink||"(reply to this email to book)")+`\n\nBest wishes,\n${s.signOff}`;
  return{subject,html,text};
};
/* Which stage an email moves a record to. */
EQ.AFTER={invite:"invited",reminder:"reminded",booking:"booking_sent",questions:"questions_sent",noshow:"invited"};

/* ---------- results ---------- */
EQ.stats=function(recs,from,to){
  const inR=d=>d&&(!from||d.slice(0,10)>=from)&&(!to||d.slice(0,10)<=to);
  const rs=recs.filter(r=>inR(r.createdAt));
  const invited=rs.filter(r=>(r.emails||[]).some(e=>e.type==="invite")||r.imported||r.trialDate||!["enquiry","waitlist"].includes(r.stage));
  const trials=rs.filter(r=>r.trialDate);
  const joined=rs.filter(r=>r.stage==="joined");
  const closed=rs.filter(r=>["joined","lost","no_response"].includes(r.stage));
  const days=joined.filter(r=>r.joinedAt).map(r=>EQ.daysBetween(r.createdAt,r.joinedAt));
  return{enquiries:rs.length,invited:invited.length,trials:trials.length,joined:joined.length,
    open:rs.filter(EQ.isOpen).length,lost:closed.length-joined.length,
    trialRate:invited.length?trials.length/invited.length:NaN,
    joinRate:trials.length?joined.filter(r=>r.trialDate).length/trials.length:NaN,
    overall:rs.length?joined.length/rs.length:NaN,
    avgDays:days.length?Math.round(days.reduce((a,b)=>a+b,0)/days.length):NaN,
    emails:recs.reduce((n,r)=>n+(r.emails||[]).filter(e=>inR(e.at)).length,0)};
};
EQ.byMonth=function(recs,n,today){
  const t=atNoon(today||new Date());const out=[];
  for(let i=n-1;i>=0;i--){const d=new Date(t.getFullYear(),t.getMonth()-i,1);const k=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
    const rs=recs.filter(r=>r.createdAt.slice(0,7)===k);
    out.push({k,label:d.toLocaleDateString("en-GB",{month:"short"}),enquiries:rs.length,trials:rs.filter(r=>r.trialDate).length,joined:rs.filter(r=>r.stage==="joined").length})}
  return out;
};
EQ.byKey=function(recs,keyFn){
  const m={};recs.forEach(r=>{const k=keyFn(r)||"Not recorded";(m[k]=m[k]||{k,n:0,trials:0,joined:0});m[k].n++;if(r.trialDate)m[k].trials++;if(r.stage==="joined")m[k].joined++});
  return Object.values(m).sort((a,b)=>b.n-a.n);
};

/* ---------- importing people already on trials ----------
   One per line, commas or tabs: Child, Age, Parent, Email, Phone, Trial date (dd/mm/yyyy), Class, Stage */
EQ.parseDate=s=>{s=String(s||"").trim();let m=s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);if(m){let y=+m[3];if(y<100)y+=2000;return `${y}-${String(m[2]).padStart(2,"0")}-${String(m[1]).padStart(2,"0")}`}
  m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(m)return m[0];
  const d=new Date(s);return isNaN(d)?"":iso(d)};
EQ.parseImport=function(text){
  const out=[],bad=[];
  String(text||"").split(/\r?\n/).map(l=>l.trim()).filter(Boolean).forEach(l=>{
    const f=l.split(/\t|,/).map(x=>x.trim());
    if(/^child/i.test(f[0]))return; // header row
    const email=f.find(x=>/@/.test(x))||"";
    if(!f[0]||!email){bad.push(l);return}
    const st=(f[7]||"").toLowerCase();
    out.push({childName:f[0],age:f[1]&&/^\d+$/.test(f[1])?+f[1]:"",parentName:f[2]||"",email,phone:f[4]||"",trialDate:EQ.parseDate(f[5]),trialClass:f[6]||"",
      stage:/join/.test(st)?"joined":/invite|sent/.test(st)?"invited":/ask|book.*place|24/.test(st)?"booking_sent":"trial_booked"});
  });
  return{rows:out,bad};
};

/* The SAADI email frame (pink header, logo, sign-off, footer) around some content. */
EQ.shell=function(subject,heading,paras,s,footNote){
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escH(subject)}</title></head>
<body style="margin:0;padding:0;background:#f6f4f6">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f4f6"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden">
<tr><td style="background:#f20779;padding:22px 28px" align="left"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="padding-right:16px"><img src="${escH(s.logoUrl)}" width="72" alt="SAADI Gymnastics" style="display:block;width:72px;height:auto;border:0"></td>
<td style="font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:1.2;font-weight:700;color:#ffffff">${escH(heading)}</td></tr></table></td></tr>
<tr><td style="padding:28px">${paras}
<p style="margin:22px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#1d1a1f">Best wishes,<br><b>${escH(s.signOff)}</b></p></td></tr>
<tr><td style="background:#f0eaef;padding:16px 28px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.5;color:#6b6470">SAADI Gymnastics · <a href="mailto:${escH(s.replyTo)}" style="color:#d4066a">${escH(s.replyTo)}</a><br>${escH(footNote||"You're receiving this because you asked us about gymnastics classes. Reply STOP and we won't email you again about this enquiry.")}</td></tr>
</table></td></tr></table></body></html>`;
};
const paraHtml=p=>`<p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#1d1a1f">${escH(p).replace(/\n/g,"<br>")}</p>`;

/* ---------- term renewal reminder ---------- */
EQ.RENEWAL={subject:"Book {childNames}'s {place} for {nextTerm}",heading:"Time to book {nextTermShort}!",
  body:"Hi {parentName},\n\nWe've loved having {childNames} with us this term. {nextTerm} starts on {startDate} and booking is now open, so here's how to book {childNames}'s {place}:\n\n{classes}\n\nPlaces aren't kept automatically from one term to the next, so please book soon to keep {childNames}'s {spot}. If you've already booked, thank you, and please ignore this email.\n\n{otherOptions}\n\nIf you have any other questions, just reply to this email."};
const joinNames=a=>a.length<2?(a[0]||"your child"):a.slice(0,-1).join(", ")+" and "+a[a.length-1];
/* family = {parentName, email, kids:[{first, cur:{day,start,name}, next:{day,start,end,name,term,link,colour}|null}]} */
EQ.renewalEmail=function(family,s,tpl,term){
  const t=Object.assign({},EQ.RENEWAL,tpl||{});
  const names=family.kids.map(k=>k.first||"your child");
  const vals={parentName:family.parentName||"there",childNames:joinNames(names),nextTerm:term.name,nextTermShort:term.short||term.name,startDate:term.startText||"",place:names.length>1?"places":"place",spot:names.length>1?"spots":"spot"};
  const fill=x=>String(x).replace(/\{(\w+)\}/g,(m,k)=>k in vals?vals[k]:m);
  const subject=fill(t.subject);
  const cards=family.kids.map(k=>{const n=k.next,col=EQ.BAND_COLOURS[(n&&n.colour)||""]||"#f20779";
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;border:1px solid #eadfe7;border-left:6px solid ${col};border-radius:10px"><tr><td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif">
      <div style="font-size:17px;font-weight:700;color:#1d1a1f">${escH(k.first||"Your child")}${n?`: ${escH(EQ.DAYNAME[n.day]||n.day)} ${escH(EQ.prettyTime(n.start+(n.end?" - "+n.end:"")))}`:""}</div>
      <div style="font-size:15px;color:#4a444e;margin:2px 0 10px">${n?escH(String(n.name).split("|")[0].trim())+" · "+escH(n.term):"Reply to this email and we'll help you choose the right class."}</div>
      ${n&&n.link?`<a href="${escH(n.link)}" style="display:inline-block;padding:9px 18px;background:#d4066a;color:#ffffff;font-weight:700;font-size:14px;text-decoration:none;border-radius:999px">Book ${escH(k.first||"")}'s place</a>`:""}
    </td></tr></table>`}).join("");
  // Not coming back, or want a different class? Two ready-written emails to reception, with the children and classes filled in.
  const who=family.kids.map(k=>`${k.first||""} ${k.last||""}`.trim()).join(" and ")||"my child";
  const curTxt=family.kids.map(k=>k.cur?`${k.first}: ${EQ.DAYNAME[k.cur.day]||k.cur.day} ${EQ.prettyTime(k.cur.start+(k.cur.end?" - "+k.cur.end:""))} ${String(k.cur.name).split("|")[0].trim()}`:"").filter(Boolean).join("\n");
  const mail=(subj,lines)=>`mailto:${s.replyTo}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(lines.join("\n"))}`;
  const leave=mail(`Not continuing in ${term.short||term.name}: ${who}`,[`Hi SAADI team,`,``,`${who} won't be continuing in ${term.name}.`,``,`This term: `+curTxt.replace(/\n/g,"; "),``,`Reason (optional): `,``,`Thank you`]);
  const change=mail(`Change of class for ${term.short||term.name}: ${who}`,[`Hi SAADI team,`,``,`We'd like ${who} to move to a different class in ${term.name}.`,``,`This term: `+curTxt.replace(/\n/g,"; "),``,`Days and times that would suit us: `,``,`Thank you`]);
  const ob=(href,label)=>`<a href="${escH(href)}" style="display:inline-block;margin:4px 8px 4px 0;padding:8px 16px;border:2px solid #d4066a;color:#d4066a;font-weight:700;font-size:14px;text-decoration:none;border-radius:999px;font-family:Arial,Helvetica,sans-serif">${escH(label)}</a>`;
  const options=`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 16px;background:#f6f4f6;border-radius:10px"><tr><td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif">
    <div style="font-size:15px;font-weight:700;color:#1d1a1f;margin-bottom:6px">Not coming back, or want a different class?</div>
    <div style="font-size:14px;color:#4a444e;margin-bottom:8px">Tap a button and send the email it opens, so we can find a better day and time or offer the place to someone else.</div>
    ${ob(change,"I'd like a different class")}${ob(leave,"We won't be continuing")}</td></tr></table>`;
  let body=fill(t.body);
  if(!/\{otherOptions\}/.test(body))body=body.replace("{classes}","{classes}\n\n{otherOptions}");
  const paras=body.split(/\n{2,}/).map(p=>p.trim()==="{classes}"?cards:p.trim()==="{otherOptions}"?options:paraHtml(p)).join("");
  const text=body.replace("{otherOptions}",`Want a different class? Email ${s.replyTo} with the days and times that suit you.\nNot continuing? Please let us know at ${s.replyTo} so we can offer the place to someone else.`).replace("{classes}",family.kids.map(k=>`- ${k.first}: ${k.next?(EQ.DAYNAME[k.next.day]||k.next.day)+" "+EQ.prettyTime(k.next.start+(k.next.end?" - "+k.next.end:""))+" "+String(k.next.name).split("|")[0].trim()+" "+(k.next.link||""):"reply to choose a class"}`).join("\n"))+`\n\nBest wishes,\n${s.signOff}`;
  return{subject,html:EQ.shell(subject,fill(t.heading),paras,s,"You're receiving this because your child has a class at SAADI Gymnastics this term."),text};
};

/* ---------- term renewals: who has booked next term ---------- */
EQ.renewals=function(ren){
  if(!ren||!ren.cls)return null;
  const link=g=>`https://mybg.british-gymnastics.org/Workbench/i/r/Public/ClassBookingsPublic/${ren.club}/class/${g}`;
  const cls=ren.cls.map(([g,k,term,day,start,end,name,colour,age],i)=>({i,g,kind:k,term,day,start,end,name,colour:colour||(String(name).match(/\b(orange|yellow|blue|red|green|purple)\b/i)||[])[1]||"",age,link:link(g)}));
  cls.forEach(c=>{c.colour=c.colour?c.colour[0].toUpperCase()+c.colour.slice(1).toLowerCase():"";c.area=/novice/i.test(c.term+" "+c.name)?"Novice":/pre\s*-?\s*school/i.test(c.term)?"Pre-School":"Recreational"});
  const nextOf={};ren.rows.forEach(([i,id,f])=>{const c=cls[i];if(c&&c.kind==="n"&&f!=="T")(nextOf[id]=nextOf[id]||[]).push(c)});
  const norm=t=>String(t||"").replace(/\s+/g,"").toUpperCase();
  const nextCls=cls.filter(c=>c.kind==="n");
  const matchNext=c=>nextCls.find(n=>n.day===c.day&&norm(n.start)===norm(c.start)&&n.colour&&n.colour===c.colour&&n.area===c.area)
    ||nextCls.find(n=>n.day===c.day&&norm(n.start)===norm(c.start)&&n.area===c.area)||null;
  const per=cls.filter(c=>c.kind==="c").map(c=>({...c,kids:[],payg:0,trial:0}));
  const byIdx={};per.forEach(c=>byIdx[c.i]=c);
  const kidsCur={};
  ren.rows.forEach(([i,id,f])=>{const c=byIdx[i];if(!c)return;if(f==="T"){c.trial++;return}if(f==="P"){c.payg++;return}
    const k=ren.kids[id]||[];const renewedTo=nextOf[id]||[];
    const kid={id,first:k[0]||"",last:k[1]||"",parentName:k[2]||"",email:(k[3]||"").trim(),age:k[4]||"",renewed:renewedTo.length>0,nextBooked:renewedTo,cur:c,next:matchNext(c)};
    c.kids.push(kid);(kidsCur[id]=kidsCur[id]||[]).push(kid)});
  per.forEach(c=>{c.eligible=c.kids.length;c.renewed=c.kids.filter(k=>k.renewed).length;c.rate=c.eligible?c.renewed/c.eligible:NaN;c.match=matchNext(c)});
  const ids=Object.keys(kidsCur);
  const renewedIds=ids.filter(id=>kidsCur[id][0].renewed);
  // families still to renew, by parent email
  const fam={};ids.forEach(id=>{const k=kidsCur[id][0];if(k.renewed)return;const key=(k.email||"no-email:"+id).toLowerCase();
    (fam[key]=fam[key]||{key,email:k.email,parentName:k.parentName,kids:[]}).kids.push({id,first:k.first,last:k.last,age:k.age,cur:k.cur,next:k.next})});
  const areas={};per.forEach(c=>{const a=areas[c.area]=areas[c.area]||{area:c.area,eligible:0,renewed:0,classes:0};a.eligible+=c.eligible;a.renewed+=c.renewed;a.classes++});
  return{cls,per,kids:ids.length,renewed:renewedIds.length,rate:ids.length?renewedIds.length/ids.length:NaN,families:Object.values(fam),areas:Object.values(areas),
    nextBooked:ren.rows.filter(([i,,f])=>cls[i]&&cls[i].kind==="n"&&f!=="T").length,
    newToNext:Object.keys(nextOf).filter(id=>!kidsCur[id]).length,
    cur:(ren.cur||[]).map(t=>({id:t[0],name:t[1],start:t[2],end:t[3]})),next:(ren.next||[]).map(t=>({id:t[0],name:t[1],start:t[2],end:t[3]})),at:ren.at};
};

/* ---------- the Google mailer (runs in the reception@ Google account) ---------- */
EQ.newKey=()=>{const a=new Uint8Array(24);(globalThis.crypto||require("crypto").webcrypto).getRandomValues(a);return [...a].map(x=>x.toString(16).padStart(2,"0")).join("")};
EQ.mailerCode=(key,sender)=>`/**
 * SAADI Enquiry Desk mailer. Sends the desk's emails from ${sender}.
 * Set up from the desk: Emails & settings > Sending emails. Don't share this code: it contains the desk's key.
 */
var KEY = '${key}';
var SENDER = '${sender}';

function doPost(e) {
  try {
    var p = JSON.parse(e.postData.contents);
    if (p.token !== KEY) return reply({ ok: false, error: 'wrong key' });
    var me = Session.getEffectiveUser().getEmail();
    if (me.toLowerCase() !== SENDER.toLowerCase()) return reply({ ok: false, from: me, error: 'this mailer is in ' + me + "'s Google account, not " + SENDER });
    if (p.ping) return reply({ ok: true, from: me, left: MailApp.getRemainingDailyQuota() });
    if (!p.to || !/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(p.to)) return reply({ ok: false, error: 'email address missing or not valid' });
    if (!p.subject || !p.html) return reply({ ok: false, error: 'nothing to send' });
    GmailApp.sendEmail(p.to, p.subject, p.text || '', { htmlBody: p.html, name: p.fromName || 'SAADI Gymnastics', replyTo: SENDER });
    return reply({ ok: true, from: me, left: MailApp.getRemainingDailyQuota() });
  } catch (err) {
    return reply({ ok: false, error: String(err.message || err) });
  }
}

function doGet() { return reply({ ok: true, service: 'SAADI Enquiry Desk mailer' }); }

/** Press Run on this once after pasting, so Google asks for permission to send email. */
function allowSending() { Logger.log('Ready to send as ' + Session.getEffectiveUser().getEmail() + '. ' + MailApp.getRemainingDailyQuota() + ' emails left today.'); }

function reply(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
`;

root.EQ=EQ;
if(typeof module!=="undefined")module.exports=EQ;
})(typeof window!=="undefined"?window:globalThis);
