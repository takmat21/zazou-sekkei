const __zdata = await (await fetch('data.json?v=1127')).text();
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
const stage=document.getElementById('stage');
try{
const qs=new URLSearchParams(location.search);const SHOT=qs.get('shot')==='1';if(SHOT)document.body.classList.add('shot');
const D=JSON.parse(__zdata);
const b64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const P=new Float32Array(b64(D.P).buffer);const C8=b64(D.C);const Cf=new Float32Array(C8.length);for(let i=0;i<C8.length;i++)Cf[i]=C8[i]/255;
const r=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:SHOT});r.setPixelRatio(Math.min(devicePixelRatio,2));stage.appendChild(r.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color('#eef1f4');
const cam=new THREE.PerspectiveCamera(40,1,0.1,1000);const ctl=new OrbitControls(cam,r.domElement);ctl.enableDamping=true;ctl.maxPolarAngle=Math.PI*.49;
const pg=new THREE.BufferGeometry();pg.setAttribute('position',new THREE.BufferAttribute(P,3));pg.setAttribute('color',new THREE.BufferAttribute(Cf,3));
const pcl=new THREE.Points(pg,new THREE.PointsMaterial({size:.34,vertexColors:true,sizeAttenuation:true}));scene.add(pcl);
const vec=new THREE.Group();scene.add(vec);
const LC={'法肩':'#d4451f','法尻':'#7a3f9e','水際':'#1f6fc2','石積み天端':'#5c4a33','道路端':'#55595f'};
for(const l of D.lines){const g=new THREE.BufferGeometry().setFromPoints(l.p.map(q=>new THREE.Vector3(q[0],q[1]+.03,q[2])));vec.add(new THREE.Line(g,new THREE.LineBasicMaterial({color:LC[l.k]||'#333'})));}
// 面：帯ごとに三角形
const cu=D.cu,bp=D.bp;
function zp(vp){if(vp<=bp[0][0])return bp[0][1];for(let i=1;i<bp.length;i++){if(vp<=bp[i][0]){const a=bp[i-1],b=bp[i];return a[1]+(b[1]-a[1])*(vp-a[0])/(b[0]-a[0]);}}return bp[bp.length-1][1];}
for(const b of D.bands){const pos=[],idx=[];const n=cu.length;const steps=b.k==='河川'?1:Math.max(1,Math.round((b.b-b.a)/1.0));
 for(let i=0;i<n;i++){for(let j=0;j<=steps;j++){const vp=b.a+(b.b-b.a)*j/steps;const z=b.k==='河川'?D.WL:zp(vp);pos.push(i-50,z-9.5+.015,vp+cu[i]-28);}}
 const m=steps+1;for(let i=0;i<n-1;i++)for(let j=0;j<steps;j++){const a=i*m+j,c=(i+1)*m+j;idx.push(a,c,a+1,a+1,c,c+1);}
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(idx);
 {const mm=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:b.c,transparent:true,opacity:b.k==='河川'?.35:.18,side:THREE.DoubleSide,depthWrite:false}));mm.userData.k=b.k;vec.add(mm);}}
const PC={'標高点':'#16181c','構造物':'#c0392b','樹木':'#3d6e2c','水位':'#1f6fc2'};
for(const p of D.pts){const s=p.k==='標高点'?.18:(p.k==='構造物'?.12:.35);const m=new THREE.Mesh(new THREE.SphereGeometry(s,12,8),new THREE.MeshBasicMaterial({color:PC[p.k]||'#000'}));m.position.set(p.p[0],p.p[1]+(p.k==='樹木'?0:.05),p.p[2]);vec.add(m);}
// 横断の測線
for(const s of D.secs){const u=s.u-50;const g=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(u,4,-28),new THREE.Vector3(u,4,28)]);vec.add(new THREE.Line(g,new THREE.LineDashedMaterial({color:'#0b3bf5',dashSize:.8,gapSize:.5})).computeLineDistances());}
let mode='both';function setMode(m){mode=m;pcl.visible=m!=='vec';vec.visible=m!=='pc';vec.children.forEach(o=>{if(o.isMesh&&o.material.transparent){o.visible=m==='vec';o.material.opacity=o.userData.k==='河川'?.55:.45;}});document.querySelectorAll('button[data-m]').forEach(b=>b.classList.toggle('on',b.dataset.m===m));}
document.querySelectorAll('button[data-m]').forEach(b=>b.onclick=()=>setMode(b.dataset.m));
const cuAt=u=>cu[Math.round(u)];
const V={all:[[52,40,78],[0,-1.5,0]],top:[[0,95,.01],[0,0,0]],sec:[[0,1.2,-1+0],[0,0,0]],wall:[[13,-0.6,cuAt(60)-0.8],[10,-1.4,cuAt(60)-7.6]]};
V.sec=[[ -26,1.5,cuAt(50)-28+1],[ 30,0,cuAt(50)-28+1]];
let goal=null;function go(k,now){const v=V[k];if(now){cam.position.set(...v[0]);ctl.target.set(...v[1]);}else goal={p:new THREE.Vector3(...v[0]),t:new THREE.Vector3(...v[1])};document.querySelectorAll('button[data-v]').forEach(b=>b.classList.toggle('on',b.dataset.v===k));}
document.querySelectorAll('button[data-v]').forEach(b=>b.onclick=()=>{ctl.autoRotate=false;spin.classList.remove('on');go(b.dataset.v);});
const spin=document.getElementById('spin');spin.onclick=()=>{ctl.autoRotate=!ctl.autoRotate;ctl.autoRotateSpeed=.8;spin.classList.toggle('on',ctl.autoRotate);goal=null;};
function size(){const w=stage.clientWidth,h=stage.clientHeight;r.setSize(w,h,false);cam.aspect=w/h;cam.fov=w<h?60:40;cam.updateProjectionMatrix();}
addEventListener('resize',size);size();
setMode(qs.get('m')||'both');go(qs.get('cam')||'all',true);if(stage.clientWidth<stage.clientHeight&&!qs.get('cam'))cam.position.set(50,46,80);
r.domElement.addEventListener('pointerdown',()=>{goal=null;document.getElementById('hint').style.opacity=0;});setTimeout(()=>document.getElementById('hint').style.opacity=0,5000);
let n=0;(function loop(){if(SHOT&&n>6)return;requestAnimationFrame(loop);if(goal){cam.position.lerp(goal.p,.08);ctl.target.lerp(goal.t,.08);if(cam.position.distanceTo(goal.p)<.05)goal=null;}ctl.update();r.render(scene,cam);if(++n===4)window.__ready=true;})();
}catch(e){console.error(e);stage.style.display='none';document.getElementById('err').style.display='flex';window.__ready=true;}
