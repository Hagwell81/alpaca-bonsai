; Custom NSIS include for alpaca installer
; Enhanced installer with custom pages and user data directory creation

!macro customInit
  ; Initialization logic can be added here if needed
!macroend

!macro customInstall
  ; Create data directory for user models and settings
  CreateDirectory "$APPDATA\alpaca"
  CreateDirectory "$APPDATA\alpaca\models"
  CreateDirectory "$APPDATA\alpaca\backends"
  CreateDirectory "$APPDATA\alpaca\logs"

  DetailPrint "Created user data directories"
!macroend

!macro customUnInstall
  ; Clean up user data directories (optional - commented out by default)
  ; Uncomment the following lines to remove user data on uninstall

  ; MessageBox MB_YESNO "Do you want to remove all user data including models and settings?" IDNO skip_cleanup
  ; RMDir /r "$APPDATA\alpaca"
  ; skip_cleanup:

  DetailPrint "Uninstallation complete"
!macroend

!macro customInstallMode
  ; Set default installation directory based on architecture
  ${If} ${RunningX64}
    StrCpy $INSTDIR "$PROGRAMFILES64\Alpaca"
  ${Else}
    StrCpy $INSTDIR "$PROGRAMFILES\Alpaca"
  ${EndIf}
!macroend
