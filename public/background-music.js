/* Uploaded soundtrack; attempt autoplay on every visit, with a gesture fallback when blocked. No third-party player. */
(() => {
  'use strict';
  if (document.querySelector('#arirang-bgm')) return;
  const key = 'arirang-background-music-v1';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch {}
  const sessionKey = 'arirang-music-playback-v2';
  function playbackState() {
    try {
      const value=JSON.parse(sessionStorage.getItem(sessionKey)||'null');
      return value && value.recording==='0718-v2' && Number.isInteger(value.track) && value.track>=0 && value.track<15 && Number.isFinite(value.time) && value.time>=0 && value.time<=301 && Date.now()-value.updated<1800000 ? value : null;
    } catch { return null; }
  }
  const previous=playbackState();
  let enabled = previous ? previous.enabled!==false : true;
  if (/arirang-(market|local)(\.html)?$/.test(location.pathname)) document.body.classList.add('market-bgm-page');
  const volume = typeof saved.volume === 'number' && Number.isFinite(saved.volume)
    ? Math.max(0, Math.min(1, saved.volume)) : 0.25;
  const audio = document.createElement('audio');
  audio.id = 'arirang-bgm';
  const tracks = Array.from({length:15},(_,i)=>'/assets/music-0718-v2/part-'+String(i).padStart(2,'0')+'.m4a');
  let track=previous?.track||0,seekTo=previous?.time||0;
  audio.src = tracks[track];
  audio.loop = false;
  audio.preload = 'auto';
  audio.autoplay = false; // Explicit play() respects a stop carried from the previous page.
  audio.volume = volume;
  audio.hidden = true;
  document.body.append(audio);
  const controls = document.createElement('section');
  controls.className = 'bgm-controls';
  controls.setAttribute('aria-label', '배경음악 조절');
  controls.innerHTML = '<button type="button" class="bgm-toggle" aria-controls="arirang-bgm" aria-pressed="false"><span class="bgm-bars" aria-hidden="true"><i></i><i></i><i></i></span><span class="bgm-label">음악 켜기</span></button><label class="bgm-volume">음량<input type="range" min="0" max="100" step="1" aria-label="배경음악 음량"></label><span class="bgm-status" role="status" aria-live="polite"></span>';
  const toggle = controls.querySelector('button');
  const label = controls.querySelector('.bgm-label');
  const range = controls.querySelector('input');
  const status = controls.querySelector('.bgm-status');
  range.value = String(Math.round(volume * 100));
  let pending = false, attempt = 0, lastSaved = 0;
  function remember() {
    try { sessionStorage.setItem(sessionKey,JSON.stringify({recording:'0718-v2',track,time:seekTo||audio.currentTime||0,enabled,updated:Date.now()})); } catch {}
  }
  const buffer=document.createElement('audio');buffer.preload='auto';buffer.hidden=true;buffer.setAttribute('aria-hidden','true');document.body.append(buffer);
  function preloadNext(){const next=tracks[(track+1)%tracks.length];if(buffer.getAttribute('src')!==next)buffer.src=next;}
  audio.addEventListener('loadedmetadata',()=>{if(seekTo){try{audio.currentTime=Math.min(seekTo,Number.isFinite(audio.duration)?Math.max(0,audio.duration-.05):seekTo);seekTo=0;}catch{}}});
  audio.addEventListener('timeupdate',()=>{if(Date.now()-lastSaved>2000){lastSaved=Date.now();remember();}});
  function save() {
    remember();
    try { localStorage.setItem(key, JSON.stringify({ volume: audio.volume })); } catch {}
  }
  function render(message = '') {
    const playing = !audio.paused && enabled;
    toggle.setAttribute('aria-pressed', String(playing));
    toggle.setAttribute('aria-label', playing || pending ? '배경음악 정지' : '배경음악 재생');
    label.textContent = playing || pending ? '음악 정지' : '음악 재생';
    controls.dataset.playing = String(playing);
    status.textContent = message;
  }
  async function start() {
    if (!enabled || pending || document.hidden) return;
    pending = true;
    const thisAttempt = ++attempt;
    render();
    try {
      await audio.play();
      if (thisAttempt !== attempt || !enabled || document.hidden) {
        audio.pause();
        return;
      }
      remember();preloadNext();
      render();
    } catch (error) {
      if (thisAttempt !== attempt) return;
      render(error?.name === 'NotAllowedError'
        ? '자동재생 대기 · 화면을 클릭하거나 음악 재생을 눌러 주세요.'
        : '재생을 시작하지 못했습니다. 음악 재생을 다시 눌러 주세요.');
    } finally {
      if (thisAttempt === attempt) { pending = false; render(status.textContent); }
    }
  }
  function stop() {
    attempt++;
    pending = false;
    audio.pause();
    render();
  }
  toggle.addEventListener('click', () => {
    if (!audio.paused || pending) {
      enabled = false;
      stop();
      save();
    } else {
      enabled = true;
      save();
      void start();
    }
  });
  range.addEventListener('input', () => {
    audio.volume = Math.max(0, Math.min(1, Number(range.value) / 100));
    save();
  });
  audio.addEventListener('ended', () => {
    if(!enabled)return;
    track=(track+1)%tracks.length;seekTo=0;audio.src=tracks[track];remember();
    void start();
  });
  audio.addEventListener('play', () => render());
  audio.addEventListener('pause', () => render());
  audio.addEventListener('error', () => {
    pending = false;
    render('음악을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
  });
  function gesture(event) {
    if (!audio.paused || !enabled || controls.contains(event.target)) return;
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
    if (event.target.closest?.('input,textarea,select,[contenteditable]')) return;
    void start();
  }
  document.addEventListener('pointerup', gesture, { passive: true });
  document.addEventListener('keydown', gesture);
  // Do not forcibly pause when the tab loses visibility: mobile systems may manage audio themselves.
  document.addEventListener('visibilitychange', () => {
    remember();
    if(!document.hidden && enabled && audio.paused)void start();
  });
  window.addEventListener('pagehide', () => { remember();stop(); });
  window.addEventListener('pageshow', event => {
    if(!event.persisted)return;
    const state=playbackState();
    if(state){enabled=state.enabled!==false;seekTo=state.time;if(track!==state.track){track=state.track;audio.src=tracks[track];}else if(audio.readyState>=1){audio.currentTime=seekTo;seekTo=0;}}
    if(enabled)void start();else stop();
  });
  // Dialog top layers make background controls inert. Move only the controls, never the playing audio.
  function placeControls() {
    const gate = document.querySelector('dialog[open]');
    const target = gate || document.body;
    if (controls.parentNode !== target) target.append(controls);
  }
  new MutationObserver(placeControls).observe(document.body, { childList: true, subtree:true, attributes:true, attributeFilter:['open'] });
  placeControls();
  render();
  void start();
})();
