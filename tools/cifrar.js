/* Cifra plan.js -> plan.enc.json con una contraseña (PBKDF2-SHA256 + AES-256-GCM).
   Uso:  node tools/cifrar.js
   plan.js (en claro) no se publica; solo se sube plan.enc.json.
   Si ya existe plan.enc.json se reutiliza su "sal": así, con la misma contraseña,
   los dispositivos que ya entraron no vuelven a pedirla al actualizar el plan. */
const crypto = require('crypto'), fs = require('fs'), path = require('path');
let piped = null;
const root = path.join(__dirname, '..'), SRC = path.join(root, 'plan.js'), OUT = path.join(root, 'plan.enc.json');
const ITER = 600000;

// Lee una línea sin mostrarla (un * por carácter). Si no hay terminal interactiva, lee con eco.
function ask(q) {
  return new Promise(res => {
    const inp = process.stdin;
    process.stdout.write(q);
    if (!inp.isTTY || !inp.setRawMode) {
      if (!piped) piped = fs.readFileSync(0, 'utf8').split(/\r?\n/);
      if (!piped.length) { console.error('\nSin entrada.'); process.exit(1); }
      process.stdout.write('\n'); return res(piped.shift());
    }
    let buf = '';
    inp.setRawMode(true); inp.resume(); inp.setEncoding('utf8');
    const onData = chunk => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          inp.setRawMode(false); inp.pause(); inp.removeListener('data', onData);
          process.stdout.write('\n'); return res(buf);
        }
        if (ch === '\u0003') { process.stdout.write('\nCancelado.\n'); process.exit(1); }
        if (ch === '\b' || ch === '\u007f') { if (buf) { buf = buf.slice(0, -1); process.stdout.write('\b \b'); } }
        else if (ch >= ' ') { buf += ch; process.stdout.write('*'); }
      }
    };
    inp.on('data', onData);
  });
}

// ¿Esta contraseña abre el plan cifrado que ya está publicado?
function opens(box, pw) {
  try {
    const key = crypto.pbkdf2Sync(pw, Buffer.from(box.salt, 'base64'), box.iter || ITER, 32, 'sha256');
    const raw = Buffer.from(box.data, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
    d.setAuthTag(raw.subarray(raw.length - 16));
    Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()]);
    return true;
  } catch (e) { return false; }
}

(async () => {
  if (!fs.existsSync(SRC)) { console.error('No encuentro plan.js'); process.exit(1); }
  // Si ya hay un plan cifrado, se comprueba que la contraseña es la misma (así una errata no la cambia sin querer).
  // Para cambiarla a propósito: node tools/cifrar.js --nueva
  let box = null;
  if (fs.existsSync(OUT) && !process.argv.includes('--nueva')) {
    try { box = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { box = null; }
  }
  const WRONG = 'Esa no es la contraseña con la que está cifrado el plan publicado.';
  let pw = process.env.ENTRENO_PW;
  if (pw) {
    if (box && !opens(box, pw)) { console.error(WRONG + ' No he cambiado nada.'); process.exit(1); }
  } else {
    for (;;) {
      pw = await ask(box ? 'Contraseña actual del plan (se muestra con *): ' : 'Contraseña nueva (mínimo 8 caracteres, se muestra con *): ');
      if (pw.length < 8) { console.log('Has escrito ' + pw.length + ' caracteres; hacen falta al menos 8. Prueba otra vez.'); continue; }
      if (box) {
        if (opens(box, pw)) break;
        console.log(WRONG + ' Prueba otra vez (Ctrl+C para salir; para cambiarla a propósito: node tools/cifrar.js --nueva).');
        continue;
      }
      if (await ask('Repítela: ') === pw) break;
      console.log('No coinciden. Prueba otra vez.');
    }
  }
  const salt = box ? Buffer.from(box.salt, 'base64') : crypto.randomBytes(16);
  const key = crypto.pbkdf2Sync(pw, salt, ITER, 32, 'sha256'), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(fs.readFileSync(SRC)), c.final(), c.getAuthTag()]);
  fs.writeFileSync(OUT, JSON.stringify({ v: 1, iter: ITER, salt: salt.toString('base64'), iv: iv.toString('base64'), data: data.toString('base64') }));
  console.log('Hecho: plan.enc.json (' + data.length + ' bytes). Ya se puede publicar.');
})();
