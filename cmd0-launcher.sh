#!/bin/bash
cd "/home/diegor/Documents/personal/code/cmd0"
export PATH="/usr/bin:$PATH"

CMD0_PID="$HOME/.cmd0/pid"

case "$*" in
  *--help*|-h)
    echo "Usage: cmd0 [options]"
    echo ""
    echo "Options:"
    echo "  --safe              Start in safe mode (restore base files)"
    echo "  --snap <name>       Save a snapshot"
    echo "  --restore <name>    Restore a snapshot"
    echo "  -h, --help          Show this help"
    exit 0
    ;;
  *--snap*|*--restore*)
    exec npx electron . "$@"
    ;;
  *)
    if [ -f "$CMD0_PID" ] && kill -0 "$(cat "$CMD0_PID")" 2>/dev/null; then
      kill -USR2 "$(cat "$CMD0_PID")"
    else
      npx electron . "$@" &
      disown
    fi
    ;;
esac
