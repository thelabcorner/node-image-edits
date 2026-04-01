#!/bin/sh
set -eu

if [ -z "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]; then
  echo "CLOUDFLARE_TUNNEL_TOKEN is required" >&2
  exit 1
fi

pnpm start &
app_pid=$!

cloudflared tunnel --no-autoupdate run --token "$CLOUDFLARE_TUNNEL_TOKEN" &
tunnel_pid=$!

cleanup() {
  for pid in "$app_pid" "$tunnel_pid"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
}

trap cleanup INT TERM

status=0

while :; do
  if ! kill -0 "$app_pid" 2>/dev/null; then
    wait "$app_pid" || status=$?
    break
  fi

  if ! kill -0 "$tunnel_pid" 2>/dev/null; then
    wait "$tunnel_pid" || status=$?
    break
  fi

  sleep 1
done

cleanup

exit "$status"
