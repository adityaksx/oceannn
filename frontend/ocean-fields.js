(()=>{
'use strict';
const API='http://127.0.0.1:8000';
const $=id=>document.getElementById(id);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const S={catalog:[],times:[],i:0,active:'temperature',geo:null,meta:{},fields:[],currents:[],raf:0,token:0,playing:false};
const IDS=['temperature','temperature_anomaly','salinity','currents','sea_level','abnormal','chlorophyll'];
const LABEL={temperature:'Temperature',temperature_anomaly:'Sea surface temperature anomaly',salinity:'Salinity',currents:'Currents',sea_level:'Sea level',abnormal:'Abnormal / disaster data',chlorophyll:'Chlorophyll'};
const PAL={
 temperature:[[0,.01,.18],[0,.18,.95],[0,.85,1],[1,1,0],[1,.28,0],[.55,0,0]],
 temperature_anomaly:[[.02,.18,.65],[.15,.60,1],[1,1,1],[1,.55,.18],[.65,0,.02]],
 salinity:[[.02,.02,.45],[0,.35,1],[0,.95,.65],[.75,1,.08],[1,.55,0]],
 sea_level:[[.01,.05,.55],[0,.55,1],[.05,.95,1],[1,.85,.05],[.8,0,.02]],
 chlorophyll:[[.96,1,.92],[.65,.96,.25],[.08,.78,.18],[0,.35,.05],[0,.06,.015]],
 default:[[.02,.02,.2],[.2,.15,.8],[.0,.8,.7],[.8,1,.1],[1,.2,.02]]
};
const get=async p=>{const r=await fetch(API+p,{cache:'no-store'});if(!r.ok)throw Error(`${r.status} ${await r.text().catch(()=> '')}`);return r.json()};
function flatten(x,o=[]){if(Array.isArray(x)){for(const y of x)flatten(y,o)}else o.push(x);return o}
function quantile(a,p){if(!a.length)return 0;const x=(a.length-1)*p,i=Math.floor(x),j=Math.ceil(x);return a[i]+(a[j]-a[i])*(x-i)}
function iso(v){const d=new Date(v);return isNaN(d)?String(v??''):d.toISOString()}
function date(v){const d=new Date(v);return isNaN(d)?String(v??'—'):d.toLocaleDateString(undefined,{day:'2-digit',month:'short',year:'numeric'})}
function bounds(){return S.geo?.bounds||[84.104975983510294,92.99298840579259,16.070728135396756,23.524363913510872]}
function info(id){return S.catalog.find(v=>v.id===id)||null}
function palette(id){return PAL[id]||PAL.default}
function color(id,q){const p=palette(id);q=Math.max(0,Math.min(1,q));const x=q*(p.length-1),i=Math.min(p.length-2,Math.floor(x)),t=x-i,a=p[i],b=p[i+1];return[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t]}
function scene(){return BABYLON.Engine.LastCreatedEngine?.scenes?.[0]}
function baseMeshes(){const sc=scene();return sc?sc.meshes.filter(m=>m.metadata?.waterLayer||m.metadata?.waterWall||m.metadata?.solvxWaterSurface):[]}
function hideBase(){baseMeshes().forEach(m=>m.setEnabled(false))}
function showBase(){baseMeshes().forEach(m=>m.setEnabled(true))}
function clearFields(){S.fields.forEach(m=>m.dispose(false,true));S.fields=[]}
function clearCurrents(){if(S.raf){cancelAnimationFrame(S.raf);S.raf=0}S.currents.forEach(a=>{a.line?.dispose(false,true);a.head?.dispose(false,true)});S.currents=[]}
function extract2D(f){
 const dims=f.dimensions||[],shape=f.shape||[],lat=f.coordinates?.latitude||f.coordinates?.lat||[],lon=f.coordinates?.longitude||f.coordinates?.lon||[];
 const li=dims.includes('latitude')?dims.indexOf('latitude'):dims.indexOf('lat');
 const oi=dims.includes('longitude')?dims.indexOf('longitude'):dims.indexOf('lon');
 if(li<0||oi<0||!shape[li]||!shape[oi]||!lat.length||!lon.length)return null;
 const raw=flatten(f.data),nx=shape[oi],ny=shape[li],values=new Array(nx*ny);
 for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
  const ix=new Array(shape.length).fill(0);ix[li]=y;ix[oi]=x;let flat=0,mul=1;
  for(let k=shape.length-1;k>=0;k--){flat+=ix[k]*mul;mul*=shape[k]}
  values[y*nx+x]=Number(raw[flat]);
 }
 return{lat,lon,nx,ny,values};
}
function xy(lon,lat,y){const b=bounds(),lat0=(b[2]+b[3])/2,lon0=(b[0]+b[1])/2;return[(lon-lon0)*111.32*Math.cos(lat0*Math.PI/180),y,(lat-lat0)*111.32]}
function depthY(depth){const ex=+$('exaggeration')?.value||10;return 1-(Number(depth)||0)/1000*ex*8}
function makeField(f,depth,lo,hi,layer){
 const sc=scene(),d=extract2D(f);if(!sc||!d)return null;
 const y=depthY(depth),positions=[],colors=[],indices=[];let vi=0;
 for(let j=0;j<d.ny-1;j++)for(let i=0;i<d.nx-1;i++){
  const vals=[d.values[j*d.nx+i],d.values[j*d.nx+i+1],d.values[(j+1)*d.nx+i],d.values[(j+1)*d.nx+i+1]];
  if(!vals.every(finite))continue;
  const pts=[xy(d.lon[i],d.lat[j],y),xy(d.lon[i+1],d.lat[j],y),xy(d.lon[i],d.lat[j+1],y),xy(d.lon[i+1],d.lat[j+1],y)];
  pts.forEach(p=>positions.push(...p));
  vals.forEach(v=>{const c=color(S.active,(v-lo)/(hi-lo||1));colors.push(c[0],c[1],c[2],1)});
  indices.push(vi,vi+2,vi+1,vi+1,vi+2,vi+3);vi+=4;
 }
 if(!positions.length)return null;
 const mesh=new BABYLON.Mesh(`SOLVX FIELD ${S.active} ${layer}`,sc),vd=new BABYLON.VertexData();
 vd.positions=positions;vd.indices=indices;vd.colors=colors;vd.applyToMesh(mesh,true);
 const mat=new BABYLON.StandardMaterial(`SOLVX FIELD MATERIAL ${layer}`,sc);
 mat.diffuseColor=BABYLON.Color3.White();mat.emissiveColor=BABYLON.Color3.White();mat.specularColor=BABYLON.Color3.Black();mat.useVertexColors=true;mat.backFaceCulling=false;mat.disableLighting=true;mat.alpha=1;
 mesh.material=mat;mesh.renderingGroupId=20;mesh.isPickable=false;mesh.metadata={solvxField:true,depth:Number(depth)||0};
 return mesh;
}
async function scalar(){
 clearFields();clearCurrents();hideBase();
 const v=info(S.active);if(!v?.available){showBase();$('status').textContent=`${LABEL[S.active]}: no backend dataset detected`;return}
 const token=++S.token;
 try{
  const levels=(S.meta[v.file]?.values||[]).filter(finite);
  let indices;
  if(levels.length){const center=Math.max(0,Math.min(levels.length-1,Math.floor(levels.length/2)));const n=Math.min(5,levels.length);const start=Math.max(0,Math.min(levels.length-n,center-Math.floor(n/2)));indices=Array.from({length:n},(_,k)=>start+k)}else indices=[null];
  const frames=[];
  for(const idx of indices){
   const b=bounds(),q=new URLSearchParams({file:v.file,variable:v.variable,lat_min:String(b[2]),lat_max:String(b[3]),lon_min:String(b[0]),lon_max:String(b[1]),time_start:iso(S.times[S.i]),time_end:iso(S.times[S.i]),stride:'3'});
   if(idx!==null){q.set('depth_min',String(levels[idx]));q.set('depth_max',String(levels[idx]))}
   frames.push({f:await get('/data/region/array?'+q),depth:idx===null?0:levels[idx]});
  }
  if(token!==S.token)return;
  const all=[];frames.forEach(x=>flatten(x.f.data).forEach(n=>{n=Number(n);if(finite(n))all.push(n)}));all.sort((a,b)=>a-b);if(!all.length)throw Error('Backend returned no finite values');
  let lo=quantile(all,.005),hi=quantile(all,.995);if(!(hi>lo)){const pad=Math.max(Math.abs(lo)*.01,1e-6);lo-=pad;hi+=pad}
  if(S.active==='temperature_anomaly'){const m=Math.max(Math.abs(lo),Math.abs(hi));lo=-m;hi=m}
  frames.forEach((x,k)=>{const m=makeField(x.f,x.depth,lo,hi,k);if(m)S.fields.push(m)});
  $('legendTitle').textContent=`${v.label} · adaptive 0.5–99.5 percentile`;$('legendLo').textContent=lo.toFixed(3);$('legendHi').textContent=hi.toFixed(3);$('legend').style.display='block';
  $('status').textContent=`${v.label} · ${S.fields.length} data layers · ${lo.toFixed(3)} → ${hi.toFixed(3)} · ${date(S.times[S.i])}`;
 }catch(e){if(token===S.token){clearFields();showBase();$('status').textContent=`${LABEL[S.active]} failed: ${e.message}`;console.error(e)}}
}
function makeArrow(x,z,dx,dz,len,mag){
 const sc=scene(),y=5,p=new BABYLON.Vector3(x,y,z),q=new BABYLON.Vector3(x+dx*len,y,z+dz*len);
 const line=BABYLON.MeshBuilder.CreateLines('SOLVX CURRENT VECTOR',{points:[p,q],updatable:false},sc);line.color=new BABYLON.Color3(.02,.28,1);line.renderingGroupId=30;line.isPickable=false;
 const head=BABYLON.MeshBuilder.CreateLines('SOLVX CURRENT MOVING HEAD',{points:[q,q,q,q],updatable:true},sc);head.color=new BABYLON.Color3(0,1,1);head.renderingGroupId=31;head.isPickable=false;
 S.currents.push({line,head,x,z,dx,dz,len,mag,phase:Math.random()});
}
async function currents(){
 clearFields();clearCurrents();hideBase();
 try{
  const d=await get('/ocean/current-grid?'+new URLSearchParams({stride:'4',time:iso(S.times[S.i]),depth:'0'})),la=d.latitude||[],lo=d.longitude||[],u=d.u||[],v=d.v||[],mags=[];
  for(let j=0;j<la.length;j++)for(let i=0;i<lo.length;i++){const a=Number(u[j]?.[i]),b=Number(v[j]?.[i]);if(finite(a)&&finite(b))mags.push(Math.hypot(a,b))}
  mags.sort((a,b)=>a-b);const p95=quantile(mags,.95)||1,b=bounds(),lat0=(b[2]+b[3])/2,lon0=(b[0]+b[1])/2,klon=111.32*Math.cos(lat0*Math.PI/180);
  for(let j=0;j<la.length;j++)for(let i=0;i<lo.length;i++){
   const a=Number(u[j]?.[i]),bb=Number(v[j]?.[i]);if(!finite(a)||!finite(bb))continue;const mag=Math.hypot(a,bb);if(mag<p95*.005)continue;
   const x=(lo[i]-lon0)*klon,z=(la[j]-lat0)*111.32,ang=Math.atan2(bb,a),len=20+80*Math.min(1,mag/p95);makeArrow(x,z,Math.cos(ang),Math.sin(ang),len,mag);
  }
  $('legendTitle').textContent='Currents · speed + direction';$('legendLo').textContent='0 m/s';$('legendHi').textContent=`${p95.toFixed(3)} m/s`;$('legend').style.display='block';$('status').textContent=`Currents · ${S.currents.length} moving vectors · P95 ${p95.toFixed(3)} m/s · ${date(S.times[S.i])}`;animate(performance.now());
 }catch(e){showBase();$('status').textContent=`Currents failed: ${e.message}`;console.error(e)}
}
function animate(t){for(const a of S.currents){const f=((t/900)*(0.35+Math.min(2.2,a.mag/Math.max(a.mag,.001)))+a.phase)%1,d=f*a.len,x=a.x+a.dx*d,z=a.z+a.dz*d,tip=new BABYLON.Vector3(x,5,z),h1=new BABYLON.Vector3(x-a.dx*7-a.dz*3,5,z-a.dz*7+a.dx*3),h2=new BABYLON.Vector3(x-a.dx*7+a.dz*3,5,z-a.dz*7-a.dx*3),arr=a.head.getVerticesData(BABYLON.VertexBuffer.PositionKind);arr[0]=tip.x;arr[1]=5;arr[2]=tip.z;arr[3]=h1.x;arr[4]=5;arr[5]=h1.z;arr[6]=tip.x;arr[7]=5;arr[8]=tip.z;arr[9]=h2.x;arr[10]=5;arr[11]=h2.z;a.head.updateVerticesData(BABYLON.VertexBuffer.PositionKind,arr)}if(S.currents.length)S.raf=requestAnimationFrame(animate)}
async function meta(v){try{const m=await get('/metadata/'+encodeURIComponent(v.file));S.meta[v.file]={values:m.coordinates?.depth?.values||[]}}catch{S.meta[v.file]={values:[]}}}
function abnormal(){for(const d of S.datasets||[])for(const v of d.variables||[])if(/cyclone|storm|disaster|warning|alert|tropical/i.test(`${v.name} ${v.long_name||''} ${v.standard_name||''}`))return{...v,file:d.file};return null}
function buildVars(){const box=$('vars');if(!box)return;box.innerHTML='';for(const id of IDS){const v=id==='abnormal'?abnormal():info(id),b=document.createElement('button');b.className=`var ${v?.available?'':'off'} ${S.active===id?'active':''}`;b.innerHTML=`<span class="ico">${IDS.indexOf(id)+1}</span><span><strong>${LABEL[id]}</strong><span>${v?.available?(v.units||''): 'No backend dataset detected'}</span></span><i class="dot ${v?.available?'':'off'}"></i>`;if(v?.available)b.onclick=()=>select(id);box.appendChild(b)}}
async function select(id){S.active=id;buildVars();clearFields();clearCurrents();const v=id==='abnormal'?abnormal():info(id);if(!v?.available){showBase();$('status').textContent=`${LABEL[id]}: no backend dataset detected`;return}if(id==='abnormal'){showBase();$('status').textContent='Abnormal/disaster data has no scalar ocean renderer';return}if(id==='currents'){await currents();return}await meta(v);await scalar()}
function setTime(i){if(!S.times.length)return;S.i=Math.max(0,Math.min(S.times.length-1,+i||0));$('timeSlider').value=S.i;$('timeValue').textContent=date(S.times[S.i]);$('timeRaw').textContent=iso(S.times[S.i]);$('timeCount').textContent=`${S.i+1}/${S.times.length}`;if(S.active==='currents')currents();else if(info(S.active)?.available)scalar()}
function bindTimeline(){const sl=$('timeSlider');if(sl)sl.addEventListener('input',e=>setTime(e.target.value));const play=$('play');if(play)play.onclick=()=>{S.playing=!S.playing;play.textContent=S.playing?'PAUSE':'PLAY';if(S.playing)stepPlay()}}
function stepPlay(){if(!S.playing)return;setTime((S.i+1)%Math.max(1,S.times.length));setTimeout(stepPlay,900)}
async function init(){try{S.geo=await fetch('geometry.json?'+Date.now(),{cache:'no-store'}).then(r=>r.json());const c=await get('/ocean/catalog');S.catalog=c.variables||[];const t=await get('/ocean/time');S.times=t.values||[];$('timeSlider').max=Math.max(0,S.times.length-1);if(S.times.length)setTime(0);buildVars();if(info(S.active)?.available)await meta(info(S.active)),await scalar();else showBase()}catch(e){$('status').textContent=`Ocean data renderer failed: ${e.message}`;console.error(e)}}
bindTimeline();$('exaggeration')?.addEventListener('input',()=>{if(S.fields.length){const id=S.active;scalar().catch(console.error)}});init();
})();
