#!/usr/bin/env bash
# Dev helper: prepare the headless-Chromium test environment (needs network for the first run).
#   source tools/_debug/fp_env.sh
# Puts libXdamage (missing from this image) into a scratch dir and exports LD_LIBRARY_PATH,
# and puts playwright's browsers on PATH. Everything lands under /tmp/fpdev, which may be wiped
# between sandbox restarts -- just re-source this file.
set -e
export FPDEV=/tmp/fpdev
mkdir -p "$FPDEV/libs"
if [ ! -f "$FPDEV/libs/x/usr/lib/x86_64-linux-gnu/libXdamage.so.1" ]; then
  ( cd "$FPDEV/libs" && apt-get download libxdamage1 >/dev/null 2>&1 && dpkg-deb -x libxdamage1*.deb x )
fi
export LD_LIBRARY_PATH="$FPDEV/libs/x/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export PATH="$PATH:/sessions/epic-blissful-johnson/.local/bin:$HOME/.local/bin"
python3 -c "import playwright" 2>/dev/null || pip install --quiet playwright
ls /sessions/epic-blissful-johnson/.cache/ms-playwright >/dev/null 2>&1 || python3 -m playwright install chromium
echo "fp_env ready"
