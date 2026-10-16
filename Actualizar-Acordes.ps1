# Actualizar-Acordes.ps1
# Script para sincronizar marcadores de Chrome, enriquecer canciones y mapear karaokes de YouTube

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Host.UI.RawUI.WindowTitle = "Acordes - Sincronizador Automático"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " 🎸 ACORDES — SINCRONIZADOR DE CANCIONES Y KARAOKES" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# 1. Extraer marcadores de Chrome
Write-Host "[1/4] 📑 Extrayendo marcadores de Chrome..." -ForegroundColor Yellow
python extract_bookmarks.py
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠ Error al extraer marcadores. Continuando..." -ForegroundColor Red
} else {
    Write-Host "✔ Marcadores actualizados en songs.json" -ForegroundColor Green
}
Write-Host ""

# 2. Sumar canciones que tienen karaoke subido pero no marcador de acordes
Write-Host "[2/4] 🎤 Buscando acordes de tus karaokes sin marcador (Cifra Club / LaCuerda)..." -ForegroundColor Yellow
python karaoke_songs.py
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠ Error al buscar acordes de karaokes. Continuando..." -ForegroundColor Red
} else {
    Write-Host "✔ Canciones de karaoke agregadas a songs.json" -ForegroundColor Green
}
Write-Host ""

# 3. Enriquecer canciones nuevas
Write-Host "[3/4] 🧠 Enriqueciendo nuevas canciones (Last.fm / MusicBrainz / Qwen)..." -ForegroundColor Yellow
python enricher.py
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠ Error al enriquecer. Continuando..." -ForegroundColor Red
} else {
    Write-Host "✔ Canciones enriquecidas en enriched_songs.json" -ForegroundColor Green
}
Write-Host ""

# 4. Pre-cargar acordes, mapear backing tracks de YouTube y tiempos de las letras
Write-Host "[4/4] 🎬 Sincronizando acordes y backing tracks de YouTube..." -ForegroundColor Yellow
python preload_chords.py
if ($LASTEXITCODE -ne 0) {
    Write-Host "⚠ Error en pre-carga de acordes." -ForegroundColor Red
} else {
    Write-Host "✔ Acordes y karaokes sincronizados con éxito!" -ForegroundColor Green
}
Write-Host ""

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " 🎉 ¡PROCESO FINALIZADO CON ÉXITO!" -ForegroundColor Green
Write-Host " La aplicación web ya cuenta con las últimas canciones y karaokes." -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Presiona cualquier tecla para cerrar..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
