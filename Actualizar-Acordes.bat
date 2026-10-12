@echo off
chcp 65001 > nul
title Acordes - Sincronizador Automático
powershell -ExecutionPolicy Bypass -File "%~dp0Actualizar-Acordes.ps1"
