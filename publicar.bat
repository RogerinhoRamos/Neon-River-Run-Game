@echo off
cd /d "%~dp0"

echo === 1. Forcando limpeza de arquivos antigos da raiz ===
git rm -f index.html 2>nul
git rm -rf icons 2>nul
git rm -f favicon.ico manifest.webmanifest sw.js 2>nul

echo.
echo === 2. Gerando a versao final do jogo (Build) ===
call npm run build

echo.
echo === 3. Movendo o HTML pronto para a raiz do projeto ===
if exist dist\index.html (
    copy /y dist\index.html .
    echo HTML preparado com sucesso!
) else (
    echo [ERRO] Pasta dist ou index.html nao encontrados.
    pause
    exit
)

echo.
echo === 4. Copiando arquivos PWA e Favicon da pasta Public para a raiz ===
if exist public (
    xcopy /y /e public\* .
    echo Arquivos da pasta Public copiados para a raiz!
)

echo.
echo === 5. Enviando tudo corrigido para o GitHub ===
git add .
git commit -m "Fix: trazendo favicon e arquivos public para a raiz"
git push -u origin main

echo.
echo === TUDO PRONTO! Todos os arquivos foram atualizados. ===
pause