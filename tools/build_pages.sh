#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
rm -rf dist
mkdir -p dist
cp index.html style.css manifest.webmanifest sw.js \
   app.js desc.js concepts.js config.js geo.js heading.js rides.js route.js search.js stats.js suggest.js \
   dist/
cp pages/_headers dist/_headers
cp -R data vendor icons about b dist/
