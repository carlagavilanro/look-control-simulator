#pragma once
// Website link, shared by the receiver and transmitter sketches (the same file in both folders).
//
// The board connects OUT to the website over HTTPS. Nothing connects in to the board, so it
// works behind an ordinary home router with no settings changed there.
//
// Linking, once per board:
//   1. The board asks the website for a link code and shows it in the Serial Monitor.
//   2. You sign in on the website, open Setup and type the six digits.
//   3. The website gives this board a key of its own. The key is kept in the board's flash,
//      not in any file on your computer, and is never printed.
// Removing the board on the Setup page makes the key worthless; the board then shows a new code.
//
// Everything here runs in its own task, so the main loop (infrared, USB commands) never waits
// for the network. Text for the Serial Monitor is queued here and printed by the main loop.
//
// Needs before it is included:   #define FIRMWARE_NAME "..."
// Needs from Config.h:           WIFI_SSID, WIFI_PASSWORD, CLOUD_HOST, CLOUD_VERIFY_CERTIFICATE
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include "CloudCert.h"

namespace cloud {

constexpr size_t MESSAGE_SLOTS = 6;
constexpr int NO_WIFI = -100, BAD_ADDRESS = -101;

SemaphoreHandle_t messageLock = nullptr;
String messages[MESSAGE_SLOTS];
size_t messageFirst = 0, messageCount = 0;

String key;                  // this board's key for the website; empty until linked
String pairSecret;           // used only by the link task, while a code is waiting to be typed
char pairCode[8] = "";       // the six digits being shown, or empty
uint32_t pairStartedAt = 0, lastReminderAt = 0, lastTroubleAt = 0;
uint8_t refusals = 0;
bool troubleSaid = false, timeAsked = false;
WiFiClientSecure secure;
HTTPClient http;

bool wifiConfigured() { return strlen(WIFI_SSID) > 0 && strncmp(WIFI_SSID, "CHANGE_ME", 9) != 0; }
bool linked() { return key.length() == 43; }
void wait(uint32_t milliseconds) { vTaskDelay(pdMS_TO_TICKS(milliseconds)); }

// Queue a line for the main loop to print. A full queue drops the new line, never an old one.
void say(const String& text) {
  if (!messageLock || xSemaphoreTake(messageLock, pdMS_TO_TICKS(200)) != pdTRUE) return;
  if (messageCount < MESSAGE_SLOTS) { messages[(messageFirst + messageCount) % MESSAGE_SLOTS] = text; ++messageCount; }
  xSemaphoreGive(messageLock);
}
bool takeMessage(String& text) {
  if (!messageLock || xSemaphoreTake(messageLock, 0) != pdTRUE) return false;
  const bool any = messageCount > 0;
  if (any) { text = messages[messageFirst]; messages[messageFirst] = ""; messageFirst = (messageFirst + 1) % MESSAGE_SLOTS; --messageCount; }
  xSemaphoreGive(messageLock);
  return any;
}

String codeLine() {
  String shown = pairCode;
  return String("LINK CODE ") + shown.substring(0, 3) + " " + shown.substring(3) + "  -  sign in at https://" + CLOUD_HOST + "/setup and type it under \"Link a board\". The code lasts ten minutes.";
}
String status() {
  if (!wifiConfigured()) return "Website link is off: fill in the Wi-Fi name and password in Config.h to use it.";
  if (WiFi.status() != WL_CONNECTED) return String("Connecting to Wi-Fi \"") + WIFI_SSID + "\" (2.4 GHz networks only).";
  if (linked()) return String("Linked to ") + CLOUD_HOST + ".";
  if (pairCode[0]) return codeLine();
  return String("Asking ") + CLOUD_HOST + " for a link code.";
}
// While a code is waiting, repeat it every 30 seconds so it is on screen whenever the Serial
// Monitor is opened.
bool reminder(String& text) {
  if (linked() || !pairCode[0] || millis() - lastReminderAt < 30000) return false;
  lastReminderAt = millis(); text = codeLine(); return true;
}

void remember(const String& fresh) {
  Preferences store;
  if (store.begin("hf-cloud", false)) { store.putString("key", fresh); store.end(); }
  key = fresh;
}
void forget() {
  Preferences store;
  if (store.begin("hf-cloud", false)) { store.remove("key"); store.end(); }
  key = "";
}

// Say what is wrong, at most once a minute.
void trouble(int status, const char* doing) {
  if (troubleSaid && millis() - lastTroubleAt < 60000) return;
  troubleSaid = true; lastTroubleAt = millis();
  String text = String("Could not ") + doing + " at " + CLOUD_HOST + ": ";
  if (status == NO_WIFI) text += "Wi-Fi is not connected.";
  else if (status == BAD_ADDRESS) text += "CLOUD_HOST in Config.h is not a usable address.";
  else if (status < 0) {
    text += HTTPClient::errorToString(status) + ".";
    if (CLOUD_VERIFY_CERTIFICATE) text += " If this never clears, the website's certificate may have changed: see CloudCert.h.";
  } else text += String("the website answered ") + status + ".";
  say(text + " Trying again.");
}
void accepted() { refusals = 0; troubleSaid = false; }
// The website refused the key. Three refusals in a row mean this board was removed on the Setup
// page: forget the key and show a new code.
void refused() {
  if (++refusals >= 3) { refusals = 0; forget(); say("The website no longer knows this board. It will show a new link code."); }
  else wait(5000);
}

// One HTTPS request. Returns the HTTP status (200, 204, 401, ...), or a negative number when
// the website could not be reached. A connection is kept open between requests; one that has
// gone stale is reopened once.
int request(const char* method, const String& path, const String& body, String& answer, uint16_t timeoutMs,
            bool withKey = true, const char* headerName = nullptr, const String& headerValue = String()) {
  answer = "";
  int status = NO_WIFI;
  for (uint8_t attempt = 0; attempt < 2; ++attempt) {
    if (WiFi.status() != WL_CONNECTED) return NO_WIFI;
    if (!http.begin(secure, String("https://") + CLOUD_HOST + path)) return BAD_ADDRESS;
    http.setReuse(true);
    http.setConnectTimeout(12000);
    http.setTimeout(timeoutMs);
    http.addHeader("X-Firmware", FIRMWARE_NAME);
    if (withKey && linked()) http.addHeader("Authorization", String("Bearer ") + key);
    if (headerName) http.addHeader(headerName, headerValue);
    if (strcmp(method, "GET") == 0) status = http.GET();
    else { http.addHeader("Content-Type", "application/json"); status = http.POST(body); }
    if (status > 0 && status != 204) answer = http.getString();
    http.end();
    if (status > 0) return status;
    secure.stop();
  }
  return status;
}

// Link this board to the website. Call it again and again until it returns true; it waits
// between its own steps.
bool link(const char* kind) {
  String answer;
  if (pairSecret.length() == 0 || millis() - pairStartedAt > 9UL * 60UL * 1000UL) {
    pairCode[0] = 0; pairSecret = "";
    JsonDocument ask;
    ask["kind"] = kind; ask["firmware"] = FIRMWARE_NAME;
    String body; serializeJson(ask, body);
    const int status = request("POST", "/api/pair/start", body, answer, 15000, false);
    JsonDocument got;
    if (status != 200 || deserializeJson(got, answer) || !got["code"].is<const char*>() || !got["secret"].is<const char*>() || strlen(got["code"].as<const char*>()) != 6) {
      trouble(status, "ask for a link code");
      wait(status == 429 ? 120000 : 20000);
      return false;
    }
    troubleSaid = false;
    pairSecret = got["secret"].as<const char*>();
    strlcpy(pairCode, got["code"].as<const char*>(), sizeof(pairCode));
    pairStartedAt = millis(); lastReminderAt = millis();
    say(codeLine());
  }
  wait(3000);
  JsonDocument ask;
  ask["secret"] = pairSecret;
  String body; serializeJson(ask, body);
  const int status = request("POST", "/api/pair/claim", body, answer, 15000, false);
  if (status == 202) return false;                       // the code has not been typed yet
  if (status == 404) { pairCode[0] = 0; pairSecret = ""; return false; }   // it ran out: a new code follows
  if (status != 200) { trouble(status, "finish linking"); wait(10000); return false; }
  JsonDocument got;
  const bool readable = !deserializeJson(got, answer) && got["token"].is<const char*>() && strlen(got["token"].as<const char*>()) == 43;
  pairCode[0] = 0; pairSecret = "";
  if (!readable) return false;
  remember(String(got["token"].as<const char*>()));
  const char* name = got["name"] | "this board";
  say(String("Linked to ") + CLOUD_HOST + " as \"" + name + "\".");
  return true;
}

// Called once from setup(), before the link task is started.
void begin() {
  messageLock = xSemaphoreCreateMutex();
  Preferences store;
  if (store.begin("hf-cloud", false)) { key = store.getString("key", ""); store.end(); }
  if (CLOUD_VERIFY_CERTIFICATE) secure.setCACert(CLOUD_ROOT_CERTIFICATES);
  else secure.setInsecure();
}

// True when Wi-Fi is up. The first time, also asks the network for the time of day (some builds
// check certificate dates). Only ever called from the link task, after Wi-Fi has started.
bool online() {
  if (WiFi.status() != WL_CONNECTED) return false;
  if (!timeAsked) { timeAsked = true; configTime(0, 0, "pool.ntp.org", "time.nist.gov"); }
  return true;
}

// The link task: 16 KB of stack (HTTPS needs it), on the processor core the Wi-Fi uses, so the
// main loop's infrared timing is left alone.
bool start(TaskFunction_t task) {
  return xTaskCreatePinnedToCore(task, "website", 16384, nullptr, 1, nullptr, 0) == pdPASS;
}

}  // namespace cloud
