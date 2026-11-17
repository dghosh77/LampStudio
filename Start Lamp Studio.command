#!/bin/zsh
cd -- "${0:A:h}"
if command -v python3 >/dev/null 2>&1; then
  python3 server.py
elif [[ -x /Users/dishaghosh/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 ]]; then
  /Users/dishaghosh/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 server.py
else
  echo 'Python 3.9 or newer is needed to run the local server.'
  read '?Press Return to close.'
fi
