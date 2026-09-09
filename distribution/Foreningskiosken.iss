#define MyAppName "Föreningskiosken"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "Morgan Nyberg"

[Setup]
AppId={{DD38BC24-D934-4AA8-8077-37D934DEAD2C}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\Foreningskiosken
DefaultGroupName={#MyAppName}
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
OutputDir=..\dist-installer
OutputBaseFilename=Foreningskiosken-Setup
SetupIconFile=assets\foreningskiosken.ico
UninstallDisplayIcon={app}\Foreningskiosken.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
Uninstallable=yes
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "swedish"; MessagesFile: "compiler:Languages\Swedish.isl"

[Tasks]
Name: "desktopicon"; Description: "Skapa en genväg på skrivbordet"; GroupDescription: "Genvägar:"; Flags: unchecked

[InstallDelete]
Type: filesandordirs; Name: "{app}\app\frontend\dist"
Type: filesandordirs; Name: "{app}\app\frontend\public\swish"
Type: filesandordirs; Name: "{app}\app\server"
Type: filesandordirs; Name: "{app}\runtime"

[Files]
Source: "..\dist-portable\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\Starta Föreningskiosken.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\Foreningskiosken.ico"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\Starta Föreningskiosken.cmd"; WorkingDir: "{app}"; IconFilename: "{app}\Foreningskiosken.ico"; Tasks: desktopicon

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\Configure-Firewall.ps1"" -Mode Apply -NodePath ""{app}\runtime\node.exe"""; Flags: runhidden waituntilterminated
Filename: "{app}\Starta Föreningskiosken.cmd"; Description: "Starta {#MyAppName}"; WorkingDir: "{app}"; Flags: postinstall shellexec nowait skipifsilent

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\Configure-Firewall.ps1"" -Mode Remove -NodePath ""{app}\runtime\node.exe"""; Flags: runhidden waituntilterminated; RunOnceId: "RemoveFirewallRules"
