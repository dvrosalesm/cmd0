#!/bin/bash
cd "/Users/dm1/Documents/Personal/code/cmd0"
export PATH="/Users/dm1/.nvm/versions/node/v23.11.1/bin:/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:$PATH"
npx electron . "$@" &
disown
