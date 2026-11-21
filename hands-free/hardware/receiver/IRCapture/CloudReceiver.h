#pragma once
// Sends the receiver's saved recordings to the website.
//
// Included by IRCapture.ino after CaptureStore.h. Recording itself is unchanged: every usable
// signal is still saved in the receiver's own storage first, with or without Wi-Fi, and nothing
// is ever deleted from the receiver by sending it. The USB commands and capture.ps1 work as
// before; lines from this file are JSON too ({"type":"cloud",...}), which those tools skip.
//
// The link task sends saved recordings in order, oldest first, and remembers in flash how far
// it got. Recordings made while offline are sent when the website is next reachable. For a
// recording made a moment ago it also says how long ago, so the website can tell a button
// pressed just now ("Record a button") from older saved ones.
#define FIRMWARE_NAME "IRCapture-cloud-1"
#include "CloudLink.h"

struct RecentCapture { uint32_t id; uint32_t at; };
constexpr size_t RECENT_CAPTURES = 16;
RecentCapture recentCaptures[RECENT_CAPTURES] = {};
volatile uint32_t recentCaptureCount = 0;
volatile uint32_t lastSignalAt = 0;
uint32_t sentThrough = 0;   // every saved recording up to this number has been dealt with

// Called by the main loop for every signal seen, and with the number of a recording just saved.
void websiteNoteSignal() { lastSignalAt = millis(); }
void websiteNoteSaved(uint32_t id) {
  recentCaptures[recentCaptureCount % RECENT_CAPTURES] = {id, static_cast<uint32_t>(millis())};
  recentCaptureCount = recentCaptureCount + 1;
}

void rememberSentThrough() {
  Preferences store;
  if (store.begin("hf-cloud", false)) { store.putUInt("sent", sentThrough); store.end(); }
}

void websiteTask(void*) {
  {
    Preferences store;
    if (store.begin("hf-cloud", false)) { sentThrough = store.getUInt("sent", 0); store.end(); }
  }
  // The saved recordings were erased and their numbering began again: begin again here too.
  if (sentThrough >= nextCaptureId) { sentThrough = nextCaptureId - 1; rememberSentThrough(); }
  for (;;) {
    if (!cloud::online()) { cloud::wait(1000); continue; }
    if (!cloud::linked()) { cloud::link("receiver"); continue; }
    const uint32_t id = sentThrough + 1;
    // Nothing new, or a button is still being held: wait. (A held button repeats its signal.)
    if (!captureStorageReady || id >= nextCaptureId || millis() - lastSignalAt < 1200) { cloud::wait(250); continue; }

    String body;
    File file = LittleFS.open(capturePath(id), "r");
    if (file && !file.isDirectory() && file.size() > 0 && file.size() <= MAX_CAPTURE_RECORD_BYTES) body = file.readString();
    if (file) file.close();
    if (!body.length()) { sentThrough = id; rememberSentThrough(); continue; }   // erased, or not a recording

    String age;
    for (const auto& recent : recentCaptures) if (recent.id == id) age = String(millis() - recent.at);
    String answer;
    const int status = age.length()
      ? cloud::request("POST", "/api/device/recordings", body, answer, 20000, true, "X-Capture-Age-Ms", age)
      : cloud::request("POST", "/api/device/recordings", body, answer, 20000);
    if (status == 200) {
      cloud::accepted(); sentThrough = id; rememberSentThrough();
      cloud::say(String("Recording ") + id + " sent to the website.");
    } else if (status == 401) cloud::refused();
    else if (status == 413 || status == 422) {
      sentThrough = id; rememberSentThrough();
      cloud::say(String("The website did not accept recording ") + id + ". It stays saved on the receiver.");
    } else { cloud::trouble(status, "send a recording"); cloud::wait(5000); }
  }
}

void printWebsiteLine(const String& text) {
  JsonDocument line;
  line["type"] = "cloud"; line["message"] = text;
  serializeJson(line, Serial); Serial.println();
}
void printWebsiteStatus() { printWebsiteLine(cloud::status()); }

// Called once at the end of setup(). Does not wait for the network.
void beginWebsite() {
  if (!cloud::wifiConfigured()) { printWebsiteStatus(); return; }
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  cloud::begin();
  if (!cloud::start(websiteTask)) { printWebsiteLine("Could not start the website link (out of memory). Recording continues."); return; }
  printWebsiteStatus();
}

// Called on every pass of loop(): prints what the link task has to say.
void handleWebsite() {
  String line;
  while (cloud::takeMessage(line)) printWebsiteLine(line);
  if (cloud::reminder(line)) printWebsiteLine(line);
}
