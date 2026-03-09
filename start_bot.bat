@echo off
title FluxGuard Bot
color 0A

:START
cls
echo.
echo  ╔══════════════════════════════════════════╗
echo  ║         FluxGuard — Starting...        ║
echo  ╚══════════════════════════════════════════╝
echo.

:: Verifica daca Node.js e instalat
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js nu este instalat sau nu e in PATH.
    echo  Instaleaza de la: https://nodejs.org
    pause
    exit /b 1
)

:: Verifica daca .env exista
if not exist "%~dp0.env" (
    echo  [ERROR] Fisierul .env nu a fost gasit!
    echo  Copiaza .env.example in .env si completeaza tokenurile.
    pause
    exit /b 1
)

:: Verifica daca node_modules exista
if not exist "%~dp0node_modules" (
    echo  [INFO] node_modules lipsa — rulez npm install...
    cd /d "%~dp0"
    npm install
    echo.
)

:: Porneste botul prin start.js
cd /d "%~dp0"
node start.js

:: ── Botul s-a oprit (CTRL+C sau crash) ──────────────────────────────────────
echo.
echo  ╔══════════════════════════════════════════╗
echo  ║         FluxGuard s-a oprit            ║
echo  ╚══════════════════════════════════════════╝
echo.
echo  Ce vrei sa faci?
echo.
echo    [R] Restart bot
echo    [N] Inchide
echo.
set /p choice="  Alege (R/N): "

if /i "%choice%"=="R" goto START
if /i "%choice%"=="r" goto START

echo.
echo  La revedere!
timeout /t 2 >nul
exit /b 0
