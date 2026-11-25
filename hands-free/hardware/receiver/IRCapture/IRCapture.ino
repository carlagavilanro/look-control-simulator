#include <Arduino.h>
#include <ArduinoJson.h>
#include <IRremoteESP8266.h>
#include <IRrecv.h>
#include <IRutils.h>
#include "Config.h"
#include "CaptureStore.h"
#include "CloudReceiver.h"

// Capture board only. Automatically saves locally, with no computer or Wi-Fi.
// With Wi-Fi set (from the website's Boards and Wi-Fi page, or Config.h) it also sends what it
// saved to the website: CloudReceiver.h.
IRrecv receiver(IR_RECEIVER_PIN, CAPTURE_BUFFER_SIZE, CAPTURE_TIMEOUT_MS, true);
decode_results results;
uint32_t captureSequence = 0;
String serialCommand;
bool serialCommandOverflow = false;

void handleSerialCommands() {
  while(Serial.available()) {
    const char value = static_cast<char>(Serial.read());
    if(value == '\r') continue;
    if(value != '\n') {
      // 400: room for a request from the website's Boards and Wi-Fi page (a line of JSON).
      if(serialCommand.length() < 400 && !serialCommandOverflow) serialCommand += value;
      else serialCommandOverflow = true;
      continue;
    }
    if(!serialCommandOverflow) {
      serialCommand.trim();
      if(serialCommand.startsWith("{")) {
        if(!cloud::usbCommand(serialCommand, "receiver")) Serial.println("{\"type\":\"error\",\"message\":\"Unknown receiver request\"}");
      }
      else if(serialCommand == "STATUS") printCaptureStatus();
      else if(serialCommand == "CLOUD") printWebsiteStatus();
      else if(serialCommand == "EXPORT") {
        receiver.disableIRIn(); exportCaptures(); receiver.enableIRIn();
      } else if(serialCommand == "ERASE SAVED CAPTURES") {
        receiver.disableIRIn(); clearCaptures(); receiver.enableIRIn();
      } else if(serialCommand.length()) Serial.println("{\"type\":\"error\",\"message\":\"Unknown receiver command\"}");
    }
    serialCommand = ""; serialCommandOverflow = false;
  }
}

void setup() {
  Serial.begin(115200);
  // No wait for Serial, camera, network or a capture script.
  beginCaptureStorage();
  receiver.setUnknownThreshold(6);
  receiver.enableIRIn();
  printCaptureStatus();
  beginWebsite();
}

void loop() {
  handleSerialCommands();
  handleWebsite();
  if (receiver.decode(&results)) {
    websiteNoteSignal();
    JsonDocument capture;
    capture["type"] = "capture";
    capture["schema"] = 1;
    capture["sequence"] = ++captureSequence;
    capture["uptime_ms"] = millis();
    capture["protocol"] = typeToString(results.decode_type);
    capture["decoded_hex"] = resultToHexidecimal(&results);
    capture["bits"] = results.bits;
    capture["address"] = results.address;
    capture["command"] = results.command;
    capture["receiver_pin"] = IR_RECEIVER_PIN;
    capture["leading_gap_us"] = results.rawlen ? static_cast<uint32_t>(results.rawbuf[0]) * kRawTick : 0;
    capture["repeat"] = results.repeat;
    capture["overflow"] = results.overflow;
    capture["library"] = _IRREMOTEESP8266_VERSION_STR;
    capture["carrier_khz"] = nullptr; // A demodulating receiver does not measure the carrier.
    JsonArray raw = capture["raw_us"].to<JsonArray>();
    // Skip rawbuf[0], the idle gap before the signal. Keep original positive
    // microseconds, including long gaps; the transmitter packs these losslessly.
    for (uint16_t i = 1; i < results.rawlen; ++i)
      raw.add(static_cast<uint32_t>(results.rawbuf[i]) * kRawTick);
    // Resume after copying the capture, before potentially slow USB printing.
    receiver.resume();
    if (capture.overflowed()) Serial.println("{\"type\":\"error\",\"message\":\"Capture allocation failed\"}");
    else {
      String reason;
      const bool saved = saveCapture(capture, reason);
      if(saved) websiteNoteSaved(capture["capture_id"].as<uint32_t>());
      capture["saved"] = saved;
      if(!saved) {
        capture.remove("capture_id");
        capture["save_error"] = reason;
      }
      // Live USB capture remains compatible with the existing capture.ps1.
      serializeJson(capture, Serial); Serial.println();
    }
  }
  delay(2);
}
