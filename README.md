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

## Escribir rápido

Al pulsar Enter (o salir de la línea), el texto se interpreta:

- `#tag` en cualquier sitio añade el tag.
- `!` como palabra suelta marca la tarea como prioritaria.
- Una fecha al final de la línea la planifica: `hoy`, `mañana`, `pasado mañana`, un día de la semana (`viernes`) o `3/10`. En mitad de la frase, con `@` (`Revisar @lunes la oferta`). Sin `@`, solo se lee al final, así que «Informe de mañana para Ana» se queda como está.

`Llamar a IT mañana #zimvie !` → «Llamar a IT», para mañana, con `#zimvie` y prioridad.

**Pegar una lista** (varias líneas) crea una tarea por línea. La sangría, las viñetas `-` `*` `1.`, los `├─ │ └─` y las casillas `[ ]` `[x]` `☐` `☑` se respetan: pegar un árbol crea el árbol.

**Hoy** (`Alt+T`, o «Hoy» encima de la lista) muestra solo lo planificado para hoy o vencido, más lo que has cerrado hoy. `Alt+H` planifica o desplanifica la tarea actual para hoy.

**Captura global** (`Cmd/Ctrl+K`): una línea flotante para apuntar algo sin perder el sitio. Enter la guarda (con la misma gramática) y el cursor vuelve a donde estabas; `Esc` la descarta.

**Buscar** (`Cmd/Ctrl+F`): filtra al escribir por texto, notas y tags, sin acentos y con las palabras en cualquier orden. Enter salta al primer resultado; `Esc` limpia la búsqueda.

**Modo foco** (`Alt+F` sobre una tarea): todo lo que no es esa tarea y sus subtareas se atenúa. Se sale con `Alt+F` otra vez o con la etiqueta «Foco» de arriba.

**Día nuevo**: la primera vez que abres la hoja cada día, lo que quedó abierto de días anteriores sube arriba, y su fecha se cambia por la edad (`3 d`) para que se note lo que se arrastra.

**Resumen del día** (`Alt+R`): copia al portapapeles un Markdown con lo hecho hoy (con su proyecto) y lo que está en curso, listo para pegar en un chat o un correo.

**Plantillas**: en `/`, «Guardar como plantilla» guarda la tarea con sus subtareas; luego «Plantilla · nombre» la inserta (sin estados ni fechas). Para borrar una, escribe «borrar» en el menú. Las plantillas viajan en la copia JSON.

**Copia de seguridad**: `Cmd/Ctrl+S` descarga todo en JSON; `Cmd/Ctrl+O` (o soltar el archivo sobre la página) lo restaura. Importar reemplaza la hoja y se puede deshacer.

## Teclado

| Tecla | Acción |
|---|---|
| `Enter` | Nueva tarea debajo (en una tarea vacía anidada, sube de nivel) |
| `Tab` / `Shift+Tab` | Convertir en subtarea / subir nivel |
| `Cmd/Ctrl+Enter` | Completar o reabrir |
| `Shift+Enter` | Nota de la tarea (`Esc` vuelve al texto) |
| `#tag` | Escribir `#algo` en el texto lo convierte en tag al pulsar Enter o salir |
| `/` | Acciones rápidas (en curso, subtarea, colapsar, mover, eliminar…) |
| `↑` / `↓` | Moverse entre tareas |
| `Alt+Shift+↑/↓` | Mover la tarea entre sus hermanas |
| `Cmd/Ctrl+.` | Colapsar / expandir hijos |
| `Backspace` en una tarea vacía | Borrarla |
| `Cmd/Ctrl+Z` · `Cmd/Ctrl+Shift+Z` | Deshacer · rehacer (texto y estructura) |
| `Alt+H` | Planificar para hoy (o quitarlo) |
| `Alt+T` | Vista Hoy |
| `Cmd/Ctrl+K` | Captura global |
| `Cmd/Ctrl+F` | Buscar |
| `Alt+F` | Modo foco en la tarea actual |
| `Alt+R` | Copiar el resumen del día |
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
- `src/lib/parse.ts`: la gramática de captura (`#tag`, `!`, fechas) y el pegado de listas.
- `src/lib/backup.ts`: exportar e importar JSON.
- `src/lib/organize.ts`: ordenar, agrupar y filtrar (puro, con tests).
- `src/lib/daily.ts`: día nuevo (tareas arrastradas y su edad) y resumen en Markdown.
- `src/lib/templates.ts`: plantillas guardadas.
- `src/lib/prefs.ts`: vista, orden y filtros recordados por navegador.
- `src/components/`: `ListView` y `TaskRow` (folio), `BoardView` (kanban), `Toolbar`, el menú `/`, `QuickCapture` y `SearchBar`.

Cada tarea guarda `status` (`todo` · `doing` · `done`), `tags` y `createdAt`: la lista y el Board son dos vistas de los mismos datos.

Estética según el sistema de Captia (`captia-technology/captia-design`): papel, tinta, gris y filete; el verde de marca solo como relleno con negro encima; Geist y Geist Mono.
