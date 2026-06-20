'use strict';

// A tiny, self contained phone page: shows what Claude is doing right now and
// lets you pause or resume it from your pocket. It polls /api/phone every few
// seconds and posts to /api/pause. The token is baked in so the off-localhost
// requests are accepted.

function render(token) {
  const tok = JSON.stringify(token || '');
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#1c1b19">
<title>Pulse · phone</title>
<style>
:root{--bg:#1c1b19;--card:#26241f;--ink:#ece7df;--dim:#9a958c;--accent:#d97757;--line:#3a372f;--ok:#5a9e6f;--warn:#d9a154}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 -apple-system,system-ui,Segoe UI,Roboto,sans-serif;padding:16px;max-width:560px;margin:0 auto}
.head{display:flex;align-items:center;gap:8px;margin-bottom:14px}
.dot{width:10px;height:10px;border-radius:50%;background:var(--dim)}
.dot.work{background:var(--accent);animation:p 1.1s ease-in-out infinite}
.dot.wait{background:var(--warn)}
.dot.pause{background:var(--warn)}
@keyframes p{50%{opacity:.35}}
.state{font-size:18px;font-weight:600}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin:10px 0}
.title{font-size:15px;margin-bottom:4px}
.sub{color:var(--dim);font-size:13px}
.ctx{height:6px;background:var(--line);border-radius:3px;margin-top:10px;overflow:hidden}
.ctx > i{display:block;height:100%;background:var(--accent)}
.feed{margin-top:6px}
.fitem{font:13px/1.4 ui-monospace,Menlo,monospace;color:var(--dim);padding:3px 0;border-top:1px solid var(--line)}
.fitem b{color:var(--ink)}
.btn{display:block;width:100%;border:0;border-radius:14px;padding:16px;font-size:17px;font-weight:600;margin-top:14px;color:#fff;background:var(--warn)}
.btn.resume{background:var(--ok)}
.btn:active{opacity:.8}
.foot{color:var(--dim);font-size:12px;text-align:center;margin-top:18px}
.foot a{color:var(--accent);text-decoration:none}
</style></head><body>
<div class="head"><span class="dot" id="dot"></span><span class="state" id="state">connecting…</span></div>
<div class="card" id="active"><div class="sub">no active session</div></div>
<button class="btn" id="pause">Pause Claude</button>
<div class="foot"><a href="/">open full dashboard</a></div>
<script>
var TOKEN = ${tok};
var paused = false;
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function ago(t){if(!t)return '';var s=Math.round((Date.now()-t)/1000);if(s<60)return s+'s ago';var m=Math.round(s/60);if(m<60)return m+'m ago';return Math.round(m/60)+'h ago';}
function draw(d){
  paused=!!d.paused;
  var dot=document.getElementById('dot'), st=document.getElementById('state');
  var label='idle', cls='';
  if(d.paused){label='paused';cls='pause';}
  else if(d.waiting){label='waiting for you';cls='wait';}
  else if(d.working){label='working…';cls='work';}
  else if(d.active){label='resting';}
  dot.className='dot '+cls; st.textContent=label;
  var a=document.getElementById('active');
  if(d.active){
    var pct=d.active.contextPercent||0;
    a.innerHTML='<div class="title">'+esc(d.active.title||'(untitled)')+'</div>'+
      '<div class="sub">'+esc(d.active.project||'')+' · context '+pct+'% · '+ago(d.active.lastT)+'</div>'+
      '<div class="ctx"><i style="width:'+Math.min(100,pct)+'%"></i></div>'+
      (d.activity&&d.activity.length?'<div class="feed">'+d.activity.slice(0,10).map(function(x){
        return '<div class="fitem"><b>'+esc(x.name)+'</b> '+esc(x.hint||'')+'</div>';}).join('')+'</div>':'');
  } else { a.innerHTML='<div class="sub">no active session in the last few minutes</div>'; }
  var b=document.getElementById('pause');
  b.textContent=d.paused?'Resume Claude':'Pause Claude';
  b.className='btn'+(d.paused?' resume':'');
}
function poll(){fetch('/api/phone').then(function(r){return r.json();}).then(draw).catch(function(){document.getElementById('state').textContent='offline';});}
document.getElementById('pause').addEventListener('click',function(){
  var next=!paused;
  fetch('/api/pause?paused='+next+'&token='+encodeURIComponent(TOKEN),{method:'POST'}).then(function(){poll();}).catch(function(){});
});
poll(); setInterval(poll,3000);
</script>
</body></html>`;
}

module.exports = { render };
