# Backlog - Acordes

## 🌟 Focus (Esta Semana)
- [ ] Fact-check de acordes contra el audio: escalar la prueba de `experiments/chord_check` a todas las canciones con pista (tono, acordes mal escritos, tramos que no calzan) <!-- priority: HIGH, type: FEATURE, est: 60 -->
- [ ] Auto-calibrar el desfase de la letra con los acordes del audio (Fénix: la hoja iba 3 s adelantada) <!-- priority: HIGH, type: FEATURE, est: 45 -->
- [ ] Renovar la clave de Qwen (DashScope responde 401: el mood y la temática caen al respaldo genérico) y reclasificar las ~60 canciones con "Reflexivo / Existencial / Media" <!-- priority: MEDIUM, type: FIX, est: 20 -->

## 📋 Backlog General
- [ ] Acordes versión propia: generar o corregir hojas desde el audio, dejando la original como versión alternativa <!-- priority: MEDIUM, type: FEATURE, est: 120 -->
- [ ] Exportar desde el proyecto Karaokes los tiempos de `stable_whisper` de cada video (JSON por canción): sincronía exacta sin calibrar, también para los 15 videos que no duran lo mismo que la grabación original <!-- priority: MEDIUM, type: FEATURE, est: 60 -->
- [ ] Desarrollar módulo de extracción y generación automática de tablaturas musicalizadas <!-- priority: MEDIUM, type: FEATURE, est: 60 -->
- [ ] Optimizar almacenamiento y búsqueda rápida en chords_db.json y enriched_songs.json <!-- priority: MEDIUM, type: REFACTOR, est: 45 -->
- [ ] Integrar pruebas unitarias para el motor enricher.py (ya hay tests del parser de nombres en `tests/test_enricher.py`) <!-- priority: LOW, type: DEV, est: 30 -->
- [ ] Bajar efectos visuales: un solo protagonista (íconos celestes o fondo 3D), notas flotantes fuera del texto, sin blur en las tarjetas <!-- priority: MEDIUM, type: UX, est: 45 -->

## ✅ Completadas
- [x] Scraper de Cifra Club al día con su HTML nuevo (`<b data-chord-*>` y `<div class="kvMV">`), con tests; reparadas en el lugar las 20 hojas que habían quedado sin acordes marcados (sin color, sin transposición ni diagramas) <!-- priority: HIGH, type: FIX, done: 2026-10-15 -->
- [x] Pipeline de actualización en 4 pasos (`Actualizar-Acordes`): marcadores → canciones de tus karaokes → enriquecimiento → acordes, pistas y tiempos de letra. Nombre desde la URL para marcadores sin nombre útil, LaCuerda baja el `.shtml` de las páginas índice y el emparejador de karaokes tolera "(Acoustic version)", "M.A.I" y "30/Thirty" (43 → 64 canciones con pista) <!-- priority: HIGH, type: FEATURE, done: 2026-10-14 -->
- [x] Carga masiva del repertorio karaokeable (`karaoke_songs.py`): busca en Cifra Club y LaCuerda la hoja de cada karaoke subido sin marcador; 21 de 39 encontradas, 20 confirmadas por la letra. Karaokes visibles en la app: 35 → 59 de 77 <!-- priority: HIGH, type: FEATURE, done: 2026-10-14 -->
- [x] Solo páginas de acordes y una tarjeta por canción: fuera los 33 marcadores que no son canciones (herramientas, tiendas, videos) y las 11 canciones guardadas dos veces (móvil/escritorio, .com/.com.br, dos sitios), conservando la versión con pista, letra con tiempos o acordes. De 261 tarjetas a 213 canciones <!-- priority: MEDIUM, type: FIX, done: 2026-10-14 -->
- [x] Sincronización real, línea a línea: `lyrics_sync.py` baja la letra con tiempos de LRCLIB y la alinea con cada hoja (alineación global con repeticiones, con tests); 40 de 41 canciones con video. La línea de lectura queda bajo el header fijo, la hoja tiene espacio al final y la calibración 🎯 (tocar la línea que suena) guarda el desfase de los videos que no duran lo mismo que la grabación (15 de 34) <!-- priority: HIGH, type: FEATURE, done: 2026-10-12 -->
- [x] Móvil: filtros plegables (primera canción de y=1.224 a y=522), botones del header en grilla (¿Qué cantar? ya no se sale), visor con botones de ícono (Cerrar visible), "atrás" del celular cierra la canción, panel de video compacto (400 → 313 px), hoja con todo el ancho (de ~40 a 50 caracteres por línea) y control A−/A+ del tamaño de letra <!-- priority: HIGH, type: UX, done: 2026-10-12 -->
- [x] Títulos y artistas limpios en tarjetas, visor, modal y carpetas. Se arregló `parse_song_name` ("(acordes)", "Tab por", Ultimate Guitar en español, " by " dentro de títulos) con tests, y se recalcularon 54 canciones. Destrabó 4 karaokes que no emparejaban (35 → 39 con pista) <!-- priority: HIGH, type: UX, done: 2026-10-10 -->
- [x] Paginación del listado con selector de tarjetas por página (24/48/96/Todas, se recuerda). Con 24: DOM de 7.331 a 963 nodos, animaciones infinitas de 1.267 a 133, re-render al filtrar de ~50–70 ms a ~9 ms <!-- priority: HIGH, type: PERF, done: 2026-09-30 -->
- [x] Autoscroll sincronizado con el video de YouTube: la hoja sigue el tiempo del video (adelantar, pausar), respeta correcciones manuales y el botón 🔗 alterna con velocidad fija. Incluye el fix del handshake `listening`, sin el cual el autoscroll nunca arrancaba con el video <!-- priority: HIGH, type: FEATURE, done: 2026-09-30 -->
- [x] Extraer URLs locales hardcodeadas (127.0.0.1:8001) en App.jsx y SongViewer.jsx a variables de entorno (`VITE_API_URL` en `client/.env.development`; sin ella se ocultan las funciones que requieren servidor) <!-- priority: HIGH, type: FIX, est: 30, done: 2026-09-30 -->
- [x] Estructura inicial del cliente Vite y servidor de visualización de acordes <!-- priority: LOW, type: ADMIN, est: 15 -->
