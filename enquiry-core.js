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
  if(/AGED\s*3\b/.test(n))ys.push(-2);
  if(/AGED\s*4\b|AGED\s*3\s*(?:AND|&|-)\s*4/.test(n))ys.push(-1);
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
  return a<=0?`${EQ.yearLabel(a)}–${EQ.yearLabel(b)}`:`Years ${a}–${b}`};
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
    const ys=/\bAGED\b/i.test(String(c.name||"").split("|")[0])?[]:EQ.classYears(c);let ok,why;
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
/* Class change request Google Forms (answers go to the "Spring Term 2027" renewal sheet: Recreational and Preschool tabs). */
EQ.CLASS_CHANGE_FORM={rec:"https://forms.gle/ibxk1iTyKUDLT5hn9",pre:"https://forms.gle/mMHFTJc5L4aUSKZC8"};
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
  // Class changes go to the Google Form (its answers land in the renewal spreadsheet): Pre-School children use the Pre-School form.
  const isPre=k=>/pre\s*-?\s*school/i.test((k.cur&&k.cur.area)||"");
  const hasPre=family.kids.some(isPre),hasRec=family.kids.some(k=>!isPre(k));
  const changeLinks=[];
  if(hasRec)changeLinks.push([EQ.CLASS_CHANGE_FORM.rec,hasPre?"Different class (Recreational)":"I'd like a different class"]);
  if(hasPre)changeLinks.push([EQ.CLASS_CHANGE_FORM.pre,hasRec?"Different class (Pre-School)":"I'd like a different class"]);
  const ob=(href,label)=>`<a href="${escH(href)}" style="display:inline-block;margin:4px 8px 4px 0;padding:8px 16px;border:2px solid #d4066a;color:#d4066a;font-weight:700;font-size:14px;text-decoration:none;border-radius:999px;font-family:Arial,Helvetica,sans-serif">${escH(label)}</a>`;
  const options=`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 16px;background:#f6f4f6;border-radius:10px"><tr><td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif">
    <div style="font-size:15px;font-weight:700;color:#1d1a1f;margin-bottom:6px">Not coming back, or want a different class?</div>
    <div style="font-size:14px;color:#4a444e;margin-bottom:8px">Fill in the short class change form, or tap "We won't be continuing" and send the email it opens, so we can find a better day and time or offer the place to someone else.</div>
    ${changeLinks.map(([h,l])=>ob(h,l)).join("")}${ob(leave,"We won't be continuing")}</td></tr></table>`;
  let body=fill(t.body);
  if(!/\{otherOptions\}/.test(body))body=body.replace("{classes}","{classes}\n\n{otherOptions}");
  const paras=body.split(/\n{2,}/).map(p=>p.trim()==="{classes}"?cards:p.trim()==="{otherOptions}"?options:paraHtml(p)).join("");
  const text=body.replace("{otherOptions}",`Want a different class? Fill in our class change form: ${changeLinks.map(([h])=>h).join(" ")}\nNot continuing? Please let us know at ${s.replyTo} so we can offer the place to someone else.`).replace("{classes}",family.kids.map(k=>`- ${k.first}: ${k.next?(EQ.DAYNAME[k.next.day]||k.next.day)+" "+EQ.prettyTime(k.next.start+(k.next.end?" - "+k.next.end:""))+" "+String(k.next.name).split("|")[0].trim()+" "+(k.next.link||""):"reply to choose a class"}`).join("\n"))+`\n\nBest wishes,\n${s.signOff}`;
  return{subject,html:EQ.shell(subject,fill(t.heading),paras,s,"You're receiving this because your child has a class at SAADI Gymnastics this term."),text};
};

/* A child's school year(s): the years their current class covers, narrowed by their age where JustGo gives it. */
EQ.kidYears=k=>{const cy=(k.cur&&k.cur.years)||[];const age=parseInt(String(k.age||""),10);
  const ay=isFinite(age)&&age>0&&age<19?EQ.yearsForAge(age):[];
  const both=cy.filter(y=>ay.includes(y));return both.length?both:cy.length?cy:ay};
/* ---------- term renewals: who has booked next term ---------- */
EQ.renewals=function(ren){
  if(!ren||!ren.cls)return null;
  const link=g=>`https://mybg.british-gymnastics.org/Workbench/i/r/Public/ClassBookingsPublic/${ren.club}/class/${g}`;
  const cls=ren.cls.map(([g,k,term,day,start,end,name,colour,age,cap,booked],i)=>({i,g,kind:k,term,day,start,end,name,cap:+cap||0,booked:+booked||0,colour:colour||(String(name).match(/\b(orange|yellow|blue|red|green|purple)\b/i)||[])[1]||"",age,link:link(g)}));
  cls.forEach(c=>{c.years=EQ.classYears(c);c.colour=c.colour?c.colour[0].toUpperCase()+c.colour.slice(1).toLowerCase():"";c.area=/play\s*gym|parent\s*(?:and|&|\+)\s*child|toddler/i.test(c.term+" "+c.name)?"Play Gym":/novice/i.test(c.term+" "+c.name)?"Novice":/pre\s*-?\s*school/i.test(c.term)?"Pre-School":"Recreational"});
  const nextOf={};ren.rows.forEach(([i,id,f])=>{const c=cls[i];if(c&&c.kind==="n"&&f!=="T")(nextOf[id]=nextOf[id]||[]).push(c)});
  const norm=t=>String(t||"").replace(/\s+/g,"").toUpperCase();
  const nextCls=cls.filter(c=>c.kind==="n");
  // Same day and time, for the same school years (colours mean different year groups in different classes).
  const yearsFit=(n,ys)=>!ys.length||!n.years.length||n.years.some(y=>ys.includes(y));
  const matchNext=(c,ys)=>{ys=ys||c.years;const same=nextCls.filter(n=>n.day===c.day&&norm(n.start)===norm(c.start)&&n.area===c.area);
    return same.find(n=>ys.length&&n.years.length&&yearsFit(n,ys)&&n.colour===c.colour)||same.find(n=>ys.length&&n.years.length&&yearsFit(n,ys))||(ys.length?null:same.find(n=>n.colour===c.colour)||same[0])||null};
  const per=cls.filter(c=>c.kind==="c").map(c=>({...c,kids:[],payg:0,trial:0}));
  const byIdx={};per.forEach(c=>byIdx[c.i]=c);
  const kidsCur={};
  ren.rows.forEach(([i,id,f])=>{const c=byIdx[i];if(!c)return;if(f==="T"){c.trial++;return}if(f==="P"){c.payg++;return}
    const k=ren.kids[id]||[];const renewedTo=nextOf[id]||[];
    const kid={id,first:k[0]||"",last:k[1]||"",parentName:k[2]||"",email:(k[3]||"").trim(),age:k[4]||"",phone:String(k[5]||"").trim(),renewed:renewedTo.length>0,nextBooked:renewedTo,cur:c};
    kid.years=EQ.kidYears(kid);kid.next=matchNext(c,kid.years);
    c.kids.push(kid);(kidsCur[id]=kidsCur[id]||[]).push(kid)});
  EQ._yearsFit=yearsFit;
  per.forEach(c=>{c.eligible=c.kids.length;c.renewed=c.kids.filter(k=>k.renewed).length;c.rate=c.eligible?c.renewed/c.eligible:NaN;c.match=matchNext(c)});
  const ids=Object.keys(kidsCur);
  const renewedIds=ids.filter(id=>kidsCur[id][0].renewed);
  // families still to renew, by parent email
  const fam={};ids.forEach(id=>{const k=kidsCur[id][0];if(k.renewed)return;const key=(k.email||"no-email:"+id).toLowerCase();
    const fm=(fam[key]=fam[key]||{key,email:k.email,parentName:k.parentName,phone:k.phone,kids:[]});if(!fm.phone&&k.phone)fm.phone=k.phone;
    fm.kids.push({id,first:k.first,last:k.last,age:k.age,years:k.years,cur:k.cur,next:k.next})});
  const areas={};per.forEach(c=>{const a=areas[c.area]=areas[c.area]||{area:c.area,eligible:0,renewed:0,classes:0};a.eligible+=c.eligible;a.renewed+=c.renewed;a.classes++});
  return{cls,per,kids:ids.length,renewed:renewedIds.length,rate:ids.length?renewedIds.length/ids.length:NaN,families:Object.values(fam),areas:Object.values(areas),
    nextBooked:ren.rows.filter(([i,,f])=>cls[i]&&cls[i].kind==="n"&&f!=="T").length,
    newToNext:Object.keys(nextOf).filter(id=>!kidsCur[id]).length,
    cur:(ren.cur||[]).map(t=>({id:t[0],name:t[1],start:t[2],end:t[3]})),next:(ren.next||[]).map(t=>({id:t[0],name:t[1],start:t[2],end:t[3]})),at:ren.at};
};

/* ---------- renewal form responses (Google Sheet: class change tabs + "Non Renewal" tab) ---------- */
const DAYFULL={monday:"Mon",tuesday:"Tue",wednesday:"Wed",thursday:"Thu",friday:"Fri",saturday:"Sat",sunday:"Sun",mon:"Mon",tue:"Tue",tues:"Tue",wed:"Wed",weds:"Wed",thu:"Thu",thur:"Thu",thurs:"Thu",fri:"Fri",sat:"Sat",sun:"Sun"};
EQ.dayCode=d=>DAYFULL[String(d||"").trim().toLowerCase()]||"";
/* "5 - 6pm, 9:45 - 10:45am, 11:45am - 12:45pm" -> start times in minutes */
EQ.parseTimes=str=>String(str||"").split(/[,;\/]|\band\b/i).map(x=>x.trim()).filter(Boolean).map(x=>{
  const m=x.match(/(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s*(?:-|–|to)\s*(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/i);
  if(!m){const one=x.match(/(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)/i);if(!one)return null;let h=+one[1]%12;if(/pm/i.test(one[3]))h+=12;return h*60+(+one[2]||0)}
  const ap2=(m[6]||m[3]||"").toLowerCase();let eh=+m[4]%12;if(ap2==="pm")eh+=12;const end=eh*60+(+m[5]||0);
  let sh=+m[1]%12;const ap1=(m[3]||ap2).toLowerCase();if(ap1==="pm")sh+=12;let st=sh*60+(+m[2]||0);
  if(!m[3]&&st>end)st-=12*60;return st}).filter(x=>x!=null);
const norm=s=>String(s||"").toLowerCase().replace(/[^a-z]/g,"");
const firstName=s=>norm(String(s||"").trim().split(/\s+/)[0]);
EQ.parseResponses=function(tabs){
  const changes=[],leavers=[];
  for(const name in (tabs||{})){
    const rows=tabs[name]||[];if(rows.length<2)continue;
    const H=rows[0].map(h=>String(h||"").replace(/\s+/g," ").trim());
    const col=re=>H.findIndex(h=>re.test(h));
    const cols=re=>H.map((h,i)=>re.test(h)?i:-1).filter(i=>i>=0);
    const emailC=col(/email/i);
    if(/non\s*-?\s*renew|leav/i.test(name)||col(/reason.*leaving/i)>=0){
      const childC=col(/^child/i),reasonC=col(/reason/i),rateC=col(/rate|experience/i),recC=col(/recommend/i),sugC=col(/differently|improve|suggest/i);
      rows.slice(1).forEach(r=>{const email=String(r[emailC]||"").trim();if(!email)return;
        leavers.push({at:r[0],email,child:String(r[childC]||"").trim(),reason:String(r[reasonC]||"").trim(),rating:r[rateC]||"",recommend:r[recC]||"",suggestion:String(r[sugC]||"").trim(),tab:name})});
      continue;
    }
    const nameCs=cols(/child'?s name/i);if(!nameCs.length)continue;
    const area=/email/i.test(name)?"":/pre\s*-?\s*school/i.test(name)?"Pre-School":"Recreational";
    const ordinal=["","2nd","3rd","4th"];
    const dayCs=cols(/new class day/i),timeCs=cols(/new class time/i),noteC=col(/additional|logistical|request(s)?$/i);
    rows.slice(1).forEach(r=>{
      const email=String(r[emailC]||"").trim();if(!email)return;
      const kids=nameCs.map((c,i)=>{const nm=String(r[c]||"").trim();if(!nm)return null;
        const tag=ordinal[i]?`\\(${ordinal[i]} child\\)`:"";
        const find=what=>{const re=new RegExp(`current class ${what}${tag?"\\s*"+tag:"(?!.*child\\))"}`,"i");const cs=cols(re);for(const k of cs){if(String(r[k]||"").trim())return String(r[k]).trim()}return""};
        return{name:nm,day:find("day"),time:find("time"),colour:find("(group )?colou?r")}}).filter(Boolean);
      const reqDays=[...new Set(dayCs.map(c=>String(r[c]||"")).join(",").split(/[,;]/).map(EQ.dayCode).filter(Boolean))];
      const reqTimes=[...new Set(timeCs.flatMap(c=>EQ.parseTimes(r[c])))];
      changes.push({at:r[0],email,area,tab:name,kids,reqDays,reqTimes,reqText:[dayCs.map(c=>r[c]).filter(Boolean).join(", "),timeCs.map(c=>r[c]).filter(Boolean).join(", ")].filter(Boolean).join(" · "),notes:noteC>=0?String(r[noteC]||"").trim():""});
    });
  }
  return{changes,leavers};
};
/* Join the form responses to the JustGo renewals: who is leaving, who wants a different class, who hasn't answered,
   and for each class change the Spring classes that fit, with how many places are free now.
   closeDate: after it, places held for children who haven't renewed are released. */
EQ.renewalStatus=function(R,resp,manual,closeDate,today){
  today=today||new Date().toISOString().slice(0,10);
  const open=closeDate&&today>closeDate;
  const allKids=[];R.per.forEach(c=>c.kids.forEach(k=>allKids.push(k)));
  const findKid=(email,name)=>{const e=String(email||"").toLowerCase().trim(),fn=firstName(name),full=norm(name);
    return allKids.find(k=>k.email.toLowerCase()===e&&firstName(k.first)===fn)||allKids.find(k=>norm(k.first+k.last)===full&&full)||allKids.find(k=>k.email.toLowerCase()===e&&fn&&norm(k.first).startsWith(fn.slice(0,4)))||null};
  const status={};// kid id -> {s:"renewed"|"leaving"|"changing"|"none", src}
  allKids.forEach(k=>{status[k.id]={s:k.renewed?"renewed":"none"}});
  (resp.leavers||[]).forEach(l=>{const k=findKid(l.email,l.child);l.kid=k;
    const ks=k?[k]:allKids.filter(x=>x.email.toLowerCase()===l.email.toLowerCase());
    ks.forEach(x=>{if(status[x.id].s!=="renewed")status[x.id]={s:"leaving",src:l}})});
  (resp.changes||[]).forEach(c=>{c.kids.forEach(ck=>{const k=findKid(c.email,ck.name);ck.kid=k;if(k&&status[k.id].s==="none")status[k.id]={s:"changing",src:c}})});
  // reception's own marks for families who replied by email
  R.families.forEach(f=>{const m=(manual||{})[f.key];if(!m||!m.status)return;f.kids.forEach(k=>{if(status[k.id].s==="none")status[k.id]={s:m.status,src:"manual"}})});
  // places: Spring classes, less children still expected to renew into them (until the renewal period closes)
  const nextCls=R.cls.filter(c=>c.kind==="n");
  const pending={};allKids.forEach(k=>{if(status[k.id].s==="none"&&k.next)pending[k.next.g]=(pending[k.next.g]||0)+1});
  const placeInfo=n=>{const cap=n.cap||0,booked=n.booked||0,held=open?0:(pending[n.g]||0);return{cap,booked,held,free:Math.max(0,cap-booked-held),freeAfter:Math.max(0,cap-booked)}};
  // Families often ask twice (an email reply and then the form). The newest request for a child replaces older ones,
  // and a child named with no days or times (e.g. in an email reply) takes the family's newest request that has them.
  const whenMs=a=>{if(a instanceof Date)return a.getTime();const m=String(a||"").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);return m?new Date(+m[3],m[1]-1,+m[2],+m[4],+m[5],+(m[6]||0)).getTime():Date.parse(a)||0};
  const chs=(resp.changes||[]).slice().sort((a,b)=>whenMs(b.at)-whenMs(a.at));const seen=new Set();
  chs.forEach(c=>{const em=String(c.email).toLowerCase().trim();
    c.kids=c.kids.filter(ck=>{const id=em+"|"+firstName(ck.name);if(seen.has(id)){ck.superseded=true;return false}seen.add(id);return true});
    if(!c.reqDays.length&&!c.reqTimes.length){const src=chs.find(o=>o!==c&&String(o.email).toLowerCase().trim()===em&&(o.reqDays.length||o.reqTimes.length));
      if(src){c.reqDays=src.reqDays;c.reqTimes=src.reqTimes;c.borrowed=src.reqText;if(!c.notes&&src.notes)c.notes=src.notes}}});
  resp.changes=(resp.changes||[]).filter(c=>c.kids.length);
  (resp.changes||[]).forEach(c=>{c.kids.forEach(ck=>{
    const ys=ck.kid?(ck.kid.years||EQ.kidYears(ck.kid)):EQ.classYears({name:`${ck.colour} ${ck.time}`});
    ck.years=ys;
    const fit=n=>!ys.length||(n.years.length>0&&n.years.some(y=>ys.includes(y)));
    const area=c.area||(ck.kid&&ck.kid.cur&&ck.kid.cur.area)||"Recreational";
    // 3. No days or times in their email: don't list every class. Show the classes for their school year (any day),
    //    or nothing if we can't tell their year either, and say so, so reception reads the email.
    ck.noRequest=!c.reqDays.length&&!c.reqTimes.length;ck.otherTime=false;ck.otherAge=false;ck.yearsKnown=ys.length>0;
    if(ck.noRequest){
      const cands=ys.length?nextCls.filter(n=>n.area===area&&fit(n)):[];
      ck.options=cands.map(n=>({n,...placeInfo(n)})).sort((a,b)=>b.free-a.free||b.freeAfter-a.freeAfter||(a.n.day>b.n.day?1:-1));
      ck.renewed=ck.kid?ck.kid.renewed:false;return;
    }
    const onDay=n=>n.area===area&&(!c.reqDays.length||c.reqDays.includes(n.day));
    const atTime=n=>!c.reqTimes.length||c.reqTimes.includes(EQ.mins(n.start));
    let cands=nextCls.filter(n=>onDay(n)&&atTime(n)&&fit(n));ck.otherTime=false;
    // Nothing for their age at that time: show classes for their age on the requested days at other times.
    if(!cands.length){cands=nextCls.filter(n=>onDay(n)&&fit(n)&&n.years.length);ck.otherTime=cands.length>0}
    // Still nothing for their year on those days: show the classes at the requested days and times anyway,
    // marked as a different age group, so reception can decide (e.g. a younger sibling asked for with an older one).
    ck.otherAge=false;
    if(!cands.length){cands=nextCls.filter(n=>onDay(n)&&atTime(n));if(!cands.length&&c.reqTimes.length)cands=nextCls.filter(onDay);ck.otherAge=cands.length>0;ck.otherTime=false}
    ck.yearsKnown=ys.length>0;
    ck.options=cands.map(n=>({n,...placeInfo(n)})).sort((a,b)=>b.free-a.free||b.freeAfter-a.freeAfter||EQ.mins(a.n.start)-EQ.mins(b.n.start));
    ck.renewed=ck.kid?ck.kid.renewed:false;
  })});
  const counts={renewed:0,leaving:0,changing:0,none:0};allKids.forEach(k=>counts[status[k.id].s]=(counts[status[k.id].s]||0)+1);
  return{status,counts,open,placeInfo};
};

/* Offer of a different class (from a class change request). */
/* o.full: the class may not have a place yet, so send the link without promising one. */
EQ.offerEmail=function(o,s,term){
  const n=o.cls,col=EQ.BAND_COLOURS[n.colour]||"#f20779",cls=String(n.name).split("|")[0].trim(),when=`${EQ.DAYNAME[n.day]||n.day} ${EQ.prettyTime(n.start+(n.end?" - "+n.end:""))}`;
  const subject=o.full?`${o.child}'s class change for ${term}: ${when}`:`A place for ${o.child} on ${when} for ${term}`;
  const card=`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;border:1px solid #eadfe7;border-left:6px solid ${col};border-radius:10px"><tr><td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif">
    <div style="font-size:17px;font-weight:700;color:#1d1a1f">${escH(o.child)}: ${escH(when)}</div><div style="font-size:15px;color:#4a444e;margin:2px 0 10px">${escH(cls)} · ${escH(n.term)}</div>
    <a href="${escH(n.link)}" style="display:inline-block;padding:9px 18px;background:#d4066a;color:#ffffff;font-weight:700;font-size:14px;text-decoration:none;border-radius:999px">Book ${escH(o.child)}'s place</a></td></tr></table>`;
  const intro=o.full?`Thank you for letting us know you'd like a different class for ${o.child}. Here's the link to the class you asked about for ${term}:`
    :`Thank you for letting us know you'd like a different class for ${o.child}. Good news: we have a space in this class for ${term}:`;
  const after=o.full?`This class is very popular. If it shows as full when you open the link, please join the waiting list on the same page and we'll let you know as soon as a place comes up. You may also want to keep ${o.child}'s current class booked in the meantime, so you don't lose a place. If you have any questions, just reply to this email.`
    :`Please book soon, as we can't hold the place for long. If it isn't right after all, just reply to this email and we'll help.`;
  const paras=[paraHtml(`Hi ${o.parentName||"there"},`),paraHtml(intro),card,paraHtml(after)].join("");
  const text=`Hi ${o.parentName||"there"},\n\n${intro}\n\n${when}: ${cls}\n${n.link}\n\n${after}\n\nBest wishes,\n${s.signOff}`;
  return{subject,html:EQ.shell(subject,o.full?`${o.child}'s class change`:`Good news for ${o.child}!`,paras,s,"You're receiving this because you asked us for a different class at SAADI Gymnastics."),text};
};

/* ---------- the Google mailer (runs in the reception@ Google account) ---------- */
EQ.newKey=()=>{const a=new Uint8Array(24);(globalThis.crypto||require("crypto").webcrypto).getRandomValues(a);return [...a].map(x=>x.toString(16).padStart(2,"0")).join("")};
EQ.MAILER_VERSION=4;
EQ.mailerCode=(key,sender)=>`/**
 * SAADI Enquiry Desk mailer (version 7). Sends the desk's emails from ${sender},
 * reads the renewal form responses for the Term Renewals page, and every 5 minutes moves families' emailed
 * "Change of class" / "Not continuing" requests into the "Renewal replies" folder and adds them to that spreadsheet.
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
    if (p.ping) return reply({ ok: true, from: me, left: MailApp.getRemainingDailyQuota(), v: 7 });
    if (p.assist) return reply(assistHandle(p, me));
    // Term Renewals: read the renewal form responses (class change / non renewal) from a spreadsheet reception can open.
    if (p.sheet) {
      var ss = SpreadsheetApp.openById(p.sheet), tabs = {}, added = 0, importError = '';
      // First copy any "Change of class" / "Not continuing" emails from reception's inbox into the sheet.
      PropertiesService.getScriptProperties().setProperty('RENEWAL_SHEET', p.sheet);
      var lock = LockService.getScriptLock();
      if (lock.tryLock(20000)) {
        try { moveRenewalEmails(); added = p.reimport ? reimportRenewalEmails(ss) : importRenewalEmails(ss); } catch (ie) { importError = String(ie.message || ie); } finally { lock.releaseLock(); }
      }
      ss.getSheets().forEach(function (sh) { tabs[sh.getName()] = sh.getDataRange().getDisplayValues(); });
      return reply({ ok: true, from: me, name: ss.getName(), tabs: tabs, added: added, importError: importError, v: 7 });
    }
    if (!p.to || !/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(p.to)) return reply({ ok: false, error: 'email address missing or not valid' });
    if (!p.subject || !p.html) return reply({ ok: false, error: 'nothing to send' });
    GmailApp.sendEmail(p.to, p.subject, p.text || '', { htmlBody: p.html, name: p.fromName || 'SAADI Gymnastics', replyTo: SENDER });
    return reply({ ok: true, from: me, left: MailApp.getRemainingDailyQuota() });
  } catch (err) {
    return reply({ ok: false, error: String(err.message || err) });
  }
}

function doGet() { return reply({ ok: true, service: 'SAADI Enquiry Desk mailer' }); }

/** Press Run on this once after pasting, so Google asks for permission to send email, read and update the renewal
    spreadsheet and file the renewal emails. It also sets the 5-minute check of the inbox for renewal emails. */
function allowSending() {
  SpreadsheetApp.getActiveSpreadsheet();
  UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });   // permission to reach the SAADI Hub (Email assistant)
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'checkRenewalEmails') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('checkRenewalEmails').timeBased().everyMinutes(5).create();
  Logger.log('Ready to send as ' + Session.getEffectiveUser().getEmail() + '. ' + MailApp.getRemainingDailyQuota() + ' emails left today. Renewal emails are checked every 5 minutes.');
}

function reply(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ---------- emailed renewal replies -> "Renewal replies" folder -> the renewal spreadsheet ----------
   The renewal reminder's buttons open ready-written emails to reception. Every 5 minutes (and whenever the Term
   Renewals page reads the sheet) new ones are moved out of the inbox into the "Renewal replies" folder, then each is
   added as a row to the "Class change (emails)" or "Non Renewal (emails)" tab and marked "Renewal replies/Added to sheet". */
var FOLDER = 'Renewal replies', DONE_LABEL = 'Renewal replies/Added to sheet';
var MATCH = '(subject:"Change of class for" OR subject:"Not continuing in")';
var DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
var CHANGE_HEAD = ['Timestamp', 'Email Address',
  "Child's Name", 'Current Class Day', 'Current Class Time', 'Current Class Group Colour',
  "Second Child's Name", 'Current Class Day (2nd Child)', 'Current Class Time (2nd Child)', 'Current Class Group Colour (2nd Child)',
  "Third Child's Name", 'Current Class Day (3rd Child)', 'Current Class Time (3rd Child)', 'Current Class Group Colour (3rd Child)',
  "Fourth Child's Name", 'Current Class Day (4th Child)', 'Current Class Time (4th Child)', 'Current Class Group Colour (4th Child)',
  'Additional Logistical Requests', 'New Class Day Request', 'New Class Time Request', 'Email Subject'];
var LEAVE_HEAD = ['Timestamp', 'Email Address', 'What is the main reason you are leaving us?', 'Child', 'Current Class', 'Email Subject'];

function labelNamed(n) { return GmailApp.getUserLabelByName(n) || GmailApp.createLabel(n); }
function hasLabel(t, n) { return t.getLabels().some(function (l) { return l.getName() === n; }); }
function isRenewalSubject(subj) { return /^\\s*(Change of class for|Not continuing in)/i.test(subj || ''); }

/* Runs every 5 minutes (set up by allowSending). */
function checkRenewalEmails() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    moveRenewalEmails();
    var id = PropertiesService.getScriptProperties().getProperty('RENEWAL_SHEET');
    if (id) importRenewalEmails(SpreadsheetApp.openById(id));
  } finally { lock.releaseLock(); }
  assistantRun(false);   // Email assistant: draft replies to new emails (does nothing until it's switched on in the Hub)
}

/* New renewal emails: out of the inbox and into the folder. Only once per conversation, so if reception later
   replies and the parent answers, that answer stays in the inbox as normal. */
function moveRenewalEmails() {
  var folder = labelNamed(FOLDER), n = 0;
  GmailApp.search('in:inbox newer_than:90d ' + MATCH, 0, 100).forEach(function (t) {
    if (hasLabel(t, FOLDER) || !isRenewalSubject(t.getFirstMessageSubject())) return;
    t.addLabel(folder); t.moveToArchive(); n++;
  });
  return n;
}

/* Emails in the folder that aren't on the sheet yet. */
function importRenewalEmails(ss) {
  var folder = labelNamed(FOLDER), done = labelNamed(DONE_LABEL);
  var threads = GmailApp.search('label:renewal-replies -label:renewal-replies-added-to-sheet newer_than:90d', 0, 100);
  var tz = ss.getSpreadsheetTimeZone() || 'Europe/London', change = [], leave = [];
  threads.forEach(function (t) {
    if (hasLabel(t, DONE_LABEL)) return;
    var found = false;
    t.getMessages().forEach(function (m) {
      if (found) return;
      var subj = m.getSubject() || '';
      if (!isRenewalSubject(subj)) return;
      var isChange = /^\\s*Change of class for/i.test(subj);
      var from = m.getFrom() || '', email = ((from.match(/<([^>]+)>/) || [0, from])[1] || '').trim();
      if (!email || email.toLowerCase() === SENDER.toLowerCase()) return;
      found = true;
      var body = String(m.getPlainBody() || '').replace(/\\r/g, '');
      var ts = Utilities.formatDate(m.getDate(), tz, 'MM/dd/yyyy HH:mm:ss');
      var kids = kidsFrom(subj, body);
      if (isChange) {
        // What they'd like: the words after "Days and times that would suit us:", or, if they wrote somewhere else
        // in the email (at the top, or after "Thank you"), whatever they wrote that isn't part of the ready-made email.
        var wish = section(body, /Days and times that would suit us\\s*:/i) || freeText(body);
        var row = [ts, email];
        // The current class goes with the colour (e.g. "Yellow · YEAR 1 - 2"), so the hub can tell the school year
        // even when the email address isn't the one in JustGo.
        for (var i = 0; i < 4; i++) { var k = kids[i] || ['', '', '', '', '']; row.push(k[0], k[1], k[2], [k[3], k[4]].filter(String).join(' · ')); }
        row.push(wish, daysIn(wish).join(', '), wish.replace(/\\s+or\\s+/gi, ', '), subj);
        change.push(row);
      } else {
        var reason = section(body, /Reason \\(optional\\)\\s*:/i) || freeText(body) || 'Not continuing (emailed reception)';
        (kids.length ? kids : [['', '', '', '']]).forEach(function (k) {
          leave.push([ts, email, reason, k[0], [k[1], k[2], k[4] || ''].join(' ').trim(), subj]);
        });
      }
    });
    t.addLabel(done);
  });
  addRows(ss, 'Class change (emails)', CHANGE_HEAD, change);
  addRows(ss, 'Non Renewal (emails)', LEAVE_HEAD, leave);
  return change.length + leave.length;
}

/* Read every emailed request again (after this code improves): empties the two "(emails)" tabs, which only this
   script writes, and adds the emails back. Reception's "Remove from list" marks in the hub are kept. */
function reimportRenewalEmails(ss) {
  ss = ss || SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('RENEWAL_SHEET'));
  ['Class change (emails)', 'Non Renewal (emails)'].forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clearContent();
    if (sh && sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  });
  var done = labelNamed(DONE_LABEL);
  GmailApp.search('label:renewal-replies-added-to-sheet newer_than:90d', 0, 500).forEach(function (t) { t.removeLabel(done); });
  var n = 0;
  for (var round = 0; round < 10; round++) {
    n += importRenewalEmails(ss);
    if (!GmailApp.search('label:renewal-replies -label:renewal-replies-added-to-sheet newer_than:90d', 0, 1).length) break;
  }
  return n;
}

/* Children named in the subject ("...: Mia Smith and Tom Smith"), with their class from the "This term:" line.
   Email apps sometimes wrap that line, so it's read up to the next blank line or the next label. */
function kidsFrom(subj, body) {
  var who = subj.split(':').slice(1).join(':').trim();
  var names = who && !/^my child$/i.test(who) ? who.split(/\\s+and\\s+|\\s*,\\s*|\\s*&\\s*/).filter(String) : [];
  var tm = body.match(/This term\\s*:\\s*([\\s\\S]*?)(?:\\n\\s*\\n|Days and times|Reason \\(optional\\)|$)/i);
  var line = tm ? tm[1].replace(/\\s*\\n\\s*/g, ' ') : '', segs = [];
  line.split(/\\s*;\\s*/).forEach(function (s) {
    var m = s.match(/^\\s*([^:]+?)\\s*:\\s*(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\\s+(\\d[\\d:.]*\\s*(?:am|pm)?(?:\\s*-\\s*\\d[\\d:.]*\\s*(?:am|pm)?)?)\\s*(.*)$/i);
    if (m) segs.push({ first: m[1].trim(), day: m[2], time: m[3], cls: m[4].trim() });
  });
  if (!names.length) names = segs.map(function (s) { return s.first; });
  return names.map(function (n, i) {
    var f = n.split(/\\s+/)[0].toLowerCase();
    var s = segs.filter(function (x) { return x.first.toLowerCase() === f; })[0] || (names.length === segs.length ? segs[i] : null) || {};
    var col = ((s.cls || '').match(/\\b(orange|yellow|blue|red|green|purple|pink)\\b/i) || [])[1] || '';
    return [n, s.day || '', s.time || '', col ? col.charAt(0).toUpperCase() + col.slice(1).toLowerCase() : '', s.cls || ''];
  });
}

/* What the parent wrote after a label, up to their sign-off. */
function section(body, re) {
  var m = body.match(re);
  if (!m) return '';
  var rest = body.slice(m.index + m[0].length).split('\\n'), out = [];
  for (var i = 0; i < rest.length; i++) {
    var l = rest[i];
    if (/^\\s*(thank you|thanks|many thanks|kind regards|best wishes|regards)\\b/i.test(l) || /^\\s*>/.test(l) || /^On .+wrote:\\s*$/.test(l)) break;
    out.push(l.trim());
  }
  return out.join(' ').replace(/\\s+/g, ' ').trim();
}

/* Anything the parent typed that isn't part of the ready-made email (greeting, "This term:", labels, sign-off, quotes). */
function freeText(body) {
  var out = [], stop = false;
  body.split('\\n').forEach(function (l) {
    if (stop) return;
    var t = l.trim();
    if (/^>/.test(t) || /^On .+wrote:\\s*$/.test(t) || /^-{2,}\\s*Original Message/i.test(t) || /^Sent from my /i.test(t)) { stop = true; return; }
    if (!t) return;
    if (/^(hi|hello|dear)\\b.{0,30}(saadi|team)?[,!]?\\s*$/i.test(t)) return;
    if (/^We'?d like .+ to move to a different class/i.test(t) || /won'?t be continuing in/i.test(t)) return;
    if (/^This term\\s*:/i.test(t) || /^(Days and times that would suit us|Reason \\(optional\\))\\s*:\\s*$/i.test(t)) return;
    if (/^(thank you|thanks|many thanks|kind regards|best wishes|regards)\\b[\\s,!.]*$/i.test(t)) return;
    out.push(t.replace(/^(Days and times that would suit us|Reason \\(optional\\))\\s*:\\s*/i, ''));
  });
  return out.join(' ').replace(/\\s+/g, ' ').trim().slice(0, 500);
}

function daysIn(text) {
  var found = [], add = function (d) { if (d && found.indexOf(d) < 0) found.push(d); };
  // Whole day names and the usual short forms only ("month", "friend", "satisfied" aren't days).
  (String(text).match(/\\b(mondays?|mon|tuesdays?|tues?|wednesdays?|weds?|thursdays?|thurs?|thu|fridays?|fri|saturdays?|sat|sundays?|sun)\\b/gi) || []).forEach(function (w) {
    add(DAYS.filter(function (x) { return x.slice(0, 3).toLowerCase() === w.slice(0, 3).toLowerCase(); })[0]);
  });
  if (/\\bweek-?ends?\\b/i.test(text)) { add('Saturday'); add('Sunday'); }
  return found;
}

function addRows(ss, name, head, rows) {
  if (!rows.length) return;
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold'); sh.setFrozenRows(1); }
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, head.length).setValues(rows);
}



/* ---------- Email assistant (version 6) ----------
   Every 5 minutes (with the renewal check) new emails in this inbox are copied to the Email assistant's own section
   of the SAADI Hub database as "waiting for Claude". Once an hour Claude (Dave's scheduled job) reads them there and
   writes the drafts back; this script then adds each draft to Gmail with a label. Staff check, edit and press Send on
   the Hub's Email Assistant page. Claude never has this script's key, so it can never send. Switched on from the Hub. */
var AS = { ready: 'Assistant/Ready', person: 'Assistant/Needs a person', sent: 'Assistant/Sent', done: 'Assistant/Done', skipped: 'Assistant/Skipped' };
var AS_MAX_NEW = 15;
var AS_AUTO = /(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?@|newsletter|bounce|@(.*\\.)?(justgo|stripe|squarespace|google|facebookmail|instagram|linkedin|paypal|gocardless|xero|quickbooks|intuit|canva|brevo|sendinblue|mailchimp)\\.)/i;

function asProps() { return PropertiesService.getScriptProperties(); }
function asProp(k) { return asProps().getProperty(k) || ''; }
function asOn() { return asProp('ASSIST_ON') === '1' && !!asProp('ASSIST_DATA'); }

/* Requests from the Hub (already checked against the desk's key in doPost). */
function assistHandle(p, me) {
  var props = asProps();
  if (p.assist === 'connect') {
    if (!p.dataKey || String(p.dataKey).length < 20 || !p.project) return { ok: false, error: 'missing Hub details' };
    props.setProperties({ ASSIST_DATA: String(p.dataKey), ASSIST_PROJECT: String(p.project), ASSIST_ON: p.on === false ? '0' : '1' });
    asLabels();
    return { ok: true, from: me, v: 6, on: p.on !== false };
  }
  if (p.assist === 'status') return { ok: true, from: me, v: 6, on: asOn(), lastRun: asProp('ASSIST_LAST_RUN'), lastError: asProp('ASSIST_LAST_ERROR') };
  if (p.assist === 'run') { var n = assistantRun(true); return { ok: true, collected: n, lastError: asProp('ASSIST_LAST_ERROR') }; }
  if (p.assist === 'send') return assistSend(p.threadId, p.body, p.by);
  if (p.assist === 'done') return assistFinish(p.threadId, AS.done, true, p.by);
  if (p.assist === 'skip') return assistFinish(p.threadId, AS.skipped, false, p.by);
  return { ok: false, error: 'unknown assistant request' };
}

function asLabels() { Object.keys(AS).forEach(function (k) { labelNamed(AS[k]); }); }
function asMine(m) { return String(m.getFrom()).toLowerCase().indexOf(SENDER.toLowerCase()) > -1; }
function asLastIncoming(t) { var ms = t.getMessages(); for (var i = ms.length - 1; i >= 0; i--) if (!asMine(ms[i])) return ms[i]; return null; }
function asDraftFor(threadId) {
  var ds = GmailApp.getDrafts();
  for (var i = 0; i < ds.length; i++) { var m = ds[i].getMessage(); if (m && m.getThread().getId() === threadId) return ds[i]; }
  return null;
}

/* ---- the Hub's database (Firestore REST; the path is only known to the Hub and this script) ---- */
function fsBase() { return 'https://firestore.googleapis.com/v1/projects/' + asProp('ASSIST_PROJECT') + '/databases/(default)/documents/data/' + asProp('ASSIST_DATA') + '/'; }
function fsVal(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(fsVal) } };
  if (typeof v === 'object') { var f = {}; Object.keys(v).forEach(function (k) { f[k] = fsVal(v[k]); }); return { mapValue: { fields: f } }; }
  return { stringValue: String(v) };
}
function fsPlain(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('mapValue' in v) { var o = {}, f = v.mapValue.fields || {}; Object.keys(f).forEach(function (k) { o[k] = fsPlain(f[k]); }); return o; }
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsPlain);
  return null;
}
function fsDoc(raw) { var o = {}, f = raw.fields || {}; Object.keys(f).forEach(function (k) { o[k] = fsPlain(f[k]); }); o._id = String(raw.name || '').split('/').pop(); return o; }
function fsSet(path, obj) {
  var fields = {}; Object.keys(obj).forEach(function (k) { fields[k] = fsVal(obj[k]); });
  var mask = Object.keys(obj).map(function (k) { return 'updateMask.fieldPaths=' + encodeURIComponent(k); }).join('&');
  var r = UrlFetchApp.fetch(fsBase() + path + '?' + mask, { method: 'patch', contentType: 'application/json', payload: JSON.stringify({ fields: fields }), muteHttpExceptions: true });
  if (r.getResponseCode() >= 300) throw new Error('Hub database ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
}
function fsGet(path) {
  var r = UrlFetchApp.fetch(fsBase() + path, { muteHttpExceptions: true });
  return r.getResponseCode() === 200 ? fsDoc(JSON.parse(r.getContentText())) : null;
}
function fsDel(path) { UrlFetchApp.fetch(fsBase() + path, { method: 'delete', muteHttpExceptions: true }); }
function fsList(col) {
  var out = [], token = '';
  do {
    var r = UrlFetchApp.fetch(fsBase() + col + '?pageSize=300' + (token ? '&pageToken=' + encodeURIComponent(token) : ''), { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) break;
    var j = JSON.parse(r.getContentText());
    (j.documents || []).forEach(function (d) { out.push(fsDoc(d)); });
    token = j.nextPageToken || '';
  } while (token);
  return out;
}

/* ---- every 5 minutes: copy new emails to the Hub ---- */
function assistantRun(manual) {
  if (!asOn()) return 0;
  var added = 0, lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return 0;
  try {
    var seen = JSON.parse(asProp('ASSIST_SEEN') || '[]');
    var threads = GmailApp.search('in:inbox newer_than:3d -category:promotions -category:social', 0, 40);
    for (var i = 0; i < threads.length && added < AS_MAX_NEW; i++) {
      var t = threads[i], ms = t.getMessages(), last = ms[ms.length - 1];
      if (asMine(last)) continue;                                   // reception already replied
      if (seen.indexOf(last.getId()) > -1) continue;               // already copied
      seen.push(last.getId());
      if (isRenewalSubject(t.getFirstMessageSubject()) || AS_AUTO.test(last.getFrom())) continue;
      var convo = ms.slice(-4).map(function (m) {
        return 'From: ' + m.getFrom() + '\\nDate: ' + Utilities.formatDate(m.getDate(), 'Europe/London', 'EEE d MMM yyyy HH:mm') + '\\n\\n' + String(m.getPlainBody() || '').slice(0, 3500);
      }).join('\\n\\n-----\\n\\n');
      t.removeLabel(labelNamed(AS.ready)).removeLabel(labelNamed(AS.person));
      fsSet('emailAssist/' + t.getId(), {
        threadId: t.getId(), status: 'new', needsPerson: false, summary: '', reason: '', draft: '',
        from: last.getFrom(), subject: t.getFirstMessageSubject(), date: last.getDate().getTime(),
        text: String(last.getPlainBody() || '').slice(0, 6000), convo: convo, count: ms.length,
        attachments: last.getAttachments().map(function (a) { return a.getName(); }), addedAt: Date.now()
      });
      added++;
    }
    asGmailDrafts();
    asProps().setProperty('ASSIST_SEEN', JSON.stringify(seen.slice(-500)));
    asProps().setProperty('ASSIST_LAST_RUN', new Date().toISOString());
    asProps().deleteProperty('ASSIST_LAST_ERROR');
    if (new Date().getMinutes() < 5) asTidy();                      // once an hour: drop finished items older than 30 days
  } catch (err) {
    asProps().setProperty('ASSIST_LAST_ERROR', new Date().toISOString() + ' ' + String(err.message || err).slice(0, 300));
    if (manual) throw err;
  } finally { lock.releaseLock(); }
  return added;
}
/* Claude's drafts (written to the Hub) also go into Gmail as a draft reply, with a label. */
function asGmailDrafts() {
  fsList('emailAssist').forEach(function (d) {
    if (d.status !== 'waiting' || d.inGmail || !d.draft) return;
    var t = GmailApp.getThreadById(String(d.threadId));
    if (t) {
      var inc = asLastIncoming(t), old = asDraftFor(t.getId());
      if (old) old.deleteDraft();
      if (inc) inc.createDraftReply(String(d.draft));
      t.addLabel(labelNamed(d.needsPerson ? AS.person : AS.ready));
    }
    fsSet('emailAssist/' + d._id, { inGmail: true, convo: '' });
  });
}
function asTidy() {
  var cut = Date.now() - 30 * 864e5;
  fsList('emailAssist').forEach(function (d) {
    if (d._id !== '_config' && ['sent', 'done', 'skipped', 'ignored'].indexOf(d.status) > -1 && (d.doneAt || d.addedAt || 0) < cut) fsDel('emailAssist/' + d._id);
  });
}

/* ---- buttons on the Hub page ---- */
function asThread(threadId) {
  var cur = fsGet('emailAssist/' + String(threadId || ''));
  if (!cur || ['new', 'waiting'].indexOf(cur.status) < 0) throw new Error('That email is no longer waiting in the Email assistant.');
  var t = GmailApp.getThreadById(String(threadId));
  if (!t) throw new Error('That email has gone (deleted or moved).');
  return t;
}
function asHtml(text) {
  return '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">' +
    String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\\n/g, '<br>') + '</div>';
}
function assistSend(threadId, text, by) {
  var t = asThread(threadId);
  text = String(text || '').replace(/\\r/g, '').trim();
  if (!text) return { ok: false, error: 'The reply is empty.' };
  var inc = asLastIncoming(t);
  if (!inc) return { ok: false, error: 'There is no message to reply to.' };
  inc.reply(text, { htmlBody: asHtml(text), name: 'SAADI Gymnastics' });
  var d = asDraftFor(t.getId()); if (d) d.deleteDraft();
  t.removeLabel(labelNamed(AS.ready)).removeLabel(labelNamed(AS.person)).addLabel(labelNamed(AS.sent));
  t.markRead(); t.moveToArchive();
  fsSet('emailAssist/' + t.getId(), { status: 'sent', text: '', convo: '', draft: '', doneBy: String(by || ''), doneAt: Date.now() });
  return { ok: true };
}
/* Done: archive it, no reply. Skip: leave it in the inbox (with any draft) to deal with in Gmail. */
function assistFinish(threadId, to, archive, by) {
  var t = asThread(threadId);
  t.removeLabel(labelNamed(AS.ready)).removeLabel(labelNamed(AS.person)).addLabel(labelNamed(to));
  if (archive) { var d = asDraftFor(t.getId()); if (d) d.deleteDraft(); t.markRead(); t.moveToArchive(); }
  fsSet('emailAssist/' + t.getId(), { status: archive ? 'done' : 'skipped', text: '', convo: '', draft: '', doneBy: String(by || ''), doneAt: Date.now() });
  return { ok: true };
}
`;

root.EQ=EQ;
if(typeof module!=="undefined")module.exports=EQ;
})(typeof window!=="undefined"?window:globalThis);
