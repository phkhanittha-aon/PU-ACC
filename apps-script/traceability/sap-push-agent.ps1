<#
  MGS Traceability — ตัวส่งข้อมูลจาก SAP Business One ขึ้น Google Sheets
  ============================================================================
  รันบนเครื่องในออฟฟิศที่มองเห็น SQL Server ของ B1 ได้ ตั้งเวลาด้วย Task Scheduler

  ทำไมต้องเป็นแบบ "ผลักออก" ไม่ใช่ให้คลาวด์เรียกเข้ามา
    Apps Script อยู่บนคลาวด์ของ Google · B1 อยู่ในวงแลนหลังไฟร์วอลล์
    คลาวด์เรียกเข้าไม่ได้ ถ้าจะให้เรียกได้ต้องเปิดพอร์ตขาเข้า ซึ่งใช้เวลาขออนุมัติเป็นเดือน
    สคริปต์นี้เชื่อมออกขาเดียวเหมือนเปิดเว็บทั่วไป จึงไม่ต้องขอเปิดพอร์ตอะไรเลย

  สคริปต์นี้ "อ่านอย่างเดียว" — ไม่มีคำสั่ง INSERT/UPDATE/DELETE ต่อ B1 แม้แต่คำสั่งเดียว
  ให้ผู้ดูแล B1 ตรวจได้ และควรใช้ SQL login ที่มีสิทธิ์ db_datareader เท่านั้น

  ติดตั้ง
    1. วางไฟล์นี้กับ sap-push-config.json ไว้โฟลเดอร์เดียวกัน
    2. แก้ค่าใน sap-push-config.json (ดูตัวอย่างท้ายไฟล์)
    3. ทดสอบ:  powershell -ExecutionPolicy Bypass -File .\sap-push-agent.ps1 -WhatIf
    4. Task Scheduler: ทุก 30 นาที · Run whether user is logged on or not
         Program:   powershell.exe
         Arguments: -ExecutionPolicy Bypass -NoProfile -File "D:\mgs\sap-push-agent.ps1"

  ถอนออก: ปิด task เดียวจบ ไม่มีอะไรค้างในระบบ SAP
#>

[CmdletBinding()]
param(
  [string] $ConfigPath = (Join-Path $PSScriptRoot 'sap-push-config.json'),
  [switch] $WhatIf,                      # ดึงข้อมูลและนับแถว แต่ไม่ส่งขึ้น Google
  [string[]] $OnlyTables                 # ระบุเฉพาะบางตารางตอนไล่หาปัญหา
)

$ErrorActionPreference = 'Stop'
$script:ExitCode = 0

# ── บันทึกการทำงาน เก็บ 30 วัน ───────────────────────────────────────────────
$LogDir = Join-Path $PSScriptRoot 'logs'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }
$LogFile = Join-Path $LogDir ("push-{0}.log" -f (Get-Date -Format 'yyyyMMdd'))
Get-ChildItem $LogDir -Filter 'push-*.log' -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
  Remove-Item -Force -ErrorAction SilentlyContinue

function Write-Log {
  param([string]$Message, [string]$Level = 'INFO')
  $line = "{0} [{1}] {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
  Write-Host $line
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

# ── คอนฟิก ───────────────────────────────────────────────────────────────────
if (-not (Test-Path $ConfigPath)) {
  Write-Log "ไม่พบไฟล์คอนฟิก: $ConfigPath" 'ERROR'
  exit 2
}
$cfg = Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json

foreach ($k in @('SqlServer', 'Database', 'Endpoint', 'Secret')) {
  if ([string]::IsNullOrWhiteSpace($cfg.$k)) {
    Write-Log "คอนฟิกขาดค่า: $k" 'ERROR'
    exit 2
  }
}
$ChunkRows = if ($cfg.ChunkRows) { [int]$cfg.ChunkRows } else { 4000 }
$YearsBack = if ($cfg.YearsBack) { [int]$cfg.YearsBack } else { 3 }
$TimeoutSec = if ($cfg.TimeoutSec) { [int]$cfg.TimeoutSec } else { 300 }

$connStr = if ($cfg.SqlUser) {
  "Server=$($cfg.SqlServer);Database=$($cfg.Database);User Id=$($cfg.SqlUser);Password=$($cfg.SqlPassword);Encrypt=True;TrustServerCertificate=True;Connect Timeout=30;ApplicationIntent=ReadOnly"
} else {
  "Server=$($cfg.SqlServer);Database=$($cfg.Database);Integrated Security=True;Encrypt=True;TrustServerCertificate=True;Connect Timeout=30;ApplicationIntent=ReadOnly"
}

# ── คำสั่ง SQL — ชุดเดียวกับที่อยู่ใน 05_Sap.gs (ฟังก์ชัน printSapQueries) ────
$Y = $YearsBack
$Queries = [ordered]@{

  'SAP_Items' = @"
SELECT T0.ItemCode AS item_code, T0.ItemName AS item_name, T1.ItmsGrpNam AS item_group,
       ISNULL(T0.U_Brand,'') AS brand, ISNULL(T0.U_ProductType,'') AS product_type,
       CASE WHEN T0.ManSerNum='Y' THEN 'SERIAL'
            WHEN T0.ManBtchNum='Y' THEN 'BATCH' ELSE 'NONE' END AS mng_method,
       T0.InvntryUom AS uom,
       CASE WHEN T0.validFor='Y' THEN 'TRUE' ELSE 'FALSE' END AS is_active
FROM OITM T0 LEFT JOIN OITB T1 ON T1.ItmsGrpCod = T0.ItmsGrpCod
WHERE T0.ManSerNum='Y' OR T0.ManBtchNum='Y'
"@

  'SAP_BP' = @"
SELECT CardCode AS card_code, CardName AS card_name, CardType AS card_type,
       ISNULL(Phone1,'') AS phone, ISNULL(E_Mail,'') AS email, ISNULL(CntctPrsn,'') AS contact_person,
       CASE WHEN validFor='Y' THEN 'TRUE' ELSE 'FALSE' END AS is_active
FROM OCRD WHERE CardType IN ('S','C')
"@

  'SAP_Warehouses' = @"
SELECT WhsCode AS whs_code, WhsName AS whs_name,
       ISNULL(U_LocationType,'INTERNAL') AS location_type,
       CASE WHEN Inactive='N' THEN 'TRUE' ELSE 'FALSE' END AS is_active
FROM OWHS
"@

  'SAP_PO_Lines' = @"
SELECT T0.DocEntry AS doc_entry, T1.LineNum AS line_num, T0.DocNum AS doc_num,
       CONVERT(varchar(10),T0.DocDate,120) AS doc_date,
       T0.CardCode AS card_code, T0.CardName AS card_name,
       T1.ItemCode AS item_code, T1.Dscription AS dscription,
       T1.Quantity AS quantity, T1.OpenQty AS open_qty, T1.WhsCode AS whs_code,
       ISNULL(T0.NumAtCard,'') AS num_at_card, T0.DocStatus AS doc_status,
       ISNULL(T2.PrjName,'') AS project
FROM OPOR T0 INNER JOIN POR1 T1 ON T1.DocEntry=T0.DocEntry
     LEFT JOIN OPRJ T2 ON T2.PrjCode=T0.Project
WHERE T0.DocDate >= DATEADD(year,-$Y,GETDATE())
"@

  'SAP_GRPO_Lines' = @"
SELECT T0.DocEntry AS doc_entry, T1.LineNum AS line_num, T0.DocNum AS doc_num,
       CONVERT(varchar(10),T0.DocDate,120) AS doc_date,
       T0.CardCode AS card_code, T0.CardName AS card_name,
       T1.ItemCode AS item_code, T1.Dscription AS dscription,
       T1.Quantity AS quantity, T1.WhsCode AS whs_code, ISNULL(T0.NumAtCard,'') AS num_at_card,
       T1.BaseEntry AS base_entry, T1.BaseLine AS base_line,
       ISNULL(CAST(T2.DocNum AS varchar(20)),'') AS base_doc_num, ISNULL(T3.PrjName,'') AS project
FROM OPDN T0 INNER JOIN PDN1 T1 ON T1.DocEntry=T0.DocEntry
     LEFT JOIN OPOR T2 ON T2.DocEntry=T1.BaseEntry AND T1.BaseType=22
     LEFT JOIN OPRJ T3 ON T3.PrjCode=T0.Project
WHERE T0.DocDate >= DATEADD(year,-$Y,GETDATE())
"@

  'SAP_Delivery_Lines' = @"
SELECT T0.DocEntry AS doc_entry, T1.LineNum AS line_num, T0.DocNum AS doc_num,
       CONVERT(varchar(10),T0.DocDate,120) AS doc_date,
       T0.CardCode AS card_code, T0.CardName AS card_name,
       T1.ItemCode AS item_code, T1.Dscription AS dscription,
       T1.Quantity AS quantity, T1.WhsCode AS whs_code,
       ISNULL(T0.ShipToCode,'') AS ship_to_code, ISNULL(T0.Address2,'') AS address,
       ISNULL(T2.PrjName,'') AS project
FROM ODLN T0 INNER JOIN DLN1 T1 ON T1.DocEntry=T0.DocEntry
     LEFT JOIN OPRJ T2 ON T2.PrjCode=T0.Project
WHERE T0.DocDate >= DATEADD(year,-$Y,GETDATE())
"@

  'SAP_Invoice_Lines' = @"
SELECT T0.DocEntry AS doc_entry, T1.LineNum AS line_num, T0.DocNum AS doc_num,
       CONVERT(varchar(10),T0.DocDate,120) AS doc_date,
       T0.CardCode AS card_code, T0.CardName AS card_name,
       T1.ItemCode AS item_code, T1.Quantity AS quantity,
       T1.BaseEntry AS base_entry, T1.BaseLine AS base_line,
       ISNULL(CAST(T2.DocNum AS varchar(20)),'') AS base_doc_num, ISNULL(T3.PrjName,'') AS project
FROM OINV T0 INNER JOIN INV1 T1 ON T1.DocEntry=T0.DocEntry
     LEFT JOIN ODLN T2 ON T2.DocEntry=T1.BaseEntry AND T1.BaseType=15
     LEFT JOIN OPRJ T3 ON T3.PrjCode=T0.Project
WHERE T0.DocDate >= DATEADD(year,-$Y,GETDATE())
"@

  'SAP_Return_Lines' = @"
SELECT 'CUSTOMER_RETURN' AS return_type, T0.DocEntry AS doc_entry, T1.LineNum AS line_num,
       T0.DocNum AS doc_num, CONVERT(varchar(10),T0.DocDate,120) AS doc_date,
       T0.CardCode AS card_code, T0.CardName AS card_name, T1.ItemCode AS item_code,
       T1.Quantity AS quantity, T1.WhsCode AS whs_code,
       T1.BaseEntry AS base_entry, T1.BaseLine AS base_line, '' AS base_doc_num,
       ISNULL(T0.Comments,'') AS reason
FROM ORDN T0 INNER JOIN RDN1 T1 ON T1.DocEntry=T0.DocEntry
WHERE T0.DocDate >= DATEADD(year,-$Y,GETDATE())
UNION ALL
SELECT 'SUPPLIER_RETURN', T0.DocEntry, T1.LineNum, T0.DocNum,
       CONVERT(varchar(10),T0.DocDate,120), T0.CardCode, T0.CardName, T1.ItemCode,
       T1.Quantity, T1.WhsCode, T1.BaseEntry, T1.BaseLine, '', ISNULL(T0.Comments,'')
FROM ORPD T0 INNER JOIN RPD1 T1 ON T1.DocEntry=T0.DocEntry
WHERE T0.DocDate >= DATEADD(year,-$Y,GETDATE())
"@

  'SAP_Lots' = @"
SELECT T0.ItemCode AS item_code, T0.DistNumber AS dist_number, 'BATCH' AS kind,
       T0.AbsEntry AS sys_number, ISNULL(T0.MnfSerial,'') AS mnf_serial,
       ISNULL(T0.LotNumber,'') AS supplier_lot,
       ISNULL(CONVERT(varchar(10),T0.InDate,120),'') AS in_date,
       ISNULL(CONVERT(varchar(10),T0.ExpDate,120),'') AS exp_date, ISNULL(T0.Notes,'') AS notes
FROM OBTN T0
UNION ALL
SELECT T1.ItemCode, T1.DistNumber, 'SERIAL', T1.AbsEntry, ISNULL(T1.MnfSerial,''),
       ISNULL(T1.LotNumber,''), ISNULL(CONVERT(varchar(10),T1.InDate,120),''),
       ISNULL(CONVERT(varchar(10),T1.ExpDate,120),''), ISNULL(T1.Notes,'')
FROM OSRN T1
"@

  # ★ กระดูกสันหลัง — การเดินของทุกล็อต/ซีเรียล
  'SAP_Lot_Moves' = @"
SELECT CAST(T0.ApplyType AS varchar(20)) AS obj_type,
       T0.ApplyEntry AS doc_entry, T0.ApplyLine AS line_num,
       T0.DocNum AS doc_num, CONVERT(varchar(10),T0.DocDate,120) AS doc_date,
       T0.ItemCode AS item_code, ISNULL(T2.DistNumber,T3.DistNumber) AS dist_number,
       CASE WHEN T2.DistNumber IS NOT NULL THEN 'BATCH' ELSE 'SERIAL' END AS kind,
       CASE WHEN T0.Direction = 0 THEN 'IN' ELSE 'OUT' END AS direction,
       ABS(T1.Quantity) AS quantity, T0.LocCode AS whs_code,
       ISNULL(T0.CardCode,'') AS card_code, ISNULL(T4.CardName,'') AS card_name,
       '' AS project
FROM OITL T0
  INNER JOIN ITL1 T1 ON T1.LogEntry = T0.LogEntry
  LEFT JOIN OBTN T2 ON T2.AbsEntry = T1.MdAbsEntry
  LEFT JOIN OSRN T3 ON T3.AbsEntry = T1.MdAbsEntry
  LEFT JOIN OCRD T4 ON T4.CardCode = T0.CardCode
WHERE T0.DocDate >= DATEADD(year,-$Y,GETDATE())
  AND ISNULL(T2.DistNumber,T3.DistNumber) IS NOT NULL
"@

  'SAP_Lot_Stock' = @"
SELECT T0.ItemCode AS item_code, T0.BatchNum AS dist_number, T0.WhsCode AS whs_code,
       T0.Quantity AS quantity, 'AVAILABLE' AS status
FROM OIBT T0 WHERE T0.Quantity <> 0
UNION ALL
SELECT T1.ItemCode, T2.DistNumber, T1.WhsCode, 1, 'AVAILABLE'
FROM OSRI T1 INNER JOIN OSRN T2 ON T2.AbsEntry = T1.SysSerial AND T2.ItemCode = T1.ItemCode
WHERE T1.Status = 0
"@
}

# ── อ่านจาก SQL Server ───────────────────────────────────────────────────────
function Invoke-B1Query {
  param([string]$Sql)
  $conn = New-Object System.Data.SqlClient.SqlConnection $connStr
  try {
    $conn.Open()
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = $Sql
    $cmd.CommandTimeout = 300
    $adapter = New-Object System.Data.SqlClient.SqlDataAdapter $cmd
    $table = New-Object System.Data.DataTable
    [void]$adapter.Fill($table)

    $cols = @($table.Columns | ForEach-Object { $_.ColumnName })
    $rows = New-Object System.Collections.ArrayList
    foreach ($r in $table.Rows) {
      $o = [ordered]@{}
      foreach ($c in $cols) {
        $v = $r[$c]
        $o[$c] = if ($v -is [DBNull]) { '' } else { $v }
      }
      [void]$rows.Add([pscustomobject]$o)
    }
    return , $rows
  } finally {
    $conn.Close()
    $conn.Dispose()
  }
}

# ── ลายเซ็น HMAC-SHA256 ──────────────────────────────────────────────────────
function Get-Signature {
  param([string]$Ts, [string]$Body, [string]$Secret)
  $hmac = New-Object System.Security.Cryptography.HMACSHA256
  $hmac.Key = [Text.Encoding]::UTF8.GetBytes($Secret)
  $bytes = $hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes("$Ts.$Body"))
  ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''
}

function Send-Chunk {
  param([string]$Tab, [array]$Rows, [string]$Mode, [string]$BatchId)

  $payload = @{
    batch_id = $BatchId
    tables   = @{ $Tab = @{ mode = $Mode; rows = $Rows } }
  }
  $body = $payload | ConvertTo-Json -Depth 8 -Compress
  $ts = [string][DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $sig = Get-Signature -Ts $ts -Body $body -Secret $cfg.Secret
  $url = "$($cfg.Endpoint)?ts=$ts&sig=$sig"

  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $res = Invoke-RestMethod -Uri $url -Method Post -Body ([Text.Encoding]::UTF8.GetBytes($body)) `
           -ContentType 'application/json; charset=utf-8' -TimeoutSec $TimeoutSec

  if (-not $res.ok) { throw "ปลายทางตอบกลับว่าไม่สำเร็จ: $($res.error)" }
  $r = $res.result.$Tab
  if ($r -and -not $r.ok) { throw "แท็บ $Tab ถูกปฏิเสธ: $($r.error)" }
  return $r.rows
}

# ── ทำงานหลัก ────────────────────────────────────────────────────────────────
$batchId = [guid]::NewGuid().ToString()
$started = Get-Date
Write-Log "เริ่มรอบส่งข้อมูล batch=$batchId server=$($cfg.SqlServer) db=$($cfg.Database)"

$targets = if ($OnlyTables) { $Queries.Keys | Where-Object { $OnlyTables -contains $_ } } else { $Queries.Keys }

foreach ($tab in $targets) {
  $t0 = Get-Date
  try {
    $rows = Invoke-B1Query -Sql $Queries[$tab]
    $count = $rows.Count
    $secs = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
    Write-Log "$tab : อ่านได้ $count แถว (${secs}s)"

    if ($WhatIf) { continue }

    if ($count -eq 0) {
      # ยังต้องส่งเพื่อล้างของเก่า — ตารางว่างใน B1 ต้องว่างในชีตด้วย
      [void](Send-Chunk -Tab $tab -Rows @() -Mode 'REPLACE' -BatchId $batchId)
      Write-Log "$tab : ส่งชุดว่างเพื่อล้างข้อมูลเดิม"
      continue
    }

    $sent = 0; $part = 0
    for ($i = 0; $i -lt $count; $i += $ChunkRows) {
      $slice = $rows[$i..([math]::Min($i + $ChunkRows - 1, $count - 1))]
      $mode = if ($part -eq 0) { 'REPLACE' } else { 'APPEND' }
      $written = Send-Chunk -Tab $tab -Rows @($slice) -Mode $mode -BatchId $batchId
      $sent += $slice.Count
      $part++
    }
    $secs = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1)
    Write-Log "$tab : ส่งสำเร็จ $sent แถว ใน $part ก้อน (${secs}s)"

  } catch {
    $script:ExitCode = 1
    Write-Log "$tab : ล้มเหลว — $($_.Exception.Message)" 'ERROR'
    # ตารางอื่นยังต้องส่งต่อ — ปัญหาของตารางเดียวไม่ควรทำให้ทั้งรอบตาย
  }
}

$total = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
if ($ExitCode -eq 0) {
  Write-Log "จบรอบเรียบร้อย ใช้เวลา ${total}s"
} else {
  Write-Log "จบรอบแบบมีข้อผิดพลาด ใช้เวลา ${total}s — ดูรายละเอียดใน $LogFile" 'ERROR'
}
exit $ExitCode

<#
  ตัวอย่าง sap-push-config.json
  ----------------------------------------------------------------------------
  {
    "SqlServer":   "SAPB1SRV\\SQLEXPRESS",
    "Database":    "MGS_LIVE",
    "SqlUser":     "mgs_trace_reader",
    "SqlPassword": "ใส่รหัสผ่านของ SQL login ที่มีสิทธิ์ db_datareader เท่านั้น",
    "Endpoint":    "https://script.google.com/a/macros/mgs.co.th/s/AKfycb.../exec",
    "Secret":      "ค่าที่ได้จากการรัน setupGeneratePushSecret() ใน Apps Script",
    "ChunkRows":   4000,
    "YearsBack":   3,
    "TimeoutSec":  300
  }

  ข้อควรระวังเรื่องความปลอดภัย
    · ไฟล์คอนฟิกมีทั้งรหัสผ่าน SQL และกุญแจลับ — จำกัดสิทธิ์ไฟล์ให้เฉพาะบัญชีที่รัน task
      icacls sap-push-config.json /inheritance:r /grant:r "DOMAIN\svc_mgs_trace:(R)"
    · ใช้ SQL login แยกที่มีสิทธิ์อ่านอย่างเดียว ไม่ใช้บัญชี sa หรือบัญชีของ B1
    · เปลี่ยนกุญแจเมื่อคนที่เคยเข้าถึงเครื่องนี้ลาออก
#>
