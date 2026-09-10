(()=>{
'use strict';
const API='http://127.0.0.1:8000', $=id=>document.getElementById(id);
const S={catalog:[],datasets:[],meta:{},times:[],i:0,active:'temperature',geo:null,fields:[],currents:[],raf:0,token:0};
const IDS=['temperature','temperature_anomaly','salinity','currents','sea_level','abnormal','chlorophyll'];
const LABEL={temperature:'Temperature',temperature_anomaly:'Sea surface temperature anomaly',salinity:'Salinity',currents:'Currents',sea_level:'Sea level',abnormal:'Abnormal / disaster data',chlorophyll:'Chlorophyll'};
const PAL={
 temperature:[[0.00,0.02,0.35],[0.00,0.20,1.00],[0.00,0.85,1.00],[1.00,1.00,0.00],[1.00,0.25,0.00],[0.65,0.00,0.00]],
 temperature_anomaly:[[0.00,0.12,0.70],[0.15,0.55,1.00],[1.00,1.00,1.00],[1.00,0.55,0.20],[0.65,0.00,0.02]],
 salinity:[[0.00,0.02,0.50],[0.00,0.45,1.00],[0.00,0.95,0.55],[0.75,1.00,0.05],[1.00,0.70,0.00]],
 sea_level:[[0.00,0.08,0.55],[0.00,0.55,1.00],[0.20,0.95,1.00],[1.00,0.85,0.05],[0.80,0.00,0.02]],
 chlorophyll:[[0.95,1.00,0.90],[0.60,0.95,0.25],[0.05,0.75,0.20],[0.00,0.35,0.06],[0.00,0.08,0.02]]
};
const get=async p=>{const r=await fetch(API+p,{cache:'no-store'});if(!r.ok)throw Error(`${r.status} ${await r.text().catch(()=> '')}`);return r.json()};
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function flatten(x,o=[]){if(Array.isArray(x))for(const y of x)flatten(y,o);else o.push(x);return o}
function quantile(a,p){if(!a.length)return 0;const x=(a.length-1)*p,i=Math.floor(x),j=Math.ceil(x);return a[i]+(a[j]-a[i])*(x-i)}
function date(v){const d=new Date(v);return isNaN(d)?String(v??'—'):d.toLocaleDateString(undefined,{day:'2-digit',month:'short',year:'numeric'})}
function iso(v){const d=new Date(v);return isNaN(d)?String(v??''):d.toISOString()}
function bounds(){return S.geo?.bounds||[84.104975983510294,92.99298840579259,16.070728135396756,23.524363913510872]}
function info(id){return S.catalog.find(v=>v.id===id)||null}
function abnormal(){for(const d of S.datasets||[])for(const v of d.variables||[])if(/cyclone|storm|disaster|warning|alert|tropical/i.test(`${v.name} ${v.long_name||''} ${v.standard_name||''}`))return{...v,file:d.file};return null}
function color(id,q){q=Math.max(0,Math.min(1,q));const p=PAL[id]||PAL.sea_level,x=q*(p.length-1),i=Math.min(p.length-2,Math.floor(x)),t=x-i,a=p[i],b=p[i+1];return[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t]}
function scene(){return BABYLON.Engine.LastCreatedEngine?.scenes?.[0]}
function baseMeshes(){const sc=scene();return sc?sc.meshes.filter(m=>m.metadata?.waterLayer||m.metadata?.waterWall||m.metadata?.solvxWaterSurface):[]}
function hideBase(){for(const m of baseMeshes())m.setEnabled(false)}
function showBase(){for(const m of baseMeshes())m.setEnabled(true)}
function clearFields(){for(const m of S.fields)m.dispose(false,true);S.fields=[]}
function clearCurrents(){if(S.raf){cancelAnimationFrame(S.raf);S.raf=0}for(const a of S.currents){a.line?.dispose(false,true);a.head?.dispose(false,true)}S.currents=[]}
function extract2D(f){
 const dims=f.dimensions||[],shape=f.shape||[],lat=f.coordinates?.latitude||f.coordinates?.lat||[],lon=f.coordinates?.longitude||f.coordinates?.lon||[];
 const li=dims.includes('latitude')?dims.indexOf('latitude'):dims.indexOf('lat'), oi=dims.includes('longitude')?dims.indexOf('longitude'):dims.indexOf('lon');
 if(li<0||oi<0||!shape[li]||!shape[oi]||!lat.length||!lon.length)return null;
 const raw=flatten(f.data),nx=shape[oi],ny=shape[li],values=new Array(nx*ny);
 for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
   const ix=new Array(shape.length).fill(0);ix[li]=y;ix[oi]=x;
   let flat=0,mul=1;for(let k=shape.length-1;k>=0;k--){flat+=ix[k]*mul;mul*=shape[k]}
   values[y*nx+x]=Number(raw[flat]);
 }
 return{lat,lon,nx,ny,values};
}
function xy(lon,lat,y){const b=bounds(),lat0=(b[2]+b[3])/2,lon0=(b[0]+b[1])/2;return[(lon-lon0)*111.32*Math.cos(lat0*Math.PI/180),y,(lat-lat0)*111.32]}
function makeField(f,depth,lo,hi,layer){
 const sc=scene(),d=extract2D(f);if(!sc||!d)return null;
 const positions=[],colors=[],indices=[];let vi=0;
 // Put the measured field ABOVE the old water volume. This is deliberately a fixed positive
 // offset so the field remains visible even when the bathymetry mesh is close to sea level.
 const y=18-layer*0.65;
 for(let j=0;j<d.ny-1;j++)for(let i=0;i<d.nx-1;i++){
   const a=d.values[j*d.nx+i],b=d.values[j*d.nx+i+1],c=d.values[(j+1)*d.nx+i],e=d.values[(j+1)*d.nx+i+1];
   if(![a,b,c,e].every(finite))continue;
   for(const p of [xy(d.lon[i],d.lat[j],y),xy(d.lon[i+1],d.lat[j],y),xy(d.lon[i],d.lat[j+1],y),xy(d.lon[i+1],d.lat[j+1],y)])positions.push(...p);
   for(const v of [a,b,c,e]){const q=(v-lo)/(hi-lo||1),c3=color(S.active,q);colors.push(c3[0],c3[1],c3[2],1)}
   indices.push(vi,vi+2,vi+1,vi+1,vi+2,vi+3);vi+=4;
 }
 if(!positions.length)return null;
 const mesh=new BABYLON.Mesh(`SOLVX FIELD ${S.active} ${layer}`,sc),vd=new BABYLON.VertexData();
 vd.positions=positions;vd.indices=indices;vd.colors=colors;vd.applyToMesh(mesh,true);
 const mat=new BABYLON.StandardMaterial(`SOLVX FIELD MATERIAL ${layer}`,sc);
 mat.diffuseColor=BABYLON.Color3.White();mat.emissiveColor=BABYLON.Color3.White();mat.specularColor=BABYLON.Color3.Black();mat.useVertexColors=true;mat.backFaceCulling=false;mat.disableLighting=true;mat.alpha=1;
 mesh.material=mat;mesh.renderingGroupId=20;mesh.isPickable=true;mesh.metadata={solvxField:true,depth:Number(depth)||0};
 return mesh;
}
async function scalar(){
 clearFields();clearCurrents();hideBase();
 const v=info(S.active);if(!v?.available){showBase();$('status').textContent=`${LABEL[S.active]}: no backend dataset detected`;return}
 const token=++S.token;
 try{
  const levels=(S.meta[v.file]?.values||[]).filter(finite);
  const center=Math.max(0,Math.min(Math.max(0,levels.length-1),+$('depth').value||0));
  const n=Math.min(5,Math.max(1,levels.length||1));
  const start=levels.length?Math.max(0,Math.min(levels.length-n,center-Math.floor(n/2))):null;
  const inds=levels.length?Array.from({length:n},(_,k)=>start+k):[null];
  const frames=[];
  for(const idx of inds){
   const q=new URLSearchParams({file:v.file,variable:v.variable,lat_min:String(bounds()[2]),lat_max:String(bounds()[3]),lon_min:String(bounds()[0]),lon_max:String(bounds()[1]),time_start:iso(S.times[S.i]),time_end:iso(S.times[S.i]),stride:'3'});
   if(idx!=null){q.set('depth_min',String(levels[idx]));q.set('depth_max',String(levels[idx]))}
   frames.push({f:await get('/data/region/array?'+q),depth:idx==null?0:levels[idx]});
  }
  if(token!==S.token)return;
  let all=[];for(const x of frames)all.push(...flatten(x.f.data).map(Number).filter(finite));all.sort((a,b)=>a-b);
  if(!all.length)throw Error('Backend returned no finite values');
  let lo=quantile(all,.005),hi=quantile(all,.995);if(lo===hi)hi=lo+1;
  if(S.active==='temperature_anomaly'){const m=Math.max(Math.abs(lo),Math.abs(hi));lo=-m;hi=m}
  for(let k=0;k<frames.length;k++){const m=makeField(frames[k].f,frames[k].depth,lo,hi,k);if(m)S.fields.push(m)}
  $('legendTitle').textContent=`${v.label} · adaptive 0.5–99.5 percentile`;$('legendLo').textContent=lo.toFixed(3);$('legendHi').textContent=hi.toFixed(3);$('legend').style.display='block';
  $('status').textContent=`${v.label} · ${S.fields.length} visible data layers · range ${lo.toFixed(3)} → ${hi.toFixed(3)} · ${date(S.times[S.i])}`;
 }catch(e){if(token===S.token){clearFields();showBase();$('status').textContent=`${LABEL[S.active]} failed: ${e.message}`;console.error(e)}}
}
function makeArrow(x,z,dx,dz,len,mag){
 const sc=scene(),y=25,p=new BABYLON.Vector3(x,y,z),q=new BABYLON.Vector3(x+dx*len,y,z+dz*len);
 const line=BABYLON.MeshBuilder.CreateLines('SOLVX CURRENT VECTOR',{points:[p,q],updatable:false},sc);line.color=new BABYLON.Color3(0.05,0.30,1);line.renderingGroupId=30;line.isPickable=false;
 const head=BABYLON.MeshBuilder.CreateLines('SOLVX CURRENT MOVING HEAD',{points:[q,q,q,q],updatable:true},sc);head.color=new BABYLON.Color3(0,1,1);head.renderingGroupId=31;head.isPickable=false;
 S.currents.push({line,head,x,z,dx,dz,len,mag,phase:Math.random()});
}
async function currents(){
 clearFields();clearCurrents();hideBase();
 try{
  const q=new URLSearchParams({stride:'4',time:iso(S.times[S.i]),depth:'0'}),d=await get('/ocean/current-grid?'+q),la=d.latitude||[],lo=d.longitude||[],u=d.u||[],v=d.v||[],mags=[];
  for(let j=0;j<la.length;j++)for(let i=0;i<lo.length;i++){const a=Number(u[j]?.[i]),b=Number(v[j]?.[i]);if(finite(a)&&finite(b))mags.push(Math.hypot(a,b))}
  mags.sort((a,b)=>a-b);const p95=quantile(mags,.95)||1,b=bounds(),lat0=(b[2]+b[3])/2,lon0=(b[0]+b[1])/2,klon=111.32*Math.cos(lat0*Math.PI/180);
  for(let j=0;j<la.length;j++)for(let i=0;i<lo.length;i++){
   const a=Number(u[j]?.[i]),bb=Number(v[j]?.[i]);if(!finite(a)||!finite(bb))continue;const mag=Math.hypot(a,bb);if(mag<p95*.005)continue;
   const x=(lo[i]-lon0)*klon,z=(la[j]-lat0)*111.32,ang=Math.atan2(bb,a),len=20+70*Math.min(1,mag/p95);makeArrow(x,z,Math.cos(ang),Math.sin(ang),len,mag);
  }
  $('legendTitle').textContent='Currents · speed + direction';$('legendLo').textContent='0 m/s';$('legendHi').textContent=`${p95.toFixed(3)} m/s`;$('legend').style.display='block';$('status').textContent=`Currents · ${S.currents.length} moving vectors · P95 ${p95.toFixed(3)} m/s · ${date(S.times[S.i])}`;
  animate(performance.now());
 }catch(e){showBase();$('status').textContent=`Currents failed: ${e.message}`;console.error(e)}
}
function animate(t){
 for(const a of S.currents){
  const f=((t/900)*(0.45+Math.min(2.5,a.mag/Math.max(a.mag,.001)))+a.phase)%1,d=f*a.len,x=a.x+a.dx*d,z=a.z+a.dz*d,tip=new BABYLON.Vector3(x,25,z),h1=new BABYLON.Vector3(x-a.dx*7-a.dz*3,25,z-a.dz*7+a.dx*3),h2=new BABYLON.Vector3(x-a.dx*7+a.dz*3,25,z-a.dz*7-a.dx*3),arr=a.head.getVerticesData(BABYLON.VertexBuffer.PositionKind);
  arr[0]=tip.x;arr[1]=tip.y;arr[2]=tip.z;arr[3]=h1.x;arr[4]=h1.y;arr[5]=h1.z;arr[6]=tip.x;arr[7]=tip.y;arr[8]=tip.z;arr[9]=h2.x;arr[10]=h2.y;arr[11]=h2.z;a.head.updateVerticesData(BABYLON.VertexBuffer.PositionKind,arr);
 }
 if(S.currents.length)S.raf=requestAnimationFrame(animate);
}
async function meta(v){try{const m=await get('/metadata/'+encodeURIComponent(v.file));S.meta[v.file]={values:m.coordinates?.depth?.values||[]}}catch{S.meta[v.file]={values:[]}}}
function buildVars(){const box=$('vars');if(!box)return;const bad=abnormal();box.innerHTML='';for(const id of IDS){const v=id==='abnormal'?bad:info(id),b=document.createElement('button');b.className=`var ${v?.available?'':'off'} ${S.active===id?'active':''}`;b.innerHTML=`<span class="ico">${IDS.indexOf(id)+1}</span><span><strong>${LABEL[id]}</strong><span>${v?.available?(v.units||''): 'No backend dataset detected'}</span></span><i class="dot ${v?.available?'':'off'}"></i>`;if(v?.available)b.onclick=()=>select(id);box.appendChild(b)}}
async function select(id){S.active=id;buildVars();clearFields();clearCurrents();const v=id==='abnormal'?abnormal():info(id);if(!v?.available){showBase();$('status').textContent=`${LABEL[id]}: no backend dataset detected`;return}if(id==='abnormal'){showBase();$('status').textContent='Abnormal/disaster data has no scalar ocean renderer';return}if(id==='currents'){await currents();return}await meta(v);await scalar()}
function setTime(i){S.i=Math.max(0,Math.min(S.times.length-1,+i||0));$('timeSlider').value=S.i;$('timeValue').textContent=date(S.times[S.i]);$('timeRaw').textContent=iso(S.times[S.i]);$('timeCount').textContent=`${S.i+1}/${S.times.length}`;if(S.active==='currents')currents();else if(info(S.active)?.available)scalar()}
async function init(){try{S.geo=await fetch('geometry.json?'+Date.now(),{cache:'no-store'}).then(r=>r.json());const[c,t,d]=await Promise.all([get('/ocean/catalog'),get('/ocean/time'),get('/datasets')]);S.catalog=c.variables||[];S.times=t.values||[];S.datasets=d.datasets||[];buildVars();const ts=$('timeSlider');ts.max=Math.max(0,S.times.length-1);ts.oninput=()=>setTime(ts.value);if(S.times.length){$('timeValue').textContent=date(S.times[0]);$('timeRaw').textContent=iso(S.times[0]);$('timeCount').textContent=`1/${S.times.length}`}const first=S.catalog.find(v=>v.id==='temperature'&&v.available)||S.catalog.find(v=>v.available);if(first)await select(first)}catch(e){$('status').textContent=`Field system error: ${e.message}`;console.error(e)}}
setTimeout(init,900);
})();