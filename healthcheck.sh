#!/bin/sh

wget --quiet --tries=1 --no-check-certificate -O /dev/null --server-response --timeout=5 "https://127.0.0.1:8043/login" || exit 1