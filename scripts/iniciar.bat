@echo off
REM Windows: doble clic. Busca Node y arranca la app.
setlocal
cd /d "%~dp0\.."
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Falta Node.js. Instalalo desde https://nodejs.org y volve a abrir este archivo.
  echo.
  pause
  exit /b 1
)
echo  Arrancando Auto Accept. Dejalo abierto mientras jugas.
echo  Para cerrarlo: Ctrl + C, o cerra esta ventana.
node src\index.mjs
pause
