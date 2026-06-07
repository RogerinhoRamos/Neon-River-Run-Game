@echo off
cd /d "%~dp0"

echo === 1. Gerando a versao final do jogo (Build) ===
call npm run build

echo.
echo === 2. Movendo o jogo pronto para a raiz do projeto ===
if exist dist\index.html (
    copy /y dist\index.html .
    echo Jogo preparado com sucesso na raiz!
) else (
    echo [ERRO] Pasta dist ou index.html nao encontrados. Verifique o build.
    pause
    exit
)

echo.
echo === 3. Sincronizando com o GitHub (Pull Automatico) ===
:: O "--no-edit" impede que aquela tela preta com "~" se abra!
git pull origin main --allow-unrelated-histories --no-edit

echo.
echo === 4. Enviando tudo atualizado para o GitHub ===
git add .
set /p mensagem="Digite a mensagem do commit: "
git commit -m "%mensagem%"
git push -u origin main

echo.
echo === TUDO PRONTO! Arquivos atualizados. ===
pause