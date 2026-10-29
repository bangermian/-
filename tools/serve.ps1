#Requires -Version 5.1
<#
    Zero-dependency static file server for the gaokaoshun preview.

    Why this exists: the app is built from ES modules, and browsers refuse to
    load modules over file://. This script serves the project folder over
    http://127.0.0.1:<port>/ using nothing but System.Net.Sockets, so it works
    on a clean Windows box with no Node.js / Python installed.

    Usage:
        powershell -NoProfile -ExecutionPolicy Bypass -File tools\serve.ps1
        powershell -NoProfile -ExecutionPolicy Bypass -File tools\serve.ps1 -Port 9000
#>
param(
    [int]$Port = 8137,
    [string]$Root = ''
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($Root)) {
    $Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}
$Root = [System.IO.Path]::GetFullPath($Root)
if (-not (Test-Path -LiteralPath $Root)) {
    Write-Host "Project root not found: $Root" -ForegroundColor Red
    exit 1
}

$mimeMap = @{
    '.html' = 'text/html; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.mjs'  = 'text/javascript; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.gif'  = 'image/gif'
    '.ico'  = 'image/x-icon'
    '.csv'  = 'text/csv; charset=utf-8'
    '.txt'  = 'text/plain; charset=utf-8'
    '.md'   = 'text/markdown; charset=utf-8'
    '.xlsx' = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    '.xls'  = 'application/vnd.ms-excel'
    '.woff2' = 'font/woff2'
}

function Send-Response {
    param(
        [System.IO.Stream]$Stream,
        [int]$Status,
        [string]$Reason,
        [string]$ContentType,
        [byte[]]$Body,
        [bool]$HeadOnly = $false
    )

    if ($null -eq $Body) { $Body = New-Object byte[] 0 }
    $header = "HTTP/1.1 $Status $Reason`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
    $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
    $Stream.Write($headerBytes, 0, $headerBytes.Length)
    if (-not $HeadOnly -and $Body.Length -gt 0) {
        $Stream.Write($Body, 0, $Body.Length)
    }
    $Stream.Flush()
}

try {
    $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
    $listener.Start()
}
catch {
    Write-Host "Cannot listen on port $Port : $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Try another port:  powershell -File tools\serve.ps1 -Port 9000" -ForegroundColor Yellow
    exit 1
}

$url = "http://127.0.0.1:$Port/"
Write-Host ''
Write-Host "  gaokaoshun preview" -ForegroundColor Cyan
Write-Host "  URL : $url" -ForegroundColor Green
Write-Host "  Root: $Root"
Write-Host ''
Write-Host '  Press Ctrl+C to stop.' -ForegroundColor DarkGray
Write-Host ''

try {
    Start-Process $url | Out-Null
}
catch {
    Write-Host "  (Could not open the browser automatically - please open the URL manually.)" -ForegroundColor Yellow
}

while ($true) {
    $client = $null
    try {
        $client = $listener.AcceptTcpClient()
        $stream = $client.GetStream()
        $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII, $false, 8192, $true)

        $requestLine = $reader.ReadLine()
        if ([string]::IsNullOrWhiteSpace($requestLine)) { continue }

        # Drain headers
        while ($true) {
            $line = $reader.ReadLine()
            if ([string]::IsNullOrEmpty($line)) { break }
        }

        $parts = $requestLine -split ' '
        if ($parts.Length -lt 2) { continue }
        $method = $parts[0].ToUpperInvariant()
        $rawPath = $parts[1]

        $headOnly = $method -eq 'HEAD'
        if ($method -ne 'GET' -and -not $headOnly) {
            Send-Response -Stream $stream -Status 405 -Reason 'Method Not Allowed' -ContentType 'text/plain; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes('405'))
            continue
        }

        $queryIndex = $rawPath.IndexOf('?')
        if ($queryIndex -ge 0) { $rawPath = $rawPath.Substring(0, $queryIndex) }
        $decoded = [System.Uri]::UnescapeDataString($rawPath)
        if ($decoded -eq '/' -or $decoded.EndsWith('/')) { $decoded += 'index.html' }

        $relative = $decoded.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
        $target = [System.IO.Path]::GetFullPath((Join-Path $Root $relative))

        # Directory traversal guard
        if (-not $target.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)) {
            Send-Response -Stream $stream -Status 403 -Reason 'Forbidden' -ContentType 'text/plain; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes('403'))
            continue
        }

        if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
            $body = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $decoded")
            Send-Response -Stream $stream -Status 404 -Reason 'Not Found' -ContentType 'text/plain; charset=utf-8' -Body $body -HeadOnly $headOnly
            continue
        }

        $extension = [System.IO.Path]::GetExtension($target).ToLowerInvariant()
        $contentType = $mimeMap[$extension]
        if (-not $contentType) { $contentType = 'application/octet-stream' }

        $bytes = [System.IO.File]::ReadAllBytes($target)
        Send-Response -Stream $stream -Status 200 -Reason 'OK' -ContentType $contentType -Body $bytes -HeadOnly $headOnly
    }
    catch {
        # A broken client connection must never kill the server loop.
    }
    finally {
        if ($client) { $client.Close() }
    }
}
