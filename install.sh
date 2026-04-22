#!/usr/bin/env bash
# Bakin installer — fetches the current release binary for this
# machine's platform + architecture, verifies its sha256 against the
# release's checksums.txt, and installs it to /usr/local/bin or
# ~/.local/bin as a fallback.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/madeinwyo/bakin/main/install.sh | bash
#
# Environment:
#   BAKIN_INSTALL_DIR   Override the install directory.
#   BAKIN_VERSION       Specific tag to install (e.g. v1.2.0). Defaults to latest.
#
set -euo pipefail

REPO="madeinwyo/bakin"
API_BASE="https://api.github.com/repos/${REPO}"

die() {
  echo "install.sh: $*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

need_cmd curl
need_cmd uname
need_cmd shasum

detect_triple() {
  local os arch
  os=$(uname -s)
  arch=$(uname -m)
  case "${os}_${arch}" in
    Darwin_arm64) echo "darwin-arm64" ;;
    Darwin_aarch64) echo "darwin-arm64" ;;
    Linux_x86_64) echo "linux-x64" ;;
    Linux_amd64) echo "linux-x64" ;;
    Linux_aarch64) echo "linux-arm64" ;;
    Linux_arm64) echo "linux-arm64" ;;
    *) die "unsupported platform: ${os}/${arch}" ;;
  esac
}

pick_install_dir() {
  if [ -n "${BAKIN_INSTALL_DIR:-}" ]; then
    echo "${BAKIN_INSTALL_DIR}"
    return
  fi
  if [ -w "/usr/local/bin" ] 2>/dev/null; then
    echo "/usr/local/bin"
    return
  fi
  # Unwritable /usr/local/bin; fall back to ~/.local/bin.
  local fallback="${HOME}/.local/bin"
  mkdir -p "${fallback}"
  echo "${fallback}"
}

sha256() {
  # Portable (BSD + GNU) sha256 extraction.
  shasum -a 256 "$1" | awk '{ print $1 }'
}

main() {
  local triple
  triple=$(detect_triple)
  local bin_name="bakin-${triple}"
  local tag="${BAKIN_VERSION:-}"
  local release_url
  if [ -n "${tag}" ]; then
    release_url="${API_BASE}/releases/tags/${tag}"
  else
    release_url="${API_BASE}/releases/latest"
  fi

  echo "Fetching release info..."
  local release_json
  release_json=$(curl -fsSL -H 'Accept: application/vnd.github+json' "${release_url}")

  local bin_url
  bin_url=$(echo "${release_json}" | grep -o "\"browser_download_url\":\s*\"[^\"]*${bin_name}\"" | head -1 | sed 's/.*"\(https[^"]*\)"/\1/')
  local sum_url
  sum_url=$(echo "${release_json}" | grep -o '"browser_download_url":\s*"[^"]*checksums\.txt"' | head -1 | sed 's/.*"\(https[^"]*\)"/\1/')

  [ -n "${bin_url}" ] || die "release is missing asset ${bin_name}"
  [ -n "${sum_url}" ] || die "release is missing checksums.txt"

  local tmp
  tmp=$(mktemp -d)
  trap 'rm -rf "${tmp}"' EXIT

  echo "Downloading ${bin_name}..."
  curl -fsSL -o "${tmp}/${bin_name}" "${bin_url}"
  curl -fsSL -o "${tmp}/checksums.txt" "${sum_url}"

  local expected actual
  expected=$(grep -E "[[:space:]]${bin_name}$" "${tmp}/checksums.txt" | awk '{ print $1 }')
  [ -n "${expected}" ] || die "checksums.txt has no entry for ${bin_name}"
  actual=$(sha256 "${tmp}/${bin_name}")

  if [ "${expected}" != "${actual}" ]; then
    die "checksum mismatch: expected ${expected}, got ${actual}"
  fi
  echo "Checksum OK"

  local install_dir
  install_dir=$(pick_install_dir)
  chmod +x "${tmp}/${bin_name}"
  mv "${tmp}/${bin_name}" "${install_dir}/bakin"

  echo ""
  echo "Installed bakin to ${install_dir}/bakin"
  if ! echo ":${PATH}:" | grep -q ":${install_dir}:"; then
    echo "Note: ${install_dir} is not on your PATH. Add it with:"
    echo "  export PATH=\"${install_dir}:\${PATH}\""
  fi
  echo ""
  echo "Run \`bakin --help\` to get started."
}

main "$@"
