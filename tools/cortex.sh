#!/usr/bin/env bash
# cortex.sh — build ONE self-contained app (cortex.html) to view + navigate the whole vault:
# Map (force graph) · Notes (read rendered markdown, click [[wikilinks]] to navigate) · Repos
# (registered codebase brains) · Gaps (orphan notes + dead links to fix). No server, no runtime —
# everything is embedded; just open the file. Run from the vault root:  bash tools/cortex.sh
set -u
# Resolve the shared lib against this script, not the cwd — the cd below moves us to the vault.
# Loading it is mandatory: without knowledge_files() the walk finds nothing and we would happily
# write a cortex.html with zero notes and exit 0.
LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_cortex-lib.sh"
# shellcheck source=/dev/null
. "$LIB" || { echo "cortex: cannot load $LIB" >&2; exit 1; }
ROOT="${1:-$(pwd)}"; cd "$ROOT" || { echo "no such dir: $ROOT"; exit 1; }
OUT="$ROOT/cortex.html"; TMP="$(mktemp -d)"; NODES="$TMP/n"; EDGES="$TMP/e"; : >"$NODES"; : >"$EDGES"

fmval(){ awk -v k="$2" 'BEGIN{f=0} /^---[[:space:]]*$/{f++; next} f==1 && $0 ~ "^"k":"{sub("^"k":[[:space:]]*",""); gsub(/^"|"$/,""); print; exit}' "$1"; }
label_of(){ local t; t="$(fmval "$1" title)"; [ -z "$t" ] && t="$(fmval "$1" name)"; [ -z "$t" ] && t="$(basename "$1" .md)"; printf '%s' "$t"; }
layer_of(){ case "$1" in context) echo Context;; notes) echo Knowledge;; projects) echo Projects;; areas) echo Areas;; references) echo References;; decisions) echo Decisions;; daily) echo Daily;; resources) echo Resources;; inbox) echo Inbox;; .) echo Map;; *) echo "$1";; esac; }
color_of(){ case "$1" in Context) echo '#eab308';; Knowledge) echo '#3b82f6';; Projects) echo '#f97316';; Areas) echo '#a855f7';; References) echo '#14b8a6';; Decisions) echo '#b45309';; Daily) echo '#06b6d4';; Resources) echo '#10b981';; Inbox) echo '#64748b';; Map) echo '#ec4899';; *) echo '#8b97ab';; esac; }
jbody(){ awk 'BEGIN{f=0} NR==1&&/^---[[:space:]]*$/{f=1;next} f==1&&/^---[[:space:]]*$/{f=0;next} f==1{next} {gsub(/\r/,""); gsub(/\\/,"\\\\"); gsub(/"/,"\\\""); gsub(/\t/,"    "); printf "%s\\n",$0}' "$1"; }
jesc(){ sed -e 's/\\/\\\\/g; s/"/\\"/g'; }

FILES="$(knowledge_files "$ROOT")"

while IFS= read -r f; do [ -z "$f" ] && continue
  rel="${f#./}"; id="$(note_id "$(basename "$f")")"; [ -z "$id" ] && continue
  lab="$(label_of "$f")"; top="${rel%%/*}"; [ "$top" = "$rel" ] && top="."
  printf '%s\t%s\t%s\t%s\n' "$id" "$lab" "$rel" "$(layer_of "$top")" >> "$NODES"
done <<< "$FILES"
KNOWN="$TMP/k"; cut -f1 "$NODES" | sort -u > "$KNOWN"

while IFS= read -r f; do [ -z "$f" ] && continue
  sid="$(note_id "$(basename "$f")")"
  awk '/^[[:space:]]*```/{fc=!fc;next} fc{next} /<!--/{next}
    { gsub(/`[^`]*`/,""); while(match($0,/\[\[[^]]+\]\]/)){ln=substr($0,RSTART+2,RLENGTH-4);sub(/\|.*/,"",ln);sub(/#.*/,"",ln);print ln;$0=substr($0,RSTART+RLENGTH)} }' "$f" \
  | while IFS= read -r tgt; do tid="$(note_id "$tgt")"; [ -z "$tid" ]&&continue; [ "$tid" = "$sid" ]&&continue; printf '%s\t%s\n' "$sid" "$tid" >>"$EDGES"; done
done <<< "$FILES"
sort -u "$EDGES" -o "$EDGES"
outd(){ grep -c "^$1	" "$EDGES"; }; ind(){ grep -c "	$1\$" "$EDGES"; }

NODE_JSON=""; ORPH=""
while IFS=$'\t' read -r id lab file lay; do [ -z "$id" ]&&continue
  c="$(color_of "$lay")"; o="$(outd "$id")"; i="$(ind "$id")"; d=$((o+i)); r=$((4 + (d>8?8:d)))
  body="$(jbody "$ROOT/$file")"; el="$(printf '%s' "$lab"|jesc)"; ef="$(printf '%s' "$file"|jesc)"
  NODE_JSON="$NODE_JSON{\"id\":\"$id\",\"label\":\"$el\",\"file\":\"$ef\",\"layer\":\"$lay\",\"color\":\"$c\",\"real\":true,\"r\":$r,\"deg\":$d,\"out\":$o,\"in\":$i,\"body\":\"$body\"},"
  [ "$d" -eq 0 ] && ORPH="$ORPH\"$el\","
done < "$NODES"
DEAD_JSON=""; DCOUNT=0
for tid in $(cut -f2 "$EDGES"|sort -u); do grep -qx "$tid" "$KNOWN" && continue
  i="$(ind "$tid")"; NODE_JSON="$NODE_JSON{\"id\":\"$tid\",\"label\":\"$tid\",\"file\":\"(missing)\",\"layer\":\"Missing\",\"color\":\"#ef4444\",\"real\":false,\"r\":4,\"deg\":$i,\"out\":0,\"in\":$i,\"body\":\"\"},"
  DEAD_JSON="$DEAD_JSON\"$tid\","; DCOUNT=$((DCOUNT+1)); done
EDGE_JSON=""; while IFS=$'\t' read -r s t; do [ -z "$s" ]&&continue; EDGE_JSON="$EDGE_JSON{\"source\":\"$s\",\"target\":\"$t\"},"; done < "$EDGES"

# repos (registered codebase brains)
REPO_JSON=""; for rf in $(grep -lER '^path:' projects 2>/dev/null|sort -u); do
  nm="$(label_of "$rf"|jesc)"; pth="$(fmval "$rf" path|jesc)"; stk="$(fmval "$rf" stack|jesc)"; st="$(fmval "$rf" status|jesc)"
  REPO_JSON="$REPO_JSON{\"name\":\"$nm\",\"path\":\"$pth\",\"stack\":\"$stk\",\"status\":\"$st\"},"; done

NC=$(wc -l <"$NODES"|tr -d ' '); EC=$(wc -l <"$EDGES"|tr -d ' ')
DATA="{\"nodes\":[${NODE_JSON%,}],\"edges\":[${EDGE_JSON%,}],\"repos\":[${REPO_JSON%,}],\"stats\":{\"notes\":$NC,\"links\":$EC,\"dead\":$DCOUNT,\"deadList\":[${DEAD_JSON%,}],\"orphans\":[${ORPH%,}]}}"

cat > "$OUT" <<'HTMLA'
<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Cortex</title><style>
:root{--bg:#0b0f1a;--panel:#131a2b;--ink:#e6edf6;--mut:#8b97ab;--line:#26324a;--acc:#6ea8fe}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--bg);color:var(--ink);font:14px/1.6 ui-sans-serif,system-ui,Segoe UI,Roboto}
#top{display:flex;align-items:center;gap:14px;padding:10px 16px;border-bottom:1px solid var(--line);background:var(--panel);position:sticky;top:0;z-index:5}
#top b{font-size:15px}.tab{padding:6px 12px;border-radius:8px;cursor:pointer;color:var(--mut);font-size:13px}.tab.on{background:#0d1322;color:var(--ink);border:1px solid var(--line)}
#q{margin-left:auto;width:280px;padding:8px 11px;border-radius:8px;border:1px solid var(--line);background:#0d1322;color:var(--ink)}
#main{height:calc(100vh - 53px)}.view{display:none;height:100%}.view.on{display:flex}
#cv{flex:1;display:block;cursor:grab}#tip{position:fixed;pointer-events:none;background:#0d1322;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:12px;max-width:280px;display:none;z-index:10}#tip b{display:block}#tip .m{color:var(--mut);font-size:11px}
.list{width:320px;flex:0 0 320px;border-right:1px solid var(--line);overflow:auto;padding:10px;background:var(--panel)}
.list .sect{font-size:10.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--mut);margin:12px 4px 4px}
.row{padding:5px 8px;border-radius:6px;cursor:pointer;display:flex;gap:7px;align-items:center;font-size:13px}.row:hover{background:#0d1322}.dot{width:9px;height:9px;border-radius:50%;flex:0 0 9px}
#reader{flex:1;overflow:auto;padding:26px 34px;max-width:820px}#reader h1{font-size:24px}#reader h2{font-size:19px;border-bottom:1px solid var(--line);padding-bottom:4px}#reader h3{font-size:16px}
#reader .meta{color:var(--mut);font-size:12px;margin-bottom:18px}#reader code{background:#0d1322;border:1px solid var(--line);border-radius:5px;padding:1px 5px;font-size:12.5px}
#reader pre{background:#0d1322;border:1px solid var(--line);border-radius:8px;padding:12px;overflow:auto}#reader pre code{border:0;background:0}
#reader a{color:var(--acc);text-decoration:none}#reader a.wl{border-bottom:1px dotted var(--acc)}#reader a.wl.dead{color:#fca5a5;border-color:#fca5a5}
#reader blockquote{border-left:3px solid var(--line);margin:0;padding:2px 14px;color:var(--mut)}#reader ul{padding-left:22px}#reader table{border-collapse:collapse}#reader td,#reader th{border:1px solid var(--line);padding:4px 8px}
.pane{flex:1;overflow:auto;padding:22px 28px}.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:12px;max-width:560px}
.card h3{margin:0 0 4px}.card .s{color:var(--acc);font-size:12px}.card .p{color:var(--mut);font-size:11px;word-break:break-all}
.pill{display:inline-block;background:#0d1322;border:1px solid var(--line);border-radius:999px;padding:3px 10px;margin:3px 4px 0 0;font-size:12px;color:var(--mut);cursor:pointer}.pill.bad{border-color:#7f1d1d;color:#fca5a5}
.stat{display:inline-block;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px 14px;margin:0 8px 8px 0}.stat b{font-size:20px;display:block}.stat span{font-size:10.5px;color:var(--mut);text-transform:uppercase}
.hint{color:var(--mut);font-size:12px;margin:10px 0 18px}h2.vh{margin:4px 0 12px;font-size:16px}
.rm{cursor:pointer;border:1px solid #7f1d1d;background:#0d1322;color:#fca5a5;border-radius:7px;padding:5px 11px;font-size:12.5px;margin:0 0 16px;display:inline-block}.rm:hover{background:#1a1020}
#toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:#0d1322;border:1px solid var(--line);border-radius:10px;padding:12px 18px;font-size:13px;display:none;z-index:30;max-width:600px;box-shadow:0 10px 30px #0009}#toast code{background:#000;border:1px solid var(--line);border-radius:6px;padding:2px 7px;display:inline-block;margin:6px 0;color:#e6edf6}
</style></head><body>
<div id="top"><b>🧠 Cortex</b>
<span class="tab on" data-v="map">Map</span><span class="tab" data-v="notes">Notes</span><span class="tab" data-v="repos">Repos</span><span class="tab" data-v="gaps">Gaps</span>
<input id="q" placeholder="Search notes…" autocomplete="off"/></div>
<div id="main">
<div class="view on" id="v-map"><canvas id="cv"></canvas></div>
<div class="view" id="v-notes"><div class="list" id="nlist"></div><div id="reader"></div></div>
<div class="view" id="v-repos"><div class="pane" id="rpane"></div></div>
<div class="view" id="v-gaps"><div class="pane" id="gpane"></div></div>
</div><div id="tip"></div><div id="toast"></div><script>
HTMLA
printf 'const DATA=%s;\n' "$DATA" >> "$OUT"
cat >> "$OUT" <<'HTMLB'
const $=s=>document.querySelector(s),ce=s=>document.getElementById(s);
function esc(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function slug(s){return s.toLowerCase().replace(/\.md$/,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');}
function showToast(h){const t=ce('toast');t.innerHTML=h;t.style.display='block';clearTimeout(t._h);t._h=setTimeout(()=>t.style.display='none',9000);}
function copyRemove(file,label){const cmd='bash tools/cortex-rm.sh "'+file+'"';const done=()=>showToast('To remove <b>'+esc(label)+'</b> — paste in your terminal (archives it + de-links references, then refreshes):<br><code>'+esc(cmd)+'</code><br><span style="color:var(--mut)">✓ copied to clipboard</span>');if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(cmd).then(done,done);}else done();}
const NOTE=new Map(DATA.nodes.filter(n=>n.real).map(n=>[n.id,n]));
// tabs
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>showTab(t.dataset.v));
function showTab(v){document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('on',t.dataset.v===v));
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('on'));ce('v-'+v).classList.add('on');if(v==='map')resize();}
// markdown → html (compact)
function md(t){let h=esc(t);
  h=h.replace(/```([\s\S]*?)```/g,(m,c)=>'<pre><code>'+c.replace(/^\n/,'')+'</code></pre>');
  h=h.replace(/^###### (.*)$/gm,'<h6>$1</h6>').replace(/^##### (.*)$/gm,'<h5>$1</h5>').replace(/^#### (.*)$/gm,'<h4>$1</h4>').replace(/^### (.*)$/gm,'<h3>$1</h3>').replace(/^## (.*)$/gm,'<h2>$1</h2>').replace(/^# (.*)$/gm,'<h1>$1</h1>');
  h=h.replace(/^&gt; (.*)$/gm,'<blockquote>$1</blockquote>');
  h=h.replace(/\[\[([^\]|]+)(\|([^\]]+))?\]\]/g,(m,t,_,a)=>'<a class="wl" data-id="'+slug(t)+'">'+esc(a||t)+'</a>');
  h=h.replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2" target="_blank">$1</a>');
  h=h.replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>').replace(/`([^`]+)`/g,'<code>$1</code>');
  h=h.replace(/^\s*[-*] (.*)$/gm,'<li>$1</li>');h=h.replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g,'<ul>$1</ul>');
  h=h.replace(/^(?!<[hupbl])(.+)$/gm,'<p>$1</p>');return h;}
function openNote(id){const n=NOTE.get(id);if(!n)return;showTab('notes');
  const r=ce('reader');r.innerHTML='<h1>'+esc(n.label)+'</h1><div class="meta">'+esc(n.file)+' · '+n.out+' out · '+n.in+' in</div><button class="rm" data-file="'+esc(n.file)+'" data-label="'+esc(n.label)+'">🗑 Remove this note</button>'+md(n.body||'_(empty)_');
  r.querySelectorAll('a.wl').forEach(a=>{if(!NOTE.has(a.dataset.id))a.classList.add('dead');a.onclick=e=>{e.preventDefault();openNote(a.dataset.id);};});
  const rb=r.querySelector('.rm');if(rb)rb.onclick=()=>copyRemove(rb.dataset.file,rb.dataset.label);
  r.scrollTop=0;document.querySelectorAll('#nlist .row').forEach(x=>x.classList.toggle('on',x.dataset.id===id));}
// notes list
function buildList(q){const L=ce('nlist');L.innerHTML='';const order=['Map','Context','Knowledge','Projects','Areas','References','Decisions','Daily','Resources','Inbox'];
  const by={};DATA.nodes.filter(n=>n.real&&(!q||n.label.toLowerCase().includes(q)||(n.body||'').toLowerCase().includes(q))).forEach(n=>{(by[n.layer]=by[n.layer]||[]).push(n);});
  order.filter(l=>by[l]).forEach(l=>{const h=document.createElement('div');h.className='sect';h.textContent=l;L.appendChild(h);
    by[l].sort((a,b)=>b.deg-a.deg).forEach(n=>{const d=document.createElement('div');d.className='row';d.dataset.id=n.id;
      d.innerHTML='<span class="dot" style="background:'+n.color+'"></span>'+esc(n.label);d.onclick=()=>openNote(n.id);L.appendChild(d);});});}
// repos
function buildRepos(){const p=ce('rpane');let h='<h2 class="vh">Registered repositories</h2>';
  if(!DATA.repos.length)h+='<div class="hint">None yet. Run <code>cortex-init --register-to-vault</code> in a repo.</div>';
  DATA.repos.forEach(r=>{h+='<div class="card"><h3>'+esc(r.name)+'</h3><div class="s">'+esc(r.stack||'—')+'</div><div class="p">'+esc(r.path||'')+'</div><span class="pill">'+esc(r.status||'active')+'</span></div>';});
  p.innerHTML=h;}
// gaps
function buildGaps(){const p=ce('gpane');
  let h='<div><span class="stat"><b>'+DATA.stats.notes+'</b><span>notes</span></span><span class="stat"><b>'+DATA.stats.links+'</b><span>links</span></span><span class="stat"><b>'+DATA.stats.orphans.length+'</b><span>orphans</span></span><span class="stat"><b>'+DATA.stats.dead+'</b><span>dead</span></span></div>';
  h+='<h2 class="vh">Orphan notes — real gaps to connect</h2><div class="hint">These notes have no [[links]] in or out. A note with no links is a dead end — link each into a MOC or a related note (run <code>/reindex</code>).</div>';
  h+=DATA.stats.orphans.length?DATA.nodes.filter(n=>n.real&&n.deg===0).map(n=>'<span class="pill" data-id="'+n.id+'">'+esc(n.label)+'</span>').join(''):'<span class="hint">None 🎉 every note is connected.</span>';
  h+='<h2 class="vh" style="margin-top:22px">Dead links to fix</h2><div class="hint">Links pointing at notes that don\'t exist. Create the note, fix the typo, or remove the link.</div>';
  h+=DATA.stats.dead?DATA.stats.deadList.map(t=>'<span class="pill bad">'+esc(t)+'</span>').join(''):'<span class="hint">None 🎉</span>';
  p.innerHTML=h;p.querySelectorAll('.pill[data-id]').forEach(el=>el.onclick=()=>openNote(el.dataset.id));}
// graph
const cv=ce('cv'),ctx=cv.getContext('2d'),tip=ce('tip');let W,H,tx=0,ty=0,scale=1,query='',hover=null;
function resize(){const r=cv.getBoundingClientRect();W=cv.width=r.width;H=cv.height=r.height;}addEventListener('resize',resize);
const N=DATA.nodes.map((n,i)=>({...n,x:450+Math.cos(i)*150+(i%9)*8,y:300+Math.sin(i)*150+(i%6)*8,vx:0,vy:0}));
const M=new Map(N.map(n=>[n.id,n]));const E=DATA.edges.map(e=>({s:M.get(e.source),t:M.get(e.target)})).filter(e=>e.s&&e.t);
function step(){const k=.018,rep=2600,cx=W/2,cy=H/2;for(let i=0;i<N.length;i++){const a=N[i];for(let j=i+1;j<N.length;j++){const b=N[j];let dx=a.x-b.x,dy=a.y-b.y,d2=dx*dx+dy*dy||.01,d=Math.sqrt(d2),f=rep/d2,ux=dx/d,uy=dy/d;a.vx+=ux*f;a.vy+=uy*f;b.vx-=ux*f;b.vy-=uy*f;}a.vx+=(cx-a.x)*.0016;a.vy+=(cy-a.y)*.0016;}
  for(const e of E){let dx=e.t.x-e.s.x,dy=e.t.y-e.s.y,d=Math.sqrt(dx*dx+dy*dy)||.01,f=(d-90)*k,ux=dx/d,uy=dy/d;e.s.vx+=ux*f;e.s.vy+=uy*f;e.t.vx-=ux*f;e.t.vy-=uy*f;}
  for(const n of N){if(n===drag)continue;n.x+=n.vx*=.86;n.y+=n.vy*=.86;}}
function draw(){if(!W)return;ctx.clearRect(0,0,W,H);ctx.save();ctx.translate(tx,ty);ctx.scale(scale,scale);const q=query.trim().toLowerCase();
  const nb=new Set();if(hover){nb.add(hover.id);for(const e of E){if(e.s===hover)nb.add(e.t.id);if(e.t===hover)nb.add(e.s.id);}}
  for(const e of E){const on=hover?(e.s===hover||e.t===hover):true;ctx.strokeStyle=(e.s.real===false||e.t.real===false)?'rgba(239,68,68,'+(on?.5:.12)+')':'rgba(120,140,180,'+(on?.55:.14)+')';ctx.lineWidth=on?1.4:.7;ctx.beginPath();ctx.moveTo(e.s.x,e.s.y);ctx.lineTo(e.t.x,e.t.y);ctx.stroke();}
  for(const n of N){const mt=q&&n.label.toLowerCase().includes(q);const dim=(hover&&!nb.has(n.id))||(q&&!mt);ctx.globalAlpha=dim?.16:1;ctx.beginPath();ctx.arc(n.x,n.y,n.r,0,7);ctx.fillStyle=n.color;ctx.fill();
    if(n.real===false){ctx.lineWidth=1.2;ctx.strokeStyle='#ef4444';ctx.stroke();}if(mt){ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.stroke();}
    if(scale>.55||n.deg>2||mt||(hover&&nb.has(n.id))){ctx.globalAlpha=dim?.25:.92;ctx.fillStyle='#e6edf6';ctx.font='11px system-ui';ctx.textAlign='center';ctx.fillText(n.label.length>26?n.label.slice(0,25)+'…':n.label,n.x,n.y-n.r-4);}}
  ctx.globalAlpha=1;ctx.restore();}
function loop(){step();draw();requestAnimationFrame(loop);}
let drag=null,pan=false,px=0,py=0;function tw(mx,my){return{x:(mx-tx)/scale,y:(my-ty)/scale};}
function pick(mx,my){const p=tw(mx,my);let b=null,bd=1e9;for(const n of N){const dx=n.x-p.x,dy=n.y-p.y,d=dx*dx+dy*dy;if(d<bd&&d<(n.r+6)*(n.r+6)){bd=d;b=n;}}return b;}
cv.addEventListener('mousedown',e=>{const n=pick(e.offsetX,e.offsetY);if(n){drag=n;drag._dn=0;}else{pan=true;px=e.offsetX;py=e.offsetY;cv.style.cursor='grabbing';}});
addEventListener('mousemove',e=>{const r=cv.getBoundingClientRect();const mx=e.clientX-r.left,my=e.clientY-r.top;
  if(drag){const p=tw(mx,my);drag.x=p.x;drag.y=p.y;drag.vx=drag.vy=0;drag._dn=1;}else if(pan){tx+=mx-px;ty+=my-py;px=mx;py=my;}
  else{const n=pick(mx,my);hover=n;if(n){tip.style.display='block';tip.style.left=(e.clientX+14)+'px';tip.style.top=(e.clientY+14)+'px';tip.innerHTML='<b>'+esc(n.label)+'</b><span class="m">'+esc(n.layer)+'<br>'+esc(n.file)+'<br>'+n.out+' out · '+n.in+' in'+(n.real?'<br>click to read':'')+'</span>';}else tip.style.display='none';}});
addEventListener('mouseup',()=>{if(drag&&!drag._dn&&drag.real)openNote(drag.id);drag=null;pan=false;cv.style.cursor='grab';});
cv.addEventListener('wheel',e=>{e.preventDefault();const f=e.deltaY<0?1.1:.9;const mx=e.offsetX,my=e.offsetY;tx=mx-(mx-tx)*f;ty=my-(my-ty)*f;scale*=f;},{passive:false});
ce('q').addEventListener('input',e=>{query=e.target.value;buildList(query.trim().toLowerCase());});
buildList('');buildRepos();buildGaps();resize();loop();
</script></body></html>
HTMLB
rm -rf "$TMP"
echo "✓ wrote $OUT  ($NC notes · $EC links · $DCOUNT dead)"
# try to open in the default browser
( command -v cygstart >/dev/null && cygstart "$OUT" ) 2>/dev/null \
 || ( command -v xdg-open >/dev/null && xdg-open "$OUT" ) 2>/dev/null \
 || ( command -v open >/dev/null && open "$OUT" ) 2>/dev/null \
 || echo "  open it in your browser: $OUT"
