# 🚀 Project Charter — Acordes (Plataforma Musical y Transcriptor de Tablaturas)

> **Objetivo:** Plataforma de acordes y transcripción musical automática, con pipeline de actualización de canciones desde YouTube, catálogo personal de temas karaokeables y visualizador interactivo en React.
> **Última actualización:** 2026-07-24

---

## 🔍 Diagnóstico Actual

### Inventario (Estado del Código Fuente)

| Componente | Descripción | Estado |
| --- | --- | --- |
| `client/` | Visualizador Vite + React de acordes y letras. | ✅ Listo |
| `enricher.py` | Procesador y enriquecedor de canciones con datos de acordes. | ✅ Listo |
| `chords_db.json` / `songs.json` | Base de datos local de canciones procesadas. | ✅ Listo |
| `preload_chords.py` | Carga inicial de librerías de acordes. | ✅ Listo |
| `extract_bookmarks.py` | Extractor de marcadores de música. | ⚠️ Parcial |
| Pipeline automatizado YT | Ingesta automática de videos de YouTube y extracción de acordes. | ❌ No existe |
| Transcriptor de Tablaturas | Motor de generación de tablaturas automáticas basadas en audio/acordes. | ❌ No existe |

### Deuda Técnica y Riesgos

| Ámbito | Problema | Riesgo |
| --- | --- | --- |
| URLs Hardcodeadas | El cliente tiene URLs locales `http://127.0.0.1:8001` fijas en `App.jsx` y `SongViewer.jsx`. | 🔴 Alto — Falla al desplegar en producción. |
| Escalabilidad de JSON | Almacenar miles de canciones en `chords_db.json` degrada las búsquedas. | 🟠 Medio — Latencia de lectura. |

---

## 🗺️ Fases de Desarrollo y Prompts para IA

---

### FASE 1: Limpieza de Endpoints & Pipeline de Ingesta YouTube

**Objetivo:** Refactorizar URLs hardcodeadas a variables de entorno y construir el pipeline de actualización automática para ingesta de acordes e integración de videos de YouTube.

**Decisiones Humanas:**
- Proveer API Key de YouTube Data API v3 si se requiere búsqueda masiva.

**Prompt Exacto para la IA:**
```text
Actúa como desarrollador Full-Stack Python/React.

TAREA:
1. Extrae las URLs locales hardcodeadas en `client/src/App.jsx` y `SongViewer.jsx` reemplazándolas por `import.meta.env.VITE_API_URL`.
2. Diseña el pipeline en `services/yt_ingest_pipeline.py` que:
   - Reciba una URL o término de búsqueda de YouTube.
   - Extraiga el audio/metadatos y busque la secuencia de acordes compatible.
   - Guarde el resultado en `chords_db.json` o base de datos SQLite.
3. Desarrolla un script de carga masiva `scripts/bulk_song_loader.py` para procesar canciones personales.
```

---

### FASE 2: Motor de Tablaturas Automáticas

**Objetivo:** Crear el módulo de extracción y renderizado automático de tablaturas musicalizadas interactivas.

**Prompt Exacto para la IA:**
```text
Actúa como experto en Audio Processing y desarrollo Web en React.

TAREA:
1. Desarrolla `core/tab_generator.py` para convertir progresiones de acordes en diagramas de tablaturas (formato ASCII y SVG).
2. En el frontend React, crea el componente `TabViewerComponent.jsx` que permita transponer notas (+1/-1 semitono) y ajustar la velocidad de autoscroll mientras suena el video de YouTube en background.
```

---

### FASE 3: Optimización y Pruebas Unitarias

**Objetivo:** Implementar suite de pruebas unitarias para `enricher.py` y optimizar la velocidad de búsqueda de canciones.

**Prompt Exacto para la IA:**
```text
Actúa como Ingeniero QA y Backend Python.

TAREA:
1. Escribe tests unitarios con `pytest` en `tests/test_enricher.py` para validar la correcta detección de tonos y variantes de acordes.
2. Indexa las búsquedas de canciones por artista, título y etiquetas karaokeables.
```
