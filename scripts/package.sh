#!/usr/bin/env bash
# 把当前工作区打包成可上传的源码包。
#
#   ./scripts/package.sh                 # 默认输出到 release/
#   ./scripts/package.sh --with-dist     # 顺便构建前端，把 web/dist 也打进包里
#   ./scripts/package.sh -o /tmp/out     # 指定输出目录
#   ./scripts/package.sh --verify        # 打包前跑一遍后端单元测试
#
# 包含未提交的改动；默认排除 .env、node_modules、.venv、.pgdata、web/dist 等。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$(basename "$ROOT")"
OUT_DIR="$ROOT/release"
WITH_DIST=0
VERIFY=0

usage() {
  sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -o|--out)
      OUT_DIR="${2:?--out 需要一个目录}"
      shift 2
      ;;
    --with-dist)
      WITH_DIST=1
      shift
      ;;
    --verify)
      VERIFY=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "未知参数：$1" >&2
      usage
      exit 1
      ;;
  esac
done

command -v tar >/dev/null 2>&1 || { echo "需要 tar" >&2; exit 1; }

if [[ "$VERIFY" == 1 ]]; then
  if [[ -x "$ROOT/.venv/bin/python" ]]; then
    echo "==> 跑单元测试"
    (cd "$ROOT" && ./.venv/bin/python -m unittest discover -s tests -t .)
  else
    echo "==> 跳过测试：没有 .venv/bin/python" >&2
  fi
fi

if [[ "$WITH_DIST" == 1 ]]; then
  command -v npm >/dev/null 2>&1 || { echo "--with-dist 需要 npm" >&2; exit 1; }
  [[ -d "$ROOT/web/node_modules" ]] || { echo "先执行 cd web && npm install" >&2; exit 1; }
  echo "==> 构建前端"
  (cd "$ROOT/web" && npm run build && npm run build:demo)
fi

mkdir -p "$OUT_DIR"

SHA="$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo nogit)"
DIRTY=""
if [[ -n "$(git -C "$ROOT" status --porcelain 2>/dev/null)" ]]; then
  DIRTY="-dirty"
fi
STAMP="$(date +%Y%m%d-%H%M)"
NAME="$APP-$STAMP-$SHA$DIRTY"
ARCHIVE="$OUT_DIR/$NAME.tar.gz"

LIST="$(mktemp "${TMPDIR:-/tmp}/tesla-dashboard-files.XXXXXX")"
trap 'rm -f "$LIST"' EXIT

# 用 find -prune 精确排除，tar 的 --exclude 在 BSD 上不跨目录匹配
prune_dist=()
if [[ "$WITH_DIST" != 1 ]]; then
  prune_dist=(-o -path "$APP/web/dist" -o -path "$APP/web/dist-demo")
fi

(
  cd "$(dirname "$ROOT")"
  find "$APP" \
    \( -name .git -o -name node_modules -o -name .venv -o -name .pgdata \
       -o -name .tools -o -name .chrome-profile -o -name .tmp \
       -o -name __pycache__ -o -name release -o -name .npm-cache \
       -o -name .sshtest -o -name .playwright-cli -o -name output \
       "${prune_dist[@]}" \) -prune \
    -o -type f ! -name .env ! -name .DS_Store ! -name '*.pyc' ! -name '*.tar.gz' -print
) > "$LIST"

# 本地文件常是 600，传到服务器后只有 root 能读——docker build 的普通用户就读不到了。
# 打包前统一成 644（.env 保持 600 不动），否则解包后还得手工 chmod。
(
  cd "$(dirname "$ROOT")"
  while IFS= read -r f; do
    case "$f" in
      */.env) continue ;;
      */scripts/*.sh) chmod 755 "$f" 2>/dev/null || true ;;
      *) chmod 644 "$f" 2>/dev/null || true ;;
    esac
  done < "$LIST"
)

COPYFILE_DISABLE=1 tar -czf "$ARCHIVE" -C "$(dirname "$ROOT")" -T "$LIST"

if command -v sha256sum >/dev/null 2>&1; then
  DIGEST="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
else
  DIGEST="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
fi
printf '%s  %s\n' "$DIGEST" "$(basename "$ARCHIVE")" > "$ARCHIVE.sha256"

FILES="$(tar -tzf "$ARCHIVE" | grep -cv '/$' || true)"
SIZE="$(du -h "$ARCHIVE" | awk '{print $1}')"

echo
echo "完成：$ARCHIVE"
echo "大小：${SIZE}（${FILES} 个文件）"
echo "SHA256：${DIGEST}"
echo "校验文件：${ARCHIVE}.sha256"
echo
echo "上传示例："
echo "  scp \"$ARCHIVE\" 用户@服务器:/opt/teslamate/"
echo "  ssh 用户@服务器 'cd /opt/teslamate && tar -xzf $(basename "$ARCHIVE")'"
