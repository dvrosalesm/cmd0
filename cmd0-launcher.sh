#!/bin/bash
cd "/home/diegor/Documents/personal/code/cmd0"
export PATH="/usr/bin:$PATH"

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
    npx electron . "$@" &
    disown
    ;;
esac
