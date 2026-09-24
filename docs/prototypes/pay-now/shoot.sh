#!/usr/bin/env bash
# PROTOTYPE (#112): throwaway. Screenshots of every sketch with headless
# Chrome, into this folder. Headless Chrome will not open a window narrower
# than about 500px, so a phone shot frames the page at 390px inside the
# app's own /prototype/pay-now/phone page. Run with the dev server up on
# port 3213:
#   bash docs/prototypes/pay-now/shoot.sh
set -euo pipefail
cd "$(dirname "$0")"
CHROME="${CHROME:-C:/Program Files/Google/Chrome/Application/chrome.exe}"
BASE="${BASE:-http://localhost:3213/prototype/pay-now}"
PROFILE="$(mktemp -d)"

shoot() { # name width height url
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars \
    --user-data-dir="$PROFILE" --window-size="$2,$3" --virtual-time-budget=8000 \
    --screenshot="$PWD/$1.png" "$4" >/dev/null 2>&1
  echo "$1.png"
}

phone() { # name path-under-/prototype/pay-now
  local u; u="$(printf '%s' "/prototype/pay-now/$2" | python -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.stdin.read(),safe=""))')"
  shoot "$1" 520 844 "$BASE/phone?u=$u"
}

for v in A B C; do
  phone "link-$v-unpaid-phone" "link?variant=$v&reading=unpaid"
  phone "link-$v-onway-phone"  "link?variant=$v&reading=onway"
done
phone "link-D-unpaid-phone"  "link?variant=D&reading=unpaid"
phone "link-D-sheet-phone"   "link?variant=D&reading=small&show=sheet"
phone "link-D-sheet-big-phone" "link?variant=D&reading=unpaid&show=sheet"
phone "link-D-zelle-phone"   "link?variant=D&reading=unpaid&show=zelle"
phone "link-C-sheet-phone"   "link?variant=C&reading=unpaid&show=sheet"
phone "link-B-small-phone"   "link?variant=B&reading=small"
phone "checkout-card-phone"  "link?variant=A&reading=small&show=card"
phone "approved-B-phone"     "approved?variant=B"
phone "approved-C-phone"     "approved?variant=C"
phone "panel-A-inv-1001-phone" "panel-only?variant=A&invoice=inv-1001"

for v in A B C; do
  shoot "link-$v-unpaid-laptop" 1280 900 "$BASE/link?variant=$v&reading=unpaid"
  shoot "link-$v-onway-laptop"  1280 900 "$BASE/link?variant=$v&reading=onway"
done
shoot "link-D-unpaid-laptop"   1280 900 "$BASE/link?variant=D&reading=unpaid"
shoot "link-D-sheet-laptop"    1280 900 "$BASE/link?variant=D&reading=small&show=sheet"
shoot "link-D-zelle-laptop"    1280 900 "$BASE/link?variant=D&reading=unpaid&show=zelle"
shoot "link-A-small-laptop"    1280 900 "$BASE/link?variant=A&reading=small"
shoot "link-B-small-laptop"    1280 900 "$BASE/link?variant=B&reading=small"
shoot "link-C-sheet-small-laptop" 1280 900 "$BASE/link?variant=C&reading=small&show=sheet"
shoot "link-C-sheet-laptop"    1280 900 "$BASE/link?variant=C&reading=unpaid&show=sheet"
shoot "link-paid-laptop"       1280 900 "$BASE/link?variant=A&reading=paid"
shoot "checkout-bank-laptop"   1280 900 "$BASE/link?variant=A&reading=unpaid&show=bank"
for v in A B C; do
  shoot "approved-$v-laptop" 1280 900 "$BASE/approved?variant=$v"
done
for v in A B; do
  for i in inv-1001 inv-1002 inv-1003 inv-1004 inv-1005; do
    shoot "panel-$v-$i-laptop" 1280 900 "$BASE/panel-only?variant=$v&invoice=$i"
  done
done
shoot "panel-list-laptop" 1280 900 "$BASE/panel-only"
rm -rf "$PROFILE"