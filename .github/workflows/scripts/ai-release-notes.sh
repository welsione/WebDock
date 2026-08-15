#!/usr/bin/env bash
# AI 生成 GitHub Release 文档
#   - 优先调用 OpenAI 兼容的 chat/completions 接口（默认 DeepSeek，可用
#     AI_BASE_URL / AI_MODEL 覆盖，key 从 RELEASE_AI_KEY secret 注入）
#   - 未配置 AI key 时回退：GitHub generate-notes API → git log 纯文本
# 用法: ai-release-notes.sh <version> [输出文件，默认 notes.md]
set -euo pipefail

VERSION="${1:?用法: ai-release-notes.sh <version> [out]}"
OUT="${2:-notes.md}"
TAG="v${VERSION}"
DATE="$(date +%F)"

# ---------- 收集提交与变更 ----------
PREV_TAG="$(git tag --list --sort=-version:refname | grep -v "^${TAG}$" | head -n 1 || true)"
if [ -n "${PREV_TAG}" ]; then
  RANGE="${PREV_TAG}..HEAD"
  LOG="$(git log "${RANGE}" --pretty=format:'- %s')"
  STAT="$(git diff --stat "${PREV_TAG}..HEAD" | tail -n 30)"
else
  RANGE=""
  LOG="$(git log -60 --pretty=format:'- %s')"
  STAT=""
fi

# ---------- 回退 1：GitHub generate-notes ----------
fallback_github() {
  if [ -n "$(git tag -l "${TAG}")" ]; then
    gh api --method POST "repos/${GITHUB_REPOSITORY}/releases/generate-notes" \
      -f tag_name="${TAG}" -f target_commitish="${GITHUB_SHA:-HEAD}" -q .body > "${OUT}"
    return 0
  fi
  return 1
}

# ---------- 回退 2：纯 git log ----------
fallback_log() {
  {
    echo "# WebDock ${VERSION}（${DATE}）"
    echo
    echo "## 变更"
    echo "${LOG}"
    echo
    echo "> 由 CI 自动生成（未配置 AI key 的降级模式）"
  } > "${OUT}"
}

# ---------- AI 生成 ----------
if [ -n "${AI_API_KEY:-}" ]; then
  BASE_URL="${AI_BASE_URL:-https://api.deepseek.com}"
  MODEL="${AI_MODEL:-deepseek-chat}"

  # 组装 payload（python3 负责 JSON 转义）
  python3 - "${VERSION}" "${PREV_TAG:-无}" "${LOG}" "${STAT}" "${DATE}" <<'PYEOF' > /tmp/release-payload.json
import json, sys

version, prev, log, stat = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
system = (
    "你是 WebDock 的 Release 文档撰写助手。WebDock 是一款 macOS 桌面应用："
    "把任意网页和本地服务变成原生桌面应用（聚合 AI 站点、系统通知统一、"
    "本地服务自拉起、桌面原生化）。请根据提供的版本号、提交记录和变更统计，"
    "用简体中文撰写规范的 GitHub Release 文档。要求："
    "1) 开头一行加粗总览，总结本次发布主题；"
    "2) 按「✨ 新功能 / 🚀 改进与优化 / 🐛 修复 / 📦 其他」分节，"
    "根据 commit 前缀（feat/refactor/perf/improve/fix/chore/docs/test/security 等）归类；"
    "3) 每条提交归纳成一句用户可读的描述，不要逐条罗列 commit message，避免空话；"
    "4) 结尾附「如何获取」小节：从 GitHub Release 下载 DMG，"
    "若提示「无法打开」需执行 xattr -cr /Applications/WebDock.app；"
    "5) 输出纯 Markdown，不要任何多余解释。"
)
user = (
    f"版本：v{version}（发布日期：{sys.argv[5] if len(sys.argv) > 5 else ''}）\n"
    f"上一个版本：{prev}\n"
    "提交记录：\n" + (log or "（无）") + "\n\n"
    "变更统计：\n" + (stat or "（无）")
)
print(json.dumps({
    "model": __import__("os").environ.get("AI_MODEL", "deepseek-chat"),
    "messages": [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ],
    "temperature": 0.7,
}))
PYEOF

  RESP="$(curl -sS --max-time 120 -X POST "${BASE_URL}/chat/completions" \
    -H "Authorization: Bearer ${AI_API_KEY}" \
    -H "Content-Type: application/json" \
    --data-binary @/tmp/release-payload.json || true)"

  if [ -n "${RESP}" ]; then
    python3 - "${RESP}" "${OUT}" "${DATE}" <<'PYEOF'
import json, sys

resp, out, date = sys.argv[1], sys.argv[2], sys.argv[3]
try:
    body = json.loads(resp)
    content = body["choices"][0]["message"]["content"].strip()
except (KeyError, IndexError, json.JSONDecodeError):
    raise SystemExit(f"AI 响应解析失败: {resp[:200]}")
with open(out, "w", encoding="utf-8") as f:
    f.write(f"> 本文档由 AI 生成（{date}）\n\n")
    f.write(content + "\n")
print(f"✅ AI 生成 Release 文档 → {out}")
PYEOF
    exit 0
  fi
  echo "⚠️ AI 调用失败，尝试降级方案" >&2
fi

if fallback_github; then
  echo "✅ 使用 GitHub generate-notes → ${OUT}"
  exit 0
fi
fallback_log
echo "✅ 使用 git log 降级生成 → ${OUT}"
