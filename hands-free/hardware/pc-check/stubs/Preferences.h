#pragma once
#include <Arduino.h>
#include <string>
// Signatures as in arduino-esp32 Preferences.h.
class Preferences {
 public:
  bool begin(const char* name, bool readOnly = false, const char* partition_label = NULL);
  void end();
  bool remove(const char* key);
  size_t putBool(const char* key, bool value); bool getBool(const char* key, bool defaultValue = false);
  size_t putUInt(const char* key, uint32_t value); uint32_t getUInt(const char* key, uint32_t defaultValue = 0);
  size_t putString(const char* key, const char* value); size_t putString(const char* key, String value); size_t putString(const char* key, const std::string& value);
  size_t getString(const char* key, char* value, size_t maxLen);
  String getString(const char* key, String defaultValue = String());
  String getString(const char* key, const char* defaultValue);
 private:
  String name_;
};
