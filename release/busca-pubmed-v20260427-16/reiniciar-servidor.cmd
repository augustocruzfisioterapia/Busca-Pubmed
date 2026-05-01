@echo off
setlocal
cd /d "%~dp0"

echo Encerrando servidor antigo na porta 4173, se existir...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :4173 ^| findstr LISTENING') do (
  taskkill /PID %%a /F >nul 2>nul
)

echo.
echo Iniciando servidor atualizado em http://localhost:4173/?v=20260427-16
echo Mantenha esta janela aberta enquanto estiver usando o app.
echo Para encerrar o servidor, feche esta janela.
echo.
npm start
