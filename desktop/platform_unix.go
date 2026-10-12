//go:build !windows

package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

func openWindow(url string) {
	home, _ := os.UserHomeDir()
	var cands []string
	if runtime.GOOS == "darwin" {
		for _, base := range []string{"/Applications", filepath.Join(home, "Applications")} {
			cands = append(cands,
				filepath.Join(base, "Google Chrome.app/Contents/MacOS/Google Chrome"),
				filepath.Join(base, "Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
				filepath.Join(base, "Brave Browser.app/Contents/MacOS/Brave Browser"),
				filepath.Join(base, "Chromium.app/Contents/MacOS/Chromium"))
		}
	} else {
		for _, n := range []string{"google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"} {
			if p, err := exec.LookPath(n); err == nil {
				cands = append(cands, p)
			}
		}
		if p := os.Getenv("PDFWB_BROWSER"); p != "" {
			cands = append([]string{p}, cands...)
		}
	}
	if b := firstExisting(cands); b != "" {
		args := appArgs(url)
		if os.Getenv("PDFWB_HEADLESS") != "" {
			args = append(args, "--headless=new", "--no-sandbox", "--remote-debugging-port=9333")
		}
		if exec.Command(b, args...).Start() == nil {
			return
		}
	}
	if runtime.GOOS == "darwin" {
		exec.Command("open", url).Start()
	} else {
		exec.Command("xdg-open", url).Start()
	}
}

func downloadsDir() string {
	if d := os.Getenv("PDFWB_DOWNLOADS"); d != "" {
		return d
	}
	h, _ := os.UserHomeDir()
	return filepath.Join(h, "Downloads")
}

func reveal(p string) {
	if runtime.GOOS == "darwin" {
		exec.Command("open", "-R", p).Start()
	} else {
		exec.Command("xdg-open", filepath.Dir(p)).Start()
	}
}

func fatal(msg string) {
	fmt.Fprintln(os.Stderr, msg)
	if runtime.GOOS == "darwin" {
		exec.Command("osascript", "-e", fmt.Sprintf("display alert %q message %q", "PDF 작업대", msg)).Run()
	}
	os.Exit(1)
}

func install() {}
