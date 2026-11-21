#pragma once
// Manual tests replay the seven immutable bundled fan captures. Existing
// /signals.json and /signals.bak libraries are preserved for the Wi-Fi API.
// Nothing is sent automatically at boot or in a timed test sequence.

constexpr const char* FAN_TEST_NAMES[] = {
  "captured_power", "captured_level_down", "captured_level_up",
  "captured_mode", "captured_silence", "captured_turn", "captured_timer"
};
constexpr const char* FAN_TEST_LABELS[] = {
  "Power toggle", "Speed down", "Speed up", "Change mode",
  "Silence", "Oscillation / turn", "Timer"
};
constexpr size_t FAN_TEST_COUNT = sizeof(FAN_TEST_NAMES) / sizeof(FAN_TEST_NAMES[0]);
std::vector<StoredSignal> bundledFanTests;
bool fanTestsReady = false;

void printFanTestMenu() {
  Serial.println();
  Serial.println("HANDS FREE - SEVEN FAN COMMAND TEST");
  Serial.println(PRACTICE_MODE ? "Practice mode ON: no infrared output." : "Practice mode OFF: LIVE infrared output.");
  Serial.printf("Transmitter signal pin: GPIO %d. Serial Monitor: 115200 baud.\n", IR_TRANSMITTER_PIN);
  for (size_t i=0; i<FAN_TEST_COUNT; ++i)
    Serial.printf("  %u = %s\n", static_cast<unsigned>(i+1), FAN_TEST_LABELS[i]);
  Serial.println("Send ONE number (1-7). H or ? shows this menu again.");
  Serial.println("Keep the transmitter aimed at the fan. No automatic repeats.");
}

void beginFanTest() {
  JsonDocument doc;
  const auto parsed = deserializeJson(doc, FPSTR(DEFAULT_SIGNALS));
  String error;
  if (parsed || !decodeLibrary(doc, bundledFanTests, error)) {
    Serial.println("Bundled fan commands could not be loaded: " + error);
    return;
  }
  for (size_t i=0; i<FAN_TEST_COUNT; ++i) {
    bool found=false;
    for (const auto& item : bundledFanTests) if (item.name == FAN_TEST_NAMES[i]) { found=true; break; }
    if (!found) { Serial.println("A bundled fan command is missing."); return; }
  }
  fanTestsReady=true;
  printFanTestMenu();
}

void sendFanTest(size_t index) {
  if (!fanTestsReady || index >= FAN_TEST_COUNT) { Serial.println("Fan test library unavailable."); return; }
  if (hasCommand && millis()-lastCommandAt < 800) {
    Serial.println("Wait a moment, then send the number again. Nothing was queued.");
    return;
  }
  const StoredSignal* selected=nullptr;
  for (const auto& item : bundledFanTests) if (item.name == FAN_TEST_NAMES[index]) { selected=&item; break; }
  if (!selected) { Serial.println("Fan command unavailable."); return; }
  lastCommandAt=millis(); hasCommand=true;
  if (PRACTICE_MODE) { Serial.println("Practice only: " + selected->name); return; }
  transmitter.sendRaw(selected->raw.data(),static_cast<uint16_t>(selected->raw.size()),selected->carrier);
  Serial.print("SENT: "); Serial.print(FAN_TEST_LABELS[index]);
  Serial.print(" | "); Serial.print(selected->name);
  Serial.printf(" | %u kHz. Check the fan response.\n", selected->carrier);
}

void handleSerialFanTest() {
  while (Serial.available()) {
    const char key=static_cast<char>(Serial.read());
    if (key >= '1' && key <= '7') sendFanTest(static_cast<size_t>(key-'1'));
    else if (key == '?' || key == 'h' || key == 'H') printFanTestMenu();
    // Both CR and LF are ignored; any Serial Monitor line-ending setting works.
  }
}
