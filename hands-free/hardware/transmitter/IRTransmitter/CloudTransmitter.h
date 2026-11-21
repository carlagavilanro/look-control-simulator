#pragma once
// Commands from the website for the transmitter.
//
// Included by IRTransmitter.ino after SignalStore.h and after its own variables, because it
// uses the same pieces the Wi-Fi and USB commands use: StoredSignal, decodeLibrary(),
// transmitter, lastCommandAt, hasCommand and PRACTICE_MODE.
//
// The link task asks the website "anything to send?" and waits up to 20 seconds for the answer.
// A command arrives as a one-entry signal library, so it passes through decodeLibrary(), the
// same check every stored signal passes. The infrared itself is sent by the main loop, exactly
// as for a USB or Wi-Fi command, with the same 0.8 second gap between commands.
#include <atomic>
#define FIRMWARE_NAME "IRTransmitter-cloud-1"
#include "CloudLink.h"

struct WebsiteCommand { String id, label; StoredSignal signal; };
WebsiteCommand websiteCommand;
// 0 = none, 1 = waiting for the main loop, 2 = the main loop is sending it.
std::atomic<int> websiteCommandState{0};
bool websiteCommandSent = false;
String websiteCommandProblem;
SemaphoreHandle_t websiteCommandHandled = nullptr;

void websiteTask(void*) {
  for (;;) {
    if (!cloud::online()) { cloud::wait(1000); continue; }
    if (!cloud::linked()) { cloud::link("transmitter"); continue; }
    String answer;
    const int status = cloud::request("GET", "/api/device/next?wait=20", "", answer, 30000, true, "X-Practice", PRACTICE_MODE ? "1" : "0");
    if (status == 204) { cloud::accepted(); continue; }      // nothing to send; ask again
    if (status == 401) { cloud::refused(); continue; }
    if (status != 200) { cloud::trouble(status, "ask for commands"); cloud::wait(5000); continue; }
    cloud::accepted();

    JsonDocument doc;
    std::vector<StoredSignal> decoded;
    String problem;
    const bool readable = !deserializeJson(doc, answer) && doc["id"].is<const char*>() && decodeLibrary(doc, decoded, problem) && decoded.size() == 1;
    answer = "";
    const String id = doc["id"] | "";
    if (!id.length()) continue;
    bool sent = false;
    if (readable) {
      websiteCommand.id = id;
      websiteCommand.label = doc["label"] | "command";
      websiteCommand.signal = decoded[0];
      xSemaphoreTake(websiteCommandHandled, 0);              // clear any leftover signal
      websiteCommandState = 1;
      bool handled = xSemaphoreTake(websiteCommandHandled, pdMS_TO_TICKS(5000)) == pdTRUE;
      if (!handled) {
        int waiting = 1;
        // Withdraw it if the main loop has not started on it; otherwise wait for it to finish.
        if (!websiteCommandState.compare_exchange_strong(waiting, 0)) handled = xSemaphoreTake(websiteCommandHandled, pdMS_TO_TICKS(5000)) == pdTRUE;
      }
      if (handled) { sent = websiteCommandSent; problem = websiteCommandProblem; }
      else problem = "The board was busy.";
    } else if (!problem.length()) problem = "The command could not be read.";

    JsonDocument report;
    report["id"] = id; report["ok"] = sent; report["practice"] = PRACTICE_MODE;
    if (!sent) report["message"] = problem;
    String body; serializeJson(report, body);
    cloud::request("POST", "/api/device/done", body, answer, 10000);
  }
}

// Called once at the end of setup(). Wi-Fi itself is started by setup(), as before.
void beginWebsite() {
  if (!cloud::wifiConfigured()) { Serial.println("WEBSITE: " + cloud::status()); return; }
  websiteCommandHandled = xSemaphoreCreateBinary();
  cloud::begin();
  if (!websiteCommandHandled || !cloud::start(websiteTask)) { Serial.println("WEBSITE: could not start the website link (out of memory)."); return; }
  Serial.println("WEBSITE: " + cloud::status());
}

// Called on every pass of loop(): prints what the link task has to say, and sends a waiting
// website command.
void handleWebsite() {
  String line;
  while (cloud::takeMessage(line)) Serial.println("WEBSITE: " + line);
  if (cloud::reminder(line)) Serial.println("WEBSITE: " + line);
  int waiting = 1;
  if (!websiteCommandState.compare_exchange_strong(waiting, 2)) return;
  websiteCommandSent = false; websiteCommandProblem = "";
  if (hasCommand && millis() - lastCommandAt < 800) websiteCommandProblem = "Please wait before another command.";
  else {
    lastCommandAt = millis(); hasCommand = true;
    if (PRACTICE_MODE) Serial.println("PRACTICE command from the website: " + websiteCommand.label + ". No IR signal sent.");
    else {
      Serial.println("IR command from the website: " + websiteCommand.label);
      transmitter.sendRaw(websiteCommand.signal.raw.data(), static_cast<uint16_t>(websiteCommand.signal.raw.size()), websiteCommand.signal.carrier);
    }
    websiteCommandSent = true;
  }
  websiteCommandState = 0;
  xSemaphoreGive(websiteCommandHandled);
}
