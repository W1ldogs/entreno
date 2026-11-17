/* Figuras animadas sincronizadas con la respiración.
   Cada figura tiene dos posturas (p0 y p1) descritas con ángulos en grados
   (0 = hacia la derecha, 90 = hacia abajo, -90 = hacia arriba) y unas fases:
   { to: postura destino (0/1), d: segundos, b: 'in' coge aire | 'out' suelta | 'flow' respira suave, t: texto }.
   Para retocar un movimiento basta con cambiar los ángulos aquí. */
window.Anim = (() => {
  const LEN = { torso: 34, head: 11, ua: 20, fa: 20, th: 26, sh: 26 };
  const RAD = Math.PI / 180;
  const NS = 'http://www.w3.org/2000/svg';
  const BREATH = { in: 'Coge aire', out: 'Suelta el aire', flow: 'Respira suave' };
  const STILL = [
    { to: 0, d: 4, b: 'in', t: 'Por la nariz, sin forzar' },
    { to: 0, d: 5, b: 'out', t: 'Despacio, relaja la postura' }
  ];

  const FIGS = {
    walk: {
      p0: { hip: [80, 76], torso: -88, armL: [110, 80], armR: [70, 40], legL: [70, 95], legR: [110, 120] },
      p1: { armL: [70, 40], armR: [110, 80], legL: [110, 120], legR: [70, 95] },
      props: [[36, 130, 124, 130]],
      phases: [{ to: 1, d: 0.55, b: 'flow', t: 'Ritmo cómodo, por la nariz' }, { to: 0, d: 0.55, b: 'flow', t: 'Ritmo cómodo, por la nariz' }]
    },
    squat: {
      p0: { hip: [80, 76], torso: -90, arm: [80, -60], leg: [90, 90] },
      p1: { hip: [63, 102], torso: -70, leg: [5, 110] },
      att: [{ k: 'w', j: 'handL', r: 5 }], hot: ['th'],
      phases: [{ to: 1, d: 2.2, b: 'in', t: 'Baja con la espalda recta' }, { to: 0, d: 1.6, b: 'out', t: 'Sube empujando con los talones' }]
    },
    bench: {
      p0: { hip: [90, 92], torso: 180, arm: [-90, -90], leg: [20, 90] },
      p1: { arm: [20, -90] },
      props: [[38, 98, 104, 98], [48, 98, 48, 128], [96, 98, 96, 128]],
      att: [{ k: 'w', j: 'handL', r: 4 }], hot: ['torso', 'ua'],
      phases: [{ to: 1, d: 2.2, b: 'in', t: 'Baja las mancuernas al pecho' }, { to: 0, d: 1.6, b: 'out', t: 'Empuja hacia arriba' }]
    },
    incline: {
      p0: { hip: [90, 100], torso: -150, arm: [-90, -90], leg: [5, 90] },
      p1: { arm: [40, -90] },
      props: [[54, 86, 96, 110], [96, 110, 110, 110], [62, 91, 62, 128], [100, 110, 100, 128]],
      att: [{ k: 'w', j: 'handL', r: 4 }], hot: ['torso', 'ua'],
      phases: [{ to: 1, d: 2.2, b: 'in', t: 'Baja a la parte alta del pecho' }, { to: 0, d: 1.6, b: 'out', t: 'Empuja hacia arriba' }]
    },
    row: {
      p0: { hip: [50, 101], torso: -90, arm: [20, 10], leg: [-10, 25] },
      p1: { arm: [120, 0] },
      props: [[32, 107, 68, 107], [40, 107, 40, 128], [62, 107, 62, 128], [101, 96, 105, 118], [140, 56, 140, 128], [148, 56, 148, 128], [140, 56, 148, 56]],
      att: [{ k: 'cable', j: 'handL', from: [140, 80] }, { k: 'w', j: 'handL', r: 3 }], hot: ['torso', 'ua'],
      phases: [{ to: 1, d: 1.6, b: 'out', t: 'Tira hacia el ombligo' }, { to: 1, d: 1, b: 'out', t: 'Junta los omóplatos 1 s' }, { to: 0, d: 2.4, b: 'in', t: 'Vuelve despacio' }]
    },
    plank: {
      p0: { hip: [79, 114.7], torso: -11.4, arm: [90, 0], leg: [168.6, 168.6] },
      p1: {}, hot: ['torso'],
      phases: [{ to: 0, d: 3, b: 'in', t: 'Por la nariz, sin soltar la postura' }, { to: 0, d: 3.5, b: 'out', t: 'Despacio. Nunca aguantes el aire' }]
    },
    legpress: {
      p0: { hip: [60, 108], torso: -145, arm: [60, 20], leg: [-55, -35] },
      p1: { leg: [-90, 0] },
      props: [[26, 95, 62, 117], [62, 117, 76, 112], [72, 124, 132, 64]],
      att: [{ k: 'plat', j: 'footL', a: 45, len: 30 }], hot: ['th'],
      phases: [{ to: 1, d: 2.2, b: 'in', t: 'Baja hasta 90° de rodilla' }, { to: 0, d: 1.6, b: 'out', t: 'Empuja con los talones, sin bloquear' }]
    },
    pulldown: {
      p0: { hip: [70, 96], torso: -100, arm: [-80, -80], leg: [0, 90] },
      p1: { arm: [80, -75] },
      props: [[58, 102, 84, 102], [70, 102, 70, 128], [88, 88, 106, 88], [124, 5, 124, 128], [60, 5, 124, 5]],
      att: [{ k: 'cable', j: 'handL', from: [72, 5] }, { k: 'w', j: 'handL', r: 3 }], hot: ['torso', 'ua'],
      phases: [{ to: 1, d: 1.6, b: 'out', t: 'Lleva la barra al pecho' }, { to: 0, d: 2.2, b: 'in', t: 'Sube controlando 2 s' }]
    },
    shoulder: {
      p0: { hip: [70, 96], torso: -90, arm: [45, -90], leg: [0, 90] },
      p1: { arm: [-85, -90] },
      props: [[62, 56, 62, 102], [58, 102, 84, 102], [70, 102, 70, 128]],
      att: [{ k: 'w', j: 'handL', r: 4 }], hot: ['ua'],
      phases: [{ to: 1, d: 1.6, b: 'out', t: 'Empuja hacia arriba' }, { to: 0, d: 2.2, b: 'in', t: 'Baja a la altura de las orejas' }]
    },
    curl: {
      p0: { hip: [75, 76], torso: -90, arm: [90, 80], leg: [90, 90] },
      p1: { arm: [90, -70] },
      att: [{ k: 'w', j: 'handL', r: 5 }], hot: ['ua'],
      phases: [{ to: 1, d: 1.6, b: 'out', t: 'Sube la barra, codos quietos' }, { to: 0, d: 2.6, b: 'in', t: 'Baja en 2-3 s' }]
    },
    pushdown: {
      p0: { hip: [72, 76], torso: -85, arm: [95, -40], leg: [90, 90] },
      p1: { arm: [95, 85] },
      props: [[122, 6, 122, 128], [96, 6, 122, 6]],
      att: [{ k: 'cable', j: 'handL', from: [98, 6] }, { k: 'w', j: 'handL', r: 3 }], hot: ['ua'],
      phases: [{ to: 1, d: 1.6, b: 'out', t: 'Estira y abre la cuerda' }, { to: 0, d: 2.2, b: 'in', t: 'Sube despacio, codos pegados' }]
    },
    plank_knees: {
      p0: { hip: [82, 116], torso: -14, arm: [90, 0], leg: [148, 180] },
      p1: {}, hot: ['torso'],
      phases: [{ to: 0, d: 3, b: 'in', t: 'Por la nariz, sin soltar la postura' }, { to: 0, d: 3.5, b: 'out', t: 'Despacio. Nunca aguantes el aire' }]
    },
    legcurl_seated: {
      p0: { hip: [70, 96], torso: -100, arm: [75, 15], leg: [0, 0] },
      p1: { leg: [0, 100] },
      props: [[48, 102, 98, 102], [56, 102, 56, 128], [90, 102, 90, 128], [58, 100, 51, 56]],
      att: [{ k: 'w', j: 'footL', r: 5 }], hot: ['th'],
      phases: [{ to: 1, d: 1.6, b: 'out', t: 'Talones abajo y atrás' }, { to: 0, d: 3, b: 'in', t: 'Vuelve en 3 s' }]
    },
    legcurl: {
      p0: { hip: [70, 92], torso: 0, arm: [60, 0], leg: [180, 175] },
      p1: { leg: [180, 290] },
      props: [[42, 98, 112, 98], [52, 98, 52, 128], [102, 98, 102, 128]],
      att: [{ k: 'w', j: 'footL', r: 5 }], hot: ['th'],
      phases: [{ to: 1, d: 1.6, b: 'out', t: 'Talones hacia los glúteos' }, { to: 0, d: 3, b: 'in', t: 'Baja en 3 s' }]
    },
    dbrow: {
      p0: { hip: [55, 76], torso: -5, armL: [90, 90], armR: [60, 120], legL: [95, 90], legR: [85, 180] },
      p1: { armL: [190, 90] },
      props: [[22, 107, 104, 107], [34, 107, 34, 128], [94, 107, 94, 128]],
      att: [{ k: 'w', j: 'handL', r: 4 }], hot: ['torso'],
      phases: [{ to: 1, d: 1.6, b: 'out', t: 'Codo hacia la cadera' }, { to: 0, d: 2.2, b: 'in', t: 'Baja estirando el brazo' }]
    },
    lateral: {
      front: true,
      p0: { hip: [80, 76], torso: -90, armL: [100, 95], armR: [80, 85], legL: [95, 90], legR: [85, 90] },
      p1: { armL: [178, 182], armR: [2, -2] },
      att: [{ k: 'w', j: 'handL', r: 4 }, { k: 'w', j: 'handR', r: 4 }], hot: ['ua'],
      phases: [{ to: 1, d: 1.6, b: 'out', t: 'Sube hasta los hombros, no más' }, { to: 0, d: 2.4, b: 'in', t: 'Baja despacio' }]
    },
    bridge: {
      p0: { hip: [80, 123], torso: 180, arm: [0, 0], leg: [-50, 75] },
      p1: { hip: [77, 108], torso: 154.2, leg: [-12.9, 87.7] },
      hot: ['th'],
      phases: [{ to: 1, d: 1.6, b: 'out', t: 'Sube la cadera apretando glúteos' }, { to: 1, d: 2, b: 'out', t: 'Aguanta 2 s, sigue soltando aire' }, { to: 0, d: 2.2, b: 'in', t: 'Baja despacio' }]
    },
    birddog: {
      p0: { hip: [55, 96], torso: -12, armL: [90, 90], armR: [90, 90], legL: [90, 180], legR: [90, 180] },
      p1: { armL: [-5, -5], legR: [175, 178] },
      hot: ['torso'],
      phases: [{ to: 1, d: 2, b: 'out', t: 'Estira brazo y pierna contraria' }, { to: 1, d: 2, b: 'out', t: 'Aguanta 2 s, sin girar la cadera' }, { to: 0, d: 2.2, b: 'in', t: 'Vuelve y cambia de lado' }]
    },

    st_quad: { p0: { hip: [80, 76], torso: -90, armL: [90, 90], armR: [110, 130], legL: [90, 90], legR: [100, 250] }, hot: ['th'] },
    st_fold: { p0: { hip: [70, 76], torso: 55, arm: [140, 150], leg: [92, 90] }, hot: ['th'] },
    st_side: { front: true, p0: { hip: [80, 90], torso: -90, armL: [120, 100], armR: [60, 80], legL: [160, 88], legR: [38, 38] }, hot: ['th'] },
    st_hip: { p0: { hip: [75, 98], torso: -90, arm: [100, 60], legL: [10, 90], legR: [135, 170] }, hot: ['th'] },
    st_knee: { p0: { hip: [85, 122], torso: 180, arm: [-50, -30], legL: [-120, 20], legR: [0, 0] }, hot: ['th'] },
    st_glute: { p0: { hip: [85, 122], torso: 180, arm: [-45, -30], legL: [-75, 200], legR: [-110, 10] }, hot: ['th'] },
    st_dog: { p0: { hip: [68, 86], torso: 35, arm: [35, 35], leg: [129, 129] }, hot: ['th', 'sh'] },
    st_cobra: { p0: { hip: [70, 123], torso: -40, arm: [135, 45], leg: [180, 180] }, hot: ['torso'] },
    st_child: { p0: { hip: [50, 112], torso: 5, arm: [0, 5], leg: [25, 185] }, hot: ['torso'] }
  };

  const norm = p => ({ hip: p.hip, torso: p.torso, aL: p.armL || p.arm, aR: p.armR || p.arm, lL: p.legL || p.leg, lR: p.legR || p.leg });
  const lerp = (a, b, t) => a + (b - a) * t;
  const mix = (a, b, t) => {
    const o = {};
    for (const k in a) o[k] = Array.isArray(a[k]) ? a[k].map((v, i) => lerp(v, b[k][i], t)) : lerp(a[k], b[k], t);
    return o;
  };
  const pt = (o, len, ang) => [o[0] + len * Math.cos(ang * RAD), o[1] + len * Math.sin(ang * RAD)];

  function joints(p, front) {
    const neck = pt(p.hip, LEN.torso, p.torso), head = pt(neck, LEN.head, p.torso);
    const sw = front ? 9 : 0, hw = front ? 5 : 0;
    const sL = [neck[0] - sw, neck[1]], sR = [neck[0] + sw, neck[1]];
    const hL = [p.hip[0] - hw, p.hip[1]], hR = [p.hip[0] + hw, p.hip[1]];
    const eL = pt(sL, LEN.ua, p.aL[0]), eR = pt(sR, LEN.ua, p.aR[0]);
    const kL = pt(hL, LEN.th, p.lL[0]), kR = pt(hR, LEN.th, p.lR[0]);
    return {
      hip: p.hip, neck, head, sL, sR, hL, hR, eL, eR, kL, kR,
      handL: pt(eL, LEN.fa, p.aL[1]), handR: pt(eR, LEN.fa, p.aR[1]),
      footL: pt(kL, LEN.sh, p.lL[1]), footR: pt(kR, LEN.sh, p.lR[1])
    };
  }

  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    parent.appendChild(e);
    return e;
  };
  const setLine = (l, a, b) => {
    l.setAttribute('x1', a[0].toFixed(1)); l.setAttribute('y1', a[1].toFixed(1));
    l.setAttribute('x2', b[0].toFixed(1)); l.setAttribute('y2', b[1].toFixed(1));
  };

  function mount(host, id, opts) {
    opts = opts || {};
    const fig = FIGS[id] || FIGS.walk;
    const p0 = norm(fig.p0), p1 = norm(Object.assign({}, fig.p0, fig.p1 || {}));
    const phases = fig.phases || STILL;
    const hot = fig.hot || [];

    host.innerHTML = '<div class="anim"><div class="anim-row"><div class="anim-fig"></div>' +
      '<div class="breath"><div class="ring"></div><span class="ring-l"></span></div></div>' +
      '<p class="cue"><b></b><span></span></p></div>';
    const svg = el('svg', { viewBox: '0 0 160 136', role: 'img', 'aria-label': 'Animación del movimiento' }, host.querySelector('.anim-fig'));
    el('line', { x1: 6, y1: 131, x2: 154, y2: 131, class: 'f-ground' }, svg);
    (fig.props || []).forEach(p => el('line', { x1: p[0], y1: p[1], x2: p[2], y2: p[3], class: 'f-prop' }, svg));

    // orden de dibujo: lado lejano, tronco, cabeza, lado cercano
    const segDefs = [
      ['th', 'hR', 'kR', 'far'], ['sh', 'kR', 'footR', 'far'], ['ua', 'sR', 'eR', 'far'], ['fa', 'eR', 'handR', 'far'],
      ['torso', 'hip', 'neck', ''], ['th', 'hL', 'kL', ''], ['sh', 'kL', 'footL', ''], ['ua', 'sL', 'eL', ''], ['fa', 'eL', 'handL', '']
    ];
    const cables = (fig.att || []).filter(a => a.k === 'cable').map(a => ({ a, n: el('line', { class: 'f-cable' }, svg) }));
    const segs = segDefs.map(d => ({
      d, n: el('line', { class: 'f-seg ' + (fig.front ? '' : d[3]) + (hot.includes(d[0]) ? ' hot' : '') }, svg)
    }));
    const girdle = fig.front ? [el('line', { class: 'f-seg' }, svg), el('line', { class: 'f-seg' }, svg)] : null;
    const head = el('circle', { r: 7, class: 'f-head' }, svg);
    const atts = (fig.att || []).filter(a => a.k !== 'cable').map(a => ({
      a, n: a.k === 'w' ? el('circle', { r: a.r, class: 'f-weight' }, svg) : el('line', { class: 'f-plat' }, svg)
    }));

    // progreso de la respiración: las fases seguidas del mismo tipo comparten una sola inspiración/espiración
    const ringSpan = phases.map(() => [0, 1]);
    for (let i = 0; i < phases.length;) {
      let j = i, total = 0;
      while (j < phases.length && phases[j].b === phases[i].b) total += phases[j++].d;
      let acc = 0;
      for (let k = i; k < j; k++) { ringSpan[k] = [acc / total, (acc + phases[k].d) / total]; acc += phases[k].d; }
      i = j;
    }
    const total = phases.reduce((s, p) => s + p.d, 0);
    const ring = host.querySelector('.ring'), ringL = host.querySelector('.ring-l');
    const cueB = host.querySelector('.cue b'), cueT = host.querySelector('.cue span');
    const breathBox = host.querySelector('.breath');

    let raf = 0, t0 = performance.now() + (opts.delay || 0) * 1000, cur = -1, curCyc = -1, alive = true;
    function frame(now) {
      if (!alive) return;
      const el = (now - t0) / 1000, tt = el < 0 ? 0 : el;   // durante la cuenta atrás se queda en la postura inicial
      const cyc = Math.floor(tt / total), t = tt % total;
      let k = 0, acc = 0;
      while (k < phases.length - 1 && t >= acc + phases[k].d) acc += phases[k++].d;
      const ph = phases[k], u = Math.min(1, (t - acc) / ph.d);
      const from = phases[(k + phases.length - 1) % phases.length].to;
      const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
      const J = joints(mix(p0, p1, lerp(from, ph.to, e)), fig.front);

      segs.forEach(s => setLine(s.n, J[s.d[1]], J[s.d[2]]));
      if (girdle) { setLine(girdle[0], J.sL, J.sR); setLine(girdle[1], J.hL, J.hR); }
      head.setAttribute('cx', J.head[0].toFixed(1)); head.setAttribute('cy', J.head[1].toFixed(1));
      cables.forEach(c => setLine(c.n, c.a.from, J[c.a.j]));
      atts.forEach(o => {
        const p = J[o.a.j];
        if (o.a.k === 'w') { o.n.setAttribute('cx', p[0].toFixed(1)); o.n.setAttribute('cy', p[1].toFixed(1)); }
        else {
          const dx = Math.cos(o.a.a * RAD) * o.a.len / 2, dy = Math.sin(o.a.a * RAD) * o.a.len / 2;
          setLine(o.n, [p[0] - dx, p[1] - dy], [p[0] + dx, p[1] + dy]);
        }
      });

      let v;
      if (ph.b === 'flow') v = 0.5 - 0.5 * Math.cos((now - t0) / 1000 * Math.PI / 2.5);
      else { const g = lerp(ringSpan[k][0], ringSpan[k][1], u); v = ph.b === 'in' ? g : 1 - g; }
      ring.style.transform = 'scale(' + (0.5 + 0.5 * v).toFixed(3) + ')';
      if (k !== cur || (el >= 0 && cyc !== curCyc)) {
        cur = k;
        breathBox.className = 'breath b-' + ph.b;
        ringL.textContent = ph.b === 'in' ? 'COGE' : ph.b === 'out' ? 'SUELTA' : 'RESPIRA';
        cueB.textContent = BREATH[ph.b];
        cueT.textContent = ph.t ? ' · ' + ph.t : '';
        if (el >= 0) { curCyc = cyc; if (opts.on) opts.on(k, ph, cyc); }
        if (!alive) return;
      }
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);
    return () => { alive = false; cancelAnimationFrame(raf); };
  }

  return { mount, FIGS };
})();
