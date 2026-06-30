#!/usr/bin/env bash
# cortex-brain.sh — regenerate a viewable "brain" dashboard from the vault on demand.
# Aggregates the personal vault (notes/context/projects/…) AND every registered repo
# (projects/*.md that carry a `path:`), so you can SEE the whole brain + all repos in one page.
# Zero deps: pure bash. Run from the vault root:  bash tools/cortex-brain.sh  → writes brain.html
set -u
ROOT="${1:-$(pwd)}"; cd "$ROOT" || { echo "no such dir: $ROOT"; exit 1; }
OUT="$ROOT/brain.html"
esc(){ sed -e 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'; }
fm(){ awk -v k="$2" 'BEGIN{f=0} /^---[[:space:]]*$/{f++; next} f==1 && $0 ~ "^"k":" {sub("^"k":[[:space:]]*",""); print; exit}' "$1" 2>/dev/null; }
title_of(){ local t; t="$(fm "$1" title)"; [ -z "$t" ] && t="$(basename "$1" .md)"; printf '%s' "$t"; }

# ── tallies ───────────────────────────────────────────────────────────────────
ALL_MD="$(find . -type f -name '*.md' -not -path './.git/*' -not -path './node_modules/*' -not -path './.claude/*' -not -path './archives/*' -not -path './.agents/*' -not -path './.superpowers/*' -not -path './docs/*' -not -path './templates/*' -not -path './tools/*' 2>/dev/null | sort)"
FILES=$(printf '%s\n' "$ALL_MD" | grep -c . || true)
LINKS=$(printf '%s\n' "$ALL_MD" | xargs grep -ohE '\[\[[^]]+\]\]' 2>/dev/null | wc -l | tr -d ' ')
REPOS=$(grep -lER '^path:' projects 2>/dev/null | sort -u)
REPO_N=$(printf '%s\n' "$REPOS" | grep -c . || true)

# ── repo cards (registered codebase brains) ───────────────────────────────────
repo_cards=""
if [ -n "$REPOS" ]; then while IFS= read -r f; do [ -z "$f" ] && continue
  nm="$(title_of "$f")"; pth="$(fm "$f" path)"; stk="$(fm "$f" stack)"; st="$(fm "$f" status)"
  agents="$pth/AGENTS.md"
  repo_cards="$repo_cards<div class='card'><h3>$(printf '%s' "$nm" | esc)</h3>
    <div class='meta'>$(printf '%s' "${stk:-—}" | esc)</div>
    <div class='path'>$(printf '%s' "$pth" | esc)</div>
    <div class='tags'><span class='pill'>${st:-active}</span>"
  [ -n "$pth" ] && repo_cards="$repo_cards<a class='lnk' href='file:///$(printf '%s' "$agents" | sed 's#\\\\#/#g')'>AGENTS.md</a>"
  repo_cards="$repo_cards</div></div>"
done <<< "$REPOS"; else repo_cards="<p class='mut'>No repos registered yet. Run <code>cortex-init --register-to-vault</code> in a repo, or <code>/scan-projects</code>.</p>"; fi

# ── vault map grouped by layer ────────────────────────────────────────────────
layer_block(){ local dir="$1" label="$2" color="$3" rows="" f
  [ -d "$dir" ] || return
  for f in $(find "$dir" -maxdepth 1 -type f -name '*.md' 2>/dev/null | sort); do
    rows="$rows<li><b>$(title_of "$f" | esc)</b> <span class='mut'>$(printf '%s' "$f" | sed 's#^\./##' | esc)</span></li>"
  done
  [ -z "$rows" ] && return
  printf "<div class='sect'><h2><i style='background:%s'></i>%s</h2><ul>%s</ul></div>" "$color" "$label" "$rows"
}
MAP=""
MAP="$MAP$(layer_block context 'Context — who you are' '#eab308')"
MAP="$MAP$(layer_block notes 'Knowledge — atomic notes' '#3b82f6')"
MAP="$MAP$(layer_block projects 'Projects' '#f97316')"
MAP="$MAP$(layer_block areas 'Areas' '#a855f7')"
MAP="$MAP$(layer_block references 'References' '#14b8a6')"
MAP="$MAP$(layer_block decisions 'Decisions' '#b45309')"

# ── dead links (targets with no matching file) ────────────────────────────────
dead=""; seen=" "
for lk in $(printf '%s\n' "$ALL_MD" | xargs grep -ohE '\[\[[^]]+\]\]' 2>/dev/null | sed -E 's/\[\[([^]|]+).*/\1/' | sort -u); do
  base="$(printf '%s' "$lk" | tr 'A-Z' 'a-z' | tr ' ' '-')"
  if ! find . -iname "$base.md" -not -path './.git/*' 2>/dev/null | grep -q .; then
    case "$seen" in *" $lk "*) ;; *) dead="$dead<span class='pill bad'>$(printf '%s' "$lk" | esc)</span> "; seen="$seen$lk ";; esac
  fi
done
[ -z "$dead" ] && dead="<span class='mut'>none 🎉</span>"

# ── emit ──────────────────────────────────────────────────────────────────────
cat > "$OUT" << HTML
<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Cortex Brain — $(basename "$ROOT")</title><style>
:root{--bg:#0b0f1a;--panel:#131a2b;--ink:#e6edf6;--mut:#8b97ab;--line:#26324a;--acc:#6ea8fe}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.6 ui-sans-serif,system-ui,Segoe UI,Roboto;padding:28px;max-width:1100px;margin:auto}
h1{font-size:20px;margin:0 0 2px}.sub{color:var(--mut);margin-bottom:20px;font-size:12.5px}
.stats{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:24px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 16px;min-width:90px}
.stat b{display:block;font-size:22px}.stat span{color:var(--mut);font-size:11.5px;text-transform:uppercase;letter-spacing:.05em}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);margin:26px 0 10px;display:flex;align-items:center;gap:8px}
h2 i{width:11px;height:11px;border-radius:50%;display:inline-block}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px}
.card h3{margin:0 0 4px;font-size:15px}.card .meta{color:var(--acc);font-size:12px}.card .path{color:var(--mut);font-size:11px;word-break:break-all;margin:4px 0}
.pill{display:inline-block;background:#0d1322;border:1px solid var(--line);border-radius:999px;padding:2px 9px;font-size:11px;color:var(--mut);margin-right:6px}
.pill.bad{border-color:#7f1d1d;color:#fca5a5}.lnk{color:var(--acc);text-decoration:none;font-size:12px}
.sect ul{list-style:none;padding:0;margin:0}.sect li{padding:3px 0;border-bottom:1px dashed var(--line)}
.mut{color:var(--mut)}code{background:#0d1322;border:1px solid var(--line);border-radius:6px;padding:1px 6px;font-size:12px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:24px}@media(max-width:720px){.cols{grid-template-columns:1fr}}
</style></head><body>
<h1>🧠 Cortex Brain</h1>
<div class="sub">$(basename "$ROOT") · generated $(date '+%Y-%m-%d %H:%M') · re-run <code>bash tools/cortex-brain.sh</code> to refresh</div>
<div class="stats">
  <div class="stat"><b>$FILES</b><span>notes</span></div>
  <div class="stat"><b>$LINKS</b><span>links</span></div>
  <div class="stat"><b>$REPO_N</b><span>repos</span></div>
</div>
<h2><i style="background:#f97316"></i>Registered repositories (codebase brains)</h2>
<div class="grid">$repo_cards</div>
<div class="cols"><div>$MAP</div>
<div><h2><i style="background:#ef4444"></i>Dead links to fix</h2><div>$dead</div></div></div>
</body></html>
HTML
echo "✓ wrote $OUT  ($FILES notes · $LINKS links · $REPO_N repos)"
