param([switch]$DryRun,[int]$OwnerPid)
$ErrorActionPreference='Stop'
[Console]::InputEncoding=New-Object System.Text.UTF8Encoding
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class EyeAccessibleWindow {
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd,StringBuilder value,int capacity);
 public static bool IsApp(IntPtr hwnd){var name=new StringBuilder(256);GetClassName(hwnd,name,256);return name.ToString()!="Shell_TrayWnd"&&name.ToString()!="Shell_SecondaryTrayWnd"&&name.ToString()!="Progman"&&name.ToString()!="WorkerW";}
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
 [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd,uint flag);
 [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
 public static void Init(){SetProcessDPIAware();}
}
'@
[EyeAccessibleWindow]::Init()
$entries=@{};$window=[IntPtr]::Zero;$windowPid=0;$scope=0
$types=@('Button','Hyperlink','Edit','CheckBox','RadioButton','ComboBox','ListItem','MenuItem','TabItem','TreeItem')
function Valid-Window([IntPtr]$handle) {
 [uint32]$owner=0;[void][EyeAccessibleWindow]::GetWindowThreadProcessId($handle,[ref]$owner)
 return $handle -ne [IntPtr]::Zero -and [EyeAccessibleWindow]::IsWindow($handle) -and [EyeAccessibleWindow]::IsWindowVisible($handle) -and [EyeAccessibleWindow]::IsApp($handle) -and $owner -ne $OwnerPid -and $owner -gt 0
}
function Bounds($element) {
 $b=$element.Current.BoundingRectangle
 return @{left=$b.Left;top=$b.Top;right=$b.Right;bottom=$b.Bottom}
}
[Console]::WriteLine('{"ready":true}')
while($null -ne ($line=[Console]::ReadLine())) {
 try {
  if($line.Length -gt 3000){throw 'Request too large'}
  $p=$line|ConvertFrom-Json
  if($p.type -eq 'snapshot') {
   $handle=[IntPtr]([long]$p.window)
   $foreground=[EyeAccessibleWindow]::GetForegroundWindow();[uint32]$foregroundPid=0
   [void][EyeAccessibleWindow]::GetWindowThreadProcessId($foreground,[ref]$foregroundPid)
   if($foregroundPid -ne $OwnerPid -and (Valid-Window $foreground)){$handle=[EyeAccessibleWindow]::GetAncestor($foreground,2)}
   if(-not (Valid-Window $handle)){throw 'Choose an open app first.'}
   [uint32]$pidNow=0;[void][EyeAccessibleWindow]::GetWindowThreadProcessId($handle,[ref]$pidNow)
   if($window -ne $handle -or $windowPid -ne $pidNow){$scope++;$window=$handle;$windowPid=$pidNow}
   $root=[System.Windows.Automation.AutomationElement]::FromHandle($handle)
   $conditions=[System.Windows.Automation.Condition[]]@(
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::IsKeyboardFocusableProperty,$true)),
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::IsEnabledProperty,$true)),
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::IsOffscreenProperty,$false))
   )
   $filter=New-Object System.Windows.Automation.AndCondition(,$conditions)
   # Search this app only, never the desktop's complete descendant tree.
   $found=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,$filter)
   $next=@{};$targets=New-Object System.Collections.Generic.List[object];$geometry=@{}
   foreach($element in $found) {
    if($targets.Count -ge 200){break}
    try {
     $kind=$element.Current.ControlType.ProgrammaticName.Replace('ControlType.','')
     if($types -notcontains $kind -or $element.Current.IsPassword){continue}
     $bounds=Bounds $element
     if($bounds.right-$bounds.left -lt 4 -or $bounds.bottom-$bounds.top -lt 4){continue}
     $id=($element.GetRuntimeId()-join '-');if(-not $id -or $id.Length -gt 180){continue}
     $shape=($bounds.left,$bounds.top,$bounds.right,$bounds.bottom)-join ','
     if($geometry.ContainsKey($shape)){continue};$geometry[$shape]=$true
     $name=$element.Current.Name;if($name.Length -gt 100){$name=$name.Substring(0,100)}
     $next[$id]=@{element=$element;bounds=$bounds;at=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds();kind=$kind}
     $targets.Add(@{id=$id;label=$name;kind=$kind;rect=$bounds;enabled=$true})
    }catch{}
   }
   $entries=$next
   [Console]::WriteLine((@{id=$p.id;ok=$true;scope=$scope;window=[string]$window.ToInt64();targets=@($targets.ToArray())}|ConvertTo-Json -Depth 6 -Compress))
  } elseif($p.type -eq 'activate') {
   $now=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
   if($p.expires -lt $now -or $p.expires -gt $now+1000){throw 'Selection expired. Look again.'}
   if($p.scope -ne $scope -or -not (Valid-Window $window)){throw 'The app changed. Look again.'}
   [uint32]$pidNow=0;[void][EyeAccessibleWindow]::GetWindowThreadProcessId($window,[ref]$pidNow)
   if($pidNow -ne $windowPid){throw 'The app changed. Look again.'}
   if(-not $entries.ContainsKey([string]$p.target)){throw 'That control changed. Look again.'}
   $entry=$entries[[string]$p.target];$element=$entry.element
   if($now-$entry.at -gt 3000 -or -not $element.Current.IsEnabled -or $element.Current.IsOffscreen -or $element.Current.IsPassword){throw 'That control is unavailable. Look again.'}
   $current=Bounds $element
   foreach($key in @('left','top','right','bottom')){if([Math]::Abs($current[$key]-$p.rect.$key)-gt 12){throw 'That control moved. Look again.'}}
   # The selected app must still be the app behind our overlay, or the overlay
   # itself. Never activate a stale target over a different foreground app.
   $foreground=[EyeAccessibleWindow]::GetForegroundWindow();[uint32]$foregroundPid=0
   [void][EyeAccessibleWindow]::GetWindowThreadProcessId($foreground,[ref]$foregroundPid)
   if($foregroundPid -ne $OwnerPid -and (Valid-Window $foreground) -and [EyeAccessibleWindow]::GetAncestor($foreground,2) -ne $window){throw 'The active app changed. Look again.'}
   $needsEnter=$false
   if(-not $DryRun) {
    [void][EyeAccessibleWindow]::SetForegroundWindow($window);$element.SetFocus()
    $focused=[System.Windows.Automation.AutomationElement]::FocusedElement
    for($attempt=0;$attempt -lt 10 -and ($focused.GetRuntimeId()-join '-') -ne [string]$p.target;$attempt++){
     Start-Sleep -Milliseconds 15;$focused=[System.Windows.Automation.AutomationElement]::FocusedElement
    }
    if(($focused.GetRuntimeId()-join '-') -ne [string]$p.target){throw 'The control could not receive focus.'}
    if([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -gt $p.expires){throw 'Selection expired. Look again.'}
    if($entry.kind -ne 'Edit') {
     $pattern=$null
     if($element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)){$pattern.Invoke()}
     elseif($element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern,[ref]$pattern)){$pattern.Select()}
     elseif($element.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern,[ref]$pattern)){$pattern.Toggle()}
     elseif($element.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern,[ref]$pattern)){
      if($pattern.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Expanded){$pattern.Collapse()}else{$pattern.Expand()}
     }else{$needsEnter=$true}
    }
   }
   [Console]::WriteLine((@{id=$p.id;ok=$true;dryRun=[bool]$DryRun;edit=($entry.kind -eq 'Edit');needsEnter=$needsEnter}|ConvertTo-Json -Compress))
  }else{throw 'Unsupported accessibility request'}
 }catch{[Console]::WriteLine((@{id=$p.id;ok=$false;error=$_.Exception.Message}|ConvertTo-Json -Compress))}
}
