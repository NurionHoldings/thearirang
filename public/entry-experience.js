/* Brand entrance and local ARKAON film; no authentication or external navigation. */
(()=>{'use strict';
let active=null;
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
function openGate(kind,after){
 if(active)return;const previous=document.activeElement,gate=document.createElement('dialog');gate.className='entry-gate';gate.setAttribute('aria-label',kind==='film'?'아르카온 진입 영상':'더 아리랑 브랜드 진입');
 gate.innerHTML=kind==='film'?'<video class="entry-video" muted playsinline preload="auto" aria-label="아르카온 원본 진입 영상"><source src="/assets/arkaon-entry-v17.mp4" type="video/mp4"></video><p class="entry-video-caption" role="status">ARKAON · 관리자 업무 지원으로 연결합니다</p><button type="button" class="entry-skip">건너뛰기 →</button>':'<div class="entry-scene"><div class="entry-stars" aria-hidden="true"></div><span class="entry-top">DAEJEON · SINCE ARIRANG</span><button type="button" class="entry-skip">건너뛰기 →</button><div class="entry-content"><div class="entry-emblem"><span class="entry-logo-orbit"><img src="/assets/arirang-symbol.png" alt="더 아리랑 로고" width="366" height="338"></span><span class="entry-wing-light entry-wing-blue" aria-hidden="true"></span><span class="entry-wing-light entry-wing-green" aria-hidden="true"></span><span class="entry-wing-light entry-wing-red" aria-hidden="true"></span></div><h1 class="entry-letter-title" data-entry-title="더아리랑" aria-label="더아리랑"><span aria-hidden="true" data-entry-letter="0">더</span><span aria-hidden="true" data-entry-letter="1">아</span><span aria-hidden="true" data-entry-letter="2">리</span><span aria-hidden="true" data-entry-letter="3">랑</span></h1><p class="entry-english">THE ARIRANG</p><p class="entry-story">어제의 추억이, 내일의 행복이 되는 곳</p><button type="button" class="entry-enter">더 아리랑 만나기 <span aria-hidden="true">↗</span></button></div><span class="entry-bottom">사람을 잇고 · 세대를 품고 · 지역과 함께합니다</span></div>';
 document.body.append(gate);active=gate;let done=false,timer,watchdog;const video=gate.querySelector('video');
 const finish=()=>{if(done)return;done=true;clearTimeout(timer);clearTimeout(watchdog);video?.pause();gate.classList.add('entry-leaving');setTimeout(()=>{gate.close();gate.remove();active=null;if(previous?.isConnected)previous.focus();after?.();},reduced()?0:700)};
 function launchLetters(){
  if(kind==='film'||reduced())return;
  const emblem=gate.querySelector('.entry-emblem'),title=gate.querySelector('.entry-letter-title');if(!emblem||!title)return;
  const logo=emblem.getBoundingClientRect(),cx=logo.left+logo.width/2,cy=logo.top+logo.height/2;
  const origins=[[cx,cy],[cx,logo.top+logo.height*.06],[logo.left+logo.width*.9,cy],[logo.left+logo.width*.18,logo.top+logo.height*.75]];
  const titleBox=title.getBoundingClientRect();
  gate.querySelectorAll('[data-entry-letter]').forEach((letter,i)=>{
   const box=letter.getBoundingClientRect(),x=origins[i][0]-box.left-box.width/2,y=origins[i][1]-box.top-box.height/2,delay=.6+i*.9;
   letter.style.setProperty('--letter-x',x+'px');letter.style.setProperty('--letter-y',y+'px');letter.style.setProperty('--letter-delay',delay+'s');letter.style.setProperty('--letter-glow-delay',(7.2+i*.5)+'s');letter.style.setProperty('--letter-angle',([0,-20,18,-16][i])+'deg');
   for(let n=1;n<=5;n++){
    const trail=document.createElement('span');trail.className='entry-flight-trail';trail.textContent=letter.textContent;trail.setAttribute('aria-hidden','true');
    const vars={'--letter-x':x+'px','--letter-y':y+'px','--letter-angle':([0,-20,18,-16][i])+'deg','--trail-delay':(delay+n*.085)+'s','--trail-opacity':String(.34-n*.05),left:(box.left-titleBox.left)+'px',top:(box.top-titleBox.top)+'px',width:box.width+'px',height:box.height+'px'};
    for(const [key,value]of Object.entries(vars))trail.style.setProperty(key,value);title.appendChild(trail);
   }
  });gate.classList.add('entry-letters-ready');
 }
 gate.querySelectorAll('button').forEach(b=>b.addEventListener('click',finish));gate.addEventListener('cancel',e=>{e.preventDefault();finish()});gate.showModal();gate.querySelector('button').focus();launchLetters();
 if(video){video.addEventListener('ended',finish,{once:true});video.addEventListener('error',finish,{once:true});watchdog=setTimeout(finish,22000);if(reduced()){finish();return}video.play().catch(finish)}
 else if(!reduced())timer=setTimeout(finish,16000);
}
window.ARIRANG_ENTRY={brand:()=>openGate('brand'),arkaon:after=>openGate('film',after)};
// Capture before existing tab handlers: release the original request only after the film.
let release=false;document.addEventListener('click',e=>{const button=e.target.closest('[data-tab="arkaon"],[data-arkaon-open],[data-ai]');if(!button||release)return;e.preventDefault();e.stopImmediatePropagation();openGate('film',()=>{if(button.matches('[data-arkaon-open]')){document.dispatchEvent(new Event('arirang:chat-open'));return}if(!button.isConnected)return;release=true;try{button.click()}finally{release=false}})},true);
const home=location.pathname==='/'||location.pathname.endsWith('/index.html');const params=new URLSearchParams(location.search);if(home&&!location.hash&&!params.has('owner'))openGate('brand');
const footer=document.querySelector('footer');if(footer&&home){const replay=document.createElement('button');replay.type='button';replay.className='entry-replay';replay.textContent='더 아리랑 진입화면 다시 보기';replay.onclick=()=>openGate('brand');footer.append(replay)}
})();
