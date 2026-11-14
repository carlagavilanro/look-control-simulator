#pragma once
#include <ArduinoJson.h>
#include <LittleFS.h>
#include <Preferences.h>
#include <vector>
#include <ctype.h>
#include "DefaultSignals.h"

constexpr size_t MAX_SIGNAL_FILE_BYTES = 32768;
struct StoredSignal { String name; uint16_t carrier; std::vector<uint16_t> raw; };
std::vector<StoredSignal> signals;
bool storageReady = false, signalsReady = false;
String signalFile;

bool validSignalName(const String& name) {
  if (name.length() == 0 || name.length() > 48) return false;
  for (size_t i=0; i<name.length(); ++i)
    if (!((name[i]>='a' && name[i]<='z') || (name[i]>='0' && name[i]<='9') || name[i]=='_')) return false;
  return true;
}

bool decodeLibrary(JsonDocument& doc, std::vector<StoredSignal>& candidate, String& error) {
  if (!doc["schema"].is<int>() || doc["schema"].as<int>() != 1 || doc["units"].as<String>() != "microseconds" || !doc["commands"].is<JsonArray>()) { error="Expected schema 1, microseconds and commands array."; return false; }
  JsonArray list=doc["commands"].as<JsonArray>();
  if (list.size()==0 || list.size()>32) { error="Use 1 to 32 commands per file."; return false; }
  candidate.clear();
  for (JsonObject item : list) {
    if (!item["name"].is<const char*>()) { error="Missing command name."; return false; }
    StoredSignal entry; entry.name=item["name"].as<String>();
    if (!validSignalName(entry.name)) { error="Invalid command name."; return false; }
    for (const auto& other:candidate) if (other.name==entry.name) { error="Duplicate command name."; return false; }
    if (!item["carrier_khz"].is<uint16_t>()) { error="Carrier must be an integer."; return false; }
    entry.carrier=item["carrier_khz"].as<uint16_t>();
    if (entry.carrier<20 || entry.carrier>60 || !item["raw_us"].is<JsonArray>()) { error="Invalid carrier or timing array."; return false; }
    JsonArray raw=item["raw_us"].as<JsonArray>();
    if (raw.size()<3 || raw.size()>2048) { error="Use 3 to 2048 raw timings."; return false; }
    uint32_t total=0;
    for (JsonVariant timing:raw) {
      if (!timing.is<uint32_t>()) { error="Timings must be positive integer microseconds."; return false; }
      uint32_t duration=timing.as<uint32_t>();
      if (!duration || duration>1000000 || total>1000000-duration) { error="A signal must be positive and at most one second."; return false; }
      total+=duration;
      // sendRaw takes uint16_t: zero-duration opposite-polarity entries let us
      // split long intervals without changing their duration or mark/space order.
      while(duration>65535) { entry.raw.push_back(65535); entry.raw.push_back(0); duration-=65535; }
      entry.raw.push_back(static_cast<uint16_t>(duration));
    }
    candidate.push_back(std::move(entry));
  }
  return true;
}

bool loadSignalFile(const char* path, std::vector<StoredSignal>& candidate, String& error) {
  File file=LittleFS.open(path, "r");
  if (!file || file.size()==0 || file.size()>MAX_SIGNAL_FILE_BYTES) { error="Signal file missing or too large."; return false; }
  JsonDocument doc;
  DeserializationError result=deserializeJson(doc,file);
  file.close();
  if(result) { error="Signal file contains invalid JSON."; return false; }
  return decodeLibrary(doc,candidate,error);
}

bool installSignals(const String& body, String& error) {
  if(!storageReady) { error="Signal storage unavailable. Check serial diagnostics."; return false; }
  if(body.length()==0 || body.length()>MAX_SIGNAL_FILE_BYTES) { error="Signal file must be 1 to 32768 bytes."; return false; }
  std::vector<StoredSignal> candidate;
  {
    JsonDocument doc;auto parsed=deserializeJson(doc,body);
    if(parsed) { error="Invalid JSON."; return false; }
    if(!decodeLibrary(doc,candidate,error)) return false;
  }
  File staging=LittleFS.open("/signals.tmp","w");
  if(!staging) { error="Cannot create temporary signal file."; return false; }
  const size_t written=staging.print(body);staging.flush();staging.close();
  if(written!=body.length()) { error="Signal storage is full; previous file retained."; return false; }
  std::vector<StoredSignal> verified;
  if(!loadSignalFile("/signals.tmp",verified,error)) return false;
  if(LittleFS.exists("/signals.json") && signalFile=="/signals.json" && signalsReady) {
    if(LittleFS.exists("/signals.bak") && !LittleFS.remove("/signals.bak")) { error="Cannot replace backup; previous file retained."; return false; }
    if(!LittleFS.rename("/signals.json","/signals.bak")) { error="Cannot back up current file."; return false; }
  }
  // If boot recovered a valid backup, never replace it with a corrupt main.
  if(LittleFS.exists("/signals.json") && !LittleFS.remove("/signals.json")) { error="Cannot remove inactive main file."; return false; }
  if(!LittleFS.rename("/signals.tmp","/signals.json")) {
    if(!LittleFS.exists("/signals.json")) LittleFS.rename("/signals.bak","/signals.json");
    error="Cannot activate uploaded file; previous library remains in memory.";return false;
  }
  signals.swap(verified);signalsReady=true;signalFile="/signals.json";
  return true;
}

void beginSignalStorage() {
  Preferences prefs;
  if(!prefs.begin("ir-files",false)) { Serial.println("Cannot open storage initialization marker."); return; }
  const bool initialized=prefs.getBool("ready",false);
  storageReady=LittleFS.begin(false);
  // Initialize the data filesystem once on this dedicated transmitter board.
  // Never auto-format a filesystem already initialized by this project.
  if(!storageReady && !initialized) storageReady=LittleFS.begin(true);
  if(storageReady) prefs.putBool("ready",true);
  prefs.end();
  if(!storageReady) { Serial.println("LittleFS unavailable; no IR commands enabled. Existing data was not reformatted."); return; }
  String error;
  if(loadSignalFile("/signals.json",signals,error)) { signalsReady=true;signalFile="/signals.json"; }
  else if(loadSignalFile("/signals.bak",signals,error)) { signalsReady=true;signalFile="/signals.bak";Serial.println("Using last valid backup signal file."); }
  else if(!LittleFS.exists("/signals.json") && !LittleFS.exists("/signals.bak")) {
    if(!installSignals(String(FPSTR(DEFAULT_SIGNALS)),error)) Serial.println("Cannot install initial signal file: "+error);
  } else Serial.println("No valid signal library. Upload a valid signals.json; no signals will be sent.");
}
