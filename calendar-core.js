// SAADI Business Hub: Club Calendar colours, types and clash rules (shared by the Hub page and the calendar).
(function(){
"use strict";
// Pathway colours follow the NGL pathway colours. WAG and MAG use the NGL red and navy.
const PATHWAYS=[
  {k:"all",label:"Whole club",c:"#6b6470",ink:"#fff"},
  {k:"preschool",label:"Pre-School",c:"#E84187",ink:"#fff"},
  {k:"schools",label:"Schools",c:"#F8D438",ink:"#1d1a1f"},
  {k:"recreational",label:"Recreational",c:"#E88230",ink:"#fff"},
  {k:"general",label:"General",c:"#0071B3",ink:"#fff"},
  {k:"performance",label:"Performance",c:"#01AFB8",ink:"#fff"},
  {k:"wag",label:"WAG",c:"#C9142E",ink:"#fff"},
  {k:"mag",label:"MAG",c:"#29235C",ink:"#fff"}
];
const TYPES=[
  {k:"term",label:"Term dates",icon:"▭"},
  {k:"holiday",label:"Half term / holiday",icon:"☾"},
  {k:"assessment",label:"Assessment week",icon:"✎"},
  {k:"competition",label:"Competition",icon:"★"},
  {k:"event",label:"Club event",icon:"●"}
];
const PW=Object.fromEntries(PATHWAYS.map(p=>[p.k,p]));
const TY=Object.fromEntries(TYPES.map(t=>[t.k,t]));
// Term dates and holidays are background periods, so they never count as clashes.
const CLASHABLE=t=>t!=="term"&&t!=="holiday";
const endOf=e=>e.end&&e.end>=e.start?e.end:e.start;
const mins=t=>{if(!t)return null;const [h,m]=t.split(":").map(Number);return h*60+(m||0)};
function overlap(a,b){
  if(!a.start||!b.start)return false;
  if(!(a.start<=endOf(b)&&b.start<=endOf(a)))return false;
  if(a.allDay||b.allDay)return true;
  const as=mins(a.startTime),ae=mins(a.endTime)??(as!=null?as+60:null),bs=mins(b.startTime),be=mins(b.endTime)??(bs!=null?bs+60:null);
  if(as==null||bs==null)return true;           // a timed event with no start time is treated as all day
  return as<be&&bs<ae;
}
// Every pair of events that overlap. Each item: {a,b,same} where same = same pathway (or one is whole club).
function CalClash(events){
  const list=events.filter(e=>CLASHABLE(e.type)),out=[];
  for(let i=0;i<list.length;i++)for(let j=i+1;j<list.length;j++){
    const a=list[i],b=list[j];
    if(overlap(a,b))out.push({a,b,same:a.pathway===b.pathway||a.pathway==="all"||b.pathway==="all"});
  }
  return out;
}
window.CalPathways=PATHWAYS;window.CalTypes=TYPES;window.CalPW=PW;window.CalTY=TY;
window.CalClash=CalClash;window.CalOverlap=overlap;window.CalEnd=endOf;window.CalClashable=CLASHABLE;
})();

/* ---------- Google Sheets (published as CSV) ----------
   Reads a month-grid sheet: a "September 2026" heading row, then rows of day numbers with event cells underneath.
   The pathway comes from a tag in the cell, e.g. "Bury Spectrum [WAG]"; untagged cells use the link's default pathway. */
(function(){
const MONTHS=["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
const TAGS={wag:"wag",mag:"mag",gag:"general",gen:"general",general:"general",gl:"general",rec:"recreational",recreational:"recreational",
  schools:"schools",school:"schools",preschool:"preschool","pre-school":"preschool",pre:"preschool",perf:"performance",performance:"performance",pl:"performance",all:"all",club:"all"};
function parseCSV(t){
  const rows=[];let row=[],f="",q=false;
  for(let i=0;i<t.length;i++){const c=t[i];
    if(q){if(c==='"'){if(t[i+1]==='"'){f+='"';i++}else q=false}else f+=c}
    else if(c==='"')q=true;else if(c===","){row.push(f);f=""}else if(c==="\n"){row.push(f);rows.push(row);row=[];f=""}else if(c!=="\r")f+=c}
  if(f||row.length){row.push(f);rows.push(row)}
  return rows;
}
const pad=n=>String(n).padStart(2,"0");
function monthOf(cell){const m=String(cell||"").trim().match(/^([A-Za-z]{3,9})\.?\s+(\d{4})$/);if(!m)return null;const i=MONTHS.indexOf(m[1].slice(0,3).toLowerCase());return i<0?null:{y:+m[2],m:i}}
function typeOf(t){return /squad|training|camp|course|meeting|clinic|session|judging|judge/i.test(t)?"event":"competition"}
function parseGrid(text,defPath){
  const rows=parseCSV(text),hits=[];let cur=null,days=null;
  for(const r of rows){
    const mo=r.map(monthOf).find(Boolean);
    if(mo){cur=mo;days=null;continue}
    if(!cur)continue;
    const filled=r.map((c,i)=>[String(c).trim(),i]).filter(([c])=>c);
    if(!filled.length)continue;
    if(filled.every(([c])=>/^\d{1,2}$/.test(c)&&+c>=1&&+c<=31)){days={};filled.forEach(([c,i])=>days[i]=+c);continue}
    if(!days||filled.every(([c])=>/^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)/i.test(c)))continue;
    filled.forEach(([c,i])=>{if(days[i]==null)return;
      const tags=[...c.matchAll(/\[([^\]]+)\]/g)].map(x=>x[1].trim().toLowerCase().replace(/\s+/g,""));
      const path=tags.map(t=>TAGS[t]).find(Boolean)||defPath||"all";
      const title=c.replace(/\[[^\]]*\]/g,"").replace(/\s+/g," ").trim()||c;
      hits.push({title,pathway:path,date:`${cur.y}-${pad(cur.m+1)}-${pad(days[i])}`,raw:c});
    });
  }
  // merge the same event on consecutive days
  hits.sort((a,b)=>(a.title+a.pathway).localeCompare(b.title+b.pathway)||a.date.localeCompare(b.date));
  const out=[];
  hits.forEach(h=>{const last=out[out.length-1];
    const next=last&&last.title===h.title&&last.pathway===h.pathway?(()=>{const d=new Date(last.end+"T12:00:00");d.setDate(d.getDate()+1);return d.toISOString().slice(0,10)})():null;
    if(next&&(h.date===next||h.date===last.end))last.end=h.date;
    else out.push({id:"sheet:"+h.pathway+":"+h.date+":"+h.title.slice(0,40),title:h.title,pathway:h.pathway,type:typeOf(h.title),start:h.date,end:h.date,allDay:true,sheet:true,location:"",notes:""});
  });
  out.forEach(e=>{if(e.end===e.start)e.end=""});
  return out;
}
const CACHE="saadiCalSheets";
async function loadSheets(links,force){
  links=(links||[]).filter(l=>l&&l.url);
  if(!links.length)return {events:[],at:null,errors:[]};
  const sig=JSON.stringify(links);
  if(!force){try{const c=JSON.parse(sessionStorage.getItem(CACHE)||"null");if(c&&c.sig===sig&&Date.now()-c.t<10*60*1000)return {events:c.events,at:c.t,errors:[]}}catch(e){}}
  const events=[],errors=[];
  await Promise.all(links.map(async l=>{
    try{const r=await fetch(l.url+(l.url.includes("?")?"&":"?")+"_="+Date.now());if(!r.ok)throw new Error(r.status);
      events.push(...parseGrid(await r.text(),l.pathway))}
    catch(e){errors.push(l.url)}
  }));
  const seen=new Set(),uniq=events.filter(e=>!seen.has(e.id)&&seen.add(e.id));
  if(!errors.length)try{sessionStorage.setItem(CACHE,JSON.stringify({sig,t:Date.now(),events:uniq}))}catch(e){}
  return {events:uniq,at:Date.now(),errors};
}
window.CalParseGrid=parseGrid;window.CalLoadSheets=loadSheets;
})();
