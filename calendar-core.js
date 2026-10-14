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
