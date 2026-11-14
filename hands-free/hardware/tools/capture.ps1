param(
  [Parameter(Mandatory=$true)][string]$Port,
  [ValidatePattern('^[a-z0-9_]{1,48}$')][string]$Name,
  [int]$CarrierKHz=38,
  [ValidateRange(1,3600)][int]$Seconds=60,
  [string]$File=(Join-Path $PSScriptRoot '../signals/signals.json'),
  [string]$LogDirectory=(Join-Path $PSScriptRoot '../signals/capture-logs'),
  [switch]$Replace,
  [switch]$ListenOnly
)
$ErrorActionPreference='Stop'
if(!$ListenOnly -and !$Name){throw 'Specify -Name captured_power (or another action), or -ListenOnly to record without updating a command.'}
if($CarrierKHz -lt 20 -or $CarrierKHz -gt 60){throw 'CarrierKHz must be between 20 and 60. The receiver cannot measure this value.'}
$taskTool=Join-Path $PSScriptRoot 'signal-tool.mjs'
if(!$ListenOnly){
  Get-Command node -ErrorAction Stop | Out-Null
  if(Test-Path -LiteralPath $File){
    & node $taskTool validate --file $File
    if($LASTEXITCODE -ne 0){throw 'Existing library is invalid. It was not changed.'}
    $taskExisting=Get-Content -LiteralPath $File -Raw | ConvertFrom-Json
    if(($taskExisting.commands | Where-Object name -eq $Name) -and !$Replace){throw "The library already contains $Name. Add -Replace to recapture this action."}
  }
}
$taskLogs=[IO.Path]::GetFullPath($LogDirectory)
[IO.Directory]::CreateDirectory($taskLogs) | Out-Null
$taskStamp=[DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff')
$taskCapturePath=Join-Path $taskLogs "captures-$taskStamp.jsonl"
$taskSerialPath=Join-Path $taskLogs "serial-$taskStamp.log"
$taskRecordPath=Join-Path $taskLogs "latest-$taskStamp.json"
$taskEncoding=New-Object System.Text.UTF8Encoding($false)
$taskCaptureWriter=New-Object IO.StreamWriter($taskCapturePath,$false,$taskEncoding)
$taskSerialWriter=New-Object IO.StreamWriter($taskSerialPath,$false,$taskEncoding)
$taskCaptureWriter.AutoFlush=$true;$taskSerialWriter.AutoFlush=$true
$taskSerial=New-Object IO.Ports.SerialPort($Port,115200,[IO.Ports.Parity]::None,8,[IO.Ports.StopBits]::One)
$taskSerial.ReadTimeout=500;$taskSerial.ReadBufferSize=65536;$taskSerial.DtrEnable=$false;$taskSerial.RtsEnable=$false
$taskSaved=$false;$taskCount=0
try {
  $taskSerial.Open()
  Write-Host "Receiver on $Port. Close Arduino Serial Monitor before using this tool."
  Write-Host "Captures are logged to $taskCapturePath"
  if($ListenOnly){Write-Host "Recording for $Seconds seconds. No named commands will be changed."}
  else {Write-Host "Point the original remote at the RECEIVER and press the button for $Name once. Carrier assumed/specified: $CarrierKHz kHz."}
  $taskDeadline=[DateTime]::UtcNow.AddSeconds($Seconds)
  while([DateTime]::UtcNow -lt $taskDeadline){
    try{$taskLine=$taskSerial.ReadLine().Trim()}catch [TimeoutException]{continue}
    $taskSerialWriter.WriteLine($taskLine)
    if(!$taskLine.StartsWith('{')){continue}
    try{$taskRecord=$taskLine | ConvertFrom-Json -ErrorAction Stop}catch{Write-Warning 'Incomplete or non-JSON serial line retained in serial log.';continue}
    if($taskRecord.type -ne 'capture'){continue}
    $taskCaptureWriter.WriteLine($taskLine);$taskCount++
    if($ListenOnly){Write-Host "Capture $taskCount logged ($($taskRecord.protocol)).";continue}
    [IO.File]::WriteAllText($taskRecordPath,$taskLine,$taskEncoding)
    $taskArguments=@($taskTool,'add','--record',$taskRecordPath,'--name',$Name,'--carrier',[string]$CarrierKHz,'--file',$File)
    if($Replace){$taskArguments+='--replace'}
    & node @taskArguments
    if($LASTEXITCODE -eq 0){$taskSaved=$true;break}
    Write-Warning 'Capture retained in the log but not installed. Release the button and try another single press.'
  }
} finally {
  if($taskSerial.IsOpen){$taskSerial.Close()}
  $taskSerial.Dispose();$taskCaptureWriter.Dispose();$taskSerialWriter.Dispose()
}
if(!$ListenOnly -and !$taskSaved){throw "No usable capture saved in $Seconds seconds. $taskCount captures were logged; the existing command was not changed."}
if($taskSaved){Write-Host 'Signal saved on the computer. Upload signals.json to the transmitter using its web page or signal-tool.mjs upload.'}
