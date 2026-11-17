(() => {
  'use strict';
  const P = window.PLAN, KEY = 'entreno.v1';
  const app = document.getElementById('app');
  Object.keys(P.exercises).forEach(k => { P.exercises[k].id = k; });
  const DEF = { sessions: [], adj: {}, settings: { sound: true, vib: true, stretch: 15 }, active: null, warmAt: 0 };

  /* ---------- estado ---------- */
  let S = load();
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || '{}');
      return Object.assign({}, DEF, d, { settings: Object.assign({}, DEF.settings, d.settings || {}) });
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
  async function keepAwake(on) {
    try {
      if (on && !wake && navigator.wakeLock) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); }
      if (!on && wake) { await wake.release(); wake = null; }
    } catch (e) { /* no disponible */ }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && view.name !== 'home' && view.name !== 'hist' && view.name !== 'more') keepAwake(true);
  });

  /* ---------- sesión ---------- */
  function buildSteps(day, withWarm) {
    const steps = [];
    if (withWarm) steps.push({ type: 'warm' });
    day.blocks.forEach(b => {
      if (typeof b === 'string') {
        const ex = EX(b);
        ex.sets.forEach((s, i) => steps.push({ type: 'set', ex: b, i, rest: ex.rest }));
      } else {
        const rounds = Math.max(...b.ex.map(id => EX(id).sets.length));
        for (let r = 0; r < rounds; r++) b.ex.forEach((id, k) => {
          if (EX(id).sets[r]) steps.push({ type: 'set', ex: id, i: r, rest: k < b.ex.length - 1 ? b.between : b.rest, group: b.label, info: b.info });
        });
      }
    });
    steps.push({ type: 'stretch' });
    return steps;
  }
  function startDay(dayId) {
    const warmDone = Date.now() - S.warmAt < 3 * 3600 * 1000;
    S.active = { day: dayId, steps: buildSteps(DAY(dayId), !warmDone), i: 0, phase: 'work', logs: [], t0: Date.now() };
    save(); W = null; ST = null; T = null;
    view = { name: 'session' }; render();
  }
  function advance() {
    const a = S.active, step = a.steps[a.i], next = a.steps[a.i + 1];
    a.i++; view.sub = null; T = null;
    if (a.i >= a.steps.length) a.done = true;
    else if (step.type === 'set' && step.rest && next.type === 'set') {
      a.phase = 'rest'; a.rest = { start: Date.now(), min: step.rest[0], max: step.rest[1] };
    } else a.phase = 'work';
    save(); render();
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
      <section class="card week"><div class="wk-head"><h2>Esta semana</h2><span class="pill ${nDone === P.days.length ? '' : 'soft'}">${nDone} de ${P.days.length}</span></div>
      <div class="wk-strip">${cells}</div>
      ${P.days.map(d => { const s = doneBy(d.id); return `<div class="wk-row ${s ? 'ok' : ''}"><b>${s ? '✓' : '○'} ${d.name}</b><span>${s ? 'Hecho el ' + dWhen(s.date) : 'Pendiente · previsto el ' + d.weekday.toLowerCase()}</span></div>`; }).join('')}
      </section>`;
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
    return h + nav('home');
  }

  function vManual() {
    const d = DAY(view.day), nowIn = toInput(Date.now());
    return soloBar(d.name + ' · apuntar') + `<section class="card"><h2>Ya lo hice</h2>
      <p class="muted">Apunta cuándo hiciste el ${d.name}, aunque no fuera su día previsto (${d.weekday.toLowerCase()}).</p>
      <label class="lbl" for="mdt">Fecha y hora de inicio</label><input type="datetime-local" id="mdt" value="${nowIn}" max="${nowIn}">
      <label class="toggle"><span>Hice todas las series con los pesos del plan</span><input type="checkbox" id="mfull"></label>
      <p class="muted">Si lo marcas, se guardan los pesos del plan como cumplidos y servirán de referencia la próxima vez. Si no, solo cuenta como día hecho.</p>
      <button class="btn primary big" data-a="msave" data-day="${d.id}">Guardar</button></section>`;
  }

  function vPre() {
    const d = DAY(view.day);
    return `<header class="bar"><button class="icon" data-a="go" data-v="home" aria-label="Volver">←</button><span>${d.name} · ${d.weekday}</span><span></span></header>
      <section class="card"><h2>Antes de empezar</h2>
      <ul class="checks"><li>He comido hace entre 60 y 90 minutos.</li><li>No he tomado café.</li><li>Me encuentro bien: sin dolor abdominal, hinchazón fuerte ni fiebre.</li></ul>
      <p class="callout"><b>Respiración en todo el entreno:</b> suelta el aire al hacer la fuerza y cógelo al volver. Nunca aguantes el aire: así no sube la presión en el abdomen.</p>
      <button class="btn primary big" data-a="start" data-day="${d.id}">Todo bien, empezar</button>
      <button class="btn ghost" data-a="notwell">Hoy no me encuentro bien</button></section>`;
  }

  const sessionBar = a => `<header class="bar"><button class="icon" data-a="exit" aria-label="Salir">✕</button>
    <span>${DAY(a.day).name} · paso ${Math.min(a.i + 1, a.steps.length)}/${a.steps.length}</span>
    <button class="icon warn" data-a="stopask" aria-label="Algo no va bien">⚠</button></header>
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
    const ex = EX(step.ex), set = ex.sets[step.i], tw = targetW(ex, step.i), last = lastLog(ex.id, step.i);
    const timed = set.secs != null;
    let lastTxt = 'Primera vez: empieza con lo que marca el plan.';
    if (last) lastTxt = `Última vez (${dShort(last.at)}): <b>${logText(last)}</b> ${mark(last.st)}` +
      (last.st === 'low' ? ' — te quedaste por debajo: si hoy tampoco sale limpio, baja un escalón.' : '');
    const running = timed && T && T.run;
    return `<section class="stage">
      ${step.group ? `<p class="eyebrow">${step.group}</p>` : ''}
      <h1>${ex.name}</h1>
      <p class="pill ${hasWarm(ex) && step.i === 0 ? 'soft' : ''}">${setLabel(ex, step.i)}</p>
      <div class="target">${timed ? `<div><b id="tt">${running ? clock((T.endAt - Date.now()) / 1000) : set.secs}</b><span>${running ? 'aguanta' : 'segundos'}</span></div>`
        : `<div><b>${set.reps}</b><span>repeticiones</span></div>${tw != null ? `<div><b>${kg(tw).replace(' kg', '')}</b><span>kg ${ex.unit ? '· ' + ex.unit : ''}</span></div>` : ''}`}</div>
      ${ex.perSide ? `<p class="muted center">${ex.perSide}</p>` : ''}
      <p class="last">${lastTxt}</p>
      <div data-fig="${ex.fig}"></div>
      <p class="resp">${ex.resp}</p>
      ${step.info ? `<p class="callout">${step.info}</p>` : ''}
      <details ${last ? '' : 'open'}><summary>Cómo se hace</summary>
        <ol class="how">${ex.how.map(x => `<li>${x}</li>`).join('')}</ol>
        ${ex.note ? `<p class="callout"><b>Ojo:</b> ${ex.note}</p>` : ''}
        <p class="muted">Músculos: ${ex.muscles}</p>
        <a class="video" target="_blank" rel="noopener" href="${ex.url || 'https://www.youtube.com/results?search_query=' + encodeURIComponent(ex.video)}">▶ ${ex.url ? 'Ver' : 'Buscar'} el vídeo del entrenador</a>
      </details></section>
      <footer class="dock">${timed
        ? (running ? `<button class="btn ghost big" data-a="tstop">Parar antes</button>` : `<button class="btn primary big" data-a="tstart">Empezar ${set.secs} s</button>`)
        : `<button class="btn primary big" data-a="done">Serie hecha</button>`}</footer>`;
  }

  function vLog(step) {
    const ex = EX(step.ex), set = ex.sets[step.i], tw = targetW(ex, step.i), L = view.log;
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
      </section>
      <footer class="dock"><button class="btn ghost" data-a="back">Volver</button><button class="btn primary" data-a="savelog">Guardar</button></footer>`;
  }
  function status(L, set, tw) {
    if (L.secs != null) return L.secs >= set.secs ? 'ok' : 'low';
    if (L.reps < set.reps || (tw != null && L.w < tw)) return 'low';
    return tw != null && L.w > tw ? 'up' : 'ok';
  }

  function vRest() {
    const a = S.active, step = a.steps[a.i], ex = EX(step.ex), set = ex.sets[step.i], tw = targetW(ex, step.i);
    const prev = a.steps[a.i - 1];
    return `<section class="stage center"><p class="eyebrow">Descanso · ${a.rest.min === a.rest.max ? a.rest.max : a.rest.min + '-' + a.rest.max} segundos</p>
      <div class="dial" id="dial"><div><b id="rt">${clock(a.rest.max)}</b><span id="rs">Respira lento por la nariz</span></div></div>
      <div class="next"><p class="eyebrow">Siguiente</p><h2>${prev.ex !== step.ex ? ex.name + ' · ' : ''}${setLabel(ex, step.i)}</h2>
      <p class="big-line">${set.secs != null ? set.secs + ' segundos' : set.reps + ' repeticiones' + (tw != null ? ' × ' + kg(tw) : '')}</p></div></section>
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
    return `<section class="card warn"><h2>¿Algo no va bien?</h2><p><b>Señal de parar:</b> ${P.stop}</p>
      <p class="muted">Si solo es presión o molestia leve en un ejercicio, sigue la nota «Ojo» de ese ejercicio (por ejemplo, apoyar las rodillas en la plancha).</p>
      <button class="btn primary big" data-a="stopyes">Parar por hoy</button><button class="btn ghost" data-a="back">Seguir entrenando</button></section>`;
  }

  function suggestions(a) {
    const out = [];
    dayEx(DAY(a.day)).forEach(id => {
      const ex = EX(id), fi = ex.sets.length - 1;
      if (ex.sets[fi].w == null) return;
      const cur = a.logs.find(l => l.ex === id && l.i === fi);
      if (!cur || cur.st === 'low') return;
      const prev = lastLog(id, fi);
      if (prev && prev.st !== 'low' && prev.tw === cur.tw) out.push(ex);
    });
    return out;
  }
  function vSummary() {
    const a = S.active, d = DAY(a.day), sug = view.sug || (view.sug = {});
    const low = a.logs.filter(l => l.st === 'low').length;
    let h = `<header class="top"><p class="eyebrow">${d.name} · ${d.weekday}</p><h1>${a.stopped ? 'Entreno parado' : 'Entreno terminado'}</h1>
      <p class="muted">${a.logs.length} series registradas${low ? ' · ' + low + ' por debajo del plan' : a.logs.length ? ' · todo cumplido' : ''}</p></header>`;
    suggestions(a).forEach(ex => {
      const s1 = ex.step, s2 = ex.step === 1 ? 2 : ex.step === 2 ? 4 : ex.step === 2.5 ? 5 : 10;
      h += `<section class="card accent"><p class="eyebrow">Toca subir peso</p><h2>${ex.name}</h2>
        <p>Has completado la serie 4 dos sesiones seguidas.</p>
        ${sug[ex.id] ? `<p class="status ok">Subido ${kg(sug[ex.id])} en todas las series para la próxima vez</p>`
          : `<div class="row"><button class="btn primary" data-a="up" data-ex="${ex.id}" data-n="${s1}">+${kg(s1)}</button>
             <button class="btn ghost" data-a="up" data-ex="${ex.id}" data-n="${s2}">+${kg(s2)}</button></div>`}</section>`;
    });
    h += '<section class="card"><h2>Resumen</h2>' + dayEx(d).map(id => {
      const ls = a.logs.filter(l => l.ex === id);
      return ls.length ? `<div class="hrow"><b>${EX(id).name}</b><p>${ls.map(l => `<span class="chip ${l.st}">${setShort(EX(id), l.i)} ${logText(l)} ${mark(l.st)}</span>`).join('')}</p></div>` : '';
    }).join('') + `<label class="lbl" for="sdt">Fecha y hora de inicio</label><input type="datetime-local" id="sdt" value="${toInput(a.t0)}">
      <label class="lbl" for="note">Nota del día (opcional)</label><textarea id="note" rows="2" placeholder="Cómo te has encontrado, molestias…">${esc(a.note || '')}</textarea></section>
      <footer class="dock"><button class="btn primary big" data-a="finish">Guardar y terminar</button></footer>`;
    return h;
  }

  function vHist() {
    let h = '<header class="top"><h1>Histórico</h1><p class="muted">Últimas sesiones de cada ejercicio. ✓ cumplido · ▼ por debajo · ▲ por encima</p></header>';
    if (!S.sessions.length) h += '<section class="card"><p>Todavía no hay entrenos guardados. Cuando termines el primero, aparecerá aquí.</p></section>';
    if (S.sessions.length) h += '<h2 class="sec">Entrenos hechos</h2><section class="card">' +
      S.sessions.map((s, i) => ({ s, i })).slice(-10).reverse().map(({ s, i }) =>
        `<div class="srow"><div><b>${DAY(s.day) ? DAY(s.day).name : s.day}</b>${s.manual ? ' <span class="chip">apuntado a mano</span>' : ''}${s.stopped ? ' <span class="chip low">parado</span>' : ''}
          <input type="datetime-local" data-sdate="${i}" value="${toInput(s.date)}" aria-label="Fecha y hora del entreno"></div>
          <button class="icon" data-a="sdel" data-i="${i}" aria-label="Borrar entreno">✕</button></div>`).join('') +
      '<p class="muted">Cambia la fecha u hora si entrenaste en otro momento.</p></section>';
    P.days.forEach(d => {
      h += `<h2 class="sec">${d.name} · previsto ${d.weekday.toLowerCase()}</h2>`;
      dayEx(d).forEach(id => {
        const ex = EX(id), rows = S.sessions.filter(s => s.logs.some(l => l.ex === id)).slice(-5).reverse();
        const weighted = ex.sets[0].w != null;
        h += `<section class="card"><h3>${ex.name}</h3>
          ${weighted ? `<div class="adjrow"><span>Objetivo serie ${workCount(ex)}: <b>${kg(targetW(ex, ex.sets.length - 1))}</b>${adj(id) ? ' (plan ' + (adj(id) > 0 ? '+' : '') + kg(adj(id)) + ')' : ''}</span>
            <span><button data-a="tune" data-ex="${id}" data-d="-1" aria-label="Bajar objetivo">−</button><button data-a="tune" data-ex="${id}" data-d="1" aria-label="Subir objetivo">+</button></span></div>` : ''}
          ${rows.length ? rows.map(s => `<div class="hrow"><b>${dShort(s.date)}</b><p>${s.logs.filter(l => l.ex === id).map(l =>
            `<span class="chip ${l.st}">${setShort(ex, l.i)} ${logText(l)} ${mark(l.st)}</span>`).join('')}</p></div>`).join('') : '<p class="muted">Sin registros.</p>'}</section>`;
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
      <section class="card"><h2>Ajustes</h2>${tog('sound', 'Sonido al acabar el descanso')}${tog('vib', 'Vibración')}
        <label class="toggle"><span>Segundos por estiramiento</span><select data-set="stretch">${[15, 20, 25, 30].map(n => `<option ${st.stretch === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <button class="btn ghost" data-a="test">Probar el aviso de fin de descanso</button>
        ${view.test ? `<p class="muted">${view.test}</p>` : '<p class="muted">Suena y vibra igual que al acabar un descanso. Sube el volumen multimedia del móvil.</p>'}</section>
      <section class="card"><h2>Copia de seguridad</h2><p class="muted">El histórico se guarda solo en este móvil. Exporta una copia de vez en cuando.</p>
        <div class="row"><button class="btn ghost" data-a="export">Exportar</button><button class="btn ghost" data-a="import">Importar</button></div>
        <input type="file" id="imp" accept="application/json,.json" hidden></section>
      <section class="card"><h2>Acceso</h2><p class="muted">El plan está cifrado con tu contraseña y este dispositivo la recuerda. Si lo bloqueas, se pedirá otra vez al abrir. Tu histórico no se borra.</p>
        <button class="btn ghost" data-a="lock">Bloquear este dispositivo</button></section>` + nav('more');
  }

  /* ---------- render ---------- */
  const VIEWS = { home: vHome, manual: vManual, pre: vPre, session: vSession, warm: () => soloBar('Calentamiento') + vWarm(), stretch: () => soloBar('Estiramientos') + vStretch(), hist: vHist, more: vMore };
  const soloBar = t => `<header class="bar"><button class="icon" data-a="go" data-v="home" aria-label="Volver">←</button><span>${t}</span><span></span></header>`;

  function render(keepScroll) {
    clearInterval(ticker); ticker = null;
    stops.forEach(f => f()); stops = [];
    const y = window.scrollY;
    app.innerHTML = VIEWS[view.name]();
    window.scrollTo(0, keepScroll ? y : 0);
    app.querySelectorAll('[data-fig]').forEach(n => stops.push(window.Anim.mount(n, n.dataset.fig)));
    const inGym = view.name === 'session' || view.name === 'warm' || view.name === 'stretch';
    keepAwake(inGym);
    if (document.getElementById('wt') && W.run) ticker = setInterval(tickWarm, 250);
    else if (document.getElementById('dial')) { tickRest(); ticker = setInterval(tickRest, 250); }
    else if (document.getElementById('stt') && (ST.phase === 'prep' || ST.phase === 'hold')) ticker = setInterval(tickStretch, 200);
    else if (document.getElementById('tt') && T && T.run) ticker = setInterval(tickTimed, 200);
  }

  function tickWarm() {
    const left = (W.endAt - Date.now()) / 1000;
    document.getElementById('wt').textContent = clock(left);
    if (left <= 0) { W.run = false; W.left = 0; beep(2); render(true); }
  }
  function tickRest() {
    const r = S.active.rest, el = (Date.now() - r.start) / 1000, left = r.max - el;
    const rt = document.getElementById('rt'), rs = document.getElementById('rs'), dial = document.getElementById('dial');
    rt.textContent = left >= 0 ? clock(left) : '+' + clock(-left);
    dial.style.setProperty('--p', Math.min(1, el / r.max));
    if (el >= r.max) { dial.className = 'dial go'; rs.textContent = '¡A por la siguiente!'; if (!r.b2) { r.b2 = 1; beep(2, 1040); } }
    else if (el >= r.min && r.min < r.max) { dial.className = 'dial ready'; rs.textContent = 'Si estás recuperado, ya puedes'; if (!r.b1) { r.b1 = 1; beep(1, 660); } }
  }
  function tickStretch() {
    const left = (ST.endAt - Date.now()) / 1000;
    document.getElementById('stt').textContent = clock(left);
    if (left > 0) return;
    if (ST.phase === 'prep') { ST.phase = 'hold'; ST.endAt = Date.now() + S.settings.stretch * 1000; beep(1, 660); render(true); }
    else { ST.k++; beep(2); if (ST.k < stretchSeq().length) { ST.phase = 'prep'; ST.endAt = Date.now() + 5000; } else ST.phase = 'idle'; render(); }
  }
  function tickTimed() {
    const left = (T.endAt - Date.now()) / 1000;
    document.getElementById('tt').textContent = clock(left);
    if (left <= 0) { beep(2); openLog(T.total); }
  }
  function openLog(secs) {
    const step = S.active.steps[S.active.i], ex = EX(step.ex), set = ex.sets[step.i], tw = targetW(ex, step.i);
    T = null; view.sub = 'log';
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
    exit: () => { view = { name: 'home' }; render(); },
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
    tstart: () => { const set = EX(S.active.steps[S.active.i].ex).sets[S.active.steps[S.active.i].i]; T = { run: true, total: set.secs, endAt: Date.now() + set.secs * 1000 }; render(true); },
    tstop: () => openLog(Math.max(0, Math.round(T.total - (T.endAt - Date.now()) / 1000))),
    adj: d => {
      const step = S.active.steps[S.active.i], ex = EX(step.ex), L = view.log, n = +d.d;
      if (d.k === 'w') L.w = Math.max(0, Math.round((L.w + n * (ex.step >= 2.5 ? 2.5 : 1)) * 100) / 100);
      if (d.k === 'reps') L.reps = Math.max(0, L.reps + n);
      if (d.k === 'secs') L.secs = Math.max(0, L.secs + n * 5);
      render(true);
    },
    back: () => { view.sub = null; render(); },
    savelog: () => {
      const a = S.active, step = a.steps[a.i], ex = EX(step.ex), set = ex.sets[step.i], tw = targetW(ex, step.i), L = view.log;
      const log = { ex: step.ex, i: step.i, at: Date.now(), st: status(L, set, tw) };
      if (L.secs != null) { log.secs = L.secs; log.ts = set.secs; } else { log.reps = L.reps; log.tr = set.reps; if (tw != null) { log.w = L.w; log.tw = tw; } }
      a.logs.push(log);
      advance();
    },
    rplus: () => { const r = S.active.rest; r.max += 15; r.b2 = 0; save(); render(); },
    rskip: () => { S.active.phase = 'work'; save(); render(); },
    stoggle: () => {
      if (ST.phase === 'idle') { ST.phase = 'prep'; ST.endAt = Date.now() + 5000; }
      else if (ST.phase === 'pause') { ST.phase = ST.was; ST.endAt = Date.now() + ST.left * 1000; }
      else { ST.was = ST.phase; ST.left = Math.max(0, (ST.endAt - Date.now()) / 1000); ST.phase = 'pause'; }
      render(true);
    },
    sskip: () => { ST.k++; ST.phase = ST.k < stretchSeq().length && ST.phase !== 'idle' ? 'prep' : 'idle'; ST.endAt = Date.now() + 5000; render(); },
    sdone: () => { ST = null; if (view.name === 'session') advance(); else { view = { name: 'home' }; render(); } },
    stopask: () => { view.sub = 'stop'; render(); },
    stopyes: () => { const a = S.active; a.stopped = true; a.done = true; view.sub = null; save(); render(); },
    up: d => { S.adj[d.ex] = adj(d.ex) + +d.n; view.sug[d.ex] = +d.n; keepNote(); save(); render(true); },
    tune: d => { const ex = EX(d.ex); S.adj[d.ex] = adj(d.ex) + +d.d * (ex.step >= 2.5 ? 2.5 : 1); save(); render(true); },
    finish: () => {
      const a = S.active; keepNote();
      const sdt = document.getElementById('sdt'), when = sdt && fromInput(sdt.value);
      if (when && Math.abs(when - a.t0) > 60000) { a.logs.forEach(l => { l.at = when; }); a.t0c = when; }
      S.sessions.push({ date: a.t0c || a.t0, day: a.day, logs: a.logs, note: a.note || '', stopped: !!a.stopped, mins: Math.round((Date.now() - a.t0) / 60000) });
      sortSessions(); S.active = null; save(); view = { name: 'home' }; render();
    },
    test: () => {
      beep(2, 1040);
      const st = S.settings;
      view.test = 'Sonido: ' + (!st.sound ? 'desactivado en los ajustes' : actx ? 'enviado (si no lo oyes, sube el volumen multimedia o quita el modo silencio)' : 'este navegador no lo permite') +
        '. Vibración: ' + (!st.vib ? 'desactivada en los ajustes' : navigator.vibrate ? 'enviada' : 'este móvil no la permite desde una web (pasa en iPhone)') +
        '. Pantalla siempre encendida durante el entreno: ' + (navigator.wakeLock ? 'disponible' : 'no disponible en este navegador') + '.';
      render(true);
    },
    lock: () => { try { localStorage.removeItem('entreno.key'); } catch (e) { /* nada */ } location.reload(); },
    manual: d => { view = { name: 'manual', day: d.day }; render(); },
    msave: d => {
      const ts = fromInput(document.getElementById('mdt').value);
      if (!ts) { alert('Revisa la fecha: no puede estar vacía ni ser futura.'); return; }
      const logs = [];
      if (document.getElementById('mfull').checked) dayEx(DAY(d.day)).forEach(id => {
        const ex = EX(id);
        ex.sets.forEach((s, i) => {
          const tw = targetW(ex, i), l = { ex: id, i, at: ts, st: 'ok' };
          if (s.secs != null) { l.secs = s.secs; l.ts = s.secs; } else { l.reps = s.reps; l.tr = s.reps; if (tw != null) { l.w = tw; l.tw = tw; } }
          logs.push(l);
        });
      });
      S.sessions.push({ date: ts, day: d.day, logs, note: '', stopped: false, manual: true });
      sortSessions(); save(); view = { name: 'home' }; render();
    },
    sdel: d => {
      const s = S.sessions[+d.i];
      if (s && confirm('¿Borrar el entreno del ' + dWhen(s.date) + '? No se puede deshacer.')) { S.sessions.splice(+d.i, 1); save(); render(true); }
    },
    export: () => {
      const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' }), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = 'entreno-' + new Date().toISOString().slice(0, 10) + '.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    },
    import: () => document.getElementById('imp').click()
  };
  function keepNote() { const n = document.getElementById('note'); if (n && S.active) S.active.note = n.value; }

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    unlockAudio();
    ACT[b.dataset.a](b.dataset);
  });
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.dataset.sdate != null) {
      const ts = fromInput(t.value), s = S.sessions[+t.dataset.sdate];
      if (ts && s) { s.date = ts; s.logs.forEach(l => { l.at = ts; }); sortSessions(); save(); }
      else alert('Revisa la fecha: no puede estar vacía ni ser futura.');
      render(true);
    }
    if (t.dataset.set) { S.settings[t.dataset.set] = t.type === 'checkbox' ? t.checked : +t.value; save(); }
    if (t.id === 'imp' && t.files[0]) t.files[0].text().then(txt => {
      try {
        const d = JSON.parse(txt);
        if (!Array.isArray(d.sessions)) throw 0;
        if (confirm('Se sustituirá el histórico de este móvil por el de la copia (' + d.sessions.length + ' entrenos). ¿Continuar?')) {
          localStorage.setItem(KEY, JSON.stringify(d)); S = load(); render();
        }
      } catch (err) { alert('Ese archivo no es una copia válida.'); }
    });
  });

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  render();
})();
