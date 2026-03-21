$chrome = "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe"
if (!(Test-Path $chrome)) {
  $chrome = "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
}

Start-Process -FilePath $chrome -ArgumentList @(
  "--remote-debugging-port=9222",
  "--user-data-dir=$env:TEMP\chrome-devtools-mcp-profile"
)