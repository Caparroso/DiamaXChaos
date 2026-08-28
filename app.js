(() => {
  'use strict';

  const data = window.DIAMA_DATA;
  const STORAGE_KEY = 'diama-qro-profile-v1';
  const views = ['intro', 'register', 'access', 'media', 'visual'];
  const mobileBladeMeta = {
    intro: ['00', 'PORTADA'], register: ['01', 'MI BOLETO'],
    access: ['02', 'UBICACIÓN'], media: ['03', 'DIAMA PLAYER'],
    visual: ['04', 'ARTE VISUAL']
  };
  const lockedViews = new Set();
  const state = {
    view: 'intro',
    profile: readProfile(),
    musicIndex: -1,
    visualIndex: 0,
    playerTab: 'artists',
    playerPosition: 0,
    playerDuration: 0,
    playerPlaying: false
  };
  let soundCloudWidget = null;
  let playerMuted = false;
  let soundCloudSourceIndex = -1;
  const ambient = {
    bytesPromise: null,
    context: null,
    gain: null,
    source: null,
    fallback: null,
    started: false,
    suppressed: false,
    entering: false
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function preloadAmbient() {
    if (ambient.bytesPromise || !data.ambientAudio) return ambient.bytesPromise;
    ambient.bytesPromise = fetch(data.ambientAudio, { cache: 'force-cache' }).then((response) => {
      if (!response.ok) throw new Error(`Ambient ${response.status}`);
      return response.arrayBuffer();
    });
    return ambient.bytesPromise;
  }

  function fadeAmbient(target, seconds = .45) {
    if (!ambient.context || !ambient.gain || !ambient.started) return;
    const now = ambient.context.currentTime;
    const gain = ambient.gain.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(target, now + seconds);
  }

  function setAmbientSuppressed(suppressed) {
    ambient.suppressed = suppressed;
    if (ambient.fallback) {
      ambient.fallback.volume = suppressed ? 0 : .62;
      return;
    }
    if (!ambient.started) return;
    if (!suppressed && ambient.context.state === 'suspended') ambient.context.resume().catch(() => {});
    fadeAmbient(suppressed ? 0 : .62, suppressed ? .22 : .52);
  }

  async function startAmbient() {
    if (ambient.started || !data.ambientAudio) return;
    const startFallback = async () => {
      ambient.fallback = new Audio(data.ambientAudio);
      ambient.fallback.loop = true;
      ambient.fallback.preload = 'auto';
      ambient.fallback.volume = ambient.suppressed ? 0 : .62;
      await ambient.fallback.play();
      ambient.started = true;
    };
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return startFallback();

    try {
      ambient.context = new AudioContext();
      const resume = ambient.context.resume();
      const bytes = await preloadAmbient();
      const buffer = await ambient.context.decodeAudioData(bytes.slice(0));
      ambient.gain = ambient.context.createGain();
      ambient.gain.gain.value = 0;
      ambient.gain.connect(ambient.context.destination);
      ambient.source = ambient.context.createBufferSource();
      ambient.source.buffer = buffer;
      ambient.source.loop = true;
      ambient.source.loopStart = 0;
      ambient.source.loopEnd = buffer.duration;
      ambient.source.connect(ambient.gain);
      ambient.source.start(0);
      ambient.started = true;
      await resume;
      setAmbientSuppressed(state.playerPlaying);
    } catch {
      ambient.started = false;
      if (ambient.context) ambient.context.close().catch(() => {});
      ambient.context = null;
      ambient.gain = null;
      ambient.source = null;
      await startFallback();
    }
  }

  async function enterExperience() {
    const boot = $('#boot');
    if (!boot || ambient.entering || boot.classList.contains('is-done')) return;
    ambient.entering = true;
    boot.classList.add('is-entering');
    const label = $('#bootEnter');
    if (label) label.textContent = 'ENTRANDO';
    try { await startAmbient(); }
    catch { /* La invitación sigue disponible aunque el navegador rechace el audio. */ }
    boot.classList.add('is-done');
    boot.setAttribute('aria-hidden', 'true');
    boot.tabIndex = -1;
  }

  function readProfile() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null; }
    catch { return null; }
  }

  function escapeHTML(value = '') {
    return String(value).replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;'
    })[char]);
  }

  function normalizeInstagram(value) {
    return value.trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/\/$/, '');
  }

  function makeFolio(name, instagram) {
    const source = `${name}|${instagram}|${Date.now()}`;
    let hash = 0;
    for (let i = 0; i < source.length; i += 1) hash = ((hash << 5) - hash + source.charCodeAt(i)) | 0;
    return `DQ-${Math.abs(hash).toString(36).toUpperCase().padStart(6, '0').slice(0, 6)}`;
  }

  function clickTone(frequency = 420) {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, context.currentTime);
      gain.gain.setValueAtTime(.025, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .055);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + .06);
      oscillator.addEventListener('ended', () => context.close());
    } catch { /* Navegadores restrictivos pueden omitir el sonido. */ }
  }

  let toastTimer;
  function toast(message) {
    const element = $('#toast');
    element.textContent = message;
    element.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => element.classList.remove('is-visible'), 2600);
  }

  function navigate(target, options = {}) {
    if (!views.includes(target)) return;
    if (lockedViews.has(target) && !state.profile) {
      toast('GENERA TU BOLETO PARA DESBLOQUEAR ESTA SECCIÓN');
      clickTone(180);
      target = 'register';
    } else {
      clickTone(options.silent ? 1 : 450);
    }
    state.view = target;
    $$('.view').forEach((view) => view.classList.toggle('is-active', view.dataset.view === target));
    $$('.blade').forEach((blade) => blade.classList.toggle('is-active', blade.dataset.viewTarget === target));
    updateMobileBlades();
    const active = $(`.view[data-view="${target}"]`);
    if (active) active.scrollTop = 0;
    history.replaceState(null, '', `#${target}`);
  }

  function adjacentView(direction) {
    const currentIndex = Math.max(0, views.indexOf(state.view));
    return views[(currentIndex + direction + views.length) % views.length];
  }

  function updateMobileBlades() {
    Object.entries({ left: adjacentView(-1), right: adjacentView(1) }).forEach(([side, target]) => {
      const button = $(`[data-mobile-edge="${side}"]`);
      if (!button) return;
      button.dataset.viewTarget = target;
      $('span', button).textContent = mobileBladeMeta[target][0];
      $('b', button).textContent = mobileBladeMeta[target][1];
      button.setAttribute('aria-label', `${side === 'left' ? 'Anterior' : 'Siguiente'}: ${mobileBladeMeta[target][1]}`);
    });
  }

  function installViewMatrix() {
    const glyphs = [
      'ディアマ赤い夜文化信号五九光の中で踊れ混沌安息日',
      '音楽芸術共同体赤い信号秘密の場所ディアマ五九',
      'DIAMA.05.09.QUERÉTARO.DIAMA.CHAOS.SABBATI.',
      '光の中で踊れ赤い夜文化信号音楽芸術共同体',
      '混沌安息日ディアマ秘密の場所五九赤い信号',
      'QUERÉTARO.05.09.DIAMA.DIAMA.DIAMA.',
      '文化信号音楽芸術共同体光の中で踊れ赤い夜',
      'ディアマ混沌安息日秘密の場所赤い信号五九'
    ];
    $$('.view').forEach((view, viewIndex) => {
      if ($('.view-matrix', view)) return;
      const matrix = document.createElement('div');
      matrix.className = 'view-matrix';
      matrix.setAttribute('aria-hidden', 'true');
      matrix.innerHTML = glyphs.map((glyph, index) => `<span style="--matrix-i:${index + viewIndex}">${`${glyph}・`.repeat(5)}</span>`).join('');
      view.prepend(matrix);
    });
  }

  function formatTime(milliseconds = 0) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
  }

  function artistImage(artist, className = '') {
    return artist.image
      ? `<div class="artist-image ${className}"><img src="${artist.image}" alt="Foto de ${escapeHTML(artist.name)}"></div>`
      : `<div class="artist-image ${className}"><div class="pending-track">FOTO PENDIENTE</div></div>`;
  }

  function renderNowPlaying(artist) {
    const sourceUrl = artist.trackUrl || artist.profile;
    return `<article class="now-playing player-panel-now">
      <div class="now-artwork">
        ${artistImage(artist)}
        <span class="now-index">${String(state.musicIndex + 1).padStart(2, '0')} / ${String(data.musicArtists.length).padStart(2, '0')}</span>
      </div>
      <div class="track-details">
        <span>NOW PLAYING</span>
        <h3>${escapeHTML(artist.name)}</h3>
        <h4>${escapeHTML(artist.title || artist.role)}</h4>
        ${artist.soundcloud ? `
          <div class="track-state"><i></i><span>TRACK DISPONIBLE</span></div>
          <a class="source-credit" href="${sourceUrl}" target="_blank" rel="noopener">FUENTE DE AUDIO · SOUNDCLOUD ↗</a>
        ` : '<div class="pending-track track-pending">MÚSICA PENDIENTE</div>'}
      </div>
    </article>`;
  }

  function renderArtists() {
    return `<section class="player-artists-panel">
      <header class="panel-heading"><span>DIAMA ARTISTS</span><b>${data.musicArtists.length} ARTISTAS</b></header>
      <div class="artist-card-grid">${data.musicArtists.map((artist, index) => `
        <button class="artist-card${artist.image ? ' has-image' : ''}${state.musicIndex === index ? ' is-active' : ''}" data-music-index="${index}">
          ${artist.image ? `<img src="${artist.image}" alt="Foto de ${escapeHTML(artist.name)}">` : '<i class="artist-placeholder">D.</i>'}
          <span>${String(index + 1).padStart(2, '0')}</span>
          <div><b>${escapeHTML(artist.name)}</b><small>${escapeHTML(artist.role)}</small></div>
        </button>`).join('')}</div>
    </section>`;
  }

  function renderMedia({ reloadAudio = false } = {}) {
    const artist = state.musicIndex >= 0 ? data.musicArtists[state.musicIndex] : null;
    if (!artist && state.playerTab === 'now') state.playerTab = 'artists';
    $$('.player-tabs [data-player-tab]').forEach((button) => {
      const active = button.dataset.playerTab === state.playerTab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    const panels = { now: () => artist ? renderNowPlaying(artist) : renderArtists(), artists: renderArtists };
    $('#playerContent').innerHTML = panels[state.playerTab]();
    $('#playerTrackLabel').textContent = artist ? `${artist.name}${artist.title ? ` — ${artist.title}` : ''}` : 'ELIGE UN ARTISTA';
    updatePlayerProgress();
    if (artist && (reloadAudio || soundCloudSourceIndex !== state.musicIndex)) mountSoundCloud(artist);
    if (!artist && reloadAudio) mountSoundCloud(null);
  }

  function mountSoundCloud(artist) {
    const mount = $('#soundcloudMount');
    soundCloudWidget = null;
    soundCloudSourceIndex = state.musicIndex;
    state.playerPosition = 0;
    state.playerDuration = 0;
    state.playerPlaying = false;
    setAmbientSuppressed(false);
    updatePlayButton();
    updatePlayerProgress();
    if (!artist || !artist.soundcloud) { mount.innerHTML = ''; return; }
    mount.innerHTML = `<iframe id="soundcloudPlayer" title="Fuente de audio de ${escapeHTML(artist.name)}" allow="autoplay; encrypted-media" src="${artist.soundcloud}"></iframe>`;
    initSoundCloudWidget();
  }

  function initSoundCloudWidget() {
    const iframe = $('#soundcloudPlayer');
    if (!iframe || !window.SC || !window.SC.Widget) return;
    soundCloudWidget = window.SC.Widget(iframe);
    const events = window.SC.Widget.Events;
    soundCloudWidget.bind(events.READY, () => {
      soundCloudWidget.getDuration((duration) => {
        state.playerDuration = duration || 0;
        updatePlayerProgress();
      });
    });
    soundCloudWidget.bind(events.PLAY, () => {
      state.playerPlaying = true;
      setAmbientSuppressed(true);
      updatePlayButton();
    });
    soundCloudWidget.bind(events.PAUSE, () => {
      state.playerPlaying = false;
      setAmbientSuppressed(false);
      updatePlayButton();
    });
    soundCloudWidget.bind(events.FINISH, () => {
      state.playerPlaying = false;
      setAmbientSuppressed(false);
      state.playerPosition = state.playerDuration;
      updatePlayButton();
      updatePlayerProgress();
    });
    soundCloudWidget.bind(events.PLAY_PROGRESS, (event) => {
      state.playerPosition = event.currentPosition || 0;
      if (!state.playerDuration && event.relativePosition) {
        soundCloudWidget.getDuration((duration) => { state.playerDuration = duration || 0; updatePlayerProgress(); });
      } else updatePlayerProgress(event.relativePosition);
    });
  }

  window.DIAMA_SOUND_CLOUD_READY = () => {
    const artist = state.musicIndex >= 0 ? data.musicArtists[state.musicIndex] : null;
    if (!soundCloudWidget && artist && artist.soundcloud) initSoundCloudWidget();
  };

  function updatePlayButton() {
    const playButton = $('[data-player-action="play"]');
    if (playButton) {
      playButton.textContent = state.playerPlaying ? 'Ⅱ' : '▶';
      playButton.setAttribute('aria-label', state.playerPlaying ? 'Pausar' : 'Reproducir');
    }
  }

  function updatePlayerProgress(relativePosition) {
    const relative = relativePosition != null
      ? relativePosition
      : (state.playerDuration ? state.playerPosition / state.playerDuration : 0);
    const percent = `${Math.max(0, Math.min(100, relative * 100))}%`;
    const progress = $('#playerProgress');
    if (progress) progress.style.width = percent;
    const current = $('#playerCurrentTime');
    const duration = $('#playerDuration');
    if (current) current.textContent = formatTime(state.playerPosition);
    if (duration) duration.textContent = formatTime(state.playerDuration);
  }

  function selectMusic(index, openNow = true) {
    state.musicIndex = index;
    if (openNow) state.playerTab = 'now';
    renderMedia({ reloadAudio: true });
    clickTone(520);
  }

  function changeMusic(direction) {
    if (state.musicIndex < 0) { toast('ELIGE UN ARTISTA'); return; }
    let next = state.musicIndex;
    for (let step = 0; step < data.musicArtists.length; step += 1) {
      next = (next + direction + data.musicArtists.length) % data.musicArtists.length;
      if (data.musicArtists[next].soundcloud) break;
    }
    selectMusic(next, true);
  }

  function seekPlayer(element, clientX) {
    if (!soundCloudWidget) { toast('SELECCIONA UN TRACK DISPONIBLE'); return; }
    const bounds = element.getBoundingClientRect();
    const relative = Math.max(0, Math.min(1, (clientX - bounds.left) / bounds.width));
    soundCloudWidget.getDuration((duration) => {
      state.playerDuration = duration || state.playerDuration;
      state.playerPosition = state.playerDuration * relative;
      soundCloudWidget.seekTo(state.playerPosition);
      updatePlayerProgress(relative);
    });
  }

  function handlePlayerAction(action) {
    if (action === 'previous') return changeMusic(-1);
    if (action === 'next') return changeMusic(1);
    if (!soundCloudWidget) { toast('SELECCIONA UN SET DISPONIBLE'); return; }
    if (action === 'play') {
      soundCloudWidget.isPaused((paused) => paused ? soundCloudWidget.play() : soundCloudWidget.pause());
    }
    if (action === 'volume') {
      playerMuted = !playerMuted;
      soundCloudWidget.setVolume(playerMuted ? 0 : 100);
      const button = $('[data-player-action="volume"]');
      if (button) button.textContent = playerMuted ? 'MUTE' : 'VOL';
    }
  }

  function renderVisual() {
    $('#visualGrid').innerHTML = data.visualArtists.map((artist, index) => `
      <button class="visual-artist${artist.works.length ? ' has-work' : ''}${state.visualIndex === index ? ' is-active' : ''}" data-visual-index="${index}">
        ${artist.works.length ? `<img class="visual-thumb" src="${artist.works[0].image}" alt="">` : ''}
        <span>${String(artist.index).padStart(2, '0')}</span><b>${escapeHTML(artist.name)}</b><small>${artist.works.length || 0} OBRAS</small>
      </button>
    `).join('');
    if (state.visualIndex === null) return;
    const artist = data.visualArtists[state.visualIndex];
    const work = artist.works[0];
    $('#visualPreview').innerHTML = `
      <span>ARTISTA VISUAL ${String(artist.index).padStart(2, '0')}</span>
      <h3>${escapeHTML(artist.name)}</h3>
      ${work
        ? `<figure class="visual-art-frame"><img src="${work.image}" alt="${escapeHTML(work.alt)}"></figure><p>OBRA 01 / 01</p>`
        : '<div class="empty-art"><i></i></div><p>OBRAS PENDIENTES.</p>'}`;
  }

  function unlockExperience() {
    const registerLabel = $('[data-register-label]');
    if (registerLabel) registerLabel.textContent = 'MI BOLETO';
    $('#registrationForm').hidden = true;
    $('#ticketPanel').hidden = false;
    $('#ticketName').textContent = state.profile.name;
    $('#ticketInstagram').textContent = `@${state.profile.instagram}`;
    $('#ticketFolio').textContent = state.profile.folio;
  }

  async function submitRegistration(event) {
    event.preventDefault();
    const name = $('#guestName').value.trim();
    const instagram = normalizeInstagram($('#guestInstagram').value);
    const message = $('#formMessage');
    if (name.length < 2 || instagram.length < 2) {
      message.textContent = 'ESCRIBE TU NOMBRE Y TU USUARIO DE INSTAGRAM.';
      clickTone(180);
      return;
    }

    state.profile = { name, instagram, folio: makeFolio(name, instagram), createdAt: new Date().toISOString() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.profile));
    if (data.registrationEndpoint) {
      try {
        const response = await fetch(data.registrationEndpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ name, instagram: `@${instagram}`, folio: state.profile.folio })
        });
        if (!response.ok) throw new Error(`Formspree ${response.status}`);
      } catch { toast('BOLETO GENERADO. SINCRONIZACIÓN REMOTA PENDIENTE.'); }
    }
    unlockExperience();
    clickTone(660);
    toast('BOLETO GENERADO');
  }

  function loadImage(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = source;
    });
  }

  async function drawTicket() {
    const canvas = document.createElement('canvas');
    const width = 1080; const height = 1350;
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    try {
      const [diamaLogo, chaosLogo] = await Promise.all([
        loadImage('assets/diama-logo.png'), loadImage('assets/chaos-sabbati-cutout.png')
      ]);
      context.fillStyle = '#050203'; context.fillRect(0, 0, width, height);
      const glow = context.createRadialGradient(650, 400, 20, 650, 400, 600);
      glow.addColorStop(0, 'rgba(214,0,39,.34)'); glow.addColorStop(1, 'rgba(20,0,5,0)');
      context.fillStyle = glow; context.fillRect(0, 0, width, height);

      const glyphs = ['ディアマ', '赤い夜', '文化信号', '五九', '光の中で踊れ', 'DIAMA.'];
      context.font = '500 25px Inter, Arial, sans-serif';
      context.fillStyle = 'rgba(232,17,52,.42)';
      for (let column = 0; column < 16; column += 1) {
        const x = 50 + column * 67;
        for (let row = 0; row < 14; row += 1) {
          context.save(); context.translate(x, 65 + row * 82); context.rotate(Math.PI / 2);
          context.fillText(glyphs[(column + row) % glyphs.length], 0, 0); context.restore();
        }
      }

      context.drawImage(diamaLogo, 268, 570, 898, 234, 78, 72, 600, 156);
      context.save(); context.globalCompositeOperation = 'screen'; context.globalAlpha = .82;
      context.drawImage(chaosLogo, 475, 165, 510, 510); context.restore();
      context.strokeStyle = '#ea1738'; context.lineWidth = 8; context.strokeRect(34, 34, width - 68, height - 68);
      context.strokeStyle = 'rgba(255,255,255,.45)'; context.lineWidth = 2; context.strokeRect(57, 57, width - 114, height - 114);

      context.fillStyle = '#f21c3d'; context.font = '700 23px Inter, Arial, sans-serif';
      context.fillText('DIAMA X CHAOS SABBATI  /  QUERÉTARO', 82, 270);
      context.fillStyle = 'rgba(100,0,18,.9)'; context.fillRect(62, 765, width - 124, 510);
      context.fillStyle = '#ff7188'; context.font = '600 20px Inter, Arial, sans-serif'; context.fillText('REGISTRO', 94, 830);
      context.fillStyle = '#fff'; context.font = '800 76px Inter, Arial, sans-serif'; context.fillText(state.profile.name.toUpperCase().slice(0, 18), 92, 934);
      context.font = '600 29px Inter, Arial, sans-serif'; context.fillText(`@${state.profile.instagram}`, 96, 990);
      context.fillStyle = '#ff7188'; context.font = '600 20px Inter, Arial, sans-serif'; context.fillText('05 SEPTIEMBRE  /  $100 EN PUERTA', 96, 1080);
      context.fillStyle = '#fff'; context.fillText(`FOLIO ${state.profile.folio}`, 96, 1130);
      for (let x = 94; x < 980; x += 11) context.fillRect(x, 1184, (x % 4) + 2, 42);

      const link = document.createElement('a');
      link.download = `DIAMA-CHAOS-${state.profile.folio}.png`;
      link.href = canvas.toDataURL('image/png'); link.click();
      toast('BOLETO GUARDADO EN TU DISPOSITIVO');
    } catch {
      toast('NO SE PUDO GENERAR EL BOLETO. INTENTA DE NUEVO.');
    }
  }

  function bindEvents() {
    const boot = $('#boot');
    boot.addEventListener('click', enterExperience);
    boot.addEventListener('keydown', (event) => {
      if (!['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      enterExperience();
    });
    document.addEventListener('click', (event) => {
      const target = event.target.closest('[data-view-target]');
      if (target) navigate(target.dataset.viewTarget);
      const mediaTrack = event.target.closest('[data-music-index]');
      if (mediaTrack) selectMusic(Number(mediaTrack.dataset.musicIndex), true);
      const playerTab = event.target.closest('[data-player-tab]');
      if (playerTab) { state.playerTab = playerTab.dataset.playerTab; renderMedia(); clickTone(470); }
      const visualArtist = event.target.closest('[data-visual-index]');
      if (visualArtist) { state.visualIndex = Number(visualArtist.dataset.visualIndex); renderVisual(); clickTone(510); }
      const playerAction = event.target.closest('[data-player-action]');
      if (playerAction) handlePlayerAction(playerAction.dataset.playerAction);
      const playerSeek = event.target.closest('[data-player-seek]');
      if (playerSeek) seekPlayer(playerSeek, event.clientX);
    });
    $('#registrationForm').addEventListener('submit', submitRegistration);
    $('#downloadTicket').addEventListener('click', drawTicket);
    document.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
      event.preventDefault();
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      navigate(adjacentView(direction));
    });
    let touchStart = null;
    $('#stage').addEventListener('touchstart', (event) => { touchStart = event.touches[0].clientX; }, { passive: true });
    $('#stage').addEventListener('touchend', (event) => {
      if (touchStart === null) return;
      const delta = event.changedTouches[0].clientX - touchStart;
      touchStart = null;
      if (Math.abs(delta) < 75) return;
      navigate(adjacentView(delta < 0 ? 1 : -1));
    }, { passive: true });
  }

  function init() {
    installViewMatrix();
    renderMedia({ reloadAudio: true }); renderVisual();
    $('#mapsLink').href = data.event.mapsUrl;
    if (state.profile) unlockExperience();
    bindEvents();
    const requested = location.hash.replace('#', '');
    navigate(views.includes(requested) ? requested : 'intro', { silent: true });
    preloadAmbient().catch(() => {});
    setTimeout(() => $('#boot').classList.add('is-ready'), 700);
  }

  init();
})();
