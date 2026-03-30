#!/bin/bash
cd "/home/diegor/Documents/personal/code/cmd0"
export PATH="/usr/bin:$PATH"
npx electron . "$@" &
disown
