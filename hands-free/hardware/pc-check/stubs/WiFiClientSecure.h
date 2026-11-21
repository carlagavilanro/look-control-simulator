#pragma once
#include <WiFi.h>
// Signatures as in arduino-esp32 NetworkClientSecure.h (and WiFiClientSecure.h of 2.x).
class NetworkClientSecure : public NetworkClient {
 public:
  void setInsecure();
  void setCACert(const char* rootCA);
  void stop();
  const char* rootCA = nullptr; bool insecure = false;
};
typedef NetworkClientSecure WiFiClientSecure;
