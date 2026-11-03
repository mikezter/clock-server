#!/usr/bin/env bash
# Build wrapper: same as `.env/bin/esphome <cmd> <yaml>`, plus a shared
# PlatformIO/SCons object cache so cold builds (after `esphome clean`, a
# platformio.ini change or a deleted build dir) reuse compiled objects.
#
#   ./build.sh                          # compile obegraensad-clock.yaml
#   ./build.sh compile other.yaml
#   ./build.sh run obegraensad-clock.yaml   # flashes the real device!
#
# Parallelism needs no flag: PlatformIO already runs `-j <cpu count>`
# (PLATFORMIO_RUN_JOBS / os.cpu_count()) unless `compile_process_limit` is set.
set -euo pipefail
cd "$(dirname "$0")"

cmd="${1:-compile}"
yaml="${2:-obegraensad-clock.yaml}"
shift $(( $# > 2 ? 2 : $# ))

# SCons CacheDir, keyed on the full compiler command + inputs, so it is safe
# to share between configs. It is never pruned; delete it if it gets large.
export PLATFORMIO_BUILD_CACHE_DIR="${PLATFORMIO_BUILD_CACHE_DIR:-$PWD/.esphome/pio-build-cache}"
# Skip the telemetry send that can hold up PlatformIO's exit by up to 1 s.
export PLATFORMIO_SETTING_ENABLE_TELEMETRY="${PLATFORMIO_SETTING_ENABLE_TELEMETRY:-no}"

exec .env/bin/esphome "$cmd" "$yaml" "$@"
