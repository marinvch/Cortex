#!/usr/bin/env bash
# cortex-nav.sh — regenerate a LIVE navigator from the vault: an Obsidian-style force-directed
# graph of notes + [[wikilinks]], a type-to-filter search list, and an honest dead-links panel.
# Pure bash + client-side JS. No engine. Run from the vault root:  bash tools/cortex-nav.sh
set -u
ROOT="${1:-$(pwd)}"; cd "$ROOT" || { echo "no such dir: $ROOT"; exit 1; }
OUT="$ROOT/navigator.html"
TMP="$(mktemp -d)"; NODES="$TMP/nodes.tsv"; EDGES="$TMP/edges.tsv"; : > "$NODES"; : > "$EDGES"

slug(){ printf '%s' "$1" | tr 'A-Z' 'a-z' | sed -E 's/\.md$//; s/[^a-z0-9]+/-/g; s/^-+|-+$//g'; }
fmtitle(){ awk 'BEGIN{f=0} /^---[[:space:]]*$/{f++; next} f==1 && /^title:/{sub(/^title:[[:space:]]*/,""); gsub(/^"|"$/,""); print; exit}' "$1"; }
layer_of(){ case "$1" in context) echo Context;; notes) echo Knowledge;; projects) echo Projects;; areas) echo Areas;; references) echo References;; decisions) echo Decisions;; daily) echo Daily;; resources) echo Resources;; inbox) echo Inbox;; .) echo Map;; *) echo "$1";; esac; }
color_of(){ case "$1" in Context) echo '#eab308';; Knowledge) echo '#3b82f6';; Projects) echo '#f97316';; Areas) echo '#a855f7';; References) echo '#14b8a6';; Decisions) echo '#b45309';; Daily) echo '#06b6d4';; Resources) echo '#10b981';; Inbox) echo '#64748b';; Map) echo '#ec4899';; *) echo '#8b97ab';; esac; }

# ── pass 1: real note nodes (exclude noise + example/template files) ──────────
FILES="$(find . -type f -name '*.md' \
  -not -path './.git/*' -not -path './node_modules/*' -not -path './.claude/*' \
  -not -path './.agents/*' -not -path './.superpowers/*' -not -path './docs/*' \
  -not -path './archives/*' -not -path './templates/*' -not -path './tools/*' \
  -not -name '*.example.md' 2>/dev/null | sort)"
while IFS= read -r f; do
  [ -z "$f" ] && continue
  rel="${f#./}"; id="$(slug "$(basename "$f")")"; [ -z "$id" ] && continue
  t="$(fmtitle "$f")"; [ -z "$t" ] && t="$(basename "$f" .md)"
  top="${rel%%/*}"; [ "$top" = "$rel" ] && top="."
  lay="$(layer_of "$top")"
  printf '%s\t%s\t%s\t%s\n' "$id" "$t" "$rel" "$lay" >> "$NODES"
done <<< "$FILES"
KNOWN="$TMP/known"; cut -f1 "$NODES" | sort -u > "$KNOWN"

# ── pass 2: edges from [[wikilinks]] (skip code fences + HTML-comment lines) ──
while IFS= read -r f; do
  [ -z "$f" ] && continue
  sid="$(slug "$(basename "$f")")"
  awk '
    /^[[:space:]]*```/{infence=!infence; next}
    infence{next}
    /<!--/{next}
    { gsub(/`[^`]*`/,"");
      while (match($0,/\[\[[^]]+\]\]/)) {
        ln=substr($0,RSTART+2,RLENGTH-4); sub(/\|.*/,"",ln); sub(/#.*/,"",ln);
        print ln; $0=substr($0,RSTART+RLENGTH) } }
  ' "$f" | while IFS= read -r tgt; do
      [ -z "$tgt" ] && continue
      tid="$(slug "$tgt")"; [ -z "$tid" ] && continue
      [ "$tid" = "$sid" ] && continue
      printf '%s\t%s\n' "$sid" "$tid" >> "$EDGES"
  done
done <<< "$FILES"
sort -u "$EDGES" -o "$EDGES"

# ── build JSON (nodes incl. dead targets, edges, stats) ───────────────────────
jesc(){ sed -e 's/\\/\\\\/g; s/"/\\"/g'; }
# degree counts
DEG="$TMP/deg"; { cut -f1 "$EDGES"; cut -f2 "$EDGES"; } | sort | uniq -c > "$DEG"
deg(){ awk -v k="$1" '$2==k{print $1; exit}' "$DEG"; }
outd(){ grep -c "^$1	" "$EDGES"; }
ind(){ grep -c "	$1\$" "$EDGES"; }

NODE_JSON=""; DEAD_JSON=""; ORPH=""
# real nodes
while IFS=$'\t' read -r id label file lay; do
  [ -z "$id" ] && continue
  c="$(color_of "$lay")"; o="$(outd "$id")"; i="$(ind "$id")"; d=$((o+i)); r=$((4 + (d>8?8:d)))
  el="$(printf '%s' "$label" | jesc)"; ef="$(printf '%s' "$file" | jesc)"
  NODE_JSON="$NODE_JSON{\"id\":\"$id\",\"label\":\"$el\",\"file\":\"$ef\",\"layer\":\"$lay\",\"color\":\"$c\",\"real\":true,\"r\":$r,\"deg\":$d,\"out\":$o,\"in\":$i},"
  [ "$d" -eq 0 ] && ORPH="$ORPH\"$el\","
done < "$NODES"
# dead targets (linked but no file)
DEAD_LIST=""
for tid in $(cut -f2 "$EDGES" | sort -u); do
  if ! grep -qx "$tid" "$KNOWN"; then
    i="$(ind "$tid")"
    NODE_JSON="$NODE_JSON{\"id\":\"$tid\",\"label\":\"$tid\",\"file\":\"(no file — dead link)\",\"layer\":\"Missing\",\"color\":\"#ef4444\",\"real\":false,\"r\":4,\"deg\":$i,\"out\":0,\"in\":$i},"
    DEAD_JSON="$DEAD_JSON\"$tid\","; DEAD_LIST="$DEAD_LIST $tid"
  fi
done
EDGE_JSON=""
while IFS=$'\t' read -r s t; do [ -z "$s" ] && continue; EDGE_JSON="$EDGE_JSON{\"source\":\"$s\",\"target\":\"$t\"},"; done < "$EDGES"
NCOUNT=$(wc -l < "$NODES" | tr -d ' '); ECOUNT=$(wc -l < "$EDGES" | tr -d ' ')
DCOUNT=$(printf '%s' "$DEAD_LIST" | wc -w | tr -d ' ')
DATA="{\"nodes\":[${NODE_JSON%,}],\"edges\":[${EDGE_JSON%,}],\"stats\":{\"notes\":$NCOUNT,\"links\":$ECOUNT,\"dead\":$DCOUNT,\"deadList\":[${DEAD_JSON%,}],\"orphans\":[${ORPH%,}]}}"

# ── emit HTML ─────────────────────────────────────────────────────────────────
cat > "$OUT" <<'HTMLA'
<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/><title>Cortex Navigator</title><style>
:root{--bg:#0b0f1a;--panel:#131a2b;--ink:#e6edf6;--mut:#8b97ab;--line:#26324a;--acc:#6ea8fe}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--bg);color:var(--ink);font:14px/1.5 ui-sans-serif,system-ui,Segoe UI,Roboto}
#wrap{display:flex;height:100vh}#side{width:320px;flex:0 0 320px;border-right:1px solid var(--line);padding:16px;overflow:auto;background:var(--panel)}
h1{font-size:15px;margin:0 0 2px}.sub{color:var(--mut);font-size:11.5px;margin-bottom:12px}
.stats{display:flex;gap:8px;margin-bottom:12px}.stat{background:#0d1322;border:1px solid var(--line);border-radius:8px;padding:6px 10px;flex:1}.stat b{display:block;font-size:18px}.stat span{font-size:10px;color:var(--mut);text-transform:uppercase}
#search{width:100%;padding:9px 11px;border-radius:8px;border:1px solid var(--line);background:#0d1322;color:var(--ink);margin-bottom:8px}
.sect{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);margin:14px 0 6px}
#list{list-style:none;padding:0;margin:0}#list li{padding:4px 6px;border-radius:6px;cursor:pointer;font-size:12.5px;display:flex;align-items:center;gap:7px}
#list li:hover{background:#0d1322}.dot{width:9px;height:9px;border-radius:50%;flex:0 0 9px}.lf{color:var(--mut);font-size:10.5px;margin-left:auto}
.pill{display:inline-block;background:#0d1322;border:1px solid var(--line);border-radius:999px;padding:2px 8px;margin:2px 3px 0 0;font-size:11px;color:var(--mut)}
.pill.bad{border-color:#7f1d1d;color:#fca5a5}#cv{flex:1;display:block;cursor:grab}
#tip{position:fixed;pointer-events:none;background:#0d1322;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:12px;max-width:280px;display:none;box-shadow:0 8px 24px #0008;z-index:10}#tip b{display:block;margin-bottom:2px}#tip .m{color:var(--mut);font-size:11px}
.hint{color:var(--mut);font-size:10.5px;margin-top:14px;line-height:1.7}a{color:var(--acc)}
</style></head><body><div id="wrap"><aside id="side">
<h1>🧠 Cortex Navigator</h1><div class="sub" id="gen"></div>
<div class="stats"><div class="stat"><b id="s-n"></b><span>notes</span></div><div class="stat"><b id="s-l"></b><span>links</span></div><div class="stat"><b id="s-d"></b><span>dead</span></div></div>
<input id="search" placeholder="Type to find a note…" autocomplete="off"/>
<div class="sect">Notes</div><ul id="list"></ul>
<div class="sect" id="dead-h" style="display:none">Dead links (placeholders excluded)</div><div id="dead"></div>
<div class="hint">Drag to pan · scroll to zoom · drag a node to pull it · hover for details · click a note to open it.<br>Re-run <code>bash tools/cortex-nav.sh</code> to refresh.</div>
</aside><canvas id="cv"></canvas></div><div id="tip"></div><script>
HTMLA
printf 'const DATA=%s;\n' "$DATA" >> "$OUT"
cat >> "$OUT" <<'HTMLB'
const cv=document.getElementById('cv'),ctx=cv.getContext('2d'),tip=document.getElementById('tip');
let W,H,tx=0,ty=0,scale=1,query='',hover=null;
function resize(){const r=cv.getBoundingClientRect();W=cv.width=r.width;H=cv.height=r.height;}addEventListener('resize',resize);
const byId=new Map(DATA.nodes.map(n=>[n.id,n]));
const N=DATA.nodes.map((n,i)=>({...n,x:(typeof W==='number'?W:900)/2+Math.cos(i)*140+(i%9)*8,y:(typeof H==='number'?H:600)/2+Math.sin(i)*140+(i%6)*8,vx:0,vy:0}));
const NMAP=new Map(N.map(n=>[n.id,n]));
const E=DATA.edges.map(e=>({s:NMAP.get(e.source),t:NMAP.get(e.target)})).filter(e=>e.s&&e.t);
function esc(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
document.getElementById('gen').textContent=DATA.stats.notes+' notes · generated now';
document.getElementById('s-n').textContent=DATA.stats.notes;document.getElementById('s-l').textContent=DATA.stats.links;document.getElementById('s-d').textContent=DATA.stats.dead;
if(DATA.stats.deadList.length){document.getElementById('dead-h').style.display='';document.getElementById('dead').innerHTML=DATA.stats.deadList.map(t=>'<span class="pill bad">'+esc(t)+'</span>').join('');}
// search list
const listEl=document.getElementById('list');
function renderList(){const q=query.trim().toLowerCase();listEl.innerHTML='';
  DATA.nodes.filter(n=>n.real&&(!q||n.label.toLowerCase().includes(q)||n.file.toLowerCase().includes(q))).sort((a,b)=>b.deg-a.deg).slice(0,200).forEach(n=>{
    const li=document.createElement('li');li.innerHTML='<span class="dot" style="background:'+n.color+'"></span>'+esc(n.label)+'<span class="lf">'+esc(n.layer)+'</span>';
    li.onclick=()=>{const t=NMAP.get(n.id);if(t){tx=W/2-t.x*scale;ty=H/2-t.y*scale;}window.open('file:///'+n.file.replace(/\\/g,'/'),'_blank');};
    li.onmouseenter=()=>{hover=NMAP.get(n.id);};li.onmouseleave=()=>{hover=null;};listEl.appendChild(li);});}
function step(){const k=0.018,rep=2600,cx=W/2,cy=H/2;
  for(let i=0;i<N.length;i++){const a=N[i];for(let j=i+1;j<N.length;j++){const b=N[j];
    let dx=a.x-b.x,dy=a.y-b.y,d2=dx*dx+dy*dy||0.01,d=Math.sqrt(d2),f=rep/d2,ux=dx/d,uy=dy/d;a.vx+=ux*f;a.vy+=uy*f;b.vx-=ux*f;b.vy-=uy*f;}
    a.vx+=(cx-a.x)*0.0016;a.vy+=(cy-a.y)*0.0016;}
  for(const e of E){let dx=e.t.x-e.s.x,dy=e.t.y-e.s.y,d=Math.sqrt(dx*dx+dy*dy)||0.01,f=(d-90)*k,ux=dx/d,uy=dy/d;e.s.vx+=ux*f;e.s.vy+=uy*f;e.t.vx-=ux*f;e.t.vy-=uy*f;}
  for(const n of N){if(n===drag)continue;n.x+=n.vx*=0.86;n.y+=n.vy*=0.86;}}
function draw(){ctx.clearRect(0,0,W,H);ctx.save();ctx.translate(tx,ty);ctx.scale(scale,scale);
  const q=query.trim().toLowerCase();const nbr=new Set();if(hover){nbr.add(hover.id);for(const e of E){if(e.s===hover)nbr.add(e.t.id);if(e.t===hover)nbr.add(e.s.id);}}
  for(const e of E){const on=hover?(e.s===hover||e.t===hover):true;ctx.strokeStyle=(e.s.real===false||e.t.real===false)?'rgba(239,68,68,'+(on?0.5:0.12)+')':'rgba(120,140,180,'+(on?0.55:0.14)+')';ctx.lineWidth=on?1.4:0.7;ctx.beginPath();ctx.moveTo(e.s.x,e.s.y);ctx.lineTo(e.t.x,e.t.y);ctx.stroke();}
  for(const n of N){const match=q&&n.label.toLowerCase().includes(q);const dim=(hover&&!nbr.has(n.id))||(q&&!match);ctx.globalAlpha=dim?0.16:1;
    ctx.beginPath();ctx.arc(n.x,n.y,n.r,0,7);ctx.fillStyle=n.color;ctx.fill();
    if(n.real===false){ctx.lineWidth=1.2;ctx.strokeStyle='#ef4444';ctx.stroke();}if(match){ctx.lineWidth=2;ctx.strokeStyle='#fff';ctx.stroke();}
    if(scale>0.55||n.deg>2||match||(hover&&nbr.has(n.id))){ctx.globalAlpha=dim?0.25:0.92;ctx.fillStyle='#e6edf6';ctx.font='11px system-ui';ctx.textAlign='center';ctx.fillText(n.label.length>26?n.label.slice(0,25)+'…':n.label,n.x,n.y-n.r-4);}}
  ctx.globalAlpha=1;ctx.restore();}
function loop(){step();draw();requestAnimationFrame(loop);}
let drag=null,panning=false,px=0,py=0;
function toWorld(mx,my){return{x:(mx-tx)/scale,y:(my-ty)/scale};}
function pick(mx,my){const p=toWorld(mx,my);let best=null,bd=1e9;for(const n of N){const dx=n.x-p.x,dy=n.y-p.y,d=dx*dx+dy*dy;if(d<bd&&d<(n.r+6)*(n.r+6)){bd=d;best=n;}}return best;}
cv.addEventListener('mousedown',e=>{const n=pick(e.offsetX,e.offsetY);if(n){drag=n;}else{panning=true;px=e.offsetX;py=e.offsetY;cv.style.cursor='grabbing';}});
addEventListener('mousemove',e=>{const r=cv.getBoundingClientRect();const mx=e.clientX-r.left,my=e.clientY-r.top;
  if(drag){const p=toWorld(mx,my);drag.x=p.x;drag.y=p.y;drag.vx=drag.vy=0;}else if(panning){tx+=mx-px;ty+=my-py;px=mx;py=my;}
  else{const n=pick(mx,my);hover=n;if(n){tip.style.display='block';tip.style.left=(e.clientX+14)+'px';tip.style.top=(e.clientY+14)+'px';tip.innerHTML='<b>'+esc(n.label)+'</b><span class="m">'+esc(n.layer)+'<br>'+esc(n.file)+'<br>'+n.out+' out · '+n.in+' in</span>';}else tip.style.display='none';}});
addEventListener('mouseup',()=>{drag=null;panning=false;cv.style.cursor='grab';});
cv.addEventListener('wheel',e=>{e.preventDefault();const f=e.deltaY<0?1.1:0.9;const mx=e.offsetX,my=e.offsetY;tx=mx-(mx-tx)*f;ty=my-(my-ty)*f;scale*=f;},{passive:false});
document.getElementById('search').addEventListener('input',e=>{query=e.target.value;renderList();});
resize();renderList();loop();
</script></body></html>
HTMLB
rm -rf "$TMP"
echo "✓ wrote $OUT  ($NCOUNT notes · $ECOUNT links · $DCOUNT dead)"
