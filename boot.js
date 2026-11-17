/* Arranque: el plan viaja cifrado (plan.enc.json). Se descifra en el dispositivo con la contraseña,
   que solo se pide la primera vez; después se recuerda la clave derivada en este navegador. */
(async () => {
  'use strict';
  const KEYK = 'entreno.key', app = document.getElementById('app');
  const dec = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const enc = u => btoa(String.fromCharCode(...new Uint8Array(u)));
  const run = () => { const s = document.createElement('script'); s.src = 'app.js'; document.body.appendChild(s); };
  const fail = msg => { app.innerHTML = `<section class="card warn" style="margin-top:40px"><h2>No se puede abrir</h2><p>${msg}</p></section>`; };

  if (!window.crypto || !crypto.subtle) return fail('Este navegador no permite descifrar el plan. Abre la app desde su dirección https.');
  let box;
  try {
    const r = await fetch('plan.enc.json');
    if (!r.ok) throw 0;
    box = await r.json();
  } catch (e) { return fail('No se ha podido cargar el plan. Revisa la conexión y vuelve a abrir la app.'); }

  async function open(rawKey) {
    const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: dec(box.iv) }, key, dec(box.data));
    new Function(new TextDecoder().decode(plain))();
    if (!window.PLAN) throw 0;
  }
  async function derive(password) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    return crypto.subtle.deriveBits({ name: 'PBKDF2', salt: dec(box.salt), iterations: box.iter, hash: 'SHA-256' }, base, 256);
  }

  let saved = null;
  try { saved = localStorage.getItem(KEYK); } catch (e) { /* sin almacenamiento */ }
  if (saved) {
    try { await open(dec(saved)); return run(); } catch (e) { try { localStorage.removeItem(KEYK); } catch (e2) { /* nada */ } }
  }

  app.innerHTML = `<form class="lock" id="lock" autocomplete="on">
    <img src="icons/icon.svg" alt="" width="96" height="96">
    <h1>Mi entreno</h1>
    <p class="muted">Escribe la contraseña para abrir tu plan. Solo se pide una vez en este dispositivo.</p>
    <label class="lbl" for="pw">Contraseña</label>
    <input type="password" id="pw" autocomplete="current-password" required autofocus>
    <p class="status low" id="err" hidden>Contraseña incorrecta</p>
    <button class="btn primary big" id="go">Entrar</button></form>`;
  document.getElementById('lock').addEventListener('submit', async e => {
    e.preventDefault();
    const pw = document.getElementById('pw'), go = document.getElementById('go'), err = document.getElementById('err');
    go.disabled = true; go.textContent = 'Abriendo…'; err.hidden = true;
    try {
      const raw = await derive(pw.value);
      await open(raw);
      try { localStorage.setItem(KEYK, enc(raw)); } catch (e2) { /* se pedirá de nuevo */ }
      run();
    } catch (e2) {
      go.disabled = false; go.textContent = 'Entrar'; err.hidden = false; pw.select();
    }
  });
})();
