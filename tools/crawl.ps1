#Requires -Version 5.1
<#
.SYNOPSIS
  直连抓取掌上高考数据（不需要 Node、不需要浏览器）

.DESCRIPTION
  分数线接口 api.zjzw.cn/web/api/ 不校验签名，page 参数直接可翻页。
  招生计划走 api-gaokao.zjzw.cn/apidata/web，规矩是按页取，每页最多 10 条；
  超过 10 条时第 2 页要签名，但**按专业组分别取就不用翻页**，所以也能免签名拿到。

  另外每所学校先查一次 provincescore.json，拿到「哪些年份有数据 / 有哪些专业组」，
  没有的年份直接跳过，不发那些注定白跑的请求。

.EXAMPLE
  .\crawl.ps1 -Province 天津 -From 1 -To 200 -Years 2026,2025,2024
  .\crawl.ps1 -Province 天津 -From 1 -To 200 -DryRun
  .\crawl.ps1 -Province 天津 -From 1 -To 50 -NoPlan
#>
[CmdletBinding()]
param(
  [string]$Province = '天津',
  [int]$From = 1,
  [int]$To = 200,
  [string]$Years = '2026,2025,2024,2023,2022,2021',
  [string]$Out = '',
  [int]$DelayMs = 150,
  [switch]$NoPlan,
  [switch]$Quiet,
  [switch]$DryRun,
  [switch]$NoResume
)

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

$Root = Split-Path $PSScriptRoot -Parent
$UA = 'Mozilla/5.0 (compatible; Baiduspider-render/2.0; +http://www.baidu.com/search/spider.html)'
$ApiBase = 'https://api.zjzw.cn/web/api/'
$PlanApi = 'https://api-gaokao.zjzw.cn/apidata/web'
$PageSize = 10

$ProvinceIds = @{
  '北京' = 11; '天津' = 12; '河北' = 13; '山西' = 14; '内蒙古' = 15;
  '辽宁' = 21; '吉林' = 22; '黑龙江' = 23;
  '上海' = 31; '江苏' = 32; '浙江' = 33; '安徽' = 34; '福建' = 35; '江西' = 36; '山东' = 37;
  '河南' = 41; '湖北' = 42; '湖南' = 43; '广东' = 44; '广西' = 45; '海南' = 46;
  '重庆' = 50; '四川' = 51; '贵州' = 52; '云南' = 53; '西藏' = 54;
  '陕西' = 61; '甘肃' = 62; '青海' = 63; '宁夏' = 64; '新疆' = 65
}

# ------------------------------ 小工具 ------------------------------

function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Text, $enc)
}

function Append-Utf8([string]$Path, [string]$Text) {
  $enc = New-Object System.Text.UTF8Encoding($false)
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

# 专业名只留第一个括号之前的部分：机器人工程（荣誉项目班）和（校本部）算同一个专业
function Short-Name([string]$Name) {
  if ([string]::IsNullOrWhiteSpace($Name)) { return '（未命名专业）' }
  $i = $Name.IndexOfAny([char[]]@([char]0xFF08, '('))
  if ($i -gt 0) { return $Name.Substring(0, $i).Trim() }
  return $Name.Trim()
}

function Save-Progress([hashtable]$Map, [string]$Path) {
  $obj = @{}
  foreach ($k in $Map.Keys) { $obj[$k] = 1 }
  Write-Utf8NoBom $Path ($obj | ConvertTo-Json -Compress)
}

# ------------------------------ 分数线接口 ------------------------------

$script:ThrottleStreak = 0
$script:TotalThrottles = 0

function Get-Api([hashtable]$Params, [int]$Retry = 5) {
  $pairs = $Params.GetEnumerator() | Sort-Object Name | ForEach-Object {
    [uri]::EscapeDataString($_.Key) + '=' + [uri]::EscapeDataString([string]$_.Value)
  }
  $url = $ApiBase + '?' + ($pairs -join '&')

  for ($attempt = 1; $attempt -le $Retry; $attempt++) {
    try {
      $resp = Invoke-RestMethod -Uri $url -Headers @{ 'User-Agent' = $UA } -TimeoutSec 25
      if ($resp.code -eq '0000') {
        $script:ThrottleStreak = 0
        return @{ ok = $true; data = $resp.data }
      }
      $msg = [string]$resp.message
      if ($msg -match '请求过多|频繁|限流') {
        $script:ThrottleStreak++
        $script:TotalThrottles++
        if ($script:ThrottleStreak -ge 3) {
          $pause = [Math]::Min(300, 30 * $script:ThrottleStreak)
          Write-Host ("  连续被限流，整体暂停 {0} 秒…" -f $pause) -ForegroundColor Yellow
          Start-Sleep -Seconds $pause
          $script:ThrottleStreak = 0
        } else {
          Start-Sleep -Milliseconds (1200 * $attempt)
        }
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

# ------------------------------ 可用性 + 招生计划 ------------------------------

$script:AvailabilityCache = @{}
$script:StatSkip = 0
$script:StatPlanFilled = 0
$script:StatPlanPartial = 0

<#
  school/{id}/dic/provincescore.json 说明「这所学校在各省有哪些年份、有哪些专业组」。
  两个用途：跳过没有的年份；拿到专业组 id 按组查计划（每组通常 ≤10 条，不用翻页）。
#>
function Get-SchoolAvailability([string]$schoolId) {
  $res = @{ Years = @(); GroupsByYear = @{}; TypeByYear = @{} }
  $url = "https://static-data.gaokao.cn/www/2.0/school/$schoolId/dic/provincescore.json?a=www.gaokao.cn"
  try {
    $resp = Invoke-RestMethod -Uri $url -Headers @{ 'User-Agent' = $UA } -TimeoutSec 25
    if ($resp.code -ne '0000' -or -not $resp.data) { return $res }

    $ns = $resp.data.newsdata
    if ($ns -and $ns.year) {
      $prop = $ns.year.PSObject.Properties | Where-Object { $_.Name -eq [string]$provinceId } | Select-Object -First 1
      if ($prop) { $res.Years = @($prop.Value | ForEach-Object { [int]$_ }) }
    }

    foreach ($entry in @($resp.data.data)) {
      if (-not $entry.year) { continue }
      $y = [int]$entry.year
      $p = @($entry.province) | Where-Object { [int]$_.pid -eq [int]$provinceId } | Select-Object -First 1
      if (-not $p) { continue }

      $typeId = '3'
      if ($p.type) { $typeId = [string](@($p.type)[0]) }
      $res.TypeByYear[$y] = $typeId

      $groups = @()
      if ($p.batch_group) {
        foreach ($batchProp in $p.batch_group.PSObject.Properties) {
          foreach ($g in @($batchProp.Value)) {
            if ($g.id) { $groups += [pscustomobject]@{ Batch = [string]$batchProp.Name; Group = [string]$g.id } }
          }
        }
      }
      $res.GroupsByYear[$y] = $groups
    }
  } catch { }
  return $res
}

<# 按专业组拉一页招生计划（第 1 页免签名） #>
function Get-PlanPage([string]$schoolId, [int]$year, [string]$batch, [string]$group, [string]$typeId) {
  $body = @{
    autosign          = ''
    like_spname       = ''
    local_batch_id    = $batch
    local_province_id = [string]$provinceId
    local_type_id     = $typeId
    page              = 1
    platform          = '2'
    school_id         = $schoolId
    sg_xuanke         = ''
    signsafe          = ''
    size              = 10
    special_group     = $group
    uri               = 'v1/school/special_plan'
    year              = [string]$year
  } | ConvertTo-Json -Compress

  try {
    $resp = Invoke-RestMethod -Uri $PlanApi -Method Post -ContentType 'application/json' `
      -Headers @{ 'User-Agent' = $UA; 'Referer' = 'https://www.gaokao.cn/'; 'Accept' = 'application/json' } `
      -Body $body -TimeoutSec 25
    if ($resp.code -ne 0) { return @{ items = @(); partial = $false } }
    $items = @($resp.data.item)
    $found = 0
    [int]::TryParse([string]$resp.data.numFound, [ref]$found) | Out-Null
    return @{ items = $items; partial = ($found -gt $items.Count) }
  } catch {
    return @{ items = @(); partial = $false }
  }
}

# ------------------------------ 读学校榜 ------------------------------

$schoolsCsv = Join-Path $Root 'data\软科排名.csv'
if (-not (Test-Path $schoolsCsv)) { throw "找不到 $schoolsCsv" }
$text = [System.IO.File]::ReadAllText($schoolsCsv, [System.Text.Encoding]::UTF8)
$allSchools = @($text | ConvertFrom-Csv)
$schools = @($allSchools | Where-Object {
  $r = 0
  [int]::TryParse([string]$_.'排名', [ref]$r) -and $r -ge $From -and $r -le $To
} | Sort-Object { [int]$_.'排名' })

if ($schools.Count -eq 0) { throw "第 $From-$To 名范围内没有学校（榜单共 $($allSchools.Count) 所）" }

# ------------------------------ 参数检查 ------------------------------

if (-not $ProvinceIds.ContainsKey($Province)) {
  throw "不认识的省份 $Province。可选：$($ProvinceIds.Keys -join '、')"
}
$provinceId = $ProvinceIds[$Province]
$yearList = @($Years -split ',' | ForEach-Object { [int]($_.Trim()) } | Where-Object { $_ -gt 2000 })
if ($yearList.Count -eq 0) { $yearList = @(2026, 2025, 2024, 2023, 2022, 2021) }

$outFile = if ($Out) { $Out } else { Join-Path $Root "out\专业分数线_${Province}_${From}-${To}.csv" }
$progressFile = Join-Path $Root ".cache\crawl-${Province}-${From}-${To}.json"

Write-Host ''
Write-Host "  省份 $Province (id $provinceId) · 学校 $($schools.Count) 所 · 年份 $($yearList -join '、')" -ForegroundColor Cyan
$planNote = if ($NoPlan) { '不抓招生计划' } else { '同时抓招生计划（按专业组，免签名）' }
Write-Host "  任务 $($schools.Count * $yearList.Count) 个「校×年」· $planNote" -ForegroundColor Cyan
Write-Host "  输出 $outFile" -ForegroundColor Cyan
Write-Host ''

if ($DryRun) {
  Write-Host '  (dry-run: 不发请求)' -ForegroundColor Yellow
  $schools | Select-Object -First 10 | ForEach-Object {
    Write-Host ("    {0}. {1} ({2}) {3}" -f $_.'排名', $_.'学校名称', $_.'学校ID', $_.'所在省份')
  }
  if ($schools.Count -gt 10) { Write-Host "    ... 其余 $($schools.Count - 10) 所" }
  return
}

# ------------------------------ 断点 ------------------------------

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
  $name = $school.'学校名称'

  # 先在站点上确认这所学校该省有没有这一年的数据
  if (-not $script:AvailabilityCache.ContainsKey($sid)) {
    $script:AvailabilityCache[$sid] = Get-SchoolAvailability $sid
  }
  $avail = $script:AvailabilityCache[$sid]
  if ($avail.Years.Count -gt 0 -and ($avail.Years -notcontains [int]$year)) {
    $script:StatSkip++
    if (-not $Quiet) { Write-Host ("  - {0} {1}: 站点没有该年数据，跳过" -f $name, $year) -ForegroundColor DarkGray }
    continue
  }

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
    Write-Host ("  x {0} {1}: {2}" -f $name, $year, $first.error) -ForegroundColor Red
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
    $major = Short-Name ([string]$it.sp_name)
    if (-not $groups.ContainsKey($major)) {
      $groups[$major] = [pscustomobject]@{
        Major = $major; MinScore = $null; MaxScore = $null; MinRank = $null; Volume = $null; HasVolume = $false
      }
    }
    $g = $groups[$major]
    $mn = ConvertTo-Number $it.min
    $mx = ConvertTo-Number $it.max
    $rk = ConvertTo-Number $it.min_section
    $lq = ConvertTo-Number $it.lq_num
    if ($null -ne $mn) { if ($null -eq $g.MinScore -or $mn -lt $g.MinScore) { $g.MinScore = $mn } }
    if ($null -ne $mx) { if ($null -eq $g.MaxScore -or $mx -gt $g.MaxScore) { $g.MaxScore = $mx } }
    if ($null -ne $rk) { if ($null -eq $g.MinRank -or $rk -gt $g.MinRank) { $g.MinRank = $rk } }
    if ($null -ne $lq) { $g.Volume = [int]($g.Volume + $lq); $g.HasVolume = $true }
  }

  # 招生计划：按专业组分别取，每组一页就够（免签名）
  $planByMajor = @{}
  if (-not $NoPlan) {
    $planGroups = @($avail.GroupsByYear[[int]$year])
    $typeId = '3'
    if ($avail.TypeByYear.ContainsKey([int]$year)) { $typeId = $avail.TypeByYear[[int]$year] }
    $groupPartial = 0
    foreach ($pg in $planGroups) {
      $page = Get-PlanPage $sid $year $pg.Batch $pg.Group $typeId
      if ($page.partial) { $groupPartial++ }
      foreach ($it in $page.items) {
        $pn = Short-Name ([string]$it.sp_name)
        $num = ConvertTo-Number $it.num
        if ($null -eq $num) { continue }
        if (-not $planByMajor.ContainsKey($pn)) { $planByMajor[$pn] = 0 }
        $planByMajor[$pn] = [int]$planByMajor[$pn] + [int]$num
      }
      if ($DelayMs -gt 0 -and $planGroups.Count -gt 1) {
        Start-Sleep -Milliseconds ([Math]::Max(60, [int]($DelayMs / 2)))
      }
    }
    if ($groupPartial -gt 0) { $script:StatPlanPartial++ }
  }

  $sb = New-Object System.Text.StringBuilder
  foreach ($g in ($groups.Values | Sort-Object Major)) {
    $vol = ''
    if ($g.HasVolume) {
      $vol = $g.Volume
    } elseif ($planByMajor.ContainsKey($g.Major) -and $planByMajor[$g.Major] -gt 0) {
      $vol = $planByMajor[$g.Major]
      $script:StatPlanFilled++
    }
    $maxScore = ''
    if ($null -ne $g.MaxScore) { $maxScore = $g.MaxScore }
    $minScore = ''
    if ($null -ne $g.MinScore) { $minScore = $g.MinScore }
    $minRank = ''
    if ($null -ne $g.MinRank) { $minRank = $g.MinRank }

    $row = Csv-Row @($year, $Province, $name, $school.'所在省份', $school.'板块', $g.Major, $maxScore, $minScore, '', $minRank, $vol)
    [void]$sb.Append($row + "`r`n")
    $rowsWritten++
  }
  if ($sb.Length -gt 0) { Append-Utf8 $outFile $sb.ToString() }

  $done[$task.Key] = $true
  $finished++

  # 主动控速：与其撞上限流再退避，不如一开始就慢一点
  if ($DelayMs -gt 0) { Start-Sleep -Milliseconds $DelayMs }

  if ($finished % 10 -eq 0) {
    Save-Progress $done $progressFile
    $elapsed = $sw.Elapsed.TotalSeconds
    $rate = 0
    if ($elapsed -gt 0) { $rate = $finished / $elapsed }
    $left = 0
    if ($rate -gt 0) { $left = [Math]::Round(($tasks.Count - $finished) / $rate) }
    Write-Host ("  {0}/{1} · {2} 行 · {3:N1}/秒 · 剩余约 {4} 秒" -f $finished, $tasks.Count, $rowsWritten, $rate, $left) -ForegroundColor DarkGray
  }
}

Save-Progress $done $progressFile

Write-Host ''
Write-Host ("  完成：{0} 个任务，{1} 行，失败 {2} 个，耗时 {3:N1} 秒" -f $finished, $rowsWritten, $failed, $sw.Elapsed.TotalSeconds) -ForegroundColor Green
if ($script:StatSkip -gt 0) { Write-Host ("  跳过（站点无该年数据）：{0} 个" -f $script:StatSkip) -ForegroundColor DarkGray }
if ($script:StatPlanFilled -gt 0) { Write-Host ("  人数由招生计划补齐：{0} 行" -f $script:StatPlanFilled) -ForegroundColor Green }
if ($script:StatPlanPartial -gt 0) { Write-Host ("  有 {0} 个「校×年」的专业组超过 10 条，计划数只取到前 10 条" -f $script:StatPlanPartial) -ForegroundColor Yellow }
if ($script:TotalThrottles -gt 0) { Write-Host ("  被限流 {0} 次（已自动退避）" -f $script:TotalThrottles) -ForegroundColor Yellow }
Write-Host "  输出：$outFile" -ForegroundColor Green
Write-Host '  拖进高考顺就能加载；也可以再跑 merge-plan.ps1 用插件数据补人数。' -ForegroundColor DarkGray
