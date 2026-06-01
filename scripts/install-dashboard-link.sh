#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="$repo_root/dashboard"
target_dir="${HERMES_HOME:-$HOME/.hermes}/plugins/olympus/dashboard"

if [[ ! -d "$source_dir" ]]; then
  echo "missing dashboard source: $source_dir" >&2
  exit 1
fi

mkdir -p "$(dirname "$target_dir")"

if [[ -L "$target_dir" ]]; then
  current="$(readlink "$target_dir")"
  if [[ "$current" == "$source_dir" ]]; then
    echo "already linked: $target_dir -> $source_dir"
    exit 0
  fi
fi

if [[ -e "$target_dir" || -L "$target_dir" ]]; then
  backup="${target_dir}.backup.$(date +%Y%m%d-%H%M%S)"
  mv "$target_dir" "$backup"
  echo "backed up existing dashboard to $backup"
fi

ln -s "$source_dir" "$target_dir"
echo "linked: $target_dir -> $source_dir"
