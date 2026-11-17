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

(async () => {
  if (!fs.existsSync(SRC)) { console.error('No encuentro plan.js'); process.exit(1); }
  let pw = process.env.ENTRENO_PW;
  if (!pw) {
    for (;;) {
      pw = await ask('Contraseña (mínimo 8 caracteres, se muestra con *): ');
      if (pw.length < 8) { console.log('Has escrito ' + pw.length + ' caracteres; hacen falta al menos 8. Prueba otra vez.'); continue; }
      if (await ask('Repítela: ') === pw) break;
      console.log('No coinciden. Prueba otra vez.');
    }
  }
  let salt = crypto.randomBytes(16);
  if (fs.existsSync(OUT) && !process.argv.includes('--nueva')) {
    try { salt = Buffer.from(JSON.parse(fs.readFileSync(OUT, 'utf8')).salt, 'base64'); } catch (e) { /* sal nueva */ }
  }
  const key = crypto.pbkdf2Sync(pw, salt, ITER, 32, 'sha256'), iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(fs.readFileSync(SRC)), c.final(), c.getAuthTag()]);
  fs.writeFileSync(OUT, JSON.stringify({ v: 1, iter: ITER, salt: salt.toString('base64'), iv: iv.toString('base64'), data: data.toString('base64') }));
  console.log('Hecho: plan.enc.json (' + data.length + ' bytes). Ya se puede publicar.');
})();
