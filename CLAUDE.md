# Mi entreno — guía para trabajar en el proyecto

App web instalable (PWA estática, sin build ni dependencias) para seguir en el móvil el plan de fuerza que da el entrenador: series guiadas con figura animada y ritmo de respiración, descansos con aviso, registro del peso de cada serie, histórico, gráficas y resumen para el entrenador.

Publicada en https://w1ldogs.github.io/entreno/ (GitHub Pages desde la raíz de `main`, repositorio `W1ldogs/entreno`). Publicar = commit y `git push` a `main` con la cuenta personal de GitHub `w1ldogs`. Pages tarda alrededor de un minuto; en el móvil la versión nueva aparece la segunda vez que se abre la app (el service worker sirve primero la caché).

## Archivos

- `plan.js` — el plan en claro (`window.PLAN`: ejercicios, series, pesos, descansos, variantes, estiramientos, días; `shorts`: vídeo corto por ejercicio o `ejercicio:variante`; `images`: dibujos del documento del entrenador en JPEG base64). **Nunca se sube** (está en `.gitignore`). Las imágenes son de terceros: solo viajan dentro del plan cifrado, nunca como archivos sueltos en el repositorio.
- `plan.enc.json` — el plan cifrado (PBKDF2-SHA256 600 000 iteraciones + AES-256-GCM); es lo que se publica.
- `tools/cifrar.js` — genera `plan.enc.json` desde `plan.js`. Reutiliza la sal y comprueba que la contraseña es la del plan publicado; `--nueva` para cambiarla.
- `tools/descifrar.js` — recrea `plan.js` desde `plan.enc.json` (por ejemplo, en un ordenador nuevo tras clonar).
- `boot.js` — pide la contraseña la primera vez en cada dispositivo, descifra el plan y carga `app.js`.
- `app.js` — toda la app (estado en `localStorage`, clave `entreno.v1`). `anim.js` — figuras SVG y fases de respiración. `styles.css` — tokens de color claro/oscuro.
- `sw.js`, `manifest.webmanifest`, `icons/` — instalación y uso sin conexión. Si se añaden o quitan archivos de la app, actualizar `ASSETS` y subir el número de `CACHE` en `sw.js`.
- `Planes/` — documentos originales del entrenador. No se suben.

## Reglas

- **Contraseña:** la escribe siempre el usuario (`node tools/cifrar.js` o `node tools/descifrar.js` en su terminal). No la pidas ni intentes conocerla. Junta los cambios del plan y pide el cifrado una sola vez al final de cada tanda, no tras cada cambio.
- **La app debe funcionar aunque el plan cifrado publicado sea el anterior:** los campos nuevos del plan son opcionales y tienen valor por defecto.
- **Privacidad:** el repositorio es público. Nada de nombres, diagnósticos ni datos de salud en el código, en los commits ni en los textos de la app; los avisos hablan solo de «presión en el abdomen». El histórico del usuario vive solo en el navegador del móvil; se exporta desde Más → Copia de seguridad.
- **Respiración:** en todos los ejercicios se suelta el aire al hacer la fuerza y se coge al volver; nunca aguantar el aire. Cualquier ejercicio nuevo debe llevar su pauta de respiración.
- **Plan del entrenador:** se respeta tal cual, salvo lo que él indique (por ejemplo, 15 s por estiramiento en vez de 30). La dieta del plan queda fuera de la app.
- **Forma de trabajar:** textos en español de España, claros y cortos. Ante cualquier duda sobre el plan, preguntar en vez de suponer.
- **Gráficas:** paleta validada para daltonismo (`--c-done`, `--c-target`, `--c-low` en `styles.css`), leyenda, lectura al tocar y tabla de datos.

## Probar en el ordenador

```bash
python -m http.server 8765
```

Para probar sin escribir la contraseña: abrir `http://localhost:8765`, guardar una copia de `localStorage` y, desde la consola, cargar `plan.js?t=<n>` y después `app.js?t=<n>` (el `?t=` evita la caché). Al terminar, dejar `localStorage` como estaba. El sonido, la vibración, la voz, las notificaciones y el menú de compartir hay que comprobarlos en el móvil.
