#pragma once
#include <LittleFS.h>
#include <Preferences.h>
#include <vector>
#include <algorithm>
#include "Config.h"

bool captureStorageReady = false;
size_t savedCaptureCount = 0, savedCaptureBytes = 0;
uint32_t nextCaptureId = 1;
String storageError;
const char* CAPTURE_DIRECTORY = "/captures";
const char* CAPTURE_STAGING = "/capture.tmp";

String capturePath(uint32_t id) {
  char result[40];
  snprintf(result, sizeof(result), "/captures/%010lu.json", static_cast<unsigned long>(id));
  return String(result);
}

uint32_t pathId(const char* path) {
  const char* base = strrchr(path, '/');
  base = base ? base + 1 : path;
  if(strlen(base) != 15 || strcmp(base + 10, ".json") != 0) return 0;
  uint64_t value = 0;
  for(size_t i = 0; i < 10; ++i) {
    if(base[i] < '0' || base[i] > '9') return 0;
    value = value * 10 + base[i] - '0';
  }
  return value > 0 && value < UINT32_MAX ? static_cast<uint32_t>(value) : 0;
}

bool scanCaptureFiles(std::vector<uint32_t>* ids = nullptr) {
  File directory = LittleFS.open(CAPTURE_DIRECTORY);
  if(!directory || !directory.isDirectory()) return false;
  savedCaptureCount = savedCaptureBytes = 0;
  uint32_t highest = 0;
  for(File file = directory.openNextFile(); file; file = directory.openNextFile()) {
    const uint32_t id = file.isDirectory() ? 0 : pathId(file.name());
    if(id) {
      ++savedCaptureCount;
      savedCaptureBytes += file.size();
      highest = std::max(highest, id);
      if(ids) ids->push_back(id);
    }
    file.close();
  }
  directory.close();
  nextCaptureId = std::max(nextCaptureId, highest + 1);
  if(ids) std::sort(ids->begin(), ids->end());
  return true;
}

void beginCaptureStorage() {
  Preferences marker;
  if(!marker.begin("ir-capture", false)) { storageError = "Cannot open storage marker."; return; }
  const bool attempted = marker.getBool("attempted", false);
  captureStorageReady = LittleFS.begin(false);
  if(!captureStorageReady && !attempted) {
    // Record the first-format attempt BEFORE formatting. Later mount failures
    // must never erase an archive, including after interrupted initialization.
    if(marker.putBool("attempted", true) != 1) {
      storageError = "Cannot protect storage initialization.";
      marker.end(); return;
    }
    captureStorageReady = LittleFS.begin(true);
  } else if(captureStorageReady && !attempted) {
    if(marker.putBool("attempted", true) != 1) captureStorageReady = false;
  }
  marker.end();
  if(!captureStorageReady) { storageError = "Storage mount failed. Existing data was not reformatted."; return; }
  if(!LittleFS.exists(CAPTURE_DIRECTORY) && !LittleFS.mkdir(CAPTURE_DIRECTORY)) {
    captureStorageReady = false; storageError = "Cannot create capture directory."; return;
  }
  if(!scanCaptureFiles()) {
    captureStorageReady = false; storageError = "Cannot read capture directory.";
  }
  // A power failure can leave capture.tmp. It is never counted or exported as
  // a completed record. The next capture replaces only this uncommitted file.
}

bool usableCapture(JsonDocument& doc, String& reason) {
  if(doc["type"] != "capture" || doc["schema"] != 1 ||
     !doc["overflow"].is<bool>() || doc["overflow"].as<bool>() ||
     !doc["repeat"].is<bool>() || doc["repeat"].as<bool>()) {
    reason = "Repeat-only or overflowed capture was not saved."; return false;
  }
  JsonArray timings = doc["raw_us"].as<JsonArray>();
  if(timings.size() < 3 || timings.size() > 2048) { reason = "Invalid timing count."; return false; }
  uint32_t total = 0;
  for(JsonVariant item : timings) {
    if(!item.is<uint32_t>()) { reason = "Invalid timing value."; return false; }
    const uint32_t value = item.as<uint32_t>();
    if(value == 0 || value > 1000000 || total > 1000000 - value) {
      reason = "Capture must contain positive timings totaling at most one second."; return false;
    }
    total += value;
  }
  return true;
}

bool saveCapture(JsonDocument& doc, String& reason) {
  if(!usableCapture(doc, reason)) return false;
  if(!captureStorageReady) { reason = storageError; return false; }
  if(savedCaptureCount >= MAX_SAVED_CAPTURES || nextCaptureId == UINT32_MAX) {
    reason = "Capture limit reached. Download and clear saved captures before recording more."; return false;
  }
  doc["capture_id"] = nextCaptureId;
  doc["saved"] = true;
  String body;
  serializeJson(doc, body);
  if(doc.overflowed() || body.length() > MAX_CAPTURE_RECORD_BYTES) {
    reason = "Capture record exceeds memory or record limit."; return false;
  }
  if(savedCaptureBytes + body.length() > MAX_CAPTURE_STORAGE_BYTES ||
     LittleFS.totalBytes() - LittleFS.usedBytes() < body.length() + STORAGE_RESERVE_BYTES) {
    reason = "Storage is full. Previous captures remain saved. Download and clear before recording more."; return false;
  }
  const String destination = capturePath(nextCaptureId);
  if(LittleFS.exists(destination)) { reason = "Capture ID conflict. Previous file preserved."; return false; }
  File file = LittleFS.open(CAPTURE_STAGING, "w");
  if(!file) { reason = "Cannot create capture file."; return false; }
  const size_t written = file.print(body);
  file.flush(); file.close();
  if(written != body.length()) { reason = "Incomplete capture write."; return false; }
  file = LittleFS.open(CAPTURE_STAGING, "r");
  const bool verified = file && file.size() == body.length() && file.readString() == body;
  file.close();
  if(!verified || !LittleFS.rename(CAPTURE_STAGING, destination)) {
    reason = "Capture could not be verified and committed."; return false;
  }
  ++nextCaptureId; ++savedCaptureCount; savedCaptureBytes += body.length();
  return true;
}

void printCaptureStatus() {
  JsonDocument status;
  status["type"] = "receiver_status";
  status["firmware"] = "IRCapture-autosave-1";
  status["captureArchiveApi"] = 1;
  status["automatic_capture"] = true;
  status["storage_ready"] = captureStorageReady;
  status["saved_count"] = savedCaptureCount;
  status["saved_bytes"] = savedCaptureBytes;
  status["max_captures"] = MAX_SAVED_CAPTURES;
  status["max_bytes"] = MAX_CAPTURE_STORAGE_BYTES;
  status["receiver_pin"] = IR_RECEIVER_PIN;
  if(storageError.length()) status["storage_error"] = storageError;
  serializeJson(status, Serial); Serial.println();
}

// Caller briefly suspends IR reception during export or explicit deletion.
void exportCaptures() {
  std::vector<uint32_t> ids;
  if(!captureStorageReady || !scanCaptureFiles(&ids)) {
    Serial.println("{\"type\":\"error\",\"message\":\"Capture storage unavailable\"}"); return;
  }
  Serial.printf("{\"type\":\"export_begin\",\"schema\":1,\"count\":%u}\n", static_cast<unsigned>(ids.size()));
  size_t exported = 0, failures = 0;
  for(uint32_t id : ids) {
    File file = LittleFS.open(capturePath(id), "r");
    JsonDocument doc;
    String reason;
    bool valid = file && file.size() <= MAX_CAPTURE_RECORD_BYTES;
    if(valid) valid = !deserializeJson(doc, file);
    file.close();
    if(valid) valid = usableCapture(doc, reason) && doc["saved"] == true && doc["capture_id"] == id;
    if(!valid) { ++failures; continue; }
    serializeJson(doc, Serial); Serial.println(); ++exported;
  }
  Serial.printf("{\"type\":\"export_end\",\"count\":%u,\"errors\":%u}\n", static_cast<unsigned>(exported), static_cast<unsigned>(failures));
}

void clearCaptures() {
  std::vector<uint32_t> ids;
  if(!captureStorageReady || !scanCaptureFiles(&ids)) {
    Serial.println("{\"type\":\"error\",\"message\":\"Capture storage unavailable\"}"); return;
  }
  size_t failures = 0;
  for(uint32_t id : ids) if(!LittleFS.remove(capturePath(id))) ++failures;
  scanCaptureFiles();
  Serial.printf("{\"type\":\"clear_result\",\"remaining\":%u,\"errors\":%u}\n", static_cast<unsigned>(savedCaptureCount), static_cast<unsigned>(failures));
}
