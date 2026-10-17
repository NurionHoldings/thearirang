import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync('public/entry-experience.js','utf8');
function setup(path='/',hash='',search='',reduce=false){
 let gate,clickHandler;const timers=new Map();let seq=0;const events={};const positions={};const button={getBoundingClientRect:()=>({left:100,top:200,width:40,height:40}),style:{setProperty(k,v){positions[k]=v}},appendChild(){},focus(){},addEventListener(type,fn){events[type]=fn}};const video={pause(){},play:()=>Promise.resolve(),addEventListener(type,fn){events[type]=fn}};
 const document={activeElement:null,body:{append(g){gate=g}},querySelector:()=>null,addEventListener(type,fn){if(type==='click')clickHandler=fn},createElement(){return {style:{setProperty(){}},classList:{add(){}},setAttribute(){},querySelector(s){return s==='video'?(this.innerHTML.includes('<video')?video:null):button},querySelectorAll:()=>[button],addEventListener(type,fn){events[type]=fn},showModal(){this.open=true},close(){this.open=false},remove(){this.removed=true}}}};
 const window={};vm.runInNewContext(source,{document,window,location:{pathname:path,hash,search},URLSearchParams,matchMedia:()=>({matches:reduce}),setTimeout(fn,ms){timers.set(++seq,{fn,ms});return seq},clearTimeout(id){timers.delete(id)}});
 return {positions,window,events,timers,gate:()=>gate,click:()=>clickHandler,flush(){for(const [id,t]of [...timers]){timers.delete(id);t.fn()}}};
}
test('brand entrance bypasses admin and authentication deep links',()=>{assert.ok(setup().gate()?.open);assert.equal(setup('/','','?owner=1').gate(),undefined);assert.equal(setup('/','#recovery_token=x').gate(),undefined);assert.equal(setup('/admin.html').gate(),undefined)});
test('film completion invokes destination once and removes modal',()=>{const s=setup('/admin.html');let calls=0;s.window.ARIRANG_ENTRY.arkaon(()=>calls++);assert.match(s.gate().innerHTML,/arkaon-entry-v17.mp4/);s.events.ended();s.events.click();s.flush();assert.equal(calls,1);assert.equal(s.gate().removed,true);assert.equal(s.timers.size,0)});
test('reduced motion immediately releases film destination',()=>{const s=setup('/admin.html','','',true);let calls=0;s.window.ARIRANG_ENTRY.arkaon(()=>calls++);s.flush();assert.equal(calls,1)});
test('film playback error still releases requested workspace',()=>{const s=setup('/admin.html');let calls=0;s.window.ARIRANG_ENTRY.arkaon(()=>calls++);s.events.error();s.flush();assert.equal(calls,1)});

test('letter launch computes origin offsets from logo and final title position',()=>{const s=setup();assert.equal(s.positions['--letter-x'],'0px');assert.equal(s.positions['--letter-y'],'0px');assert.equal(s.positions['--letter-delay'],'0.6s');});

test('home opens entrance synchronously before any homepage markup can be parsed',()=>{const html=readFileSync('public/index.html','utf8');assert.match(html,/<body><script src="entry-experience.js"><\/script>/);assert.ok(html.indexOf('<script src="entry-experience.js">')<html.indexOf('<header>'));assert.doesNotMatch(html,/<script defer src="entry-experience.js">/);assert.match(html,/rel="preload" as="image" href="\/assets\/arirang-symbol.png"/);});
