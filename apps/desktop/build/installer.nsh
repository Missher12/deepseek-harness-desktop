; DeepSeek Harness uses electron-builder's assisted NSIS flow so a normal
; double-click exposes welcome, destination, progress, and finish pages.

!macro customHeader
  ShowInstDetails show
  ; The custom running check retains electron-builder's original implementation.
  ; Its default include and pid declaration are skipped when this hook exists.
  !include "getProcessInfo.nsh"
  Var pid
!macroend

!macro customCheckAppRunning
  !ifndef BUILD_UNINSTALLER
    ; installSection.nsh disables output immediately before this hook.
    ; Keep the stock Nsis7z progress and file operations; only restore output.
    ${IfNot} ${Silent}
      SetDetailsPrint both
      DetailPrint "Checking for a running DeepSeek Harness..."
    ${EndIf}
  !endif
  !insertmacro IS_POWERSHELL_AVAILABLE
  !insertmacro _CHECK_APP_RUNNING
  !ifndef BUILD_UNINSTALLER
    ${IfNot} ${Silent}
      DetailPrint "Preparing and installing application files..."
    ${EndIf}
  !endif
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
