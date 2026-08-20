; DeepSeek Harness uses electron-builder's assisted NSIS flow so a normal
; double-click exposes welcome, destination, progress, and finish pages.

!macro customHeader
  ; Keep the extraction log expanded on the progress page. This gives users a
  ; concrete view of the files and shortcuts being installed.
  ShowInstDetails show
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Welcome to DeepSeek Harness Setup"
  !define MUI_WELCOMEPAGE_TEXT "Setup will install DeepSeek Harness for your Windows account.$\r$\n$\r$\nNo administrator permission, Node.js, terminal, browser, or manual port configuration is required."
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customInstallMode
  ; The Desktop release is intentionally per-user and never asks for UAC.
  ; Forcing current-user mode also removes the otherwise redundant mode page.
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customInstall
  DetailPrint "Application files installed to $INSTDIR"
  DetailPrint "Desktop and Start menu shortcuts are ready"
  DetailPrint "Existing DeepSeek Harness workspace data was preserved"
!macroend
