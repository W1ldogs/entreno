# Mi entreno

App web instalable para seguir un plan de fuerza en el gimnasio: series guiadas, respiración, descansos e histórico de pesos. Sin servidor ni dependencias: son archivos estáticos.

## Archivos

- `plan.js` — el plan en claro (ejercicios, series, pesos, descansos, estiramientos). **No se publica.** Cuando llegue un plan nuevo, solo se cambia este archivo.
- `plan.enc.json` — el plan cifrado con contraseña; es lo que se publica. Se genera con `node tools/cifrar.js` cada vez que cambie `plan.js`.
- `boot.js` — pide la contraseña la primera vez en cada dispositivo y descifra el plan.
- `anim.js` — las figuras animadas y el ritmo de respiración de cada ejercicio.
- `app.js`, `styles.css`, `index.html` — la app.
- `sw.js`, `manifest.webmanifest`, `icons/` — instalación en el móvil y uso sin conexión.

## Probar en el ordenador

```bash
python -m http.server 8765
```

Y abrir `http://localhost:8765`.

## Al publicar cambios

La app se sirve desde la caché del móvil y se actualiza en segundo plano: la versión nueva aparece la segunda vez que se abre.

## Datos

El histórico se guarda solo en el navegador del móvil. En **Más → Copia de seguridad** se puede exportar e importar.
