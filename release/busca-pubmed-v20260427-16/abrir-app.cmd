@echo off
setlocal
cd /d "%~dp0"

echo Abrindo Busca PubMed...
start "" "http://localhost:4173/?v=20260427-16"

echo.
echo Se a pagina nao abrir, copie e cole este endereco no navegador:
echo http://localhost:4173/?v=20260427-16
echo.
echo Para iniciar o servidor manualmente, rode:
echo npm start
echo.
pause
