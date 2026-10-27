; The NexusMD installer's own part, added to electron-builder's NSIS script (nsis.include).
;
; The installer carries every app, and the user ticks the ones to install: a page after the folder
; page, with a checkbox per app. Only the ticked apps' folders are copied to
; $INSTDIR\resources\apps\<id>, so an app that is not ticked is not on the disk.
;
;   one app ticked      a standalone app: its own Start menu entry, name and icon
;   two or more         the combined NexusMD, with a tab for each
;
; Running the installer again starts from what is installed, so ticking one more turns a standalone
; app into the combined one; data lives in %APPDATA%\NexusMD and is not touched. An update (the
; updater runs the installer silently with --updated) skips the page and keeps what is installed.
; For scripted installs:   Setup.exe /S /APPS=git,editor      (or /APPS=all)
;
; The list of apps comes from the apps' manifests (apps.generated.nsh, from gen-apps-nsh.mjs).

!include nsDialogs.nsh
!include LogicLib.nsh
!include "${__FILEDIR__}\apps.generated.nsh"

!ifndef BUILD_UNINSTALLER
Var NxCount
Var NxFound
Var NxList
Var NxPos
Var NxLen
Var NxTok
Var NxCh
Var NxOneId
Var NxOneName
Var NxDir

!macro NxDeclare i id label product
  Var NxSel${i}
  Var NxChk${i}
!macroend
!insertmacro NexusForEachApp NxDeclare
!endif

; --- per-app steps, run once for each app by NexusForEachApp ---------------------------------------

; Is it installed already? Looks in the folder of the existing installation.
!macro NxProbe i id label product
  ${If} ${FileExists} "$NxDir\resources\apps\${id}\app.manifest.json"
    StrCpy $NxSel${i} 1
    StrCpy $NxFound 1
  ${Else}
    StrCpy $NxSel${i} 0
  ${EndIf}
!macroend

!macro NxTick i id label product
  StrCpy $NxSel${i} 1
!macroend

!macro NxClear i id label product
  StrCpy $NxSel${i} 0
!macroend

!macro NxMatch i id label product
  ${If} $NxTok == "${id}"
    StrCpy $NxSel${i} 1
  ${EndIf}
!macroend

!macro NxCreateRow i id label product
  !define /math NxCol ${i} / 5
  !define /math NxRow ${i} % 5
  !define /math NxRowY ${NxRow} * 14
  !define /math NxY ${NxRowY} + 32
  !define /math NxX ${NxCol} * 50
  ${NSD_CreateCheckbox} ${NxX}% ${NxY}u 48% 12u "${label}"
  Pop $NxChk${i}
  ${If} $NxSel${i} == 1
    ${NSD_Check} $NxChk${i}
  ${EndIf}
  !undef NxCol
  !undef NxRow
  !undef NxRowY
  !undef NxY
  !undef NxX
!macroend

!macro NxReadRow i id label product
  ${NSD_GetState} $NxChk${i} $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $NxSel${i} 1
    IntOp $NxCount $NxCount + 1
  ${Else}
    StrCpy $NxSel${i} 0
  ${EndIf}
!macroend

; Copies one ticked app into the installation, and remembers it (the last one counts if it is the only one).
!macro NxCopyApp i id label product
  ${If} $NxSel${i} == 1
    SetOutPath "$INSTDIR\resources\apps\${id}"
    File /r "${NEXUS_APPS_DIR}\${id}\*.*"
    IntOp $NxCount $NxCount + 1
    StrCpy $NxOneId "${id}"
    StrCpy $NxOneName "${product}"
  ${EndIf}
!macroend

; --- the functions: defined where the template's macros (MUI) already exist -------------------------

!macro customHeader
!ifndef BUILD_UNINSTALLER
  ; $NxList (a comma list) -> the ticked apps
  Function NxApplyList
    ${If} $NxList == "all"
      !insertmacro NexusForEachApp NxTick
      Return
    ${EndIf}
    !insertmacro NexusForEachApp NxClear
    StrLen $NxLen $NxList
    StrCpy $NxPos 0
    StrCpy $NxTok ""
    NxNext:
    IntCmp $NxPos $NxLen NxFlush NxMore NxFlush
    NxMore:
    StrCpy $NxCh $NxList 1 $NxPos
    IntOp $NxPos $NxPos + 1
    StrCmp $NxCh "," NxFlush
    StrCpy $NxTok "$NxTok$NxCh"
    Goto NxNext
    NxFlush:
    !insertmacro NexusForEachApp NxMatch
    StrCpy $NxTok ""
    IntCmp $NxPos $NxLen NxDone NxNext NxNext
    NxDone:
  FunctionEnd

  ; What is ticked to begin with: what is installed, or everything on a first install; /APPS= overrides.
  Function NxInitSelection
    StrCpy $NxFound 0
    ReadRegStr $NxDir SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" InstallLocation
    ${If} $NxDir == ""
      StrCpy $NxDir "$INSTDIR"
    ${EndIf}
    !insertmacro NexusForEachApp NxProbe
    ${If} $NxFound == 0
      !insertmacro NexusForEachApp NxTick
    ${EndIf}
    ClearErrors
    ${GetParameters} $R0
    ${GetOptions} $R0 "/APPS=" $R1
    ${IfNot} ${Errors}
      StrCpy $NxList $R1
      Call NxApplyList
    ${EndIf}
  FunctionEnd

  Function NxAppsPageCreate
    ; An update keeps what is installed and does not ask.
    ${If} ${isUpdated}
      Abort
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "Choose what to install" "Each app can be installed on its own, or together as NexusMD."
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}
    ${NSD_CreateLabel} 0 0 100% 28u "Tick the apps you want. One app installs by itself, with its own name and icon. Two or more install together as NexusMD, with a tab for each. You can run this installer again to add more."
    Pop $0
    !insertmacro NexusForEachApp NxCreateRow
    nsDialogs::Show
  FunctionEnd

  Function NxAppsPageLeave
    StrCpy $NxCount 0
    !insertmacro NexusForEachApp NxReadRow
    ${If} $NxCount == 0
      MessageBox MB_OK|MB_ICONEXCLAMATION "Choose at least one app."
      Abort
    ${EndIf}
  FunctionEnd
!endif
!macroend

!macro customInit
  Call NxInitSelection
!macroend

!macro customPageAfterChangeDir
  Page custom NxAppsPageCreate NxAppsPageLeave
!macroend

!macro customInstall
  ; The ticked apps only; the shell and the shared libraries came with the application files.
  StrCpy $NxCount 0
  !insertmacro NexusForEachApp NxCopyApp
  SetOutPath "$INSTDIR"

  ; One app is a standalone install: its shortcuts carry its name and icon instead of "NexusMD".
  ${If} $NxCount == 1
    ${If} ${FileExists} "$newStartMenuLink"
      Delete "$newStartMenuLink"
      CreateShortCut "$SMPROGRAMS\$NxOneName.lnk" "$appExe" "" "$INSTDIR\resources\apps\$NxOneId\assets\icon.ico" 0
    ${EndIf}
    ${If} ${FileExists} "$newDesktopLink"
      Delete "$newDesktopLink"
      CreateShortCut "$DESKTOP\$NxOneName.lnk" "$appExe" "" "$INSTDIR\resources\apps\$NxOneId\assets\icon.ico" 0
    ${EndIf}
    ; The installer removes the old shortcuts by this name when it is updated or uninstalled.
    WriteRegStr SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}" ShortcutName "$NxOneName"
    StrCpy $launchLink "$SMPROGRAMS\$NxOneName.lnk"
  ${EndIf}
!macroend
