// view-html.mjs — the self-contained page. One file, no server, no CDN, no runtime.
//
// Kept apart from view.mjs so the data shape stays testable without asserting against markup.
// The template is a string rather than a bundled asset for the same reason everything else here is
// plain: ADR 0004 rules out runtime dependencies, and a build step for one HTML file is not a
// trade worth making.
//
// It follows the viewer's system theme. A page that ignores the OS and forces dark reads as a tool
// from a decade ago, and this one is opened next to an editor that already made the choice.

const CSS = `
:root{
  color-scheme:light dark;
  --bg:#fbfbfd; --surface:#ffffff; --surface-2:#f4f4f7; --raised:#ffffff;
  --ink:#16161a; --ink-2:#5b5b66; --ink-3:#8a8a96;
  --line:rgba(16,16,22,.10); --line-2:rgba(16,16,22,.06);
  --acc:#5b5bd6; --acc-soft:rgba(91,91,214,.10);
  --ok:#1a7f52; --bad:#c2334d; --warn:#b06d10;
  --shadow:0 1px 2px rgba(16,16,22,.05),0 8px 24px -12px rgba(16,16,22,.16);
  --edge:120,124,150;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#0c0c0f; --surface:#131317; --surface-2:#191920; --raised:#1c1c23;
  --ink:#ececf1; --ink-2:#a1a1ad; --ink-3:#6e6e7c;
  --line:rgba(255,255,255,.10); --line-2:rgba(255,255,255,.05);
  --acc:#a5a3ff; --acc-soft:rgba(165,163,255,.12);
  --ok:#5ddba0; --bad:#ff8095; --warn:#f0b354;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 12px 32px -16px rgba(0,0,0,.7);
  --edge:150,155,190;
}}
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:var(--bg);color:var(--ink);
  font:14px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Inter,Roboto,sans-serif;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
body{overflow:hidden}
code,.mono{font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,monospace;font-size:12.5px}

/* ── top bar ─────────────────────────────────────────────────────────── */
#top{display:flex;align-items:center;gap:16px;padding:0 18px;height:56px;
  border-bottom:1px solid var(--line-2);background:var(--surface);position:sticky;top:0;z-index:20}
#brand{display:flex;align-items:center;gap:9px;font-weight:640;letter-spacing:-.015em;font-size:14.5px;white-space:nowrap}
#brand .glyph{width:22px;height:22px;border-radius:7px;background:linear-gradient(140deg,var(--acc),#00c2b8);
  display:grid;place-items:center;font-size:11px;color:#fff;flex:0 0 22px}
#brand .sub{color:var(--ink-3);font-weight:450}
#tabs{display:flex;gap:2px;padding:3px;background:var(--surface-2);border-radius:10px}
.tab{padding:6px 13px;border-radius:7px;cursor:pointer;color:var(--ink-2);font-size:13px;font-weight:500;
  white-space:nowrap;transition:color .12s,background .12s;user-select:none}
.tab:hover{color:var(--ink)}
.tab.on{background:var(--raised);color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.08)}
#q{margin-left:auto;width:270px;padding:8px 12px 8px 32px;border-radius:9px;border:1px solid var(--line);
  background:var(--surface-2) url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238a8a96' stroke-width='2.2' stroke-linecap='round'><circle cx='11' cy='11' r='7'/><path d='M20 20l-3.5-3.5'/></svg>") no-repeat 9px 50%/14px;
  color:var(--ink);font-size:13px;outline:none;transition:border-color .12s,box-shadow .12s}
#q:focus{border-color:var(--acc);box-shadow:0 0 0 3px var(--acc-soft);background-color:var(--surface)}
#q::placeholder{color:var(--ink-3)}

/* ── layout ──────────────────────────────────────────────────────────── */
#main{height:calc(100vh - 56px)}
.view{display:none;height:100%;position:relative}
.view.on{display:flex}
.pane{flex:1;overflow-y:auto;padding:30px 34px 60px;scrollbar-width:thin}
.wrap{max-width:900px}

/* The canvas takes its layout size from CSS, never from its width/height attributes — sizing the
   attribute off getBoundingClientRect while the attribute also drives layout is a feedback loop,
   and the page grows a horizontal scrollbar a pixel at a time. */
#cv{flex:1;display:block;cursor:grab;width:100%;height:100%;min-width:0}
#cv:active{cursor:grabbing}

/* ── floating panels over the graph ──────────────────────────────────── */
.float{position:absolute;background:var(--surface);border:1px solid var(--line);
  border-radius:13px;box-shadow:var(--shadow);backdrop-filter:blur(12px)}
#legend{right:18px;bottom:18px;padding:12px 13px;font-size:12px;max-height:52vh;overflow:auto;z-index:6;min-width:172px}
#legend .lg{display:flex;align-items:center;gap:8px;cursor:pointer;padding:3px 5px;margin:0 -5px;border-radius:6px;
  color:var(--ink-2);transition:background .1s,color .1s;user-select:none}
#legend .lg:hover{background:var(--surface-2);color:var(--ink)}
#legend .lg.off{opacity:.4}
#legend .lg .sw{width:9px;height:9px;border-radius:3px;flex:0 0 9px}
#legend .lg .ct{margin-left:auto;color:var(--ink-3);font-variant-numeric:tabular-nums;font-size:11px}
#legend .note{margin-top:9px;padding-top:9px;border-top:1px solid var(--line-2);color:var(--ink-3);
  font-size:11px;line-height:1.5;max-width:230px}
#hud{left:18px;top:18px;padding:9px 13px;font-size:12px;z-index:6;color:var(--ink-2);display:flex;gap:14px;align-items:center}
#hud b{color:var(--ink);font-variant-numeric:tabular-nums;font-weight:600}
#hud .sep{width:1px;height:14px;background:var(--line)}
#tip{position:fixed;pointer-events:none;background:var(--raised);border:1px solid var(--line);
  border-radius:11px;box-shadow:var(--shadow);padding:10px 12px;font-size:12px;max-width:330px;display:none;z-index:40}
#tip .t{font-weight:600;letter-spacing:-.01em;margin-bottom:3px;word-break:break-all}
#tip .m{color:var(--ink-3);font-size:11.5px;line-height:1.55}
#tip .m b{color:var(--ink-2);font-weight:500}

/* ── file list + reader ──────────────────────────────────────────────── */
.list{width:310px;flex:0 0 310px;border-right:1px solid var(--line-2);overflow-y:auto;
  padding:12px 10px 40px;background:var(--surface);scrollbar-width:thin}
.list .sect{font-size:10.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-3);
  margin:14px 8px 5px;font-weight:600;display:flex}
.list .sect .n{margin-left:auto;font-weight:500;opacity:.75}
.row{padding:6px 9px;border-radius:8px;cursor:pointer;display:flex;gap:9px;align-items:center;
  font-size:13px;color:var(--ink-2);transition:background .1s,color .1s}
.row:hover{background:var(--surface-2);color:var(--ink)}
.row.on{background:var(--acc-soft);color:var(--ink);font-weight:550}
.row .sw{width:7px;height:7px;border-radius:2.5px;flex:0 0 7px}
.row .nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#reader{flex:1;overflow-y:auto;padding:34px 40px 70px;scrollbar-width:thin}
#reader .inner{max-width:760px}
#reader h1{font-size:23px;margin:0 0 3px;letter-spacing:-.022em;font-weight:660;word-break:break-all}
#reader h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-3);
  margin:30px 0 10px;font-weight:600}
#reader .path{color:var(--ink-3);font-size:12.5px;margin-bottom:22px;word-break:break-all}
#empty{display:grid;place-items:center;height:100%;color:var(--ink-3);font-size:13.5px;text-align:center;padding:20px}

/* ── primitives ──────────────────────────────────────────────────────── */
.kpi{display:flex;flex-wrap:wrap;gap:9px;margin:0 0 6px}
.kpi .k{background:var(--surface);border:1px solid var(--line-2);border-radius:12px;padding:11px 15px;min-width:92px}
.kpi .k b{display:block;font-size:21px;font-weight:660;letter-spacing:-.03em;font-variant-numeric:tabular-nums;line-height:1.2}
.kpi .k span{font-size:10.5px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.06em;font-weight:550}
.kpi .k.warn b{color:var(--warn)} .kpi .k.bad b{color:var(--bad)}
.chip{display:inline-flex;align-items:center;gap:5px;background:var(--surface-2);border:1px solid var(--line-2);
  border-radius:7px;padding:4px 9px;margin:0 5px 5px 0;font-size:12px;color:var(--ink-2);
  cursor:pointer;transition:border-color .1s,color .1s,background .1s;max-width:100%}
.chip:hover{border-color:var(--acc);color:var(--ink)}
.chip.flat{cursor:default}.chip.flat:hover{border-color:var(--line-2);color:var(--ink-2)}
.chip.ok{color:var(--ok);border-color:rgba(26,127,82,.3)}
.chip.bad{color:var(--bad);border-color:rgba(194,51,77,.3)}
.chip .mono{font-size:11.5px}
.card{background:var(--surface);border:1px solid var(--line-2);border-radius:14px;padding:16px 18px;margin-bottom:10px;max-width:640px}
.card h3{margin:0 0 5px;font-size:14.5px;font-weight:600;letter-spacing:-.012em;display:flex;align-items:center;gap:8px}
.card h3 .sw{width:9px;height:9px;border-radius:3px}
.card .s{color:var(--ink-2);font-size:12.5px;font-variant-numeric:tabular-nums}
.card .p{color:var(--ink-3);font-size:12px;margin-top:2px}
.card .foot{margin-top:10px}
h2.vh{margin:34px 0 4px;font-size:16.5px;font-weight:640;letter-spacing:-.018em}
h2.vh:first-child{margin-top:0}
.hint{color:var(--ink-3);font-size:12.5px;margin:0 0 14px;max-width:660px;line-height:1.6}
code{background:var(--surface-2);border:1px solid var(--line-2);border-radius:6px;padding:2px 7px;color:var(--ink)}
table{border-collapse:separate;border-spacing:0;font-size:13px;width:100%;max-width:660px;
  border:1px solid var(--line-2);border-radius:12px;overflow:hidden;background:var(--surface)}
th{color:var(--ink-3);font-weight:600;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;
  text-align:left;padding:9px 14px;background:var(--surface-2);border-bottom:1px solid var(--line-2)}
td{padding:8px 14px;border-bottom:1px solid var(--line-2);vertical-align:middle}
tr:last-child td{border-bottom:0}
td.num{font-variant-numeric:tabular-nums;color:var(--ink-2);width:1%;white-space:nowrap}

/* ── the sequence ────────────────────────────────────────────────────── */
.prog{height:4px;border-radius:99px;background:var(--surface-2);overflow:hidden;max-width:660px;margin:14px 0 26px}
.prog i{display:block;height:100%;background:linear-gradient(90deg,var(--acc),#00c2b8);border-radius:99px}
.step{display:flex;gap:14px;padding:15px 18px;border:1px solid var(--line-2);border-radius:14px;
  margin-bottom:9px;background:var(--surface);max-width:720px;align-items:flex-start}
.step.next{border-color:var(--acc);background:var(--acc-soft);box-shadow:var(--shadow)}
.step.done{background:transparent;border-style:dashed}
.step .mk{flex:0 0 20px;height:20px;border-radius:50%;display:grid;place-items:center;font-size:11px;
  margin-top:1px;border:1px solid var(--line);color:var(--ink-3)}
.step.done .mk{background:var(--ok);border-color:transparent;color:#fff}
.step.next .mk{background:var(--acc);border-color:transparent;color:#fff}
.step .ti{font-weight:600;font-size:14px;letter-spacing:-.012em;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.step.done .ti{color:var(--ink-2);font-weight:500}
.step .wy{color:var(--ink-3);font-size:12.5px;margin-top:3px;line-height:1.55}
.step .cm{margin-top:9px;display:inline-block}
.badge{font-size:9.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--ink-3);
  border:1px solid var(--line);border-radius:5px;padding:2px 6px;font-weight:600}
.badge.hot{color:var(--acc);border-color:currentColor}
`;

const SCRIPT = `
const $=s=>document.getElementById(s);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const NODE=new Map(DATA.nodes.map(n=>[n.id,n]));
const OUT=new Map(),IN=new Map();
const push=(m,k,v)=>{if(!m.has(k))m.set(k,[]);m.get(k).push(v);};
for(const l of DATA.links){push(OUT,l.source,l.target);push(IN,l.target,l.source);}
const css=v=>getComputedStyle(document.documentElement).getPropertyValue(v).trim();

document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>showTab(t.dataset.v));
function showTab(v){document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('on',t.dataset.v===v));
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('on'));$('v-'+v).classList.add('on');if(v==='map')resize();}

// ---- file reader -------------------------------------------------------------------------
function openFile(id){const n=NODE.get(id);if(!n)return;showTab('files');
  const outs=(OUT.get(id)||[]).slice().sort(),ins=(IN.get(id)||[]).slice().sort();
  const link=p=>'<span class="chip" data-go="'+esc(p)+'"><span class="mono">'+esc(p)+'</span></span>';
  const facts=['area: '+n.area,n.lang,n.category,n.depth!==null?'layer '+n.depth:'',n.isEntry?'entry point':'',n.isTest?'test':'']
    .filter(Boolean).map(t=>'<span class="chip flat">'+esc(t)+'</span>').join('');
  let h='<div class="inner"><h1>'+esc(n.label)+'</h1><div class="path mono">'+esc(n.path)+'</div>';
  h+='<div class="kpi"><div class="k"><b>'+n.lines.toLocaleString()+'</b><span>lines</span></div>'
    +'<div class="k"><b>'+n.commits+'</b><span>commits</span></div>'
    +'<div class="k"><b>'+n.in+'</b><span>imported by</span></div>'
    +'<div class="k"><b>'+n.out+'</b><span>imports</span></div></div>';
  h+='<div style="margin-top:14px">'+facts
    +(n.isTest||n.category!=='code'?'':'<span class="chip flat '+(n.tested?'ok':'bad')+'">'+(n.tested?'✓ test found':'✗ no test found')+'</span>')+'</div>';
  if(n.summary)h+='<h2>What it does</h2><div class="hint" style="color:var(--ink-2)">'+esc(n.summary)
    +(n.role?'<br><b>Role:</b> '+esc(n.role):'')+'</div>'
    +(n.tags&&n.tags.length?'<div>'+n.tags.map(t=>'<span class="chip flat">'+esc(t)+'</span>').join('')+'</div>':'');
  h+='<h2>Imported by · '+ins.length+'</h2>'+(ins.length?ins.map(link).join('')
    :'<div class="hint">Nothing resolvable imports this. Import resolution is regex-based, so a dynamic import would not appear here — worth checking, never proof it is dead.</div>');
  h+='<h2>Imports · '+outs.length+'</h2>'+(outs.length?outs.map(link).join(''):'<div class="hint">No resolved imports.</div>');
  const r=$('reader');r.innerHTML=h+'</div>';r.scrollTop=0;
  r.querySelectorAll('.chip[data-go]').forEach(p=>p.onclick=()=>openFile(p.dataset.go));
  document.querySelectorAll('#flist .row').forEach(x=>x.classList.toggle('on',x.dataset.id===id));}

function buildList(q){const L=$('flist');L.innerHTML='';const by={};
  DATA.nodes.filter(n=>!q||n.path.toLowerCase().includes(q)).forEach(n=>{(by[n.area]=by[n.area]||[]).push(n);});
  const keys=Object.keys(by).sort();
  if(!keys.length){L.innerHTML='<div class="hint" style="padding:14px 9px">No path matches that.</div>';return;}
  keys.forEach(a=>{const h=document.createElement('div');h.className='sect';
    h.innerHTML=esc(a)+'<span class="n">'+by[a].length+'</span>';L.appendChild(h);
    by[a].sort((x,y)=>y.deg-x.deg||x.path.localeCompare(y.path)).forEach(n=>{const d=document.createElement('div');
      d.className='row';d.dataset.id=n.id;d.title=n.path;
      d.innerHTML='<span class="sw" style="background:'+n.color+'"></span><span class="nm">'+esc(n.label)+'</span>';
      d.onclick=()=>openFile(n.id);L.appendChild(d);});});}

// ---- areas -------------------------------------------------------------------------------
function buildAreas(){let h='<div class="wrap"><h2 class="vh">Areas</h2>'
  +'<div class="hint">The top-level shape of this repo. A scoped <code>AGENTS.md</code> means agents load narrow context for that area instead of the whole root brief — run <code>/cortex-brief &lt;dir&gt;</code> on the ones holding real invariants, not on all of them.</div>';
  DATA.areas.forEach(a=>{h+='<div class="card"><h3><span class="sw" style="background:'+a.color+'"></span>'+esc(a.name)+'</h3>'
    +'<div class="s">'+a.files+' files · '+a.code+' code · '+a.lines.toLocaleString()+' lines</div>'
    +(a.description?'<div class="p">'+esc(a.description)+'</div>':'')
    +'<div class="foot"><span class="chip flat '+(a.hasBrief?'ok':'')+'">'+(a.hasBrief?'✓ scoped brief':'no scoped brief')+'</span></div></div>';});
  $('apane').innerHTML=h+'</div>';}

// ---- gaps --------------------------------------------------------------------------------
function buildGaps(){const g=DATA.gaps;
  let h='<div class="wrap"><div class="kpi">'
   +'<div class="k"><b>'+DATA.stats.files+'</b><span>files</span></div>'
   +'<div class="k"><b>'+DATA.stats.edges+'</b><span>import edges</span></div>'
   +'<div class="k"><b>'+DATA.stats.tests+'</b><span>tests</span></div>'
   +'<div class="k'+(g.orphans.length?' warn':'')+'"><b>'+g.orphans.length+'</b><span>orphans</span></div>'
   +'<div class="k'+(g.cyclicFiles.length?' bad':'')+'"><b>'+g.cyclicFiles.length+'</b><span>in cycles</span></div></div>';
  h+='<h2 class="vh">Orphans</h2><div class="hint">Code files nothing imports and which import nothing. Import resolution is regex-based, so dynamic and computed imports are invisible — treat every row as a question, never a delete list.</div>';
  h+=g.orphans.length?g.orphans.map(p=>'<span class="chip" data-go="'+esc(p)+'"><span class="mono">'+esc(p)+'</span></span>').join(''):'<div class="hint">None.</div>';
  h+='<h2 class="vh">Files in import cycles</h2><div class="hint">These import each other, directly or through a chain, so they cannot be understood — or tested — one at a time. They also share one layer depth, because mutually importing files genuinely have no order among themselves.</div>';
  h+=g.cyclicFiles.length?g.cyclicFiles.map(p=>'<span class="chip" data-go="'+esc(p)+'"><span class="mono">'+esc(p)+'</span></span>').join(''):'<div class="hint">None.</div>';
  h+='<h2 class="vh">Busiest code with no test found</h2><div class="hint">Ranked by commits, because churn is where an untested file actually costs you. Coverage uses three signals — a test named for the file, a test importing it, or a test naming it in a quoted string — so a file exercised only through a subprocess reads as untested here. That is the safe direction to be wrong in.</div>';
  h+=g.untested.length?'<table><tr><th>file</th><th>commits</th></tr>'+g.untested.map(u=>'<tr><td><span class="chip" data-go="'+esc(u.path)+'"><span class="mono">'+esc(u.path)+'</span></span></td><td class="num">'+u.commits+'</td></tr>').join('')+'</table>':'<div class="hint">None.</div>';
  h+='<h2 class="vh">Hot spots</h2><div class="hint">The most-changed code in this repo\\'s history — what a new agent, or a new hire, should read first, and where a scoped brief pays for itself.</div>';
  h+='<table><tr><th>file</th><th>commits</th><th>lines</th><th>test</th></tr>'
   +g.hot.map(f=>'<tr><td><span class="chip" data-go="'+esc(f.path)+'"><span class="mono">'+esc(f.path)+'</span></span></td><td class="num">'+f.commits+'</td><td class="num">'+f.lines+'</td><td class="num" style="color:'+(f.tested?'var(--ok)':'var(--ink-3)')+'">'+(f.tested?'✓':'—')+'</td></tr>').join('')+'</table>';
  const p=$('gpane');p.innerHTML=h+'</div>';
  p.querySelectorAll('.chip[data-go]').forEach(el=>el.onclick=()=>openFile(el.dataset.go));}

// ---- the sequence ------------------------------------------------------------------------
function buildNext(){const n=DATA.next;const p=$('npane');
  if(!n){p.innerHTML='<div class="wrap hint">No sequence data.</div>';return;}
  let h='<div class="wrap"><h2 class="vh">Where this repo is</h2>'
   +'<div class="hint">'+n.done+' of '+n.total+' steps. Every ✓ is a file on disk, not a guess — run the highlighted command next.</div>'
   +'<div class="prog"><i style="width:'+Math.round(n.done/n.total*100)+'%"></i></div>';
  n.steps.forEach(s=>{const mk=s.done?'✓':s.next?'→':'';
    h+='<div class="step'+(s.done?' done':'')+(s.next?' next':'')+'"><div class="mk">'+mk+'</div><div style="min-width:0">'
     +'<div class="ti">'+esc(s.title)
     +(s.optional?'<span class="badge">optional</span>':'')
     +(s.blocking?'<span class="badge hot">do this first</span>':'')
     +(s.next?'<span class="badge hot">you are here</span>':'')+'</div>'
     +'<div class="wy">'+esc(s.why)+'</div>'
     +(s.done?'':'<code class="cm">'+esc(s.cmd)+'</code>')+'</div></div>';});
  h+='<h2 class="vh">Per change</h2><div class="hint">Not a sequence — a lookup. These are triggered by what you are doing, never by how far along the install is.</div>';
  h+='<table><tr><th>when</th><th>run</th></tr>'+n.perChange.map(r=>'<tr><td>'+esc(r.when)+'</td><td><code>'+esc(r.cmd)+'</code></td></tr>').join('')+'</table>';
  p.innerHTML=h+'</div>';}

// ---- graph -------------------------------------------------------------------------------
const cv=$('cv'),ctx=cv.getContext('2d'),tip=$('tip');
let W,H,tx=0,ty=0,scale=1,query='',hover=null,drag=null,pan=false,px=0,py=0,dpr=1;
function resize(){const r=cv.getBoundingClientRect();if(!r.width)return;
  // Back the canvas with device pixels and draw in CSS pixels. Without this the whole graph is
  // soft on every HiDPI screen, which is most of them.
  dpr=Math.min(window.devicePixelRatio||1,2);W=r.width;H=r.height;
  cv.width=Math.round(W*dpr);cv.height=Math.round(H*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);}
addEventListener('resize',resize);
// Deterministic seeding: index-derived, never Math.random, so the same index opens the same way.
const N=DATA.nodes.filter(n=>n.inMap).map((n,i)=>({...n,x:520+Math.cos(i*2.399)*(60+i%180),y:340+Math.sin(i*2.399)*(60+i%150),vx:0,vy:0,a:0}));
const M=new Map(N.map(n=>[n.id,n]));
const E=DATA.links.map(l=>({s:M.get(l.source),t:M.get(l.target)})).filter(e=>e.s&&e.t);
const hidden=new Set();
const vis=n=>!hidden.has(n.area);
// Files with no import edge Cortex could resolve. Simulated alongside everything else they had
// nothing but repulsion acting on them, so they were flung outward into a halo of loose labels
// orbiting the structure — the picture said "half this repo is disconnected" when the truth was
// narrower: shell tests sourced through a loop variable, and tests that read files instead of
// importing them. Parked in a labelled band below the graph instead. Still drawn, still clickable,
// still searchable; they have simply stopped pretending to be part of the layout.
const WIRED=new Set();for(const e of E){WIRED.add(e.s.id);WIRED.add(e.t.id);}
const LOOSE=N.filter(n=>!WIRED.has(n.id))
  .sort((a,b)=>a.area<b.area?-1:a.area>b.area?1:a.path<b.path?-1:1);
const MAXD=N.reduce((m,n)=>n.depth===null?m:Math.max(m,n.depth),0);
const TRAY_Y=90+(MAXD+2)*140,TRAY_COLS=Math.max(6,Math.ceil(Math.sqrt(LOOSE.length*1.6)));
LOOSE.forEach((n,i)=>{n.pin=1;
  n.x=520+((i%TRAY_COLS)-(TRAY_COLS-1)/2)*150;n.y=TRAY_Y+Math.floor(i/TRAY_COLS)*36;});
function step(){const k=.016,rep=2200,cx=W/2,cy=H/2;const A=N.filter(n=>vis(n)&&!n.pin);
  for(let i=0;i<A.length;i++){const a=A[i];
    for(let j=i+1;j<A.length;j++){const b=A[j];let dx=a.x-b.x,dy=a.y-b.y,d2=dx*dx+dy*dy||.01,d=Math.sqrt(d2),f=rep/d2,ux=dx/d,uy=dy/d;
      a.vx+=ux*f;a.vy+=uy*f;b.vx-=ux*f;b.vy-=uy*f;}
    a.vx+=(cx-a.x)*.0015;a.vy+=(cy-a.y)*.0015;
    // Layer depth pulls vertically, so the picture reads top-down instead of as a hairball.
    if(a.depth!==null)a.vy+=((90+a.depth*140)-a.y)*.006;}
  for(const e of E){if(!vis(e.s)||!vis(e.t))continue;
    let dx=e.t.x-e.s.x,dy=e.t.y-e.s.y,d=Math.sqrt(dx*dx+dy*dy)||.01,f=(d-84)*k,ux=dx/d,uy=dy/d;
    e.s.vx+=ux*f;e.s.vy+=uy*f;e.t.vx-=ux*f;e.t.vy-=uy*f;}
  for(const n of A){if(n===drag)continue;n.x+=n.vx*=.85;n.y+=n.vy*=.85;}}
function path(n,r){ctx.beginPath();
  if(n.shape==='square')ctx.roundRect(n.x-r,n.y-r,r*2,r*2,r*.42);
  else if(n.shape==='diamond'){ctx.moveTo(n.x,n.y-r);ctx.lineTo(n.x+r,n.y);ctx.lineTo(n.x,n.y+r);ctx.lineTo(n.x-r,n.y);ctx.closePath();}
  else if(n.shape==='triangle'){ctx.moveTo(n.x,n.y-r);ctx.lineTo(n.x+r*.92,n.y+r*.72);ctx.lineTo(n.x-r*.92,n.y+r*.72);ctx.closePath();}
  else ctx.arc(n.x,n.y,r,0,7);}
function draw(){if(!W)return;ctx.clearRect(0,0,W,H);ctx.save();ctx.translate(tx,ty);ctx.scale(scale,scale);
  const q=query.trim().toLowerCase(),EC=css('--edge');
  const nb=new Set();if(hover){nb.add(hover.id);for(const e of E){if(e.s===hover)nb.add(e.t.id);if(e.t===hover)nb.add(e.s.id);}}
  ctx.lineCap='round';
  for(const e of E){if(!vis(e.s)||!vis(e.t))continue;const on=hover?(e.s===hover||e.t===hover):true;
    // A slight curve keeps parallel edges from stacking into one thick line, and reads as a
    // relationship rather than a wire.
    const mx=(e.s.x+e.t.x)/2,my=(e.s.y+e.t.y)/2,dx=e.t.x-e.s.x,dy=e.t.y-e.s.y;
    const qx=mx-dy*.09,qy=my+dx*.09;
    ctx.strokeStyle='rgba('+EC+','+(on?.55:.13)+')';ctx.lineWidth=on?1.5:.8;
    ctx.beginPath();ctx.moveTo(e.s.x,e.s.y);ctx.quadraticCurveTo(qx,qy,e.t.x,e.t.y);ctx.stroke();
    if(on&&hover){ // direction only where the eye is, so the picture stays calm
      const ang=Math.atan2(e.t.y-qy,e.t.x-qx),r=e.t.r+3.5;
      const ax=e.t.x-Math.cos(ang)*r,ay=e.t.y-Math.sin(ang)*r;
      ctx.fillStyle='rgba('+EC+',.7)';ctx.beginPath();
      ctx.moveTo(ax,ay);ctx.lineTo(ax-Math.cos(ang-.42)*7,ay-Math.sin(ang-.42)*7);
      ctx.lineTo(ax-Math.cos(ang+.42)*7,ay-Math.sin(ang+.42)*7);ctx.closePath();ctx.fill();}}
  if(LOOSE.length){ // the band's own caption, so a parked node is never mistaken for a stray one
    const w=(TRAY_COLS*150)/2;ctx.globalAlpha=.42;ctx.strokeStyle=css('--ink-2');ctx.lineWidth=1;
    ctx.setLineDash([3,5]);ctx.beginPath();ctx.moveTo(520-w,TRAY_Y-40);ctx.lineTo(520+w,TRAY_Y-40);
    ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle=css('--ink-2');ctx.font='600 12px ui-sans-serif,system-ui,sans-serif';
    ctx.textAlign='center';ctx.fillText(LOOSE.length+' files with no import edge found',520,TRAY_Y-50);
    ctx.globalAlpha=1;}
  for(const n of N){if(!vis(n))continue;
    const mt=q&&n.path.toLowerCase().includes(q);
    const want=((hover&&!nb.has(n.id))||(q&&!mt))?.13:1;
    n.a+=(want-n.a)*.22;                       // eased focus, so hovering does not strobe
    ctx.globalAlpha=n.a;
    const lift=(hover===n)?1.35:1,r=n.r*lift;
    if(hover===n||mt){ctx.shadowColor=n.color;ctx.shadowBlur=18;}
    path(n,r);ctx.fillStyle=n.color;ctx.fill();ctx.shadowBlur=0;
    if(n.category==='code'&&!n.isTest&&!n.tested){ctx.lineWidth=1.4;ctx.strokeStyle=css('--bad');ctx.stroke();}
    if(mt){ctx.lineWidth=2;ctx.strokeStyle=css('--ink');ctx.stroke();}
    // Parked nodes are always labelled: the band is a list, and an anonymous dot in it is worse
    // than no dot. Its grid spacing is what keeps that from becoming clutter.
    if(scale>.72||n.deg>3||mt||n.pin||(hover&&nb.has(n.id))){ctx.globalAlpha=n.a*.94;ctx.fillStyle=css('--ink-2');
      ctx.font='500 11px ui-sans-serif,system-ui,sans-serif';ctx.textAlign='center';
      const cap=n.pin?18:24;
      ctx.fillText(n.label.length>cap?n.label.slice(0,cap-1)+'…':n.label,n.x,n.y-r-6);}}
  ctx.globalAlpha=1;ctx.restore();}
function loop(){step();draw();requestAnimationFrame(loop);}
function tw(mx,my){return{x:(mx-tx)/scale,y:(my-ty)/scale};}
function pick(mx,my){const p=tw(mx,my);let b=null,bd=1e9;
  for(const n of N){if(!vis(n))continue;const dx=n.x-p.x,dy=n.y-p.y,d=dx*dx+dy*dy;if(d<bd&&d<(n.r+7)*(n.r+7)){bd=d;b=n;}}return b;}
cv.addEventListener('mousedown',e=>{const n=pick(e.offsetX,e.offsetY);
  if(n){drag=n;drag._dn=0;}else{pan=true;px=e.offsetX;py=e.offsetY;}});
addEventListener('mousemove',e=>{const r=cv.getBoundingClientRect();const mx=e.clientX-r.left,my=e.clientY-r.top;
  if(drag){const p=tw(mx,my);drag.x=p.x;drag.y=p.y;drag.vx=drag.vy=0;drag._dn=1;}
  else if(pan){tx+=mx-px;ty+=my-py;px=mx;py=my;}
  else{const n=pick(mx,my);hover=n;
    if(n){tip.style.display='block';
      const flip=e.clientX>innerWidth-360;
      tip.style.left=(flip?e.clientX-350:e.clientX+16)+'px';tip.style.top=(e.clientY+16)+'px';
      tip.innerHTML='<div class="t">'+esc(n.path)+'</div><div class="m">'
        +esc(n.area)+' · '+esc(n.lang)+' · <b>'+n.lines+'</b> lines · <b>'+n.commits+'</b> commits<br>'
        +'<b>'+n.in+'</b> imported by · <b>'+n.out+'</b> imports'
        +(n.category==='code'&&!n.isTest?(n.tested?'<br>✓ test found':'<br>✗ no test found'):'')
        +(n.summary?'<br>'+esc(n.summary.slice(0,150)):'')+'<br>click to open</div>';}
    else tip.style.display='none';}});
addEventListener('mouseup',()=>{if(drag&&!drag._dn)openFile(drag.id);drag=null;pan=false;});
cv.addEventListener('wheel',e=>{e.preventDefault();const f=e.deltaY<0?1.1:.9;const mx=e.offsetX,my=e.offsetY;
  tx=mx-(mx-tx)*f;ty=my-(my-ty)*f;scale*=f;},{passive:false});
function buildHud(){$('hud').innerHTML='<span><b>'+N.length+'</b> files</span><span class="sep"></span>'
  +'<span><b>'+E.length+'</b> imports</span><span class="sep"></span><span>scroll to zoom · drag to pan</span>';}
function buildLegend(){const L=$('legend');const shown=new Set(N.map(n=>n.area));
  L.innerHTML=DATA.areas.filter(a=>shown.has(a.name)).map(a=>'<div class="lg" data-a="'+esc(a.name)+'">'
    +'<span class="sw" style="background:'+a.color+'"></span>'+esc(a.name)
    +'<span class="ct">'+N.filter(n=>n.area===a.name).length+'</span></div>').join('')
   +'<div class="note">Click an area to hide it. A red outline means no test was found. '
   +(DATA.nodes.length-N.length)+' docs and config files live in <b>Files</b>, not here — they have no imports to draw.'
   +(LOOSE.length?' The '+LOOSE.length+' files in the band below the graph have no import edge Cortex could resolve — which is a question, not a verdict: a file loaded dynamically, or sourced through a variable, looks exactly like an unused one.':'')+'</div>';
  L.querySelectorAll('.lg[data-a]').forEach(el=>el.onclick=()=>{const a=el.dataset.a;
    if(hidden.has(a)){hidden.delete(a);el.classList.remove('off');}else{hidden.add(a);el.classList.add('off');}});}
$('q').addEventListener('input',e=>{query=e.target.value;buildList(query.trim().toLowerCase());});
addEventListener('keydown',e=>{if(e.key==='/'&&document.activeElement!==$('q')){e.preventDefault();$('q').focus();}
  if(e.key==='Escape'){$('q').blur();}});
buildList('');buildAreas();buildGaps();buildNext();buildLegend();buildHud();resize();loop();
`;

// Inlined JSON sits inside a <script> element, where the parser looks for "</script" before it
// looks for a string literal. An enrichment summary quoting markup would otherwise end the script
// mid-object and blank the page.
function safeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function renderHtml(view) {
  const repo = view.generated.root.split(/[\\/]/).filter(Boolean).pop() || "repo";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Cortex — ${repo}</title><style>${CSS}</style></head><body>
<div id="top">
<div id="brand"><span class="glyph">◆</span>${repo}<span class="sub">· cortex</span></div>
<div id="tabs">
<span class="tab" data-v="next">Next steps</span>
<span class="tab on" data-v="map">Map</span>
<span class="tab" data-v="files">Files</span>
<span class="tab" data-v="areas">Areas</span>
<span class="tab" data-v="gaps">Gaps</span>
</div>
<input id="q" placeholder="Search paths…  /" autocomplete="off" spellcheck="false"/></div>
<div id="main">
<div class="view" id="v-next"><div class="pane" id="npane"></div></div>
<div class="view on" id="v-map"><canvas id="cv"></canvas><div class="float" id="hud"></div><div class="float" id="legend"></div></div>
<div class="view" id="v-files"><div class="list" id="flist"></div><div id="reader"><div id="empty">Pick a file on the left, or click a node on the Map.</div></div></div>
<div class="view" id="v-areas"><div class="pane" id="apane"></div></div>
<div class="view" id="v-gaps"><div class="pane" id="gpane"></div></div>
</div><div id="tip"></div>
<script>const DATA=${safeJson(view)};</script>
<script>${SCRIPT}</script>
</body></html>`;
}
