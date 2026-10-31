#Requires -Version 5.1
<#
.SYNOPSIS
  直连抓取掌上高考专业分数线（不需要 Node、不需要浏览器）

.DESCRIPTION
  掌上高考的分数线接口 api.zjzw.cn/web/api/ 不校验签名，page 参数直接翻页。
  实测单请求约 90ms，200 所 x 6 年大约 6 分钟。

  输出 CSV 直接拖进高考顺即可。
  招生计划（人数）走的是加密接口，直连拿不到，用插件抓完再跑 merge-plan.ps1 合并。

.EXAMPLE
  .\crawl.ps1 -Province 天津 -From 1 -To 200 -Years 2026,2025,2024
  .\crawl.ps1 -Province 天津 -From 1 -To 50 -DryRun
#>
[CmdletBinding()]
param(
  [string]$Province = '天津',
  [int]$From = 1,
  [int]$To = 200,
  [string]$Years = '2026,2025,2024,2023,2022,2021',
  [string]$Out = '',
  [switch]$DryRun,
  [switch]$NoResume
)

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

$Root = Split-Path $PSScriptRoot -Parent
$UA = 'Mozilla/5.0 (compatible; Baiduspider-render/2.0; +http://www.baidu.com/search/spider.html)'
$ApiBase = 'https://api.zjzw.cn/web/api/'
$PageSize = 10

$ProvinceIds = @{
  '北京' = 11; '天津' = 12; '河北' = 13; '山西' = 14; '内蒙古' = 15;
  '辽宁' = 21; '吉林' = 22; '黑龙江' = 23;
  '上海' = 31; '江苏' = 32; '浙江' = 33; '安徽' = 34; '福建' = 35; '江西' = 36; '山东' = 37;
  '河南' = 41; '湖北' = 42; '湖南' = 43; '广东' = 44; '广西' = 45; '海南' = 46;
  '重庆' = 50; '四川' = 51; '贵州' = 52; '云南' = 53; '西藏' = 54;
  '陕西' = 61; '甘肃' = 62; '青海' = 63; '宁夏' = 64; '新疆' = 65
}

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Text, $enc)
}

function Append-Utf8([string]$Path, [string]$Text, [bool]$WithBom) {
  $enc = New-Object System.Text.UTF8Encoding($WithBom)
  [System.IO.File]::AppendAllText($Path, $Text, $enc)
}

function Csv-Cell([object]$Value) {
  $s = [string]$Value
  if ($s -match '[",\r\n]') { return '"' + $s.Replace('"', '""') + '"' }
  return $s
}

function Csv-Row([object[]]$Values) {
  return (($Values | ForEach-Object { Csv-Cell $_ }) -join ',')
}

function ConvertTo-Number([object]$Value) {
  if ($null -eq $Value) { return $null }
  $s = [string]$Value
  if ($s -eq '-' -or $s -eq '') { return $null }
  $n = 0
  if ([int]::TryParse($s, [ref]$n)) { return $n }
  $d = 0.0
  if ([double]::TryParse($s, [ref]$d)) { return $d }
  return $null
}

function Short-Name([string]$Name) {
  if ([string]::IsNullOrWhiteSpace($Name)) { return '（未命名专业）' }
  $i = $Name.IndexOfAny([char[]]@([char]0xFF08, '('))   # 全角/半角括号
  if ($i -gt 0) { return $Name.Substring(0, $i).Trim() }
  return $Name.Trim()
}

function Get-Api([hashtable]$Params, [int]$Retry = 4) {
  $query = ($Params.GetEnumerator() | Sort-Object Name | ForEach-Object {
    [uri]::EscapeDataString($_.Key) + '=' + [uri]::EscapeDataString([string]$_.Value)
  }) -join '&'
  $url = "$ApiBase`?$query"

  for ($attempt = 1; $attempt -le $Retry; $attempt++) {
    try {
      $resp = Invoke-RestMethod -Uri $url -Headers @{ 'User-Agent' = $UA } -TimeoutSec 25
      if ($resp.code -eq '0000') { return @{ ok = $true; data = $resp.data } }
      $msg = [string]$resp.message
      if ($msg -match '请求过多|频繁|限流') {
        Start-Sleep -Milliseconds (700 * $attempt)
        continue
      }
      return @{ ok = $false; error = "code $($resp.code): $msg" }
    } catch {
      if ($attempt -eq $Retry) { return @{ ok = $false; error = $_.Exception.Message } }
      Start-Sleep -Milliseconds (400 * $attempt)
    }
  }
  return @{ ok = $false; error = 'retry exhausted' }
}

# ---------- 读学校榜 ----------
$schoolsCsv = Join-Path $Root 'data\软科排名.csv'
if (-not (Test-Path $schoolsCsv)) { throw "找不到 $schoolsCsv" }
$text = [System.IO.File]::ReadAllText($schoolsCsv, [System.Text.Encoding]::UTF8)
$allSchools = @($text | ConvertFrom-Csv)
$schools = @($allSchools | Where-Object {
  $r = 0
  [int]::TryParse([string]$_.'排名', [ref]$r) -and $r -ge $From -and $r -le $To
} | Sort-Object { [int]$_.'排名' })

if ($schools.Count -eq 0) { throw "第 $From–$To 名范围内没有学校（榜单共 $($allSchools.Count) 所）" }

# ---------- 参数检查 ----------
if (-not $ProvinceIds.ContainsKey($Province)) {
  throw "不认识的省份「$Province」。可选：$($ProvinceIds.Keys -join '、')"
}
$provinceId = $ProvinceIds[$Province]
$yearList = @($Years -split ',' | ForEach-Object { [int]($_.Trim()) } | Where-Object { $_ -gt 2000 })
if ($yearList.Count -eq 0) { $yearList = @(2026, 2025, 2024, 2023, 2022, 2021) }

$outFile = if ($Out) { $Out } else { Join-Path $Root "out\专业分数线_${Province}_${From}-${To}.csv" }
$progressFile = Join-Path $Root ".cache\crawl-${Province}-${From}-${To}.json"

Write-Host ''
Write-Host "  省份 $Province（id $provinceId）· 学校 $($schools.Count) 所 · 年份 $($yearList -join '、')" -ForegroundColor Cyan
Write-Host "  任务 $($schools.Count * $yearList.Count) 个「校×年」 → $outFile" -ForegroundColor Cyan
Write-Host ''

if ($DryRun) {
  Write-Host '  （dry-run：不发请求）' -ForegroundColor Yellow
  $schools | Select-Object -First 10 | ForEach-Object {
    Write-Host ("    {0}. {1}（{2}）{3}" -f $_.'排名', $_.'学校名称', $_.'学校ID', $_.'所在省份')
  }
  if ($schools.Count -gt 10) { Write-Host "    … 其余 $($schools.Count - 10) 所" }
  return
}

# ---------- 断点 ----------
function Save-Progress {
  param([hashtable]$Map, [string]$Path)
  $obj = @{}
  foreach ($k in $Map.Keys) { $obj[$k] = 1 }
  Write-Utf8NoBom $Path ($obj | ConvertTo-Json -Compress)
}

$done = @{}
if (-not $NoResume -and (Test-Path $progressFile)) {
  try {
    $saved = [System.IO.File]::ReadAllText($progressFile, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
    foreach ($p in $saved.PSObject.Properties) { $done[$p.Name] = $true }
    Write-Host "  断点续跑：跳过已完成 $($done.Count) 个任务" -ForegroundColor Yellow
  } catch { }
}

$outDir = Split-Path $outFile -Parent
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }
$cacheDir = Split-Path $progressFile -Parent
if (-not (Test-Path $cacheDir)) { New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null }

$head = '年份,招生省份,院校名称,院校所在地,板块,专业名称,最高分,最低分,最高位次,最低位次,录取人数'
$needHeader = -not (Test-Path $outFile) -or (Get-Item $outFile).Length -eq 0
if ($needHeader) { Write-Utf8NoBom $outFile ($head + "`r`n") }

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$finished = 0
$rowsWritten = 0
$failed = 0
$tasks = @()
foreach ($s in $schools) {
  foreach ($y in $yearList) {
    $key = "$($s.'学校ID')|$y"
    if ($done.ContainsKey($key)) { continue }
    $tasks += [pscustomobject]@{ School = $s; Year = $y; Key = $key }
  }
}

if ($tasks.Count -eq 0) {
  Write-Host '  所有任务都已完成，无需抓取。' -ForegroundColor Green
  return
}

Write-Host "  开始抓取 $($tasks.Count) 个任务…" -ForegroundColor Green

foreach ($task in $tasks) {
  $school = $task.School
  $year = $task.Year
  $sid = [string]$school.'学校ID'
  $common = @{
    local_province_id = $provinceId
    school_id = $sid
    size = $PageSize
    uri = 'apidata/api/gk/score/special'
    year = $year
  }

  $first = Get-Api ($common + @{ page = 1 })
  if (-not $first.ok) {
    $failed++
    Write-Host ("  ✗ {0} {1}：{2}" -f $school.'学校名称', $year, $first.error) -ForegroundColor Red
    continue
  }

  $items = @()
  if ($first.data.item) { $items += @($first.data.item) }
  $total = 0
  [int]::TryParse([string]$first.data.numFound, [ref]$total) | Out-Null
  $pages = [Math]::Max(1, [Math]::Ceiling($total / $PageSize))

  for ($p = 2; $p -le $pages; $p++) {
    $more = Get-Api ($common + @{ page = $p })
    if ($more.ok -and $more.data.item) { $items += @($more.data.item) }
  }

  # 按专业大类聚合
  $groups = @{}
  foreach ($it in $items) {
    $name = Short-Name ([string]$it.sp_name)
    if (-not $groups.ContainsKey($name)) {
      $groups[$name] = [pscustomobject]@{
        Major = $name; MinScore = $null; MaxScore = $null; MinRank = $null; Volume = $null; HasVolume = $false
      }
    }
    $g = $groups[$name]
    $mn = ConvertTo-Number $it.min
    $mx = ConvertTo-Number $it.max
    $rk = ConvertTo-Number $it.min_section
    $lq = ConvertTo-Number $it.lq_num
    if ($null -ne $mn) { if ($null -eq $g.MinScore -or $mn -lt $g.MinScore) { $g.MinScore = $mn } }
    if ($null -ne $mx) { if ($null -eq $g.MaxScore -or $mx -gt $g.MaxScore) { $g.MaxScore = $mx } }
    if ($null -ne $rk) { if ($null -eq $g.MinRank -or $rk -gt $g.MinRank) { $g.MinRank = $rk } }
    if ($null -ne $lq) { $g.Volume = [int]($g.Volume + $lq); $g.HasVolume = $true }
  }

  $sb = New-Object System.Text.StringBuilder
  foreach ($g in ($groups.Values | Sort-Object Major)) {
    $vol = if ($g.HasVolume) { $g.Volume } else { '' }
    [void]$sb.Append((Csv-Row @($year, $Province, $school.'学校名称', $school.'所在省份', $school.'板块',
      $g.Major, $(if ($null -ne $g.MaxScore) { $g.MaxScore } else { '' }),
      $(if ($null -ne $g.MinScore) { $g.MinScore } else { '' }), '',
      $(if ($null -ne $g.MinRank) { $g.MinRank } else { '' }), $vol)) + "`r`n")
    $rowsWritten++
  }
  if ($sb.Length -gt 0) { Append-Utf8 $outFile $sb.ToString() $false }

  $done[$task.Key] = $true
  $finished++

  if ($finished % 10 -eq 0) {
    Save-Progress $done $progressFile
    $elapsed = $sw.Elapsed.TotalSeconds
    $rate = if ($elapsed -gt 0) { $finished / $elapsed } else { 0 }
    $left = if ($rate -gt 0) { [Math]::Round(($tasks.Count - $finished) / $rate) } else { 0 }
    Write-Host ("  {0}/{1} · {2} 行 · {3:N1}/秒 · 剩余约 {4} 秒" -f $finished, $tasks.Count, $rowsWritten, $rate, $left) -ForegroundColor DarkGray
  }
}

# 保存断点
Save-Progress $done $progressFile

Write-Host ''
Write-Host ("  完成：{0} 个任务，{1} 行，失败 {2} 个，耗时 {3:N1} 秒" -f $finished, $rowsWritten, $failed, $sw.Elapsed.TotalSeconds) -ForegroundColor Green
Write-Host "  输出：$outFile" -ForegroundColor Green
Write-Host '  下一步：如果想让表格里有招生人数，运行「合并人数」（merge-plan.ps1）' -ForegroundColor Yellow
