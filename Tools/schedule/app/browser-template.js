/* browser-template.js — part of the School Layout Visualizer.
   Was lines 17670-18789 of Tools/schedule-visualizer.html. Cut out verbatim; the
   text below is byte-identical to what was inline, because the publish path
   puts br* function source into published files via Function.prototype.toString()
   and because the acorn equivalence check in schedule/test/structure.mjs
   compares this source against the original.

   Classic <script>, not a module. Top-level const/let bind in the shared
   global lexical scope, so declarations here are visible to every later file.
   LOAD ORDER IS SOURCE ORDER and must stay that way: the tool runs 148
   top-level statements, including DOM listener wiring that binds at parse time.
   See the <script src> list at the bottom of schedule-visualizer.html. */

/* ===== ROUND 41: SCHEDULE BROWSER JS ===== */

/* R60: single-source stylesheet — used by the live embedded browser (injected
   below) and copied verbatim into published standalone files by brPublish(). */
const BR_CSS = `#app-browser {
  display:none; /* shown by toggleApp() */
  font-family:'Public Sans',system-ui,sans-serif;
  color:#283831; margin:0; padding:30px 18px 90px; font-size:16px; line-height:1.5;
  background:linear-gradient(180deg,#eef3ee 0%,#f4f7f4 240px,#f4f7f4 100%);
  min-height:100vh; box-sizing:border-box;
  --br-forest:#0c4b31; --br-forest-2:#155f3e; --br-forest-deep:#08381f;
  --br-gold:#f3c63f; --br-gold-soft:#d9ca98; --br-gold-line:#ece2c5;
  --br-cream:#fcfaf2; --br-paper:#f6f8f5; --br-ink:#283831; --br-muted:#62756a;
  --br-line:#e8eee9; --br-shadow:0 12px 34px -16px rgba(8,56,31,.30);
  --br-ela:#2563eb; --br-math:#c2520f; --br-sci:#0d7c69; --br-ss:#7c3aa8; --br-scsi:#71641f;
}
#app-browser *{box-sizing:border-box}
#app-browser .br-wrap{max-width:1040px;margin:0 auto}
#app-browser .mast{
  background:linear-gradient(165deg,var(--br-forest) 0%,var(--br-forest-deep) 100%);
  color:#fff;border-radius:16px 16px 0 0;padding:30px 36px;
  display:flex;align-items:center;gap:16px;border-bottom:4px solid var(--br-gold);
}
#app-browser .mast .seal{width:50px;height:50px;border-radius:50%;flex:none;
  background:radial-gradient(circle at 36% 32%,var(--br-gold),#c9a426);
  display:grid;place-items:center;font-family:'Fraunces',serif;font-weight:600;color:var(--br-forest-deep);
  font-size:21px;box-shadow:inset 0 0 0 3px rgba(255,255,255,.25);}
#app-browser .mast h1{font-family:'Fraunces',serif;font-weight:600;margin:0;font-size:27px;line-height:1.05}
#app-browser .mast .sub{margin:4px 0 0;color:var(--br-gold);font-weight:600;font-size:12px;letter-spacing:2px;text-transform:uppercase}
#app-browser .mast{justify-content:flex-start}
#app-browser .br-back-btn{
  margin-left:auto;display:inline-flex;align-items:center;gap:7px;
  font-family:'DM Sans',system-ui,sans-serif;font-size:13px;font-weight:700;
  color:var(--br-forest-deep);background:var(--br-gold);
  border:none;border-radius:9px;padding:9px 16px;cursor:pointer;
  letter-spacing:.3px;white-space:nowrap;flex-shrink:0;
  box-shadow:0 2px 8px rgba(0,0,0,.18);
  transition:background .18s,transform .12s,box-shadow .18s;
}
#app-browser .br-back-btn:hover{background:#f7d050;box-shadow:0 4px 14px rgba(0,0,0,.22);transform:translateY(-1px)}
#app-browser .br-back-btn:active{transform:translateY(0);box-shadow:0 1px 4px rgba(0,0,0,.18)}
#app-browser .panel{background:#fff;border:1px solid var(--br-gold-soft);border-top:none;border-radius:0 0 16px 16px;box-shadow:var(--br-shadow)}
#app-browser .toolbar{padding:20px 30px;background:var(--br-cream);border-bottom:1px solid var(--br-gold-line);
  display:flex;flex-wrap:wrap;gap:14px 20px;align-items:flex-end}
#app-browser .mode{display:inline-flex;background:#fff;border:1px solid var(--br-gold-soft);border-radius:11px;padding:3px}
#app-browser .mode button{font:inherit;font-weight:600;font-size:14px;border:none;background:none;color:var(--br-muted);
  padding:9px 18px;border-radius:8px;cursor:pointer;transition:.18s}
#app-browser .mode button.on{background:var(--br-forest);color:#fff}
#app-browser .br-field{display:flex;flex-direction:column;gap:6px;min-width:250px;flex:1}
#app-browser .br-field label{font-size:13px;font-weight:700;color:var(--br-forest)}
#app-browser .searchbox{position:relative}
#app-browser .searchbox input{width:100%;font:inherit;font-size:16px;font-weight:500;padding:12px 15px;border-radius:10px;
  border:1px solid var(--br-gold-soft);background:#fff;color:var(--br-forest);outline:none;transition:.18s}
#app-browser .searchbox input::placeholder{color:#9aa89f;font-weight:400}
#app-browser .searchbox input:focus{border-color:var(--br-forest);box-shadow:0 0 0 3px rgba(12,75,49,.13)}
#app-browser .br-menu{position:absolute;z-index:9000;top:calc(100% + 6px);left:0;right:0;background:#fff;
  border:1px solid var(--br-gold-soft);border-radius:12px;
  box-shadow:0 20px 46px -18px rgba(8,56,31,.45);max-height:min(60vh,360px);overflow:auto;display:none}
#app-browser .br-menu.show{display:block}
#app-browser .br-menu .grp{font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;
  color:var(--br-muted);padding:12px 16px 5px;position:sticky;top:0;background:#fff}
#app-browser .br-menu .opt{padding:11px 16px;cursor:pointer;display:flex;align-items:center;gap:11px;font-size:15.5px;font-weight:500}
#app-browser .br-menu .opt:hover,#app-browser .br-menu .opt.active{background:var(--br-paper)}
#app-browser .br-menu .opt .tag{font-size:12.5px;color:var(--br-muted);margin-left:auto}
#app-browser .br-dot{width:10px;height:10px;border-radius:50%;flex:none}
#app-browser .btn-print{font:inherit;font-weight:600;font-size:13.5px;border:1px solid var(--br-gold-soft);background:#fff;
  color:var(--br-forest);padding:11px 17px;border-radius:10px;cursor:pointer;transition:.18s}
#app-browser .btn-print:hover{background:var(--br-forest);color:#fff;border-color:var(--br-forest)}
#app-browser .stage{padding:34px 34px 30px}
#app-browser .br-empty{text-align:center;color:var(--br-muted);padding:40px 20px}
/* font-weight:600 is explicit so this matches the other nine Fraunces rules.
   It used to inherit 400, which no loaded face provided, so it silently
   resolved to a lighter weight than every other heading. One weight shipped
   instead of two. */
#app-browser .br-empty .big{font-family:'Fraunces',serif;font-weight:600;font-size:22px;color:var(--br-forest);margin-bottom:8px}
#app-browser .br-view{display:none;animation:br-rise .4s ease-out}
#app-browser .br-view.show{display:block}
@keyframes br-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
#app-browser .idhead{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:8px}
#app-browser .idhead .ibadge{width:56px;height:56px;border-radius:13px;flex:none;display:grid;place-items:center;
  font-family:'Fraunces',serif;font-weight:600;font-size:23px;color:#fff}
#app-browser .idhead h2{font-family:'Fraunces',serif;font-weight:600;font-size:28px;margin:0;color:var(--br-forest);line-height:1.05}
#app-browser .idhead .role{font-size:15px;font-weight:600;margin-top:3px}
#app-browser .factline{color:var(--br-muted);font-size:15px;margin:4px 0 28px}
#app-browser .factline b{color:var(--br-forest);font-weight:600}
#app-browser .days{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin:0 0 8px}
@media(max-width:720px){#app-browser .days{grid-template-columns:1fr}}
#app-browser .daycard{border:1px solid var(--br-line);border-radius:13px;overflow:hidden;background:#fff}
#app-browser .daycard h3{margin:0;font-family:'Public Sans';font-size:15px;font-weight:700;letter-spacing:.5px;
  padding:13px 18px;color:#fff;background:var(--br-forest)}
#app-browser .daycard.B h3{background:#4d5f3f}
#app-browser .blockrow{display:flex;align-items:center;border-top:1px solid var(--br-line);min-height:56px}
#app-browser .blockrow .bk{width:62px;flex:none;text-align:center;padding:10px 0;border-right:1px solid var(--br-line);color:var(--br-muted)}
#app-browser .blockrow .bk .n{font-family:'Fraunces',serif;font-weight:600;font-size:20px;color:var(--br-forest);display:block;line-height:1}
#app-browser .blockrow .bk .t{font-size:10.5px;letter-spacing:.4px}
#app-browser .blockrow .cell{flex:1;padding:10px 18px}
#app-browser .blockrow .cell .sec{font-weight:700;font-size:18px;color:var(--br-ink)}
#app-browser .blockrow .cell .who{font-size:13px;color:var(--br-muted);margin-top:1px}
#app-browser .blockrow.plan .cell{color:#9a8430;font-style:italic;font-weight:600;background:#fdfaef}
#app-browser .block-title{font-family:'Fraunces',serif;font-size:19px;color:var(--br-forest);margin:30px 0 4px;font-weight:600}
#app-browser .hint{color:var(--br-muted);font-size:14.5px;margin:0 0 14px}
#app-browser .classrow{display:flex;flex-wrap:wrap;gap:9px}
#app-browser .gchip{border:1px solid var(--br-gold-soft);background:#fff;border-radius:10px;padding:9px 15px;cursor:pointer;
  font-weight:600;font-size:15.5px;color:var(--br-forest);transition:.15s;font-family:inherit}
#app-browser .gchip:hover{background:var(--br-forest);color:#fff;border-color:var(--br-forest)}
#app-browser .team{display:grid;grid-template-columns:repeat(auto-fill,minmax(228px,1fr));gap:13px;margin-top:4px}
#app-browser .tcard{border:1px solid var(--br-line);border-left:5px solid var(--br-forest);border-radius:11px;padding:14px 16px;
  background:#fff;cursor:pointer;transition:.15s;text-align:left;width:100%;font:inherit}
#app-browser .tcard:hover{background:var(--br-paper);box-shadow:0 8px 18px -12px rgba(8,56,31,.4)}
#app-browser .tcard .nm{font-family:'Fraunces',serif;font-weight:600;font-size:18px;color:var(--br-forest)}
#app-browser .tcard .sj{font-size:14px;font-weight:600;margin-top:2px}
#app-browser .tcard .rm{font-size:13px;color:var(--br-muted);margin-top:7px}
#app-browser .gtable{width:100%;border-collapse:collapse;margin-top:4px;font-size:15.5px;border:1px solid var(--br-line);border-radius:12px;overflow:hidden}
#app-browser .gtable th{font-size:12px;letter-spacing:.5px;text-transform:uppercase;color:var(--br-muted);text-align:left;
  padding:11px 16px;background:var(--br-cream);border-bottom:1px solid var(--br-gold-line)}
#app-browser .gtable td{padding:13px 16px;border-bottom:1px solid var(--br-line)}
#app-browser .gtable tr:last-child td{border-bottom:none}
#app-browser .gtable .subj{font-weight:700}
#app-browser .gtable .lnk{font:inherit;font-weight:700;font-size:15.5px;background:none;border:none;color:var(--br-forest);
  cursor:pointer;padding:0;text-decoration:underline;text-decoration-color:var(--br-gold-soft);text-underline-offset:3px}
#app-browser .gtable .lnk:hover{text-decoration-color:var(--br-forest)}
#app-browser .overview{margin-top:34px;border-top:1px solid var(--br-line);padding-top:8px}
#app-browser .overview summary{cursor:pointer;font-weight:600;font-size:14.5px;color:var(--br-muted);padding:10px 2px;list-style:none}
#app-browser .overview summary::-webkit-details-marker{display:none}
#app-browser .overview summary::before{content:"▸ ";color:var(--br-gold-soft)}
#app-browser .overview[open] summary::before{content:"▾ "}
#app-browser .snap{padding:10px 2px 4px}
#app-browser .snap .row{display:flex;align-items:center;gap:12px;margin:11px 0}
#app-browser .snap .lbl{width:130px;flex:none;font-weight:600;font-size:14px}
#app-browser .snap .track{flex:1;height:24px;background:var(--br-paper);border-radius:6px;overflow:hidden}
#app-browser .snap .fill{height:100%;border-radius:6px;display:flex;align-items:center;padding-left:10px;color:#fff;font-size:12.5px;font-weight:700}
#app-browser .snap .cnt{width:92px;flex:none;font-size:13px;color:var(--br-muted)}
#app-browser .snap .note{font-size:13.5px;color:var(--br-muted);margin:14px 0 0;line-height:1.6}
#app-browser .footnote{color:var(--br-muted);font-size:12.5px;margin:22px 6px 0;line-height:1.6;text-align:center}
/* Building map */
#app-browser .maptop{display:flex;flex-wrap:wrap;gap:14px 18px;align-items:center;justify-content:space-between;margin-bottom:6px}
#app-browser .maptop h2{font-family:'Fraunces',serif;font-weight:600;font-size:26px;margin:0;color:var(--br-forest)}
#app-browser .maptop .role{font-size:14.5px;color:var(--br-muted);margin-top:3px}
#app-browser .floortabs{display:inline-flex;background:var(--br-cream);border:1px solid var(--br-gold-soft);border-radius:11px;padding:3px}
#app-browser .floortabs button{font:inherit;font-weight:600;font-size:13.5px;border:none;background:none;color:var(--br-muted);
  padding:8px 15px;border-radius:8px;cursor:pointer;transition:.18s}
#app-browser .floortabs button.on{background:var(--br-forest);color:#fff}
#app-browser .maphint{color:var(--br-muted);font-size:14px;margin:2px 0 14px}
#app-browser .maplegend{display:flex;flex-wrap:wrap;gap:7px 16px;margin:0 0 16px;font-size:13px}
#app-browser .maplegend .lg{display:inline-flex;align-items:center;gap:7px;color:var(--br-ink);font-weight:600}
#app-browser .maplegend .sw{width:13px;height:13px;border-radius:4px;flex:none}
#app-browser .maplegend .sw.ctx{background:#eef2ee;border:1px solid #d4ddd5}
/* Below 900px the floor plan draws at 1:1 and this box scrolls sideways (see
   the .geoplan min-width rule and the comment on brGeoFloorSVG). Nothing told
   a phone user that. On East Middle's first floor the visible slice happens to
   end on a room boundary, so a cropped map looks like a whole one.

   The usual pure-CSS answer is four background layers on the scroller, two
   cover patches attached local and two shadows attached scroll, so each shadow
   uncovers only when there is more map that way. It was built and measured
   here and it does not work on this element. The scrollable area is 568px on a
   375px phone (16 + 536 + 16) and .geoplan spans scroll-x 17 to 552, so the
   SVG's own opaque background rect covers both gutters the whole time. Painting
   the layers in solid colours put them in exactly the right places, underneath
   the map. Anything that has to sit on top of scrolled content cannot be the
   scroller's own background.

   So: an overlay on a wrapper instead, one shadow on the trailing edge, shown
   only under 900px. That is precisely the width where .geoplan gets its
   min-width and the box starts scrolling, so the cue appears exactly when
   there is scrolling to do.

   What this gives up: it stays lit when you reach the far right end, where
   the accurate version would have covered it. Removing that needs either JS or
   a scroll-driven animation, and neither is worth it for a hint. */
#app-browser .mapshell{position:relative}
#app-browser .mapshell::after{content:'';position:absolute;top:1px;right:1px;bottom:1px;width:26px;
  border-radius:0 13px 13px 0;pointer-events:none;display:none;
  background:linear-gradient(to left,rgba(44,62,50,.24),rgba(44,62,50,.09) 45%,rgba(44,62,50,0))}
@media(max-width:900px){#app-browser .mapshell::after{display:block}}
#app-browser .mapscroll{overflow-x:auto;border:1px solid var(--br-line);border-radius:14px;background:
  radial-gradient(circle at 20% 0,#fbfdfb,#f4f7f4);padding:14px 16px;-webkit-overflow-scrolling:touch}
#app-browser .floorplan{display:block}
#app-browser .corridor-t{font-family:'Public Sans';font-size:11px;font-weight:600;fill:#9aa89f;letter-spacing:.5px}
#app-browser .rcell .rbox{stroke-width:1.6;transition:.16s}
#app-browser .rcell .racc{transition:.16s}
#app-browser .rcell.ctx .rbox{fill:#f3f6f3;stroke:#d8e0d9}
#app-browser .rcell.ctx .rid{font-family:'Public Sans';font-weight:600;fill:#9fb0a4}
#app-browser .rcell.ctx .rnote{font-family:'Public Sans';font-style:italic;fill:#aebcb1}
#app-browser .rcell.live{cursor:pointer}
#app-browser .rcell.live:hover{filter:drop-shadow(0 0 7px var(--rc))}
#app-browser .rcell.live:hover .rbox{stroke-width:2.6;fill-opacity:.26}
#app-browser .rcell.live:hover .racc{width:8px}
#app-browser .rcell.here .rbox{fill-opacity:.30;stroke-width:2.6}
#app-browser .rcell .ring{fill:none;stroke:var(--rc);opacity:0}
#app-browser .rcell.here .ring{opacity:1;animation:br-pulsering 1.7s ease-in-out infinite}
@keyframes br-pulsering{0%,100%{opacity:.28;stroke-width:1.6}50%{opacity:.95;stroke-width:3.6}}
#app-browser .mini-wrap{display:flex;gap:18px;flex-wrap:wrap;align-items:stretch;margin-top:4px}
#app-browser .mini-card{flex:1;min-width:280px;border:1px solid var(--br-line);border-radius:14px;overflow:hidden;background:
  radial-gradient(circle at 20% 0,#fbfdfb,#f5f8f5)}
#app-browser .mini-card .mhd{font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--br-muted);
  padding:11px 16px;border-bottom:1px solid var(--br-line);background:var(--br-cream)}
#app-browser .mini-card .msvg{padding:12px}
#app-browser .mini-side{flex:0 0 220px;min-width:200px;display:flex;flex-direction:column;justify-content:center;gap:12px;
  border:1px solid var(--br-line);border-radius:14px;padding:18px;background:#fff}
#app-browser .mini-side .where{font-size:14px;color:var(--br-muted);line-height:1.5}
#app-browser .mini-side .where b{color:var(--br-forest)}
#app-browser .mini-side .roomtag{font-family:'Fraunces',serif;font-size:30px;font-weight:600;line-height:1}
#app-browser .mini-side .floortag{font-size:13.5px;font-weight:600;color:var(--br-muted)}
#app-browser .btn-map{font:inherit;font-weight:600;font-size:14px;border:1px solid var(--br-forest);background:var(--br-forest);
  color:#fff;padding:11px 16px;border-radius:10px;cursor:pointer;transition:.18s;text-align:center}
#app-browser .btn-map:hover{background:var(--br-forest-2)}
#app-browser .offmap{padding:22px;color:var(--br-muted);font-size:14.5px;line-height:1.6}
#app-browser .offmap b{color:var(--br-forest)}
@media(max-width:620px){#app-browser .mini-side{flex:1 1 100%}}
@media print{
  #app-browser .toolbar,#app-browser .btn-print,#app-browser .br-menu,
  #app-browser .overview,#app-browser .footnote,#btn-toggle-app,#btn-open-schedule-browser{display:none!important}
  #app-browser .mast,#app-browser .panel{box-shadow:none;border-radius:0;border:none}
  #app-browser .tcard,#app-browser .gchip{cursor:default}
  #app-browser .br-view{display:none!important}#app-browser .br-view.show{display:block!important}

  /* The map printed cropped. .mapscroll is overflow-x:auto, and print clips
     overflow rather than paginating it sideways, so on any window narrow
     enough to scroll, whatever was off to the right was simply absent from
     the paper. The floor tabs printed too, as dead grey buttons.

     Drop the scroller in print and let the SVG scale to the sheet: it has a
     viewBox, so width:100% with the min-width off gives the whole floor at
     whatever size the page allows. The affordance background goes with it,
     since its shadows would print as smudges down both margins. */
  #app-browser .mapscroll{overflow:visible!important;border:none;background:none;padding:0}
  #app-browser .geoplan,#app-browser .floorplan{min-width:0!important;width:100%!important;height:auto}
  #app-browser .floortabs,#app-browser .daychips,
  #app-browser .mapshell::after{display:none!important}
  #app-browser .tscroll{overflow:visible!important}
  #app-browser .gtable{min-width:0!important}

  /* Keep a floor and its own heading and legend together, and stop a teacher
     minimap splitting down the middle. A floor plan is landscape and fits a
     page; if a future one does not, this is the rule to loosen. */
  #app-browser .maptop{break-after:avoid;page-break-after:avoid}
  #app-browser .mapscroll,#app-browser .maplegend,#app-browser .mini-wrap,
  #app-browser .mini-card{break-inside:avoid;page-break-inside:avoid}
}
/* ── R60 additions ── */
#app-browser .tscroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
#app-browser .blockrow .bk .bt{display:block;font-size:10px;font-weight:600;color:var(--br-muted);margin-top:2px;line-height:1.2}
#app-browser .daychips{display:inline-flex;background:#fff;border:1px solid var(--br-gold-soft);border-radius:11px;padding:3px;margin:0 0 14px}
#app-browser .daychips button{font:inherit;font-weight:600;font-size:13.5px;border:none;background:none;color:var(--br-muted);padding:8px 16px;border-radius:8px;cursor:pointer}
#app-browser .daychips button.on{background:var(--br-forest);color:#fff}
#app-browser .groupmaps{display:grid;gap:16px}
#app-browser .geoplan{display:block}
/* Below 900px, stop the floor plan shrinking and let .mapscroll do its job.
   --geo-w is the drawing's natural width, set inline by brGeoFloorSVG(). */
@media(max-width:900px){#app-browser .geoplan{min-width:var(--geo-w)}}
#app-browser .geoplan .geo-room.live{cursor:pointer}
#app-browser .geoplan .geo-room.live:hover rect{fill-opacity:.32}
@media(max-width:640px){
  #app-browser{padding:16px 10px 60px}
  #app-browser .toolbar{flex-direction:column;align-items:stretch;padding:14px}
  #app-browser .mode{width:100%;display:flex}
  #app-browser .mode button{flex:1;padding-top:12px;padding-bottom:12px}
  #app-browser .br-field{min-width:0}
  #app-browser .btn-print{width:100%;padding:13px;min-height:44px}
  #app-browser .stage{padding:20px 14px}
  #app-browser .mini-wrap{flex-direction:column}
  #app-browser .mini-side{flex:1 1 100%}
  #app-browser .gchip,#app-browser .tcard,#app-browser .btn-map{min-height:44px}
  #app-browser .gtable{min-width:520px}
  #app-browser .idhead h2{font-size:23px}
}
`;
(function(){
  const st = document.createElement('style');
  st.id = 'br-style';
  st.textContent = BR_CSS;
  document.head.appendChild(st);
})();

let _brAppVisible = false;

function toggleApp() {
  _brAppVisible = !_brAppVisible;
  const viz    = document.getElementById('app-visualizer');
  const br     = document.getElementById('app-browser');
  const hdrBtn = document.getElementById('btn-open-schedule-browser');

  if (_brAppVisible) {
    viz.style.display = 'none';
    br.style.display  = 'block';
    if (hdrBtn) {
      hdrBtn.querySelector('svg').innerHTML = '<polyline points="15 18 9 12 15 6"/>';
      hdrBtn.querySelector('svg').setAttribute('viewBox','0 0 24 24');
      hdrBtn.lastChild.textContent = ' ← Visualizer';
    }
    // Refresh data every time we switch to the browser
    brLoadFromVisualizer();
    brBuildOpts();
    brRenderMenu();
  } else {
    br.style.display  = 'none';
    viz.style.display = '';
    if (hdrBtn) {
      hdrBtn.querySelector('svg').innerHTML = '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="9" x2="9" y2="21"/>';
      hdrBtn.querySelector('svg').setAttribute('viewBox','0 0 24 24');
      hdrBtn.lastChild.textContent = ' Schedule Browser';
    }
  }
}

/* === Data derivation === */
/* R59: BR_DEPT / BR_ORDER are now derived from settings.subjects (Settings →
   Subjects editor) via brSyncDeptFromSettings(). The seed values match the
   pre-R59 hardcoded palette, so existing data renders unchanged. Unknown
   codes (e.g. a deleted subject still on a room) fall back to a neutral grey. */
let BR_DEPT = {
  ELA:{c:'#2563eb',name:'English / ELA'},
  MATH:{c:'#c2520f',name:'Mathematics'},
  SCI:{c:'#0d7c69',name:'Science'},
  SS:{c:'#7c3aa8',name:'Social Studies'},
  'SCI/SS':{c:'#71641f',name:'Science / Social Studies'}
};
let BR_ORDER = {ELA:0,MATH:1,SCI:2,SS:3,'SCI/SS':4};
const BR_LEGACY_SHORT = {ELA:'ELA',MATH:'Math',SCI:'Science',SS:'Soc Studies','SCI/SS':'Sci / SS'};
const BR_DEPT_FALLBACK = { c:'#64748b', name:null };
function brSyncDeptFromSettings() {
  try {
    const subjects = (typeof getSubjects === 'function') ? getSubjects() : null;
    if (!Array.isArray(subjects) || !subjects.length) return;
    const dept = {}, order = {};
    subjects.forEach((sub, i) => {
      dept[sub.code]  = { c: sub.color || '#64748b', name: sub.name || sub.code };
      order[sub.code] = i;
    });
    BR_DEPT = dept; BR_ORDER = order;
  } catch(e) { console.warn('[Browser] subject sync failed:', e); }
}
const brDColor = d => (BR_DEPT[d]||BR_DEPT_FALLBACK).c || '#64748b';
const brTDept  = n => BR_TEACHERS[n] ? BR_TEACHERS[n].dept : (Object.keys(BR_DEPT)[0] || 'ELA');
const brDShort = d => {
  if (BR_LEGACY_SHORT[d] && BR_DEPT[d]) return BR_LEGACY_SHORT[d];
  const entry = BR_DEPT[d];
  if (entry && entry.name) return entry.name.length <= 12 ? entry.name : d;
  return d;
};
/* R59: unknown dept codes must sort deterministically after known ones. */
const brOrderOf = d => (d in BR_ORDER) ? BR_ORDER[d] : 999;

let BR_TEACHERS = {}, BR_SECTIONS = {}, BR_ROOM2TEACHER = {}, BR_MODCOUNT = 8, BR_MOD_LABEL = 'Mod';
/* R60: group room-by-mod map, bell-time snapshot, blueprint geometry snapshot */
let BR_GROUPROOMS = {}, BR_BELL = null, BR_GEOM = null;
let brMode = 'teacher', brCurrent = null, brActiveIdx = -1, brOpts = [];
let brMapFloor = 'f2';
let brGrpDay = 'A', brMapFloorIdx = 0;

function brDeriveScheduleData(settings, blueprint, groups) {
  brSyncDeptFromSettings();   // R59: dept palette follows settings.subjects
  const modCount = settings.modCount || 8;
  const roomMap  = {};

  // Read from the live gridData 2D array (not floor.cells, which is the serialized
  // export format and does not exist on in-memory floor objects after import/load).
  for (const floor of (blueprint.floors || [])) {
    const { gridData, gridCols, gridRows } = floor;
    if (!gridData) continue;
    const seen = new Set();
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const t = gridData[r] && gridData[r][c];
        if (!t || t.type !== 'classroom' || !t.roomNumber) continue;
        if (t.groupId && seen.has(t.groupId)) continue;
        if (t.groupId) seen.add(t.groupId);
        roomMap[t.roomNumber] = { teacher: t.teacher || null, dept: t.dept || null };
      }
    }
  }

  const teacherRoomMap = {};
  for (const [rn, info] of Object.entries(roomMap)) {
    if (info.teacher) teacherRoomMap[info.teacher] = rn;
  }

  const teacherSlots = {};
  for (const [tName, tRoom] of Object.entries(teacherRoomMap)) {
    const A = Array(modCount).fill('Planning');
    const B = Array(modCount).fill('Planning');
    for (const g of groups) {
      const modsA = g.modsA || g.mods || [];
      const modsB = g.modsB || [];
      for (let i = 0; i < modCount; i++) {
        if (modsA[i] === tRoom) A[i] = g.name;
        if (modsB[i] === tRoom) B[i] = g.name;
      }
    }
    teacherSlots[tName] = { A, B };
  }

  const TEACHERS = {};
  for (const [tName, tRoom] of Object.entries(teacherRoomMap)) {
    const info  = roomMap[tRoom] || {};
    const slots = teacherSlots[tName] || { A: [], B: [] };
    const allSecs = [...new Set([
      ...slots.A.filter(x => x !== 'Planning'),
      ...slots.B.filter(x => x !== 'Planning')
    ])];
    const abDiff = JSON.stringify(slots.A) !== JSON.stringify(slots.B);
    const planA  = slots.A.map((x,i) => x==='Planning'?`A${i+1}`:null).filter(Boolean);
    const planB  = slots.B.map((x,i) => x==='Planning'?`B${i+1}`:null).filter(Boolean);
    const planStr = planA.length
      ? planA.join(' / ') + (abDiff && planB.length ? ' / '+planB.join(' / ') : '')
      : '—';
    TEACHERS[tName] = { dept: info.dept||'ELA', room:tRoom, plan:planStr, sec:allSecs, A:slots.A, B:slots.B, co:[] };
  }

  const SECTIONS = {};
  for (const g of groups) {
    const teachers = [];
    const modsA = g.modsA || g.mods || [];
    const modsB = g.modsB || [];
    const allRooms = new Set([...modsA, ...modsB].filter(Boolean));
    for (const room of allRooms) {
      const info = roomMap[room];
      if (info && info.teacher && !teachers.includes(info.teacher)) teachers.push(info.teacher);
    }
    if (teachers.length > 0 || g.name) SECTIONS[g.name] = teachers;
  }

  for (const [tName, t] of Object.entries(TEACHERS)) {
    const co = new Set();
    for (const sec of t.sec) {
      for (const other of (SECTIONS[sec]||[])) { if (other !== tName) co.add(other); }
    }
    t.co = [...co].sort();
  }

  const ROOM2TEACHER = {};
  for (const [tName, t] of Object.entries(TEACHERS)) ROOM2TEACHER[t.room] = tName;

  /* R60: room-by-mod arrays per group, for the group-view mini-map. B stays
     independent of A (matching teacherSlots): no B data means no B highlights. */
  const GROUPROOMS = {};
  for (const g of groups) {
    if (!g.name) continue;
    const modsA = g.modsA || g.mods || [];
    const modsB = g.modsB || [];
    GROUPROOMS[g.name] = {
      A: Array.from({ length: modCount }, (_, i) => modsA[i] || null),
      B: Array.from({ length: modCount }, (_, i) => modsB[i] || null)
    };
  }

  return { TEACHERS, SECTIONS, ROOM2TEACHER, GROUPROOMS, modCount };
}

/* R60 (live-only): snapshot per-mod bell labels for both days. Reads the
   Stage 1 helpers, which read AppState — published files get the result blob. */
function brSnapshotBell(modCount) {
  if (typeof formatModTime !== 'function') return null;
  const out = { A: [], B: [] };
  let any = false;
  for (let i = 0; i < modCount; i++) {
    const a = formatModTime('A', i) || '';
    const b = formatModTime('B', i) || '';
    if (a || b) any = true;
    out.A.push(a); out.B.push(b);
  }
  return any ? out : null;
}

/* R60 (live-only): lightweight geometry snapshot of the blueprint for the
   browser mini-maps and published files. Reads the live gridData 2D arrays
   (same traversal contract as brDeriveScheduleData). No paths, no heat —
   hallway/staircase cells plus room cell-lists with subject code + teacher. */
function brBuildGeometrySnapshot(blueprint) {
  const floors = [];
  for (const floor of ((blueprint && blueprint.floors) || [])) {
    const { gridData, gridCols, gridRows } = floor;
    if (!gridData) continue;
    const hall = [], stair = [], roomsByKey = {};
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const t = gridData[r] && gridData[r][c];
        if (!t) continue;
        if (t.type === 'hallway') hall.push([c, r]);
        else if (t.type === 'staircase') stair.push([c, r]);
        else if (t.type === 'classroom') {
          const key = t.groupId || ('solo_' + c + '_' + r);
          const R = roomsByKey[key] || (roomsByKey[key] = { rn: null, dept: null, teacher: null, cells: [] });
          R.cells.push([c, r]);
          if (t.roomNumber && !R.rn) { R.rn = t.roomNumber; R.dept = t.dept || null; R.teacher = t.teacher || null; }
        }
      }
    }
    const rooms = Object.values(roomsByKey);
    if (hall.length || stair.length || rooms.length) {
      floors.push({ id: floor.id, label: floor.label || ('Floor ' + (floors.length + 1)),
                    cols: gridCols, rows: gridRows, hall, stair, rooms });
    }
  }
  return { floors };
}

function brLoadFromVisualizer() {
  try {
    const settings  = AppState.settings;
    const blueprint = AppState.blueprint;
    const groups    = AppState.schedules.groups;
    const data      = brDeriveScheduleData(settings, blueprint, groups);
    BR_TEACHERS     = data.TEACHERS;
    BR_SECTIONS     = data.SECTIONS;
    BR_ROOM2TEACHER = data.ROOM2TEACHER;
    BR_GROUPROOMS   = data.GROUPROOMS || {};
    BR_MODCOUNT     = data.modCount || 8;
    BR_MOD_LABEL    = settings.modLabel || 'Mod';
    BR_BELL         = brSnapshotBell(BR_MODCOUNT);
    BR_GEOM         = brBuildGeometrySnapshot(blueprint);

    const school = settings.schoolName || 'Schedule Browser';
    const el = document.getElementById('br-mast-school');
    if (el) el.textContent = school;
    const init = document.getElementById('br-mast-initial');
    if (init) init.textContent = school.charAt(0) || 'S';

    if (Object.keys(BR_TEACHERS).length === 0) {
      document.getElementById('br-empty-title').textContent = 'No schedule data found.';
      document.getElementById('br-empty-sub').innerHTML =
        'Add rooms with teachers in the <b>Blueprint Builder</b> and assign them to groups in <b>Schedule Input</b>.';
    } else {
      document.getElementById('br-empty-title').textContent = 'Pick a name to see a schedule.';
      document.getElementById('br-empty-sub').innerHTML =
        'Or switch to <b>By Student Group</b> to see every teacher a class shares.';
    }
  } catch(e) {
    console.warn('[Browser] brLoadFromVisualizer error:', e);
    BR_TEACHERS = {}; BR_SECTIONS = {}; BR_ROOM2TEACHER = {};
    BR_GROUPROOMS = {}; BR_BELL = null; BR_GEOM = null;
  }
}

/* === Search menu === */
function brBuildOpts() {
  if (brMode === 'teacher') {
    brOpts = Object.keys(BR_TEACHERS).map(n => ({
      key:n, label:n, dept:BR_TEACHERS[n].dept,
      tag:BR_TEACHERS[n].room,
      grp:(BR_DEPT[BR_TEACHERS[n].dept]||{}).name||BR_TEACHERS[n].dept
    })).sort((a,b)=>(brOrderOf(a.dept)-brOrderOf(b.dept))||a.label.localeCompare(b.label));
  } else {
    brOpts = Object.keys(BR_SECTIONS).map(s=>({
      key:s, label:'Class '+s, dept:null,
      tag:BR_SECTIONS[s].length+' teachers',
      grp:'Grade '+s.split('-')[0]
    })).sort((a,b)=>a.key.localeCompare(b.key,undefined,{numeric:true}));
  }
}

function brRenderMenu(filter='') {
  const m = document.getElementById('br-menu');
  if (!m) return;
  const f = filter.trim().toLowerCase();
  const shown = brOpts.filter(o =>
    o.label.toLowerCase().includes(f) || (''+o.tag).toLowerCase().includes(f)
  );
  let html='', lastG=null;
  shown.forEach((o,i) => {
    if (o.grp !== lastG) { html += `<div class="grp">${o.grp}</div>`; lastG=o.grp; }
    const dot = `<span class="br-dot" style="background:${o.dept?brDColor(o.dept):'#0c4b31'}"></span>`;
    html += `<div class="opt${i===brActiveIdx?' active':''}" onmousedown="brChoose('${o.key}')">${dot}<span>${o.label}</span><span class="tag">${o.tag}</span></div>`;
  });
  m.innerHTML = html || '<div class="opt" style="color:#62756a">No matches</div>';
  m._shown = shown;
}

function brOpenMenu()  { brActiveIdx=-1; brRenderMenu(document.getElementById('br-search').value);
  document.getElementById('br-menu').classList.add('show'); }
function brCloseMenu() { document.getElementById('br-menu').classList.remove('show'); }
function brOnType()    { brActiveIdx=-1; brRenderMenu(document.getElementById('br-search').value);
  document.getElementById('br-menu').classList.add('show'); }
function brOnKey(e) {
  const m=document.getElementById('br-menu'); const sh=m._shown||[];
  if (e.key==='ArrowDown') { e.preventDefault(); brActiveIdx=Math.min(brActiveIdx+1,sh.length-1); brRenderMenu(document.getElementById('br-search').value); }
  else if (e.key==='ArrowUp')  { e.preventDefault(); brActiveIdx=Math.max(brActiveIdx-1,0); brRenderMenu(document.getElementById('br-search').value); }
  else if (e.key==='Enter')    { e.preventDefault(); if(sh[brActiveIdx])brChoose(sh[brActiveIdx].key); else if(sh.length===1)brChoose(sh[0].key); }
  else if (e.key==='Escape')   { brCloseMenu(); }
}
/* R60: wrapped so the published file can re-register the same handler. */
function brWireDocClick() {
  document.addEventListener('click', e => {
    if (!e.target.closest('#app-browser .searchbox')) brCloseMenu();
  });
}
brWireDocClick();

/* === Mode & selection === */
function brSetMode(mo) {
  brMode=mo; brCurrent=null;
  document.getElementById('br-mTeacher').classList.toggle('on', mo==='teacher');
  document.getElementById('br-mGroup').classList.toggle('on',   mo==='group');
  document.getElementById('br-mMap').classList.toggle('on',     mo==='map');
  document.getElementById('br-mTeacher').setAttribute('aria-selected', mo==='teacher');
  document.getElementById('br-mGroup').setAttribute('aria-selected',   mo==='group');
  document.getElementById('br-mMap').setAttribute('aria-selected',     mo==='map');
  const sf = document.getElementById('br-searchField');
  if (mo==='map') {
    sf.style.display='none';
    document.getElementById('br-empty').style.display='none';
    const v=document.getElementById('br-view'); v.classList.remove('show'); void v.offsetWidth;
    brRenderMap(); v.classList.add('show');
    return;
  }
  sf.style.display='';
  document.getElementById('br-searchLabel').textContent = mo==='teacher'?'Find a teacher':'Find a student group';
  document.getElementById('br-search').placeholder = mo==='teacher'?'Type a name…':'Type a class, like 7-5…';
  document.getElementById('br-search').value='';
  document.getElementById('br-view').classList.remove('show');
  document.getElementById('br-empty').style.display='';
  brBuildOpts(); brRenderMenu();
}

function brChoose(key) {
  document.getElementById('br-search').value = brMode==='teacher' ? key : ('Class '+key);
  brCloseMenu(); brCurrent=key;
  document.getElementById('br-empty').style.display='none';
  const v=document.getElementById('br-view'); v.classList.remove('show'); void v.offsetWidth;
  if (brMode==='teacher') brRenderTeacher(key); else brRenderGroup(key);
  v.classList.add('show');
  v.scrollIntoView({behavior:'smooth',block:'nearest'});
}

function brJumpTeacher(n) { brSetMode('teacher'); brChoose(n); }
function brJumpGroup(s)   { brSetMode('group');   brChoose(s); }

/* === Teacher view === */
function brDayRows(arr, room, day) {
  let out='';
  const bell = BR_BELL ? (day==='B' ? BR_BELL.B : BR_BELL.A) : null;
  for (let i=0; i<BR_MODCOUNT; i++) {
    const sec=arr[i]; const plan=!sec||sec==='Planning';
    const time = bell ? (bell[i]||'') : '';
    const cell=plan
      ? `<div class="cell">Planning / Intervention</div>`
      : `<div class="cell"><div class="sec">Class ${sec}</div><div class="who">Room ${room}</div></div>`;
    out += `<div class="blockrow${plan?' plan':''}"><div class="bk"><span class="n">${i+1}</span><span class="t">${BR_MOD_LABEL}</span>${time?`<span class="bt">${time}</span>`:''}</div>${cell}</div>`;
  }
  return out;
}

function brRenderTeacher(n) {
  const t=BR_TEACHERS[n]; if (!t) return;
  const col=brDColor(t.dept);
  const split=JSON.stringify(t.A)!==JSON.stringify(t.B);
  const mates=(t.co||[]).map(m=>({n:m,dept:brTDept(m)})).sort((a,b)=>(brOrderOf(a.dept)-brOrderOf(b.dept))||a.n.localeCompare(b.n));
  const deptLabel=(BR_DEPT[t.dept]||{}).name||t.dept;
  document.getElementById('br-view').innerHTML=`
   <div class="idhead">
     <div class="ibadge" style="background:${col}">${n[0]}</div>
     <div><h2>${n}</h2><div class="role" style="color:${col}">${deptLabel} · Room ${t.room}</div></div>
   </div>
   <p class="factline">Teaches <b>${t.sec.length} class${t.sec.length!==1?'es':''}</b>. Planning is <b>${BR_MOD_LABEL} ${t.plan}</b>.
     ${split?'A&nbsp;days and B&nbsp;days are different — both are shown below.':'A&nbsp;days and B&nbsp;days are the same.'}</p>
   <div class="days">
     <div class="daycard"><h3>${split?'A&nbsp;Day':'Every day (A &amp; B the same)'}</h3>${brDayRows(t.A,t.room,'A')}</div>
     ${split?`<div class="daycard B"><h3>B&nbsp;Day</h3>${brDayRows(t.B,t.room,'B')}</div>`:''}
   </div>
   <h3 class="block-title">Where to find you</h3>
   <p class="hint">Your classroom on the building map — tap any colored neighbor to hop to their schedule.</p>
   ${brMiniMapHTML(n)}
   <h3 class="block-title">Your classes</h3>
   <p class="hint">Tap a class to see everyone else who teaches those students.</p>
   <div class="classrow">${t.sec.map(s=>`<button class="gchip" onclick="brJumpGroup('${s}')">${s}</button>`).join('')}</div>
   ${mates.length>0?`
   <h3 class="block-title">Other teachers for your students</h3>
   <p class="hint">Tap a card to open that teacher's schedule.</p>
   <div class="team">${mates.map(m=>{const mc=brDColor(m.dept);const mt=BR_TEACHERS[m.n];if(!mt)return '';
     const shared=t.sec.filter(s=>(BR_SECTIONS[s]||[]).includes(m.n));
     const mdLabel=(BR_DEPT[m.dept]||{}).name||m.dept;
     return `<button class="tcard" style="border-left-color:${mc}" onclick="brJumpTeacher('${m.n}')">
       <div class="nm">${m.n}</div><div class="sj" style="color:${mc}">${mdLabel}</div>
       <div class="rm">Room ${mt.room} · shares ${shared.join(', ')}</div></button>`;}).join('')}</div>`:''}
   ${brOverviewHTML()}`;
}

/* === Group view === */
function brRenderGroup(sec) {
  if (!BR_SECTIONS[sec]) return;
  const grade=sec.split('-')[0];
  const list=(BR_SECTIONS[sec]||[]).slice().sort((a,b)=>brOrderOf(brTDept(a))-brOrderOf(brTDept(b)));
  const slot = name => {
    const t=BR_TEACHERS[name]; if (!t) return {a:'—',b:'—'};
    const f = idx => idx<0?'—':`${BR_MOD_LABEL} ${idx+1}`;
    return { a:f(t.A.indexOf(sec)), b:f(t.B.indexOf(sec)) };
  };
  document.getElementById('br-view').innerHTML=`
   <div class="idhead">
     <div class="ibadge" style="background:#0c4b31">${grade}</div>
     <div><h2>Class ${sec}</h2><div class="role" style="color:#62756a">Grade ${grade} · ${list.length} teacher${list.length!==1?'s':''}</div></div>
   </div>
   <h3 class="block-title">Who teaches class ${sec}</h3>
   <p class="hint">Tap a name to open that teacher's full schedule.</p>
   <div class="tscroll"><table class="gtable">
     <thead><tr><th>Subject</th><th>Teacher</th><th>Room</th><th>A day</th><th>B day</th></tr></thead>
     <tbody>${list.map(name=>{const t=BR_TEACHERS[name];if(!t)return '';const c=brDColor(t.dept);const s=slot(name);
       const dLabel=(BR_DEPT[t.dept]||{}).name||t.dept;
       return `<tr><td class="subj" style="color:${c}">${dLabel}</td>
         <td><button class="lnk" onclick="brJumpTeacher('${name}')">${name}</button></td>
         <td>${t.room}</td><td>${s.a}</td><td>${s.b}</td></tr>`;}).join('')}</tbody>
   </table></div>
   ${brGroupMapHTML(sec)}
   ${brOverviewHTML()}`;
}

/* === Staffing overview === */
function brOverviewHTML() {
  if (Object.keys(BR_TEACHERS).length===0) return '';
  const agg={};
  Object.values(BR_TEACHERS).forEach(t=>{const d=t.dept;agg[d]=agg[d]||{teachers:0,inst:0};
    agg[d].teachers++;agg[d].inst+=(t.A||[]).filter(x=>x!=='Planning').length+(t.B||[]).filter(x=>x!=='Planning').length;});
  const ord=['ELA','MATH','SCI','SS','SCI/SS'];
  const max=Math.max(1,...Object.values(agg).map(a=>a.inst));
  const rows=ord.filter(d=>agg[d]).map(d=>{const a=agg[d];const c=brDColor(d);const w=Math.round(a.inst/max*100);
    return `<div class="row"><div class="lbl" style="color:${c}">${(BR_DEPT[d]||{}).name||d}</div>
      <div class="track"><div class="fill" style="width:${w}%;background:${c}">${a.inst}</div></div>
      <div class="cnt">${a.teachers} teacher${a.teachers>1?'s':''}</div></div>`;}).join('');
  return `<details class="overview"><summary>Whole-school staffing overview (optional)</summary>
    <div class="snap">${rows}<p class="note">Weekly class-blocks taught per department, across A and B days.</p></div></details>`;
}

/* === R60: dynamic blueprint mini-map (geometry-snapshot renderer) ===
   Draws BR_GEOM floors as a static SVG: hallway/staircase cells plus rooms
   colored by subject. No paths, no heat. Shared with published files. */
function brGeoFindRoom(rn) {
  if (!rn || !BR_GEOM || !Array.isArray(BR_GEOM.floors)) return null;
  for (let i = 0; i < BR_GEOM.floors.length; i++) {
    const fg = BR_GEOM.floors[i];
    if ((fg.rooms || []).some(r => r.rn === rn)) return { floorIdx: i, floor: fg };
  }
  return null;
}

function brGeoFloorSVG(fg, opts) {
  opts = opts || {};
  const px = opts.px || 26, W = fg.cols * px, H = fg.rows * px;
  const hi = opts.highlights || {};              /* { roomNumber: badgeLabel|true } */
  const clickable = opts.clickable !== false;
  let s = `<rect x="-4" y="-4" width="${W+8}" height="${H+8}" rx="10" fill="#fbfcfa" stroke="#e3eae4" stroke-width="1.5"/>`;
  for (const [c, r] of (fg.hall || []))
    s += `<rect x="${c*px}" y="${r*px}" width="${px}" height="${px}" fill="#eef2ee"/>`;
  for (const [c, r] of (fg.stair || []))
    s += `<rect x="${c*px}" y="${r*px}" width="${px}" height="${px}" fill="#d9e4da"/>`
       + `<text x="${c*px+px/2}" y="${r*px+px*0.7}" text-anchor="middle" font-size="${px*0.5}" font-family="Public Sans,sans-serif" font-weight="700" fill="#4c6355">S</text>`;
  const rings = [], badges = [];
  for (const room of (fg.rooms || [])) {
    const named = !!room.rn;
    const col = (named && room.dept) ? brDColor(room.dept) : '#9aa89f';
    const isHi = named && (room.rn in hi);
    const teacher = named ? BR_ROOM2TEACHER[room.rn] : null;
    const canClick = clickable && !!teacher;
    let cellsSvg = '', minC = Infinity, minR = Infinity, maxC = -1, maxR = -1;
    for (const [c, r] of room.cells) {
      cellsSvg += `<rect x="${c*px+1}" y="${r*px+1}" width="${px-2}" height="${px-2}" rx="3" fill="${col}" fill-opacity="${isHi?0.38:(named?0.16:0.08)}"/>`;
      if (c < minC) minC = c; if (r < minR) minR = r;
      if (c > maxC) maxC = c; if (r > maxR) maxR = r;
    }
    const bx = minC*px, by = minR*px, bw = (maxC-minC+1)*px, bh = (maxR-minR+1)*px;
    const fs = named ? Math.max(8, Math.min(px*0.42, (bw-6)/Math.max(1, room.rn.length)*1.65)) : 0;
    const label = named
      ? `<text x="${bx+bw/2}" y="${by+bh/2+fs*0.36}" text-anchor="middle" font-size="${fs}" font-family="Public Sans,sans-serif" font-weight="600" fill="#3c4a42">${room.rn}</text>`
      : '';
    const click = canClick ? ` onclick="brJumpTeacher('${teacher.replace(/'/g, "\\'")}')"` : '';
    s += `<g class="geo-room${canClick?' live':''}"${click}>${cellsSvg}${label}${canClick?`<title>${teacher} · ${room.rn}</title>`:''}</g>`;
    if (isHi) {
      rings.push(`<rect x="${bx-2.5}" y="${by-2.5}" width="${bw+5}" height="${bh+5}" rx="6" fill="none" stroke="${col}" stroke-width="3"/>`);
      const badge = hi[room.rn];
      if (badge && badge !== true) {
        const btxt = String(badge);
        const bwid = Math.max(34, btxt.length*px*0.27 + 14);
        const byTop = (by - px*0.78 < -px) ? (by + bh + 4) : (by - px*0.78);
        badges.push(`<g><rect x="${bx+bw/2-bwid/2}" y="${byTop}" width="${bwid}" height="${px*0.62}" rx="${px*0.31}" fill="${col}"/>`
                  + `<text x="${bx+bw/2}" y="${byTop+px*0.44}" text-anchor="middle" font-size="${px*0.36}" font-family="Public Sans,sans-serif" font-weight="700" fill="#fff">${btxt}</text></g>`);
      }
    }
  }
  s += rings.join('') + badges.join('');
  /* min-width, not just width:100%. .mapscroll is overflow-x:auto and could
     never scroll, because width:100% told the SVG to shrink to whatever it
     was given. On a 375px phone that squeezed a whole floor into 375px and
     drew the room numbers about 4px tall. Checking a room assignment on a
     phone is the main thing anyone does with a published file, so that was
     the wrong end of the trade to lose.

     The floor is the drawing's own width: `px` user units per cell is the
     scale the labels were sized for, so 1:1 is where they stop being
     readable. It is handed over as a custom property rather than as
     min-width, and .geoplan only applies it below 900px — see the media
     query in BR_CSS. Wide screens keep shrink-to-fit, because seeing a whole
     floor at once is the thing the desktop map is for and East Middle's is
     wider than the panel. Narrow screens scroll instead of squinting. */
  const vbW = W + 16;
  return `<svg class="geoplan" viewBox="-8 -${px+6} ${vbW} ${H+px+18}" `
       + `style="width:100%;--geo-w:${vbW}px" `
       + `xmlns="http://www.w3.org/2000/svg">${s}</svg>`;
}

/* === Building map (legacy hardcoded geometry — live-app fallback only) === */
const BR_A_TPL=[
 [18,14,156,80,'A108','A208'],[178,22,26,64,'A108A','A208A'],[210,14,126,80,'A109','A209'],[344,16,42,64,'S001','S001'],
 [18,110,104,86,'A107','A207'],[18,202,104,86,'A106','A206'],[18,294,104,86,'A104','A204'],
 [18,386,104,86,'A103','A202'],[18,478,104,104,'A101','A201'],
 [156,110,88,120,'A105','A205'],[156,238,88,150,'A100','200B'],[156,396,88,84,'A102','A203'],
 [156,488,88,66,'A115','DA-1'],[156,560,88,22,'A116','A215'],
 [256,110,100,92,'A110','A210'],[256,210,100,82,'A111','A211'],
 [256,300,100,82,'A112','A212'],[256,390,100,92,'A113','A213'],[256,490,100,92,'A114','A214'],
 [362,496,34,86,'S002','S002']
];
const brAR = idx => BR_A_TPL.map(r=>({x:r[0],y:r[1],w:r[2],h:r[3],id:r[idx]}));
const brCR = arr => arr.map(r=>({x:r[0],y:r[1],w:r[2],h:r[3],id:r[4]}));
const BR_WINGS={
  A1:{w:404,h:600,rooms:brAR(4)},
  A2:{w:404,h:600,rooms:brAR(5)},
  C2:{w:768,h:372,rooms:brCR([
    [116,14,116,86,'C204'],[238,14,116,86,'C203'],[360,14,116,86,'C202'],[482,14,132,86,'C201'],
    [14,106,92,42,'S004'],[14,154,92,78,'C205'],[14,238,92,28,'C205A'],
    [116,110,78,150,'C214'],[200,110,96,150,'C-WORK'],[384,110,72,150,'C213'],[462,110,66,150,'C212'],[534,110,80,150,'C211'],
    [14,272,140,86,'C206'],[160,272,116,86,'C207'],[282,272,116,86,'C208'],[404,272,116,86,'C209'],[526,272,112,86,'C210'],[650,272,108,86,'B201']
  ])}
};
const BR_CTXLABEL={S001:'Stairs',S002:'Stairs',S004:'Stairs',A105:'Workroom',A205:'Workroom',C214:'Workroom',
  'A100':'','200B':'','C-WORK':'',A116:'Elev',A215:'Elev','DA-1':'Office',A108A:'',A208A:'',A104A:'',A204A:'',A111A:'',A211A:''};
const brWingOf=room=>{if(!room)return null;for(const w of['A1','A2','C2'])if(BR_WINGS[w].rooms.some(r=>r.id===room))return w;return null;};
const brFloorOfWing=w=>w==='A1'?'f1':'f2';

function brRoomCellSVG(r, opts) {
  opts=opts||{};
  const t=BR_ROOM2TEACHER[r.id]; const cx=r.x+r.w/2;
  if (!t) {
    const named=(r.id in BR_CTXLABEL)&&BR_CTXLABEL[r.id]!=='';
    let inner='';
    if (named) {
      inner=`<text class="rnote" x="${cx}" y="${r.y+r.h/2+(r.h>70?-2:3)}" text-anchor="middle" font-size="10">${BR_CTXLABEL[r.id]}</text>`
           +(r.h>70?`<text class="rid" x="${cx}" y="${r.y+r.h/2+12}" text-anchor="middle" font-size="9">${r.id}</text>`:'');
    } else { inner=!(r.id in BR_CTXLABEL)?`<text class="rid" x="${cx}" y="${r.y+r.h/2+4}" text-anchor="middle" font-size="${r.w<40?8:10}">${r.id}</text>`:''; }
    return `<g class="rcell ctx"><rect class="rbox" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="6"/>${inner}</g>`;
  }
  const dep=BR_TEACHERS[t]?BR_TEACHERS[t].dept:'ELA', col=brDColor(dep);
  const here=opts.highlight===true, live=opts.live!==false;
  const nameSize=r.w<92?12:13.5, subSize=r.w<92?9:9.5;
  const cyName=r.y+r.h/2-3, cySub=r.y+r.h/2+12;
  const ring=here?`<rect class="ring" x="${r.x-3}" y="${r.y-3}" width="${r.w+6}" height="${r.h+6}" rx="9"/>`:'';
  return `<g class="rcell${live?' live':''}${here?' here':''}" style="--rc:${col}"${live?` onclick="brJumpTeacher('${t}')"`:''}>\
<rect class="rbox" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="6" fill="${col}" fill-opacity="${here?0.30:0.13}" stroke="${col}"/>\
<rect class="racc" x="${r.x}" y="${r.y+6}" width="5" height="${Math.max(8,r.h-12)}" rx="2.5" fill="${col}"/>\
<text class="rname" x="${cx}" y="${cyName}" text-anchor="middle" font-size="${nameSize}" font-family="Fraunces,serif" font-weight="600" fill="#283831">${t}</text>\
<text class="rsub" x="${cx}" y="${cySub}" text-anchor="middle" font-size="${subSize}" font-family="Public Sans,sans-serif" font-weight="600" fill="${col}">${r.id} · ${brDShort(dep)}</text>\
${ring}</g>`;
}

function brWingInner(wing, dx, dy, opts) {
  opts=opts||{};
  const cells=BR_WINGS[wing].rooms.map(r=>brRoomCellSVG(r,{highlight:opts.highlight===r.id,live:opts.highlight!==r.id})).join('');
  return `<g transform="translate(${dx},${dy})">${cells}</g>`;
}

function brBuildFloorSVG(floor) {
  if (floor==='f1') {
    return `<svg class="floorplan" viewBox="-16 -14 436 632" style="width:100%;min-width:430px;max-width:560px;margin:0 auto" xmlns="http://www.w3.org/2000/svg">
      <rect x="-8" y="-6" width="420" height="616" rx="14" fill="#fff" stroke="#e3eae4" stroke-width="1.5"/>
      ${brWingInner('A1',0,0,{})}
      <text class="corridor-t" x="208" y="600" text-anchor="middle">↑ stairs lead to the A-wing 2nd floor</text>
    </svg>`;
  }
  const aDX=812,aDY=40,cDX=20,cDY=362;
  return `<svg class="floorplan" viewBox="0 0 1252 748" style="width:100%;min-width:980px" xmlns="http://www.w3.org/2000/svg">
    <rect x="${cDX-8}" y="${cDY-6}" width="786" height="384" rx="14" fill="#fff" stroke="#e3eae4" stroke-width="1.5"/>
    <rect x="${aDX-8}" y="${aDY-6}" width="420" height="616" rx="14" fill="#fff" stroke="#e3eae4" stroke-width="1.5"/>
    <text x="${cDX+370}" y="${cDY-16}" text-anchor="middle" font-size="15" letter-spacing="2" font-family="Fraunces,serif" font-weight="600" fill="#0c4b31" opacity=".85">C WING</text>
    <text x="${aDX+200}" y="${aDY-16}" text-anchor="middle" font-size="15" letter-spacing="2" font-family="Fraunces,serif" font-weight="600" fill="#0c4b31" opacity=".85">A WING</text>
    <rect class="corridor" x="760" y="${cDY+44}" width="${aDX+18-760}" height="58" rx="6" fill="#f1f5f1" stroke="#dbe4dd" stroke-width="1.4"/>
    <text class="corridor-t" x="${(760+aDX+18)/2}" y="${cDY+78}" text-anchor="middle">200 CORR.</text>
    ${brWingInner('C2',cDX,cDY,{})}
    ${brWingInner('A2',aDX,aDY,{})}
  </svg>`;
}

function brBuildMiniSVG(wing, room) {
  const W=BR_WINGS[wing];
  return `<svg class="floorplan" viewBox="-12 -12 ${W.w+24} ${W.h+24}" style="width:100%" xmlns="http://www.w3.org/2000/svg">
    <rect x="-6" y="-6" width="${W.w+12}" height="${W.h+12}" rx="12" fill="#fff" stroke="#e6ece7" stroke-width="1.5"/>
    ${brWingInner(wing,0,0,{highlight:room})}
  </svg>`;
}

function brMiniMapHTML(name) {
  const t = BR_TEACHERS[name]; if (!t) return '';
  const col = brDColor(t.dept);
  const loc = brGeoFindRoom(t.room);
  if (!loc) {
    const hasGeo = BR_GEOM && BR_GEOM.floors && BR_GEOM.floors.length;
    return `<div class="mini-wrap"><div class="mini-side" style="flex:1 1 100%">
      <div><div class="roomtag" style="color:${col}">${t.room}</div><div class="floortag">Location not mapped</div></div>
      <div class="offmap">Room <b>${t.room}</b> isn't on the blueprint floor plan${hasGeo?'':' — no blueprint data is available'}.</div>
      ${hasGeo?`<button class="btn-map" onclick="brSetMode('map')">Open building map</button>`:''}</div></div>`;
  }
  const hiOne = {}; hiOne[t.room] = true;
  return `<div class="mini-wrap">
    <div class="mini-card"><div class="mhd">${loc.floor.label}</div><div class="msvg">${brGeoFloorSVG(loc.floor,{highlights:hiOne})}</div></div>
    <div class="mini-side">
      <div><div class="roomtag" style="color:${col}">${t.room}</div><div class="floortag">${loc.floor.label}</div></div>
      <div class="where">You're <b>highlighted</b> here. Colored rooms with teachers are clickable.</div>
      <button class="btn-map" onclick="brOpenMapFloorIdx(${loc.floorIdx})">See the whole floor</button>
    </div></div>`;
}

/* R60: group-view mini-map — every room the class visits, badged by mod/time. */
function brGroupMapHTML(sec) {
  const gr = BR_GROUPROOMS[sec];
  if (!gr || !BR_GEOM || !BR_GEOM.floors || !BR_GEOM.floors.length) return '';
  const bHasData = Array.isArray(gr.B) && gr.B.some(Boolean);
  const abDiff = bHasData && JSON.stringify(gr.A) !== JSON.stringify(gr.B);
  const day = (brGrpDay === 'B' && bHasData) ? 'B' : 'A';
  const rooms = (day === 'B' ? gr.B : gr.A) || [];
  const perFloor = {};
  rooms.forEach((rn, i) => {
    if (!rn) return;
    const loc = brGeoFindRoom(rn); if (!loc) return;
    const time = BR_BELL ? ((day === 'B' ? BR_BELL.B : BR_BELL.A)[i] || '') : '';
    const lbl = `${BR_MOD_LABEL} ${i+1}${time ? ' · ' + time : ''}`;
    const m = perFloor[loc.floorIdx] || (perFloor[loc.floorIdx] = {});
    m[rn] = m[rn] ? (m[rn] + ' + ' + (i+1)) : lbl;   /* revisited room: append mod # */
  });
  const idxs = Object.keys(perFloor).map(Number).sort((a,b)=>a-b);
  if (!idxs.length) return '';
  const maps = idxs.map(fi => {
    const fg = BR_GEOM.floors[fi];
    return `<div class="mini-card"><div class="mhd">${fg.label}</div><div class="msvg">${brGeoFloorSVG(fg,{highlights:perFloor[fi]})}</div></div>`;
  }).join('');
  const toggle = abDiff
    ? `<div class="daychips"><button class="${day==='A'?'on':''}" onclick="brSetGrpDay('A')">A Day</button><button class="${day==='B'?'on':''}" onclick="brSetGrpDay('B')">B Day</button></div>`
    : '';
  return `<h3 class="block-title">Where this class goes</h3>
   <p class="hint">Every room class ${sec} visits on a${day==='B'?' B':'n A'} day, labeled by ${BR_MOD_LABEL.toLowerCase()}${BR_BELL?' and time':''}. Tap a room to open that teacher's schedule.</p>
   ${toggle}<div class="groupmaps">${maps}</div>`;
}
function brSetGrpDay(d) { brGrpDay = d; if (brMode === 'group' && brCurrent) brRenderGroup(brCurrent); }

function brOpenMapFloor(f) { brMapFloor=f; brSetMode('map'); }
function brSetMapFloor(f)  { brMapFloor=f; brRenderMap(); }

/* R60: map mode dispatcher — dynamic blueprint geometry when available,
   legacy hardcoded wings as live-app fallback (excluded from published files,
   hence the typeof guard). */
function brOpenMapFloorIdx(i) { brMapFloorIdx = i; brSetMode('map'); }
function brSetMapFloorIdx(i)  { brMapFloorIdx = i; brRenderMap(); }

function brRenderMap() {
  if (BR_GEOM && BR_GEOM.floors && BR_GEOM.floors.length) { brRenderMapDyn(); return; }
  if (typeof BR_WINGS !== 'undefined') { brRenderMapLegacy(); return; }
  document.getElementById('br-view').innerHTML =
    '<div class="br-empty"><div class="big">No building map available.</div>' +
    '<div>No blueprint geometry was included with this schedule data.</div></div>';
}

function brRenderMapDyn() {
  if (brMapFloorIdx >= BR_GEOM.floors.length) brMapFloorIdx = 0;
  const fg = BR_GEOM.floors[brMapFloorIdx];
  const legend = Object.keys(BR_DEPT).map(d =>
    `<span class="lg"><span class="sw" style="background:${brDColor(d)}"></span>${(BR_DEPT[d]||{}).name||d}</span>`).join('')
    + `<span class="lg"><span class="sw ctx"></span>Other spaces</span>`;
  const tabs = BR_GEOM.floors.length > 1
    ? `<div class="floortabs">${BR_GEOM.floors.map((f,i)=>`<button class="${i===brMapFloorIdx?'on':''}" onclick="brSetMapFloorIdx(${i})">${f.label}</button>`).join('')}</div>`
    : '';
  document.getElementById('br-view').innerHTML = `
   <div class="maptop">
     <div><h2>Building Map</h2><div class="role">${fg.label}</div></div>
     ${tabs}
   </div>
   <p class="maphint">Rooms are colored by subject. <b>Tap a room</b> with an assigned teacher to open their schedule.</p>
   <div class="maplegend">${legend}</div>
   <div class="mapshell"><div class="mapscroll">${brGeoFloorSVG(fg,{})}</div></div>`;
}

function brRenderMapLegacy() {
  const f=brMapFloor;
  const title=f==='f1'?'First Floor':'Second Floor';
  const sub=f==='f1'?'A&nbsp;Wing · Room A100s':'A&nbsp;Wing (A200s) + C&nbsp;Wing (C200s)';
  const legend=['ELA','MATH','SCI','SS','SCI/SS'].map(d=>
    `<span class="lg"><span class="sw" style="background:${brDColor(d)}"></span>${(BR_DEPT[d]||{}).name||d}</span>`).join('')
    +`<span class="lg"><span class="sw ctx"></span>Other spaces</span>`;
  document.getElementById('br-view').innerHTML=`
   <div class="maptop">
     <div><h2>Building Map</h2><div class="role">${title} · ${sub}</div></div>
     <div class="floortabs">
       <button class="${f==='f1'?'on':''}" onclick="brSetMapFloor('f1')">1st Floor · A</button>
       <button class="${f==='f2'?'on':''}" onclick="brSetMapFloor('f2')">2nd Floor · A + C</button>
     </div>
   </div>
   <p class="maphint">Every classroom shows its assigned teacher. <b>Tap a colored room</b> to open their schedule.</p>
   <div class="maplegend">${legend}</div>
   <div class="mapshell"><div class="mapscroll">${brBuildFloorSVG(f)}</div></div>`;
}

/* === R60: Publish for Teachers ===================================
   Exports a standalone, read-only Schedule Browser HTML file with all
   schedule data + blueprint geometry baked in as PUBLISHED_DATA. Assembly
   uses Function.prototype.toString() on an explicit allowlist of shared
   functions — no DOM scraping, no eval in the live app, and zero references
   to live-sync functions (brLoadFromVisualizer / AppState / getSubjects /
   toggleApp) or localStorage in the published output. Live-only. */

function brEscHTML(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* Shared browser runtime: every function the published file needs. Order
   matters only for readability — all are hoisted declarations except the
   arrow-const helpers, which are emitted separately below. */
function brPublishFnList() {
  return [
    brBuildOpts, brRenderMenu, brOpenMenu, brCloseMenu, brOnType, brOnKey,
    brWireDocClick, brSetMode, brChoose, brJumpTeacher, brJumpGroup,
    brDayRows, brRenderTeacher, brRenderGroup, brOverviewHTML,
    brGeoFindRoom, brGeoFloorSVG, brMiniMapHTML, brGroupMapHTML, brSetGrpDay,
    brOpenMapFloorIdx, brSetMapFloorIdx, brRenderMap, brRenderMapDyn
  ];
}

function brBuildPublishedMarkup(school, dateStr) {
  const esc = brEscHTML(school);
  return `<div id="app-browser">
  <div class="br-wrap">
    <header class="mast">
      <div class="seal" id="br-mast-initial">${esc.charAt(0) || 'S'}</div>
      <div>
        <h1 id="br-mast-school">${esc}</h1>
        <p class="sub">Teacher Schedule Browser</p>
      </div>
    </header>
    <div class="panel">
      <div class="toolbar">
        <div class="mode" role="tablist">
          <button id="br-mTeacher" class="on" role="tab" aria-selected="true"  onclick="brSetMode('teacher')">By Teacher</button>
          <button id="br-mGroup"   role="tab" aria-selected="false" onclick="brSetMode('group')">By Student Group</button>
          <button id="br-mMap"     role="tab" aria-selected="false" onclick="brSetMode('map')">Building Map</button>
        </div>
        <div class="br-field" id="br-searchField">
          <label id="br-searchLabel" for="br-search">Find a teacher</label>
          <div class="searchbox">
            <input id="br-search" type="text" autocomplete="off" placeholder="Type a name…"
              oninput="brOnType()" onfocus="brOpenMenu()" onkeydown="brOnKey(event)">
            <div id="br-menu" class="br-menu"></div>
          </div>
        </div>
        <button class="btn-print" onclick="window.print()">Print / Save PDF</button>
      </div>
      <div class="stage">
        <div id="br-empty" class="br-empty">
          <div class="big" id="br-empty-title">Pick a name to see a schedule.</div>
          <div id="br-empty-sub">Or switch to <b>By Student Group</b> to see every teacher a class shares.</div>
        </div>
        <div id="br-view" class="br-view"></div>
      </div>
    </div>
    <p class="footnote">Published ${dateStr} from the School Layout Visualizer ${TOOL_VERSION}. This file is a read-only snapshot — republish to update.</p>
  </div>
</div>`;
}

function brBuildPublishedHTML(socialBlock) {
  /* Refresh every snapshot from the live app immediately before assembly. */
  brLoadFromVisualizer();
  const school  = (AppState.settings.schoolName || 'Schedule Browser').trim() || 'Schedule Browser';
  const now     = new Date();
  const dateStr = now.toLocaleDateString(undefined, { year:'numeric', month:'long', day:'numeric' });
  const iso     = now.toISOString().slice(0, 10);

  const data = {
    school, publishedOn: iso,
    dept: BR_DEPT, order: BR_ORDER,
    teachers: BR_TEACHERS, sections: BR_SECTIONS, room2teacher: BR_ROOM2TEACHER,
    groupRooms: BR_GROUPROOMS, modCount: BR_MODCOUNT, modLabel: BR_MOD_LABEL,
    bell: BR_BELL, geometry: BR_GEOM
  };

  const consts = [
    'const BR_LEGACY_SHORT = ' + JSON.stringify(BR_LEGACY_SHORT) + ';',
    'const BR_DEPT_FALLBACK = ' + JSON.stringify(BR_DEPT_FALLBACK) + ';',
    'const brDColor = '  + brDColor.toString()  + ';',
    'const brTDept = '   + brTDept.toString()   + ';',
    'const brDShort = '  + brDShort.toString()  + ';',
    'const brOrderOf = ' + brOrderOf.toString() + ';'
  ].join('\n');

  const js = [
    "'use strict';",
    '/* Published by the School Layout Visualizer — read-only schedule snapshot. */',
    'const PUBLISHED_DATA = ' + JSON.stringify(data) + ';',
    'let BR_DEPT = PUBLISHED_DATA.dept, BR_ORDER = PUBLISHED_DATA.order;',
    consts,
    'let BR_TEACHERS = PUBLISHED_DATA.teachers, BR_SECTIONS = PUBLISHED_DATA.sections,',
    '    BR_ROOM2TEACHER = PUBLISHED_DATA.room2teacher, BR_MODCOUNT = PUBLISHED_DATA.modCount,',
    '    BR_MOD_LABEL = PUBLISHED_DATA.modLabel;',
    'let BR_GROUPROOMS = PUBLISHED_DATA.groupRooms || {}, BR_BELL = PUBLISHED_DATA.bell,',
    '    BR_GEOM = PUBLISHED_DATA.geometry;',
    "let brMode = 'teacher', brCurrent = null, brActiveIdx = -1, brOpts = [];",
    "let brGrpDay = 'A', brMapFloorIdx = 0;",
    brPublishFnList().map(f => f.toString()).join('\n\n'),
    'brWireDocClick();',
    'brBuildOpts();',
    'brRenderMenu();',
    'if (!Object.keys(BR_TEACHERS).length) {',
    "  document.getElementById('br-empty-title').textContent = 'No schedule data in this file.';",
    "  document.getElementById('br-empty-sub').textContent = 'Ask the publisher to re-export after adding rooms and groups.';",
    '}'
  ].join('\n');

  /* Fonts go in as base64 @font-face, not as a Google Fonts link.
     A published file is downloaded and emailed to staff: it has no folder
     next to it, so a relative path is impossible, and a hotlink means it
     renders in Times New Roman on any machine behind a filter that blocks
     Google Fonts — which is most school wifi. Roughly 100 KB, from
     schedule/fonts/published-fonts.js.

     If that script did not load, fall back to a system stack. Never fall back
     to a hotlink: the whole point is that a published file reaches for
     nothing. */
  const fontCss = (typeof window.BR_PUBLISHED_FONT_CSS === 'string' && window.BR_PUBLISHED_FONT_CSS)
    ? window.BR_PUBLISHED_FONT_CSS
    : '/* schedule/fonts/published-fonts.js did not load; using system fonts */\n'
      + "#app-browser{font-family:system-ui,-apple-system,'Segoe UI',sans-serif}\n"
      + "#app-browser .mast h1,#app-browser .idhead h2,#app-browser .block-title,"
      + "#app-browser .tcard .nm,#app-browser .maptop h2{font-family:Georgia,'Times New Roman',serif}\n";
  if (typeof window.BR_PUBLISHED_FONT_CSS !== 'string') {
    console.warn('[Browser] published-fonts.js missing — publishing with system fonts.');
  }

  const css = fontCss + '\n'
    + BR_CSS
    + '\n/* published overrides */\n'
    + '#app-browser{display:block}\n'
    + 'html,body{margin:0;padding:0;background:#f4f7f4}\n';

  /* socialBlock: the exact gvb:social:start..end comment pair out of an
     existing published copy, passed through verbatim when this call is
     regenerating the repo's own committed schedule-browser.html (locked
     decision #31 — never hand-synthesized here). Omitted for every other
     caller: brPublish()'s live download button passes nothing, since a
     teacher's personal copy has a different school name and no canonical
     greyversusblue.com URL to bake in. Nothing below reads or generates
     social tags on its own; this argument is the whole mechanism. */
  const social = socialBlock ? socialBlock.trim() + '\n' : '';

  return '<!DOCTYPE html>\n<html lang="en">\n<head>\n'
    + '<meta charset="UTF-8">\n'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + '<title>' + brEscHTML(school) + ' — Schedule Browser</title>\n'
    + social
    + '<style>\n' + css + '\n</style>\n</head>\n<body>\n'
    + brBuildPublishedMarkup(school, dateStr)
    + '\n<script>\n' + js + '\n<\/script>\n</body>\n</html>\n';
}

function brPublish() {
  try {
    const html   = brBuildPublishedHTML();
    const school = (AppState.settings.schoolName || 'School').trim() || 'School';
    const safe   = school.replace(/[^\w\- ]/g, '').trim().replace(/\s+/g, '_') || 'School';
    const iso    = new Date().toISOString().slice(0, 10);
    const blob   = new Blob([html], { type: 'text/html' });
    const url    = URL.createObjectURL(blob);
    const a      = document.createElement('a');
    a.href = url;
    a.download = `Schedule_Browser_${safe}_${iso}.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    if (typeof showToast === 'function') showToast('Published: ' + a.download, 'success');
  } catch (e) {
    console.error('[Browser] publish failed:', e);
    if (typeof showToast === 'function') showToast('Publish failed: ' + e.message, 'error');
    else alert('Publish failed: ' + e.message);
  }
}

/* ===== END SCHEDULE BROWSER JS ===== */
