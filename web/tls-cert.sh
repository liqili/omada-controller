#!/bin/sh
# Run by the nginx image's entrypoint before nginx starts: gives the HTTPS
# server a certificate. Put your own in /etc/nginx/certs as tls.crt +
# tls.key; otherwise a self-signed one is created there on first start
# (keep /etc/nginx/certs on a volume so it survives container updates and
# the browser warning is accepted only once).
set -e
dir=/etc/nginx/certs
if [ -s "$dir/tls.crt" ] && [ -s "$dir/tls.key" ]; then
    exit 0
fi
if [ -e "$dir/tls.crt" ] || [ -e "$dir/tls.key" ]; then
    echo "Omada web UI: $dir needs both tls.crt and tls.key." >&2
    exit 1
fi
mkdir -p "$dir"
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=omada-web-ui" \
    -keyout "$dir/tls.key" -out "$dir/tls.crt" 2>/dev/null
chmod 600 "$dir/tls.key"
echo "Omada web UI: created a self-signed certificate in $dir"
