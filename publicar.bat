@echo off
cd /d "%~dp0"

echo === Verificando configuracao do Git ===

if not exist .git (
    echo Inicializando o Git na pasta...
    git init
    git remote add origin https://github.com/RogerinhoRamos/Neon-River-Run-Game.git
    git branch -M main
)

echo.
echo === Preparando arquivos ===
git add .

echo.
set /p mensagem="Digite a mensagem do commit (o que voce alterou): "

echo.
echo === Enviando para o GitHub ===
git commit -m "%mensagem%"
git push -u origin main

echo.
echo === TUDO PRONTO! Seu projeto esta no GitHub. ===
pause