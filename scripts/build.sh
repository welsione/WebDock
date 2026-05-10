#!/bin/bash
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "=== 清理旧产物 ==="
rm -rf release

echo "=== 开始打包 (macOS) ==="
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run build:mac

echo "=== 打包完成 ==="
ls -lh release/*.dmg
