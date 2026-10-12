//go:build windows

package main

import (
	"encoding/base64"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unicode/utf16"
	"unsafe"
)

func hidden(c *exec.Cmd) *exec.Cmd {
	c.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	return c
}

func openWindow(url string) {
	pf, pf86, local := os.Getenv("ProgramFiles"), os.Getenv("ProgramFiles(x86)"), os.Getenv("LOCALAPPDATA")
	browser := firstExisting([]string{
		filepath.Join(pf86, `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(pf, `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(local, `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(pf, `Google\Chrome\Application\chrome.exe`),
		filepath.Join(pf86, `Google\Chrome\Application\chrome.exe`),
		filepath.Join(local, `Google\Chrome\Application\chrome.exe`),
	})
	if browser != "" && exec.Command(browser, appArgs(url)...).Start() == nil {
		return
	}
	hidden(exec.Command("rundll32", "url.dll,FileProtocolHandler", url)).Start()
}

func downloadsDir() string {
	// FOLDERID_Downloads via SHGetKnownFolderPath, falling back to %USERPROFILE%\Downloads
	shell32 := syscall.NewLazyDLL("shell32.dll")
	ole32 := syscall.NewLazyDLL("ole32.dll")
	proc := shell32.NewProc("SHGetKnownFolderPath")
	guid := [16]byte{0x90, 0xe2, 0x4d, 0x37, 0x3f, 0x12, 0x65, 0x45, 0x91, 0x64, 0x39, 0xc4, 0x92, 0x5e, 0x46, 0x7b}
	var p *uint16
	if proc.Find() == nil {
		if r, _, _ := proc.Call(uintptr(unsafe.Pointer(&guid[0])), 0, 0, uintptr(unsafe.Pointer(&p))); r == 0 && p != nil {
			s := syscall.UTF16ToString((*[1 << 15]uint16)(unsafe.Pointer(p))[:])
			ole32.NewProc("CoTaskMemFree").Call(uintptr(unsafe.Pointer(p)))
			if s != "" {
				return s
			}
		}
	}
	h, _ := os.UserHomeDir()
	return filepath.Join(h, "Downloads")
}

func reveal(p string) {
	exec.Command("explorer", "/select,", p).Start()
}

func fatal(msg string) {
	user32 := syscall.NewLazyDLL("user32.dll")
	t, _ := syscall.UTF16PtrFromString("PDF 작업대")
	m, _ := syscall.UTF16PtrFromString(msg)
	user32.NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), 0x10)
	os.Exit(1)
}

// install copies the exe to %LOCALAPPDATA%\Programs\PDFWorkbench and adds Start menu + desktop shortcuts once.
func install() {
	self, err := os.Executable()
	if err != nil {
		return
	}
	dir := filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "PDFWorkbench")
	target := filepath.Join(dir, "PDF작업대.exe")
	if !strings.EqualFold(filepath.Clean(self), filepath.Clean(target)) {
		os.MkdirAll(dir, 0o755)
		if b, err := os.ReadFile(self); err == nil {
			tmp := target + ".new"
			if os.WriteFile(tmp, b, 0o755) == nil {
				os.Remove(target)
				if os.Rename(tmp, target) != nil {
					os.Remove(tmp)
					target = self
				}
			} else {
				target = self
			}
		}
	}
	marker := filepath.Join(appDataDir(), "shortcuts-v1")
	if _, err := os.Stat(marker); err == nil {
		return
	}
	ps := `$w=New-Object -ComObject WScript.Shell;` +
		`foreach($d in @([Environment]::GetFolderPath('Programs'),[Environment]::GetFolderPath('Desktop'))){` +
		`$s=$w.CreateShortcut((Join-Path $d 'PDF 작업대.lnk'));$s.TargetPath='` + strings.ReplaceAll(target, "'", "''") + `';` +
		`$s.IconLocation='` + strings.ReplaceAll(target, "'", "''") + `,0';$s.Description='PDF 작업대';$s.Save()}`
	u := utf16.Encode([]rune(ps))
	b := make([]byte, len(u)*2)
	for i, v := range u {
		b[i*2], b[i*2+1] = byte(v), byte(v>>8)
	}
	cmd := hidden(exec.Command("powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", base64.StdEncoding.EncodeToString(b)))
	if cmd.Run() == nil {
		os.MkdirAll(appDataDir(), 0o755)
		os.WriteFile(marker, []byte("ok"), 0o644)
	}
}
