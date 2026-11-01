/* Uploaded soundtrack; audio starts only after a visitor gesture. No third-party player. */
(() => {
  'use strict';
  if (document.querySelector('#arirang-bgm')) return;
  const key = 'arirang-background-music-v1';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch {}
  let enabled = saved.enabled !== false;
  const volume = typeof saved.volume === 'number' && Number.isFinite(saved.volume)
    ? Math.max(0, Math.min(1, saved.volume)) : 0.25;
  const audio = document.createElement('audio');
  audio.id = 'arirang-bgm';
  audio.src = '/assets/arirang-background-0825-v1.mp3';
  audio.loop = true;
  audio.preload = 'none';
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
  let pending = false, started = false, resume = false, attempt = 0;
  function save() {
    try { localStorage.setItem(key, JSON.stringify({ enabled, volume: audio.volume })); } catch {}
  }
  function render(message = '') {
    const playing = !audio.paused && enabled;
    toggle.setAttribute('aria-pressed', String(playing));
    toggle.setAttribute('aria-label', playing ? '배경음악 끄기' : '배경음악 켜기');
    label.textContent = playing ? '음악 끄기' : pending ? '음악 준비 중' : '음악 켜기';
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
      started = true;
      render();
    } catch (error) {
      if (thisAttempt !== attempt) return;
      render(error?.name === 'NotAllowedError'
        ? '음악 켜기를 눌러 재생해 주세요.'
        : '재생을 시작하지 못했습니다. 음악 켜기를 다시 눌러 주세요.');
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
      resume = false;
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
  audio.addEventListener('play', () => render());
  audio.addEventListener('pause', () => render());
  audio.addEventListener('error', () => {
    pending = false;
    render('음악을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.');
  });
  function gesture(event) {
    if (started || !enabled || controls.contains(event.target)) return;
    if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
    if (event.target.closest?.('input,textarea,select,[contenteditable]')) return;
    void start();
  }
  document.addEventListener('pointerup', gesture, { passive: true });
  document.addEventListener('keydown', gesture);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { resume = enabled && (!audio.paused || pending); stop(); }
    else if (resume && enabled) { resume = false; void start(); }
  });
  window.addEventListener('pagehide', () => { resume = enabled && (!audio.paused || pending); stop(); });
  window.addEventListener('pageshow', event => { if (event.persisted && resume && enabled) void start(); });
  // Dialog top layers make background controls inert. Move only the controls, never the playing audio.
  function placeControls() {
    const gate = document.querySelector('dialog.entry-gate[open]');
    const target = gate || document.body;
    if (controls.parentNode !== target) target.append(controls);
  }
  new MutationObserver(placeControls).observe(document.body, { childList: true });
  placeControls();
  render();
})();
