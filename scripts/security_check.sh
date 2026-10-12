#!/usr/bin/env bash
# 커밋·배포 전 보안 점검 (참고: anhoya-lab.tistory.com/36 "배포 전 체크")
#  1) 비밀 파일(.env, 서명 키)이 커밋 대상에 없는지   — "git status 확인"의 자동화
#  2) 코드에 하드코딩된 키·비밀번호가 없는지          — "grep -r sk-"를 확장
#  3) .gitignore가 비밀 파일을 막고 있는지
#  4) 알려진 취약 라이브러리 (참고용 경고)
# 사용: scripts/security_check.sh           저장소 전체 점검
#       scripts/security_check.sh --staged  커밋하려는 파일만 점검 (pre-commit 훅)
set -uo pipefail
cd "$(dirname "$0")/.."
MODE="${1:-all}"; FAIL=0
red(){ printf '\033[31m✗ %s\033[0m\n' "$*"; FAIL=1; }; ok(){ printf '\033[32m✓\033[0m %s\n' "$*"; }; warn(){ printf '\033[33m! %s\033[0m\n' "$*"; }
G(){ git -c core.quotepath=off "$@"; }

SECRET_FILES='(^|/)(\.env(\..+)?|[^/]*\.(jks|keystore|p12|pfx|pem|key)|keystore\.properties|id_(rsa|ed25519|ecdsa)[^/]*)$'
ALLOW_FILES='(^|/)\.env\.example$'

if G rev-parse --git-dir >/dev/null 2>&1; then
  if [ "$MODE" = "--staged" ]; then LIST=$(G diff --cached --name-only --diff-filter=ACMR)
  else LIST=$( { G ls-files; G diff --cached --name-only --diff-filter=ACMR; } | sort -u); fi
else
  warn "git 저장소가 아니어서 폴더 전체를 점검합니다 (scripts/setup_git.sh 로 설정하세요)"
  LIST=$(find . -type f -not -path './node_modules/*' -not -path './dist/*' -not -path './build/*' -not -path './desktop/www/*' \
    -not -path './desktop/build/*' -not -path './test/out/*' -not -path './.git/*' -not -path './android/release.jks' \
    -not -path './android/keystore.properties' -not -name '.env' | sed 's|^\./||')
fi

# 1) 비밀 파일
BAD=$(printf '%s\n' "$LIST" | grep -E "$SECRET_FILES" | grep -vE "$ALLOW_FILES" || true)
if [ -n "$BAD" ]; then
  red "비밀 파일이 커밋 대상에 있습니다:"; printf '%s\n' "$BAD" | sed 's/^/    /'
  echo "    → git rm --cached \"<파일>\" 로 빼세요. 이미 GitHub에 올라갔다면 키를 즉시 폐기하고 새로 만드세요."
else ok "커밋 대상에 .env·서명 키 같은 비밀 파일이 없습니다"; fi

# 2) 하드코딩된 키·비밀번호
PAT='sk-ant-[A-Za-z0-9_-]{16,}|sk-(proj-)?[A-Za-z0-9_-]{32,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}|AIza[0-9A-Za-z_-]{35}|xox[abpr]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(api[_-]?key|secret|token|passw(or)?d)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][A-Za-z0-9_+/=.-]{16,}["'"'"']|KS_PASS=[A-Za-z0-9_-]{8,}'
HITS=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in *.js|*.mjs|*.ts|*.go|*.java|*.py|*.sh|*.html|*.json|*.properties|*.xml|*.md|*.yml|*.yaml|*.txt|*.cfg|*.ini|*.toml|.env*) ;; *) continue;; esac
  case "$f" in package-lock.json|scripts/security_check.sh|*.min.js) continue;; esac
  if [ "$MODE" = "--staged" ]; then C=$(G show ":$f" 2>/dev/null) || continue; else [ -f "$f" ] || continue; C=$(cat "$f"); fi
  M=$(printf '%s\n' "$C" | grep -nE "$PAT" | head -3 | cut -c1-140)
  if [ -n "$M" ]; then
    [ $HITS -eq 0 ] && red "코드에 키·비밀번호로 보이는 값이 있습니다:"
    HITS=1; echo "    $f"; printf '%s\n' "$M" | sed 's/^/        /'
  fi
done <<< "$LIST"
if [ $HITS -eq 1 ]; then echo "    → 값을 지우고 .env(커밋 안 됨)나 GitHub의 Secrets 설정으로 옮기세요."
else ok "코드에 하드코딩된 API 키·비밀번호가 없습니다"; fi

# 3) .gitignore
MISS=""
for p in '.env' 'android/release.jks' 'android/keystore.properties' '*.jks' 'node_modules/'; do grep -qxF "$p" .gitignore 2>/dev/null || MISS="$MISS $p"; done
if [ -n "$MISS" ]; then red ".gitignore에 빠진 항목:$MISS"; else ok ".gitignore가 .env·서명 키·node_modules를 막고 있습니다"; fi

# 4) 라이브러리 (전체 점검일 때만, 참고용 — 실패로 치지 않음)
if [ "$MODE" != "--staged" ] && command -v npm >/dev/null 2>&1 && [ -f package-lock.json ]; then
  S=$(npm audit --omit=dev 2>/dev/null | grep -E '^[0-9]+ vulnerabilit' || true)
  if [ -n "$S" ]; then warn "npm audit: $S (README '보안' 절의 대응 현황 참고)"; else ok "npm audit: 알려진 취약점 없음"; fi
fi

echo
if [ $FAIL -ne 0 ]; then echo "보안 점검 실패 — 위 항목을 고친 뒤 다시 시도하세요."; exit 1; fi
echo "보안 점검 통과"
