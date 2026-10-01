# Daily Tracking Tool

Un folio digital infinito para las tareas del día: abrir, escribir una tarea y seguir trabajando.

**Write → Organize → Execute → Check.**

## Uso

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # tests del árbol de tareas
npm run build
```

Los datos se guardan solos en `localStorage` del navegador (clave `daily-tracking-tool:v1`) y se sincronizan entre pestañas abiertas. Al cargar se validan y se reparan (campos que faltan, tareas huérfanas o ciclos), así que un dato corrupto nunca deja la hoja inservible.

Dentro de claude.ai cada enlace de artifact es un sitio distinto, así que el navegador guarda una hoja aparte por enlace y por dispositivo. Por eso, cuando la app se publica como artifact con las capacidades `db` y `user`, la hoja y las plantillas se guardan además en la base de datos del propio artifact, en tu parte privada (`data/users/<tu id>/folio-*`): la misma hoja en todos tus dispositivos y en cada versión republicada de ese enlace. La primera vez sube lo que haya en ese navegador; si dos dispositivos cambiaron a la vez, se unen las tareas de ambos. El historial de la Memoria sigue solo en el navegador (va en la copia JSON).

## Escribir rápido

Al pulsar Enter (o salir de la línea), el texto se interpreta:

- `#tag` en cualquier sitio añade el tag.
- `!` como palabra suelta marca la tarea como prioritaria.
- Una fecha al final de la línea la planifica: `hoy`, `mañana`, `pasado mañana`, un día de la semana (`viernes`) o `3/10`. En mitad de la frase, con `@` (`Revisar @lunes la oferta`). Sin `@`, solo se lee al final, así que «Informe de mañana para Ana» se queda como está.

- Una repetición al final la hace recurrente: `cada día`, `todos los días`, `entre semana`, `cada semana`, `cada lunes`, `cada mes`. Al completarla aparece justo debajo la siguiente, con su fecha y sus subtareas otra vez abiertas; la fecha lleva un `↻`. En el menú `/`: «Quitar repetición», o escribe «repetir» para añadirla.

`Llamar a IT mañana #zimvie !` → «Llamar a IT», para mañana, con `#zimvie` y prioridad. `Standup cada día #equipo` → se repite cada día desde hoy.

**Pegar una lista** (varias líneas) crea una tarea por línea. La sangría, las viñetas `-` `*` `1.`, los `├─ │ └─` y las casillas `[ ]` `[x]` `☐` `☑` se respetan: pegar un árbol crea el árbol.

**Hoy** (`Alt+T`, o «Hoy» encima de la lista) muestra solo lo planificado para hoy o vencido, más lo que has cerrado hoy. `Alt+H` planifica o desplanifica la tarea actual para hoy.

**Captura global** (`Cmd/Ctrl+K`): una línea flotante para apuntar algo sin perder el sitio. Enter la guarda (con la misma gramática) y el cursor vuelve a donde estabas; `Esc` la descarta. Al escribir `#` propone los tags que ya usas y con `@` las personas ya mencionadas y los días (`Tab` o `Enter` completa, `↑`/`↓` elige, `Esc` lo cierra).

**Buscar** (`Cmd/Ctrl+F`): filtra al escribir por texto, notas y tags, sin acentos y con las palabras en cualquier orden. Enter salta al primer resultado; `Esc` limpia la búsqueda.

**Plan del día**: una tira encima de la lista con los pasos del día en orden, `1 → 2 → 3`, cada uno con su proyecto. «Ahora» es el primero sin cerrar (borde negro); los hechos llevan el check verde; el resto, «Después». Al completar una tarea (`Cmd/Ctrl+Enter`) «Ahora» avanza solo. Pulsar un paso lleva a su tarea; `Alt+J` lleva a «Ahora»; `×` o `Esc` sobre la tira quita el plan; `Alt+P` lo rehace con la IA. Sin IA: `/` → «Añadir al plan» / «Quitar del plan» (hasta 5 pasos). Se guarda en este navegador (`daily-tracking-tool:plan`) solo para hoy; lo borrado o pospuesto sale de la tira.

**Modo foco** (`Alt+F` sobre una tarea): todo lo que no es esa tarea y sus subtareas se atenúa. Se sale con `Alt+F` otra vez o con la etiqueta «Foco» de arriba.

**Día nuevo**: la primera vez que abres la hoja cada día, lo que quedó abierto de días anteriores sube arriba, y su fecha se cambia por la edad (`3 d`) para que se note lo que se arrastra.

**Posponer** (`Alt+L` sobre una tarea, o `/` → «Posponer…»): elige un día (`Mañana`, `El lunes`…) o escríbelo (`viernes`, `15/10`, `3 días`, `2 semanas`). La tarea sale de la hoja y del Board, con sus subtareas, y ese día vuelve arriba con `↩ 3 d` (los días que estuvo fuera). No es lo mismo que planificar: la fecha dice para cuándo; posponer dice que no quieres verla hasta entonces. Arriba, «2 pospuestas» las enseña; `Alt+L` sobre una pospuesta la devuelve ya.

**Subrayar** (`Alt+U`, `/` → «Subrayar», o escribiendo `==frase==`): pone un bloque verde Captia detrás de esas palabras, como «Se queda en la máquina.». Con texto seleccionado subraya eso; sin selección, toda la tarea; sobre un subrayado, lo quita. Con la IA disponible se hace solo: poco después de escribir una tarea (o de traerla con `Ctrl+K` o Recoger), Claude subraya su frase clave si la tiene, como mucho una por tarea y muchas veces ninguna. Lo que ya estaba en la hoja recibe una sola pasada, más exigente, al abrir la app: como mucho una de cada cuatro tareas abiertas, y `Cmd/Ctrl+Z` la deshace entera. Cada tarea se mira una vez, así que si quitas un subrayado no vuelve.

**Esperando** (`/` → «Esperando…»): para lo que depende de otra persona. Pospone la tarea (por defecto tres días laborables) y le pone `#esperando`. Si sigue abierta ese día, vuelve con `sin respuesta · 3 d` para que la persigas.

**Hoy a cero**: junto a «Hoy», un número pequeño dice lo que queda para hoy. Al cerrar la última, un aviso verde lo celebra y recuerda `Alt+R`.

**Atajos abajo**: la barra del pie enseña los atajos de lo que estás haciendo (con varias tareas seleccionadas, los de la selección). «Todos», o `?` fuera del texto, abre la lista completa.

**Los atajos se enseñan solos**: si haces con el ratón o desde `/` algo que tiene tecla, un aviso breve te la dice. Solo las tres primeras veces de cada acción.

**Resumen del día** (`Alt+R`): copia al portapapeles un Markdown con lo hecho hoy (con su proyecto) y lo que está en curso, listo para pegar en un chat o un correo.

**Memoria** (`Alt+M`, o `/` → «Abrir la memoria»): la hoja compilada en páginas enlazadas, al estilo del LLM Wiki de Karpathy. Cada tarea con dos o más subtareas es un **proyecto**, cada `#tema` y cada `@persona` escrita en una tarea (`Llamar a @luis`) tiene su página, y cada día una entrada de **diario**. En cada página, la **Trama** cruza lo relacionado con las semanas: una fila lleva a esa página, una celda al día. La **Trama** de toda la hoja tiene su entrada en el índice, debajo de Panorama. El **Panorama** resume cómo trabajas en cinco gráficos (Pulso, Estratos, Vuelo, Deriva y Balance). `/` busca, `←`/`→` pasan de día, `Alt+←` vuelve por el recorrido, `Esc` regresa al folio y pulsar una tarea te lleva a ella. Nada se escribe en la memoria: se recalcula de la hoja y de un historial de cambios que la app guarda sola en el navegador (IndexedDB) y que va dentro de la copia JSON.

**Plantillas**: en `/`, «Guardar como plantilla» guarda la tarea con sus subtareas; luego «Plantilla · nombre» la inserta (sin estados ni fechas). Para borrar una, escribe «borrar» en el menú. Las plantillas viajan en la copia JSON.

**Copia de seguridad**: `Cmd/Ctrl+S` descarga todo en JSON; `Cmd/Ctrl+O` (o soltar el archivo sobre la página) lo restaura. Importar reemplaza la hoja y se puede deshacer.

## IA (opcional)

La IA trabaja por detrás de lo que ya existe, sin ventana de chat. Propone y tú decides: cada respuesta llega como una vista previa bajo la línea de captura, `Enter` la aplica (un solo `Cmd/Ctrl+Z` la deshace) y `Esc` la descarta.

- **Volcado**: en `Cmd/Ctrl+K`, escribe o pega algo desordenado («el jueves demo Captia, antes revisar alarmas ZimVie y validar el torno 04») y pulsa `Cmd/Ctrl+Enter`. Sale un árbol con subtareas, tags y fechas. `Enter` sigue apuntando la línea tal cual, sin IA.
- **Órdenes**: en la misma línea, «mueve lo de ZimVie a mañana y márcalo #urgente», «completa lo de Copilot». Si abres `Cmd/Ctrl+K` desde una tarea, «esta» es esa tarea.
- **Dividir en pasos**: en `/`, «Dividir en pasos» propone de 3 a 6 subtareas. «Pedir a la IA…» abre la línea sobre esa tarea.
- **Plan del día** (`Alt+P`, o en `/`): propone como mucho 3 tareas para hoy, con prioridad, entre lo vencido, lo arrastrado y lo que está en curso, en orden y con un porqué corto. La propuesta ya se ve como quedará la tira del plan; `Enter` la aplica.
- **Resumen redactado** (`Alt+Shift+R`, o en `/`): el resumen del día en frases, para un chat o un correo. `Enter` lo copia. (`Alt+R` sigue copiando el Markdown literal, sin IA.)
- **Buscar por significado**: en `Cmd/Ctrl+F`, si las palabras no encuentran nada, `Cmd/Ctrl+Enter` pide a la IA las tareas que encajan («lo de la máquina» → «Validar torno 04»). Escribir de nuevo vuelve a la búsqueda normal.

Las propuestas se van dibujando mientras llegan. En pantallas táctiles, «IA», «aplicar», «copiar» y «descartar» son botones, y a la IA se llega desde `/` → «Pedir a la IA…».

**Dictado**: donde el navegador lo permite (Chrome, Edge, Safari), la línea de `Cmd/Ctrl+K` tiene un micrófono (`Alt+V`). Usa el reconocimiento de voz del propio navegador, no la IA, y funciona aunque no haya clave.

**Recoger del correo y la agenda** (`Alt+I`, o `/` → Recoger): dentro de claude.ai, la app lee tu Gmail y tu Google Calendar con tus propios conectores de claude.ai y propone como tareas todo lo que te toca de forma clara, sin límite: correos que te escriben a ti (no en copia) y aún no has contestado, hilos destacados, correos tuyos de hace 2 a 10 días que siguen sin respuesta y reuniones de la próxima semana con la invitación sin responder. Se ven como cualquier otra propuesta: `Enter` las añade, `Esc` las descarta, `Cmd/Ctrl+Z` deshace. Cada tarea guarda en la nota el enlace a su correo o evento; `Alt+O` lo abre. Al abrir la página y cada 15 minutos mientras está a la vista, la app vuelve a mirar y la cabecera avisa («3 tareas en tu correo»); no se añade nada hasta que lo abres. Lo que ya viste no vuelve a proponerse, salvo que el hilo reciba una respuesta nueva. Recoger solo lee: la app no puede enviar, borrar ni responder invitaciones (solo escribe borradores de Gmail y reuniones nuevas, cuando tú lo pides; ver abajo).

**Granola**: si tienes conectado Granola en claude.ai, Recoger lee también tus notas de reuniones de las dos últimas semanas y propone lo que la nota dice que te toca a ti (acciones asignadas a ti o compromisos tuyos), nada asignado a otros. Con garantías:
- Cada tarea trae la cita literal de la nota donde se dice. La app comprueba que esas palabras están de verdad en la nota; si no, la tarea no se propone y el aviso lo dice («1 sin cita en la nota, descartada»). La cita se ve al pasar por encima de «Granola ↗», que abre la nota (`Alt+O`).
- Una nota se propone una sola vez. Si en el folio ya hay tareas de esa nota, no vuelve a proponerse, aunque abras la app en otro navegador. Una nota aún vacía espera a la siguiente pasada. Lo que edites en la nota después ya no se vuelve a leer.
- Nunca propone una tarea con el mismo texto que una abierta del folio, ni dos iguales a la vez; si lo mismo sale en la nota y en un correo, queda una sola, citando la nota. Los resúmenes que Granola envía por correo se ignoran.
- Si Granola no está conectado, responde algo que la app no sabe leer o falla, Recoger lo dice en vez de quedarse callado.

**Cerrar el bucle**: las tareas que esperan una respuesta (con `#esperando` o las que Recoger sacó de un correo tuyo sin contestar) se vigilan en esa misma pasada. Cuando llega la respuesta, la cabecera lo dice («1 respuesta en tu correo») y Recoger propone marcar la tarea como hecha y, si la respuesta pide algo, añadir el siguiente paso.

**Borrador listo** (`Alt+D`, o `/` → «Preparar borrador»): para una tarea que consiste en escribir a alguien, la app redacta el correo con tu tono a partir del hilo del que salió (o un recordatorio amable si estás esperando). Dentro de claude.ai las tareas que vienen de un correo ya lo traen preparado, y la fila lo marca con un ✎ discreto. `Enter` lo copia; `Alt+O` abre el correo para pegarlo. Escribe en la línea y `Cmd/Ctrl+Enter` para pedir otra versión («más corto»).

- **Tu estilo**: dentro de claude.ai, la app lee tus 5 últimos correos enviados y saca tu firma (las líneas con las que acaban, tal cual) y unos ejemplos cortos de saludo, tono y longitud. El borrador los imita y acaba con tu firma, una sola vez. Se guarda en el navegador (`daily-tracking-tool:estilo`) y se relee una vez por semana.
- **A Gmail** (`Alt+G`, o «Gmail» bajo el borrador): lo guarda como borrador en tu Gmail y lo abre en otra pestaña. Si la tarea salió de un correo, es la respuesta en ese hilo (a quien escribió el último, el resto en copia); si no, un correo nuevo a las direcciones escritas en la tarea. Con el borrador ya hecho, `Alt+G` (también sobre la fila) lo vuelve a abrir. Pedir otra versión hace uno nuevo.

Nunca se envía nada desde la app: el borrador se manda (o no) desde Gmail. Fuera de claude.ai no hay «Gmail» ni estilo leído del correo: `Enter` copia, como siempre.

**Preparar reunión** (`/` → «Preparar reunión…»): elige una reunión de hoy o mañana y la app propone una nota corta (de qué va, qué se habló la última vez con esas personas, qué les debes) y hasta cuatro subtareas, en la tarea de la reunión o en una nueva. Con Granola conectado, también lee tus notas de las últimas reuniones (hasta 3, de los dos últimos meses) con alguno de los asistentes. Preparar una reunión que ya existe no toca Calendar.

**Nueva reunión** (primera opción de esa lista): la reunión que pide la tarea, como propuesta. Título y agenda corta, de la tarea, su nota y su correo; 30 minutos en el primer hueco libre de tu agenda en los dos próximos días laborables, de 9:00 a 18:00; invitados, las direcciones de la tarea y de su correo, y las `@personas` que coinciden con una de ellas (las que no, van en la descripción, sin invitar). `Enter` la crea en Google Calendar con enlace de Meet, y Google envía la invitación («Reunión creada en Calendar · invitación enviada a 2»). La tarea pasa a apuntar al evento (`Alt+O`) y toma su fecha; el enlace al correo, si lo tenía, queda en la nota. `Esc` la descarta. Para moverla, escribe en la línea y `Cmd/Ctrl+Enter`: «el jueves a las 10», «mañana 16:30», «1 hora», «45 min» (los días, con la gramática de siempre).

Al modelo solo le llega tu petición y una lista compacta de las tareas (texto, estado, tags, fecha). Con Recoger, además, el último mensaje (recortado, sin el historial citado) de los hilos que pasan los filtros, el título de las invitaciones pendientes y el resumen y tus notas de las reuniones de Granola aún no leídas (sin la transcripción). Con Borrador listo y Preparar reunión, el hilo de esa tarea o los correos y notas recientes con los asistentes; con Borrador listo, también tu firma y hasta 3 de tus correos enviados, recortados a unas líneas. Tu agenda no le llega: el hueco de Nueva reunión se calcula en el navegador. En segundo plano solo corren Recoger y, dentro de claude.ai, los borradores de hasta 6 tareas de correo por visita.

**Cómo se activa**: la app elige sola la primera vía que funcione.

1. **Con servidor** (la clave no sale de tu máquina): crea `.env.local` con tu clave y arranca como siempre.

   ```bash
   echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local
   npm run dev
   ```

   `AI_MODEL` cambia el modelo (por defecto `anthropic/claude-haiku-4-5`; también vale `openai/...` o `google/...` con su clave).
2. **Dentro de claude.ai** (la vista previa publicada como artifact): usa Claude con tu propia cuenta. No hace falta clave; claude.ai te pide permiso la primera vez. Para Recoger, Borrador listo y Nueva reunión, el artifact se publica con las capacidades `sample`, `mcp`, `db` y `user` (conectores `Gmail`: `search_threads`, `get_thread`, `create_draft`; `Google Calendar`: `list_events`, `create_event`; `Granola`: `list_meetings`, `get_meetings`), y claude.ai pide permiso una vez por conector. Sin `create_draft` o `create_event`, «Gmail» y «Nueva reunión» dicen que falta el permiso y lo demás sigue igual.
3. **Clave en el navegador** (una copia local o en un hosting estático, sin servidor): la primera vez que pides algo a la IA, la línea te pide tu clave de Anthropic. Se guarda solo en ese navegador (`localStorage`) y el navegador llama directamente a Anthropic. En `/`, «Olvidar la clave de la IA» la borra. `VITE_AI_MODEL` cambia el modelo (por defecto `claude-haiku-4-5`).

Sin ninguna de las tres, la app funciona igual.

**Cómo está hecho**: [CopilotKit](https://github.com/CopilotKit/CopilotKit) v2 sin su UI de chat. En el navegador, `src/ai/` usa el núcleo de CopilotKit (cargado solo al primer uso; `claude.ts` y `direct.ts` son las otras dos vías, con el mismo prompt de `src/ai/prompt.ts`) y las operaciones de `propose_changes` (`add`, `update`, `move`, `remove`) se aplican con las mismas funciones del árbol que usa el teclado (`src/ai/ops.ts`). Hay tres herramientas de frontend: `propose_changes` (cambios), `write_text` (textos) y `select_tasks` (búsqueda); cada petición obliga al agente a responder con una sola de ellas, y sus argumentos llegan en streaming. En el servidor, `server/ai.ts` es el runtime de CopilotKit con un `BuiltInAgent` que solo deja elegir desde el navegador cuál de esas herramientas usar; Vite lo sirve en `/api/ai` en `dev` y `preview`. Para publicarlo fuera de local, `createAiHandler()` devuelve un handler Fetch estándar que corre en Cloudflare Workers, Vercel, Netlify, Deno o Bun; si vive en otro dominio, `VITE_AI_URL` apunta la app a él.

**App instalable y sin conexión**: la versión compilada (`npm run build`) se puede instalar desde el navegador y abre sin red; los datos ya viven en el propio navegador.

## Teclado

| Tecla | Acción |
|---|---|
| `Enter` | Nueva tarea debajo (en una tarea vacía anidada, sube de nivel) |
| `Tab` / `Shift+Tab` | Convertir en subtarea / subir nivel |
| `Cmd/Ctrl+Enter` | Completar o reabrir |
| `Shift+Enter` | Nota de la tarea (`Esc` vuelve al texto) |
| `#tag` | Escribir `#algo` en el texto lo convierte en tag al pulsar Enter o salir |
| `/` | Acciones rápidas (en curso, subtarea, colapsar, mover, eliminar…): al principio de la línea, tras un espacio o al final (salvo tras un número, para `3/10`); sin línea activa, sobre la última tarea |
| `Cmd/Ctrl+/` | Acciones rápidas desde cualquier punto del texto |
| `↑` / `↓` | Moverse entre tareas |
| `Alt+Shift+↑/↓` | Mover la tarea entre sus hermanas |
| `Cmd/Ctrl+.` | Colapsar / expandir hijos |
| `Backspace` en una tarea vacía | Borrarla |
| `Cmd/Ctrl+Shift+Backspace` | Borrar la tarea (también la `×` al pasar por encima) |
| `Shift+↑/↓` al borde del texto · `Shift+clic` · `Cmd/Ctrl+clic` | Seleccionar varias tareas: `Backspace` las borra, `Cmd/Ctrl+Enter` las completa, `Esc` sale. `Cmd/Ctrl+A` dos veces las selecciona todas |
| `?` | Todos los atajos (o «Todos» en la barra de abajo) |
| `Cmd/Ctrl+Z` · `Cmd/Ctrl+Shift+Z` | Deshacer · rehacer (texto y estructura) |
| `Alt+H` | Planificar para hoy (o quitarlo) |
| `Alt+L` | Posponer (o devolver una pospuesta) |
| `Alt+U` | Subrayar en verde lo seleccionado, o toda la tarea (o quitarlo) |
| `Alt+T` | Vista Hoy |
| `Alt+I` | Recoger tareas del correo y la agenda (dentro de claude.ai) |
| `Alt+D` | Borrador del correo de la tarea (se copia, no se envía) |
| `Alt+G` | Guardar el borrador en Gmail y abrirlo (o abrir el ya hecho; dentro de claude.ai) |
| `Alt+O` | Abrir el correo o evento del que salió la tarea |
| `Cmd/Ctrl+K` | Captura global |
| `Cmd/Ctrl+F` | Buscar |
| `Alt+F` | Modo foco en la tarea actual |
| `Alt+P` | Planificar el día con la IA (rehace el plan) |
| `Alt+J` | Ir a la tarea «Ahora» del plan |
| `Alt+R` | Copiar el resumen del día |
| `Alt+M` | Abrir o cerrar la memoria |
| `Cmd/Ctrl+S` · `Cmd/Ctrl+O` | Exportar · importar copia JSON |

En el **Board** (`Alt+2`, o `Alt+1` para volver a la lista):

| Tecla | Acción |
|---|---|
| `←` / `→` | Mover la tarjeta a la columna anterior / siguiente |
| `↑` / `↓` | Moverse entre tarjetas |
| `Enter` | Editar el texto |
| `Cmd/Ctrl+Enter` | Completar o reabrir |
| `Cmd/Ctrl+Backspace` | Borrar (se puede deshacer) |

Con el ratón: el asa `⋮⋮` a la izquierda arrastra la tarea con sus hijos; desplazar en horizontal mientras arrastras cambia el nivel.

En el Board, las tarjetas se arrastran entre **To do → Doing → Done**; en móvil, mantén pulsado un momento antes de arrastrar. Cada columna tiene su propio `+ Añadir` para capturar sin salir del tablero.

## Organizar

Encima de la lista, en pequeño:

- **Orden**: `Manual` es el árbol editable. `Fecha`, `Estado` y `Tag` agrupan las tareas en planos, cada una con su ruta de padres. Una tarea nueva creada dentro de un grupo hereda su estado o su tag.
- **Ocultar hechas** y **filtro por tag** (también al pulsar un tag de cualquier tarea). Al filtrar, los padres de lo que coincide se quedan atenuados como contexto.

La vista, el orden y los filtros se recuerdan en cada navegador.

## Arquitectura

- `src/lib/tree.ts`: operaciones puras sobre el árbol. Las tareas viven en un array plano con `parentId`; el orden manual es el orden relativo en el array.
- `src/lib/store.ts`: reducer, foco e historial de deshacer.
- `src/lib/persist.ts`: guardado en `localStorage` y validación de lo guardado.
- `src/lib/cloud.ts`: copia de la hoja en la base de datos del artifact cuando la app corre dentro de claude.ai.
- `src/lib/parse.ts`: la gramática de captura (`#tag`, `!`, fechas) y el pegado de listas.
- `src/lib/backup.ts`: exportar e importar JSON.
- `src/lib/organize.ts`: ordenar, agrupar y filtrar (puro, con tests).
- `src/lib/daily.ts`: día nuevo (tareas arrastradas y su edad) y resumen en Markdown.
- `src/lib/repeat.ts`: tareas recurrentes (gramática, siguiente fecha y la copia al completar).
- `src/lib/templates.ts`: plantillas guardadas.
- `src/lib/snooze.ts`: posponer y esperando (fechas, ocultar, volver al día siguiente).
- `src/lib/teach.ts`: avisos y los atajos que se enseñan solos.
- `src/lib/prefs.ts`: vista, orden y filtros recordados por navegador.
- `src/components/`: `ListView` y `TaskRow` (folio), `BoardView` (kanban), `Toolbar`, el menú `/`, `QuickCapture` y `SearchBar`.

Cada tarea guarda `status` (`todo` · `doing` · `done`), `tags` y `createdAt`: la lista y el Board son dos vistas de los mismos datos.

Estética según el sistema de Captia (`captia-technology/captia-design`): papel, tinta, gris y filete; el verde de marca solo como relleno con negro encima; Geist y Geist Mono.
