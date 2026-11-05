import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {JSDOM,ResourceLoader,VirtualConsole} from 'jsdom';
const root=resolve('public/engine-viewer');
const html=readFileSync(root+'/index.html','utf8');
const built=resolve('dist/engine-viewer');
for(const file of ['vendor/three.min.js','vendor/OrbitControls.js','vendor/GLTFLoader.js',...Array.from(html.matchAll(/file: '([^']+\.glb)'/g),m=>'models/'+m[1])]){
 assert.ok(existsSync(built+'/'+file),`build missing ${file}`);
 assert.deepEqual(readFileSync(built+'/'+file),readFileSync(root+'/'+file));
 if(file.endsWith('.glb')){const b=readFileSync(built+'/'+file);assert.equal(b.toString('ascii',0,4),'glTF');assert.equal(b.readUInt32LE(4),2);assert.equal(b.readUInt32LE(8),b.length);JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12)));}
}
class Resources extends ResourceLoader{fetch(url){const p=resolve(root,new URL(url).pathname.replace('/engine-viewer/',''));return Promise.resolve(readFileSync(p));}}
const server=createServer((req,res)=>{const p=resolve(root,new URL(req.url,'http://localhost').pathname.replace('/engine-viewer/',''));if(existsSync(p)){res.end(readFileSync(p));}else{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));server.unref();
const origin=`http://127.0.0.1:${server.address().port}`;
for(const fail of [false,true]){
 const errors=[],messages=[],loaded=[];
 const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 // Renderer is the only GPU dependency substituted; GLTF parsing, geometry, assembly and bridge run unchanged.
 const patched=html.replace("const stageEl = document.getElementById('stage');",`THREE.WebGLRenderer = class { constructor(){${fail?"throw new Error('no GPU');":"this.domElement=document.createElement('canvas');"}} setPixelRatio(){} setSize(){} render(scene){window.__meshCount=0;scene.traverse(o=>{if(o.isMesh)window.__meshCount++})} };\nconst stageEl = document.getElementById('stage');`);
 const real=new JSDOM(patched,{url:origin+'/engine-viewer/index.html?embed=1',runScripts:'dangerously',resources:new Resources(),pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){w.matchMedia=()=>({matches:false,addEventListener(){}});w.TextDecoder=TextDecoder;w.TextEncoder=TextEncoder;w.Request=Request;w.Headers=Headers;w.Response=Response;w.fetch=async url=>{const file=new URL(typeof url==='string'?url:url.url,'http://localhost/engine-viewer/').pathname;loaded.push(file);return new Response(readFileSync(resolve(root,file.replace('/engine-viewer/',''))));};w.addEventListener('message',e=>messages.push(e.data));}});
 await new Promise(r=>setTimeout(r,1000));
 if(fail){assert.ok(messages.some(m=>m.type==='dx:error'&&m.message.includes('WebGL')));assert.ok(!errors.some(e=>e.includes('running')));console.log('PASS: WebGL failure is reported without cascading startup errors');}
 else{const ready=messages.find(m=>m.type==='dx:ready');assert.ok(ready,JSON.stringify({errors,messages,loaded}));assert.ok(ready.source.includes('GLB 5종'),JSON.stringify({ready,loaded,errors}));assert.equal(ready.parts.length,5);assert.ok(real.window.__meshCount>0);console.log('PASS: 5 actual GLBs parsed and assembled, ready bridge and render loop executed');}
 real.window.close();
}
console.log('PASS: build contains byte-identical vendor files and 5 valid GLB models');

server.close();
