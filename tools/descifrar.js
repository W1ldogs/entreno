/* Recupera plan.js (el plan en claro) a partir de plan.enc.json con la contraseña.
   Uso:  node tools/descifrar.js
   Sirve para trabajar desde otro ordenador: tras clonar el repositorio, plan.js no está
   (no se publica); este comando lo vuelve a crear para poder cambiar el plan. */
const fs = require('fs'), path = require('path');
const ask = require('./pedir');
const { decrypt } = require('./cifrar');
const root = path.join(__dirname, '..'), SRC = path.join(root, 'plan.js'), OUT = path.join(root, 'plan.enc.json');

(async () => {
  if (!fs.existsSync(OUT)) { console.error('No encuentro plan.enc.json'); process.exit(1); }
  if (fs.existsSync(SRC) && !process.argv.includes('--sobrescribir')) {
    console.error('Ya existe plan.js y no lo toco. Si quieres sustituirlo por el publicado: node tools/descifrar.js --sobrescribir');
    process.exit(1);
  }
  const box = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  let plain = null, pw = process.env.ENTRENO_PW;
  if (pw) plain = decrypt(box, pw);
  else {
    for (;;) {
      pw = await ask('Contraseña del plan (se muestra con *): ');
      plain = decrypt(box, pw);
      if (plain) break;
      console.log('Esa no es la contraseña del plan. Prueba otra vez (Ctrl+C para salir).');
    }
  }
  if (!plain) { console.error('Esa no es la contraseña del plan. No he creado nada.'); process.exit(1); }
  fs.writeFileSync(SRC, plain);
  console.log('Hecho: plan.js recuperado (' + plain.length + ' bytes). Recuerda que no se sube: está en .gitignore.');
})();
