(() => {
  'use strict';
  const P = window.PLAN, KEY = 'entreno.v1';
  const app = document.getElementById('app');
  Object.keys(P.exercises).forEach(k => { P.exercises[k].id = k; });
  const DEF = { sessions: [], adj: {}, gear: {}, settings: { sound: true, vib: true, voice: true, stretch: 15, notif: null, warmSet: false }, active: null, warmAt: 0, body: [], backupAt: 0, backupN: 0, backupSnooze: 0 };

  /* ---------- estado ---------- */
  let S = load();
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || '{}');
      return Object.assign({}, DEF, d, { settings: Object.assign({}, DEF.settings, d.settings || {}), gear: Object.assign({}, d.gear || {}) });
    } catch (e) { return JSON.parse(JSON.stringify(DEF)); }
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* sin almacenamiento */ } }

  let view = { name: 'home' };
  let ticker = null, stops = [];
  let W = null;   // temporizador del calentamiento
  let ST = null;  // estado de los estiramientos
  let T = null;   // temporizador de un ejercicio por tiempo

  /* ---------- utilidades ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const kg = n => String(Math.round(n * 100) / 100).replace('.', ',') + ' kg';
  const clock = s => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const dShort = ts => new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  const DAYMS = 86400000;
  const weekStart = ts => { const d = new Date(ts); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };
  const dWhen = ts => new Date(ts).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }) + ' · ' +
    new Date(ts).toLocaleTimeString('es-ES', { hour: 'numeric', minute: '2-digit' });
  const toInput = ts => new Date(ts - new Date(ts).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const fromInput = v => { const ts = new Date(v).getTime(); return ts && ts <= Date.now() + 60000 ? ts : 0; };
  const sortSessions = () => S.sessions.sort((a, b) => a.date - b.date);
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
  const EX = id => P.exercises[id];
  const DAY = id => P.days.find(d => d.id === id);
  const adj = id => S.adj[id] || 0;
  const hasWarm = ex => !ex.noWarm;
  const workCount = ex => ex.sets.length - (hasWarm(ex) ? 1 : 0);
  // la serie de calentamiento de 20 repeticiones de cada ejercicio solo se hace si se activa en Más
  const useSet = (ex, i) => !(i === 0 && hasWarm(ex) && !S.settings.warmSet);
  const setLabel = (ex, i) => hasWarm(ex) && i === 0 ? 'Serie de calentamiento' : 'Serie ' + (hasWarm(ex) ? i : i + 1) + ' de ' + workCount(ex);
  const setShort = (ex, i) => hasWarm(ex) && i === 0 ? 'Cal.' : 'S' + (hasWarm(ex) ? i : i + 1);
  // peso objetivo: el del plan más las subidas aceptadas (la serie de calentamiento no cambia)
  const targetW = (ex, i) => ex.sets[i].w == null ? null : ex.sets[i].w + (hasWarm(ex) && i === 0 ? 0 : adj(ex.id));
  const blockEx = b => typeof b === 'string' ? [b] : b.ex;
  const dayEx = d => d.blocks.flatMap(blockEx);

  function lastLog(exId, i) {
    for (let s = S.sessions.length - 1; s >= 0; s--) {
      const l = S.sessions[s].logs.find(l => l.ex === exId && l.i === i);
      if (l) return l;
    }
    return null;
  }
  const mark = st => st === 'low' ? '▼' : st === 'up' ? '▲' : '✓';
  const logText = l => l.secs != null ? l.secs + ' s' : (l.w != null ? kg(l.w) + ' × ' : '') + l.reps;

  /* ---------- sonido, vibración, pantalla encendida ---------- */
  let actx = null, wake = null;
  function unlockAudio() {
    if (actx || !S.settings.sound) return;
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* sin audio */ }
  }
  function beep(n, freq) {
    if (S.settings.vib && navigator.vibrate) navigator.vibrate(n > 1 ? [250, 120, 250] : 180);
    if (!S.settings.sound || !actx) return;
    for (let i = 0; i < n; i++) {
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * 0.28;
      o.frequency.value = freq || 880; o.connect(g); g.connect(actx.destination);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.start(t); o.stop(t + 0.25);
    }
  }
  /* ---------- voz ---------- */
  const canSpeak = 'speechSynthesis' in window;
  function say(text) {
    if (!S.settings.voice || !canSpeak || !text) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'es-ES'; u.rate = 1.1;
      const v = speechSynthesis.getVoices().find(x => /^es(-|_)ES/i.test(x.lang)) || speechSynthesis.getVoices().find(x => /^es/i.test(x.lang));
      if (v) u.voice = v;
      speechSynthesis.speak(u);
    } catch (e) { /* sin voz */ }
  }
  const hush = () => { try { if (canSpeak) speechSynthesis.cancel(); } catch (e) { /* nada */ } };
  const vIcon = () => S.settings.voice ? '\u{1F50A}' : '\u{1F507}';
  const vLabel = () => S.settings.voice ? 'Voz activada. Pulsa para silenciarla' : 'Voz silenciada. Pulsa para activarla';
  const vBtn = () => `<button class="icon ${S.settings.voice ? '' : 'off'}" data-a="voice" aria-label="${vLabel()}">${vIcon()}</button>`;
  const SIDES = { remomancuerna: 'switch', birddog: 'alt' };   // switch: una serie por lado · alt: alternando lados
  let lastSaid = '';
  function setSpeech(step, withName) {
    const ex = exV(step.ex), set = ex.sets[step.i], tw = targetW(ex, step.i);
    return (withName ? ex.name.replace(/\s*\(.*?\)/g, '') + '. ' : '') + setLabel(ex, step.i) + '. ' +
      (set.secs != null ? set.secs + ' segundos' : set.reps + ' repeticiones' + (tw != null ? ' con ' + String(tw).replace('.', ' coma ') + ' kilos' : '')) + '.';
  }
  function announce() {
    const a = S.active;
    if (view.name !== 'session' || !a || a.done || view.sub) return;
    const step = a.steps[a.i];
    if (a.phase === 'rest') {
      if (lastSaid !== 'r' + a.i) { lastSaid = 'r' + a.i; const sb = supStart(a, a.steps[a.i]); say('Descansa. ' + (a.rest.min === a.rest.max ? a.rest.max : a.rest.min + ' a ' + a.rest.max) + ' segundos.' + (sb ? supSay(sb) : gearSay(a))); }
      return;
    }
    if (step.type !== 'set' || view.guide || (T && T.run) || lastSaid === 's' + a.i) return;
    lastSaid = 's' + a.i; say(setSpeech(step, true));
  }
  // guía de la serie: cuenta repeticiones y marca la respiración al ritmo de la figura
  function onGuide(k, ph, cyc) {
    const g = view.guide;
    if (!g || !S.active) return;
    const step = S.active.steps[S.active.i], ex = EX(step.ex), reps = ex.sets[step.i].reps;
    const mode = SIDES[ex.id], total = mode ? reps * 2 : reps, rep = cyc + 1;
    const cue = ph.b === 'in' ? 'coge aire' : ph.b === 'out' ? 'suelta' : '';
    if (k === 0) {
      if (rep > total) { view.guide = null; say('Serie completa'); beep(2, 1040); render(true); return; }
      const num = mode === 'switch' ? ((rep - 1) % reps) + 1 : rep, other = mode === 'switch' && rep > reps;
      const c = document.getElementById('gcount');
      if (c) c.textContent = (other ? 'Otro lado · ' : '') + 'Repetición ' + num + ' de ' + (mode === 'alt' ? total : reps);
      say((other && num === 1 ? 'Cambia de lado. ' : '') + num + '. ' + cue); g.b = ph.b;
    } else if (ph.b !== g.b) { say(cue); g.b = ph.b; }
  }

  async function keepAwake(on) {
    try {
      if (on && !wake && navigator.wakeLock) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); }
      if (!on && wake) { await wake.release(); wake = null; }
    } catch (e) { /* no disponible */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') clearNotifs();
    if (document.visibilityState === 'visible' && view.name !== 'home' && view.name !== 'hist' && view.name !== 'more') keepAwake(true);
  });

  /* ---------- sesión ---------- */
  function buildSteps(day, withWarm) {
    const steps = [];
    if (withWarm) steps.push({ type: 'warm' });
    day.blocks.forEach(b => {
      if (typeof b === 'string') {
        const ex = EX(b);
        ex.sets.forEach((s, i) => { if (useSet(ex, i)) steps.push({ type: 'set', ex: b, i, rest: ex.rest }); });
      } else {
        const rounds = Math.max(...b.ex.map(id => EX(id).sets.length));
        for (let r = 0; r < rounds; r++) b.ex.forEach((id, k) => {
          if (EX(id).sets[r] && useSet(EX(id), r)) steps.push({ type: 'set', ex: id, i: r, rest: k < b.ex.length - 1 ? b.between : b.rest, group: b.label, info: b.info });
        });
      }
    });
    steps.push({ type: 'stretch' });
    return steps;
  }
  function startDay(dayId) {
    const warmDone = Date.now() - S.warmAt < 3 * 3600 * 1000;
    S.active = { day: dayId, steps: buildSteps(DAY(dayId), !warmDone), i: 0, phase: 'work', logs: [], feel: newFeel(), t0: Date.now() };
    save(); W = null; ST = null; T = null; lastSaid = '';
    view = { name: 'session' }; render();
  }
  function advance() {
    const a = S.active, step = a.steps[a.i], next = a.steps[a.i + 1];
    a.lastAt = Date.now();
    a.i++; view.sub = null; view.guide = null; view.video = null; view.gear = null; T = null;
    if (a.i >= a.steps.length) { a.done = true; say('Entreno terminado. ¿Cómo te has encontrado?'); }
    else if (step.type === 'set' && step.rest && next.type === 'set') {
      a.phase = 'rest'; a.rest = { start: Date.now(), min: step.rest[0], max: step.rest[1] };
    } else a.phase = 'work';
    save(); render();
  }

  /* ---------- vídeo del entrenador ---------- */
  // Se carga solo al pulsar (ahorra datos y no avisa a YouTube hasta entonces); dominio sin cookies.
  const ytId = url => { const m = /(?:v=|shorts\/|youtu\.be\/|embed\/)([\w-]{11})/.exec(url || ''); return m ? m[1] : null; };
  function videoBlock(ex) {
    const id = ytId(ex.url);
    if (!id) return `<a class="video" target="_blank" rel="noopener" href="https://www.youtube.com/results?search_query=${encodeURIComponent(ex.video || ex.name)}">▶ Buscar un vídeo en YouTube</a>`;
    if (view.video !== ex.id) return `<button class="video" data-a="video" data-ex="${ex.id}">▶ Ver el vídeo del entrenador</button>`;
    return `<div class="vid ${/shorts\//.test(ex.url) ? 'short' : ''}"><iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1"
        title="Vídeo: ${esc(ex.name)}" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen
        referrerpolicy="strict-origin-when-cross-origin"></iframe></div>
      <p class="vid-links"><button class="link" data-a="video" data-ex="">Cerrar vídeo</button> · <a class="link" target="_blank" rel="noopener" href="${ex.url}">Abrir en YouTube</a></p>`;
  }

  /* ---------- variantes ---------- */
  // Un ejercicio puede tener variantes (plan.js → variants). La elegida vale para el resto de la sesión
  // y, si no se cambia, la siguiente vez se propone la última que se usó.
  const VAR = (id, vid) => { const ex = EX(id); return ex && vid && ex.variants ? ex.variants.find(v => v.id === vid) || null : null; };
  function lastVariant(id) {
    for (let i = S.sessions.length - 1; i >= 0; i--) { const l = S.sessions[i].logs.find(x => x.ex === id); if (l) return l.v || null; }
    return null;
  }
  function curVar(id) {
    const ex = EX(id), a = S.active;
    if (!ex || !ex.variants) return null;
    return VAR(id, a && a.vars && id in a.vars ? a.vars[id] : lastVariant(id));
  }
  function exV(id) {
    const ex = EX(id), v = curVar(id);
    return !v ? ex : Object.assign({}, ex, { name: v.name, fig: v.fig || ex.fig, how: v.how || ex.how, resp: v.resp || ex.resp,
      note: v.note || ex.note, video: v.video || v.name, url: v.url, vv: v });
  }
  const varOf = (s, id) => { const l = s.logs.find(x => x.ex === id && x.v); return l ? VAR(id, l.v) : null; };
  function varPicker(id) {
    const ex = EX(id), v = curVar(id), a = S.active;
    if (!ex || !ex.variants) return '';
    const fromLast = v && !(a && a.vars && id in a.vars);
    const opts = [{ id: '', short: ex.vlabel || 'normal' }].concat(ex.variants).map(o =>
      `<button class="opt ${(v ? v.id : '') === o.id ? 'on' : ''}" data-a="var" data-ex="${id}" data-v="${o.id}" aria-pressed="${(v ? v.id : '') === o.id}">${cap(o.short)}</button>`).join('');
    const hint = v ? (fromLast ? 'La usaste la última vez. ' : '') + `Vuelve a «${ex.vlabel || 'normal'}» cuando te encuentres bien.`
      : ex.variants.map(o => `Cambia a «${o.short}» ${o.when}.`).join(' ');
    return `<div class="opts var" role="group" aria-label="Variante">${opts}</div><p class="muted">${hint}</p>`;
  }

  // «Ejercicio 5 de 5 · Superserie con Curl de bíceps»
  function exPos(step) {
    const d = DAY(S.active.day), all = dayEx(d), n = all.indexOf(step.ex) + 1;
    const b = d.blocks.find(x => typeof x !== 'string' && x.ex.includes(step.ex));
    const mates = b ? b.ex.filter(x => x !== step.ex).map(exShort).join(' y ') : '';
    return `Ejercicio ${n} de ${all.length}` + (b ? ` · ${b.label} con ${mates}` : '');
  }
  const dayList = d => '<ol class="daylist">' + d.blocks.map(b => typeof b === 'string' ? `<li>${exShort(b)}</li>`
    : b.ex.map((id, k) => `<li>${exShort(id)}${k ? '' : ` <span class="chip soft">${b.label.toLowerCase()} con ${b.ex.slice(1).map(exShort).join(' y ')}</span>`}</li>`).join('')).join('') + '</ol>';

  /* ---------- aviso previo de superserie ---------- */
  // Antes de empezar un bloque de ejercicios alternados se avisa de cuáles son y de que hay que tener preparado todo.
  const blockOf = (dayId, id) => DAY(dayId).blocks.find(b => typeof b !== 'string' && b.ex.includes(id)) || null;
  function supStart(a, st) {
    const b = st && st.type === 'set' ? blockOf(a.day, st.ex) : null;
    return b && b.ex[0] === st.ex && !a.logs.some(l => b.ex.includes(l.ex)) ? b : null;
  }
  const supPrep = b => b.ex.some(id => EX(id).sets.some(x => x.w != null))
    ? `Prepara ${b.ex.length === 2 ? 'los dos' : 'todos'} antes de empezar: ${b.between ? 'entre uno y otro el descanso es corto' : 'entre uno y otro no hay descanso'}.` : '';
  function supCard(b) {
    const exs = b.ex.map(exV);
    return `<div class="sup" role="note"><p class="sup-h">Ahora viene: ${b.label} · ${exs.length} ejercicios alternados</p>
      <div class="sup-g">${exs.map((e, k) => {
        const vid = e.vv && e.vv.id, src = PH[gearKey(e.id, vid)] || thumbOf(e.url), g = gearOf(e.id, vid);
        return `<figure>${src ? `<img src="${src}" alt="" referrerpolicy="no-referrer">` : ''}<figcaption><b>${k + 1}. ${esc(e.name.replace(/\s*\(.*?\)/g, ''))}</b>${g ? `<span>🔧 ${esc(g)}</span>` : ''}</figcaption></figure>`;
      }).join('')}</div>
      <p class="sup-t">${supPrep(b)} ${b.info || ''}</p></div>`;
  }
  function supSay(b) {
    const gs = b.ex.map(id => { const e = exV(id), g = gearOf(id, e.vv && e.vv.id); return g ? ' Para ' + exShort(id) + ': ' + g + '.' : ''; }).join('');
    return ` Atención, ahora viene: ${b.label.toLowerCase()}. ${b.ex.map(exShort).join(' y ')}, alternando. ${supPrep(b)}${gs}`;
  }

  /* ---------- imagen de la máquina ---------- */
  // Al empezar cada ejercicio: tu foto de la máquina si la has hecho; si no, la imagen del vídeo del entrenador.
  // Las fotos se guardan reducidas en este móvil (clave aparte para no reescribirlas en cada guardado).
  const PKEY = 'entreno.fotos';
  let PH = (() => { try { return JSON.parse(localStorage.getItem(PKEY) || '{}'); } catch (e) { return {}; } })();
  const savePhotos = () => { try { localStorage.setItem(PKEY, JSON.stringify(PH)); return true; } catch (e) { return false; } };
  const thumbOf = url => { const id = ytId(url); return id ? 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' : null; };
  let photoKey = null;
  const phin = document.createElement('input');
  phin.type = 'file'; phin.accept = 'image/*'; phin.setAttribute('capture', 'environment'); phin.hidden = true; phin.id = 'phin';
  document.body.appendChild(phin);
  function machineImg(ex) {
    const k = gearKey(ex.id, ex.vv && ex.vv.id), own = PH[k], src = own || thumbOf(ex.url);
    const canPhoto = EX(ex.id).sets.some(x => x.w != null);
    if (!src && !canPhoto) return '';
    return `<figure class="mimg ${own ? 'own' : ''}">${src ? `<img src="${src}" alt="${own ? 'Tu foto de la máquina' : 'Imagen del vídeo del entrenador'}: ${esc(ex.name)}" referrerpolicy="no-referrer">` : ''}
      <figcaption>${own ? 'Tu foto' : src ? 'Del vídeo del entrenador' : ''}${canPhoto ? `<span><button class="link" data-a="photo" data-k="${k}">📷 ${own ? 'Cambiar foto' : 'Poner mi foto de la máquina'}</button>${own ? `<button class="link" data-a="phdel" data-k="${k}">Quitar</button>` : ''}</span>` : ''}</figcaption></figure>`;
  }
  async function shrink(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = url; });
      const sc = Math.min(1, 640 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * sc); c.height = Math.round(img.naturalHeight * sc);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.7);
    } finally { URL.revokeObjectURL(url); }
  }

  /* ---------- ajustes de cada máquina ---------- */
  // Texto libre por ejercicio y por variante (el curl femoral sentado es otra máquina). Solo se guarda en este móvil.
  const GEAR_HINT = { legpress: 'respaldo en 3, pies a la anchura de los hombros', pulldown: 'rodillo de las rodillas en 2, agarre ancho',
    row: 'asiento en 4, agarre en V', legcurl: 'rodillo en 5, respaldo en 2', legcurl_seated: 'respaldo en 3, rodillo en 4',
    pushdown: 'polea arriba del todo, cuerda', incline: 'banco en el segundo agujero', shoulder: 'respaldo casi vertical' };
  const gearKey = (id, vid) => id + (vid ? ':' + vid : '');
  const gearOf = (id, vid) => (S.gear || {})[gearKey(id, vid)] || '';
  const figOf = (id, vid) => { const v = VAR(id, vid); return (v && v.fig) || EX(id).fig; };
  const isMachine = (id, vid) => !!GEAR_HINT[figOf(id, vid)];
  const gearShown = (id, vid) => !!(gearOf(id, vid) || isMachine(id, vid) || view.gear === gearKey(id, vid));
  function gearLine(id, vid, label) {
    const ex = EX(id), k = gearKey(id, vid), txt = gearOf(id, vid);
    if (!ex || !ex.sets.some(x => x.w != null)) return '';
    if (view.gear === k) return `<div class="gear edit"><label class="lbl" for="gearin">Ajustes de la máquina${label ? ' · ' + esc(label) : ''}</label>
      <input type="text" class="fld" id="gearin" maxlength="120" enterkeyhint="done" value="${esc(txt)}" placeholder="Ej.: ${GEAR_HINT[figOf(id, vid)] || 'asiento en 4, respaldo en 2, agarre ancho'}">
      <div class="row"><button class="btn ghost" data-a="gearcancel">Cancelar</button><button class="btn primary" data-a="gearsave" data-k="${k}">Guardar</button></div></div>`;
    return txt ? `<p class="gear"><span aria-hidden="true">🔧</span><span class="grow">${label ? '<b>' + esc(cap(label)) + ':</b> ' : ''}${esc(txt)}</span><button class="link" data-a="gearedit" data-k="${k}" aria-label="Cambiar los ajustes de la máquina">Cambiar</button></p>`
      : `<p class="gear"><button class="link" data-a="gearedit" data-k="${k}">+ Apuntar ajustes de la máquina${label ? ' (' + esc(label) + ')' : ''}</button></p>`;
  }
  // en el descanso, si el siguiente ejercicio es nuevo hoy, la voz recuerda cómo dejar la máquina
  function gearSay(a) {
    const st = a.steps[a.i];
    if (!st || st.type !== 'set' || a.logs.some(l => l.ex === st.ex)) return '';
    const ex = exV(st.ex), t = gearOf(st.ex, ex.vv && ex.vv.id);
    return t ? ' Para ' + exShort(st.ex) + ': ' + t + '.' : '';
  }

  /* ---------- esfuerzo de la última serie ---------- */
  // Un toque en la última serie de los ejercicios con peso. «Al límite» frena la propuesta de subir peso.
  const EFF = ['Cómoda', 'Justa', 'Al límite'];
  const EFF_SUB = ['sobraban 3 o más', 'sobraban 1 o 2', 'ni una más'];
  const EFF_TXT = ['cómoda', 'justa', 'al límite'];
  const isTop = (ex, i) => i === ex.sets.length - 1 && ex.sets[i].w != null;
  const effChip = l => l.e != null ? `<span class="chip soft">${EFF_TXT[l.e]}</span>` : '';

  /* ---------- aviso fuera de la app ---------- */
  // Si durante el descanso sales de la app, una notificación avisa de que toca la siguiente serie.
  // Necesita que el móvil no congele la página en segundo plano: en Android suele ir bien; en iPhone no está garantizado.
  const canNotify = 'Notification' in window;
  const notifOn = () => canNotify && S.settings.notif === true && Notification.permission === 'granted';
  let restAlarm = null;
  const swReg = async () => { try { return 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null; } catch (e) { return null; } };
  async function notify(title, body, tag) {
    try {
      const o = { body, tag: tag || 'rest', renotify: true, icon: 'icons/icon-192.png', vibrate: [250, 120, 250] };
      const reg = await swReg();
      if (reg) await reg.showNotification(title, o); else new Notification(title, o);
    } catch (e) { /* sin notificaciones */ }
  }
  async function clearNotifs() {
    try { const reg = await swReg(); if (reg) (await reg.getNotifications({ tag: 'rest' })).forEach(n => n.close()); } catch (e) { /* nada */ }
  }
  function nextTxt(step) {
    const ex = exV(step.ex), set = ex.sets[step.i], tw = targetW(ex, step.i);
    return ex.name.replace(/\s*\(.*?\)/g, '') + ' · ' + setLabel(ex, step.i) + ' · ' +
      (set.secs != null ? set.secs + ' s' : set.reps + ' repeticiones' + (tw != null ? ' × ' + kg(tw) : ''));
  }
  const disarmRest = () => { clearTimeout(restAlarm); restAlarm = null; };
  function armRest() {
    disarmRest();
    const a = S.active;
    if (!notifOn() || !a || a.done || a.phase !== 'rest') return;
    const ms = a.rest.start + a.rest.max * 1000 - Date.now();
    if (ms < 0) return;
    restAlarm = setTimeout(() => {
      restAlarm = null;
      const b = S.active;
      if (!b || b.done || b.phase !== 'rest' || document.visibilityState === 'visible') return;
      notify('Toca la siguiente serie', nextTxt(b.steps[b.i]));
    }, ms);
  }

  /* ---------- sensaciones ---------- */
  const ABD = ['Ninguna', 'Leve', 'Tuve que parar'];
  const ABD_TXT = ['sin molestias', 'molestia leve', 'paró por molestias'];
  const ABD_CLS = ['ok', 'mid', 'low'];
  const ENERGY = ['Baja', 'Normal', 'Alta'];
  const newFeel = () => ({ abd: null, en: null, where: [] });
  const hasFeel = f => !!f && (f.abd != null || f.en != null);
  const exShort = id => !EX(id) ? id : EX(id).name.replace(/\s*\(.*?\)/g, '').replace(/,.*$/, '').replace(/ con (mancuernas?|cuerda|barra Z)$/, '');
  const cap = t => t[0].toUpperCase() + t.slice(1);
  function feelTarget() {
    if (view.name === 'manual') return { f: view.feel || (view.feel = newFeel()), day: view.day };
    if (view.name === 'hist' && view.editFeel != null) { const s = S.sessions[view.editFeel]; return { f: s.feel || (s.feel = newFeel()), day: s.day }; }
    const a = S.active; return { f: a.feel || (a.feel = newFeel()), day: a.day };
  }
  function feelPicker(f, dayId) {
    const d = DAY(dayId), where = f.where || (f.where = []);
    const opt = (k, v, l, cls) => `<button class="opt ${f[k] === v ? 'on ' + (cls || '') : ''}" data-a="feel" data-k="${k}" data-v="${v}" aria-pressed="${f[k] === v}">${l}</button>`;
    return `<p class="lbl">Molestia abdominal</p><div class="opts">${ABD.map((l, v) => opt('abd', v, l, ABD_CLS[v])).join('')}</div>
      ${f.abd > 0 && d ? `<p class="lbl">¿En qué ejercicio la notaste? (opcional)</p><div class="opts wrap">${dayEx(d).map(id =>
        `<button class="opt ${where.includes(id) ? 'on mid' : ''}" data-a="feelex" data-ex="${id}" aria-pressed="${where.includes(id)}">${exShort(id)}</button>`).join('')}</div>` : ''}
      <p class="lbl">Energía</p><div class="opts">${ENERGY.map((l, v) => opt('en', v, l)).join('')}</div>`;
  }
  const feelChips = f => !hasFeel(f) ? '' :
    (f.abd != null ? `<span class="chip ${ABD_CLS[f.abd]}">${cap(ABD_TXT[f.abd])}</span>` : '') +
    (f.en != null ? `<span class="chip soft">Energía ${ENERGY[f.en].toLowerCase()}</span>` : '') +
    (f.where && f.where.length ? `<span class="chip soft">en ${f.where.map(exShort).join(', ')}</span>` : '');
  // ejercicio que se estaba haciendo (en el descanso, el de la serie anterior)
  function curEx(a) { const st = a.phase === 'rest' ? a.steps[a.i - 1] : a.steps[a.i]; return st && st.type === 'set' ? st.ex : null; }
  function feelFlag(id, withPrev) {
    const a = S.active;
    if (a && a.feel && a.feel.where && a.feel.where.includes(id)) return 'Hoy has apuntado molestia en este ejercicio. Ve con calma, no aguantes el aire y, si sigue, para por hoy con ⚠.';
    if (!withPrev) return '';
    const prev = S.sessions.filter(s => DAY(s.day) && dayEx(DAY(s.day)).includes(id)).slice(-2).reverse()
      .find(s => s.feel && s.feel.where && s.feel.where.includes(id));
    return prev ? `El ${dShort(prev.date)} notaste molestia en este ejercicio. Ve con calma, no aguantes el aire y, si vuelve, apúntala con ⚠.` : '';
  }
  function healthAlert(now) {
    const stopped = s => s.feel && s.feel.abd != null ? s.feel.abd === 2 : !!s.stopped;
    const n14 = S.sessions.filter(s => s.date > now - 14 * DAYMS && stopped(s)).length;
    const last = S.sessions[S.sessions.length - 1];
    const rated = S.sessions.filter(s => s.feel && s.feel.abd != null).slice(-3);
    let msg = '';
    if (n14 >= 2) msg = `Has tenido que parar ${n14} veces en las dos últimas semanas. La pauta del entrenador es que, si se repite, lo consultes con tu médico.`;
    else if (last && stopped(last)) msg = 'El último entreno lo paraste por molestias. Antes de volver, asegúrate de encontrarte bien: sin dolor abdominal, hinchazón fuerte ni fiebre.';
    else if (rated.length === 3 && rated.every(s => s.feel.abd >= 1)) msg = 'Has notado molestias en los 3 últimos entrenos. Coméntaselo a tu entrenador.';
    return msg ? `<section class="card warn"><p class="eyebrow">Ojo</p><p>${msg}</p></section>` : '';
  }
  function feelStats() {
    const ss = S.sessions.filter(s => s.feel && s.feel.abd != null).slice(-12);
    if (!ss.length) return '';
    const c = [0, 0, 0], e = [0, 0, 0], hits = {};
    ss.forEach(s => {
      c[s.feel.abd]++; if (s.feel.en != null) e[s.feel.en]++;
      const d = DAY(s.day); if (!d) return;
      dayEx(d).forEach(id => { const x = hits[id] || (hits[id] = [0, 0]); x[1]++; if ((s.feel.where || []).includes(id)) x[0]++; });
    });
    const top = Object.keys(hits).filter(id => hits[id][0]).sort((a, b) => hits[b][0] / hits[b][1] - hits[a][0] / hits[a][1] || hits[b][0] - hits[a][0]);
    return `<h2 class="sec">Sensaciones</h2><section class="card"><p class="muted">Últimos ${ss.length} entrenos con sensaciones apuntadas</p>
      <div class="stats">${ABD_TXT.map((t, v) => `<div class="${ABD_CLS[v]}"><b>${c[v]}</b><span>${t}</span></div>`).join('')}</div>
      ${top.length ? '<p class="lbl">Ejercicios donde notaste molestia</p>' + top.map(id =>
        `<div class="wk-row"><b class="grow">${exShort(id)}</b><span>${hits[id][0]} de ${hits[id][1]} ${hits[id][1] === 1 ? 'vez' : 'veces'}</span></div>`).join('') : ''}
      ${e.some(Boolean) ? `<p class="muted">Energía: ${ENERGY.map((l, v) => l.toLowerCase() + ' ' + e[v]).join(' · ')}</p>` : ''}</section>`;
  }
  function keepForm() {
    keepNote();
    const sdt = document.getElementById('sdt'); if (sdt && S.active) S.active.sdt = sdt.value;
    const mdt = document.getElementById('mdt'), mf = document.getElementById('mfull');
    if (mdt) view.mdt = mdt.value;
    if (mf) view.mfull = mf.checked;
    const sm = document.getElementById('smin'), mm = document.getElementById('mmin');
    if (sm && S.active) S.active.smin = sm.value;
    if (mm) view.mmin = mm.value;
  }

  /* ---------- resumen para el entrenador ---------- */
  const num = n => String(Math.round(n * 100) / 100).replace('.', ',');
  const fday = ts => new Date(ts).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/[.,]/g, '');
  const fdm = ts => new Date(ts).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }).replace(/\./g, '');
  const addDays = (ts, n) => { const d = new Date(ts); d.setDate(d.getDate() + n); return d.getTime(); };
  const setTxt = (w, reps, secs) => secs != null ? secs + ' s' : (w != null ? num(w) + '×' : '') + reps;
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  function feelLine(f) {
    if (!hasFeel(f)) return '';
    const where = f.where && f.where.length ? ' en ' + f.where.map(exShort).join(', ') : '';
    return [f.abd != null ? cap(ABD_TXT[f.abd]) + (f.abd > 0 ? where : '') : '', f.en != null ? 'energía ' + ENERGY[f.en].toLowerCase() : '']
      .filter(Boolean).join(' · ');
  }
  function sessionBlock(s) {
    const d = DAY(s.day);
    const lines = [`*${d ? d.name : s.day} · ${fday(s.date)}*${s.stopped ? ' (parado)' : ''}${s.manual ? ' (apuntado a mano)' : ''}${s.mins ? ' · ' + s.mins + ' min' : ''}`];
    const fl = feelLine(s.feel); if (fl) lines.push(fl);
    if (!s.logs.length) lines.push('Sin detalle de series.');
    (d ? dayEx(d) : [...new Set(s.logs.map(l => l.ex))]).forEach(id => {
      const ex = EX(id); if (!ex) return;
      const ls = s.logs.filter(l => l.ex === id && !(hasWarm(ex) && l.i === 0)).sort((a, b) => a.i - b.i);
      if (!ls.length) return;
      const parts = ls.map(l => setTxt(l.w, l.reps, l.secs) + (l.st === 'low' ? `▼ (obj. ${setTxt(l.tw, l.tr, l.ts)})` : l.st === 'up' ? '▲' : ''));
      const top = ls.find(l => l.i === ex.sets.length - 1 && l.e != null);
      lines.push(`• ${varOf(s, id) ? varOf(s, id).name : exShort(id)}: ${parts.join(' · ')}${ls.some(l => l.st === 'low') ? '' : ' ✓'}${top ? ' · última serie ' + EFF_TXT[top.e] : ''}`);
    });
    if (s.note && s.note.trim()) lines.push('Nota: ' + s.note.trim());
    return lines.join('\n');
  }
  function reviewLines(ss) {
    const out = [], rated = ss.filter(s => s.feel && s.feel.abd != null);
    if (rated.length) {
      const c = [0, 0, 0]; rated.forEach(s => c[s.feel.abd]++);
      out.push('Entrenos: ' + [c[0] ? c[0] + ' sin molestias' : '', c[1] ? c[1] + ' con molestia leve' : '',
        c[2] ? plural(c[2], 'parado', 'parados') + ' por molestias' : ''].filter(Boolean).join(', '));
    }
    const low = {}; ss.forEach(s => s.logs.forEach(l => { if (l.st === 'low') low[l.ex] = (low[l.ex] || 0) + 1; }));
    const lows = Object.keys(low).filter(EX);
    if (lows.length) out.push('Por debajo del plan: ' + lows.map(id => `${exShort(id)} (${plural(low[id], 'serie', 'series')})`).join(', '));
    const hard = {}; ss.forEach(s => s.logs.forEach(l => { if (l.e === 2) hard[l.ex] = (hard[l.ex] || 0) + 1; }));
    const hk = Object.keys(hard).filter(EX);
    if (hk.length) out.push('Última serie al límite: ' + hk.map(id => `${exShort(id)} (${plural(hard[id], 'vez', 'veces')})`).join(', '));
    const noWarm = ss.filter(s => s.logs.some(l => EX(l.ex) && hasWarm(EX(l.ex))) && !s.logs.some(l => l.i === 0 && EX(l.ex) && hasWarm(EX(l.ex)))).length;
    if (noWarm) out.push(`Sin la serie de calentamiento de 20 repeticiones en ${plural(noWarm, 'entreno', 'entrenos')}: hace 4 series por ejercicio`);
    const ups = Object.keys(S.adj).filter(id => S.adj[id] && EX(id));
    if (ups.length) out.push('Pesos ajustados respecto al plan: ' + ups.map(id => `${exShort(id)} ${S.adj[id] > 0 ? '+' : ''}${num(S.adj[id])} kg`).join(', '));
    return out.length ? ['*Para revisar*', ...out.map(x => '• ' + x)] : [];
  }
  function buildReport(mode) {
    const w0 = weekStart(Date.now()), L = [];
    if (mode !== '4w') {
      const from = mode === 'prev' ? addDays(w0, -7) : w0, to = addDays(from, 7);
      const ss = S.sessions.filter(s => s.date >= from && s.date < to);
      const done = P.days.filter(d => ss.some(s => s.day === d.id)), miss = P.days.filter(d => !done.includes(d));
      const end = addDays(from, 6), same = new Date(from).getMonth() === new Date(end).getMonth();
      L.push(`*Resumen de entreno · semana del ${same ? new Date(from).getDate() : fdm(from)} al ${fdm(end)}*`,
        `Días hechos: ${done.length} de ${P.days.length}${miss.length ? ' · ' + (mode === 'prev' ? 'sin hacer: ' : 'pendiente: ') + miss.map(d => d.name).join(', ') : ''}`);
      L.push(...extraLines(ss, from, to, false));
      if (!ss.length) return L.concat('', 'No hay entrenos apuntados esta semana.').join('\n');
      L.push('Pesos en kg (peso×repeticiones). ✓ cumplido · ▼ por debajo · ▲ por encima');
      ss.forEach(s => L.push('', sessionBlock(s)));
      L.push('', ...reviewLines(ss));
    } else {
      const from = addDays(w0, -21), to = addDays(w0, 7);
      const ss = S.sessions.filter(s => s.date >= from && s.date < to);
      L.push(`*Resumen de entreno · últimas 4 semanas (${fdm(from)} – ${fdm(addDays(w0, 6))})*`,
        'Días hechos por semana: ' + [0, 1, 2, 3].map(k => {
          const a = addDays(from, 7 * k), b = addDays(a, 7);
          return new Set(ss.filter(s => s.date >= a && s.date < b).map(s => s.day)).size + '/' + P.days.length;
        }).join(' · '));
      L.push(...extraLines(ss, from, to, true));
      if (!ss.length) return L.concat('', 'No hay entrenos apuntados en estas semanas.').join('\n');
      const evo = [];
      P.days.forEach(d => dayEx(d).forEach(id => {
        const ex = EX(id), fi = ex.sets.length - 1;
        if (ex.sets[fi].w == null && ex.sets[fi].secs == null) return;
        const ls = ss.map(s => s.logs.find(l => l.ex === id && l.i === fi)).filter(Boolean);
        if (ls.length) evo.push(`• ${exShort(id)}: ${ls.map(l => (l.secs != null ? l.secs + ' s' : num(l.w)) + (l.st === 'low' ? '▼' : '') + (l.e === 2 ? ' (al límite)' : '')).join(' → ')}`);
      }));
      if (evo.length) L.push('', '*Evolución de la última serie* (kg; plancha en segundos; ▼ por debajo del plan)', ...evo);
      const hits = {}; ss.forEach(s => ((s.feel && s.feel.where) || []).forEach(id => { hits[id] = (hits[id] || 0) + 1; }));
      const hk = Object.keys(hits).filter(EX);
      if (hk.length) L.push('', '*Molestias por ejercicio*', ...hk.map(id => `• ${exShort(id)}: ${plural(hits[id], 'vez', 'veces')}`));
      const notes = ss.filter(s => s.note && s.note.trim()).map(s => `• ${fday(s.date)}: ${s.note.trim()}`);
      if (notes.length) L.push('', '*Notas*', ...notes);
      L.push('', ...reviewLines(ss));
    }
    return L.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function vReport() {
    const mode = view.mode || 'week';
    const tabs = [['week', 'Esta semana'], ['prev', 'Semana pasada'], ['4w', '4 semanas']];
    return `<header class="bar"><button class="icon" data-a="go" data-v="${view.from || 'home'}" aria-label="Volver">←</button><span>Resumen para el entrenador</span><span></span></header>
      <section class="card"><div class="opts">${tabs.map(([k, l]) =>
        `<button class="opt ${mode === k ? 'on' : ''}" data-a="rmode" data-m="${k}" aria-pressed="${mode === k}">${l}</button>`).join('')}</div>
      <p class="muted">Puedes retocar el texto antes de enviarlo.</p>
      <textarea id="rtxt" class="report" aria-label="Texto del resumen">${esc(buildReport(mode))}</textarea></section>
      <footer class="dock"><button class="btn ${navigator.share ? 'ghost' : 'primary'}" data-a="rcopy">Copiar</button>${navigator.share ? '<button class="btn primary" data-a="rshare">Compartir</button>' : ''}</footer>`;
  }

  /* ---------- gráficas de progreso ---------- */
  const CHARTS = {};
  function niceStep(range) {
    const raw = range / 3, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    return [1, 2, 2.5, 5, 10].map(m => m * mag).find(x => x >= raw) || 10 * mag;
  }
  function chartData(id) {
    const ex = EX(id); if (!ex) return null;
    const fi = ex.sets.length - 1, timed = ex.sets[fi].secs != null;
    if (ex.sets[fi].w == null && !timed) return null;
    const pts = S.sessions.map(s => ({ s, l: s.logs.find(l => l.ex === id && l.i === fi) }))
      .filter(x => x.l && (timed ? x.l.secs != null : x.l.w != null)).slice(-12)
      .map(({ s, l }) => ({ t: s.date, v: timed ? l.secs : l.w, tv: timed ? l.ts : l.tw, reps: l.reps, st: l.st, vr: l.v, e: l.e }));
    return { id, pts, timed };
  }
  const fmtV = (d, v) => v == null ? '–' : d.timed ? v + ' s' : kg(v);
  const stTxt = st => st === 'low' ? '▼ por debajo' : st === 'up' ? '▲ por encima' : '✓ cumplido';
  const stEff = p => stTxt(p.st) + (p.e != null ? ' · ' + EFF_TXT[p.e] : '');
  function chartHtml(id) {
    const d = chartData(id);
    if (!d || !d.pts.length) return '';
    if (d.pts.length < 2) return '<p class="muted">La gráfica aparece a partir del segundo entreno con este ejercicio.</p>';
    const W = 320, H = 150, L = 34, R = 14, T = 18, B = 22, pw = W - L - R, ph = H - T - B;
    const vals = d.pts.flatMap(p => p.tv != null ? [p.v, p.tv] : [p.v]);
    const mn = Math.min(...vals), mx = Math.max(...vals), step = niceStep(mx - mn || Math.max(mx * 0.2, 1));
    const lo = Math.max(0, Math.floor((mn - step * 0.25) / step) * step), hi = Math.ceil((mx + step * 0.25) / step) * step;
    const t0 = d.pts[0].t, span = d.pts[d.pts.length - 1].t - t0;
    const X = (p, i) => L + (span > 0 ? (p.t - t0) / span : i / (d.pts.length - 1)) * pw;
    const Y = v => T + (1 - (v - lo) / (hi - lo)) * ph;
    const f = n => n.toFixed(1);
    d.xy = d.pts.map((p, i) => [X(p, i), Y(p.v)]); d.W = W;
    let g = '';
    for (let v = lo; v <= hi + 1e-9; v += step) {
      g += `<line class="c-grid" x1="${L}" x2="${W - R}" y1="${f(Y(v))}" y2="${f(Y(v))}"/><text class="c-ax" x="${L - 6}" y="${f(Y(v) + 3.5)}" text-anchor="end">${num(v)}</text>`;
    }
    const xl = [0, d.pts.length - 1]; if (d.pts.length >= 5) xl.splice(1, 0, Math.floor((d.pts.length - 1) / 2));
    xl.forEach((i, k) => { g += `<text class="c-ax" x="${f(d.xy[i][0])}" y="${H - 5}" text-anchor="${k === 0 ? 'start' : k === xl.length - 1 ? 'end' : 'middle'}">${fdm(d.pts[i].t)}</text>`; });
    const path = arr => arr.map((q, i) => (i ? 'L' : 'M') + f(q[0]) + ' ' + f(q[1])).join(' ');
    const tg = d.pts.map((p, i) => p.tv != null ? [d.xy[i][0], Y(p.tv)] : null).filter(Boolean);
    if (tg.length > 1) g += `<path class="c-target" d="${path(tg)}"/>`;
    g += `<path class="c-done" d="${path(d.xy)}"/>`;
    g += `<line class="c-cross" x1="0" x2="0" y1="${T}" y2="${T + ph}" visibility="hidden"/>`;
    d.pts.forEach((p, i) => {
      const [x, y] = d.xy[i];
      g += p.st === 'low' ? `<path class="c-mk low" d="M${f(x - 6)} ${f(y - 4.5)}h12l-6 10z"/>` : `<circle class="c-mk" cx="${f(x)}" cy="${f(y)}" r="4"/>`;
    });
    const first = d.pts[0], last = d.pts[d.pts.length - 1], [lx, ly] = d.xy[d.xy.length - 1];
    g += `<text class="c-end" x="${f(lx)}" y="${f(Math.max(11, ly - 10))}" text-anchor="end">${fmtV(d, last.v)}</text>`;
    g += `<rect class="c-hit" x="0" y="0" width="${W}" height="${H}"/>`;
    CHARTS[id] = d;
    const rows = d.pts.slice().reverse().map(p => `<tr><td>${fdm(p.t)}</td><td>${d.timed ? p.v + ' s' : num(p.v) + ' × ' + p.reps}${VAR(d.id, p.vr) ? ' (' + VAR(d.id, p.vr).short + ')' : ''}</td><td>${fmtV(d, p.tv)}</td><td>${stEff(p)}</td></tr>`).join('');
    const label = `Evolución de ${exShort(id)}: de ${fmtV(d, first.v)} el ${fdm(first.t)} a ${fmtV(d, last.v)} el ${fdm(last.t)}. Usa las flechas para recorrer los entrenos.`;
    return `<div class="chart" data-chart="${id}">
      <p class="c-title">${d.timed ? 'Segundos' : 'Peso'} de la última serie</p>
      <div class="c-legend"><span><i class="k done"></i>Lo que hiciste</span><span><i class="k target"></i>Objetivo del plan (banda)</span>${d.pts.some(p => p.st === 'low') ? '<span><i class="k low">▼</i>Por debajo del plan</span>' : ''}</div>
      <svg viewBox="0 0 ${W} ${H}" role="img" tabindex="0" aria-label="${esc(label)}">${g}</svg>
      <p class="c-read" aria-live="polite">Toca la gráfica para ver cada entreno.</p>
      <details class="c-table"><summary>Ver datos</summary><table><thead><tr><th>Fecha</th><th>Hecho</th><th>Objetivo</th><th>Estado</th></tr></thead><tbody>${rows}</tbody></table></details></div>`;
  }
  function initChart(el) {
    const d = CHARTS[el.dataset.chart]; if (!d || !d.xy) return;
    const svg = el.querySelector('svg'), cross = el.querySelector('.c-cross'), read = el.querySelector('.c-read'), mks = el.querySelectorAll('.c-mk');
    let cur = -1;
    const show = i => {
      cur = i; const p = d.pts[i], x = d.xy[i][0];
      cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
      mks.forEach((m, k) => m.classList.toggle('on', k === i));
      const rd = d.read ? d.read(p, i) : null;
      const b = document.createElement('b'); b.textContent = rd ? rd[0] : d.timed ? p.v + ' s' : kg(p.v) + ' × ' + p.reps;
      const t = document.createTextNode(rd ? rd[1] : fday(p.t) + (VAR(d.id, p.vr) ? ' · ' + VAR(d.id, p.vr).short : '') + (p.tv != null ? ' · objetivo ' + fmtV(d, p.tv) : '') + ' · ' + stEff(p));
      read.textContent = ''; read.append(b, t);
    };
    const hide = () => {
      cur = -1; cross.setAttribute('visibility', 'hidden'); mks.forEach(m => m.classList.remove('on'));
      read.textContent = 'Toca la gráfica para ver cada entreno.';
    };
    const near = e => {
      const r = svg.getBoundingClientRect(), vx = (e.clientX - r.left) / r.width * d.W;
      let best = 0; d.xy.forEach((q, k) => { if (Math.abs(q[0] - vx) < Math.abs(d.xy[best][0] - vx)) best = k; });
      return best;
    };
    svg.addEventListener('pointermove', e => show(near(e)));
    svg.addEventListener('pointerdown', e => show(near(e)));
    svg.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hide(); });
    svg.addEventListener('focus', () => show(cur < 0 ? d.pts.length - 1 : cur));
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', e => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const base = cur < 0 ? d.pts.length - 1 : cur;
      show(Math.max(0, Math.min(d.pts.length - 1, base + (e.key === 'ArrowLeft' ? -1 : 1))));
    });
  }

  /* ---------- duración ---------- */
  const PLAN_MIN = () => P.minutes || 60;
  const durOf = a => Math.max(1, Math.round(((a.lastAt || Date.now()) - a.t0) / 60000));
  const parseMin = v => { const n = parseInt(String(v || '').trim(), 10); return n > 0 && n < 300 ? n : null; };
  function durAvg(ss) { const m = ss.filter(s => s.mins).map(s => s.mins); return m.length ? Math.round(m.reduce((a, b) => a + b, 0) / m.length) : null; }
  function durAvgTxt() {
    const ss = S.sessions.filter(s => s.mins).slice(-6), avg = durAvg(ss);
    if (!avg) return '';
    return `Duración media de los últimos ${plural(ss.length, 'entreno', 'entrenos')}: <b>${avg} min</b> (previsto unos ${PLAN_MIN()})${avg > PLAN_MIN() + 15 ? ' · te estás alargando' : ''}. `;
  }

  /* ---------- peso corporal ---------- */
  const G = () => P.bodyGoal || null;    // { min, max } en kg por semana
  const parseKg = v => { const n = parseFloat(String(v || '').trim().replace(',', '.')); return n >= 30 && n <= 250 ? Math.round(n * 10) / 10 : null; };
  const sgn = n => (n > 0.004 ? '+' : n < -0.004 ? '−' : '±') + num(Math.abs(Math.round(n * 100) / 100));
  const spanTxt = w => w < 1 ? plural(Math.max(1, Math.round(w * 7)), 'día', 'días') : plural(Math.round(w), 'semana', 'semanas');
  const pathD = arr => arr.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ');
  function bodyGoalAt(t) {
    const g = G(), b = S.body || [];
    if (!g || !b.length) return null;
    const w = (t - b[0].t) / (7 * DAYMS);
    return [b[0].kg + g.min * w, b[0].kg + g.max * w];
  }
  function bodyTrend(list) {
    const b = list || S.body || [];
    if (b.length < 2) return null;
    const a = b[0], z = b[b.length - 1], weeks = (z.t - a.t) / (7 * DAYMS);
    return { d: z.kg - a.kg, weeks, rate: weeks > 0 ? (z.kg - a.kg) / weeks : 0, from: a, to: z };
  }
  function bodyVerdict(tr) {
    const g = G();
    if (!g || !tr || tr.weeks < 1) return '';
    return tr.rate < g.min ? 'por debajo del objetivo' : tr.rate > g.max ? 'por encima del objetivo' : 'dentro del objetivo';
  }
  function bodyInput(id) {
    const b = S.body || [], last = b[b.length - 1];
    return `<div class="wrow"><input type="text" id="${id}" inputmode="decimal" autocomplete="off" value="${last ? num(last.kg) : ''}" placeholder="73,4" aria-label="Peso en kg">
      <span>kg</span><button class="btn primary" data-a="bwsave" data-in="${id}">Guardar</button></div>`;
  }
  function bodyCard() {
    if ((S.body || []).some(x => x.t >= weekStart(Date.now()))) return '';
    return `<section class="card"><p class="eyebrow">Una vez por semana</p><h2>Tu peso de esta semana</h2>
      <p class="muted">Pésate en ayunas, después de ir al baño y, a ser posible, el mismo día de la semana.</p>${bodyInput('bw')}</section>`;
  }
  function bodyChartHtml() {
    const b = (S.body || []).slice(-16);
    if (b.length < 2) return b.length ? '<p class="muted">La gráfica aparece a partir del segundo peso apuntado.</p>' : '';
    const W = 320, H = 150, L = 34, R = 14, T = 18, B = 22, pw = W - L - R, ph = H - T - B, f = n => n.toFixed(1);
    const pts = b.map(x => ({ t: x.t, v: x.kg, band: bodyGoalAt(x.t) }));
    const vals = pts.flatMap(p => p.band ? [p.v, p.band[0], p.band[1]] : [p.v]);
    const mn = Math.min(...vals), mx = Math.max(...vals), step = niceStep(Math.max(mx - mn, 1));
    const lo = Math.floor((mn - step * 0.25) / step) * step, hi = Math.ceil((mx + step * 0.25) / step) * step;
    const t0 = pts[0].t, span = (pts[pts.length - 1].t - t0) || 1;
    const X = t => L + (t - t0) / span * pw, Y = v => T + (1 - (v - lo) / (hi - lo)) * ph;
    const r1 = n => num(Math.round(n * 10) / 10);
    const d = { id: 'body', pts, W, xy: pts.map(p => [X(p.t), Y(p.v)]),
      read: (p, i) => [kg(p.v), fday(p.t) + (i ? ' · ' + sgn(p.v - pts[i - 1].v) + ' kg' : '') + (i && p.band ? ' · ritmo objetivo ' + r1(p.band[0]) + '–' + r1(p.band[1]) + ' kg' : '')] };
    let g = '';
    for (let v = lo; v <= hi + 1e-9; v += step) {
      g += `<line class="c-grid" x1="${L}" x2="${W - R}" y1="${f(Y(v))}" y2="${f(Y(v))}"/><text class="c-ax" x="${L - 6}" y="${f(Y(v) + 3.5)}" text-anchor="end">${num(Math.round(v * 10) / 10)}</text>`;
    }
    const xl = [0, pts.length - 1]; if (pts.length >= 5) xl.splice(1, 0, Math.floor((pts.length - 1) / 2));
    xl.forEach((i, k) => { g += `<text class="c-ax" x="${f(d.xy[i][0])}" y="${H - 5}" text-anchor="${k === 0 ? 'start' : k === xl.length - 1 ? 'end' : 'middle'}">${fdm(pts[i].t)}</text>`; });
    if (pts[0].band) {
      const up = pts.map(p => [X(p.t), Y(p.band[1])]), dn = pts.map(p => [X(p.t), Y(p.band[0])]).reverse();
      g += `<path class="c-band" d="${pathD(up.concat(dn))} Z"/>`;
    }
    g += `<path class="c-done" d="${pathD(d.xy)}"/><line class="c-cross" x1="0" x2="0" y1="${T}" y2="${T + ph}" visibility="hidden"/>`;
    d.xy.forEach(q => { g += `<circle class="c-mk" cx="${f(q[0])}" cy="${f(q[1])}" r="4"/>`; });
    const [lx, ly] = d.xy[d.xy.length - 1];
    g += `<text class="c-end" x="${f(lx)}" y="${f(Math.max(11, ly - 10))}" text-anchor="end">${kg(pts[pts.length - 1].v)}</text><rect class="c-hit" x="0" y="0" width="${W}" height="${H}"/>`;
    CHARTS.body = d;
    const rows = b.slice().reverse().map((x, k, arr) => `<tr><td>${fdm(x.t)}</td><td>${kg(x.kg)}</td><td>${arr[k + 1] ? sgn(x.kg - arr[k + 1].kg) : '–'}</td>
      <td><button class="link" data-a="bwdel" data-t="${x.t}" aria-label="Borrar el peso del ${fdm(x.t)}">Borrar</button></td></tr>`).join('');
    return `<div class="chart" data-chart="body"><p class="c-title">Peso corporal (kg)</p>
      <div class="c-legend"><span><i class="k done"></i>Tu peso</span>${pts[0].band ? '<span><i class="k band"></i>Ritmo objetivo del entrenador</span>' : ''}</div>
      <svg viewBox="0 0 ${W} ${H}" role="img" tabindex="0" aria-label="Peso corporal: de ${kg(pts[0].v)} el ${fdm(pts[0].t)} a ${kg(pts[pts.length - 1].v)} el ${fdm(pts[pts.length - 1].t)}.">${g}</svg>
      <p class="c-read" aria-live="polite">Toca la gráfica para ver cada semana.</p>
      <details class="c-table"><summary>Ver datos</summary><table><thead><tr><th>Fecha</th><th>Peso</th><th>Cambio</th><th></th></tr></thead><tbody>${rows}</tbody></table></details></div>`;
  }
  function bodySection() {
    const tr = bodyTrend(), g = G(), b = S.body || [];
    let h = '<h2 class="sec">Peso corporal</h2><section class="card">';
    if (tr) h += `<p class="bline"><b>${sgn(tr.d)} kg</b> desde el ${fdm(tr.from.t)} (${spanTxt(tr.weeks)})${tr.weeks >= 1 ? ' · ' + sgn(tr.rate) + ' kg/semana' : ''}</p>`;
    else if (b.length) h += `<p class="bline"><b>${kg(b[0].kg)}</b> el ${fdm(b[0].t)}</p>`;
    if (g) h += `<p class="muted">Objetivo del entrenador: ganar de ${num(g.min)} a ${num(g.max)} kg por semana${bodyVerdict(tr) ? ' · vas ' + bodyVerdict(tr) : ''}.</p>`;
    h += bodyChartHtml();
    return h + `<label class="lbl" for="bwh">Apuntar el peso de esta semana</label>${bodyInput('bwh')}
      <p class="muted">Si ya lo apuntaste esta semana, se sustituye.</p></section>`;
  }
  // líneas extra del resumen para el entrenador: peso y duración
  function extraLines(ss, from, to, multi) {
    const out = [], g = G(), b = (S.body || []).filter(x => x.t >= from && x.t < to);
    if (b.length) {
      const z = b[b.length - 1], prev = (S.body || []).filter(x => x.t < (multi ? b[0].t : z.t)).pop();
      if (multi && b.length > 1) {
        const tr = bodyTrend(b);
        out.push(`Peso: ${num(b[0].kg)} → ${num(z.kg)} kg (${sgn(tr.d)} kg en ${spanTxt(tr.weeks)}${tr.weeks >= 1 ? ', ' + sgn(tr.rate) + ' kg/semana' : ''}${g ? '; objetivo +' + num(g.min) + ' a +' + num(g.max) + ' kg/semana' : ''})`);
      } else out.push(`Peso: ${kg(z.kg)}${prev ? ' (' + sgn(z.kg - prev.kg) + ' kg desde el ' + fdm(prev.t) + ')' : ''}`);
    }
    const avg = durAvg(ss);
    if (avg) out.push(`Duración media: ${avg} min (previsto unos ${PLAN_MIN()})`);
    return out;
  }

  /* ---------- calendario ---------- */
  const dayKey = ts => { const d = new Date(ts); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); };
  function vCal() {
    const now = new Date(), cm = view.calM || { y: now.getFullYear(), m: now.getMonth() };
    const first = new Date(cm.y, cm.m, 1).getTime(), lastDay = new Date(cm.y, cm.m + 1, 0).getTime();
    const byDay = {}; S.sessions.forEach(s => { (byDay[dayKey(s.date)] = byDay[dayKey(s.date)] || []).push(s); });
    const worstOf = ss => ss.reduce((m, s) => Math.max(m, s.feel && s.feel.abd != null ? s.feel.abd : s.stopped ? 2 : 0), -1);
    let grid = 'LMXJVSD'.split('').map(c => `<div class="ch">${c}</div>`).join('') + '<div class="ch">Sem</div>';
    for (let w = weekStart(first); w <= lastDay; w = addDays(w, 7)) {
      for (let k = 0; k < 7; k++) {
        const t = addDays(w, k), d = new Date(t), key = dayKey(t), ss = byDay[key] || [], worst = worstOf(ss);
        const cls = ['cd', d.getMonth() === cm.m ? '' : 'out', sameDay(t, now) ? 'now' : '', t > now.getTime() ? 'fut' : '', ss.length ? 'done' : '', view.calSel === key ? 'sel' : ''].join(' ');
        const mk = worst === 2 ? '<i class="m2" aria-hidden="true">▼</i>' : worst === 1 ? '<i class="m1" aria-hidden="true">●</i>' : '';
        const al = `${d.getDate()} ${fdm(t).split(' ')[1]}: ${ss.map(s => (DAY(s.day) || {}).name || s.day).join(', ')}${worst === 1 ? ', molestia leve' : worst === 2 ? ', paró por molestias' : ''}`;
        grid += ss.length ? `<button class="${cls}" data-a="calsel" data-k="${key}" aria-label="${al}" aria-pressed="${view.calSel === key}"><b>${d.getDate()}</b>${mk}</button>`
          : `<div class="${cls}"><b>${d.getDate()}</b></div>`;
      }
      const n = new Set(S.sessions.filter(s => s.date >= w && s.date < addDays(w, 7)).map(s => s.day)).size;
      grid += `<div class="cw ${n >= P.days.length ? 'full' : ''}">${w <= now.getTime() ? n + '/' + P.days.length : ''}</div>`;
    }
    const sel = view.calSel && byDay[view.calSel];
    const detail = sel ? '<div class="cal-det">' + sel.map(s => `<div class="wk-row"><b class="grow">${(DAY(s.day) || {}).name || s.day} · ${fday(s.date)} · ${new Date(s.date).toLocaleTimeString('es-ES', { hour: 'numeric', minute: '2-digit' })}</b><span>${s.mins ? s.mins + ' min' : ''}</span></div>
      ${hasFeel(s.feel) ? `<p class="chips">${feelChips(s.feel)}</p>` : ''}`).join('') + '</div>' : '';
    return `<h2 class="sec">Calendario</h2><section class="card">
      <div class="cal-head"><button class="icon" data-a="calm" data-d="-1" aria-label="Mes anterior">‹</button><h2>${cap(new Date(first).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }))}</h2><button class="icon" data-a="calm" data-d="1" aria-label="Mes siguiente">›</button></div>
      <div class="cal">${grid}</div>
      <p class="cal-leg"><span><i class="sw"></i>Entrenado</span><span><i class="m1">●</i>Molestia leve</span><span><i class="m2">▼</i>Paró por molestias</span><span>2/3 días esa semana</span></p>
      ${detail}</section>`;
  }

  /* ---------- copia de seguridad ---------- */
  let persisted = null;
  async function askPersist() {
    try {
      if (!navigator.storage || !navigator.storage.persist) return;
      persisted = await navigator.storage.persisted();
      if (!persisted) persisted = await navigator.storage.persist();
    } catch (e) { /* no disponible */ }
  }
  const dataCount = () => S.sessions.length + (S.body || []).length;
  function backupDue(now) {
    if (!S.sessions.length || dataCount() === S.backupN) return false;
    if (S.backupSnooze && now - S.backupSnooze < 3 * DAYMS) return false;
    return now - (S.backupAt || S.sessions[0].date) >= (S.backupAt ? 14 : 7) * DAYMS;
  }
  function backupCard(now) {
    if (!backupDue(now)) return '';
    return `<section class="card accent"><p class="eyebrow">Copia de seguridad</p><h2>Guarda una copia de tu histórico</h2>
      <p class="muted">${S.backupAt ? 'La última fue el ' + fdm(S.backupAt) + '.' : 'Aún no has hecho ninguna.'} Tus entrenos solo están en este móvil: guárdala en Drive, en tu correo o en un chat contigo mismo.</p>
      <div class="row"><button class="btn primary" data-a="export">Hacer copia</button><button class="btn ghost" data-a="bksnooze">Ahora no</button></div></section>`;
  }

  /* ---------- vistas ---------- */
  const nav = cur => `<nav class="tabs">${[['home', 'Entreno'], ['hist', 'Histórico'], ['more', 'Más']].map(([v, l]) =>
    `<button data-a="go" data-v="${v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</nav>`;

  function vHome() {
    const now = Date.now(), w0 = weekStart(now);
    const wk = S.sessions.filter(s => s.date >= w0 && s.date < w0 + 7 * DAYMS);
    const doneBy = id => wk.filter(s => s.day === id).pop();
    const next = P.days.find(d => !doneBy(d.id));
    const trainedToday = wk.some(s => sameDay(s.date, now));
    const trainedYday = S.sessions.some(s => sameDay(s.date, now - DAYMS));
    const warmDone = S.warmAt && sameDay(S.warmAt, now);
    const nDone = P.days.filter(d => doneBy(d.id)).length;
    const title = trainedToday ? 'Hoy ya has entrenado' : next ? 'Te toca ' + next.name : 'Semana completa';
    const sub = trainedToday ? 'Descansa y, si te apetece, paseo de 30-45 minutos.'
      : !next ? 'Has hecho los ' + P.days.length + ' días. A descansar hasta el lunes.'
      : trainedYday ? 'Ayer entrenaste y el plan es en días alternos: lo ideal es descansar hoy.' : '';
    const short = d => d.name.replace('Día ', 'D');
    const cells = [...Array(7)].map((_, i) => {
      const d = new Date(w0); d.setDate(d.getDate() + i);
      const ss = wk.filter(s => sameDay(s.date, d)), isToday = sameDay(d, now);
      const plan = P.days.find(p => p.dow === d.getDay());
      const tag = ss.length ? '✓ ' + ss.map(s => short(DAY(s.day))).join('+')
        : plan && !doneBy(plan.id) && (isToday || d.getTime() > now) ? short(plan) : '';
      return `<div class="wd ${ss.length ? 'done' : ''} ${isToday ? 'now' : ''}"><span>${'LMXJVSD'[i]}</span><b>${d.getDate()}</b><i>${tag}</i></div>`;
    }).join('');

    let h = `<header class="top"><p class="eyebrow">${new Date(now).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      <h1>${title}</h1>${sub ? `<p class="muted">${sub}</p>` : ''}</header>
      ${healthAlert(now)}
      <section class="card week"><div class="wk-head"><h2>Esta semana</h2><span class="pill ${nDone === P.days.length ? '' : 'soft'}">${nDone} de ${P.days.length}</span></div>
      <div class="wk-strip">${cells}</div>
      ${P.days.map(d => { const s = doneBy(d.id); return `<div class="wk-row ${s ? 'ok' : ''}"><b>${s ? '✓' : '○'} ${d.name}</b><span>${s ? 'Hecho el ' + dWhen(s.date) + (s.feel && s.feel.abd != null ? ' · ' + ABD_TXT[s.feel.abd] : '') : 'Pendiente · previsto el ' + d.weekday.toLowerCase()}</span></div>`; }).join('')}
      <button class="btn ghost" data-a="report" data-from="home">Resumen para el entrenador</button>
      </section>`;
    h += backupCard(now);
    if (S.active) {
      const a = S.active, d = DAY(a.day);
      h += `<section class="card accent"><h2>Entreno en curso</h2><p>${d.name} — paso ${Math.min(a.i + 1, a.steps.length)} de ${a.steps.length}</p>
        <div class="row"><button class="btn primary" data-a="resume">Continuar</button><button class="btn ghost" data-a="discard">Descartar</button></div></section>`;
    }
    h += `<section class="card ${warmDone ? 'done' : 'first'}"><p class="eyebrow">Lo primero al llegar</p><h2>${warmDone ? '✓ ' : ''}Calentamiento</h2>
      <p class="muted">${P.warmup.minutes} min de cinta o elíptica suave · 105-125 pulsaciones</p>
      <button class="btn ${warmDone || S.active ? 'ghost' : 'primary'}" data-a="warm">${warmDone ? 'Repetir calentamiento' : 'Empezar calentamiento'}</button></section>`;
    P.days.forEach(d => {
      const done = doneBy(d.id), last = [...S.sessions].reverse().find(s => s.day === d.id), hl = !trainedToday && next === d;
      h += `<section class="card ${hl ? 'today' : ''}"><p class="eyebrow">Previsto: ${d.weekday.toLowerCase()}${hl ? ' · el siguiente' : ''}</p><h2>${done ? '✓ ' : ''}${d.name}</h2>
        <ol class="exlist">${dayEx(d).map(id => `<li>${EX(id).name}</li>`).join('')}</ol>
        <p class="muted">${done ? 'Hecho esta semana: ' + dWhen(done.date) : last ? 'Última vez: ' + dWhen(last.date) : 'Aún no lo has hecho'}</p>
        <button class="btn ${hl && !S.active ? 'primary' : 'ghost'}" data-a="pre" data-day="${d.id}">Empezar ${d.name}</button>
        <button class="btn ghost" data-a="manual" data-day="${d.id}">Ya lo hice: apuntar fecha</button></section>`;
    });
    h += `<section class="card"><p class="eyebrow">Al terminar</p><h2>Estiramientos</h2><p class="muted">${P.stretches.length} posturas · ${S.settings.stretch} s cada una, sin rebotes</p>
      <button class="btn ghost" data-a="stretch">Hacer estiramientos</button></section>`;
    h += bodyCard();
    return h + nav('home');
  }

  function vManual() {
    const d = DAY(view.day), nowIn = toInput(Date.now());
    return soloBar(d.name + ' · apuntar') + `<section class="card"><h2>Ya lo hice</h2>
      <p class="muted">Apunta cuándo hiciste el ${d.name}, aunque no fuera su día previsto (${d.weekday.toLowerCase()}).</p>
      <label class="lbl" for="mdt">Fecha y hora de inicio</label><input type="datetime-local" id="mdt" value="${view.mdt || nowIn}" max="${nowIn}">
      <label class="toggle"><span>Hice todas las series con los pesos del plan</span><input type="checkbox" id="mfull" ${view.mfull ? 'checked' : ''}></label>
      <p class="muted">Si lo marcas, se guardan los pesos del plan como cumplidos y servirán de referencia la próxima vez. Si no, solo cuenta como día hecho.</p>
      <label class="lbl" for="mmin">Duración en minutos (opcional)</label><input type="text" class="fld" id="mmin" inputmode="numeric" value="${view.mmin || ''}" placeholder="${PLAN_MIN()}">
      <h3 class="sub">¿Cómo te encontraste? (opcional)</h3>${feelPicker(view.feel || (view.feel = newFeel()), d.id)}
      <button class="btn primary big" data-a="msave" data-day="${d.id}">Guardar</button></section>`;
  }

  function vPre() {
    const d = DAY(view.day);
    return `<header class="bar"><button class="icon" data-a="go" data-v="home" aria-label="Volver">←</button><span>${d.name} · ${d.weekday}</span><span></span></header>
      <section class="card"><h2>Antes de empezar</h2>
      <p class="lbl">Hoy toca</p>${dayList(d)}
      <ul class="checks"><li>He comido hace entre 60 y 90 minutos.</li><li>No he tomado café.</li><li>Me encuentro bien: sin dolor abdominal, hinchazón fuerte ni fiebre.</li></ul>
      <p class="callout"><b>Respiración en todo el entreno:</b> suelta el aire al hacer la fuerza y cógelo al volver. Nunca aguantes el aire: así no sube la presión en el abdomen.</p>
      <button class="btn primary big" data-a="start" data-day="${d.id}">Todo bien, empezar</button>
      <button class="btn ghost" data-a="notwell">Hoy no me encuentro bien</button></section>`;
  }

  const sessionBar = a => `<header class="bar"><button class="icon" data-a="exit" aria-label="Salir">✕</button>
    <span>${DAY(a.day).name} · paso ${Math.min(a.i + 1, a.steps.length)}/${a.steps.length}</span>
    <span class="bar-r">${vBtn()}<button class="icon warn" data-a="stopask" aria-label="Algo no va bien">⚠</button></span></header>
    <div class="prog"><i style="width:${Math.round(a.i / a.steps.length * 100)}%"></i></div>`;

  function vSession() {
    const a = S.active;
    if (!a) { view = { name: 'home' }; return vHome(); }
    if (view.sub === 'stop') return sessionBar(a) + vStop();
    if (a.done) return vSummary();
    if (a.phase === 'rest') return sessionBar(a) + vRest();
    const step = a.steps[a.i];
    if (step.type === 'warm') return sessionBar(a) + vWarm();
    if (step.type === 'stretch') return sessionBar(a) + vStretch();
    if (view.sub === 'log') return sessionBar(a) + vLog(step);
    return sessionBar(a) + vSet(step);
  }

  function vWarm() {
    const w = P.warmup;
    if (!W) W = { left: w.minutes * 60, endAt: 0, run: false };
    return `<section class="stage"><p class="eyebrow">Los 3 días igual</p><h1>${w.name}</h1>
      <div data-fig="${w.fig}"></div>
      <div class="timer" id="wt">${clock(W.run ? (W.endAt - Date.now()) / 1000 : W.left)}</div>
      <ul class="how">${w.how.map(x => `<li>${x}</li>`).join('')}</ul></section>
      <footer class="dock"><button class="btn ghost" data-a="wtoggle" id="wb">${W.run ? 'Pausar' : W.left < w.minutes * 60 ? 'Seguir' : 'Empezar ' + w.minutes + ' min'}</button>
      <button class="btn primary" data-a="wdone">Calentamiento hecho</button></footer>`;
  }

  function vSet(step) {
    const ex = exV(step.ex), set = ex.sets[step.i], tw = targetW(ex, step.i), last = lastLog(ex.id, step.i);
    const timed = set.secs != null;
    let lastTxt = 'Primera vez: empieza con lo que marca el plan.';
    if (last) lastTxt = `Última vez (${dShort(last.at)}): <b>${logText(last)}</b> ${mark(last.st)}` +
      (last.e != null ? ' · fue ' + EFF_TXT[last.e] : '') +
      (last.st === 'low' ? ' — te quedaste por debajo: si hoy tampoco sale limpio, baja un escalón.' : '');
    const vid = ex.vv ? ex.vv.id : null, gTop = gearShown(ex.id, vid);
    const first = !S.active.logs.some(l => l.ex === step.ex), pv = S.active.steps[S.active.i - 1];
    const sb = !(pv && pv.type === 'set' && pv.rest) ? supStart(S.active, step) : null;
    const running = timed && T && T.run, fl = feelFlag(ex.id, first);
    return `<section class="stage">
      <p class="eyebrow">${exPos(step)}</p>
      ${sb ? supCard(sb) : ''}
      <h1>${ex.name}</h1>
      <p class="pill ${hasWarm(ex) && step.i === 0 ? 'soft' : ''}">${setLabel(ex, step.i)}</p>
      ${varPicker(step.ex)}
      ${first ? machineImg(ex) : ''}
      ${gTop ? gearLine(ex.id, vid, '') : ''}
      <div class="target">${timed ? `<div><b id="tt">${running ? clock((T.endAt - Date.now()) / 1000) : set.secs}</b><span>${running ? 'aguanta' : 'segundos'}</span></div>`
        : `<div><b>${set.reps}</b><span>repeticiones</span></div>${tw != null ? `<div><b>${kg(tw).replace(' kg', '')}</b><span>kg ${ex.unit ? '· ' + ex.unit : ''}</span></div>` : ''}`}</div>
      ${ex.perSide ? `<p class="muted center">${ex.perSide}</p>` : ''}
      <p class="last">${lastTxt}</p>
      ${fl ? `<p class="callout">${fl}</p>` : ''}
      ${view.guide ? '<p class="gcount" id="gcount">Preparado…</p>' : ''}
      <div data-fig="${ex.fig}"></div>
      <p class="resp">${ex.resp}</p>
      ${step.info ? `<p class="callout">${step.info}</p>` : ''}
      <details ${last && view.video !== ex.id ? '' : 'open'}><summary>Cómo se hace</summary>
        <ol class="how">${ex.how.map(x => `<li>${x}</li>`).join('')}</ol>
        ${ex.note ? `<p class="callout"><b>Ojo:</b> ${ex.note}</p>` : ''}
        <p class="muted">Músculos: ${ex.muscles}</p>
        ${gTop ? '' : gearLine(ex.id, vid, '')}
        ${videoBlock(ex)}
      </details></section>
      <footer class="dock">${timed
        ? (running ? `<button class="btn ghost big" data-a="tstop">Parar antes</button>` : `<button class="btn primary big" data-a="tstart">Empezar ${set.secs} s</button>`)
        : `<button class="btn ghost" data-a="${view.guide ? 'gstop' : 'guide'}">${view.guide ? 'Parar guía' : 'Guiarme la serie'}</button><button class="btn primary" data-a="done">Serie hecha</button>`}</footer>`;
  }

  function vLog(step) {
    const ex = exV(step.ex), set = ex.sets[step.i], tw = targetW(ex, step.i), L = view.log;
    const stepper = (k, label, val) => `<div class="stepper"><span>${label}</span><div><button data-a="adj" data-k="${k}" data-d="-1" aria-label="Menos">−</button>
      <b>${val}</b><button data-a="adj" data-k="${k}" data-d="1" aria-label="Más">+</button></div></div>`;
    const st = status(L, set, tw);
    const msg = { ok: '✓ Cumplido', up: '▲ Por encima del plan', low: '▼ Por debajo del plan' }[st];
    return `<section class="stage"><p class="eyebrow">${setLabel(ex, step.i)}</p><h1>${ex.name}</h1>
      <p class="muted">¿Qué has hecho de verdad? Objetivo: ${set.secs != null ? set.secs + ' s' : (tw != null ? kg(tw) + ' × ' : '') + set.reps + ' repeticiones'}</p>
      ${L.w != null ? stepper('w', 'Peso', kg(L.w)) : ''}
      ${L.reps != null ? stepper('reps', 'Repeticiones', L.reps) : ''}
      ${L.secs != null ? stepper('secs', 'Segundos', L.secs) : ''}
      <p class="status ${st}">${msg}</p>
      ${st === 'low' ? '<p class="muted center">No pasa nada: la técnica manda sobre el peso. La próxima vez, un escalón menos en esta serie.</p>' : ''}
      ${isTop(ex, step.i) ? `<p class="lbl">¿Cómo fue esta última serie?</p><div class="opts eff" role="group" aria-label="Esfuerzo de la última serie">${EFF.map((l, v) =>
        `<button class="opt ${L.e === v ? 'on' + (v === 2 ? ' mid' : '') : ''}" data-a="effort" data-v="${v}" aria-pressed="${L.e === v}">${l}<small>${EFF_SUB[v]}</small></button>`).join('')}</div>
        ${L.e === 2 ? '<p class="muted center">Al límite es cuando más cuesta no aguantar el aire. Mientras salga así, la app no te propondrá subir peso.</p>' : ''}` : ''}
      </section>
      <footer class="dock"><button class="btn ghost" data-a="back">Volver</button><button class="btn primary" data-a="savelog">Guardar</button></footer>`;
  }
  function status(L, set, tw) {
    if (L.secs != null) return L.secs >= set.secs ? 'ok' : 'low';
    if (L.reps < set.reps || (tw != null && L.w < tw)) return 'low';
    return tw != null && L.w > tw ? 'up' : 'ok';
  }

  function vRest() {
    const a = S.active, step = a.steps[a.i], ex = exV(step.ex), set = ex.sets[step.i], tw = targetW(ex, step.i);
    const prev = a.steps[a.i - 1], g = prev.ex !== step.ex ? gearOf(step.ex, ex.vv && ex.vv.id) : '';
    const sb = supStart(a, step), fresh = !sb && prev.ex !== step.ex && !a.logs.some(l => l.ex === step.ex);
    const ask = canNotify && S.settings.notif == null && Notification.permission !== 'denied';
    return `<section class="stage center"><p class="eyebrow">Descanso · ${a.rest.min === a.rest.max ? a.rest.max : a.rest.min + '-' + a.rest.max} segundos</p>
      <div class="dial" id="dial"><div><b id="rt">${clock(a.rest.max)}</b><span id="rs">Respira lento por la nariz</span></div></div>
      <div class="next"><p class="eyebrow">Siguiente</p><h2>${prev.ex !== step.ex ? ex.name + ' · ' : ''}${setLabel(ex, step.i)}</h2>
      <p class="big-line">${set.secs != null ? set.secs + ' segundos' : set.reps + ' repeticiones' + (tw != null ? ' × ' + kg(tw) : '')}</p>
      ${sb ? supCard(sb) : fresh ? machineImg(ex) : ''}
      ${g && !sb ? `<p class="gear-next"><span aria-hidden="true">🔧</span> ${esc(g)}</p>` : ''}</div></section>
      ${ask ? `<section class="card ask"><p><b>¿Te aviso si sales de la app?</b> Si durante el descanso miras otra cosa, te llegará una notificación cuando toque la siguiente serie.</p>
        <div class="row"><button class="btn ghost" data-a="notifno">No, gracias</button><button class="btn primary" data-a="notifyes">Activar</button></div></section>` : ''}
      <footer class="dock"><button class="btn ghost" data-a="rplus">+15 s</button><button class="btn primary" data-a="rskip">Empezar ya</button></footer>`;
  }

  function stretchSeq() { return P.stretches.flatMap(s => s.sides === 2 ? [{ s, side: 1 }, { s, side: 2 }] : [{ s, side: 0 }]); }
  function vStretch() {
    const seq = stretchSeq();
    if (!ST) ST = { k: 0, phase: 'idle', endAt: 0, left: 0 };
    if (ST.k >= seq.length) return `<section class="stage center"><h1>Estiramientos hechos</h1><p class="muted">Buen trabajo.</p></section>
      <footer class="dock"><button class="btn primary big" data-a="sdone">Terminar</button></footer>`;
    const it = seq[ST.k], dur = S.settings.stretch;
    return `<section class="stage"><p class="eyebrow">Estiramiento ${ST.k + 1} de ${seq.length}</p><h1>${it.s.name}</h1>
      ${it.side ? `<p class="pill soft">Lado ${it.side} de 2</p>` : ''}
      <div data-fig="${it.s.fig}"></div>
      <div class="timer" id="stt">${ST.phase === 'idle' ? dur : clock(ST.phase === 'pause' ? ST.left : (ST.endAt - Date.now()) / 1000)}</div>
      <p class="center muted" id="stl">${ST.phase === 'prep' ? 'Colócate…' : it.s.tip}</p></section>
      <footer class="dock"><button class="btn ghost" data-a="sskip">Saltar</button>
      <button class="btn primary" data-a="stoggle">${ST.phase === 'idle' ? 'Empezar' : ST.phase === 'pause' ? 'Seguir' : 'Pausar'}</button></footer>`;
  }

  function vStop() {
    const ex = curEx(S.active), alt = ex && EX(ex).variants && !curVar(ex) ? EX(ex).variants[0] : null;
    return `<section class="card warn"><h2>¿Algo no va bien?</h2><p><b>Señal de parar:</b> ${P.stop}</p>
      <button class="btn primary big" data-a="stopyes">Parar por hoy</button></section>
      <section class="card"><h2>¿Solo presión o molestia leve?</h2>
      <p class="muted">Sigue la nota «Ojo» del ejercicio si la tiene (por ejemplo, apoyar las rodillas en la plancha) y apúntala${ex ? ' en <b>' + exShort(ex) + '</b>' : ''} para tenerla en cuenta.</p>
      ${alt ? `<button class="btn primary" data-a="varmild" data-ex="${ex}" data-v="${alt.id}">Cambiar a «${alt.short}» y seguir</button>` : ''}
      <button class="btn ghost" data-a="feelmild">Apuntar molestia leve y seguir</button>
      <button class="btn ghost" data-a="back">Seguir sin apuntar</button></section>`;
  }

  function suggestions(a) {
    const out = [], where = (a.feel && a.feel.where) || [];
    dayEx(DAY(a.day)).forEach(id => {
      const ex = EX(id), fi = ex.sets.length - 1;
      if (ex.sets[fi].w == null) return;
      const cur = a.logs.find(l => l.ex === id && l.i === fi);
      if (!cur || cur.st === 'low') return;
      const prev = lastLog(id, fi);
      if (!(prev && prev.st !== 'low' && prev.tw === cur.tw)) return;
      out.push({ ex, cur, hold: where.includes(id) ? 'pain' : cur.e === 2 ? 'hard' : '' });
    });
    return out;
  }
  function vSummary() {
    const a = S.active, d = DAY(a.day), sug = view.sug || (view.sug = {});
    const low = a.logs.filter(l => l.st === 'low').length;
    let h = `<header class="top"><p class="eyebrow">${d.name} · ${d.weekday}</p><h1>${a.stopped ? 'Entreno parado' : 'Entreno terminado'}</h1>
      <p class="muted">${a.logs.length} series registradas · ${durOf(a)} min${low ? ' · ' + low + ' por debajo del plan' : a.logs.length ? ' · todo cumplido' : ''}</p></header>`;
    suggestions(a).forEach(({ ex, cur, hold }) => {
      const s1 = ex.step, s2 = ex.step === 1 ? 2 : ex.step === 2 ? 4 : ex.step === 2.5 ? 5 : 10;
      if (hold && !sug[ex.id]) {
        h += `<section class="card"><p class="eyebrow">Repite el peso</p><h2>${ex.name}</h2><p>Has completado la última serie dos sesiones seguidas, ${hold === 'pain'
          ? 'pero hoy notaste molestia en este ejercicio. Mejor no subir hasta que salga sin molestias.'
          : 'pero hoy fue al límite. Repite el peso hasta que te salga justa o cómoda.'}</p></section>`;
        return;
      }
      h += `<section class="card accent"><p class="eyebrow">Toca subir peso</p><h2>${ex.name}</h2>
        <p>Has completado la última serie dos sesiones seguidas${cur.e != null ? ' y hoy fue ' + EFF_TXT[cur.e] : ''}.</p>
        ${sug[ex.id] ? `<p class="status ok">Subido ${kg(sug[ex.id])} en todas las series para la próxima vez</p>`
          : `<div class="row"><button class="btn primary" data-a="up" data-ex="${ex.id}" data-n="${s1}">+${kg(s1)}</button>
             <button class="btn ghost" data-a="up" data-ex="${ex.id}" data-n="${s2}">+${kg(s2)}</button></div>`}</section>`;
    });
    const f = a.feel || (a.feel = newFeel()), need = view.needFeel && f.abd == null;
    h += `<section class="card ${need ? 'warn' : 'accent'}" id="feelcard"><h2>¿Cómo te has encontrado?</h2>${feelPicker(f, a.day)}
      ${need ? '<p class="status low">Marca la molestia abdominal, aunque sea «Ninguna».</p>' : ''}</section>`;
    h += '<section class="card"><h2>Resumen</h2>' + dayEx(d).map(id => {
      const ls = a.logs.filter(l => l.ex === id);
      return ls.length ? `<div class="hrow"><b>${EX(id).name}</b><p>${ls.map(l => `<span class="chip ${l.st}">${setShort(EX(id), l.i)} ${logText(l)} ${mark(l.st)}</span>${effChip(l)}`).join('')}</p></div>` : '';
    }).join('') + `<label class="lbl" for="sdt">Fecha y hora de inicio</label><input type="datetime-local" id="sdt" value="${a.sdt || toInput(a.t0)}">
      <label class="lbl" for="smin">Duración (minutos)</label><input type="text" class="fld" id="smin" inputmode="numeric" value="${a.smin || durOf(a)}">
      <label class="lbl" for="note">Nota del día (opcional)</label><textarea id="note" rows="2" placeholder="Algo más que quieras recordar…">${esc(a.note || '')}</textarea></section>
      <footer class="dock"><button class="btn primary big" data-a="finish">Guardar y terminar</button></footer>`;
    return h;
  }

  function vHist() {
    let h = '<header class="top"><h1>Histórico</h1><p class="muted">Últimas sesiones de cada ejercicio. ✓ cumplido · ▼ por debajo · ▲ por encima</p></header>';
    if (S.sessions.length) h += '<button class="btn ghost" data-a="report" data-from="hist">Resumen para el entrenador</button>' + vCal();
    h += bodySection();
    if (!S.sessions.length) h += '<section class="card"><p>Todavía no hay entrenos guardados. Cuando termines el primero, aparecerá aquí.</p></section>';
    h += feelStats();
    if (S.sessions.length) h += '<h2 class="sec">Entrenos hechos</h2><section class="card">' +
      S.sessions.map((s, i) => ({ s, i })).slice(-10).reverse().map(({ s, i }) =>
        `<div class="srow"><div><b>${DAY(s.day) ? DAY(s.day).name : s.day}</b>${s.mins ? ` <span class="chip soft">${s.mins} min</span>` : ''}${s.manual ? ' <span class="chip">apuntado a mano</span>' : ''}${s.stopped && !(s.feel && s.feel.abd != null) ? ' <span class="chip low">parado</span>' : ''}
          <input type="datetime-local" data-sdate="${i}" value="${toInput(s.date)}" aria-label="Fecha y hora del entreno">
          <p class="chips">${feelChips(s.feel)}<button class="link" data-a="feeledit" data-i="${i}">${view.editFeel === i ? 'Listo' : hasFeel(s.feel) ? 'Cambiar sensaciones' : '+ Apuntar sensaciones'}</button></p></div>
          <button class="icon" data-a="sdel" data-i="${i}" aria-label="Borrar entreno">✕</button></div>
        ${view.editFeel === i ? `<div class="feeledit">${feelPicker(s.feel || (s.feel = newFeel()), s.day)}</div>` : ''}`).join('') +
      '<p class="muted">' + durAvgTxt() + 'Cambia la fecha u hora si entrenaste en otro momento.</p></section>';
    const hd = view.hday || 'all';
    h += `<h2 class="sec">Por ejercicio</h2><div class="opts filt">${[['all', 'Todos']].concat(P.days.map(d => [d.id, d.name])).map(([k, l]) =>
      `<button class="opt ${hd === k ? 'on' : ''}" data-a="hday" data-d="${k}" aria-pressed="${hd === k}">${l}</button>`).join('')}</div>`;
    P.days.filter(d => hd === 'all' || d.id === hd).forEach(d => {
      h += `<h2 class="sec">${d.name} · previsto ${d.weekday.toLowerCase()}</h2>`;
      dayEx(d).forEach(id => {
        const ex = EX(id), rows = S.sessions.filter(s => s.logs.some(l => l.ex === id)).slice(-5).reverse();
        const weighted = ex.sets[0].w != null;
        const gl = [null].concat((ex.variants || []).map(v => v.id)).filter(vid => gearShown(id, vid))
          .map(vid => gearLine(id, vid, ex.variants ? (vid ? VAR(id, vid).short : ex.vlabel || 'normal') : '')).join('');
        h += `<section class="card"><h3>${ex.name}</h3>${gl}
          ${weighted ? `<div class="adjrow"><span>Objetivo serie ${workCount(ex)}: <b>${kg(targetW(ex, ex.sets.length - 1))}</b>${adj(id) ? ' (plan ' + (adj(id) > 0 ? '+' : '') + kg(adj(id)) + ')' : ''}</span>
            <span><button data-a="tune" data-ex="${id}" data-d="-1" aria-label="Bajar objetivo">−</button><button data-a="tune" data-ex="${id}" data-d="1" aria-label="Subir objetivo">+</button></span></div>` : ''}
          ${chartHtml(id)}
          ${rows.length ? rows.map(s => `<div class="hrow"><b>${dShort(s.date)}</b><p>${s.logs.filter(l => l.ex === id).map(l =>
            `<span class="chip ${l.st}">${setShort(ex, l.i)} ${logText(l)} ${mark(l.st)}</span>${effChip(l)}`).join('')}${varOf(s, id) ? `<span class="chip soft">${cap(varOf(s, id).short)}</span>` : ''}${s.feel && s.feel.where && s.feel.where.includes(id) ? '<span class="chip mid">⚠ molestia</span>' : ''}</p></div>`).join('') : '<p class="muted">Sin registros.</p>'}</section>`;
      });
    });
    const notes = S.sessions.filter(s => s.note || s.stopped).slice(-8).reverse();
    if (notes.length) h += '<h2 class="sec">Notas</h2><section class="card">' + notes.map(s =>
      `<div class="hrow"><b>${dShort(s.date)}</b><p>${s.stopped ? '<span class="chip low">Parado</span> ' : ''}${esc(s.note)}</p></div>`).join('') + '</section>';
    return h + nav('hist');
  }

  function vMore() {
    const st = S.settings, tog = (k, l) => `<label class="toggle"><span>${l}</span><input type="checkbox" data-set="${k}" ${st[k] ? 'checked' : ''}></label>`;
    return `<header class="top"><h1>Más</h1><p class="muted">${P.name} · ${P.period}</p></header>
      <section class="card"><h2>Reglas del entrenador</h2>${P.rules.map(r => `<p><b>${r[0]}.</b> ${r[1]}</p>`).join('')}
        <p class="callout"><b>Señal de parar:</b> ${P.stop}</p></section>
      <section class="card"><h2>Ajustes</h2>${tog('sound', 'Sonido al acabar el descanso')}${tog('vib', 'Vibración')}${tog('voice', 'Voz: guía la respiración y cuenta repeticiones')}
        ${tog('warmSet', 'Serie de calentamiento de 20 repeticiones en cada ejercicio')}<p class="muted">Sin ella, cada ejercicio son 4 series. El cambio vale a partir del siguiente entreno.</p>
        ${canNotify ? `<label class="toggle"><span>Aviso si sales de la app durante el descanso</span><input type="checkbox" data-set="notif" ${notifOn() ? 'checked' : ''}></label>
          ${Notification.permission === 'denied' ? '<p class="muted">El navegador tiene bloqueadas las notificaciones de esta app. Actívalas en los permisos del sitio (el icono junto a la dirección) o en los ajustes de la app del móvil.</p>' : ''}` : ''}
        <label class="toggle"><span>Segundos por estiramiento</span><select data-set="stretch">${[15, 20, 25, 30].map(n => `<option ${st.stretch === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <button class="btn ghost" data-a="test">Probar el aviso de fin de descanso</button>
        ${view.test ? `<p class="muted">${view.test}</p>` : '<p class="muted">Suena y vibra igual que al acabar un descanso. Sube el volumen multimedia del móvil.</p>'}</section>
      <section class="card"><h2>Copia de seguridad</h2><p class="muted">Tu histórico se guarda solo en este móvil. Haz una copia de vez en cuando y guárdala en Drive, en tu correo o en un chat contigo mismo.</p>
        <p>${S.backupAt ? 'Última copia: <b>' + fdm(S.backupAt) + '</b>' + (dataCount() !== S.backupN ? ' · hay datos nuevos desde entonces' : ' · al día') : 'Aún no has hecho ninguna copia.'}</p>
        ${persisted === true ? '<p class="muted">✓ El navegador conservará los datos de la app aunque le falte espacio.</p>'
          : persisted === false ? '<p class="muted">El navegador no garantiza conservar los datos si le falta espacio. Instala la app en la pantalla de inicio y haz copias.</p>' : ''}
        <div class="row"><button class="btn primary" data-a="export">Hacer copia</button><button class="btn ghost" data-a="import">Recuperar copia</button></div>
        <input type="file" id="imp" accept="application/json,.json,text/plain,.txt" hidden></section>
      <section class="card"><h2>Acceso</h2><p class="muted">El plan está cifrado con tu contraseña y este dispositivo la recuerda. Si lo bloqueas, se pedirá otra vez al abrir. Tu histórico no se borra.</p>
        <button class="btn ghost" data-a="lock">Bloquear este dispositivo</button></section>` + nav('more');
  }

  /* ---------- render ---------- */
  const VIEWS = { home: vHome, manual: vManual, report: vReport, pre: vPre, session: vSession, warm: () => soloBar('Calentamiento') + vWarm(), stretch: () => soloBar('Estiramientos') + vStretch(), hist: vHist, more: vMore };
  const soloBar = t => `<header class="bar"><button class="icon" data-a="go" data-v="home" aria-label="Volver">←</button><span>${t}</span><span class="bar-r">${vBtn()}</span></header>`;

  function render(keepScroll) {
    clearInterval(ticker); ticker = null;
    stops.forEach(f => f()); stops = [];
    const y = window.scrollY;
    app.innerHTML = VIEWS[view.name]();
    window.scrollTo(0, keepScroll ? y : 0);
    app.querySelectorAll('[data-fig]').forEach(n => stops.push(window.Anim.mount(n, n.dataset.fig, view.guide ? { on: onGuide, delay: 3 } : null)));
    announce();
    app.querySelectorAll('[data-chart]').forEach(initChart);
    app.querySelectorAll('.mimg img, .sup img').forEach(im => im.addEventListener('error', () => im.remove()));
    const inGym = view.name === 'session' || view.name === 'warm' || view.name === 'stretch';
    keepAwake(inGym);
    if (document.getElementById('dial')) armRest(); else disarmRest();
    if (document.getElementById('wt') && W.run) ticker = setInterval(tickWarm, 250);
    else if (document.getElementById('dial')) { tickRest(); ticker = setInterval(tickRest, 250); }
    else if (document.getElementById('stt') && (ST.phase === 'prep' || ST.phase === 'hold')) ticker = setInterval(tickStretch, 200);
    else if (document.getElementById('tt') && T && T.run) ticker = setInterval(tickTimed, 200);
  }

  function tickWarm() {
    const left = (W.endAt - Date.now()) / 1000;
    document.getElementById('wt').textContent = clock(left);
    if (left <= 0) { W.run = false; W.left = 0; beep(2); say('Calentamiento terminado'); render(true); }
  }
  function tickRest() {
    const r = S.active.rest, el = (Date.now() - r.start) / 1000, left = r.max - el;
    const rt = document.getElementById('rt'), rs = document.getElementById('rs'), dial = document.getElementById('dial');
    rt.textContent = left >= 0 ? clock(left) : '+' + clock(-left);
    dial.style.setProperty('--p', Math.min(1, el / r.max));
    if (el >= r.max) { dial.className = 'dial go'; rs.textContent = '¡A por la siguiente!'; if (!r.b2) { r.b2 = 1; beep(2, 1040); const a = S.active, st = a.steps[a.i]; say('Siguiente. ' + setSpeech(st, a.steps[a.i - 1].ex !== st.ex)); lastSaid = 's' + a.i; } }
    else if (el >= r.min && r.min < r.max) { dial.className = 'dial ready'; rs.textContent = 'Si estás recuperado, ya puedes'; if (!r.b1) { r.b1 = 1; beep(1, 660); say('Si estás recuperado, ya puedes empezar'); } }
  }
  function tickStretch() {
    const left = (ST.endAt - Date.now()) / 1000;
    document.getElementById('stt').textContent = clock(left);
    if (left > 0) return;
    if (ST.phase === 'prep') { ST.phase = 'hold'; ST.endAt = Date.now() + S.settings.stretch * 1000; beep(1, 660); say('Aguanta y respira'); render(true); }
    else { ST.k++; beep(2); if (ST.k < stretchSeq().length) { ST.phase = 'prep'; ST.endAt = Date.now() + 5000; sayStretch(); } else { ST.phase = 'idle'; say('Estiramientos terminados'); } render(); }
  }
  function sayStretch() { const it = stretchSeq()[ST.k]; if (it) say(it.s.name + (it.side ? '. Lado ' + it.side : '')); }
  function tickTimed() {
    const left = (T.endAt - Date.now()) / 1000;
    if (!T.half && T.total >= 20 && left <= T.total / 2) { T.half = 1; say('Mitad. Sigue respirando'); }
    document.getElementById('tt').textContent = clock(left);
    if (left <= 0) { beep(2); say('Tiempo'); openLog(T.total); }
  }
  function openLog(secs) {
    const step = S.active.steps[S.active.i], ex = EX(step.ex), set = ex.sets[step.i], tw = targetW(ex, step.i);
    T = null; view.guide = null; view.video = null; view.sub = 'log';
    view.log = set.secs != null ? { secs: secs != null ? secs : set.secs } : { reps: set.reps, w: tw };
    if (view.log.w == null) delete view.log.w;
    render();
  }

  /* ---------- acciones ---------- */
  const ACT = {
    go: d => { view = { name: d.v }; render(); },
    pre: d => { view = { name: 'pre', day: d.day }; render(); },
    notwell: () => { alert('Señal de parar: ' + P.stop + '\n\nHoy mejor descansa.'); view = { name: 'home' }; render(); },
    start: d => {
      if (S.active && !confirm('Hay un entreno en curso. ¿Descartarlo y empezar este?')) return;
      startDay(d.day);
    },
    resume: () => { view = { name: 'session' }; render(); },
    discard: () => { if (confirm('¿Descartar el entreno en curso? Se pierden las series que llevabas apuntadas.')) { S.active = null; save(); render(); } },
    exit: () => { hush(); view = { name: 'home' }; render(); },
    warm: () => { W = null; view = { name: 'warm' }; render(); },
    stretch: () => { ST = null; view = { name: 'stretch' }; render(); },
    wtoggle: () => {
      if (W.run) { W.left = Math.max(0, (W.endAt - Date.now()) / 1000); W.run = false; }
      else { if (W.left <= 0) W.left = P.warmup.minutes * 60; W.endAt = Date.now() + W.left * 1000; W.run = true; }
      render(true);
    },
    wdone: () => {
      S.warmAt = Date.now(); W = null; save();
      if (view.name === 'session') advance(); else { view = { name: 'home' }; render(); }
    },
    done: () => openLog(),
    tstart: () => { const set = EX(S.active.steps[S.active.i].ex).sets[S.active.steps[S.active.i].i]; T = { run: true, total: set.secs, endAt: Date.now() + set.secs * 1000 }; say('Empieza. Respira con normalidad, sin aguantar el aire'); render(true); },
    tstop: () => openLog(Math.max(0, Math.round(T.total - (T.endAt - Date.now()) / 1000))),
    adj: d => {
      const step = S.active.steps[S.active.i], ex = EX(step.ex), L = view.log, n = +d.d;
      if (d.k === 'w') L.w = Math.max(0, Math.round((L.w + n * (ex.step >= 2.5 ? 2.5 : 1)) * 100) / 100);
      if (d.k === 'reps') L.reps = Math.max(0, L.reps + n);
      if (d.k === 'secs') L.secs = Math.max(0, L.secs + n * 5);
      render(true);
    },
    back: () => { view.sub = null; render(); },
    voice: () => {
      S.settings.voice = !S.settings.voice; save();
      if (S.settings.voice) say('Voz activada'); else hush();
      document.querySelectorAll('[data-a=voice]').forEach(b => { b.textContent = vIcon(); b.setAttribute('aria-label', vLabel()); b.classList.toggle('off', !S.settings.voice); });
    },
    guide: () => { view.guide = { b: '' }; say('Preparado'); render(true); },
    gstop: () => { view.guide = null; hush(); render(true); },
    savelog: () => {
      const a = S.active, step = a.steps[a.i], ex = EX(step.ex), set = ex.sets[step.i], tw = targetW(ex, step.i), L = view.log;
      const log = { ex: step.ex, i: step.i, at: Date.now(), st: status(L, set, tw) }, vv = curVar(step.ex);
      if (vv) log.v = vv.id;
      if (L.e != null) log.e = L.e;
      if (L.secs != null) { log.secs = L.secs; log.ts = set.secs; } else { log.reps = L.reps; log.tr = set.reps; if (tw != null) { log.w = L.w; log.tw = tw; } }
      a.logs.push(log);
      advance();
    },
    rplus: () => { const r = S.active.rest; r.max += 15; r.b2 = 0; save(); render(); },
    rskip: () => { S.active.phase = 'work'; save(); render(); },
    stoggle: () => {
      if (ST.phase === 'idle') { ST.phase = 'prep'; ST.endAt = Date.now() + 5000; sayStretch(); }
      else if (ST.phase === 'pause') { ST.phase = ST.was; ST.endAt = Date.now() + ST.left * 1000; }
      else { ST.was = ST.phase; ST.left = Math.max(0, (ST.endAt - Date.now()) / 1000); ST.phase = 'pause'; }
      render(true);
    },
    sskip: () => { ST.k++; ST.phase = ST.k < stretchSeq().length && ST.phase !== 'idle' ? 'prep' : 'idle'; ST.endAt = Date.now() + 5000; if (ST.phase === 'prep') sayStretch(); render(); },
    sdone: () => { ST = null; if (view.name === 'session') advance(); else { view = { name: 'home' }; render(); } },
    stopask: () => { view.sub = 'stop'; render(); },
    stopyes: () => {
      const a = S.active, f = a.feel || (a.feel = newFeel()), ex = curEx(a);
      a.stopped = true; a.done = true; a.lastAt = Date.now(); f.abd = 2; if (ex && !f.where.includes(ex)) f.where.push(ex);
      view.sub = null; save(); say('Paramos aquí. Apunta cómo te has encontrado.'); render();
    },
    video: d => { view.video = d.ex || null; render(true); },
    gearedit: d => { view.gear = d.k; render(true); const i = document.getElementById('gearin'); if (i) i.focus(); },
    gearcancel: () => { view.gear = null; render(true); },
    photo: d => { photoKey = d.k; phin.value = ''; phin.click(); },
    phdel: d => { if (!confirm('¿Quitar tu foto de esta máquina? Volverá a salir la imagen del vídeo.')) return; delete PH[d.k]; savePhotos(); render(true); },
    gearsave: d => {
      const i = document.getElementById('gearin'), v = i ? i.value.trim().slice(0, 120) : '';
      S.gear = S.gear || {};
      if (v) S.gear[d.k] = v; else delete S.gear[d.k];
      view.gear = null; save(); render(true);
    },
    effort: d => { view.log.e = view.log.e === +d.v ? null : +d.v; render(true); },
    notifyes: async () => {
      let p = 'denied';
      try { p = await Notification.requestPermission(); } catch (e) { /* nada */ }
      S.settings.notif = p === 'granted'; save(); render(true);
    },
    notifno: () => { S.settings.notif = false; save(); render(true); },
    var: d => { const a = S.active; a.vars = a.vars || {}; a.vars[d.ex] = d.v || null; save(); lastSaid = ''; render(true); },
    varmild: d => {
      const a = S.active, f = a.feel || (a.feel = newFeel());
      a.vars = a.vars || {}; a.vars[d.ex] = d.v;
      f.abd = Math.max(f.abd || 0, 1); if (!f.where.includes(d.ex)) f.where.push(d.ex);
      view.sub = null; save(); lastSaid = ''; say('Cambiado. Sigue con calma.'); render();
    },
    feelmild: () => {
      const a = S.active, f = a.feel || (a.feel = newFeel()), ex = curEx(a);
      f.abd = Math.max(f.abd || 0, 1); if (ex && !f.where.includes(ex)) f.where.push(ex);
      view.sub = null; save(); say('Apuntado. Ve con calma y no aguantes el aire.'); render();
    },
    feel: d => { keepForm(); const { f } = feelTarget(); f[d.k] = +d.v; if (d.k === 'abd' && +d.v === 0) f.where = []; save(); render(true); },
    feelex: d => {
      keepForm(); const { f } = feelTarget(), w = f.where || [];
      f.where = w.includes(d.ex) ? w.filter(x => x !== d.ex) : w.concat(d.ex); save(); render(true);
    },
    feeledit: d => { view.editFeel = view.editFeel === +d.i ? null : +d.i; render(true); },
    up: d => { S.adj[d.ex] = adj(d.ex) + +d.n; view.sug[d.ex] = +d.n; keepForm(); save(); render(true); },
    tune: d => { const ex = EX(d.ex); S.adj[d.ex] = adj(d.ex) + +d.d * (ex.step >= 2.5 ? 2.5 : 1); save(); render(true); },
    finish: () => {
      const a = S.active; keepForm();
      if (!a.feel || a.feel.abd == null) {
        view.needFeel = true; render();
        const fc = document.getElementById('feelcard'); if (fc) fc.scrollIntoView({ block: 'center' });
        return;
      }
      const sdt = document.getElementById('sdt'), when = sdt && fromInput(sdt.value), sm = parseMin(a.smin);
      if (when && Math.abs(when - a.t0) > 60000) { a.logs.forEach(l => { l.at = when; }); a.t0c = when; }
      S.sessions.push({ date: a.t0c || a.t0, day: a.day, logs: a.logs, feel: a.feel, note: a.note || '', stopped: !!a.stopped, mins: sm || durOf(a) });
      askPersist();
      sortSessions(); S.active = null; save(); view = { name: 'home' }; render();
    },
    test: () => {
      beep(2, 1040); setTimeout(() => say('Así sonará la voz'), 700);
      const st = S.settings;
      view.test = 'Sonido: ' + (!st.sound ? 'desactivado en los ajustes' : actx ? 'enviado (si no lo oyes, sube el volumen multimedia o quita el modo silencio)' : 'este navegador no lo permite') +
        '. Voz: ' + (!st.voice ? 'desactivada en los ajustes' : canSpeak ? 'enviada' : 'este navegador no la tiene') +
        '. Vibración: ' + (!st.vib ? 'desactivada en los ajustes' : navigator.vibrate ? 'enviada' : 'este móvil no la permite desde una web (pasa en iPhone)') +
        '. Pantalla siempre encendida durante el entreno: ' + (navigator.wakeLock ? 'disponible' : 'no disponible en este navegador') +
        '. Aviso fuera de la app: ' + (!canNotify ? 'este navegador no lo permite' : notifOn() ? 'sal ahora de la app y en 6 segundos te llegará una notificación de prueba'
          : Notification.permission === 'denied' ? 'bloqueado en los permisos del navegador' : 'desactivado (actívalo arriba)') + '.';
      if (notifOn()) setTimeout(() => notify('Prueba de aviso', 'Así te avisará cuando acabe el descanso y estés fuera de la app.', 'test'), 6000);
      render(true);
    },
    lock: () => { try { localStorage.removeItem('entreno.key'); } catch (e) { /* nada */ } location.reload(); },
    report: d => { view = { name: 'report', from: d.from || 'home', mode: 'week' }; render(); },
    hday: d => { view.hday = d.d; render(true); },
    rmode: d => { view.mode = d.m; render(true); },
    rcopy: async () => {
      const t = document.getElementById('rtxt'), b = document.querySelector('[data-a=rcopy]');
      let ok = true;
      try { await navigator.clipboard.writeText(t.value); } catch (e) { t.select(); ok = document.execCommand && document.execCommand('copy'); }
      if (b) { b.textContent = ok ? '¡Copiado!' : 'Selecciónalo y cópialo'; setTimeout(() => { b.textContent = 'Copiar'; }, 2500); }
    },
    rshare: async () => {
      const t = document.getElementById('rtxt').value;
      try { await navigator.share({ text: t }); } catch (e) { /* cancelado */ }
    },
    manual: d => { view = { name: 'manual', day: d.day, feel: newFeel() }; render(); },
    msave: d => {
      const ts = fromInput(document.getElementById('mdt').value);
      if (!ts) { alert('Revisa la fecha: no puede estar vacía ni ser futura.'); return; }
      const logs = [];
      if (document.getElementById('mfull').checked) dayEx(DAY(d.day)).forEach(id => {
        const ex = EX(id);
        ex.sets.forEach((s, i) => {
          if (!useSet(ex, i)) return;
          const tw = targetW(ex, i), l = { ex: id, i, at: ts, st: 'ok' };
          if (s.secs != null) { l.secs = s.secs; l.ts = s.secs; } else { l.reps = s.reps; l.tr = s.reps; if (tw != null) { l.w = tw; l.tw = tw; } }
          logs.push(l);
        });
      });
      S.sessions.push({ date: ts, day: d.day, logs, feel: hasFeel(view.feel) ? view.feel : undefined, note: '', stopped: false, manual: true, mins: parseMin((document.getElementById('mmin') || {}).value) || undefined });
      sortSessions(); save(); view = { name: 'home' }; render();
    },
    sdel: d => {
      const s = S.sessions[+d.i];
      if (s && confirm('¿Borrar el entreno del ' + dWhen(s.date) + '? No se puede deshacer.')) { S.sessions.splice(+d.i, 1); view.editFeel = null; save(); render(true); }
    },
    export: async () => {
      // .txt para que el menú de compartir del móvil lo acepte (Drive, correo, WhatsApp…); dentro va el histórico en JSON
      const name = 'entreno-copia-' + new Date().toISOString().slice(0, 10) + '.txt';
      const file = new File([JSON.stringify(Object.keys(PH).length ? Object.assign({}, S, { fotos: PH }) : S, null, 1)], name, { type: 'text/plain' });
      let shared = false;
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'Copia de Mi entreno' }); shared = true; }
        catch (e) { if (e && e.name === 'AbortError') return; }
      }
      if (!shared) {
        const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      }
      S.backupAt = Date.now(); S.backupN = dataCount(); S.backupSnooze = 0; save(); render(true);
    },
    bksnooze: () => { S.backupSnooze = Date.now(); save(); render(true); },
    bwsave: d => {
      const v = parseKg((document.getElementById(d.in) || {}).value);
      if (v == null) { alert('Escribe tu peso en kilos, por ejemplo 73,4.'); return; }
      const now = Date.now(), w0 = weekStart(now);
      S.body = (S.body || []).filter(x => x.t < w0).concat({ t: now, kg: v });
      save(); render(true);
    },
    bwdel: d => {
      if (!confirm('¿Borrar el peso del ' + fdm(+d.t) + '?')) return;
      S.body = (S.body || []).filter(x => x.t !== +d.t); save(); render(true);
    },
    calm: d => {
      const now = new Date(), c = view.calM || { y: now.getFullYear(), m: now.getMonth() };
      let m = c.m + +d.d, y = c.y;
      if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
      view.calM = { y, m }; view.calSel = null; render(true);
    },
    calsel: d => { view.calSel = view.calSel === d.k ? null : d.k; render(true); },
    import: () => document.getElementById('imp').click()
  };
  function keepNote() { const n = document.getElementById('note'); if (n && S.active) S.active.note = n.value; }

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    unlockAudio();
    ACT[b.dataset.a](b.dataset);
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !e.target || e.target.id !== 'gearin') return;
    e.preventDefault(); const b = document.querySelector('[data-a=gearsave]'); if (b) b.click();
  });
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.sdate != null) {
      const ts = fromInput(t.value), s = S.sessions[+t.dataset.sdate];
      if (ts && s) { s.date = ts; s.logs.forEach(l => { l.at = ts; }); sortSessions(); view.editFeel = null; save(); }
      else alert('Revisa la fecha: no puede estar vacía ni ser futura.');
      render(true);
    }
    if (t.dataset.set === 'notif') {
      if (!t.checked) { S.settings.notif = false; save(); render(true); return; }
      Notification.requestPermission().then(p => { S.settings.notif = p === 'granted'; save(); render(true); }).catch(() => {});
      return;
    }
    if (t.dataset.set) { S.settings[t.dataset.set] = t.type === 'checkbox' ? t.checked : +t.value; save(); }
    if (t.id === 'phin' && t.files[0] && photoKey) {
      const k = photoKey;
      shrink(t.files[0]).then(url => {
        PH[k] = url;
        if (!savePhotos()) { delete PH[k]; alert('No queda sitio en el móvil para más fotos de la app.'); }
        render(true);
      }).catch(() => alert('No se ha podido leer la foto.'));
    }
    if (t.id === 'imp' && t.files[0]) t.files[0].text().then(txt => {
      try {
        const d = JSON.parse(txt);
        if (!Array.isArray(d.sessions)) throw 0;
        if (confirm('Se sustituirá el histórico de este móvil por el de la copia (' + d.sessions.length + ' entrenos). ¿Continuar?')) {
          if (d.fotos) { PH = d.fotos; savePhotos(); delete d.fotos; }
          localStorage.setItem(KEY, JSON.stringify(d)); S = load(); render();
        }
      } catch (err) { alert('Ese archivo no es una copia válida.'); }
    });
  });

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  render();
  askPersist();
})();
