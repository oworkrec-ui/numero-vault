"use strict";
const $ = id => document.getElementById(id);
const S = { me:null, admin:false, settings:{}, files:{}, users:{}, groups:{}, folders:{}, requests:{}, comments:{}, favs:[], recents:[], disk:null, binDays:30, live:[], liveRecent:[], viewing:null, pvEl:null, lastInput:Date.now(),
  events:[], aud:null, hits:null, tab:'files', q:'', deep:false, folder:'', view:'all', sort:'new', sel:new Set(), loaded:false, last:'', drill:null, afPending:null };
const PERMS = [['v','View'],['d','Download'],['c','Copy'],['e','Edit']];
const DAY = 86400000;
const MIME = {svg:'image/svg+xml',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',pdf:'application/pdf'};
const ALABEL = {view:'Opened', download:'Downloaded', copy:'Copied text', edit:'Edited', comment:'Commented', request:'Requested access',
  upload:'Uploaded', bin:'Moved to recycle bin', restore:'Restored from bin', purge:'Deleted forever', access:'Changed file access', folderaccess:'Changed folder access',
  folder:'Changed folder', move:'Moved', version:'Restored version', meta:'Changed details', useradd:'Added user', userremove:'Removed user', userchange:'Changed user',
  group:'Changed group', approve:'Approved request', refuse:'Refused request', reply:'Replied to comment', views:'Reset view count', login:'Signed in', loginfail:'Failed sign-in',
  password:'Changed password', settings:'Changed settings', watch:'Watched live', kick:'Signed out user', recover:'Recovered file'};
const LIBS = { jszip:['jszip.min.js','jszip/3.10.1/jszip.min.js','JSZip'], xlsx:['xlsx.full.min.js','xlsx/0.18.5/xlsx.full.min.js','XLSX'], mammoth:['mammoth.browser.min.js','mammoth/1.6.0/mammoth.browser.min.js','mammoth'],
  pdf:['pdf.min.js','pdf.js/3.11.174/pdf.min.js','pdfjsLib'], pdfworker:['pdf.worker.min.js','pdf.js/3.11.174/pdf.worker.min.js','pdfjsWorker'], pdflib:['pdf-lib.min.js','pdf-lib/1.17.1/pdf-lib.min.js','PDFLib'] };
const libP = {};
function lib(k){ if (!libP[k]) libP[k] = new Promise((res, rej) => { const [file, cdn, g] = LIBS[k];
    const add = (src, next) => { const s = document.createElement('script'); s.src = src; s.onload = () => { if (k==='pdfworker' && window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = src; res(window[g]); }; s.onerror = () => { s.remove(); next(); }; document.head.appendChild(s); };
    add('/vendor/'+file, () => add('https://cdnjs.cloudflare.com/ajax/libs/'+cdn, () => { libP[k] = null; rej({message:'A viewer component could not be loaded. Run "node get-libs.js" once on the server, or give this computer internet access.'}); })); });
  return libP[k]; }

/* ---------- small helpers ---------- */
const PROPS = new Set(['checked','disabled','value','selected','src','type','id','title','placeholder','multiple','min','max','rows','href']);
function h(tag, props, ...kids){
  const e = document.createElement(tag);
  if (props) for (const k in props){ const v = props[k]; if (v==null || v===false) continue;
    if (k==='class') e.className = v; else if (k==='text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (PROPS.has(k)) e[k] = v;
    else e.setAttribute(k, v===true ? '' : v); }
  for (const c of kids.flat(3)){ if (c==null || c===false) continue; e.appendChild(c instanceof Node ? c : document.createTextNode(String(c))); }
  return e;
}
function toast(msg, ms){ const t = h('div',{class:'toast',text:msg}); $('toasts').appendChild(t); setTimeout(()=>t.remove(), ms||4200); }
const extOf = n => { const m = /\.([A-Za-z0-9]{1,8})$/.exec(n||''); return m ? m[1].toLowerCase() : ''; };
const fmtSize = b => b<1024 ? b+' B' : b<1048576 ? (b/1024).toFixed(0)+' KB' : b<1073741824 ? (b/1048576).toFixed(1)+' MB' : (b/1073741824).toFixed(2)+' GB';
const fmtDate = t => t ? new Date(t).toLocaleString(undefined,{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '';
const fmtDay = s => { const d = new Date(s+'T00:00:00'); return isNaN(d) ? '' : d.toLocaleDateString(undefined,{day:'2-digit',month:'short',year:'numeric'}); };
const pad = n => String(n).padStart(2,'0');
const dstr = d => d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const daysUntil = s => { const d = new Date(s+'T00:00:00'); return isNaN(d) ? null : Math.round((d - new Date(dstr(new Date())+'T00:00:00'))/DAY); };
const normPerm = s => { s = String(s||''); let out = PERMS.map(p=>p[0]).filter(c=>s.includes(c)).join(''); if (out && !out.includes('v')) out = 'v'+out; return out; };
const permWords = p => p ? PERMS.filter(x=>p.includes(x[0])).map(x=>x[1]).join(', ') : 'No access';
const cleanPath = s => String(s||'').split('/').map(x=>x.trim().slice(0,60)).filter(Boolean).slice(0,8).join('/');
const inFolder = (f, p) => !p || f.folder===p || f.folder.startsWith(p+'/');
const errMsg = e => (e && e.message) || 'Something went wrong.';
function kindOf(name){ const e = extOf(name);
  if (['png','jpg','jpeg','gif','webp','svg','bmp'].includes(e)) return 'img';
  if (e==='pdf') return 'pdf';
  if (['mp4','webm','mov'].includes(e)) return 'vid';
  if (['mp3','wav','m4a','ogg'].includes(e)) return 'aud';
  if (e==='docx') return 'docx';
  if (['xlsx','xls','csv','xlsm','ods'].includes(e)) return 'sheet';
  if (e==='pptx') return 'pptx';
  if (['txt','md','json','log','xml','html','htm','css','js','ts','py','yml','yaml','ini','sql','tsv'].includes(e)) return 'text';
  return 'other'; }
const indexable = name => ['pdf','docx','sheet','pptx','text'].includes(kindOf(name));
function badge(name){ const k = kindOf(name), e = extOf(name).toUpperCase().slice(0,4) || 'FILE';
  const cls = k==='pdf'?'pdf':(k==='docx'||k==='sheet'||k==='pptx')?'doc':k==='img'?'img':k==='vid'?'vid':'';
  return h('span',{class:'badge '+cls,text:e}); }
function permChips(p){ return h('span',{class:'perms',title:PERMS.map(x=>x[1]+': '+(p.includes(x[0])?'yes':'no')).join(', ')}, PERMS.map(x=>h('span',{class:p.includes(x[0])?'on':'',text:x[0].toUpperCase()}))); }
const pname = id => !id ? 'System' : (S.users[id] && S.users[id].name) || (S.me && id===S.me.id ? S.me.name : 'Removed user');
const people = () => Object.keys(S.users).filter(u => S.users[u].role!=='admin').sort((a,b)=>pname(a).localeCompare(pname(b)));
function reviewPill(f){ if (!f.review) return null; const d = daysUntil(f.review); if (d==null) return null;
  return h('span',{class:'pill '+(d<0?'crit':d<=30?'warn':''),text:(d<0?'Review overdue ':'Review ')+fmtDay(f.review)}); }

/* ---------- server calls ---------- */
async function api(method, url, body){
  let r; try { r = await fetch(url, {method, credentials:'same-origin', headers:Object.assign({'X-Vault':'1'}, body!==undefined ? {'Content-Type':'application/json'} : {}), body:body!==undefined ? JSON.stringify(body) : undefined}); }
  catch(e){ throw {message:'The server cannot be reached. Check that Numero Vault is running.'}; }
  let d = null; try { d = await r.json(); } catch(e){}
  if (r.status===401 && !(d && d.code==='login')){ showLogin(); throw {message:'Please sign in.', code:'auth'}; }
  if (!r.ok) throw {message:(d && d.error) || 'The request failed ('+r.status+').', code:d && d.code};
  return d || {};
}
async function act(fn, okMsg){ try { await fn(); if (okMsg) toast(okMsg); await refresh(true); return true; } catch(e){ if (!(e && e.code==='auth')) toast(errMsg(e)); return false; } }
function xhrSend(method, url, blob, onprog){ return new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open(method, url); x.setRequestHeader('X-Vault','1');
  x.upload.onprogress = e => { if (e.lengthComputable && onprog) onprog(e.loaded/e.total); };
  x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch(e){} x.status < 300 ? res(d) : rej({message:d.error || 'The upload failed ('+x.status+').'}); };
  x.onerror = () => rej({message:'The connection to the server was lost during the upload.'}); x.send(blob); }); }
async function refresh(force){
  let d; try { d = await api('GET', '/api/state'); } catch(e){ return; }
  if (d.mustChange){ S.me = d.me; S.settings = d.settings || {}; applyTheme(); showApp(); forcePassword(); return; }
  const txt = JSON.stringify(d); if (!force && txt===S.last) return; S.last = txt;
  Object.assign(S, {me:d.me, admin:!!d.admin, settings:d.settings||{}, files:d.files||{}, users:d.users||{}, groups:d.groups||{}, folders:d.folders||{}, requests:d.requests||{}, comments:d.comments||{},
    favs:d.favs||[], recents:d.recents||[], server:d.server||null, disk:d.disk||null, binDays:d.binDays||30, loaded:true});
  applyTheme(); showApp(); setupRole(); render();
}
async function loadEvents(){ if (!S.admin) return; try { S.events = (await api('GET', '/api/audit')).events || []; } catch(e){} }

/* ---------- sign-in, password, theme ---------- */
function showLogin(){ $('app').classList.add('hide'); $('login').classList.remove('hide'); closeModal(); S.loaded = false; S.last = ''; setTimeout(()=>$('lgUser').focus(), 0); }
function showApp(){ $('login').classList.add('hide'); $('app').classList.remove('hide'); }
$('loginForm').addEventListener('submit', async e => { e.preventDefault(); const btn = $('lgBtn'); btn.disabled = true; $('lgErr').textContent = '';
  try { await api('POST', '/api/login', {username:$('lgUser').value, password:$('lgPass').value}); $('lgPass').value = ''; await refresh(true); }
  catch(er){ $('lgErr').textContent = errMsg(er); } btn.disabled = false; });
$('btnOut').addEventListener('click', async () => { try { await api('POST', '/api/logout'); } catch(e){} location.reload(); });
function passwordDialog(forced){
  const old = h('input',{type:'password',id:'pwOld',autocomplete:'current-password'}), nw = h('input',{type:'password',id:'pwNew',autocomplete:'new-password'}), again = h('input',{type:'password',id:'pwAgain',autocomplete:'new-password'}), err = h('div',{class:'err'});
  const save = h('button',{class:'btn primary',text:'Save password',onclick:async()=>{ if (nw.value !== again.value){ err.textContent = 'The two new passwords do not match.'; return; }
    try { await api('POST', '/api/password', {old:old.value, new:nw.value}); forcedOpen = false; closeModal(); toast('Password changed.'); await refresh(true); } catch(e){ err.textContent = errMsg(e); } }});
  openModal(forced ? 'Choose your own password' : 'Change password', [forced ? h('div',{class:'sub',text:'You signed in with a temporary password. Choose a new one, at least 8 characters, to continue.'}) : null,
    h('label',{class:'field'}, h('span',{text:forced ? 'Temporary password' : 'Current password'}), old), h('label',{class:'field'}, h('span',{text:'New password'}), nw), h('label',{class:'field'}, h('span',{text:'New password again'}), again), err],
    [forced ? h('button',{class:'btn',text:'Sign out',onclick:()=>{ forcedOpen = false; $('btnOut').click(); }}) : h('button',{class:'btn',text:'Cancel',onclick:closeModal}), save], {locked:forced});
}
let forcedOpen = false;
function forcePassword(){ if (forcedOpen) return; forcedOpen = true; passwordDialog(true); }
$('btnPass').addEventListener('click', () => passwordDialog(false));
const local = { get(k){ try { return localStorage.getItem('nv.'+k) || ''; } catch(e){ return ''; } }, set(k,v){ try { v ? localStorage.setItem('nv.'+k, v) : localStorage.removeItem('nv.'+k); } catch(e){} } };
function applyTheme(){
  const brand = /^#[0-9a-f]{6}$/i.test(local.get('brand')) ? local.get('brand') : (S.settings.brand || '#1f4081'), mode = local.get('mode'), root = document.documentElement;
  const lum = (parseInt(brand.slice(1,3),16)*299 + parseInt(brand.slice(3,5),16)*587 + parseInt(brand.slice(5,7),16)*114)/1000;
  root.style.setProperty('--brand', brand); root.style.setProperty('--brand-ink', lum > 150 ? '#101522' : '#ffffff');
  if (mode==='light' || mode==='dark') root.setAttribute('data-theme', mode); else root.removeAttribute('data-theme');
}
const SWATCHES = [['#1f4081','Numero blue'],['#0d6656','Teal'],['#0f7a3a','Green'],['#5b3a9b','Purple'],['#8a1f4a','Maroon'],['#b3541e','Copper'],['#1f6f8b','Steel'],['#2f3a4a','Slate']];
$('btnTheme').addEventListener('click', () => {
  const cur = () => local.get('brand') || S.settings.brand || '#1f4081', sw = h('div',{class:'swatches'}), custom = h('input',{type:'color',id:'thCustom',value:cur(),title:'Any other colour','aria-label':'Custom colour'});
  const draw = () => { sw.replaceChildren(...SWATCHES.map(([c,n]) => h('button',{class:'swatch'+(cur()===c?' on':''),style:'background:'+c,title:n,'aria-label':n,onclick:()=>pick(c)})), custom); };
  const pick = c => { local.set('brand', c); applyTheme(); custom.value = c; draw(); };
  custom.addEventListener('input', e => { local.set('brand', e.target.value); applyTheme(); });
  const mode = h('select',{id:'thMode',onchange:e=>{ local.set('mode', e.target.value); applyTheme(); }}, [['','Follow this device'],['light','Light'],['dark','Dark']].map(([v,t]) => h('option',{value:v,text:t,selected:local.get('mode')===v})));
  draw();
  openModal('Theme colour', [h('div',{class:'field'}, h('span',{text:'Colour'}), sw), h('label',{class:'field'}, h('span',{text:'Light or dark'}), mode),
    h('div',{class:'sub',text:'Your choice is remembered in this browser.'+(S.admin ? ' As an admin you can also make this colour the default for everyone who has not chosen their own.' : '')})],
    [h('button',{class:'btn',text:'Use the vault default',onclick:()=>{ local.set('brand',''); applyTheme(); custom.value = cur(); draw(); }}),
     S.admin ? h('button',{class:'btn',text:'Set as default for everyone',onclick:()=>act(()=>api('PATCH','/api/settings',{brand:cur()}), 'Default colour saved.')}) : null,
     h('button',{class:'btn primary',text:'Done',onclick:closeModal})]);
});

/* ---------- modal ---------- */
let modalCleanup = null, modalLocked = false;
function openModal(title, body, foot, opts){
  closeModal(true);
  modalLocked = !!(opts && opts.locked);
  $('modal').className = 'modal' + (opts && opts.wide ? ' wide' : '');
  $('mhead').replaceChildren(h('h2',{text:title}), ...(opts && opts.head || []), modalLocked ? null : h('button',{class:'btn sm',onclick:()=>closeModal(),text:'Close'}));
  const mb = $('mbody'); mb.replaceChildren(...[].concat(body).filter(Boolean)); mb.style.padding = opts && opts.flush ? '0' : '';
  $('mfoot').replaceChildren(...(foot||[]).filter(Boolean)); $('mfoot').classList.toggle('hide', !(foot && foot.length));
  $('overlay').classList.add('open'); modalCleanup = opts && opts.onclose || null;
  const f = $('mbody').querySelector('input,textarea,button'); if (f) f.focus();
}
function closeModal(force){ if (modalLocked && force!==true && forcedOpen) return; modalLocked = false; $('overlay').classList.remove('open'); if (modalCleanup){ const c = modalCleanup; modalCleanup = null; try{ c(); }catch(e){} } $('mbody').replaceChildren(); }
$('overlay').addEventListener('mousedown', e => { if (e.target === $('overlay')) closeModal(); });
document.addEventListener('keydown', e => { if (e.key==='Escape' && $('overlay').classList.contains('open')) closeModal(); });
function confirmDialog(title, msg, okLabel){ return new Promise(res => { let done = false;
  openModal(title, [h('p',{text:msg,style:'margin:0'})],
    [h('button',{class:'btn',text:'Cancel',onclick:()=>closeModal()}), h('button',{class:'btn danger',text:okLabel,onclick:()=>{ done = true; closeModal(); res(true); }})],
    {onclose:()=>{ if (!done) res(false); }}); }); }

/* ---------- text extraction (search inside files) ---------- */
async function pptxSlideNames(zip){ return Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a,b)=>parseInt(a.match(/(\d+)\.xml$/)[1])-parseInt(b.match(/(\d+)\.xml$/)[1])); }
async function extractText(blob, name){
  const k = kindOf(name); let t = '';
  if (k==='text') t = await blob.text();
  else if (k==='docx'){ const mammoth = await lib('mammoth'); t = (await mammoth.extractRawText({arrayBuffer:await blob.arrayBuffer()})).value; }
  else if (k==='sheet'){ const XLSX = await lib('xlsx'), wb = XLSX.read(await blob.arrayBuffer(), {type:'array'}); t = wb.SheetNames.map(n => n+'\n'+XLSX.utils.sheet_to_csv(wb.Sheets[n])).join('\n\n'); }
  else if (k==='pptx'){ const JSZip = await lib('jszip'), zip = await JSZip.loadAsync(await blob.arrayBuffer()), out = [];
    for (const n of await pptxSlideNames(zip)){ const x = new DOMParser().parseFromString(await zip.file(n).async('string'), 'application/xml'); out.push([...x.getElementsByTagName('a:t')].map(e=>e.textContent).join(' ')); }
    t = out.join('\n\n'); }
  else if (k==='pdf'){ const pdfjsLib = await lib('pdf'); await lib('pdfworker'); const doc = await pdfjsLib.getDocument({data:await blob.arrayBuffer()}).promise, out = [];
    for (let i=1;i<=Math.min(doc.numPages,400);i++){ const tc = await (await doc.getPage(i)).getTextContent(); out.push(tc.items.map(x=>x.str).join(' ')); }
    t = out.join('\n\n'); }
  return t.slice(0, 1500000);
}
async function indexText(id, blob, name){ if (!indexable(name) || blob.size > 80*1048576) return;
  try { const t = await extractText(blob, name); if (!t.trim()) return;
    await fetch('/api/files/'+id+'/text', {method:'PUT', credentials:'same-origin', headers:{'X-Vault':'1','Content-Type':'text/plain'}, body:t}); } catch(e){} }
let searchTimer = null, searchRun = 0;
function runSearch(){ clearTimeout(searchTimer); const q = S.q.trim(); if (!S.deep || q.length < 2){ S.hits = null; return; }
  searchTimer = setTimeout(async () => { const run = ++searchRun; try { const r = await api('GET', '/api/search?q='+encodeURIComponent(q)); if (run===searchRun){ S.hits = r.hits || {}; renderFiles(); } } catch(e){} }, 300); }

/* ---------- derived views ---------- */
function norm(id, f){ return { id, name:String(f.name||'Untitled'), mime:String(f.mime||''), size:+f.size||0, folder:String(f.folder||''), at:+(f.updatedAt||f.at)||0, by:String(f.updatedBy||f.by||''),
  p:S.admin ? 'vdce' : String(f.p||''), grants:f.grants||{}, ggrants:f.ggrants||{}, limits:f.limits||{}, views:f.views||{}, once:f.once||{}, versions:Array.isArray(f.versions)?f.versions:[],
  desc:String(f.desc||''), tags:Array.isArray(f.tags)?f.tags:[], docDate:String(f.docDate||''), review:String(f.review||''), deletedAt:+f.deletedAt||0, hasText:!!f.hasText,
  lim:+f.lim||0, used:+f.used||0, over:!!f.over, one:!!f.one, thread:f.thread||[], req:String(f.req||''), people:+f.people||0 }; }
const allFiles = () => Object.entries(S.files).map(([id,f]) => norm(id,f));
const liveFiles = () => allFiles().filter(f => !f.deletedAt);
const allEvents = () => S.events;
function pendingRequests(){ return Object.entries(S.requests).map(([id,r]) => Object.assign({id}, r)).filter(r => S.files[r.fid]).sort((a,b)=>b.at-a.at); }

/* ---------- rendering ---------- */
let roleSet = false;
function setupRole(){
  $('adminHelp').classList.toggle('hide', !S.admin); $('uploadBtn').classList.toggle('hide', !S.admin); $('monNote').classList.toggle('hide', S.admin);
  for (const b of $('tabs').children) b.classList.toggle('hide', !S.admin && b.dataset.tab!=='files');
  $('subline').textContent = S.admin ? 'Documents, sheets, slides, PDFs and images, opened only by the people you allow.' : 'Files shared with you. The letters beside each file show what you may do with it.';
  if (!roleSet){ roleSet = true; setTab(location.hash.slice(1) || 'files'); }
  if (!S.admin && S.tab!=='files') setTab('files');
}
function render(){
  renderWho(); if (!S.loaded) return;
  if (S.tab==='files'){ renderFiles(); return; }
  if (!S.admin) return;
  if (S.tab==='live') renderLive(); else if (S.tab==='people') renderPeople(); else if (S.tab==='requests') renderRequests(); else if (S.tab==='dashboard') renderDash(); else if (S.tab==='audit') renderAudit();
}
function renderWho(){
  const w = $('who'); if (!S.me){ w.replaceChildren(); return; }
  const sv = S.admin && S.server, warn = $('storeWarn'), info = $('storeInfo');
  warn.classList.toggle('hide', !(sv && sv.storageError)); if (sv && sv.storageError) warn.textContent = 'Nothing is being saved right now. '+sv.storageError+' Check that the server account may write to that folder and that the disk is not full.';
  info.classList.toggle('hide', !sv); if (sv) info.textContent = 'Data folder on the server: '+sv.dataDir+' · last saved '+(sv.saved ? fmtDate(sv.saved) : 'never')+' · server running since '+fmtDate(sv.started);
  w.replaceChildren(...[h('div',null, h('div',{text:S.me.name,style:'font-weight:600'}), h('div',{class:'sub',text:S.me.username})), S.admin ? h('span',{class:'pill admin',text:'Admin'}) : null].filter(Boolean));
  if (S.admin){ const n = pendingRequests().length, b = $('reqN'); b.textContent = n; b.classList.toggle('hide', !n); }
}
function renderSide(all){
  const live = all.filter(f => !f.deletedAt), favs = new Set(S.favs);
  const views = [['all','All files',live.length],['fav','Favourites',live.filter(f=>favs.has(f.id)).length],['recent','Recently opened',null]];
  if (S.admin){ views.push(['review','Review due',live.filter(f=>{ const d = f.review ? daysUntil(f.review) : null; return d!=null && d<=30; }).length]); views.push(['bin','Recycle bin',all.length-live.length]); }
  $('views').replaceChildren(...views.map(([k,label,c]) => h('button',{class:'navbtn'+(S.view===k?' on':''),onclick:()=>{ S.view = k; S.sel.clear(); renderFiles(); }}, h('span',{text:label}), c==null ? null : h('span',{class:'c',text:c}))));
  const paths = new Set(), add = p => { const ps = p.split('/'); for (let i=1;i<=ps.length;i++) paths.add(ps.slice(0,i).join('/')); };
  live.forEach(f => { if (f.folder) add(f.folder); });
  if (S.admin) Object.keys(S.folders).forEach(add);
  if (S.folder && !paths.has(S.folder)) S.folder = '';
  const key = p => p.replace(/\//g,'\u0001'), sorted = [...paths].sort((a,b)=> key(a)<key(b) ? -1 : 1);
  $('tree').replaceChildren(h('button',{class:'navbtn'+(S.folder===''?' on':''),onclick:()=>{ S.folder = ''; renderFiles(); }}, h('span',{text:'All folders'})),
    ...sorted.map(p => { const depth = p.split('/').length-1, d = S.folders[p];
      const shared = d && (Object.values(d.grants||{}).some(normPerm) || Object.values(d.ggrants||{}).some(normPerm));
      return h('button',{class:'navbtn'+(S.folder===p?' on':''),style:'padding-left:'+(8+depth*14)+'px',title:p,onclick:()=>{ S.folder = p; renderFiles(); }},
        h('span',{text:p.split('/').pop()+(shared?' · shared':'')}), h('span',{class:'c',text:live.filter(f=>inFolder(f,p)).length})); }));
  const tools = [];
  if (S.admin){ tools.push(h('button',{class:'btn sm',text:'New folder',onclick:newFolder}));
    if (S.folder){ tools.push(h('button',{class:'btn sm',text:'Folder access',onclick:()=>openFolderAccess(S.folder)}));
      if (!live.some(f=>inFolder(f,S.folder))) tools.push(h('button',{class:'btn sm danger',text:'Delete folder',onclick:()=>deleteFolder(S.folder)})); } }
  $('folderTools').replaceChildren(...tools);
}
function renderFiles(){
  const box = $('fileList');
  if (!S.loaded){ box.replaceChildren(h('div',{class:'empty',text:'Opening the vault…'})); return; }
  const all = allFiles(); renderSide(all);
  $('meter').textContent = ''; if (S.admin && S.disk) $('meter').textContent = fmtSize(S.disk.used)+' stored'+(S.disk.free!=null ? ' · '+fmtSize(S.disk.free)+' free on the server' : '');
  const favs = new Set(S.favs), q = S.q.trim().toLowerCase(), bin = S.view==='bin';
  let list = all.filter(f => bin ? f.deletedAt : !f.deletedAt).filter(f => inFolder(f, bin ? '' : S.folder));
  if (S.view==='fav') list = list.filter(f => favs.has(f.id));
  if (S.view==='review') list = list.filter(f => { const d = f.review ? daysUntil(f.review) : null; return d!=null && d<=30; });
  if (S.view==='recent') list = list.filter(f => S.recents.includes(f.id));
  if (q) list = list.filter(f => { if (f.name.toLowerCase().includes(q) || f.desc.toLowerCase().includes(q) || f.tags.some(t=>String(t).toLowerCase().includes(q))) return true;
    if (S.deep && S.hits && S.hits[f.id]){ f.snip = S.hits[f.id]; return true; } return false; });
  list.sort(S.view==='recent' ? (a,b)=>S.recents.indexOf(a.id)-S.recents.indexOf(b.id) : S.sort==='name' ? (a,b)=>a.name.localeCompare(b.name) : S.sort==='size' ? (a,b)=>b.size-a.size : (a,b)=>(bin?b.deletedAt-a.deletedAt:b.at-a.at));
  for (const id of [...S.sel]) if (!list.some(f=>f.id===id)) S.sel.delete(id);
  renderBulk(list);
  if (!list.length){
    let title, text;
    if (q || S.folder || S.view!=='all'){ title = bin ? 'The recycle bin is empty' : 'No files here'; text = bin ? 'Deleted files stay here for '+S.binDays+' days so you can restore them, then they are removed for good.' : 'Clear the search, or pick another view or folder.'; }
    else if (S.admin){ title = 'The vault is empty'; text = 'Upload PDF, Word, Excel, PowerPoint, images or any other file, of any size. Then add people on the People tab and choose what each may do.'; }
    else { title = 'Nothing shared with you yet'; text = 'Files the admin grants to you will appear here.'; }
    box.replaceChildren(h('div',{class:'empty'}, h('strong',{text:title}), h('span',{text}),
      S.admin && !q && S.view==='all' ? h('button',{class:'btn primary',text:'Upload files',onclick:()=>$('fileInput').click()}) : null));
    return;
  }
  const rows = list.map(f => { const more = [];
    if (f.folder && f.folder!==S.folder) more.push(h('span',{text:f.folder}));
    f.tags.slice(0,4).forEach(t => more.push(h('span',{class:'pill tag',text:t})));
    if (f.over) more.push(h('span',{class:'pill crit',text:'View limit reached'}));
    else if (f.lim && !S.admin) more.push(h('span',{class:'pill',text:f.used+' of '+f.lim+' views used'}));
    if (f.one) more.push(h('span',{class:'pill warn',text:'One-time edit allowed'}));
    if (f.req) more.push(h('span',{class:'pill warn',text:'Request pending'}));
    if (S.admin){ const rp = reviewPill(f); if (rp) more.push(rp); }
    if (bin) more.push(h('span',{class:'pill',text:'Deleted '+fmtDate(f.deletedAt)+' · '+Math.max(0, S.binDays-Math.floor((Date.now()-f.deletedAt)/DAY))+' days left'}));
    if (f.snip) more.push(h('span',{text:f.snip}));
    return h('tr',null,
      S.admin ? h('td',{style:'width:28px;padding-right:0'}, h('input',{type:'checkbox',id:'sel-'+f.id,'aria-label':'Select '+f.name,checked:S.sel.has(f.id),onchange:e=>{ e.target.checked ? S.sel.add(f.id) : S.sel.delete(f.id); renderBulk(list); }})) : null,
      h('td',null, h('div',{class:'fname'},
        bin ? null : h('button',{class:'star'+(favs.has(f.id)?' on':''),'aria-label':favs.has(f.id)?'Remove from favourites':'Add to favourites',title:'Favourite',text:favs.has(f.id)?'★':'☆',onclick:()=>act(()=>api('POST','/api/favs',{fid:f.id,on:!favs.has(f.id)}))}),
        badge(f.name), h('div',null, h('button',{class:'t',text:f.name,title:'Open '+f.name,onclick:()=>bin?openDetails(f):openPreview(f)}), more.length ? h('div',{class:'more'}, more) : null))),
      h('td',{class:'num hide-sm',text:fmtSize(f.size)}),
      h('td',{class:'meta hide-sm',text:fmtDate(f.at)}),
      h('td',null, S.admin ? h('button',{class:'btn sm',text:f.people+(f.people===1?' person':' people'),title:'Choose who can use this file',onclick:()=>openFileAccess(f)}) : permChips(f.p)),
      h('td',null, h('div',{class:'acts'}, bin ? [h('button',{class:'btn sm',text:'Restore',onclick:()=>bulk([f],'restore','Restored.')}), h('button',{class:'btn sm danger',text:'Delete forever',onclick:()=>purgeFiles([f])})] : [
        f.p.includes('v') ? h('button',{class:'btn sm',text:'Open',onclick:()=>openPreview(f)}) : null,
        f.p.includes('d') ? h('button',{class:'btn sm',text:'Download',onclick:()=>download(f)}) : null,
        h('button',{class:'btn sm',text:'Details',onclick:()=>openDetails(f)})])));
  });
  const allSel = list.every(f=>S.sel.has(f.id));
  box.replaceChildren(h('table',null, h('thead',null, h('tr',null,
    S.admin ? h('th',{style:'width:28px;padding-right:0'}, h('input',{type:'checkbox',id:'selAll','aria-label':'Select all',checked:allSel,onchange:e=>{ list.forEach(f => e.target.checked ? S.sel.add(f.id) : S.sel.delete(f.id)); renderFiles(); }})) : null,
    h('th',{text:'File'}), h('th',{class:'hide-sm',text:'Size'}), h('th',{class:'hide-sm',text:'Updated'}), h('th',{text:S.admin?'Access':'You may'}), h('th',null))), h('tbody',null, rows)));
}
function renderBulk(list){
  const bar = $('bulkBar'), sel = list.filter(f => S.sel.has(f.id)); bar.classList.toggle('hide', !sel.length); if (!sel.length) return;
  bar.replaceChildren(h('strong',{text:sel.length+' selected'}), ...(S.view==='bin' ? [
      h('button',{class:'btn sm',text:'Restore',onclick:()=>bulk(sel,'restore','Restored.')}), h('button',{class:'btn sm danger',text:'Delete forever',onclick:()=>purgeFiles(sel)})] : [
      h('button',{class:'btn sm',text:'Move to folder',onclick:()=>moveFiles(sel)}), h('button',{class:'btn sm',text:'Add access',onclick:()=>bulkAccess(sel)}),
      h('button',{class:'btn sm danger',text:'Delete',onclick:()=>binFiles(sel)})]),
    h('button',{class:'btn sm',text:'Clear selection',onclick:()=>{ S.sel.clear(); renderFiles(); }}));
}
function permBoxes(value, onchange, idp){
  let p = normPerm(value);
  const wrap = h('div',{class:'checks'});
  const draw = () => wrap.replaceChildren(...PERMS.map(([c,label]) => h('label',null,
    h('input',{type:'checkbox',id:idp+'-'+c,checked:p.includes(c),onchange:e=>{
      let set = new Set(p); if (e.target.checked){ set.add(c); set.add('v'); } else { set.delete(c); if (c==='v') set.clear(); }
      p = normPerm([...set].join('')); draw(); onchange(p); }}), label)));
  draw(); return wrap;
}

/* ---------- People tab ---------- */
function genPw(){ const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', r = new Uint32Array(12); crypto.getRandomValues(r); return [...r].map(x => a[x % a.length]).join(''); }
function renderPeople(){
  const gids = Object.keys(S.groups).sort((a,b)=>String(S.groups[a].name).localeCompare(String(S.groups[b].name)));
  $('groupList').replaceChildren(gids.length ? h('table',null, h('thead',null, h('tr',null, h('th',{text:'Group'}), h('th',{text:'Default access for new files'}), h('th',{text:'Members'}), h('th',null))),
    h('tbody',null, gids.map(g => h('tr',null, h('td',{text:String(S.groups[g].name||'Group')}),
      h('td',null, permBoxes(S.groups[g].defaults, v => act(()=>api('PATCH','/api/groups/'+g,{defaults:v})), 'g-'+g)),
      h('td',{class:'num',text:Object.values(S.users).filter(u => (u.groups||[]).includes(g)).length}),
      h('td',null, h('div',{class:'acts'}, h('button',{class:'btn sm danger',text:'Delete group',onclick:async()=>{
        if (await confirmDialog('Delete group', 'Delete the group "'+S.groups[g].name+'"? Its members lose any access that came through this group.', 'Delete')) act(()=>api('DELETE','/api/groups/'+g), 'Group deleted.'); }})))))))
    : h('div',{class:'empty'}, h('span',{text:'No groups yet. Create one, for example Sales or Accounts, then grant files or folders to the whole group at once.'})));
  const ids = Object.keys(S.users).sort((a,b)=>pname(a).localeCompare(pname(b))), total = liveFiles().length;
  const rows = ids.map(uid => { const u = S.users[uid], isAdmin = u.role==='admin', self = uid===S.me.id;
    return h('tr',null,
      h('td',null, h('div',null, h('div',{text:u.name,style:'font-weight:500'}), h('div',{class:'sub',text:u.username+(u.mustChange?' · has a temporary password':'')}))),
      h('td',null, h('select',{id:'role-'+uid,'aria-label':'Role of '+u.name,disabled:self,onchange:e=>act(()=>api('PATCH','/api/users/'+uid,{role:e.target.value}))}, h('option',{value:'user',text:'User',selected:!isAdmin}), h('option',{value:'admin',text:'Admin',selected:isAdmin}))),
      h('td',null, isAdmin ? h('span',{class:'sub',text:'Not needed'}) : gids.length ? h('div',{class:'checks'}, gids.map(g => h('label',null, h('input',{type:'checkbox',id:'ug-'+uid+'-'+g,checked:u.groups.includes(g),onchange:e=>{
        const next = u.groups.filter(x => x!==g); if (e.target.checked) next.push(g); act(()=>api('PATCH','/api/users/'+uid,{groups:next})); }}), String(S.groups[g].name||'Group')))) : h('span',{class:'sub',text:'No groups'})),
      h('td',null, isAdmin ? h('span',{class:'sub',text:'Full access to everything'}) : permBoxes(u.defaults, v => act(()=>api('PATCH','/api/users/'+uid,{defaults:v})), 'd-'+uid)),
      h('td',{class:'num',text:isAdmin ? 'All' : u.fileCount+' of '+total}),
      h('td',null, h('div',{class:'checks'}, h('label',null, h('input',{type:'checkbox',id:'act-'+uid,checked:u.active,disabled:self,onchange:e=>act(()=>api('PATCH','/api/users/'+uid,{active:e.target.checked}))}), 'Active'))),
      h('td',{class:'meta',text:u.lastSeen ? fmtDate(u.lastSeen) : 'Never'}),
      h('td',null, h('div',{class:'acts'},
        h('button',{class:'btn sm',text:'Reset password',onclick:()=>resetPassword(uid)}),
        isAdmin ? null : h('button',{class:'btn sm',text:'Apply to all files',title:'Give this person their default access on every file',onclick:async()=>{
          if (await confirmDialog('Apply to all files', 'Set '+u.name+' to "'+permWords(normPerm(u.defaults))+'" on all '+total+' files? This replaces any per-file setting for this person.', 'Apply')) act(()=>api('PATCH','/api/users/'+uid,{applyDefaults:true}), 'Access updated.'); }}),
        self ? null : h('button',{class:'btn sm danger',text:'Remove',onclick:async()=>{
          if (await confirmDialog('Remove user', 'Remove '+u.name+' from the vault? They can no longer sign in and lose access to every file.', 'Remove')) act(()=>api('DELETE','/api/users/'+uid), 'User removed.'); }}))));
  });
  $('userList').replaceChildren(h('table',null, h('thead',null, h('tr',null, h('th',{text:'Person'}), h('th',{text:'Role'}), h('th',{text:'Groups'}), h('th',{text:'Default access for new files'}), h('th',{text:'Files'}), h('th',{text:'Status'}), h('th',{text:'Last seen'}), h('th',null))), h('tbody',null, rows)));
}
$('groupAdd').addEventListener('click', () => { const name = $('groupName').value.trim(); if (name) act(async()=>{ await api('POST','/api/groups',{name}); $('groupName').value = ''; }); });
$('userAdd').addEventListener('click', () => {
  const un = h('input',{type:'text',id:'nuUser',placeholder:'For example ali.khan',autocomplete:'off'}), nm = h('input',{type:'text',id:'nuName',placeholder:'Full name'}), pw = h('input',{type:'text',id:'nuPass',value:genPw(),autocomplete:'off'});
  const role = h('select',{id:'nuRole'}, h('option',{value:'user',text:'User'}), h('option',{value:'admin',text:'Admin (sees and manages everything)'})), err = h('div',{class:'err'});
  openModal('Add user', [h('div',{class:'row2'}, h('label',{class:'field'}, h('span',{text:'Username'}), un), h('label',{class:'field'}, h('span',{text:'Display name'}), nm)),
    h('div',{class:'row2'}, h('label',{class:'field'}, h('span',{text:'Temporary password'}), pw), h('label',{class:'field'}, h('span',{text:'Role'}), role)),
    h('div',{class:'sub',text:'Give the username and temporary password to the person. They must choose their own password the first time they sign in.'}), err],
    [h('button',{class:'btn',text:'Cancel',onclick:()=>closeModal()}), h('button',{class:'btn primary',text:'Create user',onclick:async()=>{
      try { await api('POST','/api/users',{username:un.value, name:nm.value, password:pw.value, role:role.value}); closeModal(); toast('User created.'); refresh(true); } catch(e){ err.textContent = errMsg(e); } }})]);
});
function resetPassword(uid){ const pw = h('input',{type:'text',id:'rpPass',value:genPw(),autocomplete:'off'}), err = h('div',{class:'err'});
  openModal('Reset password for '+pname(uid), [h('label',{class:'field'}, h('span',{text:'New temporary password'}), pw), h('div',{class:'sub',text:'The person is signed out everywhere and must choose their own password at the next sign-in.'}), err],
    [h('button',{class:'btn',text:'Cancel',onclick:()=>closeModal()}), h('button',{class:'btn primary',text:'Reset password',onclick:async()=>{
      try { await api('PATCH','/api/users/'+uid,{password:pw.value}); closeModal(); toast('Password reset. Give the temporary password to '+pname(uid)+'.', 7000); refresh(true); } catch(e){ err.textContent = errMsg(e); } }})]); }

/* ---------- access editor (file, folder, bulk) ---------- */
function accessEditor(o){
  const uids = people(), gids = Object.keys(S.groups), next = {u:{}, g:{}, lim:{}};
  uids.forEach(u => { next.u[u] = normPerm(o.grants && o.grants[u]); if (o.limits) next.lim[u] = +(o.limits[u])||0; });
  gids.forEach(g => next.g[g] = normPerm(o.ggrants && o.ggrants[g]));
  const body = [];
  if (o.note) body.push(h('div',{class:'sub',text:o.note}));
  if (gids.length) body.push(h('h3',{text:'Groups'}), h('table',null, h('tbody',null, gids.map(g => h('tr',null, h('td',{text:String(S.groups[g].name||'Group')}), h('td',null, permBoxes(next.g[g], v => next.g[g] = v, 'ag-'+g)))))));
  if (uids.length) body.push(h('h3',{text:'People'}), h('div',{class:'scroll'}, h('table',null, h('tbody',null, uids.map(u => { const used = +(o.views && o.views[u])||0; return h('tr',null,
    h('td',null, pname(u), S.users[u].active ? null : h('span',{class:'sub',text:' (inactive)'}),
      o.once && o.once[u]===true ? h('div',{class:'checks',style:'margin-top:3px'}, h('span',{class:'pill warn',text:'One-time edit granted'}), h('button',{class:'btn sm',text:'Revoke',onclick:async e=>{ const box = e.target.parentNode; if (await act(()=>api('PATCH','/api/files/'+o.fid,{revokeOnce:u}))) box.remove(); }})) : null),
    h('td',null, permBoxes(next.u[u], v => next.u[u] = v, 'a-'+u)),
    o.limits ? h('td',null, h('div',{class:'checks',style:'align-items:center'}, h('input',{type:'number',id:'lim-'+u,min:'0',value:next.lim[u]||'',placeholder:'∞',title:'Maximum number of times this person may open the file. Empty means no limit.','aria-label':'View limit for '+pname(u),oninput:e=>next.lim[u] = Math.max(0, parseInt(e.target.value)||0)}),
      h('span',{class:'meta',text:used+' used'}),
      used ? h('button',{class:'btn sm',text:'Reset',onclick:async e=>{ const b = e.target; if (await act(()=>api('PATCH','/api/files/'+o.fid,{resetViews:u}))){ b.previousSibling.textContent = '0 used'; b.remove(); } }}) : null)) : null); })))));
  if (!uids.length && !gids.length) body.push(h('p',{text:'Add users or groups on the People tab first.',style:'margin:0'}));
  else if (o.limits) body.push(h('div',{class:'sub',text:'The number beside each person is their view limit for this file. Leave it empty for unlimited views.'}));
  openModal(o.title, body, uids.length || gids.length ? [h('button',{class:'btn',text:'Cancel',onclick:()=>closeModal()}),
    h('button',{class:'btn primary',text:o.saveLabel||'Save access',onclick:async()=>{ if (await act(()=>o.onSave(next), 'Access saved.')) closeModal(); }})] : []);
}
function openFileAccess(f){ accessEditor({title:'Access to '+f.name, fid:f.id, grants:f.grants, ggrants:f.ggrants, limits:f.limits, views:f.views, once:f.once,
  note:'Access set here adds to anything the person already gets from their groups or from the folder. Admins always have full access.',
  onSave: n => api('PATCH','/api/files/'+f.id,{grants:n.u, ggrants:n.g, limits:n.lim}) }); }
function openFolderAccess(path){ const d = S.folders[path] || {};
  accessEditor({title:'Access to folder '+path, grants:d.grants, ggrants:d.ggrants, note:'Everyone ticked here gets this access on every file in this folder and its subfolders, including files added later.',
    onSave: n => api('PUT','/api/folders',{path, grants:n.u, ggrants:n.g}) }); }
function bulkAccess(sel){ accessEditor({title:'Add access on '+sel.length+' files', saveLabel:'Add to selected files', note:'What you tick is added to each selected file. Existing access is kept.',
  onSave: async n => { await api('POST','/api/bulk',{ids:sel.map(f=>f.id), op:'access', grants:n.u, ggrants:n.g}); S.sel.clear(); } }); }

/* ---------- folders, bulk, bin ---------- */
function folderOptions(){ const s = new Set(Object.keys(S.folders)); liveFiles().forEach(f => { if (f.folder) s.add(f.folder); }); return [...s].sort(); }
function newFolder(){ const name = h('input',{type:'text',id:'nfName',placeholder:'Folder name'});
  openModal('New folder', [h('label',{class:'field'}, h('span',{text:S.folder ? 'Inside '+S.folder : 'At the top level'}), name)],
    [h('button',{class:'btn',text:'Cancel',onclick:()=>closeModal()}), h('button',{class:'btn primary',text:'Create folder',onclick:async()=>{
      const path = cleanPath((S.folder?S.folder+'/':'')+name.value.replace(/\//g,' ')); if (!path || path===S.folder) return;
      if (await act(async()=>{ await api('PUT','/api/folders',{path}); S.folder = path; })) closeModal(); }})]); }
async function deleteFolder(path){ if (await confirmDialog('Delete folder', 'Delete the empty folder "'+path+'" and its access settings?', 'Delete')) act(async()=>{ await api('DELETE','/api/folders?path='+encodeURIComponent(path)); S.folder = ''; }, 'Folder deleted.'); }
const bulk = (sel, op, msg, extra) => act(async()=>{ await api('POST','/api/bulk',Object.assign({ids:sel.map(f=>f.id), op}, extra||{})); S.sel.clear(); }, msg);
function moveFiles(sel){ const inp = h('input',{type:'text',id:'mvFolder',list:'mvOpts',placeholder:'For example Contracts/2026. Leave empty for no folder.',value:S.folder});
  openModal('Move '+sel.length+(sel.length===1?' file':' files'), [h('label',{class:'field'}, h('span',{text:'Folder (use / for subfolders)'}), inp), h('datalist',{id:'mvOpts'}, folderOptions().map(p=>h('option',{value:p}))),
    h('div',{class:'sub',text:'Moved files take on the access of the folder they land in.'})],
    [h('button',{class:'btn',text:'Cancel',onclick:()=>closeModal()}), h('button',{class:'btn primary',text:'Move',onclick:async()=>{ if (await bulk(sel,'move','Moved.',{folder:cleanPath(inp.value)})) closeModal(); }})]); }
async function binFiles(sel){ if (await confirmDialog('Delete', 'Move '+(sel.length===1?'"'+sel[0].name+'"':sel.length+' files')+' to the recycle bin? Nobody can open them from there. They are removed for good after '+S.binDays+' days.', 'Delete')) bulk(sel,'bin','Moved to the recycle bin.'); }
async function purgeFiles(sel){ if (await confirmDialog('Delete forever', 'Permanently delete '+(sel.length===1?'"'+sel[0].name+'"':sel.length+' files')+' and all earlier versions from the server? This cannot be undone.', 'Delete forever')) bulk(sel,'purge','Deleted forever.'); }

/* ---------- upload ---------- */
function pickFiles(fileList){
  const files = [...fileList]; if (!files.length || !S.admin) return;
  const folder = h('input',{type:'text',id:'upFolder',placeholder:'Optional, for example Contracts/2026',list:'folderOpts',value:S.folder||''});
  const tags = h('input',{type:'text',id:'upTags',placeholder:'Optional, separated by commas'});
  const useDef = h('input',{type:'checkbox',id:'upDef',checked:true}), status = h('div',{class:'sub'}), bar = h('progress',{max:'1',value:'0',class:'hide'});
  const go = h('button',{class:'btn primary',text:'Upload '+files.length+(files.length===1?' file':' files'),onclick:async()=>{
    go.disabled = true; bar.classList.remove('hide'); let done = 0; const failed = [];
    for (const file of files){ status.textContent = 'Uploading '+file.name+' ('+(done+failed.length+1)+' of '+files.length+', '+fmtSize(file.size)+')…'; bar.value = 0;
      try { const qs = new URLSearchParams({name:file.name, folder:cleanPath(folder.value), tags:tags.value, mime:file.type||'', defaults:useDef.checked?'1':'0'});
        const r = await xhrSend('POST', '/api/files?'+qs, file, p => bar.value = p); done++;
        status.textContent = 'Indexing '+file.name+' for search…'; await indexText(r.id, file, file.name); }
      catch(e){ failed.push(file.name+': '+errMsg(e)); } }
    await refresh(true);
    if (failed.length){ status.textContent = done+' uploaded. Not uploaded: '+failed.join(' | '); bar.classList.add('hide'); go.textContent = 'Done'; go.disabled = false; go.onclick = () => closeModal(); }
    else { closeModal(); toast(done+(done===1?' file':' files')+' uploaded.'); } }});
  openModal('Upload to the vault', [
    h('div',null, files.map(f => h('div',{class:'fname',style:'padding:3px 0'}, badge(f.name), h('span',{text:f.name+'  ·  '+fmtSize(f.size)})))),
    h('div',{class:'row2'}, h('label',{class:'field'}, h('span',{text:'Folder (use / for subfolders)'}), folder), h('label',{class:'field'}, h('span',{text:'Tags'}), tags)),
    h('datalist',{id:'folderOpts'}, folderOptions().map(f=>h('option',{value:f}))),
    h('div',{class:'checks'}, h('label',null, useDef, 'Give each user and group their default access to these files')), bar, status],
    [h('button',{class:'btn',text:'Cancel',onclick:()=>closeModal()}), go]);
}

/* ---------- details, edit, comments, requests, history ---------- */
function openDetails(f){
  const kv = h('dl',{class:'kv'}), add = (k,v) => { if (v) kv.append(h('dt',{text:k}), h('dd',null, v)); };
  add('Folder', f.folder); add('Description', f.desc); add('Tags', f.tags.length ? h('span',{class:'checks'}, f.tags.map(t=>h('span',{class:'pill tag',text:t}))) : null);
  add('Document date', f.docDate ? fmtDay(f.docDate) : ''); add('Size', fmtSize(f.size)); add('Updated', fmtDate(f.at));
  if (S.admin){ add('Updated by', f.by ? pname(f.by) : ''); add('Review date', reviewPill(f)); add('Versions', f.versions.length ? (f.versions.length+1)+' (current and '+f.versions.length+' earlier)' : ''); }
  add(S.admin ? 'Your access' : 'You may', permChips(f.p));
  if (f.lim && !S.admin) add('View limit', f.used+' of '+f.lim+' views used');
  if (f.one) add('Editing', 'One-time edit allowed. After you save one change you must ask again.');
  const missing = PERMS.filter(x => x[0]!=='v' && !f.p.includes(x[0]));
  const btns = f.deletedAt ? [h('button',{class:'btn',text:'Restore',onclick:()=>{ closeModal(); bulk([f],'restore','Restored.'); }})] : [
    f.p.includes('e') ? h('button',{class:'btn',text:'Edit',onclick:()=>openEdit(f)}) : null,
    S.admin ? h('button',{class:'btn',text:'Access',onclick:()=>openFileAccess(f)}) : null,
    h('button',{class:'btn',text:'Comments',onclick:()=>openComments(f)}),
    S.admin ? h('button',{class:'btn',text:'History',onclick:()=>openHistory(f)}) : null,
    !S.admin && (missing.length || f.over) ? h('button',{class:'btn',text:'Request access',onclick:()=>openRequest(f)}) : null,
    S.admin ? h('button',{class:'btn danger',text:'Delete',onclick:()=>{ closeModal(); binFiles([f]); }}) : null];
  openModal(f.name, [kv], btns);
}
async function replaceContent(f, blob, name, onprog){ const qs = new URLSearchParams({name:name||f.name, mime:blob.type||''});
  await xhrSend('PUT', '/api/files/'+f.id+'/content?'+qs, blob, onprog); await indexText(f.id, blob, name||f.name); }
function openEdit(f){
  const name = h('input',{type:'text',id:'edName',value:f.name}), A = S.admin;
  const folder = A ? h('input',{type:'text',id:'edFolder',value:f.folder,placeholder:'Optional',list:'edOpts'}) : null;
  const desc = A ? h('textarea',{id:'edDesc',rows:2,placeholder:'What this file is, who it is for'}) : null; if (desc) desc.value = f.desc;
  const tags = A ? h('input',{type:'text',id:'edTags',value:f.tags.join(', '),placeholder:'Separated by commas'}) : null;
  const docDate = A ? h('input',{type:'date',id:'edDoc',value:f.docDate}) : null, review = A ? h('input',{type:'date',id:'edRev',value:f.review}) : null;
  const file = h('input',{type:'file',id:'edFile'}), bar = h('progress',{max:'1',value:'0',class:'hide'});
  const status = h('div',{class:'sub',text:f.one ? 'This is a one-time edit: you can save one change. To edit this file again, send a new request.' : ''});
  const save = h('button',{class:'btn primary',text:'Save',onclick:async()=>{ save.disabled = true; status.textContent = 'Saving…';
    try { const nm = name.value.trim() || f.name, nf = file.files[0];
      if (A) await api('PATCH','/api/files/'+f.id,{name:nm, folder:cleanPath(folder.value), desc:desc.value, tags:tags.value, docDate:docDate.value||'', review:review.value||''});
      if (nf){ bar.classList.remove('hide'); await replaceContent(f, nf, nm, p => bar.value = p); }
      else if (!A && nm !== f.name) await api('PATCH','/api/files/'+f.id,{name:nm});
      closeModal(); toast('Saved.'); refresh(true); }
    catch(e){ status.textContent = errMsg(e); save.disabled = false; } }});
  const vers = A && f.versions.length ? h('div',{class:'field'}, h('span',{text:'Earlier versions'}),
    f.versions.slice().reverse().map(v => h('div',{class:'li',style:'padding:4px 0'},
      h('span',{class:'meta',style:'white-space:normal',text:fmtDate(v.at)+' · '+fmtSize(+v.size||0)+' · '+String(v.name||'')+' · '+pname(v.by)}),
      h('div',{class:'acts'}, h('button',{class:'btn sm',text:'Download',onclick:()=>download(Object.assign({}, f, {name:v.name}), v.v)}),
        h('button',{class:'btn sm',text:'Restore',onclick:async()=>{ if (await act(()=>api('PATCH','/api/files/'+f.id,{restoreVersion:v.v}), 'Version restored.')) closeModal(); }}))))) : null;
  openModal('Edit file', [h('label',{class:'field'}, h('span',{text:'Name'}), name),
    A ? h('label',{class:'field'}, h('span',{text:'Folder (use / for subfolders)'}), folder) : null, A ? h('datalist',{id:'edOpts'}, folderOptions().map(p=>h('option',{value:p}))) : null,
    A ? h('label',{class:'field'}, h('span',{text:'Description'}), desc) : null, A ? h('label',{class:'field'}, h('span',{text:'Tags'}), tags) : null,
    A ? h('div',{class:'row2'}, h('label',{class:'field'}, h('span',{text:'Document date'}), docDate), h('label',{class:'field'}, h('span',{text:'Review or renewal date'}), review)) : null,
    h('label',{class:'field'}, h('span',{text:'Replace with a new version (optional)'}), file), bar, vers, status], [h('button',{class:'btn',text:'Cancel',onclick:()=>closeModal()}), save]);
}
function threadNode(msgs){ return h('div',{class:'thread'}, msgs.length ? msgs.map(m => h('div',{class:'msg'+(m.mine?' me':'')}, h('span',{class:'meta',text:m.who+' · '+fmtDate(m.t)}), m.x)) : h('div',{class:'sub',text:'No comments yet.'})); }
function openComments(f, onlyUid){
  const body = [], threads = (S.comments[f.id] || {});
  const box = (uid, label) => { const ta = h('textarea',{id:'cm-'+(uid||'me'),rows:2,placeholder:label});
    const send = h('button',{class:'btn primary sm',text:'Send',onclick:async()=>{ const x = ta.value.trim(); if (!x) return; send.disabled = true;
      if (await act(()=>api('POST','/api/files/'+f.id+'/comments', S.admin ? {x, uid} : {x}), 'Sent.')) openComments(S.files[f.id] ? norm(f.id, S.files[f.id]) : f, onlyUid); else send.disabled = false; }});
    return h('div',{class:'field'}, ta, h('div',{class:'acts'}, send)); };
  if (S.admin){ const uids = Object.keys(threads).filter(u => threads[u].length && (!onlyUid || u===onlyUid));
    if (!uids.length) body.push(h('div',{class:'sub',text:'Nobody has commented on this file. Users with access can leave notes or questions here, and you answer each person privately.'}));
    uids.forEach(u => body.push(h('h3',{text:pname(u)}), threadNode(threads[u].map(m => ({t:m.t, x:m.x, mine:m.by!==u, who:pname(m.by)}))), box(u, 'Reply to '+pname(u)))); }
  else body.push(threadNode(f.thread.map(m => ({t:m.t, x:m.x, mine:m.mine, who:m.mine?'You':'Admin'}))), box('', 'Write a note or question for the vault admin'));
  openModal('Comments on '+f.name, body, []);
}
function openRequest(f){
  const missing = PERMS.filter(x => x[0]!=='v' && !f.p.includes(x[0]) && !f.over), want = new Set();
  const note = h('textarea',{id:'rqNote',rows:2,placeholder:'Why you need it (optional)'});
  const boxes = h('div',{class:'checks'}, f.over ? h('label',null, h('input',{type:'checkbox',id:'rq-m',onchange:e=>e.target.checked?want.add('m'):want.delete('m')}), 'More views') : null,
    missing.map(([c,label]) => h('label',null, h('input',{type:'checkbox',id:'rq-'+c,onchange:e=>e.target.checked?want.add(c):want.delete(c)}), c==='e' ? 'Edit this file once' : label)));
  openModal('Request access to '+f.name, [h('div',{class:'field'}, h('span',{text:'What do you need?'}), boxes), h('div',{class:'sub',text:'Edit access covers one saved change. When you need to edit the file again, send a new request.'}), h('label',{class:'field'}, h('span',{text:'Note for the admin'}), note)],
    [h('button',{class:'btn',text:'Cancel',onclick:()=>closeModal()}), h('button',{class:'btn primary',text:'Send request',onclick:async()=>{ if (!want.size){ toast('Tick what you need first.'); return; }
      if (await act(()=>api('POST','/api/requests',{fid:f.id, want:[...want].join(''), note:note.value}), 'Request sent to the admin.')) closeModal(); }})]);
}
function eventTable(ev, withFile){
  return h('table',null, h('thead',null, h('tr',null, h('th',{text:'When'}), h('th',{text:'Person'}), h('th',{text:'Action'}), withFile ? h('th',{text:'File or detail'}) : null)),
    h('tbody',null, ev.map(e => h('tr',null, h('td',{class:'meta',text:fmtDate(e.t)}), h('td',{text:pname(e.uid)}), h('td',null, h('span',{class:'pill',text:ALABEL[e.a]||e.a})),
      withFile ? h('td',{text:[e.n, e.u ? pname(e.u) : ''].filter(Boolean).join(' · ')}) : null)))); }
async function openHistory(f){ await loadEvents(); const ev = allEvents().filter(e => e.f===f.id);
  openModal('History of '+f.name, [ev.length ? h('div',{class:'scroll'}, eventTable(ev.slice(0,500), false)) : h('div',{class:'sub',text:'Nothing recorded for this file in the last 90 days.'})], []); }

/* ---------- Requests tab ---------- */
function renderRequests(){
  const reqs = pendingRequests();
  const wantWords = w => [w.includes('m')?'More views':'', ...PERMS.filter(x=>w.includes(x[0])).map(x=>x[0]==='e'?'Edit once':x[1])].filter(Boolean).join(', ');
  $('reqList').replaceChildren(reqs.length ? h('table',null, h('thead',null, h('tr',null, h('th',{text:'When'}), h('th',{text:'Person'}), h('th',{text:'File'}), h('th',{text:'Wants'}), h('th',{text:'Note'}), h('th',null))),
    h('tbody',null, reqs.map(r => h('tr',null, h('td',{class:'meta',text:fmtDate(r.at)}), h('td',{text:pname(r.uid)}), h('td',{text:String(S.files[r.fid].name||'')}), h('td',null, h('span',{class:'pill warn',text:wantWords(r.want)})), h('td',{text:r.note}),
      h('td',null, h('div',{class:'acts'}, h('button',{class:'btn sm primary',text:'Approve',onclick:()=>act(()=>api('POST','/api/requests/'+r.id+'/decide',{ok:true}), 'Approved.')}),
        h('button',{class:'btn sm',text:'Refuse',onclick:()=>act(()=>api('POST','/api/requests/'+r.id+'/decide',{ok:false}), 'Refused.')})))))))
    : h('div',{class:'empty'}, h('strong',{text:'No requests waiting'}), h('span',{text:'When a user asks for download, copy or one-time edit rights, or for more views, it appears here for you to approve or refuse.'})));
  const coms = [];
  for (const [fid,threads] of Object.entries(S.comments)) if (S.files[fid]) for (const [uid,arr] of Object.entries(threads)) for (const m of arr) if (m.by===uid) coms.push({uid, fid, t:m.t, x:m.x, answered:arr.some(r => r.by!==uid && r.t > m.t)});
  coms.sort((a,b)=>b.t-a.t);
  $('comList').replaceChildren(...(coms.length ? coms.slice(0,60).map(c => h('div',{class:'li'}, h('div',{style:'flex:1 1 260px;min-width:0'}, h('div',null, h('strong',{text:pname(c.uid)}), ' on ', String(S.files[c.fid].name||''), ' ', c.answered ? null : h('span',{class:'pill warn',text:'Not answered'})),
      h('div',{text:c.x,style:'overflow-wrap:anywhere'}), h('div',{class:'meta',text:fmtDate(c.t)})),
      h('button',{class:'btn sm',text:'Open thread',onclick:()=>openComments(norm(c.fid, S.files[c.fid]), c.uid)})))
    : [h('div',{class:'empty'}, h('span',{text:'No comments yet. Users can leave notes or questions on any file shared with them.'}))]));
}

/* ---------- Dashboard: charts with drill-down ---------- */
function sv(tag, attrs, ...kids){ const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const k in (attrs||{})){ const v = attrs[k]; if (v==null || v===false) continue; if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v); }
  for (const c of kids.flat()) if (c!=null && c!==false) e.appendChild(c instanceof Node ? c : document.createTextNode(String(c))); return e; }
function tipOn(e, text){ const t = $('tip'); t.textContent = text; t.classList.remove('hide');
  t.style.left = Math.max(8, Math.min(e.clientX+12, window.innerWidth-t.offsetWidth-8))+'px'; t.style.top = (e.clientY+16)+'px'; }
function tipOff(){ $('tip').classList.add('hide'); }
function hbars(items, empty){ if (!items.length) return h('div',{class:'empty'}, h('span',{text:empty})); const max = Math.max(1, ...items.map(i=>i.value));
  return h('div',{class:'hb'}, items.map(i => h('button',{class:'hrow',title:i.label+': '+i.show+'. Click for details.',onclick:i.onclick},
    h('span',{class:'hl',text:i.label}), h('span',{class:'ht'}, h('i',{style:'width:'+Math.max(1, Math.round(i.value/max*100))+'%'})), h('span',{class:'hv',text:i.show})))); }
function dayChart(days){
  const W = 720, H = 200, L = 34, B = 24, T = 8, pw = W-L-6, ph = H-B-T, max = Math.max(4, ...days.map(d=>d.count));
  const raw = max/4, p10 = Math.pow(10, Math.floor(Math.log10(raw))), n = raw/p10, step = Math.max(1, (n<=1?1:n<=2?2:n<=5?5:10)*p10), top = Math.ceil(max/step)*step, bw = pw/days.length;
  const svg = sv('svg',{viewBox:'0 0 '+W+' '+H, role:'img', 'aria-label':'Actions per day over the last 30 days', style:'width:100%;height:auto;display:block'});
  for (let v=0; v<=top; v+=step){ const y = T+ph-ph*v/top; svg.append(sv('line',{x1:L, x2:W-6, y1:y, y2:y, stroke:'var(--line)', 'stroke-width':1}), sv('text',{x:L-6, y:y+4, 'text-anchor':'end', class:'ax'}, v)); }
  days.forEach((d,i) => { const x = L+i*bw, hh = ph*d.count/top, w = bw-2, r = Math.min(4, w/2, hh), y = T+ph-hh, tip = d.label+': '+d.count+(d.count===1?' action':' actions');
    const g = sv('g',{class:'col', tabindex:0, role:'button', 'aria-label':tip, onclick:d.onclick, onkeydown:e=>{ if (e.key==='Enter' || e.key===' '){ e.preventDefault(); d.onclick(); } }, onmousemove:e=>tipOn(e, tip), onmouseleave:tipOff});
    g.append(sv('rect',{x, y:T, width:bw, height:ph, fill:'transparent'}));
    if (d.count) g.append(sv('path',{d:'M'+(x+1)+','+(y+hh)+'V'+(y+r)+'Q'+(x+1)+','+y+' '+(x+1+r)+','+y+'H'+(x+1+w-r)+'Q'+(x+1+w)+','+y+' '+(x+1+w)+','+(y+r)+'V'+(y+hh)+'Z', fill:'var(--accent)'}));
    svg.append(g); if (i%5===0) svg.append(sv('text',{x:x+bw/2, y:H-7, 'text-anchor':'middle', class:'ax'}, d.short)); });
  return svg;
}
function setDrill(title, make, auditFilter){ S.drill = {title, make, auditFilter}; renderDrill(); try { $('drill').scrollIntoView({block:'nearest', behavior:'smooth'}); } catch(e){} }
function renderDrill(){ const d = S.drill, box = $('drill'); if (!d){ box.replaceChildren(); return; }
  box.replaceChildren(h('div',{class:'panel'}, h('div',{class:'sechead'}, h('h3',{text:d.title}), h('div',{class:'acts'},
    d.auditFilter ? h('button',{class:'btn sm',text:'Open in audit log',onclick:()=>{ S.afPending = d.auditFilter; goTab('audit'); }}) : null,
    h('button',{class:'btn sm',text:'Close details',onclick:()=>{ S.drill = null; renderDrill(); }}))), h('div',{class:'scroll'}, d.make()))); }
const drillEvents = pred => () => { const ev = allEvents().filter(pred); return ev.length ? eventTable(ev.slice(0,300), true) : h('div',{class:'empty'}, h('span',{text:'Nothing recorded.'})); };
const drillFiles = pred => () => { const fs = liveFiles().filter(pred).sort((a,b)=>b.size-a.size);
  return fs.length ? h('table',null, h('thead',null, h('tr',null, h('th',{text:'File'}), h('th',{text:'Folder'}), h('th',{text:'Size'}), h('th',{text:'Updated'}), h('th',null))),
    h('tbody',null, fs.slice(0,300).map(f => h('tr',null, h('td',null, h('div',{class:'fname'}, badge(f.name), h('span',{text:f.name}))), h('td',{text:f.folder}), h('td',{class:'num',text:fmtSize(f.size)}), h('td',{class:'meta',text:fmtDate(f.at)}),
      h('td',null, h('div',{class:'acts'}, h('button',{class:'btn sm',text:'Open',onclick:()=>openPreview(f)}), h('button',{class:'btn sm',text:'Details',onclick:()=>openDetails(f)}))))))) : h('div',{class:'empty'}, h('span',{text:'No files.'})); };
function renderDash(){
  const files = liveFiles(), binN = Object.keys(S.files).length-files.length, uids = people(), ev = allEvents(), now = Date.now();
  const ev30 = ev.filter(e => now-e.t < 30*DAY);
  const isDue = f => { const d = f.review ? daysUntil(f.review) : null; return d!=null && d<=30; }, due = files.filter(isDue);
  const idle = uids.filter(u => S.users[u].active && (!S.users[u].lastSeen || now-S.users[u].lastSeen > 30*DAY)), isOrphan = f => !f.people, orphan = files.filter(isOrphan), reqN = pendingRequests().length;
  const tile = (v, k, onclick, alert) => h('button',{class:'tile'+(alert?' alert':''),onclick}, h('div',{class:'v',text:v}), h('div',{class:'k',text:k}));
  $('tiles').replaceChildren(
    tile(files.length, 'Files', ()=>{ S.view = 'all'; S.folder = ''; goTab('files'); }),
    tile(Object.values(S.users).filter(u=>u.active).length+' of '+Object.keys(S.users).length, 'Active users', ()=>goTab('people')),
    tile(S.disk ? fmtSize(S.disk.used) : '…', S.disk && S.disk.free!=null ? 'Stored · '+fmtSize(S.disk.free)+' free on the server' : 'Stored on the server', ()=>setDrill('Largest files', drillFiles(()=>true))),
    tile(reqN, 'Requests waiting', ()=>goTab('requests'), reqN>0),
    tile(due.length, 'Reviews due in 30 days', ()=>setDrill('Files with a review due', drillFiles(isDue)), due.length>0),
    tile(orphan.length, 'Files no user can open', ()=>setDrill('Files no user can open', drillFiles(isOrphan)), orphan.length>0),
    tile(idle.length, 'Users inactive for 30 days', ()=>setDrill('Users who have not signed in for 30 days', () => idle.length ? h('div',null, idle.map(u => h('div',{class:'li'}, h('span',{text:pname(u)}), h('span',{class:'meta',text:S.users[u].lastSeen ? 'Last seen '+fmtDate(S.users[u].lastSeen) : 'Never signed in'})))) : h('div',{class:'empty'}, h('span',{text:'Every user has been active.'})))),
    tile(binN, 'In recycle bin', ()=>{ S.view = 'bin'; goTab('files'); }));
  const perDay = {}; ev30.forEach(e => { const k = dstr(new Date(e.t)); perDay[k] = (perDay[k]||0)+1; });
  const days = []; for (let i=29;i>=0;i--){ const d = new Date(now-i*DAY), key = dstr(d), label = d.toLocaleDateString(undefined,{day:'2-digit',month:'short'});
    days.push({key, label, short:label, count:perDay[key]||0, onclick:()=>setDrill('Activity on '+label, drillEvents(e => dstr(new Date(e.t))===key), {from:key, to:key})}); }
  const tally = (list, keyOf) => { const m = {}; list.forEach(x => { const k = keyOf(x); if (k) m[k] = (m[k]||0)+1; }); return Object.entries(m).sort((a,b)=>b[1]-a[1]); };
  const byAction = tally(ev30, e=>e.a).slice(0,8).map(([a,n]) => ({label:ALABEL[a]||a, value:n, show:String(n), onclick:()=>setDrill((ALABEL[a]||a)+', last 30 days', drillEvents(e => e.a===a && Date.now()-e.t < 30*DAY), {action:a})}));
  const byUser = tally(ev30, e=>e.uid).slice(0,8).map(([u,n]) => ({label:pname(u), value:n, show:String(n), onclick:()=>setDrill('Activity by '+pname(u)+', last 30 days', drillEvents(e => e.uid===u && Date.now()-e.t < 30*DAY), {person:u})}));
  const byFile = tally(ev.filter(e => e.a==='view' && S.files[e.f]), e=>e.f).slice(0,8).map(([id,n]) => ({label:String(S.files[id].name||''), value:n, show:String(n), onclick:()=>setDrill('Activity on '+S.files[id].name, drillEvents(e => e.f===id))}));
  const KIND = {pdf:'PDF', docx:'Word', sheet:'Excel and CSV', pptx:'PowerPoint', img:'Images', vid:'Video', aud:'Audio', text:'Text', other:'Other types'};
  const byType = tally(files, f=>kindOf(f.name)).map(([k,n]) => ({label:KIND[k], value:n, show:n+(n===1?' file':' files'), onclick:()=>setDrill(KIND[k]+' files', drillFiles(f => kindOf(f.name)===k))}));
  const topOf = f => f.folder ? f.folder.split('/')[0] : 'No folder', sizes = {}; files.forEach(f => sizes[topOf(f)] = (sizes[topOf(f)]||0)+f.size);
  const byFolder = Object.entries(sizes).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([p,b]) => ({label:p, value:b, show:fmtSize(b), onclick:()=>setDrill('Files in '+p, drillFiles(f => topOf(f)===p))}));
  const card = (title, node, cls) => h('div',{class:'panel'+(cls?' '+cls:'')}, h('div',{class:'sechead'}, h('h3',{text:title}), h('span',{class:'sub',text:'Click a bar for details'})), node);
  $('dash').replaceChildren(
    card('Activity per day, last 30 days', h('div',{style:'padding:10px 12px 4px'}, dayChart(days)), 'full'),
    card('Actions by type, last 30 days', hbars(byAction, 'No activity in the last 30 days.')),
    card('Most active people, last 30 days', hbars(byUser, 'No activity in the last 30 days.')),
    card('Most opened files, last 90 days', hbars(byFile, 'No file has been opened yet.')),
    card('Files by type', hbars(byType, 'No files yet.')),
    card('Storage by top-level folder', hbars(byFolder, 'No files yet.')));
  renderDrill();
}

/* ---------- Audit log ---------- */
const audEvents = () => S.aud || S.events;
function filteredEvents(){ const p = $('afPerson').value, a = $('afAction').value, q = $('afFile').value.trim().toLowerCase();
  const from = $('afFrom').value ? new Date($('afFrom').value+'T00:00:00').getTime() : 0, to = $('afTo').value ? new Date($('afTo').value+'T23:59:59').getTime() : Infinity;
  return audEvents().filter(e => (!p || e.uid===p || e.u===p) && (!a || e.a===a) && e.t>=from && e.t<=to && (!q || String(e.n||'').toLowerCase().includes(q))); }
async function auditRange(){ const f = $('afFrom').value;
  if (f && new Date(f+'T00:00:00').getTime() < Date.now()-89*DAY){ try { S.aud = (await api('GET','/api/audit?from='+new Date(f+'T00:00:00').getTime())).events || []; } catch(e){} } else S.aud = null;
  renderAudit(); }
function renderAudit(){
  const all = audEvents(), ps = $('afPerson'), as = $('afAction'), pend = S.afPending; S.afPending = null;
  if (pend){ $('afFrom').value = pend.from||''; $('afTo').value = pend.to||''; $('afFile').value = pend.file||''; }
  const pv = pend ? (pend.person||'') : ps.value, av = pend ? (pend.action||'') : as.value;
  const uids = [...new Set(all.flatMap(e=>[e.uid,e.u]).filter(Boolean))];
  ps.replaceChildren(h('option',{value:'',text:'Everyone'}), ...uids.sort((a,b)=>pname(a).localeCompare(pname(b))).map(u => h('option',{value:u,text:pname(u)})));
  as.replaceChildren(h('option',{value:'',text:'All actions'}), ...[...new Set(all.map(e=>e.a))].sort().map(a => h('option',{value:a,text:ALABEL[a]||a})));
  ps.value = pv; as.value = av; const ev = filteredEvents(), box = $('actList');
  if (!ev.length){ box.replaceChildren(h('div',{class:'empty'}, h('strong',{text:all.length ? 'Nothing matches these filters' : 'Nothing recorded yet'}), h('span',{text:'Every sign-in, open, download, copy, edit, comment and request, and every change made by admins, is recorded on the server. The list shows the last 90 days unless you pick an earlier From date.'}))); return; }
  box.replaceChildren(eventTable(ev.slice(0,500), true), ev.length > 500 ? h('div',{class:'legend',text:'Showing the latest 500 of '+ev.length+' entries. Export for the full list.'}) : null);
}
['afPerson','afAction','afTo'].forEach(id => $(id).addEventListener('change', renderAudit)); $('afFrom').addEventListener('change', auditRange); $('afFile').addEventListener('input', renderAudit);
function saveBlob(blob, name){ const u = URL.createObjectURL(blob), a = h('a',{href:u,download:name}); document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(u), 60000); }
$('afExport').addEventListener('click', () => { const ev = filteredEvents(); if (!ev.length){ toast('There is nothing to export.'); return; }
  const cell = v => '"'+String(v).replace(/"/g,'""')+'"';
  const rows = [['When','Person','Username','Action','File or detail','About person']].concat(ev.map(e => [new Date(e.t).toLocaleString(), pname(e.uid), (S.users[e.uid]||{}).username||'', ALABEL[e.a]||e.a, e.n||'', e.u ? pname(e.u) : '']));
  saveBlob(new Blob(['﻿'+rows.map(r => r.map(cell).join(',')).join('\r\n')], {type:'text/csv'}), 'numero-vault-audit-'+dstr(new Date())+'.csv'); });

/* ---------- download with watermark ---------- */
async function stampBlob(blob, name){
  const ext = extOf(name), label = S.me.name+' ('+S.me.username+') · '+fmtDate(Date.now());
  try {
    if (ext==='pdf'){ const {PDFDocument, rgb, degrees, StandardFonts} = await lib('pdflib'), safe = label.replace(/[^\x20-\x7E\xA1-\xFF]/g,'?');
      const doc = await PDFDocument.load(await blob.arrayBuffer(), {ignoreEncryption:true}), font = await doc.embedFont(StandardFonts.Helvetica);
      for (const pg of doc.getPages()){ const {width, height} = pg.getSize(), size = Math.max(10, width/38);
        for (let y=height*0.12; y<height; y+=height*0.3) pg.drawText(safe, {x:width*0.1, y, size, font, color:rgb(.5,.5,.5), opacity:.3, rotate:degrees(24)});
        pg.drawText('Downloaded by '+safe, {x:12, y:8, size:7, font, color:rgb(.35,.35,.35)}); }
      return {blob:new Blob([await doc.save()], {type:'application/pdf'}), stamped:true}; }
    if (['png','jpg','jpeg','webp'].includes(ext)){ const bmp = await createImageBitmap(blob), c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      const g = c.getContext('2d'); g.drawImage(bmp, 0, 0); const fs = Math.max(12, Math.round(bmp.width/34)); g.font = '600 '+fs+'px sans-serif';
      g.translate(c.width/2, c.height/2); g.rotate(-0.38); g.textAlign = 'center'; const step = fs*7, R = Math.hypot(c.width, c.height)/2;
      for (let y=-R; y<=R; y+=step){ g.fillStyle = 'rgba(255,255,255,.35)'; g.fillText(label, 1, y+1); g.fillStyle = 'rgba(0,0,0,.28)'; g.fillText(label, 0, y); }
      const out = await new Promise(r => c.toBlob(r, MIME[ext], 0.92)); if (out) return {blob:out, stamped:true}; }
  } catch(e){}
  return {blob, stamped:false};
}
async function download(f, version){
  try { const r = await api('POST','/api/files/'+f.id+'/open', version!=null ? {mode:'download', v:version} : {mode:'download'});
    if (!S.admin && ['pdf','png','jpg','jpeg','webp'].includes(extOf(f.name)) && f.size <= 150*1048576){ toast('Preparing your copy…', 2500);
      const s = await stampBlob(await (await fetch(r.url, {credentials:'same-origin'})).blob(), f.name); if (s.stamped){ saveBlob(s.blob, f.name); return; } }
    const a = h('a',{href:r.url+'&dl=1',download:f.name}); document.body.appendChild(a); a.click(); a.remove();
  } catch(e){ toast(errMsg(e)); }
}

/* ---------- preview ---------- */
const SAFE = new Set('P H1 H2 H3 H4 H5 H6 STRONG B EM I U S UL OL LI TABLE THEAD TBODY TR TD TH BR SUP SUB BLOCKQUOTE PRE'.split(' '));
function cleanInto(src, dst){
  for (const n of src.childNodes){
    if (n.nodeType===3) dst.appendChild(document.createTextNode(n.nodeValue));
    else if (n.nodeType===1){ const t = n.tagName.toUpperCase();
      if (t==='SCRIPT' || t==='STYLE') continue;
      if (t==='IMG'){ const s = n.getAttribute('src')||''; if (/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(s)) dst.appendChild(h('img',{src:s,alt:''})); continue; }
      if (!SAFE.has(t)){ cleanInto(n, dst); continue; }
      const e = document.createElement(t.toLowerCase()); cleanInto(n, e); dst.appendChild(e); } }
}
async function renderPptx(blob, W, urls){
  const JSZip = await lib('jszip'), zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = async p => { const f = zip.file(p); return f ? new DOMParser().parseFromString(await f.async('string'), 'application/xml') : null; };
  const resolve = (base, target) => { if (target.startsWith('/')) return target.slice(1); const ps = base.split('/'); for (const s of target.split('/')){ if (s==='..') ps.pop(); else if (s!=='.') ps.push(s); } return ps.join('/'); };
  const rels = async p => { const i = p.lastIndexOf('/'), d = await xml(p.slice(0,i)+'/_rels/'+p.slice(i+1)+'.rels'), m = {};
    if (d) for (const r of d.getElementsByTagName('Relationship')) m[r.getAttribute('Id')] = {type:r.getAttribute('Type')||'', target:resolve(p.slice(0,i), r.getAttribute('Target')||'')}; return m; };
  const kid = (e, n) => e ? [...e.children].find(c => c.nodeName===n) : null, hex = e => { const v = e && e.getAttribute('val'); return v && /^[0-9A-Fa-f]{6}$/.test(v) ? '#'+v : null; };
  const xf = sp => { const x = kid(kid(sp,'p:spPr')||kid(sp,'p:grpSpPr'),'a:xfrm') || kid(sp,'p:xfrm'), o = kid(x,'a:off'), e = kid(x,'a:ext'); return o && e ? {x:+o.getAttribute('x'), y:+o.getAttribute('y'), w:+e.getAttribute('cx'), h:+e.getAttribute('cy')} : null; };
  const phOf = sp => { const ph = kid(kid(kid(sp,'p:nvSpPr'),'p:nvPr'),'p:ph'); return ph ? {type:ph.getAttribute('type')||'body', idx:ph.getAttribute('idx')||''} : null; };
  const phMap = d => { const m = {}; if (d) for (const sp of d.getElementsByTagName('p:sp')){ const ph = phOf(sp), x = xf(sp); if (ph && x){ if (ph.idx) m['i'+ph.idx] = x; if (!m['t'+ph.type]) m['t'+ph.type] = x; } } return m; };
  const bgOf = d => { const bg = d && d.getElementsByTagName('p:bg')[0]; return bg ? hex(bg.getElementsByTagName('a:srgbClr')[0]) : null; };
  const pres = await xml('ppt/presentation.xml'), sz = pres && pres.getElementsByTagName('p:sldSz')[0];
  const CX = +(sz && sz.getAttribute('cx')) || 9144000, CY = +(sz && sz.getAttribute('cy')) || 6858000, k = W/CX, cache = {};
  const names = await pptxSlideNames(zip), stages = [], texts = [];
  for (const sn of names.slice(0,200)){
    const doc = await xml(sn); if (!doc) continue; const rl = await rels(sn);
    const lay = Object.values(rl).find(r => /slideLayout$/.test(r.type)), layP = lay && lay.target;
    if (layP && !cache[layP]){ const ld = await xml(layP), lr = await rels(layP), ms = Object.values(lr).find(r => /slideMaster$/.test(r.type)), md = ms ? await xml(ms.target) : null;
      cache[layP] = {lm:phMap(ld), mm:phMap(md), bg:bgOf(ld) || bgOf(md)}; }
    const L = (layP && cache[layP]) || {lm:{}, mm:{}, bg:null}, bg = bgOf(doc) || L.bg || '#ffffff';
    const dark = (parseInt(bg.slice(1,3),16)*299 + parseInt(bg.slice(3,5),16)*587 + parseInt(bg.slice(5,7),16)*114)/1000 < 128;
    const stage = h('div',{class:'stage'}); stage.style.cssText = 'width:'+W+'px;height:'+Math.round(W*CY/CX)+'px;background:'+bg+';color:'+(dark?'#ffffff':'#1a1a1a');
    const place = (e, x) => { e.style.left = x.x*k+'px'; e.style.top = x.y*k+'px'; e.style.width = x.w*k+'px'; e.style.height = x.h*k+'px'; };
    const px = pt => (pt*12700*k)+'px';
    const walk = async tree => { for (const sp of tree.children){ const n = sp.nodeName;
      if (n==='p:grpSp') await walk(sp);
      else if (n==='p:sp'){ const ph = phOf(sp); let x = xf(sp);
        if (!x && ph) x = (ph.idx && L.lm['i'+ph.idx]) || L.lm['t'+ph.type] || L.mm['t'+ph.type] || (ph.type==='ctrTitle' && (L.lm.ttitle||L.mm.ttitle)) || (ph.type==='subTitle' && (L.lm.tbody||L.mm.tbody));
        const tx = kid(sp,'p:txBody'); if (!x || !tx && !kid(kid(sp,'p:spPr'),'a:solidFill')) continue;
        const box = h('div',{class:'shape'}); place(box, x); const fill = hex(kid(kid(kid(sp,'p:spPr'),'a:solidFill'),'a:srgbClr')); if (fill) box.style.background = fill;
        const title = !!(ph && /title/i.test(ph.type)), base = title ? 34 : (ph && ph.type==='subTitle') ? 20 : 18; box.style.fontSize = px(base);
        if (title) box.style.fontWeight = '600';
        if (tx) for (const p of tx.children){ if (p.nodeName!=='a:p') continue; const pe = h('p'), al = (kid(p,'a:pPr')||p).getAttribute('algn');
          pe.style.textAlign = al==='ctr' ? 'center' : al==='r' ? 'right' : (ph && (ph.type==='ctrTitle'||ph.type==='subTitle')) ? 'center' : 'left'; let any = false;
          for (const r of p.children){ if (r.nodeName==='a:br'){ pe.appendChild(h('br')); continue; } if (r.nodeName!=='a:r' && r.nodeName!=='a:fld') continue;
            const t = kid(r,'a:t'); if (!t) continue; const s = h('span',{text:t.textContent}), rp = kid(r,'a:rPr');
            if (rp){ const v = +rp.getAttribute('sz'); if (v) s.style.fontSize = px(v/100); if (rp.getAttribute('b')==='1') s.style.fontWeight = '700'; if (rp.getAttribute('i')==='1') s.style.fontStyle = 'italic';
              const c = hex(kid(kid(rp,'a:solidFill'),'a:srgbClr')); if (c) s.style.color = c; }
            pe.appendChild(s); any = true; }
          if (any) box.appendChild(pe); }
        stage.appendChild(box); }
      else if (n==='p:pic'){ const x = xf(sp), blip = sp.getElementsByTagName('a:blip')[0], r = blip && rl[blip.getAttribute('r:embed')], m = r && /\.(png|jpe?g|gif|bmp|webp)$/i.exec(r.target), file = m && zip.file(r.target);
        if (x && file){ const ext = m[1].toLowerCase().replace('jpg','jpeg'), u = URL.createObjectURL(new Blob([await file.async('uint8array')], {type:'image/'+ext})); urls.push(u);
          const img = h('img',{src:u,alt:'',draggable:'false'}); place(img, x); stage.appendChild(img); } }
      else if (n==='p:graphicFrame'){ const x = xf(sp), tbl = sp.getElementsByTagName('a:tbl')[0];
        if (x && tbl){ const t = h('table',null, h('tbody',null, [...tbl.getElementsByTagName('a:tr')].map(tr => h('tr',null, [...tr.getElementsByTagName('a:tc')].map(tc => h('td',{text:[...tc.getElementsByTagName('a:t')].map(e=>e.textContent).join(' ')}))))));
          place(t, x); t.style.height = 'auto'; t.style.fontSize = px(12); stage.appendChild(t); } } } };
    const tree = doc.getElementsByTagName('p:spTree')[0]; if (tree) await walk(tree);
    stages.push(stage); texts.push([...doc.getElementsByTagName('a:t')].map(e=>e.textContent).join(' '));
  }
  return {stages, text:texts.map((t,i)=>'Slide '+(i+1)+'\n'+t).join('\n\n'), count:names.length};
}
async function openPreview(f, opts){
  opts = opts || {};
  if (f.over){ toast('You have used all your views of this file. Open Details to request more.'); return; }
  if (!f.p.includes('v')) return;
  let ticket; try { ticket = await api('POST','/api/files/'+f.id+'/open',{mode:'view', quiet:!!opts.quiet}); } catch(e){ toast(errMsg(e)); refresh(true); return; }
  const src = ticket.url, canCopy = f.p.includes('c'), kind = kindOf(f.name), urls = [], BIG = 200*1048576;
  let text = null, editor = null;
  const pv = h('div',{class:'pv'+(canCopy?'':' locked')}, h('div',{class:'sub',text:'Loading '+f.name+'…'}));
  if (!canCopy) for (const ev of ['copy','cut','contextmenu','dragstart','selectstart']) pv.addEventListener(ev, e => e.preventDefault());
  const wrap = h('div',{class:'pvwrap'}, pv);
  S.viewing = opts.follow ? null : f.id; S.pvEl = pv;
  if (!S.admin){ const stamp = S.me.name+' · '+fmtDate(Date.now()); wrap.appendChild(h('div',{class:'wm','aria-hidden':'true'}, Array.from({length:70}, ()=>h('span',{text:stamp})))); }
  const copyBtn = h('button',{class:'btn sm hide',text:'Copy text',onclick:async()=>{ try { await navigator.clipboard.writeText(editor ? editor.value : text); toast('Text copied.'); } catch(e){ toast('Select the text and press Ctrl+C or Cmd+C.'); }
    api('POST','/api/log',{a:'copy', fid:f.id}).catch(()=>{}); }});
  const saveBtn = h('button',{class:'btn sm primary hide',text:'Save changes',onclick:async()=>{ saveBtn.disabled = true;
    try { await replaceContent(f, new Blob([editor.value],{type:'text/plain'}), f.name); closeModal(); toast('Saved a new version.'); refresh(true); } catch(e){ toast(errMsg(e)); saveBtn.disabled = false; } }});
  const head = [permChips(f.p), copyBtn, saveBtn, f.p.includes('d') ? h('button',{class:'btn sm',text:'Download',onclick:()=>download(f)}) : null].filter(Boolean);
  let open = true;
  openModal(opts.title || f.name, [opts.banner || null, wrap], [], {wide:true, flush:true, head, onclose:()=>{ open = false; S.viewing = null; S.pvEl = null; urls.forEach(u=>URL.revokeObjectURL(u)); if (opts.onclose) opts.onclose(); else refresh(true); }});
  const show = (...nodes) => { if (open) pv.replaceChildren(...nodes); };
  const offerText = t => { text = t; if (canCopy && t) copyBtn.classList.remove('hide'); };
  const bytes = async () => { if (f.size > BIG) throw {message:'This file is '+fmtSize(f.size)+', too large to preview in the browser.'+(f.p.includes('d') ? ' Download it instead.' : '')};
    const r = await fetch(src, {credentials:'same-origin'}); if (!r.ok) throw {message:'The file could not be loaded from the server.'}; return r.blob(); };
  try {
    const width = Math.min(900, Math.max(260, pv.clientWidth-28));
    if (kind==='img') show(h('img',{src,alt:f.name,draggable:'false'}));
    else if (kind==='vid'){ const v = h('video',{src,controls:'',playsinline:''}); v.setAttribute('controlslist','nodownload noremoteplayback'); v.disablePictureInPicture = true; show(v); }
    else if (kind==='aud'){ const a = h('audio',{src,controls:''}); a.setAttribute('controlslist','nodownload'); show(a); }
    else if (kind==='pdf'){
      const pdfjsLib = await lib('pdf'); await lib('pdfworker');
      const doc = await pdfjsLib.getDocument({url:src, withCredentials:true}).promise; if (!open) return;
      show(h('div',{class:'sub',text:doc.numPages+(doc.numPages===1?' page':' pages')}));
      const parts = [], max = Math.min(doc.numPages, 150);
      for (let i=1;i<=max && open;i++){ const page = await doc.getPage(i), base = page.getViewport({scale:1}), dpr = Math.min(2, window.devicePixelRatio||1);
        const vp = page.getViewport({scale:width/base.width*dpr}), c = h('canvas'); c.width = vp.width; c.height = vp.height; c.style.width = width+'px';
        pv.appendChild(c); await page.render({canvasContext:c.getContext('2d'), viewport:vp}).promise;
        if (canCopy){ const tc = await page.getTextContent(); parts.push(tc.items.map(x=>x.str).join(' ')); } }
      if (doc.numPages > max) pv.appendChild(h('div',{class:'sub',text:'Showing the first '+max+' pages.'}));
      offerText(parts.join('\n\n'));
    }
    else if (kind==='docx'){
      const mammoth = await lib('mammoth'), r = await mammoth.convertToHtml({arrayBuffer:await (await bytes()).arrayBuffer()});
      const parsed = new DOMParser().parseFromString(r.value, 'text/html'), d = h('div',{class:'doc'}); cleanInto(parsed.body, d);
      show(d); offerText(d.innerText);
    }
    else if (kind==='sheet'){
      const XLSX = await lib('xlsx'), wb = XLSX.read(await (await bytes()).arrayBuffer(), {type:'array'}), tabs = h('div',{class:'sheettabs'}), holder = h('div',{class:'sheet'}), note = h('div',{class:'sub'});
      const draw = name => { const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], {header:1, raw:false, defval:''}), cut = rows.slice(0,1000);
        holder.replaceChildren(h('table',null, h('tbody',null, cut.map(r => h('tr',null, r.slice(0,80).map(c => h('td',{text:String(c)})))))));
        note.textContent = rows.length > 1000 ? 'Showing the first 1000 of '+rows.length+' rows.' : rows.length+' rows';
        [...tabs.children].forEach(b => b.classList.toggle('primary', b.textContent===name));
        offerText(rows.map(r => r.join('\t')).join('\n')); };
      wb.SheetNames.forEach(n => tabs.appendChild(h('button',{class:'btn sm',text:n,onclick:()=>draw(n)})));
      show(tabs, holder, note); if (wb.SheetNames.length) draw(wb.SheetNames[0]);
    }
    else if (kind==='pptx'){
      const r = await renderPptx(await bytes(), width, urls);
      show(h('div',{class:'sub',text:r.count+' slides. Text, pictures and tables are drawn in place; theme fonts, colours and effects may differ from PowerPoint.'}), ...r.stages); offerText(r.text);
    }
    else if (kind==='text'){
      const t = await (await bytes()).text();
      if (f.p.includes('e') && !opts.follow && t.length < 1000000){ editor = h('textarea',{id:'pvEditor','aria-label':'File content',spellcheck:'false'}); editor.value = t; show(editor); if (open) S.pvEl = editor; saveBtn.classList.remove('hide'); offerText(t); }
      else { show(h('pre',{text:t.length > 1000000 ? t.slice(0,1000000)+'\n… (cut)' : t})); offerText(t); }
    }
    else show(h('div',{class:'empty'}, h('strong',{text:'No preview for this file type'}), h('span',{text:f.p.includes('d') ? 'Download it to open it on your computer.' : 'You may view this file but not download it, and .'+extOf(f.name)+' files cannot be shown in the browser. Open Details to request download access.'})));
  } catch(e){ show(h('div',{class:'empty'}, h('strong',{text:'This file could not be opened'}), h('span',{text:errMsg(e)}))); }
}

/* ---------- wiring ---------- */
const TABS = ['files','live','people','requests','dashboard','audit'];
function setTab(t){ if (!TABS.includes(t) || (!S.admin && t!=='files')) t = 'files'; S.tab = t;
  for (const b of $('tabs').children) b.setAttribute('aria-selected', String(b.dataset.tab===t));
  for (const p of TABS) $('pane-'+p).classList.toggle('hide', p!==t);
  $('fileNav').classList.toggle('hide', t!=='files'); $('pageTitle').textContent = {files:'Files',live:'Live monitoring',people:'People',requests:'Requests',dashboard:'Dashboard',audit:'Audit log'}[t];
  render(); if (t==='live') pollLive(); if (t==='dashboard' || t==='audit') loadEvents().then(() => { if (S.tab===t) render(); }); }
function goTab(t){ setTab(t); try { history.replaceState(null, '', '#'+t); } catch(e){} }
$('tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) goTab(b.dataset.tab); });
window.addEventListener('hashchange', () => setTab(location.hash.slice(1) || 'files'));
$('q').addEventListener('input', e => { S.q = e.target.value; renderFiles(); runSearch(); });
$('deep').addEventListener('change', e => { S.deep = e.target.checked; S.hits = null; runSearch(); renderFiles(); });
$('sortSel').addEventListener('change', e => { S.sort = e.target.value; renderFiles(); });
$('uploadBtn').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', e => { pickFiles(e.target.files); e.target.value = ''; });
const pf = $('filePanel');
pf.addEventListener('dragover', e => { if (S.admin){ e.preventDefault(); pf.classList.add('drop'); } });
pf.addEventListener('dragleave', () => pf.classList.remove('drop'));
pf.addEventListener('drop', e => { if (!S.admin) return; e.preventDefault(); pf.classList.remove('drop'); if (e.dataTransfer && e.dataTransfer.files) pickFiles(e.dataTransfer.files); });

/* ---------- live monitoring ---------- */
for (const ev of ['mousemove','keydown','mousedown','wheel','touchstart','scroll']) window.addEventListener(ev, () => { S.lastInput = Date.now(); }, {passive:true, capture:true});
function ping(){ if (!S.loaded || !S.me || forcedOpen || $('app').classList.contains('hide')) return;
  const el = S.pvEl, max = el ? el.scrollHeight-el.clientHeight : 0, t = $('mhead').querySelector('h2');
  fetch('/api/ping', {method:'POST', credentials:'same-origin', keepalive:true, headers:{'X-Vault':'1','Content-Type':'application/json'}, body:JSON.stringify({tab:S.tab, fid:S.viewing||'', scroll:el && max>0 ? el.scrollTop/max : 0,
    idle:(Date.now()-S.lastInput)/1000, hidden:document.visibilityState!=='visible', folder:S.folder, q:S.q, dialog:!S.viewing && $('overlay').classList.contains('open') && t ? t.textContent : ''})}).catch(()=>{}); }
setInterval(ping, 4000); document.addEventListener('visibilitychange', ping);
const dur = s => s < 60 ? Math.round(s)+' s' : s < 3600 ? Math.round(s/60)+' min' : Math.floor(s/3600)+' h '+Math.round(s%3600/60)+' min';
function device(ua){ const b = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const o = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : ''; return b+(o ? ' on '+o : ''); }
function doing(s){ if (s.fid) return 'Viewing '+(s.name || 'a file')+' · '+Math.round(s.scroll*100)+'% down';
  const page = {files:'On the Files list', live:'On Live monitoring', people:'On People', requests:'On Requests', dashboard:'On the Dashboard', audit:'On the Audit log'}[s.tab] || 'In the vault';
  return page+(s.tab==='files' && s.folder ? ' · folder '+s.folder : '')+(s.tab==='files' && s.q ? ' · searching "'+s.q+'"' : '')+(s.dialog ? ' · dialog: '+s.dialog : ''); }
function statusOf(s){ return s.hidden ? ['away','Vault tab in background'] : s.idle > 120 ? ['idle','Idle for '+dur(s.idle)] : ['','Active']; }
let liveBusy = false;
async function pollLive(){ if (!S.admin || liveBusy) return; liveBusy = true;
  try { const r = await api('GET','/api/live'); S.live = r.sessions || []; S.liveRecent = r.recent || []; S.liveNow = r.now;
    const n = new Set(S.live.filter(s=>s.uid!==S.me.id).map(s=>s.uid)).size, b = $('liveN'); b.textContent = n; b.classList.toggle('hide', !n);
    if (S.tab==='live' && !$('overlay').classList.contains('open')) renderLive(); followTick(); } catch(e){}
  liveBusy = false; }
setInterval(() => { if (S.admin && document.visibilityState==='visible' && (S.tab==='live' || watch)) pollLive(); }, 3000);
setInterval(() => { if (S.admin && document.visibilityState==='visible' && S.tab!=='live' && !watch) pollLive(); }, 20000);
function renderLive(){
  const list = S.live.slice().sort((a,b)=>pname(a.uid).localeCompare(pname(b.uid))), others = new Set(list.filter(s=>s.uid!==S.me.id).map(s=>s.uid)).size;
  $('liveSum').textContent = others+' of '+Object.values(S.users).filter(u=>u.active).length+' users online (not counting you)';
  $('liveList').replaceChildren(list.length ? h('table',null, h('thead',null, h('tr',null, h('th',{text:'Person'}), h('th',{text:'Status'}), h('th',{text:'Doing now'}), h('th',{text:'Online for'}), h('th',{text:'Address'}), h('th',{text:'Device'}), h('th',null))),
    h('tbody',null, list.map(s => { const [cls, label] = statusOf(s), self = s.uid===S.me.id;
      return h('tr',null, h('td',null, h('div',{text:pname(s.uid)+(self?' (you)':''),style:'font-weight:500'}), h('div',{class:'sub',text:(S.users[s.uid]||{}).username||''})),
        h('td',null, h('span',{class:'dot '+cls}), label), h('td',{text:doing(s)}), h('td',{class:'meta',text:dur((S.liveNow-s.since)/1000)}), h('td',{class:'meta',text:s.ip}), h('td',{class:'meta',text:device(s.ua)}),
        h('td',null, h('div',{class:'acts'}, self ? null : h('button',{class:'btn sm primary',text:'Watch',onclick:()=>startWatch(s)}),
          self ? null : h('button',{class:'btn sm danger',text:'Sign out',onclick:async()=>{ if (await confirmDialog('Sign out user', 'Sign '+pname(s.uid)+' out of the vault on every device now? They can sign in again unless you deactivate them on the People tab.', 'Sign out')) act(()=>api('POST','/api/users/'+s.uid+'/kick'), 'Signed out.'); }})))); })))
    : h('div',{class:'empty'}, h('strong',{text:'Nobody is online'}), h('span',{text:'People appear here within a few seconds of opening the vault.'})));
  $('liveFeed').replaceChildren(S.liveRecent.length ? eventTable(S.liveRecent, true) : h('div',{class:'empty'}, h('span',{text:'Nothing recorded yet.'})));
}
let watch = null, watchSwitch = false;
function startWatch(s){ api('POST','/api/live/watch',{uid:s.uid}).catch(()=>{}); watch = {key:s.key, uid:s.uid, state:null}; followTick(); }
function stopWatch(){ watch = null; }
function followTick(){
  if (!watch) return; const s = S.live.find(x => x.key===watch.key), name = pname(watch.uid);
  const state = !s ? 'offline' : s.fid && S.files[s.fid] ? 'file:'+s.fid : 'page:'+doing(s)+'|'+statusOf(s)[1];
  if (state !== watch.state){ watch.state = state; watchSwitch = true;
    const done = () => { if (!watchSwitch) stopWatch(); };
    if (state.startsWith('file:')){ const bar = h('div',{class:'watchbar'}, h('span',{text:'Watching '+name+' live. This view follows the file they have open and how far they have scrolled.'}), h('span',{id:'watchPos'}));
      openPreview(norm(s.fid, S.files[s.fid]), {quiet:true, follow:true, title:'Watching '+name+': '+S.files[s.fid].name, banner:bar, onclose:done}).then(()=>{ watchSwitch = false; }); return; }
    openModal('Watching '+name, [h('p',{style:'margin:0',text:!s ? name+' is no longer online.' : name+' has no file open right now.'}), s ? h('dl',{class:'kv'}, h('dt',{text:'Doing now'}), h('dd',{text:doing(s)}), h('dt',{text:'Status'}), h('dd',{text:statusOf(s)[1]})) : null,
      h('div',{class:'sub',text:s ? 'This window switches to the file as soon as they open one.' : ''})], [h('button',{class:'btn primary',text:'Stop watching',onclick:()=>closeModal()})], {onclose:done});
    watchSwitch = false; if (!s) watch.key = ''; return; }
  if (s && s.fid && S.pvEl){ const el = S.pvEl, max = el.scrollHeight-el.clientHeight; if (max > 0) el.scrollTo({top:s.scroll*max, behavior:'smooth'});
    const p = $('watchPos'); if (p) p.textContent = statusOf(s)[1]+' · '+Math.round(s.scroll*100)+'% down'; }
}

applyTheme();
refresh(true);
setInterval(() => { if (document.visibilityState==='visible' && !$('app').classList.contains('hide') && !forcedOpen){ refresh(false); if (S.admin && (S.tab==='dashboard' || S.tab==='audit') && !$('overlay').classList.contains('open')) loadEvents().then(() => { if (S.tab==='dashboard') renderDash(); }); } }, 20000);
