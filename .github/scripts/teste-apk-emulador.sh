#!/usr/bin/env bash
# Teste de fumaça do APK do entregador num emulador Android (CI).
# Instala, abre, espera o painel carregar e confere: o app não caiu, a tela de
# login do PizzaBot apareceu e não houve erro fatal no log. Guarda a captura de
# tela (tela-emulador.png) para anexar à release.
set -u
PKG=cc.eu.secretariaai.pizzabot.entregador

adb install -r pizzabot-entregador.apk
adb logcat -c
adb shell am start -W -n "$PKG/.MainActivity"
# O painel é carregado da internet (server.url): dá tempo para a página abrir.
sleep 40

falhou=0
if ! adb shell pidof "$PKG" >/dev/null; then
  echo "::error::O app fechou sozinho depois de abrir."
  falhou=1
fi

adb exec-out screencap -p > tela-emulador.png || true
adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || true
adb pull /sdcard/ui.xml ui.xml >/dev/null 2>&1 || true
adb logcat -d > logcat.txt || true

if grep -E "FATAL EXCEPTION" logcat.txt >/dev/null; then
  echo "::error::Erro fatal no log do Android:"
  grep -A 20 "FATAL EXCEPTION" logcat.txt | head -60
  falhou=1
fi

# A tela de login do painel (texto da página exposto pela acessibilidade do WebView)
# ou, no mínimo, o Capacitor carregando o endereço do painel.
if grep -qiE "senha|entrar|e-mail" ui.xml 2>/dev/null; then
  echo "Tela de login encontrada no WebView."
elif grep -q "pizzabot.secretariaai.eu.cc" logcat.txt; then
  echo "O Capacitor carregou o painel (tela de login não exposta na árvore de acessibilidade)."
else
  echo "::error::O painel não carregou dentro do app."
  grep -iE "Capacitor|chromium" logcat.txt | tail -40
  falhou=1
fi

grep -iE "Capacitor/Console|Capacitor:" logcat.txt | tail -20 || true
exit $falhou
