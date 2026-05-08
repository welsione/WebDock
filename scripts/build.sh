#!/bin/bash
set -e

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "=== 清理旧产物 ==="
rm -rf dist release
mkdir -p release

echo "=== 开始打包 (macOS) ==="
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run build:mac

echo "=== 复制安装包到 release/ ==="
# 只复制 DMG 和 ZIP 安装包，blockmap 和 builder-debug.yml 留在 dist/
cp dist/*.dmg dist/*.zip release/ 2>/dev/null || true

echo "=== 打包完成 ==="
echo "Release 包:"
ls -lh release/
