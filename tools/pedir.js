/* Pide una línea por la terminal sin mostrarla (un * por carácter). Si no hay terminal interactiva, lee con eco. */
const fs = require('fs');
let piped = null;
module.exports = function ask(q) {
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
};
