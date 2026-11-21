#pragma once
#include <WiFi.h>
#include <FS.h>
#include <functional>
enum HTTPMethod { HTTP_GET, HTTP_POST, HTTP_PUT };
// The local Wi-Fi page of the transmitter is not exercised on the PC: these only have to compile.
class WebServer {
 public:
  explicit WebServer(int port = 80) {}
  void on(const char* uri, HTTPMethod method, std::function<void()> handler) {}
  void onNotFound(std::function<void()> handler) {}
  void begin() {} void handleClient() {}
  void collectHeaders(const char* headerKeys[], const size_t count) {}
  void sendHeader(const String& name, const String& value, bool first = false) {}
  void send(int code, const char* type, const String& content) {}
  void send_P(int code, const char* type, const char* content) {}
  String header(const char* name) { return String(); } String hostHeader() { return String(); }
  String arg(const char* name) { return String(); }
  template <typename T> size_t streamFile(T& file, const char* type) { return 0; }
};
