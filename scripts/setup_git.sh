#!/usr/bin/env bash
# 소스를 받은 뒤 처음 한 번 실행: git 저장소를 만들고 커밋·푸시 자동 점검을 켭니다.
set -e; cd "$(dirname "$0")/.."
[ -d .git ] || git init -q -b main
git config core.hooksPath .githooks
chmod +x .githooks/* scripts/*.sh
echo "완료: 이제 커밋·푸시할 때마다 scripts/security_check.sh 가 자동으로 실행됩니다."
