#Requires -Version 5.1
<#
.SYNOPSIS
  把插件导出的招生人数合并进直连抓取的分数线表

.DESCRIPTION
  招生计划走的是加密接口，直连拿不到人数，只能用浏览器插件抓。
  插件导出的 CSV 里「录取人数」是填好的；本脚本按
  「年份 + 院校名称 + 专业大类」把它们并进 crawl.ps1 生成的表格。

  专业名按大类匹配：只取第一个「（」之前的部分，所以
  「机器人工程（荣誉项目班）」和「机器人工程（荣誉项目班；校本部）」算同一个。

.PARAMETER Base
  crawl.ps1 生成的专业分数线 CSV（缺人数的那个）

.PARAMETER Plan
  插件导出的 CSV（有录取人数的那个）

.PARAMETER Out
  合并结果，默认在 Base 旁边加 _含人数

.EXAMPLE
  .\merge-plan.ps1 -Base ..\out\专业分数线_天津_1-200.csv -Plan ..\out\插件导出.csv
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Base,
  [Parameter(Mandatory = $true)][string]$Plan,
  [string]$Out = ''
)

$ErrorActionPreference = 'Stop'

function Read-Utf8Csv([string]$Path) {
  $text = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8)
  return @($text | ConvertFrom-Csv)
}

function Short-Name([string]$Name) {
  if ([string]::IsNullOrWhiteSpace($Name)) { return '' }
  $i = $Name.IndexOfAny([char[]]@([char]0xFF08, '('))
  if ($i -gt 0) { return $Name.Substring(0, $i).Trim() }
  return $Name.Trim()
}

function Csv-Cell([object]$Value) {
  $s = [string]$Value
  if ($s -match '[",\r\n]') { return '"' + $s.Replace('"', '""') + '"' }
  return $s
}

function Csv-Row([object[]]$Values) {
  return (($Values | ForEach-Object { Csv-Cell $_ }) -join ',')
}

function To-Int([object]$Value) {
  if ($null -eq $Value) { return $null }
  $s = [string]$Value
  if ($s -eq '' -or $s -eq '-') { return $null }
  $n = 0
  if ([int]::TryParse($s, [ref]$n)) { return $n }
  return $null
}

if (-not (Test-Path $Base)) { throw "找不到分数线文件：$Base" }
if (-not (Test-Path $Plan)) { throw "找不到人数文件：$Plan" }

$baseRows = Read-Utf8Csv $Base
$planRows = Read-Utf8Csv $Plan

if ($baseRows.Count -eq 0) { throw "分数线文件是空的：$Base" }
if ($planRows.Count -eq 0) { throw "人数文件是空的：$Plan" }

# 插件导出表里的列名可能是「招生省份」也可能没有
$planHasVolume = ($planRows[0].PSObject.Properties.Name -contains '录取人数')
if (-not $planHasVolume) { throw "人数文件里没有「录取人数」列，请用插件导出总表" }

# key = 年份|院校|专业大类  →  人数
$planMap = @{}
$planDup = 0
foreach ($p in $planRows) {
  $vol = To-Int $p.'录取人数'
  if ($null -eq $vol -or $vol -le 0) { continue }
  $key = "{0}|{1}|{2}" -f $p.'年份', $p.'院校名称', (Short-Name $p.'专业名称')
  if ($planMap.ContainsKey($key)) {
    # 同一年同一院校同一个大类出现多条（不同省份），累加
    $planMap[$key] = [int]$planMap[$key] + $vol
    $planDup++
  } else {
    $planMap[$key] = $vol
  }
}

$outFile = if ($Out) { $Out } else {
  $dir = Split-Path $Base -Parent
  $name = [System.IO.Path]::GetFileNameWithoutExtension($Base)
  Join-Path $dir ($name + '_含人数.csv')
}

$head = '年份,招生省份,院校名称,院校所在地,板块,专业名称,最高分,最低分,最高位次,最低位次,录取人数'
$sb = New-Object System.Text.StringBuilder
[void]$sb.Append($head + "`r`n")

$filled = 0
$already = 0
$missing = 0

foreach ($r in $baseRows) {
  $vol = To-Int $r.'录取人数'
  if ($null -ne $vol -and $vol -gt 0) {
    $already++
  } else {
    $key = "{0}|{1}|{2}" -f $r.'年份', $r.'院校名称', (Short-Name $r.'专业名称')
    if ($planMap.ContainsKey($key)) {
      $vol = $planMap[$key]
      $filled++
    } else {
      $missing++
    }
  }

  [void]$sb.Append((Csv-Row @(
    $r.'年份', $r.'招生省份', $r.'院校名称', $r.'院校所在地', $r.'板块', $r.'专业名称',
    $r.'最高分', $r.'最低分', $r.'最高位次', $r.'最低位次',
    $(if ($null -ne $vol) { $vol } else { '' })
  )) + "`r`n")
}

# 带 BOM：不然 Excel 打开中文全是乱码
$enc = New-Object System.Text.UTF8Encoding($true)
[System.IO.File]::WriteAllText($outFile, $sb.ToString(), $enc)

$total = $baseRows.Count
Write-Host ''
Write-Host "  合并完成" -ForegroundColor Green
Write-Host ("    总行数        {0}" -f $total)
Write-Host ("    本来就有       {0}" -f $already) -ForegroundColor DarkGray
Write-Host ("    从计划补齐     {0}" -f $filled) -ForegroundColor Green
Write-Host ("    仍然缺人数     {0}" -f $missing) -ForegroundColor Yellow
if ($planDup -gt 0) { Write-Host ("    同键合并       {0}" -f $planDup) -ForegroundColor DarkGray }
Write-Host "  输出：$outFile" -ForegroundColor Green
Write-Host ''
Write-Host '  提示：插件只抓了部分学校时才合并，没覆盖到的行会保持空——空的不会写 0。' -ForegroundColor DarkGray
