const {chromium}=require('playwright');
const fs=require('fs'),http=require('http'),path=require('path'),assert=require('assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.MUSIC_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--autoplay-policy=no-user-gesture-required']});
 for(const [repo,music,css,audio,control,toggle,target] of [
 ['Clearance-sale','js/background-music.js','assets/background-music.css','#backgroundMusic','.music-control','[data-music-toggle]','live.html'],
 ['thearirang','background-music.js','background-music.css','#arirang-bgm','.bgm-controls','.bgm-toggle','arirang-market.html']]){
 const root=path.resolve(__dirname,'..','dist');
 if (!fs.existsSync(path.join(root,music))) continue;
 const server=http.createServer((req,res)=>{let p=path.join(root,new URL(req.url,'http://x').pathname);if(p.endsWith('/'))p+='index.html';if(!fs.existsSync(p)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.html':'text/html','.css':'text/css','.mp3':'audio/mpeg','.m4a':'audio/mp4'})[path.extname(p)]||'application/octet-stream');res.setHeader('X-Frame-Options','SAMEORIGIN');const size=fs.statSync(p).size;res.setHeader('Accept-Ranges','bytes');const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);if(range){const start=Number(range[1]),end=Math.min(range[2]?Number(range[2]):size-1,size-1);res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${size}`,'Content-Length':end-start+1});fs.createReadStream(p,{start,end}).pipe(res);}else{res.setHeader('Content-Length',size);fs.createReadStream(p).pipe(res);}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 const context=await browser.newContext({viewport:{width:390,height:900},reducedMotion:'reduce'});
 // Mock media decoding only: count pause calls and keep the same real DOM element
 // while the real pages, links, iframe documents and browser history execute.
 if (!process.env.MUSIC_REAL_AUDIO) await context.addInitScript(()=>{sessionStorage.setItem('dapanda-intro-seen-v4','1');const states=new WeakMap();Object.defineProperty(HTMLMediaElement.prototype,'paused',{get(){return states.get(this)??true}});HTMLMediaElement.prototype.play=function(){states.set(this,false);this.dispatchEvent(new Event('playing'));this.dispatchEvent(new Event('play'));return Promise.resolve()};HTMLMediaElement.prototype.pause=function(){states.set(this,true);this.dataset.pauseCalls=String(Number(this.dataset.pauseCalls||0)+1);this.dispatchEvent(new Event('pause'));};});
 if (process.env.MUSIC_REAL_AUDIO) await context.addInitScript(()=>sessionStorage.setItem('dapanda-intro-seen-v4','1'));
 const p=await context.newPage(); const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(origin);await p.locator(control+' .music-launcher').waitFor();
 await p.evaluate(()=>{document.querySelectorAll('dialog[open]').forEach(d=>d.close());});
 assert.equal(await p.locator(control+' '+toggle).first().isVisible(),false);
 await p.locator(control+' .music-launcher').click();assert(await p.locator(control+' '+toggle).first().isVisible());
 await p.keyboard.press('Escape');assert.equal(await p.locator(control+' '+toggle).first().isVisible(),false);
 if (process.env.MUSIC_REAL_AUDIO) {await p.waitForFunction(sel=>document.querySelector(sel)?.currentTime>0,audio);await p.locator(audio).evaluate(a=>a.addEventListener('pause',()=>a.dataset.pauseCalls=String(Number(a.dataset.pauseCalls||0)+1)));}
 await p.evaluate(sel=>{window.originalMusic=document.querySelector(sel);window.originalMusic.currentTime=42;},audio);
 // Use actual page links; no navigation APIs are mocked.
 await p.locator('a[href="'+(repo==='Clearance-sale'?target:'/'+target)+'"]').first().click();
 const f=p.frameLocator('#music-content-frame');await f.locator(control+' .music-launcher').waitFor();
 assert.equal(await p.evaluate(sel=>window.originalMusic===document.querySelector(sel),audio),true);
 assert.equal(await p.locator(audio).evaluate(a=>a.paused),false);
 if(process.env.MUSIC_REAL_AUDIO)await p.waitForFunction(sel=>document.querySelector(sel).currentTime>42,audio);
 assert.equal(await p.locator(audio).evaluate(a=>Number(a.dataset.pauseCalls||0)),0);
 assert.equal(await f.locator(audio).count(),repo==='Clearance-sale'?1:0); // static placeholder remains inert
 assert.equal(await f.locator(control+' '+toggle).first().isVisible(),false);
 await f.locator(control+' .music-launcher').click();await f.locator(control+' '+toggle).first().click();
 assert.equal(await p.locator(audio).evaluate(a=>a.paused),true);
 await p.goBack();await p.waitForFunction(()=>document.querySelector('#music-content-frame').contentWindow.location.pathname==='/');await p.frameLocator('#music-content-frame').locator(control+' .music-launcher').waitFor();
 assert.equal(await p.locator(audio).evaluate(a=>a.paused),true);
 assert.deepEqual(errors,[]);
 console.log(repo+': PASS compact launcher, Escape, real menu navigation retains audio node without pause, child controls, manual stop and Back. Page errors:',JSON.stringify(errors));
 await context.close();server.closeAllConnections();await new Promise(r=>server.close(r));
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
