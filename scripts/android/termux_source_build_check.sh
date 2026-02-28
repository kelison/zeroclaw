#!/usr/bin/env bash
set -euo pipefail

TARGET="aarch64-linux-android"
RUN_CARGO_CHECK=0
MODE="auto"
DIAGNOSE_LOG=""

usage() {
  cat <<'EOF'
Usage:
  scripts/android/termux_source_build_check.sh [--target <triple>] [--mode <auto|termux-native|ndk-cross>] [--run-cargo-check] [--diagnose-log <path>]

Options:
  --target <triple>    Android Rust target (default: aarch64-linux-android)
                       Supported: aarch64-linux-android, armv7-linux-androideabi
  --mode <mode>        Validation mode:
                       auto (default): infer from environment
                       termux-native: expect plain clang + no cross overrides
                       ndk-cross: expect NDK wrapper linker + matching CC_*
  --run-cargo-check    Run cargo check --locked --target <triple> --no-default-features
  --diagnose-log <p>   Diagnose an existing cargo error log and print targeted recovery commands.
  -h, --help           Show this help

Purpose:
  Validate Android source-build environment for ZeroClaw, with focus on:
  - Termux native builds using plain clang
  - NDK cross-build overrides (CARGO_TARGET_*_LINKER and CC_*)
  - Common cc-rs linker mismatch failures
EOF
}

log() {
  printf '[android-selfcheck] %s\n' "$*"
}

warn() {
  printf '[android-selfcheck] warning: %s\n' "$*" >&2
}

die() {
  printf '[android-selfcheck] error: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      [[ $# -ge 2 ]] || die "--target requires a value"
      TARGET="$2"
      shift 2
      ;;
    --run-cargo-check)
      RUN_CARGO_CHECK=1
      shift
      ;;
    --mode)
      [[ $# -ge 2 ]] || die "--mode requires a value"
      MODE="$2"
      shift 2
      ;;
    --diagnose-log)
      [[ $# -ge 2 ]] || die "--diagnose-log requires a path"
      DIAGNOSE_LOG="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1 (use --help)"
      ;;
  esac
done

case "$TARGET" in
  aarch64-linux-android|armv7-linux-androideabi) ;;
  *)
    die "unsupported target '$TARGET' (expected aarch64-linux-android or armv7-linux-androideabi)"
    ;;
esac

case "$MODE" in
  auto|termux-native|ndk-cross) ;;
  *)
    die "unsupported mode '$MODE' (expected auto, termux-native, or ndk-cross)"
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" >/dev/null 2>&1 && pwd || pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." >/dev/null 2>&1 && pwd || pwd)"
CONFIG_FILE="$REPO_ROOT/.cargo/config.toml"
cd "$REPO_ROOT"

TARGET_UPPER="$(printf '%s' "$TARGET" | tr '[:lower:]-' '[:upper:]_')"
TARGET_UNDERSCORE="${TARGET//-/_}"
CARGO_LINKER_VAR="CARGO_TARGET_${TARGET_UPPER}_LINKER"
CC_LINKER_VAR="CC_${TARGET_UNDERSCORE}"

is_termux=0
if [[ -n "${TERMUX_VERSION:-}" ]] || [[ "${PREFIX:-}" == *"/com.termux/files/usr"* ]]; then
  is_termux=1
fi

effective_mode="$MODE"
if [[ "$effective_mode" == "auto" ]]; then
  if [[ "$is_termux" -eq 1 ]]; then
    effective_mode="termux-native"
  else
    effective_mode="ndk-cross"
  fi
fi

extract_linker_from_config() {
  [[ -f "$CONFIG_FILE" ]] || return 0
  awk -v target="$TARGET" '
    $0 ~ "^\\[target\\." target "\\]$" { in_section=1; next }
    in_section && $0 ~ "^\\[" { in_section=0 }
    in_section && $1 == "linker" {
      gsub(/"/, "", $3);
      print $3;
      exit
    }
  ' "$CONFIG_FILE"
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

is_executable_tool() {
  local tool="$1"
  if [[ "$tool" == */* ]]; then
    [[ -x "$tool" ]]
  else
    command_exists "$tool"
  fi
}

ndk_wrapper_for_target() {
  case "$TARGET" in
    aarch64-linux-android) printf '%s\n' "aarch64-linux-android21-clang" ;;
    armv7-linux-androideabi) printf '%s\n' "armv7a-linux-androideabi21-clang" ;;
    *) printf '%s\n' "" ;;
  esac
}

diagnose_cargo_failure() {
  local log_file="$1"
  local ndk_wrapper
  ndk_wrapper="$(ndk_wrapper_for_target)"

  log "cargo check failed; analyzing common Android toolchain issues..."

  if grep -Eq 'failed to find tool "aarch64-linux-android-clang"|failed to find tool "armv7a-linux-androideabi-clang"|ToolNotFound' "$log_file"; then
    warn "detected cc-rs compiler lookup failure for Android target"
    if [[ "$effective_mode" == "termux-native" ]]; then
      log "suggested recovery (termux-native):"
      log "  unset $CARGO_LINKER_VAR"
      log "  unset $CC_LINKER_VAR"
      log "  pkg install -y clang pkg-config"
      log "  command -v clang"
    else
      log "suggested recovery (ndk-cross):"
      log "  export NDK_TOOLCHAIN=\"\$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin\""
      log "  export $CARGO_LINKER_VAR=\"\$NDK_TOOLCHAIN/$ndk_wrapper\""
      log "  export $CC_LINKER_VAR=\"\$NDK_TOOLCHAIN/$ndk_wrapper\""
      log "  command -v \"\$NDK_TOOLCHAIN/$ndk_wrapper\""
    fi
  fi

  if grep -Eq 'linker `clang` not found|linker .* not found|cannot find linker|failed to find tool "clang"' "$log_file"; then
    warn "detected linker resolution failure"
    if [[ "$effective_mode" == "termux-native" ]]; then
      log "suggested recovery (termux-native):"
      log "  pkg install -y clang pkg-config"
      log "  command -v clang"
    else
      log "suggested recovery (ndk-cross):"
      log "  export $CARGO_LINKER_VAR=\"\$NDK_TOOLCHAIN/$ndk_wrapper\""
      log "  export $CC_LINKER_VAR=\"\$NDK_TOOLCHAIN/$ndk_wrapper\""
    fi
  fi

  if grep -Eq "target '$TARGET' not found|can't find crate for std|did you mean to run rustup target add" "$log_file"; then
    warn "detected missing Rust target stdlib"
    log "suggested recovery:"
    log "  rustup target add $TARGET"
  fi

  if grep -Eq 'No such file or directory \(os error 2\)' "$log_file"; then
    warn "detected missing binary/file in build chain; verify linker and CC_* variables point to real executables"
  fi
}

log "repo: $REPO_ROOT"
log "target: $TARGET"
if [[ "$is_termux" -eq 1 ]]; then
  log "environment: Termux detected"
else
  log "environment: non-Termux (likely desktop/CI)"
fi
log "mode: $effective_mode"

if [[ -z "$DIAGNOSE_LOG" ]]; then
  command_exists rustup || die "rustup is not installed"
  command_exists cargo || die "cargo is not installed"

  if ! rustup target list --installed | grep -Fx "$TARGET" >/dev/null 2>&1; then
    die "Rust target '$TARGET' is not installed. Run: rustup target add $TARGET"
  fi
fi

config_linker="$(extract_linker_from_config || true)"
cargo_linker_override="${!CARGO_LINKER_VAR:-}"
cc_linker_override="${!CC_LINKER_VAR:-}"

if [[ -n "$config_linker" ]]; then
  log "config linker ($TARGET): $config_linker"
else
  warn "no linker configured for $TARGET in .cargo/config.toml"
fi

if [[ -n "$cargo_linker_override" ]]; then
  log "env override $CARGO_LINKER_VAR=$cargo_linker_override"
fi
if [[ -n "$cc_linker_override" ]]; then
  log "env override $CC_LINKER_VAR=$cc_linker_override"
fi

effective_linker="${cargo_linker_override:-${config_linker:-clang}}"
log "effective linker: $effective_linker"

if [[ "$effective_mode" == "termux-native" ]]; then
  if ! command_exists clang; then
    if [[ "$is_termux" -eq 1 ]]; then
      die "clang is required in Termux. Run: pkg install -y clang pkg-config"
    fi
    warn "clang is not available on this non-Termux host; termux-native checks are partial"
  fi

  if [[ "${config_linker:-}" != "clang" ]]; then
    warn "Termux native build should use linker = \"clang\" for $TARGET"
  fi

  if [[ -n "$cargo_linker_override" && "$cargo_linker_override" != "clang" ]]; then
    warn "Termux native build usually should unset $CARGO_LINKER_VAR (currently '$cargo_linker_override')"
  fi
  if [[ -n "$cc_linker_override" && "$cc_linker_override" != "clang" ]]; then
    warn "Termux native build usually should unset $CC_LINKER_VAR (currently '$cc_linker_override')"
  fi

  log "suggested fixups (termux-native):"
  log "  unset $CARGO_LINKER_VAR"
  log "  unset $CC_LINKER_VAR"
  log "  command -v clang"
else
  if [[ -n "$cargo_linker_override" && -z "$cc_linker_override" ]]; then
    warn "cross-build may still fail in cc-rs crates; consider setting $CC_LINKER_VAR=$cargo_linker_override"
  fi

  if [[ -n "$cargo_linker_override" ]]; then
    log "suggested fixup (ndk-cross):"
    log "  export $CC_LINKER_VAR=\"$cargo_linker_override\""
  else
    warn "NDK cross mode expects $CARGO_LINKER_VAR to point to an NDK clang wrapper"
    log "suggested fixup template (ndk-cross):"
    log "  export NDK_TOOLCHAIN=\"\$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin\""
    if [[ "$TARGET" == "aarch64-linux-android" ]]; then
      log "  export $CARGO_LINKER_VAR=\"\$NDK_TOOLCHAIN/aarch64-linux-android21-clang\""
      log "  export $CC_LINKER_VAR=\"\$NDK_TOOLCHAIN/aarch64-linux-android21-clang\""
    else
      log "  export $CARGO_LINKER_VAR=\"\$NDK_TOOLCHAIN/armv7a-linux-androideabi21-clang\""
      log "  export $CC_LINKER_VAR=\"\$NDK_TOOLCHAIN/armv7a-linux-androideabi21-clang\""
    fi
  fi
fi

if ! is_executable_tool "$effective_linker"; then
  if [[ "$effective_mode" == "termux-native" ]]; then
    if [[ "$is_termux" -eq 1 ]]; then
      die "effective linker '$effective_linker' is not executable in PATH"
    fi
    warn "effective linker '$effective_linker' not executable on this non-Termux host"
  else
    warn "effective linker '$effective_linker' not found (expected for some desktop hosts without NDK toolchain)"
  fi
fi

if [[ -n "$DIAGNOSE_LOG" ]]; then
  [[ -f "$DIAGNOSE_LOG" ]] || die "diagnose log file does not exist: $DIAGNOSE_LOG"
  log "diagnosing provided cargo log: $DIAGNOSE_LOG"
  diagnose_cargo_failure "$DIAGNOSE_LOG"
  log "diagnosis completed"
  exit 0
fi

if [[ "$RUN_CARGO_CHECK" -eq 1 ]]; then
  tmp_log="$(mktemp -t zeroclaw-android-check-XXXXXX.log)"
  cleanup_tmp_log() {
    rm -f "$tmp_log"
  }
  trap cleanup_tmp_log EXIT

  log "running cargo check --locked --target $TARGET --no-default-features"
  set +e
  CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-/tmp/zeroclaw-android-selfcheck-target}" \
    cargo check --locked --target "$TARGET" --no-default-features 2>&1 | tee "$tmp_log"
  cargo_status="${PIPESTATUS[0]}"
  set -e

  if [[ "$cargo_status" -ne 0 ]]; then
    diagnose_cargo_failure "$tmp_log"
    die "cargo check failed (exit $cargo_status)"
  fi

  log "cargo check completed successfully"
else
  log "skip cargo check (use --run-cargo-check to enable)"
fi

log "self-check completed"
