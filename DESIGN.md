# Diseño de Acordes

Reglas de color de la interfaz, para que cada cambio nuevo calce con lo que ya está. Los valores viven en
`client/src/index.css` (`:root`); en los componentes se usan siempre las variables, nunca colores sueltos.

## Paleta

| Variable | Valor | Para qué |
|---|---|---|
| `--bg-dark` | `#07070b` | Fondo de la página (plano 1) |
| `--surface` | `#0f0f16` | Paneles: barra lateral, filtros, campos (plano 2) |
| `--raised` | `#161620` | Lo que se levanta al pasar el mouse (plano 3) |
| `--line` / `--line-strong` | `#24242f` / `#34343f` | Bordes normales / de botones |
| `--text-main` | `#f1f1f4` | Texto principal (16,9:1) |
| `--text-soft` | `#c9c9d3` | Texto de botones y chips (11,6:1) |
| `--text-muted` | `#8c8c99` | Rótulos y datos secundarios (5,8:1) |
| `--signal` | `#f2b84b` | El color de señal, ámbar (10,7:1 sobre superficie) |
| `--signal-ink` | `#2a1d04` | Texto sobre un fondo `--signal` (9,2:1) |
| `--signal-soft` | ámbar al 12% | Fondo de lo seleccionado |

`--primary`, `--secondary` y `--accent` quedaron como alias de `--signal` para el código antiguo. El código
nuevo usa `--signal`.

## Reglas

1. **Un solo color de señal.** El ámbar marca únicamente:
   - la acción principal de cada pantalla ("¿Qué cantar?" en la portada, "Reproducir" en la hoja);
   - lo que está seleccionado (carpeta, filtro, versión de la pista, botón encendido);
   - lo que suena: los acordes, la línea que se canta y el acorde que suena ahora.
2. **Un solo botón ámbar relleno por pantalla** (`.btn-primary`). Los demás son `.btn`: transparentes, con
   borde, y se levantan a `--raised` al pasar el mouse. Un botón encendido usa `.btn.btn-on`.
3. **Los colores de mood son de las tarjetas.** En la interfaz aparecen solo como un punto en los chips de
   filtro (`.filter-dot`). El texto de los chips es neutro.
4. **Sin degradados, brillos ni neón en la interfaz.** Los únicos elementos decorativos son las tarjetas por mood,
   el fondo 3D (en ámbar y grises, al 35% de opacidad) y el fondo con la música de la hoja (`Visualizer.jsx`).
   Ese fondo usa el color del mood de la canción (en Clásico, una capa de ese color sobre los colores de
   MilkDrop), se mueve según su temática y su energía, y va detrás de la hoja: con él encendido la hoja toma
   un fondo oscuro (`.with-visuals`) para que la letra se lea igual. Los presets de MilkDrop se eligen por no
   cansar la vista detrás de la letra: nada de rayas blanco y negro ni ruido.
5. **Lo no elegido se ve disponible, no apagado.** Solo lo que de verdad no se puede usar va desactivado.
6. **Texto en minúscula normal:** "Modo rápido", "Solo con pista oficial". Nada de mayúsculas sostenidas ni
   emojis en los controles.
7. **Contraste mínimo 4,5:1** para cualquier texto. Para comprobarlo, usar la fórmula WCAG (o Cool Contrast).
8. **Acordes siempre en sostenido** (A#, no Bb), también en la interfaz.

## Nombre

**Acordate**: "acorde" y "acordarse", en voseo. Reemplazó a "Musica", el nombre de la carpeta de marcadores original.
