@echo off
setlocal
cd /d "%~dp0"
echo Iniciando servidor local em http://localhost:4173
echo Feche esta janela para encerrar o servidor.
echo.
npm start
