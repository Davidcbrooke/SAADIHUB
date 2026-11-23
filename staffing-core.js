/* SAADI Hub: Staffing. Reads the termly staffing sheet (one tab per day) and joins it to Breathe HR time off.
   The sheet layout (each day tab):
     row with "Role" in column E = the dates row ("23rd Nov"); the row above = notes ("No Derek"); the row below = "Week 12".
     A = day, B = session (Desk/Reception, AM, PM...), C = class (merged down), D = termly count, E = role, F onwards = one column per week.
   Merged cells only fill their top-left cell, so session and class carry down until the next one starts. */
(function(){
"use strict";
const ST={};
const DAYS=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MONTHS={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,sept:8,oct:9,nov:10,dec:11};
const clean=s=>String(s==null?"":s).replace(/\s+/g," ").trim();

/* Colours for the class groups (the recreational colours, then the squads). */
ST.COLOURS={orange:"#f28c28",yellow:"#e0b400",blue:"#2f7de1",red:"#d62d3b",green:"#2e9e5b",purple:"#8a4fd1",pink:"#f20779",
  pearl:"#b9b4c7",diamond:"#5bc0de",amethyst:"#9966cc",topaz:"#e8a23a",emerald:"#2aa876",sapphire:"#2a52be",ruby:"#c0142f"};
ST.colourOf=(name,bg)=>{
  const n=clean(name).toLowerCase();
  for(const k in ST.COLOURS)if(new RegExp("\\b"+k+"\\b").test(n))return ST.COLOURS[k];
  if(bg&&!/^#?(ffffff|fff|000000)?$/i.test(bg))return bg;
  return "";
};

/* "23rd Nov" -> ISO date, in the school year that contains `ref` (Aug-Jul). */
ST.parseDate=(txt,ref)=>{
  const m=clean(txt).toLowerCase().match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,4})/);if(!m)return "";
  const mo=MONTHS[m[2]]??MONTHS[m[2].slice(0,3)];if(mo==null)return "";
  const r=ref||new Date(),startY=r.getMonth()>=7?r.getFullYear():r.getFullYear()-1;
  const y=mo>=7?startY:startY+1;
  return y+"-"+String(mo+1).padStart(2,"0")+"-"+String(+m[1]).padStart(2,"0");
};

/* Words in a cell that aren't people. */
const NOT_NAMES=/^(-|–|bank holiday|half term|closed|no longer offered|n\/?a|tbc|tba|\?+|none|cancelled|no class|x)$/i;
/* "Ash / Kay @ 4 / Nissa from 5" -> ["Ash","Kay","Nissa"]; "Ellie H staying until 3:45" -> ["Ellie H"] */
ST.namesIn=cell=>{
  const raw=String(cell==null?"":cell).trim();if(!raw||NOT_NAMES.test(clean(raw)))return [];
  const out=[];
  raw.split(/\s*(?:\/|&|\+|,|\n|\band\b|\s{2,})\s*/i).forEach(p=>{
    p=clean(p).replace(/\s*(?:@|\bfrom\b|\buntil\b|\btill\b|\bstaying\b|\bleaving\b|\bcover(?:ing)?\b|\(|\bat\b\s*\d|\d).*$/i,"").trim();
    if(!p||NOT_NAMES.test(p))return;
    // "Carole Ava G" -> "Carole", "Ava G": a lone initial belongs to the name before it
    const words=p.split(" ").filter(w=>/^[A-Za-z][A-Za-z'’.-]*$/.test(w));
    for(let i=0;i<words.length;i++){
      const w=words[i],nx=words[i+1];
      if(nx&&/^[A-Z]\.?$/.test(nx)){out.push(w+" "+nx.replace(".",""));i++}
      else if(!/^[A-Z]\.?$/.test(w)&&w.length>1)out.push(w);
    }
  });
  return out.map(n=>n.split(" ").map(w=>w.length>1?w.charAt(0).toUpperCase()+w.slice(1).toLowerCase():w.toUpperCase()).join(" "))
    .filter(n=>n.length<=24&&!STOP.test(n.split(" ")[0]));
};
/* Words that turn up in rota cells but aren't people. */
const STOP=/^(don'?t|dont|in|need|needs|on|one|two|to|the|trial|trials|only|please|new|tbc|see|with|for|if|not|all|any|staff|extra|help|cancelled|moved|coach|coaches|comp|day|no|school|closed|session|class|cover|desk|reception|lead|assistant|young|leader|leaders|tbc|ask|needed|free|spare|monday|tuesday|wednesday|thursday|friday|saturday|sunday|pearl|diamond|amethyst|topaz|emerald|group|groups|squad|novice|holiday|half|term|bank|off|sick|p-s)$/i;

/* One day tab -> {day, weeks:[{col,date,label,note}], rows:[{session,cls,termly,role,colour,cells:[text per week]}]} */
ST.parseTab=(name,values,bgC,ref)=>{
  const V=values.map(r=>r.map(clean));
  // the dates row: "Role" in column E, or failing that the first row with three or more dates
  let hi=V.findIndex(r=>/^role$/i.test(r[4]||""));
  if(hi<0)hi=V.findIndex(r=>r.slice(5).filter(x=>ST.parseDate(x,ref)).length>=3);
  if(hi<0)return null;
  const dates=V[hi],labels=V[hi+1]||[],notes=V[hi-1]||[];
  const weeks=[];
  for(let c=5;c<dates.length;c++){
    const d=ST.parseDate(dates[c],ref);
    if(d||/week\s*\d+/i.test(labels[c]||""))weeks.push({col:c,date:d,label:labels[c]||"",note:notes[c]||""});
  }
  const day=DAYS.find(d=>new RegExp("^"+d.slice(0,3),"i").test(name))||name;
  // a first session with no time beside it (Saturday) takes the time written in the header, e.g. "8:30am/8:45am"
  const headTime=(V.slice(0,hi+2).map(r=>r[1]||"").find(x=>/\d{1,2}[:.]\d{2}/.test(x))||"").match(/\d{1,2}[:.]\d{2}\s*(?:am|pm)?/i);
  const rows=[];let session="",cls="",termly="",colour="";
  for(let i=hi+2;i<V.length;i++){
    const r=V[i];
    if(r[1]){session=r[1].replace(/\s*\/\s*/g,"/");if(!r[2]){cls=session;termly="";colour=""}}
    if(r[2]){if(session==="Desk/Reception"&&!r[1])session=headTime?headTime[0]:"First session";
      cls=r[2].replace(/\s*\/\s*(?=\d)/," ");termly=r[3]||"";colour=ST.colourOf(cls,bgC&&bgC[i])}
    else if(r[3]&&!termly)termly=r[3];
    const role=r[4]||"";
    const cells=weeks.map(w=>String(values[i][w.col]==null?"":values[i][w.col]).trim());
    if(!role||/^[-–]$/.test(role)){continue}
    if(!cls&&!session){session=cls="Desk/Reception"}
    rows.push({session,cls,termly,role,colour,cells});
  }
  return {day,weeks,rows};
};

ST.parseRota=tabs=>tabs.map(t=>ST.parseTab(t.name,t.values,t.bg)).filter(Boolean);

/* ---------- names: rota nicknames -> Breathe staff ---------- */
const low=s=>clean(s).toLowerCase();
ST.matchName=(token,staff,map)=>{
  const t=clean(token);if(!t)return null;  if(map&&map[t]!==undefined)return map[t]==="ignore"?{ignore:true}:staff.find(s=>String(s.id)===String(map[t]))||null;
  const [first,ini]=t.split(" ");const f=low(first),i=low(ini||"").replace(/\./g,"");
  const firstOf=s=>[low(s.known),low(s.first)].filter(Boolean);
  let c=staff.filter(s=>firstOf(s).includes(f));
  if(i)c=c.filter(s=>low(s.last).startsWith(i));
  if(c.length===1)return c[0];
  const narrow=list=>{if(i)list=list.filter(s=>low(s.last).startsWith(i));return list.length===1?list[0]:null};
  // a nickname: Dave -> David, Tash -> Natasha, Becca -> Rebecca, Izzy -> Isabel/Isobel/Isabella...
  const full=ALIASES[f];
  if(!c.length&&full){const r=narrow(staff.filter(s=>firstOf(s).some(n=>full.includes(n))));if(r)return r}
  if(!c.length&&f.length>=3){
    const r=narrow(staff.filter(s=>firstOf(s).some(n=>n.startsWith(f))));if(r)return r;
  }
  // a spelling slip: "Ameila" -> Amelia, "Rebbca" -> Rebecca (one or two letters out, names of five letters or more)
  if(!c.length&&f.length>=5){
    const r=narrow(staff.filter(s=>firstOf(s).some(n=>n.length>=5&&dist(n,f)<=(f.length>=7?2:1))));if(r)return r;
  }
  return null;
};
/* Everyone in Breathe this rota name could be (ignoring whether it's unique), for the anomalies list. */
ST.candidates=(token,staff)=>{
  const t=clean(token);if(!t)return [];
  const [first,ini]=t.split(" ");const f=low(first),i=low(ini||"").replace(/\./g,"");
  const firstOf=s=>[low(s.known),low(s.first)].filter(Boolean);
  const full=ALIASES[f]||[];
  let c=staff.filter(s=>firstOf(s).some(n=>n===f||full.includes(n)||(f.length>=3&&n.startsWith(f))||(f.length>=5&&n.length>=5&&dist(n,f)<=(f.length>=7?2:1))));
  if(i){const w=c.filter(s=>low(s.last).startsWith(i));if(w.length)c=w}
  return c;
};
const ALIASES={dave:["david"],davey:["david"],tash:["natasha","tasha"],becca:["rebecca"],becky:["rebecca"],bex:["rebecca"],izzy:["isabel","isabelle","isobel","isabella","isla"],issy:["isabel","isabelle","isobel","isabella"],
  bella:["isabella","arabella","annabella"],ed:["edward","edwin","edmund"],josie:["josephine"],jo:["joanne","joanna","josephine"],maddie:["madeleine","madeline","madison","madelyn"],penny:["penelope"],ellie:["eleanor","elena","eloise","elizabeth"],
  liz:["elizabeth"],beth:["bethany","elizabeth"],kate:["katherine","catherine","kathryn"],katie:["katherine","catherine","kathryn"],kat:["katherine","catherine","katarzyna"],kasia:["katarzyna"],sam:["samantha","samuel"],
  alex:["alexandra","alexander"],lexi:["alexis","alexandra"],millie:["amelia","millicent","emily"],milly:["amelia","millicent","emily"],tilly:["matilda"],tilda:["matilda"],libby:["elizabeth","liberty"],
  nat:["natalie","natasha"],nicky:["nicola","nicole"],nikki:["nicola","nicole"],abby:["abigail"],abi:["abigail"],gabby:["gabriella","gabrielle"],sophie:["sophia"],sophia:["sophie"],chris:["christopher","christine","christina"],
  mike:["michael"],matt:["matthew"],tom:["thomas"],jamie:["james"],will:["william"],ollie:["oliver","olivia"],liv:["olivia"],em:["emily","emma"],steph:["stephanie"],fran:["frances","francesca"],
  annie:["anne","anna","annabel"],susie:["susan","susannah","suzanne"],suzy:["susan","susannah","suzanne"],sue:["susan","susannah"],sisi:["cecilia","cecily"]};
function dist(a,b){const m=a.length,n=b.length,d=Array.from({length:m+1},(_,i)=>[i]);for(let j=1;j<=n;j++)d[0][j]=j;
  for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return d[m][n]}

/* Is this person off on this ISO date? Returns the time-off record or null. */
ST.offOn=(personId,iso,off)=>off.find(o=>String(o.emp)===String(personId)&&o.start<=iso&&iso<=(o.end||o.start))||null;

/* Week number index to show: the week whose date is closest at or after today for that day tab. */
ST.weekIndexFor=(tab,iso)=>{
  let best=-1;
  tab.weeks.forEach((w,i)=>{if(w.date&&w.date<=iso)best=i});
  return best<0?0:best;
};

/* Every distinct name token on the rota. */
ST.allTokens=days=>{const s=new Set();days.forEach(d=>d.rows.forEach(r=>r.cells.forEach(c=>ST.namesIn(c).forEach(n=>s.add(n)))));return [...s].sort((a,b)=>a.localeCompare(b))};

/* Lead roles: a class missing one of these is a gap. */
ST.isLeadRole=role=>/lead coach|session lead|^coach$|warm up$/i.test(clean(role));

window.ST=ST;
})();
