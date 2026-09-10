/* TRACE — all analysis and persistence remain in this browser. */
const STORE_KEY = 'trace-v1';
const DEFAULT = { workers: [], shifts: [], calibration: { samples: [], model: null }, selectedWorker: null, activeShift: null };
let state = loadState(), stream = null, sourceImage = null, sampleMode = 'test', points = { test: null, reference: null }, current = null;
const $ = id => document.getElementById(id);

function loadState() { try { return { ...DEFAULT, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') }; } catch { return structuredClone(DEFAULT); } }
function persist() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
function toast(message) { const t = $('toast'); t.textContent = message; t.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => t.classList.remove('show'), 2800); }
function now() { return new Date().toISOString(); }
function niceDate(value) { return new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }
function fixed(n, d = 2) { return Number.isFinite(n) ? n.toFixed(d) : '—'; }

function rgbToLab(rgb) {
  const linear = rgb.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); });
  const [r,g,b] = linear;
  const x = (r*.4124564 + g*.3575761 + b*.1804375) / .95047;
  const y = (r*.2126729 + g*.7151522 + b*.0721750);
  const z = (r*.0193339 + g*.1191920 + b*.9503041) / 1.08883;
  const f = t => t > .0088564517 ? Math.cbrt(t) : 7.787037*t + 16/116;
  const [fx,fy,fz] = [f(x),f(y),f(z)];
  return [116*fy-16, 500*(fx-fy), 200*(fy-fz)];
}
function colourFeatures(test, ref, durationMin) {
  const labTest = rgbToLab(test), labRef = rgbToLab(ref);
  const delta = labTest.map((v,i) => v - labRef[i]);
  const deltaE = Math.hypot(...delta);
  return { test, ref, labTest, labRef, delta, deltaE, durationMin: Number(durationMin), features: [...delta, deltaE, Number(durationMin)] };
}
function median(values) { const s = values.sort((a,b)=>a-b); return s[Math.floor(s.length/2)]; }
function patchColor(x, y) {
  const c = $('captureCanvas'), ctx = c.getContext('2d', { willReadFrequently: true });
  const radius = Math.max(6, Math.round(Math.min(c.width,c.height) * .021));
  const left = Math.max(0, Math.round(x-radius)), top = Math.max(0, Math.round(y-radius));
  const width = Math.min(c.width-left, radius*2), height = Math.min(c.height-top, radius*2);
  const data = ctx.getImageData(left,top,width,height).data, channels = [[],[],[]];
  for(let i=0;i<data.length;i+=4) if(data[i+3] > 240 && Math.max(data[i],data[i+1],data[i+2])-Math.min(data[i],data[i+1],data[i+2]) < 175) { channels[0].push(data[i]);channels[1].push(data[i+1]);channels[2].push(data[i+2]); }
  return channels.map(ch => median(ch.length ? ch : [0]));
}
function drawCapture() {
  const canvas = $('captureCanvas'); if (!sourceImage) return;
  const ctx = canvas.getContext('2d'); canvas.width = sourceImage.videoWidth || sourceImage.naturalWidth || sourceImage.width; canvas.height = sourceImage.videoHeight || sourceImage.naturalHeight || sourceImage.height;
  ctx.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);
  Object.entries(points).forEach(([key,point]) => { if (!point) return; const r=Math.max(12,Math.min(canvas.width,canvas.height)*.04); ctx.beginPath();ctx.arc(point.x,point.y,r,0,Math.PI*2);ctx.lineWidth=3;ctx.strokeStyle=key==='test'?'#9F7AEA':'#4FD1FF';ctx.stroke();ctx.fillStyle=key==='test'?'#9F7AEA':'#4FD1FF';ctx.font=`bold ${Math.max(13,r*.52)}px "Plus Jakarta Sans",sans-serif`;ctx.fillText(key==='test'?'TEST':'REF',point.x+r+5,point.y+4); });
}
function updateQuality() {
  const q = $('captureQuality');
  q.classList.remove('ready');
  if (!sourceImage) { q.textContent='Awaiting image'; return; }
  if (!points.test || !points.reference) { q.textContent='Mark both strips'; return; }
  q.textContent='Pair selected';
  q.classList.add('ready');
}
function readPair(duration = $('exposureMinutes').value) {
  if (!points.test || !points.reference) { toast('Select both strip centres first.'); return null; }
  current = colourFeatures(patchColor(points.test.x,points.test.y),patchColor(points.reference.x,points.reference.y), duration);
  $('deltaE').textContent = fixed(current.deltaE); $('dL').textContent=fixed(current.delta[0]); $('da').textContent=fixed(current.delta[1]); $('db').textContent=fixed(current.delta[2]);
  $('addCalibration').disabled = false;
  return current;
}

function trainSvr(samples) {
  const X = samples.map(s=>s.features), y = samples.map(s=>s.ppm), p=X[0].length, n=X.length;
  const means=Array(p).fill(0), scales=Array(p).fill(0);
  X.forEach(row=>row.forEach((v,j)=>means[j]+=v/n)); X.forEach(row=>row.forEach((v,j)=>scales[j]+=(v-means[j])**2));
  for(let j=0;j<p;j++) scales[j]=Math.sqrt(scales[j]/n)||1;
  const Z=X.map(row=>row.map((v,j)=>(v-means[j])/scales[j]));
  const gamma=1/p, C=20, epsilon=Math.max(.02, (Math.max(...y)-Math.min(...y))*.025);
  const kernel=(a,b)=>Math.exp(-gamma*a.reduce((sum,v,j)=>sum+(v-b[j])**2,0));
  const K=Z.map(a=>Z.map(b=>kernel(a,b))), beta=Array(n).fill(0), f=Array(n).fill(0);
  for(let epoch=0;epoch<1000;epoch++) { let change=0; for(let i=0;i<n;i++) { const k=K[i][i]||1; const z=beta[i]-(f[i]-y[i])/k; let next=Math.sign(z)*Math.max(0,Math.abs(z)-epsilon/k); next=Math.max(-C,Math.min(C,next)); const d=next-beta[i]; if(Math.abs(d)>1e-8) { beta[i]=next; change=Math.max(change,Math.abs(d)); for(let j=0;j<n;j++) f[j]+=d*K[j][i]; } } if(change<1e-5) break; }
  const supports=beta.map((b,i)=>({ b, i })).filter(x=>Math.abs(x.b)>1e-5);
  const residuals=supports.filter(x=>Math.abs(x.b)<C-.001).map(x=>y[x.i]-f[x.i]-Math.sign(x.b)*epsilon);
  const bias=residuals.length ? residuals.reduce((a,b)=>a+b,0)/residuals.length : (y.reduce((a,b)=>a+b,0)/n - f.reduce((a,b)=>a+b,0)/n);
  const predict = row => { const z=row.map((v,j)=>(v-means[j])/scales[j]); return bias + beta.reduce((sum,b,i)=>sum+b*kernel(z,Z[i]),0); };
  const mae=y.reduce((s,v,i)=>s+Math.abs(v-predict(X[i])),0)/n;
  return { version:1, means,scales,gamma,C,epsilon,bias, vectors:Z, beta, mae, sampleCount:n, supportCount:supports.length };
}
function predictSvr(model, features) { const z=features.map((v,j)=>(v-model.means[j])/model.scales[j]); return Math.max(0, model.bias + model.beta.reduce((sum,b,i)=>sum+b*Math.exp(-model.gamma*z.reduce((d,v,j)=>d+(v-model.vectors[i][j])**2,0)),0)); }
function trainAndPersist() { state.calibration.model=trainSvr(state.calibration.samples); persist(); renderAll(); }
function analyse() {
  const feature=readPair(); if(!feature) return;
  const model=state.calibration.model;
  if(!model) { $('ppmEstimate').textContent='Calibration required'; $('estimateDetail').textContent=`${state.calibration.samples.length} / 5 verified samples saved`; $('doseEstimate').textContent='— ppm·h'; $('saveExposureBtn').disabled=true; toast('Colour captured. Add a certified calibration label, or train the model.'); return; }
  const ppm=predictSvr(model,feature.features), dose=ppm*feature.durationMin/60; current={...feature,ppm,dose};
  $('ppmEstimate').textContent=`${fixed(ppm,3)} ppm`; $('estimateDetail').textContent=`RBF ε-SVR · ${model.sampleCount} local samples · training MAE ${fixed(model.mae,3)} ppm`; $('doseEstimate').textContent=`${fixed(dose,4)} ppm·h`; $('saveExposureBtn').disabled=!state.activeShift;
  toast('Local SVR estimate updated.');
}

function snapshotSource(el) {
  const snap = document.createElement('canvas');
  snap.width = el.videoWidth || el.naturalWidth || el.width;
  snap.height = el.videoHeight || el.naturalHeight || el.height;
  if (!snap.width || !snap.height) return null;
  snap.getContext('2d').drawImage(el, 0, 0, snap.width, snap.height);
  return snap;
}
function pauseLiveVideo() {
  const video = $('video');
  video.pause();
}
async function startCamera() {
  try {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'environment', width:{ideal:1280}, height:{ideal:720} }, audio:false });
    const video = $('video');
    video.srcObject = stream;
    await video.play();
    sourceImage = null;
    points = { test:null, reference:null };
    current = null;
    $('cameraStage').className = 'camera-stage live';
    $('cameraEmpty').hidden = true;
    $('takePhoto').disabled = false;
    $('analyzeBtn').disabled = true;
    updateQuality();
    toast('Camera ready — freeze a frame when strips are stable.');
  } catch(e) {
    toast('Camera access failed. Use Load photo or allow camera access on localhost.');
  }
}
function freezeFrame() {
  const video = $('video');
  if (!video.videoWidth) return;
  const snap = snapshotSource(video);
  if (!snap) return;
  sourceImage = snap;
  pauseLiveVideo();
  points = { test:null, reference:null };
  drawCapture();
  $('cameraStage').className = 'camera-stage captured';
  $('cameraEmpty').hidden = true;
  updateQuality();
  $('analyzeBtn').disabled = true;
  toast('Frame frozen. Mark test and reference strips.');
}
function canvasClick(event) {
  if (!sourceImage) return;
  const canvas = $('captureCanvas'), rect = canvas.getBoundingClientRect();
  const x = (event.clientX-rect.left)*canvas.width/rect.width, y = (event.clientY-rect.top)*canvas.height/rect.height;
  points[sampleMode] = {x,y};
  drawCapture();
  updateQuality();
  if (points.test && points.reference) { $('analyzeBtn').disabled = false; readPair(); }
}
function loadImage(file) {
  if (!file) return;
  pauseLiveVideo();
  const img = new Image();
  img.onload = () => {
    const snap = snapshotSource(img) || img;
    sourceImage = snap;
    points = { test:null, reference:null };
    drawCapture();
    $('cameraStage').className = 'camera-stage captured';
    $('cameraEmpty').hidden = true;
    $('analyzeBtn').disabled = true;
    updateQuality();
  };
  img.src = URL.createObjectURL(file);
}

function renderWorkers() {
  const list=$('workerList'); list.innerHTML=''; if(!state.workers.length) list.innerHTML='<p class="subtle">No worker records yet.</p>';
  state.workers.forEach(w=>{const doses=state.shifts.filter(s=>s.workerId===w.id).reduce((sum,s)=>sum+s.dose,0);const row=document.createElement('div');row.className=`worker ${state.selectedWorker===w.id?'selected':''}`;row.innerHTML=`<span class="avatar">${w.name.split(/\s+/).map(v=>v[0]).slice(0,2).join('').toUpperCase()}</span><div class="worker-details"><b>${escapeHtml(w.name)}</b><span>${escapeHtml(w.role||'No role recorded')} · historical ${fixed(doses,3)} ppm·h</span></div><button class="worker-delete" type="button" aria-label="Delete ${escapeHtml(w.name)}" title="Delete worker">Delete</button>`;row.onclick=()=>{state.selectedWorker=w.id;persist();renderAll();};row.querySelector('.worker-delete').onclick=e=>{e.stopPropagation();deleteWorker(w);};list.append(row);});
  const worker=state.workers.find(w=>w.id===state.selectedWorker); const active=state.shifts.find(s=>s.id===state.activeShift && !s.endedAt);
  $('shiftWorkerName').textContent=worker?worker.name:'No worker selected';$('shiftDescription').textContent=active?`Started ${niceDate(active.startedAt)}`:(worker?'Start a shift before saving exposure readings.':'Choose a worker to begin a locally recorded shift.'); $('startShift').disabled=!worker||!!active; $('startShift').textContent=active?'Shift active':'Start shift';
  $('shiftDose').innerHTML=`${fixed(active?.dose||0,3)} <small>ppm·h</small>`;$('shiftEvents').textContent=`${active?.events.length||0} readings`;$('saveExposureBtn').disabled=current?.ppm == null || !active;
}
function renderCalibration() {
  const {samples,model}=state.calibration; $('calibrationStatus').textContent=model?`${samples.length} verified samples — local model trained`:`${samples.length} verified samples — minimum ${Math.max(0,5-samples.length)} more needed`; $('sampleCount').textContent=samples.length; $('supportCount').textContent=model?model.supportCount:'—';$('trainingMae').textContent=model?`${fixed(model.mae,3)} ppm`:'—'; $('modelStatus').textContent=model?'LOCAL SVR READY':'CALIBRATION NEEDED';$('modelStatus').className=model?'model-chip ready':'model-chip warn';drawChart();
}
function drawChart() {
  const c=$('calibrationChart'), ctx=c.getContext('2d'), {samples,model}=state.calibration,w=c.width,h=c.height;
  ctx.clearRect(0,0,w,h);
  ctx.fillStyle='rgba(255,255,255,0.03)';
  ctx.fillRect(0,0,w,h);
  ctx.strokeStyle='rgba(255,255,255,0.06)';
  ctx.setLineDash([6,8]);
  ctx.lineWidth=1;
  for(let i=0;i<5;i++){let y=22+i*(h-44)/4;ctx.beginPath();ctx.moveTo(42,y);ctx.lineTo(w-14,y);ctx.stroke();}
  ctx.setLineDash([]);
  ctx.fillStyle='#A0AEC0';
  ctx.font='11px "Plus Jakarta Sans", system-ui';
  if(!samples.length){ctx.textAlign='center';ctx.fillText('Calibration plot appears after verified samples are added.',w/2,h/2);return;}
  let max=Math.max(...samples.map(s=>s.ppm),...samples.map(s=>model?predictSvr(model,s.features):s.ppm),1)*1.1;
  const px=x=>42+x/max*(w-58),py=y=>h-25-y/max*(h-47);
  ctx.strokeStyle='#0075FF';
  ctx.setLineDash([4,4]);
  ctx.beginPath();ctx.moveTo(px(0),py(0));ctx.lineTo(px(max),py(max));ctx.stroke();
  ctx.setLineDash([]);
  samples.forEach(s=>{
    let prediction=model?predictSvr(model,s.features):s.ppm;
    const gx=px(s.ppm), gy=py(prediction);
    const glow=ctx.createRadialGradient(gx,gy,0,gx,gy,10);
    glow.addColorStop(0,'rgba(79,209,255,0.7)');
    glow.addColorStop(1,'rgba(79,209,255,0)');
    ctx.fillStyle=glow;
    ctx.beginPath();ctx.arc(gx,gy,10,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#4FD1FF';
    ctx.beginPath();ctx.arc(gx,gy,4,0,Math.PI*2);ctx.fill();
  });
  ctx.fillStyle='#A0AEC0';ctx.textAlign='left';ctx.fillText('Observed ppm →',42,h-7);
  ctx.save();ctx.translate(13,h/2+10);ctx.rotate(-Math.PI/2);ctx.fillText('SVR fit ppm →',0,0);ctx.restore();
}
function renderRecords(){const tbody=$('recordTable');tbody.innerHTML='';const shifts=[...state.shifts].sort((a,b)=>b.startedAt.localeCompare(a.startedAt));if(!shifts.length)tbody.innerHTML='<tr><td colspan="5" class="subtle">No shift records stored on this device.</td></tr>';shifts.forEach(s=>{const worker=state.workers.find(w=>w.id===s.workerId);tbody.insertAdjacentHTML('beforeend',`<tr><td><b>${escapeHtml(worker?.name||'Deleted worker')}</b></td><td>${niceDate(s.startedAt)}</td><td>${s.events.length}</td><td><b>${fixed(s.dose,4)} ppm·h</b></td><td>${s.endedAt?'Closed':'Active'}</td></tr>`);});}
function deleteWorker(worker){const active=state.shifts.find(s=>s.workerId===worker.id&&s.id===state.activeShift&&!s.endedAt);const detail=active?' Their active shift will be closed.':' Historical shift records will remain.';if(!confirm(`Delete ${worker.name} from the worker register?${detail}`))return;if(active){active.endedAt=now();state.activeShift=null;}state.workers=state.workers.filter(w=>w.id!==worker.id);if(state.selectedWorker===worker.id)state.selectedWorker=null;persist();renderAll();toast(`${worker.name} removed from the worker register.`);}
function renderAll(){renderWorkers();renderCalibration();renderRecords();}
function escapeHtml(v){return String(v).replace(/[&<>'"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));}

const workspaceBackground=document.querySelector('.bg-workspace');
const workspaceOrder=['capture','workers','calibration','records'];
let activeWorkspace='capture', workspaceMotionTimer;
document.querySelectorAll('.tab').forEach(button=>button.onclick=()=>{const view=button.dataset.view;if(view===activeWorkspace)return;const direction=workspaceOrder.indexOf(view)>workspaceOrder.indexOf(activeWorkspace)?-1:1;document.querySelectorAll('.tab,.view').forEach(x=>x.classList.remove('active'));button.classList.add('active');$(view).classList.add('active');workspaceBackground.className=`bg-slide bg-workspace scene-${view}`;workspaceBackground.style.setProperty('--pan-kick',`${direction*1.35}%`);workspaceBackground.style.setProperty('--pan-rebound',`${direction*-0.24}%`);void workspaceBackground.offsetWidth;workspaceBackground.classList.add('is-panning');clearTimeout(workspaceMotionTimer);workspaceMotionTimer=setTimeout(()=>workspaceBackground.classList.remove('is-panning'),1150);activeWorkspace=view;});
document.querySelectorAll('.sample-mode').forEach(button=>button.onclick=()=>{sampleMode=button.dataset.sample;document.querySelectorAll('.sample-mode').forEach(x=>x.classList.toggle('active',x===button));});
$('startCamera').onclick=startCamera;$('takePhoto').onclick=freezeFrame;$('imageLoader').onchange=e=>loadImage(e.target.files[0]);$('captureCanvas').onclick=canvasClick;$('analyzeBtn').onclick=analyse;
$('newWorker').onclick=()=>$('workerDialog').showModal();
const closeWorkerDialog=()=>$('workerDialog').close();
$('closeWorkerDialog').onclick=closeWorkerDialog;
$('cancelWorkerDialog').onclick=closeWorkerDialog;
$('workerForm').addEventListener('submit',e=>{e.preventDefault();const name=$('workerName').value.trim();if(!name)return;state.workers.push({id:crypto.randomUUID(),name,employeeId:$('workerId').value.trim(),role:$('workerRole').value.trim(),createdAt:now()});state.selectedWorker=state.workers.at(-1).id;persist();$('workerDialog').close();e.target.reset();renderAll();toast('Worker record saved locally.');});
$('startShift').onclick=()=>{if(!state.selectedWorker)return;const existing=state.shifts.find(s=>s.id===state.activeShift&&!s.endedAt);if(existing)return;const shift={id:crypto.randomUUID(),workerId:state.selectedWorker,startedAt:now(),endedAt:null,dose:0,events:[]};state.shifts.push(shift);state.activeShift=shift.id;persist();renderAll();toast('Shift started.');};
$('saveExposureBtn').onclick=()=>{const shift=state.shifts.find(s=>s.id===state.activeShift&&!s.endedAt);if(!shift||current?.ppm == null){toast('Analyse a calibrated pair during an active shift first.');return;}shift.events.push({id:crypto.randomUUID(),at:now(),ppm:current.ppm,dose:current.dose,durationMin:current.durationMin,features:current.features,labTest:current.labTest,labRef:current.labRef});shift.dose+=current.dose;persist();renderAll();toast(`Saved ${fixed(current.dose,4)} ppm·h to the active shift.`);};
$('calibrationForm').addEventListener('submit',e=>{e.preventDefault();const duration=Number($('knownDuration').value),ppm=Number($('knownPpm').value);const feature=readPair(duration);if(!feature||!Number.isFinite(ppm)||ppm<0)return;state.calibration.samples.push({id:crypto.randomUUID(),createdAt:now(),ppm,durationMin:duration,features:feature.features});if(state.calibration.samples.length>=5)trainAndPersist();else{persist();renderAll();}toast(state.calibration.model?'SVR retrained locally.':'Calibration sample saved — add more varied certified samples.');});
$('clearCalibration').onclick=()=>{if(!confirm('Remove all local calibration samples and the trained model?'))return;state.calibration={samples:[],model:null};persist();renderAll();analyse();toast('Local calibration cleared.');};
$('exportData').onclick=()=>{const blob=new Blob([JSON.stringify({format:'TRACE backup',exportedAt:now(),state},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`trace-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);};
$('importData').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const backup=JSON.parse(await file.text());if(!backup.state?.workers||!backup.state?.shifts||!backup.state?.calibration)throw Error();if(!confirm('Replace this device’s local TRACE data with the selected backup?'))return;state={...DEFAULT,...backup.state};persist();renderAll();toast('Backup restored locally.');}catch{toast('That file is not a valid TRACE backup.');}finally{e.target.value='';}};
if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
renderAll();
