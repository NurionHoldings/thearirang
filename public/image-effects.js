(()=>{
const dialog=document.getElementById('photo-dialog'),large=document.getElementById('large-photo');
if(!dialog||!large)return;
const crop=document.createElement('div');crop.className='enlarged-concept';crop.hidden=true;dialog.append(crop);
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const observer='IntersectionObserver' in window?new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('image-visible');observer.unobserve(e.target)}}),{threshold:.08}):null;
function prepare(){document.querySelectorAll('main img:not(#large-photo),.concept').forEach(el=>{if(el.dataset.imageReady)return;el.dataset.imageReady='true';if(!el.closest('button')){el.classList.add('image-expandable');el.tabIndex=0;el.setAttribute('role','button');el.setAttribute('aria-label',(el.alt||el.getAttribute('aria-label')||'공간 이미지')+' · 확대 보기')};if(!reduced.matches&&observer){el.classList.add('image-reveal');observer.observe(el)}})}
function open(el){if(el.classList.contains('concept')){const style=getComputedStyle(el);large.hidden=true;crop.hidden=false;crop.style.backgroundImage=style.backgroundImage;crop.style.backgroundSize=style.backgroundSize;crop.style.backgroundPosition=style.backgroundPosition;crop.setAttribute('role','img');crop.setAttribute('aria-label',el.getAttribute('aria-label')||'공사 후 예상도 확대')}else{crop.hidden=true;large.hidden=false;large.src=el.currentSrc||el.src;large.alt=el.alt||'사진 확대'}if(!dialog.open)dialog.showModal()}
document.addEventListener('click',e=>{const el=e.target.closest('main img,.concept');if(el)open(el)});
document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('.image-expandable')){e.preventDefault();open(e.target)}});
dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close()});dialog.addEventListener('close',()=>{large.hidden=false;crop.hidden=true});
new MutationObserver(prepare).observe(document.getElementById('detail'),{childList:true,subtree:true});prepare();
reduced.addEventListener('change',e=>{if(e.matches)document.querySelectorAll('.image-reveal').forEach(el=>el.classList.add('image-visible'))});
})();
