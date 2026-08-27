; ============================================================================
;  IQ Motors Invoice - Windows installer (Inno Setup 6)
; ----------------------------------------------------------------------------
;  Build the app first with build_all.bat, then compile this script:
;      "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer.iss
;  Output: Installer\IQMotorsInvoice-Setup.exe
;
;  Client experience: run setup -> Next -> Install -> Finish. A desktop
;  shortcut is created and the app can be uninstalled from Windows settings.
; ============================================================================

#define MyAppName "IQ Motors Invoice"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "IQ Motors"
#define MyAppExeName "MercedesInvoice.exe"

[Setup]
AppId={{8E1F4C2A-6B7D-4A9E-9C3F-1A2B3C4D5E6F}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\IQMotorsInvoice
DisableProgramGroupPage=yes
; No admin rights needed - installs per-user.
PrivilegesRequired=lowest
OutputDir=Installer
OutputBaseFilename=IQMotorsInvoice-Setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\{#MyAppExeName}
SetupIconFile=mercedes_invoice\assets\app.ico

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; \
    GroupDescription: "{cm:AdditionalIcons}"; Flags: checkedonce

[Files]
; The whole PyInstaller onedir output (exe + runtime + bundled assets).
Source: "dist\MercedesInvoice\*"; DestDir: "{app}"; \
    Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; \
    Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; \
    Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Keep user data (%APPDATA%\MercedesInvoice) on uninstall on purpose -
; invoices and the Mercedes login must survive reinstalls/updates.
