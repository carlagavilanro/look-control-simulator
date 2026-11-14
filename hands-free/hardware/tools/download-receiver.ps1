param(
  [Parameter(Mandatory=$true)][string]$Port,
  [string]$File=(Join-Path $PSScriptRoot '../signals/receiver-captures.json'),
  [ValidateRange(10,300)][int]$TimeoutSeconds=120
)
$ErrorActionPreference='Stop'
Get-Command node -ErrorAction Stop | Out-Null
$taskTool=Join-Path $PSScriptRoot 'signal-tool.mjs'
$taskDestination=[IO.Path]::GetFullPath($File)
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($taskDestination)) | Out-Null
$taskStamp=[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff')
$taskLog=$taskDestination+'.export-'+$taskStamp+'.jsonl'
$taskEncoding=New-Object System.Text.UTF8Encoding($false)
$taskWriter=New-Object IO.StreamWriter($taskLog,$false,$taskEncoding)
$taskWriter.AutoFlush=$true
$taskSerial=New-Object IO.Ports.SerialPort($Port,115200,[IO.Ports.Parity]::None,8,[IO.Ports.StopBits]::One)
$taskSerial.ReadTimeout=500
$taskSerial.WriteTimeout=2000
$taskSerial.ReadBufferSize=65536
$taskSerial.DtrEnable=$false
$taskSerial.RtsEnable=$false
$taskReady=$false
$taskFinished=$false
try {
  $taskSerial.Open()
  Write-Host "Checking receiver on $Port. Close Arduino Serial Monitor if the port is busy."
  $taskDeadline=[DateTime]::UtcNow.AddSeconds(20)
  $taskNextStatus=[DateTime]::MinValue
  while([DateTime]::UtcNow -lt $taskDeadline){
    if([DateTime]::UtcNow -ge $taskNextStatus){
      $taskSerial.WriteLine('STATUS')
      $taskNextStatus=[DateTime]::UtcNow.AddSeconds(2)
    }
    try{$taskLine=$taskSerial.ReadLine().Trim()}catch [TimeoutException]{continue}
    try{$taskRecord=$taskLine | ConvertFrom-Json -ErrorAction Stop}catch{continue}
    if($taskRecord.type -ne 'receiver_status'){continue}
    if($taskRecord.captureArchiveApi -ne 1){throw 'This receiver needs the automatic-saving firmware first.'}
    if(!$taskRecord.storage_ready){throw "Receiver storage unavailable: $($taskRecord.storage_error)"}
    $taskReady=$true;break
  }
  if(!$taskReady){throw 'No automatic-saving receiver answered. Check the port and firmware.'}
  Write-Host 'Downloading saved captures. Do not press remote buttons during the download.'
  $taskSerial.WriteLine('EXPORT')
  $taskDeadline=[DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while([DateTime]::UtcNow -lt $taskDeadline){
    try{$taskLine=$taskSerial.ReadLine().Trim()}catch [TimeoutException]{continue}
    $taskWriter.WriteLine($taskLine)
    try{$taskRecord=$taskLine | ConvertFrom-Json -ErrorAction Stop}catch{continue}
    if($taskRecord.type -eq 'error'){throw "Receiver export failed: $($taskRecord.message)"}
    if($taskRecord.type -eq 'export_end'){$taskFinished=$true;break}
  }
  if(!$taskFinished){throw "Download did not finish. Partial log: $taskLog. Receiver files are unchanged."}
} finally {
  if($taskSerial.IsOpen){$taskSerial.Close()}
  $taskSerial.Dispose();$taskWriter.Dispose()
}
& node $taskTool archive --log $taskLog --file $taskDestination
if($LASTEXITCODE -ne 0){throw 'Archive verification failed. Receiver files were not deleted.'}
