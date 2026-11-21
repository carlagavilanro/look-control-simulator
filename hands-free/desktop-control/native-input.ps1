param([switch]$DryRun,[int]$OwnerPid)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class EyeInput {
 [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public UNION u; }
 [StructLayout(LayoutKind.Explicit)] public struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
 [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx,dy; public uint mouseData,dwFlags,time; public UIntPtr dwExtraInfo; }
 [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk,wScan; public uint dwFlags,time; public UIntPtr dwExtraInfo; }
 [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count, INPUT[] inputs,int size);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr handle);
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr handle);
 [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr handle);
 [DllImport("user32.dll")] static extern bool IsIconic(IntPtr handle);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr handle,StringBuilder value,int capacity);
 [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr handle);
 delegate bool WindowCallback(IntPtr handle,IntPtr data);
 [DllImport("user32.dll")] static extern bool EnumWindows(WindowCallback callback,IntPtr data);
 public static bool AppWindow(IntPtr handle,int owner){
  uint pid;GetWindowThreadProcessId(handle,out pid);var name=new StringBuilder(256);GetClassName(handle,name,256);
  return IsWindow(handle)&&IsWindowVisible(handle)&&!IsIconic(handle)&&pid!=(uint)owner&&GetWindowTextLength(handle)>0&&name.ToString()!="Shell_TrayWnd"&&name.ToString()!="Shell_SecondaryTrayWnd"&&name.ToString()!="Progman"&&name.ToString()!="WorkerW";
 }
 public static IntPtr AppBehind(int owner){var result=IntPtr.Zero;EnumWindows((h,d)=>{if(AppWindow(h,owner)){result=h;return false;}return true;},IntPtr.Zero);return result;}
 [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
 [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
 public static void Init(){SetProcessDPIAware();}
 static void Send(INPUT[] i){if(SendInput((uint)i.Length,i,Marshal.SizeOf(typeof(INPUT)))!=i.Length)throw new Exception("Windows did not accept this input. Elevated and secure windows are not supported.");}
 static INPUT K(ushort key,bool up){return new INPUT{type=1,u=new UNION{ki=new KEYBDINPUT{wVk=key,dwFlags=up?2u:0u}}};}
 public static void Key(ushort key){Send(new INPUT[]{K(key,false),K(key,true)});}
 public static void Chord(ushort mod,ushort key){Send(new INPUT[]{K(mod,false),K(key,false),K(key,true),K(mod,true)});}
 public static void Text(string value){foreach(char c in value){Send(new INPUT[]{new INPUT{type=1,u=new UNION{ki=new KEYBDINPUT{wScan=c,dwFlags=4}}},new INPUT{type=1,u=new UNION{ki=new KEYBDINPUT{wScan=c,dwFlags=6}}}});}}
 public static void Click(double x,double y){
  if(!SetCursorPos((int)Math.Round(x*(GetSystemMetrics(0)-1)),(int)Math.Round(y*(GetSystemMetrics(1)-1))))throw new Exception("Cursor could not move");
  Send(new INPUT[]{new INPUT{type=0,u=new UNION{mi=new MOUSEINPUT{dwFlags=2}}},new INPUT{type=0,u=new UNION{mi=new MOUSEINPUT{dwFlags=4}}}});
 }
 public static void Scroll(int amount){Send(new INPUT[]{new INPUT{type=0,u=new UNION{mi=new MOUSEINPUT{mouseData=unchecked((uint)(amount*120)),dwFlags=0x800}}}});}
}
'@
[EyeInput]::Init()
$returnWindow = [EyeInput]::GetForegroundWindow()
[Console]::WriteLine('{"ready":true}')
while ($null -ne ($line = [Console]::ReadLine())) {
 try {
  if ($line.Length -gt 12000) { throw 'Request too large' }
  $p = $line | ConvertFrom-Json
  if ($p.type -eq 'remember') { $currentWindow=[EyeInput]::GetForegroundWindow(); if ([EyeInput]::AppWindow($currentWindow,$OwnerPid)) { $returnWindow=$currentWindow } }
  elseif ($p.type -eq 'target') { if (-not [EyeInput]::AppWindow($returnWindow,$OwnerPid)) { $returnWindow=[EyeInput]::AppBehind($OwnerPid) }; if ($returnWindow -eq [IntPtr]::Zero) { throw 'Choose an open app first.' }; [Console]::WriteLine((@{id=$p.id;ok=$true;window=[string]$returnWindow.ToInt64()} | ConvertTo-Json -Compress)); continue }
  elseif ($p.type -eq 'restore') { if (-not $DryRun) { if (-not [EyeInput]::AppWindow($returnWindow,$OwnerPid)) { throw 'Choose an open app first.' }; [void][EyeInput]::SetForegroundWindow($returnWindow); if ([EyeInput]::GetForegroundWindow() -ne $returnWindow) { throw 'The app could not receive keyboard focus.' } } }
  elseif ($p.type -eq 'click') { if ($p.x -lt 0 -or $p.x -gt 1 -or $p.y -lt 0 -or $p.y -gt 1) { throw 'Invalid position' }; if (-not $DryRun) { [EyeInput]::Click($p.x,$p.y) } }
  elseif ($p.type -eq 'scroll') { if ([Math]::Abs($p.amount) -gt 5) { throw 'Invalid scroll' }; if (-not $DryRun) { [EyeInput]::Scroll($p.amount) } }
  elseif ($p.type -eq 'text') { if ($p.text.Length -gt 1000 -or $p.text -match '[\x00-\x1f\x7f]' -or ($null -ne $p.submit -and $p.submit -isnot [bool])) { throw 'Invalid text' }; if (-not $DryRun) { [EyeInput]::Text($p.text); if ($p.submit -eq $true) { [EyeInput]::Key(13) } } }
  elseif ($p.type -eq 'key') {
   $keys = @{enter=13;tab=9;backspace=8;escape=27;pageup=33;pagedown=34;home=36;end=35}
   if ($keys.ContainsKey($p.key)) { if (-not $DryRun) { [EyeInput]::Key($keys[$p.key]) } }
   elseif ($p.key -eq 'shifttab') { if (-not $DryRun) { [EyeInput]::Chord(16,9) } }
   elseif ($p.key -eq 'back') { if (-not $DryRun) { [EyeInput]::Chord(18,37) } }
   elseif ($p.key -eq 'forward') { if (-not $DryRun) { [EyeInput]::Chord(18,39) } }
   elseif ($p.key -eq 'address') { if (-not $DryRun) { [EyeInput]::Chord(17,76) } }
   elseif ($p.key -eq 'start') { if (-not $DryRun) { [EyeInput]::Key(91) } }
   elseif ($p.key -eq 'nextapp') { if (-not $DryRun) { [EyeInput]::Chord(18,27) } }
   elseif ($p.key -eq 'lastapp') { if (-not $DryRun) { [EyeInput]::Chord(18,9) } }
   elseif ($p.key -eq 'notifications') { if (-not $DryRun) { if ([Environment]::OSVersion.Version.Build -ge 22000) { [EyeInput]::Chord(91,78) } else { [EyeInput]::Chord(91,65) } } }
   else { throw 'Unsupported key' }
  } else { throw 'Unsupported command' }
  [Console]::WriteLine((@{id=$p.id;ok=$true;dryRun=[bool]$DryRun} | ConvertTo-Json -Compress))
 } catch { [Console]::WriteLine((@{id=$p.id;ok=$false;error=$_.Exception.Message} | ConvertTo-Json -Compress)) }
}
