# fxlab landing · veri anlik goruntusu
# Baris'in herkese acik fxlab API'sinden 5H / 1D / 1W verisini data\ klasorune indirir.
# Calistirma: bu dosyaya sag tik > "Run with PowerShell"
#   ya da PowerShell'de:  powershell -ExecutionPolicy Bypass -File .\snapshot.ps1
$ErrorActionPreference = 'Stop'
$dir = Join-Path $PSScriptRoot 'data'
New-Item -ItemType Directory -Force $dir | Out-Null
foreach ($h in '5h','1d','1w') {
  $id  = [guid]::NewGuid().ToString()
  $url = "https://www.withoh.com/api/fxlab?requestId=$id&horizon=$h&evidenceVersion=1.3"
  Write-Host "Indiriliyor: $h ..."
  Invoke-WebRequest -UseBasicParsing -TimeoutSec 90 -Uri $url -OutFile (Join-Path $dir "$h.json")
  Start-Sleep -Seconds 3
}
$stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.000000Z")
Set-Content -Encoding ascii -Path (Join-Path $dir 'snapshot.json') -Value "{`"takenAt`":`"$stamp`"}"
Write-Host "Tamam. data\ klasorunde 5h.json, 1d.json, 1w.json ve snapshot.json var."
Read-Host "Kapatmak icin Enter"
