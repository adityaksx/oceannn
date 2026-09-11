(()=>{
'use strict';

const API=`${location.protocol}//${location.hostname}:8000`;
const $=id=>document.getElementById(id);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const flat=(v,out=[])=>{if(Array.isArray(v))for(const x of v)flat(x,out);else out.push(v);return out};
const get=async path=>{const r=await fetch(API+path,{cache:'no-store'});if(!r.ok)throw Error(`${r.status} ${await r.text().catch(()=>r.statusText)}`);return r.json()};

const LABEL={temperature:'Temperature',temperature_anomaly:'Sea surface temperature anomaly',salinity:'Salinity',currents:'Currents',sea_level:'Sea level',abnormal:'Abnormal / disaster data',chlorophyll:'Chlorophyll'};
const IDS=Object.keys(LABEL);
const PALETTE={
 temperature:[[0x071b8f,0],[0x0067ff,.16],[0x00cfff,.32],[0x22e39c,.48],[0xfff000,.64],[0xff7a00,.82],[0xa90000,1]],
 temperature_anomaly:[[0x071b8f,0],[0x2b76ff,.25],[0xf4f4f4,.5],[0xff925c,.75],[0x8f0012,1]],
 salinity:[[0x081a8f,0],[0x087eff,.18],[0x00d5bd,.38],[0x72e13a,.58],[0xffea00,.78],[0xff6500,1]],
 sea_level:[[0x0a168e,0],[0x087cff,.2],[0x20d6d0,.4],[0xffea00,.62],[0xff6c00,.82],[0x980018,1]],
 chlorophyll:[[0xf4ffe8,0],[0xb8f35d,.2],[0x51d52e,.42],[0x0b992f,.64],[0x005c29,.82],[0x002c17,1]],
 default:[[0x071b8f,0],[0x007dff,.2],[0x13d9d0,.4],[0xffe500,.62],[0xff6500,.82],[0x9d0017,1]]
};
function rgb(hex){return new BABYLON.Color3(((hex>>16)&255)/255,((hex>>8)&255)/255,(hex&255)/255)}
function color(id,q){const p=PALETTE[id]||PALETTE.default;q=Math.max(0,Math.min(1,q));for(let i=0;i<p.length-1;i++){const a=p[i],b=p[i+1];if(q<=b[1])return rgb(a[0]).lerp(rgb(b[0]),(q-a[1])/(b[1]-a[1]))}return rgb(p[p.length-1][0])}
function quantile(a,p){if(!a.length)return 0;const x=(a.length-1)*p,i=Math.floor(x),j=Math.ceil(x);return a[i]+(a[j]-a[i])*(x-i)}
function stats(values){const a=values.filter(finite).sort((x,y)=>x-y);if(!a.length)return null;return{a,min:a[0],max:a[a.length-1],p001:quantile(a,.001),p005:quantile(a,.005),p01:quantile(a,.01),p05:quantile(a,.05),p50:quantile(a,.5),p95:quantile(a,.95),p99:quantile(a,.99),p995:quantile(a,.995),p999:quantile(a,.999)}}

const S={catalog:[],times:[],timeIndex:0,active:'temperature',geo:null,meta:{},fields:[],currents:[],currentRaf:0,token:0};
const fieldRoot=new BABYLON.TransformNode('SOLVX_FIELD_ROOT',BABYLON.Engine.LastCreatedEngine?.scenes?.[0]||null);
function scene(){return BABYLON.Engine.LastCreatedEngine?.scenes?.[0]||null}
function bounds(){return S.geo?.bounds||[84.104975983510294,92.99298840579259,16.070728135396756,23.524363913510872]}
function iso(v){const d=new Date(v);return isNaN(d)?String(v??''):d.toISOString()}
function day(v){const d=new Date(v);return isNaN(d)?String(v??'—'):d.toISOString().slice(0,10)}
function status(text,type='ok'){if($('status'))$('status').textContent=text;if($('statusDot'))$('statusDot').className=`statusdot ${type==='error'?'error':type==='busy'?'busy':''}`}
function info(id){return S.catalog.find(v=>v.id===id)||null}

function clearFields(){for(const m of S.fields){m.material?.dispose();m.geometry?.dispose();m.dispose(false,true)}S.fields=[]}
function clearCurrents(){if(S.currentRaf){cancelAnimationFrame(S.currentRaf);S.currentRaf=0}for(const x of S.currents){x.line?.dispose(false,true);x.head?.dispose(false,true);x.line?.material?.dispose();x.head?.material?.dispose()}S.currents=[]}
function baseMeshes(){const sc=scene();return sc?sc.meshes.filter(m=>m.metadata?.waterLayer||m.metadata?.waterWall||m.metadata?.solvxWaterSurface):[]}
function showBase(){baseMeshes().forEach(m=>m.setEnabled(true))}
function hideBase(){baseMeshes().forEach(m=>m.setEnabled(false))}

function extract2D(f){
 const dims=f.dimensions||[],shape=f.shape||[],coords=f.coordinates||{};
 const lat=coords.latitude||coords.lat||[],lon=coords.longitude||coords.lon||[];
 const li=dims.includes('latitude')?dims.indexOf('latitude'):dims.indexOf('lat');
 const oi=dims.includes('longitude')?dims.indexOf('longitude'):dims.indexOf('lon');
 if(li<0||oi<0||!shape[li]||!shape[oi]||!lat.length||!lon.length)return null;
 const raw=flat(f.data),nx=shape[oi],ny=shape[li],values=new Array(nx*ny);
 for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
  const ix=new Array(shape.length).fill(0);ix[li]=y;ix[oi]=x;let at=0,m=1;
  for(let k=shape.length-1;k>=0;k--){at+=ix[k]*m;m*=shape[k]}
  values[y*nx+x]=Number(raw[at]);
 }
 return{lat:lat.map(Number),lon:lon.map(Number),nx,ny,values}
}

function rankLookup(s){
 const a=s.a;
 return v=>{
  if(!finite(v)||!a.length)return .5;
  let lo=0,hi=a.length;
  while(lo<hi){const m=(lo+hi)>>1;if(a[m]<v)lo=m+1;else hi=m}
  let hi2=lo;while(hi2<a.length&&a[hi2]===v)hi2++;
  const rank=(lo+Math.max(0,hi2-lo-1)*.5)/(a.length-1||1);
  return Math.max(0,Math.min(1,rank));
 }
}

function makeGridMesh(frame,depth,range,layer){
 const sc=scene();if(!sc)return null;const d=extract2D(frame);if(!d)return null;
 const lat0=(bounds()[2]+bounds()[3])/2,lon0=(bounds()[0]+bounds()[1])/2,klon=111.32*Math.cos(lat0*Math.PI/180),klat=111.32;
 const pos=[],col=[],idx=[],rank=rankLookup(range);let vi=0;
 const add=(x,y,v)=>{const px=(x-lon0)*klon,py=(y-lat0)*klat;pos.push(px,0,py);const q=rank(v);let t=q;if(S.active!=='temperature_anomaly')t=Math.pow(q,.72);const c=color(S.active,t);col.push(c.r,c.g,c.b,1);return vi++};
 for(let y=0;y<d.ny-1;y++)for(let x=0;x<d.nx-1;x++){
  const a=d.values[y*d.nx+x],b=d.values[y*d.nx+x+1],c=d.values[(y+1)*d.nx+x],e=d.values[(y+1)*d.nx+x+1];
  if(![a,b,c,e].every(finite))continue;
  const q0=add(d.lon[x],d.lat[y],a),q1=add(d.lon[x+1],d.lat[y],b),q2=add(d.lon[x],d.lat[y+1],c),q3=add(d.lon[x+1],d.lat[y+1],e);
  idx.push(q0,q2,q1,q1,q2,q3);
 }
 if(!pos.length)return null;
 const g=new BABYLON.VertexData();g.positions=pos;g.colors=col;g.indices=idx;const mesh=new BABYLON.Mesh(`SOLVX DATA ${S.active} ${layer}`,sc);g.applyToMesh(mesh,true);mesh.hasVertexAlpha=true;
 const mat=new BABYLON.StandardMaterial(`SOLVX DATA MAT ${S.active} ${layer}`,sc);mat.diffuseColor=BABYLON.Color3.White();mat.emissiveColor=BABYLON.Color3.White();mat.specularColor=BABYLON.Color3.Black();mat.disableLighting=true;mat.backFaceCulling=false;mat.useVertexColors=true;mat.alpha=1;mesh.material=mat;
 mesh.position.y=-(Number(depth)||0)*((+$('exaggeration')?.value||10)*8)/1000+3.5;mesh.renderingGroupId=20;mesh.isPickable=false;mesh.metadata={solvxField:true,depth:Number(depth)||0,range:[range.lo,range.hi],min:range.min,max:range.max};return mesh
}

function adaptiveRange(values,id){
 const s=stats(values);if(!s)return null;let lo=s.p005,hi=s.p995;
 if(id==='temperature_anomaly'){const m=Math.max(Math.abs(s.min),Math.abs(s.max),Math.abs(lo),Math.abs(hi),.001);lo=-m;hi=m}
 if(!(hi>lo)){const pad=Math.max(Math.abs(lo)*.01,1e-6);lo-=pad;hi+=pad}
 return{...s,lo,hi}
}

async function scalar(){
 clearFields();clearCurrents();hideBase();const v=info(S.active);if(!v?.available){showBase();status(`${LABEL[S.active]}: no backend dataset detected`);return}
 const token=++S.token;status(`Loading ${LABEL[S.active]}…`,'busy');try{
  const levels=(S.meta[v.file]?.values||[]).filter(finite);
  const n=Math.min(5,levels.length||1);let indices=[];
  if(levels.length){const center=Math.max(0,Math.min(levels.length-1,Number($('depth')?.value||0))),start=Math.max(0,Math.min(levels.length-n,center-Math.floor(n/2)));indices=Array.from({length:n},(_,k)=>start+k)}else indices=[null];
  const frames=[];
  for(const di of indices){const b=bounds(),q=new URLSearchParams({file:v.file,variable:v.variable,lat_min:String(b[2]),lat_max:String(b[3]),lon_min:String(b[0]),lon_max:String(b[1]),time_start:iso(S.times[S.timeIndex]),time_end:iso(S.times[S.timeIndex]),stride:'3'});if(di!==null){q.set('depth_min',String(levels[di]));q.set('depth_max',String(levels[di]))}const f=await get('/data/region/array?'+q);const vals=flat(f.data).map(Number).filter(finite);frames.push({f,depth:di===null?0:levels[di],vals})}
  if(token!==S.token)return;
  const valid=frames.filter(x=>x.vals.length);if(!valid.length)throw Error('Backend returned no finite numeric field values');
  for(let k=0;k<valid.length;k++){const r=adaptiveRange(valid[k].vals,S.active),m=makeGridMesh(valid[k].f,valid[k].depth,r,k);if(m){S.fields.push(m);valid[k].range=r}}
  const ranges=valid.filter(x=>x.range).map(x=>x.range);const lo=Math.min(...ranges.map(x=>x.lo)),hi=Math.max(...ranges.map(x=>x.hi));
  if($('legendTitle'))$('legendTitle').textContent=`${v.label} · adaptive rank contrast`;
  if($('legendLo'))$('legendLo').textContent=lo.toFixed(3);
  if($('legendHi'))$('legendHi').textContent=hi.toFixed(3);
  if($('legend'))$('legend').style.display='block';
  status(`${v.label} · ${S.fields.length} data layers · each layer contrast-stretched from its own value distribution · ${day(S.times[S.timeIndex])}`);
 }catch(e){if(token===S.token){clearFields();showBase();status(`${LABEL[S.active]} failed: ${e.message}`,'error');console.error(e)}}
}

function makeArrow(x,z,dx,dz,len,mag){const sc=scene(),y=5.5,p=new BABYLON.Vector3(x,y,z),q=new BABYLON.Vector3(x+dx*len,y,z+dz*len),line=BABYLON.MeshBuilder.CreateLines('SOLVX CURRENT',{points:[p,q],updatable:false},sc);line.color=new BABYLON.Color3(.02,.28,1);line.renderingGroupId=30;line.isPickable=false;const h=new BABYLON.Vector3(q.x-dx*6-dz*3,y,q.z-dz*6+dx*3),j=new BABYLON.Vector3(q.x-dx*6+dz*3,y,q.z-dz*6-dx*3),head=BABYLON.MeshBuilder.CreateLines('SOLVX CURRENT HEAD',{points:[q,h,q,j],updatable:true},sc);head.color=new BABYLON.Color3(0,1,1);head.renderingGroupId=31;head.isPickable=false;S.currents.push({line,head,x,z,dx,dz,len,mag,phase:Math.random()})}
async function currents(){clearFields();clearCurrents();hideBase();try{const d=await get('/ocean/current-grid?'+new URLSearchParams({stride:'4',time:iso(S.times[S.timeIndex]),depth:String(+$('depth')?.value||0)})),la=d.latitude||[],lo=d.longitude||[],u=d.u||[],v=d.v||[],m=[];for(let j=0;j<la.length;j++)for(let i=0;i<lo.length;i++){const a=Number(u[j]?.[i]),b=Number(v[j]?.[i]);if(finite(a)&&finite(b))m.push(Math.hypot(a,b))}m.sort((a,b)=>a-b);const p95=quantile(m,.95)||1,b=bounds(),lat0=(b[2]+b[3])/2,lon0=(b[0]+b[1])/2,klon=111.32*Math.cos(lat0*Math.PI/180);for(let j=0;j<la.length;j++)for(let i=0;i<lo.length;i++){const a=Number(u[j]?.[i]),bb=Number(v[j]?.[i]);if(!finite(a)||!finite(bb))continue;const mag=Math.hypot(a,bb);if(mag<p95*.005)continue;const x=(lo[i]-lon0)*klon,z=(la[j]-lat0)*111.32,ang=Math.atan2(bb,a),len=18+80*Math.min(1,mag/(p95||1));makeArrow(x,z,Math.cos(ang),Math.sin(ang),len,mag)}if($('legendTitle'))$('legendTitle').textContent='Currents · direction + speed';if($('legendLo'))$('legendLo').textContent='0 m/s';if($('legendHi'))$('legendHi').textContent=`${p95.toFixed(3)} m/s`;if($('legend'))$('legend').style.display='block';status(`Currents · ${S.currents.length} vectors · P95 ${p95.toFixed(3)} m/s · ${day(S.times[S.timeIndex])}`);animateCurrents(performance.now())}catch(e){showBase();status(`Currents failed: ${e.message}`,'error');console.error(e)}}
function animateCurrents(t){for(const a of S.currents){const f=((t/900)*(.35+Math.min(2,a.mag/Math.max(a.mag,.001)))+a.phase)%1,d=f*a.len,x=a.x+a.dx*d,z=a.z+a.dz*d,q=new BABYLON.Vector3(x,5.5,z),h1=new BABYLON.Vector3(x-a.dx*6-a.dz*3,5.5,z-a.dz*6+a.dx*3),h2=new BABYLON.Vector3(x-a.dx*6+a.dz*3,5.5,z-a.dz*6-a.dx*3),arr=a.head.getVerticesData(BABYLON.VertexBuffer.PositionKind);if(arr){arr.set([q.x,5.5,q.z,h1.x,5.5,h1.z,q.x,5.5,q.z,h2.x,5.5,h2.z]);a.head.updateVerticesData(BABYLON.VertexBuffer.PositionKind,arr)}}if(S.currents.length)S.currentRaf=requestAnimationFrame(animateCurrents)}

async function meta(v){try{const m=await get('/metadata/'+encodeURIComponent(v.file));S.meta[v.file]={values:(m.coordinates?.depth?.values||[]).map(Number).filter(finite)}}catch{S.meta[v.file]={values:[]}}}
function buildVars(){const box=$('vars');if(!box)return;box.innerHTML='';for(const id of IDS){const v=info(id),b=document.createElement('button');b.className=`var ${v?.available?'':'off'} ${S.active===id?'active':''}`;b.innerHTML=`<span class="ico">${IDS.indexOf(id)+1}</span><span><strong>${LABEL[id]}</strong><span>${v?.available?(v.units||'available'):'No matching dataset'}</span></span><i class="dot ${v?.available?'':'off'}"></i>`;if(v?.available)b.onclick=()=>select(id);box.appendChild(b)}}
async function select(id){if(!IDS.includes(id))return;S.active=id;buildVars();if(id==='abnormal'){clearFields();clearCurrents();showBase();status('Abnormal/disaster information has no scalar ocean renderer');return}if(id==='currents'){await currents();return}await meta(info(id));await scalar()}
function setTime(i){if(!S.times.length)return;S.timeIndex=Math.max(0,Math.min(S.times.length-1,+i||0));if($('timeSlider'))$('timeSlider').value=S.timeIndex;if($('timeValue'))$('timeValue').textContent=day(S.times[S.timeIndex]);if($('timeRaw'))$('timeRaw').textContent=iso(S.times[S.timeIndex]);if($('timeCount'))$('timeCount').textContent=`${S.timeIndex+1}/${S.times.length}`;if(S.active==='currents')currents();else if(info(S.active)?.available)scalar()}
function bind(){const sl=$('timeSlider');if(sl)sl.oninput=e=>setTime(e.target.value);const play=$('play');if(play)play.onclick=()=>{play.dataset.playing=play.dataset.playing==='1'?'0':'1';play.textContent=play.dataset.playing==='1'?'PAUSE':'PLAY';const step=()=>{if(play.dataset.playing!=='1')return;setTime((S.timeIndex+1)%Math.max(1,S.times.length));setTimeout(step,900)};if(play.dataset.playing==='1')step()};const dep=$('depth');if(dep)dep.oninput=()=>{if(S.active==='currents')currents();else if(info(S.active)?.available)scalar()};const ex=$('exaggeration');if(ex)ex.oninput=()=>{$('exagValue').textContent=`${ex.value}x`;S.fields.forEach(m=>m.position.y=-(Number(m.metadata?.depth)||0)*(+ex.value*8)/1000+3.5);if(S.active==='currents')currents()}}
async function init(){
 try{
  const sc=scene();if(!sc){setTimeout(init,250);return}
  try{S.geo=await (await fetch('geometry.json?f='+Date.now(),{cache:'no-store'})).json()}catch{}
  const cat=await get('/ocean/catalog');S.catalog=cat.variables||[];buildVars();
  try{const t=await get('/ocean/time');S.times=t.values||[]}catch{S.times=[]}
  if(S.times.length)setTime(0);else{$('timeValue').textContent='No timeline data';status('Backend is running, but /ocean/time returned no timestamps','error')}
  bind();const first=info('temperature')?.available?info('temperature'):S.catalog.find(v=>v.available);if(first){S.active=first.id;buildVars();if(first.id!=='currents')await meta(first);await scalar()}else showBase();
 }catch(e){console.error(e);status(`Field renderer initialization failed: ${e.message}`,'error');showBase();const box=$('vars');if(box)box.innerHTML='<div style="font:12px system-ui;color:#9b1c1c;padding:8px 0">Field renderer failed. Check browser console and backend /ocean/catalog.</div>'}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
