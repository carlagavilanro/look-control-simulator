#pragma once
#include <Arduino.h>
#include <string>
enum wl_status_t { WL_IDLE_STATUS = 0, WL_CONNECTED = 3, WL_DISCONNECTED = 6 };
enum wifi_mode_t { WIFI_OFF = 0, WIFI_STA = 1 };
class IPAddress : public Printable { public: size_t printTo(Print& p) const override; };
class WiFiClient : public Stream { public: virtual ~WiFiClient() {} int available() override; int read() override; int peek() override; size_t write(uint8_t) override { return 0; } std::string incoming; size_t position = 0; };
typedef WiFiClient NetworkClient;
class WiFiClass {
 public:
  bool mode(wifi_mode_t mode); bool setAutoReconnect(bool on);
  wl_status_t begin(const char* ssid, const char* passphrase = nullptr);
  wl_status_t status(); bool reconnect(); IPAddress localIP();
};
extern WiFiClass WiFi;
