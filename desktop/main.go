// PDF 작업대 desktop launcher: serves the embedded offline app on 127.0.0.1 and
// opens it in a chromeless app window (Edge/Chrome --app), falling back to the default browser.
package main

import (
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"
)

//go:embed all:www
var www embed.FS

const appID = "pdfworkbench-desktop"
const prefPort = 47613

var lastPing atomic.Int64

func main() {
	_ = mime.AddExtensionType(".wasm", "application/wasm")
	_ = mime.AddExtensionType(".js", "application/javascript")
	_ = mime.AddExtensionType(".ttf", "font/ttf")

	// Already running? Just open another window on the existing server.
	if alive(prefPort) {
		openWindow(fmt.Sprintf("http://127.0.0.1:%d/index.html", prefPort))
		return
	}
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", prefPort))
	if err != nil {
		ln, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			fatal("로컬 서버를 열 수 없습니다: " + err.Error())
		}
	}
	port := ln.Addr().(*net.TCPAddr).Port
	host := fmt.Sprintf("127.0.0.1:%d", port)
	sub, _ := fs.Sub(www, "www")
	files := http.FileServer(http.FS(sub))

	mux := http.NewServeMux()
	mux.HandleFunc("/__id", func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, appID) })
	mux.HandleFunc("/__ping", func(w http.ResponseWriter, r *http.Request) {
		lastPing.Store(time.Now().Unix())
		w.WriteHeader(204)
	})
	mux.HandleFunc("/__save", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("X-PDFWB") != "1" {
			http.Error(w, "forbidden", 403)
			return
		}
		name := sanitize(r.URL.Query().Get("name"))
		dir := filepath.Join(downloadsDir(), "PDF작업대")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			jsonErr(w, err)
			return
		}
		p := uniquePath(filepath.Join(dir, name))
		f, err := os.Create(p)
		if err != nil {
			jsonErr(w, err)
			return
		}
		_, err = io.Copy(f, http.MaxBytesReader(w, r.Body, 2<<30))
		f.Close()
		if err != nil {
			os.Remove(p)
			jsonErr(w, err)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"path": p})
	})
	mux.HandleFunc("/__reveal", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("X-PDFWB") != "1" {
			http.Error(w, "forbidden", 403)
			return
		}
		p := r.URL.Query().Get("path")
		base := filepath.Join(downloadsDir(), "PDF작업대")
		if rel, err := filepath.Rel(base, p); err != nil || strings.HasPrefix(rel, "..") {
			http.Error(w, "forbidden", 403)
			return
		}
		reveal(p)
		w.WriteHeader(204)
	})
	mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		files.ServeHTTP(w, r)
	}))
	guard := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// only answer to our own origin (blocks DNS-rebinding and other sites)
		if r.Host != host {
			http.Error(w, "forbidden", 403)
			return
		}
		hd := w.Header()
		hd.Set("X-Content-Type-Options", "nosniff")
		hd.Set("Referrer-Policy", "no-referrer")
		hd.Set("X-Frame-Options", "DENY")
		hd.Set("Cross-Origin-Opener-Policy", "same-origin")
		mux.ServeHTTP(w, r)
	})
	go http.Serve(ln, guard)

	start := time.Now()
	lastPing.Store(start.Unix())
	install()
	openWindow(fmt.Sprintf("http://%s/index.html", host))

	// Quit once no window has pinged for a while (windows ping every 5 s).
	for {
		time.Sleep(5 * time.Second)
		idle := time.Now().Unix() - lastPing.Load()
		if time.Since(start) > 90*time.Second && idle > 25 {
			return
		}
	}
}

func alive(port int) bool {
	c := http.Client{Timeout: 700 * time.Millisecond}
	r, err := c.Get(fmt.Sprintf("http://127.0.0.1:%d/__id", port))
	if err != nil {
		return false
	}
	defer r.Body.Close()
	b, _ := io.ReadAll(r.Body)
	return string(b) == appID
}

func sanitize(n string) string {
	n = filepath.Base(strings.TrimSpace(n))
	n = strings.Map(func(r rune) rune {
		if strings.ContainsRune(`\/:*?"<>|`, r) || r < 32 {
			return '_'
		}
		return r
	}, n)
	if n == "" || n == "." || n == ".." {
		n = "결과.pdf"
	}
	return n
}

func uniquePath(p string) string {
	if _, err := os.Stat(p); os.IsNotExist(err) {
		return p
	}
	ext := filepath.Ext(p)
	base := strings.TrimSuffix(p, ext)
	for i := 1; ; i++ {
		q := fmt.Sprintf("%s (%d)%s", base, i, ext)
		if _, err := os.Stat(q); os.IsNotExist(err) {
			return q
		}
	}
}

func jsonErr(w http.ResponseWriter, err error) {
	w.WriteHeader(500)
	json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
}

func appDataDir() string {
	d, err := os.UserConfigDir()
	if err != nil {
		d = os.TempDir()
	}
	return filepath.Join(d, "PDFWorkbench")
}

func firstExisting(paths []string) string {
	for _, p := range paths {
		if p == "" {
			continue
		}
		if st, err := os.Stat(p); err == nil && !st.IsDir() {
			return p
		}
	}
	return ""
}

func appArgs(url string) []string {
	return []string{
		"--app=" + url,
		"--user-data-dir=" + filepath.Join(appDataDir(), "window"),
		"--window-size=1320,900",
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-features=Translate,msEdgeSidebarV2,msUndersideButton",
		"--lang=ko",
	}
}
