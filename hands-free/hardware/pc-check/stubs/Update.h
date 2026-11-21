#pragma once
#include <Arduino.h>
#define UPDATE_SIZE_UNKNOWN 0xFFFFFFFF
#define U_FLASH 0
// Signatures as in arduino-esp32 Update.h.
class UpdateClass {
 public:
  bool begin(size_t size = UPDATE_SIZE_UNKNOWN, int command = U_FLASH, int ledPin = -1, uint8_t ledOn = LOW, const char* label = NULL);
  size_t writeStream(Stream& data);
  bool end(bool evenIfRemaining = false);
  void abort();
  const char* errorString();
  bool setMD5(const char* expected_md5);
  bool isFinished();
};
extern UpdateClass Update;
