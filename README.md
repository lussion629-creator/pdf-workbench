# PDF 작업대

PDF 도구 33가지를 서버 없이 기기 안에서 처리하는 앱입니다. 파일이 기기 밖으로 나가지 않습니다.
33 PDF tools that run entirely on your device, with no server.

## 웹에서 바로 쓰기

**https://lussion629-creator.github.io/pdf-workbench/**

설치 없이 브라우저에서 엽니다. 웹 버전도 파일을 서버로 보내지 않고 브라우저 안에서 처리합니다.
AI 요약·번역은 Claude 안에서 열었을 때만 쓸 수 있습니다.

## 받기

[Releases](../../releases/latest)에서 기기에 맞는 파일을 받으세요.

- Windows: `PDF작업대.exe`
- Mac: `PDF작업대-Mac.zip` (압축을 풀어 앱을 응용 프로그램 폴더로 옮깁니다)
- Android: `PDF작업대-<버전>.apk` (Android 7.0 이상)

결과 파일은 `다운로드/PDF작업대` 폴더에 저장됩니다.

## 보안

- 서버, 데이터베이스, API 키가 없습니다. 모든 PDF 처리는 기기 안에서 이루어집니다.
- Android 앱은 인터넷 권한이 없습니다.
- 외부 라이브러리는 버전을 고정하고 SRI 해시로 변조 여부를 확인합니다. 앱·PC·웹(Pages) 버전은 CSP로 앱 자신의 파일만 실행합니다.
- pdf.js는 `isEvalSupported:false`로 열어 CVE-2024-4367을 막습니다. SheetJS(수정 버전이 npm에 없음)는 격리된 워커에서 60초 제한으로만 파일을 읽습니다.
- Word·Excel·HTML 입력은 화면에 넣기 전에 스크립트와 이벤트 속성을 제거합니다.
- AI 요약·번역은 주민등록번호·카드번호·전화번호·이메일을 기호로 바꿔 보낸 뒤 기기 안에서 되돌립니다.
- 서명 이미지는 사용자가 고를 때만 기기에 저장되며, 언제든 지울 수 있습니다.
- PC 앱의 로컬 서버는 127.0.0.1에서 자기 주소로 온 요청만 받습니다.

### 비밀값이 올라가지 않게 하는 장치

- `.gitignore`가 `.env`, 서명 키(`*.jks`, `keystore.properties`), 인증서 파일을 막습니다.
- 커밋·푸시할 때마다 `scripts/security_check.sh`가 자동으로 돕니다. 비밀 파일이나 코드에 박힌 API 키·비밀번호가 있으면 커밋을 막습니다.
  소스를 받은 뒤 처음 한 번 `scripts/setup_git.sh`를 실행해 켜세요.
- GitHub에서도 모든 푸시를 `security` 워크플로가 다시 점검하고, 과거 커밋 기록에 비밀 파일이 있는지도 찾습니다.
- Dependabot이 취약한 라이브러리를 매주 알려 줍니다.
- 비밀값은 `.env.example`을 복사한 `.env`에만 넣습니다. 진짜 값은 AI 채팅창에 붙여 넣지 마세요.
- 만약 키가 GitHub에 올라갔다면, 기록을 지우기보다 **그 키를 먼저 폐기하고 새로 만드세요.**

## 개발

| 폴더 | 내용 |
|---|---|
| `src/` | 앱 본체(HTML/CSS/JS) |
| `android/` | 안드로이드 껍데기(WebView). `android/build_apk.sh`가 Gradle 없이 APK를 만듭니다 |
| `desktop/` | PC 앱 실행기(Go 표준 라이브러리만 사용) |
| `test/` | Playwright로 33개 도구를 실제 파일로 돌려 보는 시험 |
| `scripts/` | 보안 점검, git 설정 |

```sh
npm ci --ignore-scripts          # 라이브러리 설치
python3 build.py                 # dist/web, dist/app(안드로이드·웹 Pages), dist/desktop 생성
python3 test/run_tests.py app    # 전체 도구 시험 (Playwright 필요)
```

- 웹 버전: `main`에 푸시하면 `pages` 워크플로가 `dist/app`을 GitHub Pages에 배포합니다.
- PC 앱: `python3 build.py desktop && cp -r dist/desktop desktop/www && cd desktop && GOOS=windows GOARCH=amd64 go build -ldflags "-s -w -H=windowsgui" -o build/pdfwb.exe .`
  아이콘·버전 정보는 `desktop/seticon.mjs`(npm `resedit`)로 넣습니다. Mac은 `darwin/arm64`, `darwin/amd64`로 각각 빌드해 `.app`에 넣습니다.
- APK 서명 키(`android/release.jks`, `android/keystore.properties`)는 저장소에 없습니다. 없으면 빌드할 때 새로 만듭니다.
  업데이트 APK는 같은 키로 서명해야 기존 앱 위에 설치되므로 키는 따로 안전하게 보관하세요.

한글 글꼴은 나눔고딕(SIL Open Font License)을 씁니다.
