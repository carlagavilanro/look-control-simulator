#pragma once
#include <WiFiClientSecure.h>
#include <vector>
#include <utility>
#define HTTPC_ERROR_CONNECTION_REFUSED (-1)
#define HTTPC_ERROR_READ_TIMEOUT (-11)
// Signatures as in arduino-esp32 HTTPClient.h.
class HTTPClient {
 public:
  bool begin(NetworkClient& client, String url);
  void end(void);
  void setReuse(bool reuse);
  void setUserAgent(const String& userAgent);
  void setConnectTimeout(int32_t connectTimeout);
  void setTimeout(uint16_t timeout);
  int GET();
  int POST(String payload);
  void addHeader(const String& name, const String& value, bool first = false, bool replace = true);
  String getString(void);
  int getSize(void);
  NetworkClient* getStreamPtr(void);
  void collectHeaders(const char* headerKeys[], const size_t headerKeysCount);
  String header(const char* name);
  static String errorToString(int error);
 private:
  int send(const char* method, const String& payload);
  NetworkClientSecure* client_ = nullptr; String host_, path_, body_; int port_ = 80; uint16_t timeout_ = 5000;
  std::vector<std::pair<String, String>> headers_; std::string responseHeaders_;
};
