# Backlog - Acordes

## 🌟 Focus (Esta Semana)
- [ ] Diseñar pipeline de actualización automática para ingesta de acordes y sincronización con videos de YouTube <!-- priority: HIGH, type: FEATURE, est: 60 -->
- [ ] Implementar script de carga masiva para canciones personales y repertorio karaokeable <!-- priority: HIGH, type: FEATURE, est: 45 -->

## 📋 Backlog General
- [ ] Exportar desde el proyecto Karaokes los tiempos de `stable_whisper` de cada video (JSON por canción): sincronía exacta sin calibrar, también para los 15 videos que no duran lo mismo que la grabación original <!-- priority: MEDIUM, type: FEATURE, est: 60 -->
- [ ] Desarrollar módulo de extracción y generación automática de tablaturas musicalizadas <!-- priority: MEDIUM, type: FEATURE, est: 60 -->
- [ ] Optimizar almacenamiento y búsqueda rápida en chords_db.json y enriched_songs.json <!-- priority: MEDIUM, type: REFACTOR, est: 45 -->
- [ ] Integrar pruebas unitarias para el motor enricher.py (ya hay tests del parser de nombres en `tests/test_enricher.py`) <!-- priority: LOW, type: DEV, est: 30 -->
- [ ] Bajar efectos visuales: un solo protagonista (íconos celestes o fondo 3D), notas flotantes fuera del texto, sin blur en las tarjetas <!-- priority: MEDIUM, type: UX, est: 45 -->
- [ ] Ocultar marcadores que no son canciones (ClaveÚnica, LinkedIn, Ableton, tiendas…): la mayoría de los 37 sin enriquecer aparecen como tarjetas <!-- priority: MEDIUM, type: FIX, est: 30 -->

## ✅ Completadas
- [x] Sincronización real, línea a línea: `lyrics_sync.py` baja la letra con tiempos de LRCLIB y la alinea con cada hoja (alineación global con repeticiones, con tests); 40 de 41 canciones con video. La línea de lectura queda bajo el header fijo, la hoja tiene espacio al final y la calibración 🎯 (tocar la línea que suena) guarda el desfase de los videos que no duran lo mismo que la grabación (15 de 34) <!-- priority: HIGH, type: FEATURE, done: 2026-10-12 -->
- [x] Móvil: filtros plegables (primera canción de y=1.224 a y=522), botones del header en grilla (¿Qué cantar? ya no se sale), visor con botones de ícono (Cerrar visible), "atrás" del celular cierra la canción, panel de video compacto (400 → 313 px), hoja con todo el ancho (de ~40 a 50 caracteres por línea) y control A−/A+ del tamaño de letra <!-- priority: HIGH, type: UX, done: 2026-10-12 -->
- [x] Títulos y artistas limpios en tarjetas, visor, modal y carpetas. Se arregló `parse_song_name` ("(acordes)", "Tab por", Ultimate Guitar en español, " by " dentro de títulos) con tests, y se recalcularon 54 canciones. Destrabó 4 karaokes que no emparejaban (35 → 39 con pista) <!-- priority: HIGH, type: UX, done: 2026-10-10 -->
- [x] Paginación del listado con selector de tarjetas por página (24/48/96/Todas, se recuerda). Con 24: DOM de 7.331 a 963 nodos, animaciones infinitas de 1.267 a 133, re-render al filtrar de ~50–70 ms a ~9 ms <!-- priority: HIGH, type: PERF, done: 2026-09-30 -->
- [x] Autoscroll sincronizado con el video de YouTube: la hoja sigue el tiempo del video (adelantar, pausar), respeta correcciones manuales y el botón 🔗 alterna con velocidad fija. Incluye el fix del handshake `listening`, sin el cual el autoscroll nunca arrancaba con el video <!-- priority: HIGH, type: FEATURE, done: 2026-09-30 -->
- [x] Extraer URLs locales hardcodeadas (127.0.0.1:8001) en App.jsx y SongViewer.jsx a variables de entorno (`VITE_API_URL` en `client/.env.development`; sin ella se ocultan las funciones que requieren servidor) <!-- priority: HIGH, type: FIX, est: 30, done: 2026-09-30 -->
- [x] Estructura inicial del cliente Vite y servidor de visualización de acordes <!-- priority: LOW, type: ADMIN, est: 15 -->
