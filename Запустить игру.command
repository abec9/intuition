#!/bin/zsh -l
cd -- "${0:A:h}"
if curl --max-time 2 -fsS http://127.0.0.1:4173/api/status >/dev/null 2>&1; then
  print 'Игра уже запущена: http://127.0.0.1:4173/'
  exit 0
fi
print 'Откройте http://127.0.0.1:4173/ в браузере. Чтобы остановить игру, нажмите Ctrl+C.'
exec node server.mjs
