const __zdata = await (await fetch('data.json?v=1127')).text();
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
const stage=document.getElementById('stage');
try{
const M=JSON.parse(__zdata);
const COL={'A-FLOR':0xf2dc9a,'A-FLOR-TILE':0x8fb4c4,'A-FLOR-CF':0xa9c98a,'A-WALL-RC':0x8a8f94,'A-WALL-PT':0xeeeeea,'A-DOOR':0x9a5a2a,'A-GLAZ':0x66d6e0,'A-EQPM':0xe58a3a};
const scene=new THREE.Scene(); scene.background=new THREE.Color(0xf3f8f9);
const renderer=new THREE.WebGLRenderer({antialias:true}); renderer.setPixelRatio(Math.min(devicePixelRatio,2)); stage.prepend(renderer.domElement);
const cam=new THREE.PerspectiveCamera(40,1,100,100000); cam.up.set(0,0,1);
const ctl=new OrbitControls(cam,renderer.domElement); ctl.enableDamping=true; ctl.maxPolarAngle=Math.PI*0.495; ctl.minDistance=2500; ctl.maxDistance=40000;
const C=new THREE.Vector3(5100,3450,900); ctl.target.copy(C);
scene.add(new THREE.HemisphereLight(0xffffff,0x9aa7ad,1.15));
const sun=new THREE.DirectionalLight(0xffffff,1.3); sun.position.set(-6000,-9000,14000); scene.add(sun);
for(const [layer,faces] of Object.entries(M.layers)){
  const pos=[];
  for(const f of faces){ const [a,b,c,d]=f; pos.push(...a,...b,...c, ...a,...c,...d); }
  const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3)); g.computeVertexNormals();
  const glass=layer==='A-GLAZ';
  const mat=new THREE.MeshStandardMaterial({color:COL[layer]||0xcccccc,roughness:.85,metalness:0,side:THREE.DoubleSide,flatShading:true,transparent:glass,opacity:glass?.45:1,polygonOffset:true,polygonOffsetFactor:1,polygonOffsetUnits:1});
  scene.add(new THREE.Mesh(g,mat));
  if(!glass){ const e=new THREE.LineSegments(new THREE.EdgesGeometry(g,20),new THREE.LineBasicMaterial({color:0x2b3a40,transparent:true,opacity:.35})); scene.add(e); }
}
function label(t){
  const s=t.s; const c=document.createElement('canvas'); const x=c.getContext('2d'); const fs=64;
  x.font='700 '+fs+'px "Hiragino Sans","Noto Sans JP","Yu Gothic",Meiryo,sans-serif'; const w=Math.ceil(x.measureText(s).width)+40; c.width=w; c.height=fs+36;
  x.font='700 '+fs+'px "Hiragino Sans","Noto Sans JP","Yu Gothic",Meiryo,sans-serif'; x.fillStyle='rgba(255,255,255,.88)'; x.beginPath(); x.roundRect(0,0,w,c.height,18); x.fill();
  x.fillStyle='#16323a'; x.textBaseline='middle'; x.textAlign='center'; x.fillText(s,w/2,c.height/2+2);
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(c),depthTest:false,transparent:true}));
  const k=Math.max(t.h,170)*2.1; sp.scale.set(k*w/c.height,k,1); sp.position.set(t.x,t.y,1300); sp.renderOrder=10; return sp;
}
M.texts.filter(t=>t.y>-100).forEach(t=>scene.add(label(t)));
const VIEWS={iso:[-1500,-6500,14500],top:[5100,3440,19500],'in':[1500,-1500,2600]};
function setView(k){ const p=VIEWS[k]; const t=(k==='in'?new THREE.Vector3(5600,3800,1100):C); const f=(k!=='in' && stage.clientWidth<stage.clientHeight)?1.35:1; cam.position.set(t.x+(p[0]-t.x)*f,t.y+(p[1]-t.y)*f,t.z+(p[2]-t.z)*f); ctl.target.copy(k==='in'?new THREE.Vector3(5600,3800,1100):C); ctl.update(); document.querySelectorAll('[data-v]').forEach(b=>b.classList.toggle('on',b.dataset.v===k)); }
document.querySelectorAll('[data-v]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.v)));
const spin=document.getElementById('spin'); spin.addEventListener('click',()=>{ ctl.autoRotate=!ctl.autoRotate; spin.classList.toggle('on',ctl.autoRotate); });
ctl.autoRotateSpeed=1.2;
const hint=document.getElementById('hint'); ctl.addEventListener('start',()=>{ hint.style.opacity=0; });
function size(){ const w=stage.clientWidth,h=stage.clientHeight; renderer.setSize(w,h,false); cam.aspect=w/h; cam.fov=w<h?58:40; cam.updateProjectionMatrix(); }
addEventListener('resize',size); size(); setView('iso');
window.__ready=true;
(function loop(){ ctl.update(); renderer.render(scene,cam); requestAnimationFrame(loop); })();
}catch(e){ document.getElementById('err').style.display='flex'; console.error(e); }
