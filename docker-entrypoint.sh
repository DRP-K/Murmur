#!/bin/sh
set -eu

export BIND_ADDR="${BIND_ADDR:-0.0.0.0:${PORT:-3000}}"

exec murmur-server
