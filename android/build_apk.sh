#!/usr/bin/env bash
# Gradle-free APK build: aapt2 -> javac -> d8 -> zipalign(py) -> apksigner
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/.."
TOOLS=/home/claude/android-tools/minapk/package/tools
AAPT2=/home/claude/android-tools/node_modules/aaptjs3/bin/x64/linux/aapt2
ANDROID_JAR="$TOOLS/android.jar"
W="$ROOT/build/apk"; VERSION_CODE=${VERSION_CODE:-1}; VERSION_NAME=${VERSION_NAME:-1.0.0}
rm -rf "$W"; mkdir -p "$W/assets" "$W/classes" "$W/dex"
cp -r "$ROOT/dist/app" "$W/assets/www"

"$AAPT2" compile --dir "$HERE/res" -o "$W/res.zip"
"$AAPT2" link -o "$W/base.apk" -I "$ANDROID_JAR" --manifest "$HERE/AndroidManifest.xml" \
  --min-sdk-version 24 --target-sdk-version 34 --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  -A "$W/assets" "$W/res.zip"

java -jar "$TOOLS/ecj-3.45.0.jar" -nowarn -source 8 -target 8 -encoding UTF-8 -bootclasspath "$ANDROID_JAR" -d "$W/classes" "$HERE/src" 2>&1 | grep -v JAVA_TOOL || true
java -cp "$TOOLS/d8.jar" com.android.tools.r8.D8 --release --min-api 24 --lib "$ANDROID_JAR" --output "$W/dex" $(find "$W/classes" -name '*.class') 2>&1 | grep -v JAVA_TOOL || true

python3 - "$W/base.apk" "$W/dex/classes.dex" "$W/aligned.apk" <<'PY'
import sys, zipfile
src, dex, out = sys.argv[1:]
zin = zipfile.ZipFile(src)
with zipfile.ZipFile(out, 'w') as zout:
    items = [(i, zin.read(i.filename)) for i in zin.infolist()]
    items.append((zipfile.ZipInfo('classes.dex', date_time=(2026, 1, 1, 0, 0, 0)), open(dex, 'rb').read()))
    for info, data in items:
        zi = zipfile.ZipInfo(info.filename, date_time=(2026, 1, 1, 0, 0, 0))
        stored = info.filename == 'resources.arsc' or info.filename.endswith(('.png', '.gz', '.jpg')) or (getattr(info, 'compress_type', 8) == zipfile.ZIP_STORED and info.filename != 'classes.dex')
        zi.compress_type = zipfile.ZIP_STORED if stored else zipfile.ZIP_DEFLATED
        zi.external_attr = 0
        if stored:
            off = zout.fp.tell() + 30 + len(zi.filename.encode('utf-8'))
            zi.extra = b'\x00' * ((4 - off % 4) % 4)
        zout.writestr(zi, data, compresslevel=9 if not stored else None)
# verify alignment
z = zipfile.ZipFile(out)
for i in z.infolist():
    if i.compress_type == zipfile.ZIP_STORED:
        z.fp.seek(i.header_offset); h = z.fp.read(30)
        n, e = int.from_bytes(h[26:28], 'little'), int.from_bytes(h[28:30], 'little')
        assert (i.header_offset + 30 + n + e) % 4 == 0, i.filename
print('aligned', len(z.infolist()), 'entries')
PY

KS="$HERE/release.jks"; PROPS="$HERE/keystore.properties"
# .env(커밋 안 됨)에 KS_PASS 가 있으면 그것을 씁니다
if [ -f "$ROOT/.env" ]; then set -a; . "$ROOT/.env"; set +a; fi
[ -n "${KS_PASS:-}" ] || unset KS_PASS
# The signing key and its password live outside the source tree's shared files (.gitignore'd).
if [ ! -f "$KS" ]; then
  KS_PASS="$(python3 -c 'import secrets;print(secrets.token_urlsafe(24))')"
  keytool -genkeypair -keystore "$KS" -storetype PKCS12 -storepass "$KS_PASS" -keypass "$KS_PASS" -alias pdfwb -keyalg RSA -keysize 3072 -validity 10000 \
    -dname "CN=PDF Workbench, O=PDF Workbench, C=KR" 2>&1 | grep -v JAVA_TOOL || true
  printf 'KS_PASS=%s\n' "$KS_PASS" > "$PROPS"; chmod 600 "$KS" "$PROPS"
fi
KS_PASS="${KS_PASS:-$(sed -n 's/^KS_PASS=//p' "$PROPS")}"
mkdir -p "$ROOT/dist/android"
OUT="$ROOT/dist/android/PDF-Workbench-$VERSION_NAME.apk"
export KS_PASS
java -jar "$TOOLS/apksigner.jar" sign --ks "$KS" --ks-pass env:KS_PASS --key-pass env:KS_PASS --ks-key-alias pdfwb \
  --min-sdk-version 24 --out "$OUT" "$W/aligned.apk" 2>&1 | grep -v JAVA_TOOL || true
java -jar "$TOOLS/apksigner.jar" verify --verbose "$OUT" 2>&1 | grep -v JAVA_TOOL | head -8
"$AAPT2" dump badging "$OUT" | head -6
ls -la "$OUT"
