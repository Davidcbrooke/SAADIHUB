# Deploy SAADI Team's database rules and server functions.
# The Firebase tools break on the "&" in the OneDrive folder name, so this copies what's needed to
# C:\NGL\deploy\saadi-team (outside OneDrive) and deploys from there.
#   .\deploy-team.ps1                 rules + functions
#   .\deploy-team.ps1 firestore:rules just the rules
param([string]$only = "firestore:rules,functions")
$ErrorActionPreference = "Stop"
$env:Path = "C:\Program Files\nodejs;$env:APPDATA\npm;" + $env:Path
$src = $PSScriptRoot
$dst = "C:\NGL\deploy\saadi-team"
New-Item -ItemType Directory -Force "$dst\functions" | Out-Null
Copy-Item "$src\firebase.json", "$src\.firebaserc", "$src\firestore.rules" $dst -Force
Copy-Item "$src\functions\index.js", "$src\functions\package.json" "$dst\functions" -Force
if (Test-Path "$src\functions\package-lock.json") { Copy-Item "$src\functions\package-lock.json" "$dst\functions" -Force }
Push-Location "$dst\functions"; npm install --no-fund --no-audit --loglevel=error; Pop-Location
Push-Location $dst
firebase deploy --only $only --project saadi-financial-tracker --non-interactive --force
Pop-Location
