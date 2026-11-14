# Add the real TV remote signals

TV command handling is ready in the included website, gateway and transmitter. No TV brand, model or real timing capture was supplied, so there are no guessed TV codes in this package.

| Button | Capture name |
| --- | --- |
| Power toggle | `tv_power` |
| Volume down | `tv_volume_down` |
| Volume up | `tv_volume_up` |
| Mute | `tv_mute` |
| Channel down | `tv_channel_down` |
| Channel up | `tv_channel_up` |
| Input | `tv_input` |

## Capture and install

1. Upload the receiver sketch to its own ESP32 and connect the IR receiver output to GPIO 15. Close Arduino Serial Monitor.
2. Open PowerShell in `hardware`. Substitute the actual receiver port for COM3 and capture one button at a time:

```powershell
.\tools\capture.ps1 -Port COM3 -Name tv_power
.\tools\capture.ps1 -Port COM3 -Name tv_volume_down
.\tools\capture.ps1 -Port COM3 -Name tv_volume_up
.\tools\capture.ps1 -Port COM3 -Name tv_mute
.\tools\capture.ps1 -Port COM3 -Name tv_channel_down
.\tools\capture.ps1 -Port COM3 -Name tv_channel_up
.\tools\capture.ps1 -Port COM3 -Name tv_input
```

Run each line, point the original remote at the receiver, and press the matching button once. Use `-Replace` when replacing a previously saved name. The default carrier is 38 kHz; the receiver does not measure carrier frequency. Set `-CarrierKHz` to the remote's specified carrier if different.

3. Validate and upload the resulting file using the transmitter's web page or the verified upload tool. From `hardware`, after setting the private website configuration:

```powershell
node .\tools\signal-tool.mjs upload --file .\signals\signals.json --config ..\website\config.local.json
```

4. Reconnect the website using Connect so it refreshes the loaded command list. Select TV. Each captured action becomes available independently; missing actions stay disabled and are skipped during eye navigation. The gateway checks the loaded list again before forwarding a TV action.
5. Point the transmitter at the TV and perform a deliberate test. Practice mode emits no IR. Once the file is transferred, the receiver can be unplugged; the transmitter keeps the file in flash.

Power is a toggle, and Input advances according to the original remote's behavior. There is no TV state feedback. A successful send acknowledgement means the controller sent the signal, not that the TV responded; check the appliance before retrying an uncertain command.

## Relevant code

- `website/public/app.mjs`: TV button names, availability, device switching and five-second selection.
- `website/server.mjs`: named-command allowlist and missing-capture rejection.
- `hardware/transmitter/IRTransmitter/IRTransmitter.ino`: loaded-name status and generic stored-signal transmission.
- `hardware/tools/capture.ps1`: capture-to-file workflow.
- `website/test/tv-gateway.test.mjs`: gateway checks using a mock controller.

The existing fan timing records are unchanged. A capture from the fan is never reused as a TV signal.
