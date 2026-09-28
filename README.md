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
- `src/lib/organize.ts`: ordenar, agrupar y filtrar (puro, con tests).
- `src/lib/prefs.ts`: vista, orden y filtros recordados por navegador.
- `src/components/`: `ListView` y `TaskRow` (folio), `BoardView` (kanban), `Toolbar` y el menú `/`.

Cada tarea guarda `status` (`todo` · `doing` · `done`), `tags` y `createdAt`: la lista y el Board son dos vistas de los mismos datos.

Estética según el sistema de Captia (`captia-technology/captia-design`): papel, tinta, gris y filete; el verde de marca solo como relleno con negro encima; Geist y Geist Mono.
