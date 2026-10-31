#Requires -Version 5.1
<#
  抓取助手：一个中文菜单，把 crawl / merge-plan 包起来。
  由「抓取数据.cmd」调用，也可以直接在 PowerShell 里跑。
#>
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$OutDir = Join-Path $Root 'out'

function Pause-Here {
  Write-Host ''
  Read-Host '按回车返回菜单' | Out-Null
}

function Show-Header {
  Clear-Host
  Write-Host '  高考顺 · 数据抓取助手' -ForegroundColor Cyan
  Write-Host '  ====================' -ForegroundColor DarkCyan
  Write-Host ''
}

function Invoke-Crawl {
  Show-Header
  Write-Host '  【抓分数线】不需要浏览器，大约 1 秒抓一所学校的一年。' -ForegroundColor Gray
  Write-Host ''
  $province = Read-Host '  省份（直接回车 = 天津）'
  if ([string]::IsNullOrWhiteSpace($province)) { $province = '天津' }

  $fromText = Read-Host '  从第几名开始（回车 = 1）'
  $from = 1
  if (-not [int]::TryParse($fromText, [ref]$from)) { $from = 1 }

  $toText = Read-Host '  到第几名结束（回车 = 200）'
  $to = 200
  if (-not [int]::TryParse($toText, [ref]$to)) { $to = 200 }

  $yearsText = Read-Host '  抓哪几年，逗号分隔（回车 = 2026,2025,2024）'
  if ([string]::IsNullOrWhiteSpace($yearsText)) { $yearsText = '2026,2025,2024' }

  Write-Host ''
  Write-Host '  先预览一下要抓什么（不发请求）…' -ForegroundColor Yellow
  & (Join-Path $PSScriptRoot 'crawl.ps1') -Province $province -From $from -To $to -Years $yearsText -DryRun

  Write-Host ''
  $go = Read-Host '  确认开始抓取？输入 y 继续，其它键取消'
  if ($go -ne 'y' -and $go -ne 'Y') { Write-Host '  已取消' -ForegroundColor Yellow; return }

  Write-Host ''
  & (Join-Path $PSScriptRoot 'crawl.ps1') -Province $province -From $from -To $to -Years $yearsText
  Pause-Here
}

function Invoke-Merge {
  Show-Header
  Write-Host '  【合并人数】招生计划走加密接口，直连拿不到，需要先用插件抓一遍。' -ForegroundColor Gray
  Write-Host '  插件导出的 CSV 里有「录取人数」，这里按 年份+院校+专业大类 并进来。' -ForegroundColor Gray
  Write-Host ''

  $candidates = @()
  if (Test-Path $OutDir) {
    $candidates = @(Get-ChildItem $OutDir -Filter '*.csv' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
  }
  if ($candidates.Count -eq 0) {
    Write-Host '  out 目录里还没有 CSV，请先抓一次分数线。' -ForegroundColor Yellow
    Pause-Here
    return
  }

  Write-Host '  out 目录里的文件：' -ForegroundColor Cyan
  for ($i = 0; $i -lt [Math]::Min(10, $candidates.Count); $i++) {
    Write-Host ("    [{0}] {1}  ({2:MM-dd HH:mm})" -f ($i + 1), $candidates[$i].Name, $candidates[$i].LastWriteTime)
  }
  Write-Host ''
  $pick = Read-Host '  选哪个作为分数线（回车 = 1）'
  $idx = 1
  if (-not [int]::TryParse($pick, [ref]$idx) -or $idx -lt 1 -or $idx -gt $candidates.Count) { $idx = 1 }
  $baseFile = $candidates[$idx - 1].FullName

  Write-Host ''
  Write-Host '  现在把插件导出的 CSV 拖到这个窗口里（或直接输入完整路径），回车确认：' -ForegroundColor Cyan
  $planPath = Read-Host '  人数文件'
  $planPath = $planPath.Trim('"', ' ', "'")
  if (-not (Test-Path $planPath)) {
    Write-Host "  找不到文件：$planPath" -ForegroundColor Red
    Pause-Here
    return
  }

  Write-Host ''
  & (Join-Path $PSScriptRoot 'merge-plan.ps1') -Base $baseFile -Plan $planPath
  Pause-Here
}

function Show-Help {
  Show-Header
  Write-Host '  【说明】' -ForegroundColor Cyan
  Write-Host ''
  Write-Host '  · 抓分数线：直连掌上高考接口，不需要浏览器、不需要 Node。'
  Write-Host '    约 1 秒抓一所学校的一年，200 所 × 3 年大约 10 分钟。'
  Write-Host ''
  Write-Host '  · 人数：抓分数线时会顺带把招生计划一起抓（按专业组，免签名），约 85-90% 能补上。'
  Write-Host '    剩下超过 10 条的组，可以再用插件抓一遍，回到菜单选 [2] 合并。'
  Write-Host ''
  Write-Host '  · 断点续跑：中途关掉没关系，重跑会自动跳过已完成的学校。'
  Write-Host ''
  Write-Host '  · 结果在哪：out 目录，直接把 CSV 拖进高考顺网页就能加载。'
  Write-Host '    文件名带 _含人数 的那份是合并后的。'
  Write-Host ''
  Pause-Here
}

# ---------------- 主循环 ----------------
while ($true) {
  Show-Header
  Write-Host '  [1] 抓分数线（快，不用浏览器）' -ForegroundColor White
  Write-Host '  [2] 合并招生人数（需要插件先导出）' -ForegroundColor White
  Write-Host '  [3] 说明' -ForegroundColor White
  Write-Host '  [0] 退出' -ForegroundColor DarkGray
  Write-Host ''
  $choice = Read-Host '  请选择'

  switch ($choice) {
    '1' { Invoke-Crawl }
    '2' { Invoke-Merge }
    '3' { Show-Help }
    '0' { return }
    '' { }
    default { }
  }
}
