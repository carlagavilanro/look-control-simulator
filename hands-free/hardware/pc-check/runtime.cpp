// What stands in for the ESP32 when a sketch is run on a PC: time, the USB line, tasks, Wi-Fi,
// HTTPS (plain HTTP to a local copy of the website), flash storage (a folder) and infrared
// (received from a text file, "sent" to the USB line as a log).
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <LittleFS.h>
#include <IRsend.h>
#include <IRrecv.h>
#include <IRutils.h>
#include <chrono>
#include <thread>
#include <mutex>
#include <condition_variable>
#include <deque>
#include <map>
#include <fstream>
#include <sstream>
#include <filesystem>
#include <unistd.h>
#include <fcntl.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <netinet/in.h>
#include <arpa/inet.h>

static std::string stateDir() { const char* d = getenv("HF_STATE"); return d ? d : "."; }
static const auto bootTime = std::chrono::steady_clock::now();
unsigned long millis() { return (unsigned long)std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - bootTime).count(); }
unsigned long micros() { return (unsigned long)std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now() - bootTime).count(); }
void delay(uint32_t ms) { std::this_thread::sleep_for(std::chrono::milliseconds(ms)); }
void delayMicroseconds(uint32_t us) { std::this_thread::sleep_for(std::chrono::microseconds(us)); }
void yield() {}
extern "C" void configTime(long, int, const char*, const char*, const char*) {}

// ---- USB line ----
static std::mutex inputLock; static std::deque<int> input; static std::mutex outputLock;
void HardwareSerial::begin(unsigned long) {
  std::thread([] { int c; while ((c = getchar()) != EOF) { std::lock_guard<std::mutex> g(inputLock); input.push_back(c); } _exit(0); }).detach();
}
int HardwareSerial::available() { std::lock_guard<std::mutex> g(inputLock); return (int)input.size(); }
int HardwareSerial::read() { std::lock_guard<std::mutex> g(inputLock); if (input.empty()) return -1; int c = input.front(); input.pop_front(); return c; }
int HardwareSerial::peek() { std::lock_guard<std::mutex> g(inputLock); return input.empty() ? -1 : input.front(); }
size_t HardwareSerial::write(uint8_t c) { std::lock_guard<std::mutex> g(outputLock); fputc(c, stdout); if (c == '\n') fflush(stdout); return 1; }
size_t HardwareSerial::write(const uint8_t* b, size_t n) { std::lock_guard<std::mutex> g(outputLock); fwrite(b, 1, n, stdout); fflush(stdout); return n; }
HardwareSerial Serial;

// ---- FreeRTOS ----
struct Sem { std::mutex m; std::condition_variable cv; int count; };
SemaphoreHandle_t xSemaphoreCreateMutex() { return new Sem{{}, {}, 1}; }
SemaphoreHandle_t xSemaphoreCreateBinary() { return new Sem{{}, {}, 0}; }
BaseType_t xSemaphoreTake(SemaphoreHandle_t h, TickType_t ticks) {
  Sem* s = (Sem*)h; std::unique_lock<std::mutex> g(s->m);
  if (!s->cv.wait_for(g, std::chrono::milliseconds(ticks == portMAX_DELAY ? 3600000u : ticks), [s] { return s->count > 0; })) return pdFALSE;
  s->count--; return pdTRUE;
}
BaseType_t xSemaphoreGive(SemaphoreHandle_t h) { Sem* s = (Sem*)h; { std::lock_guard<std::mutex> g(s->m); if (s->count < 1) s->count++; } s->cv.notify_one(); return pdTRUE; }
void vTaskDelay(const TickType_t ticks) { delay(ticks); }
BaseType_t xTaskCreatePinnedToCore(TaskFunction_t task, const char* const, const uint32_t, void* const p, UBaseType_t, TaskHandle_t* const, const BaseType_t) { std::thread(task, p).detach(); return pdPASS; }

// ---- Wi-Fi ----
static bool wifiBegun = false;
static bool wifiUp() { return wifiBegun && access((stateDir() + "/wifi-down").c_str(), F_OK) != 0; }
size_t IPAddress::printTo(Print& p) const { return p.print("192.0.2.10"); }
bool WiFiClass::mode(wifi_mode_t) { return true; } bool WiFiClass::setAutoReconnect(bool) { return true; }
// The network joined is written to a file in the state folder (name, then password), so a check
// can see that the board joined with what it was given. On a board this is the radio.
wl_status_t WiFiClass::begin(const char* ssid, const char* passphrase) {
  if (FILE* f = fopen((stateDir() + "/wifi-joined").c_str(), "w")) { fprintf(f, "%s\n%s\n", ssid ? ssid : "", passphrase ? passphrase : ""); fclose(f); }
  wifiBegun = true; return WL_IDLE_STATUS;
}
bool WiFiClass::disconnect(bool, bool) { wifiBegun = false; return true; }
wl_status_t WiFiClass::status() { return wifiUp() ? WL_CONNECTED : WL_DISCONNECTED; } bool WiFiClass::reconnect() { return true; } IPAddress WiFiClass::localIP() { return IPAddress(); }
WiFiClass WiFi;
void NetworkClientSecure::setInsecure() { insecure = true; } void NetworkClientSecure::setCACert(const char* c) { rootCA = c; } void NetworkClientSecure::stop() {}

// ---- HTTPS, as plain HTTP to the local copy of the website ----
bool HTTPClient::begin(NetworkClient& client, String url) {
  client_ = static_cast<NetworkClientSecure*>(&client); headers_.clear(); body_ = "";
  if (!url.startsWith("https://")) return false;
  // The real board would refuse a site it cannot verify; here it must at least have been told how.
  if (!client_->insecure && !(client_->rootCA && strstr(client_->rootCA, "-----BEGIN CERTIFICATE-----"))) { fprintf(stderr, "HOST: no certificate was set before connecting\n"); return false; }
  String rest = url.substring(8); int slash = rest.indexOf('/'); String host = slash < 0 ? rest : rest.substring(0, slash); path_ = slash < 0 ? String("/") : rest.substring(slash);
  int colon = host.indexOf(':'); host_ = colon < 0 ? host : host.substring(0, colon); port_ = colon < 0 ? 443 : host.substring(colon + 1).toInt();
  return host_.length() > 0;
}
void HTTPClient::end() {} void HTTPClient::setReuse(bool) {} void HTTPClient::setUserAgent(const String&) {} void HTTPClient::setConnectTimeout(int32_t) {}
void HTTPClient::setTimeout(uint16_t t) { timeout_ = t; }
void HTTPClient::addHeader(const String& n, const String& v, bool, bool) { headers_.push_back({n, v}); }
String HTTPClient::getString() { return body_; }
// The body of the last answer, as a stream (for a firmware download).
int HTTPClient::getSize() { return (int)client_->incoming.size(); }
NetworkClient* HTTPClient::getStreamPtr() { return client_; }
void HTTPClient::collectHeaders(const char*[], const size_t) {}
String HTTPClient::header(const char* name) { std::string lower = responseHeaders_, want = std::string("\r\n") + name + ":"; for (auto& c : lower) c = (char)tolower(c); for (auto& c : want) c = (char)tolower(c); size_t at = lower.find(want); if (at == std::string::npos) return String(); size_t start = at + want.size(), end = responseHeaders_.find("\r\n", start); std::string v = responseHeaders_.substr(start, end - start); while (!v.empty() && v[0] == ' ') v.erase(0, 1); return String(v.c_str()); }
int WiFiClient::available() { return (int)(incoming.size() - position); } int WiFiClient::read() { return available() > 0 ? (uint8_t)incoming[position++] : -1; } int WiFiClient::peek() { return available() > 0 ? (uint8_t)incoming[position] : -1; }
String HTTPClient::errorToString(int e) { return e == HTTPC_ERROR_READ_TIMEOUT ? String("read Timeout") : e == HTTPC_ERROR_CONNECTION_REFUSED ? String("connection refused") : String("error ") + e; }
int HTTPClient::GET() { return send("GET", String()); } int HTTPClient::POST(String payload) { return send("POST", payload); }
int HTTPClient::send(const char* method, const String& payload) {
  body_ = "";
  if (!wifiUp()) return HTTPC_ERROR_CONNECTION_REFUSED;
  int fd = socket(AF_INET, SOCK_STREAM, 0); sockaddr_in a{}; a.sin_family = AF_INET; a.sin_port = htons(port_); inet_pton(AF_INET, host_.c_str(), &a.sin_addr);
  timeval tv{timeout_ / 1000, (timeout_ % 1000) * 1000}; setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);
  if (connect(fd, (sockaddr*)&a, sizeof a) != 0) { close(fd); return HTTPC_ERROR_CONNECTION_REFUSED; }
  std::string req = std::string(method) + " " + path_.c_str() + " HTTP/1.1\r\nHost: " + host_.c_str() + "\r\nConnection: close\r\n";
  for (auto& h : headers_) req += std::string(h.first.c_str()) + ": " + h.second.c_str() + "\r\n";
  if (strcmp(method, "POST") == 0) req += "Content-Length: " + std::to_string(payload.length()) + "\r\n";
  req += "\r\n"; req.append(payload.c_str(), payload.length());
  if (::send(fd, req.data(), req.size(), 0) < 0) { close(fd); return -2; }
  std::string all; char buf[4096]; ssize_t n;
  while ((n = recv(fd, buf, sizeof buf, 0)) > 0) all.append(buf, n);
  close(fd);
  if (all.size() < 12) return HTTPC_ERROR_READ_TIMEOUT;
  int status = atoi(all.c_str() + 9); size_t split = all.find("\r\n\r\n"); std::string body = split == std::string::npos ? "" : all.substr(split + 4);
  if (all.find("chunked") != std::string::npos && all.find("chunked") < split) {  // undo chunked encoding
    std::string plain; size_t i = 0; while (i < body.size()) { size_t e = body.find("\r\n", i); if (e == std::string::npos) break; size_t len = strtoul(body.substr(i, e - i).c_str(), nullptr, 16); if (!len) break; plain += body.substr(e + 2, len); i = e + 2 + len + 2; } body = plain;
  }
  responseHeaders_ = split == std::string::npos ? all : all.substr(0, split + 2);
  client_->incoming = body; client_->position = 0;
  body_ = String(body.c_str());
  return status;
}

// ---- flash settings (Preferences): one small text file per namespace ----
static std::mutex prefsLock;
static std::map<std::string, std::string> loadPrefs(const String& name) { std::map<std::string, std::string> m; std::ifstream f(stateDir() + "/prefs-" + name.c_str() + ".txt"); std::string line; while (std::getline(f, line)) { size_t eq = line.find('='); if (eq != std::string::npos) m[line.substr(0, eq)] = line.substr(eq + 1); } return m; }
static void savePrefs(const String& name, const std::map<std::string, std::string>& m) { std::ofstream f(stateDir() + "/prefs-" + name.c_str() + ".txt"); for (auto& kv : m) f << kv.first << "=" << kv.second << "\n"; }
static size_t putPref(const String& n, const char* k, const std::string& v) { std::lock_guard<std::mutex> g(prefsLock); auto m = loadPrefs(n); m[k] = v; savePrefs(n, m); return v.size() ? v.size() : 1; }
static bool getPref(const String& n, const char* k, std::string& v) { std::lock_guard<std::mutex> g(prefsLock); auto m = loadPrefs(n); auto it = m.find(k); if (it == m.end()) return false; v = it->second; return true; }
bool Preferences::begin(const char* name, bool, const char*) { if (strlen(name) > 15) return false; name_ = name; return true; } void Preferences::end() {}
bool Preferences::remove(const char* k) { std::lock_guard<std::mutex> g(prefsLock); auto m = loadPrefs(name_); bool had = m.erase(k) > 0; savePrefs(name_, m); return had; }
size_t Preferences::putBool(const char* k, bool v) { return putPref(name_, k, v ? "1" : "0"); } bool Preferences::getBool(const char* k, bool d) { std::string v; return getPref(name_, k, v) ? v == "1" : d; }
size_t Preferences::putUInt(const char* k, uint32_t v) { putPref(name_, k, std::to_string(v)); return 4; } uint32_t Preferences::getUInt(const char* k, uint32_t d) { std::string v; return getPref(name_, k, v) ? (uint32_t)strtoul(v.c_str(), nullptr, 10) : d; }
size_t Preferences::putString(const char* k, const char* v) { return putPref(name_, k, v); } size_t Preferences::putString(const char* k, String v) { return putPref(name_, k, v.c_str()); } size_t Preferences::putString(const char* k, const std::string& v) { return putPref(name_, k, v); }
size_t Preferences::getString(const char*, char*, size_t) { return 0; }
String Preferences::getString(const char* k, String d) { std::string v; return getPref(name_, k, v) ? String(v.c_str()) : d; } String Preferences::getString(const char* k, const char* d) { return getString(k, String(d)); }

// ---- flash files (LittleFS): a folder ----
namespace fs {
struct FileState { std::string real, shown, data; size_t pos = 0; bool writing = false, dir = false, open = true; std::vector<std::string> children; size_t child = 0; };
static std::string realPath(const char* p) { return stateDir() + "/fs" + p; }
File FS::open(const char* path, const char* mode, const bool) {
  auto s = std::make_shared<FileState>(); s->real = realPath(path); s->shown = path;
  if (mode[0] == 'w') { std::ofstream f(s->real, std::ios::binary | std::ios::trunc); if (!f) return File(); s->writing = true; return File(s); }
  if (std::filesystem::is_directory(s->real)) { s->dir = true; for (auto& e : std::filesystem::directory_iterator(s->real)) s->children.push_back(std::string(path) + "/" + e.path().filename().string()); std::sort(s->children.begin(), s->children.end()); return File(s); }
  std::ifstream f(s->real, std::ios::binary); if (!f) return File(); std::stringstream b; b << f.rdbuf(); s->data = b.str(); return File(s);
}
File FS::open(const String& p, const char* m, const bool c) { return open(p.c_str(), m, c); }
bool FS::exists(const char* p) { return std::filesystem::exists(realPath(p)); } bool FS::exists(const String& p) { return exists(p.c_str()); }
bool FS::remove(const char* p) { return std::filesystem::remove(realPath(p)); } bool FS::remove(const String& p) { return remove(p.c_str()); }
bool FS::rename(const char* a, const char* b) { std::error_code e; std::filesystem::rename(realPath(a), realPath(b), e); return !e; } bool FS::rename(const String& a, const String& b) { return rename(a.c_str(), b.c_str()); }
bool FS::mkdir(const char* p) { std::error_code e; std::filesystem::create_directories(realPath(p), e); return !e; } bool FS::mkdir(const String& p) { return mkdir(p.c_str()); }
size_t File::write(uint8_t c) { return write(&c, 1); }
size_t File::write(const uint8_t* b, size_t n) { if (!state_ || !state_->writing) return 0; state_->data.append((const char*)b, n); return n; }
int File::available() { return state_ && !state_->writing ? (int)(state_->data.size() - state_->pos) : 0; }
int File::read() { return available() > 0 ? (uint8_t)state_->data[state_->pos++] : -1; } int File::peek() { return available() > 0 ? (uint8_t)state_->data[state_->pos] : -1; }
void File::flush() { if (state_ && state_->writing) { std::ofstream f(state_->real, std::ios::binary | std::ios::trunc); f << state_->data; } }
size_t File::size() const { return state_ ? state_->data.size() : 0; }
void File::close() { if (state_ && state_->open) { flush(); state_->open = false; } state_.reset(); }
File::operator bool() const { return !!state_; } const char* File::name() const { return state_ ? state_->shown.c_str() : ""; }
bool File::isDirectory() { return state_ && state_->dir; }
File File::openNextFile(const char* mode) { if (!state_ || state_->child >= state_->children.size()) return File(); FS root; return root.open(state_->children[state_->child++].c_str(), mode); }
bool LittleFSFS::begin(bool, const char*, uint8_t, const char*) { std::error_code e; std::filesystem::create_directories(stateDir() + "/fs", e); return !e; }
size_t LittleFSFS::totalBytes() { return 1441792; } size_t LittleFSFS::usedBytes() { size_t n = 0; for (auto& e : std::filesystem::recursive_directory_iterator(stateDir() + "/fs")) if (e.is_regular_file()) n += e.file_size(); return n; }
}
fs::LittleFSFS LittleFS;

// ---- infrared ----
void IRsend::begin() {}
// What would have been sent is written to the USB line, where the test reads it.
void IRsend::sendRaw(const uint16_t buf[], const uint16_t len, const uint16_t hz) {
  String line = String("IRSEND ") + hz + " " + len + ":";
  for (uint16_t i = 0; i < len; ++i) { line += " "; line += buf[i]; }
  Serial.println(line);
}
// Signals "arrive" as lines of microsecond timings appended to ir-in.txt.
static size_t irOffset = 0; static std::vector<uint16_t> irBuffer;
bool IRrecv::decode(decode_results* results, void*, uint8_t, uint16_t) {
  std::ifstream f(stateDir() + "/ir-in.txt"); if (!f) return false;
  f.seekg(irOffset); std::string line; if (!std::getline(f, line) || f.eof()) return false;   // only whole lines
  irOffset = (size_t)f.tellg();
  irBuffer.assign(1, 60000); std::stringstream s(line); unsigned long v; while (s >> v) irBuffer.push_back((uint16_t)(v / kRawTick));
  if (irBuffer.size() < 2) return false;
  results->rawbuf = irBuffer.data(); results->rawlen = (uint16_t)irBuffer.size(); results->bits = (uint16_t)((irBuffer.size() - 1) / 2); results->value = 0x1234; results->overflow = false; results->repeat = false;
  return true;
}
String typeToString(const decode_type_t, const bool) { return "UNKNOWN"; }
String resultToHexidecimal(const decode_results* const r) { char t[24]; snprintf(t, sizeof t, "0x%llX", (unsigned long long)r->value); return String(t); }

// ---- updates: the "installed" build is written to a file, and a restart ends the program ----
#include <Update.h>
static std::string updateData; static size_t updateSize = 0; static bool updateDone = false; static std::string updateProblem = "No Error";
bool UpdateClass::begin(size_t size, int, int, uint8_t, const char*) { updateData.clear(); updateDone = false; updateSize = size; if (size > 0x140000) { updateProblem = "Not Enough Space"; return false; } updateProblem = "No Error"; return true; }
size_t UpdateClass::writeStream(Stream& data) { int c; while ((c = data.read()) >= 0) updateData.push_back((char)c); return updateData.size(); }
bool UpdateClass::setMD5(const char* md5) { std::ofstream(stateDir() + "/update.md5") << md5; return strlen(md5) == 32; }
bool UpdateClass::end(bool) { if (updateData.size() != updateSize) { updateProblem = "Premature End"; return false; } std::ofstream f(stateDir() + "/update.bin", std::ios::binary); f << updateData; updateDone = true; return true; }
void UpdateClass::abort() { updateData.clear(); updateDone = false; } const char* UpdateClass::errorString() { return updateProblem.c_str(); } bool UpdateClass::isFinished() { return updateDone; }
UpdateClass Update;
void EspClass::restart() { fflush(stdout); _exit(42); }
const char* EspClass::getChipModel() { const char* chip = getenv("HF_CHIP"); return chip ? chip : "ESP32-D0WD-V3"; }
EspClass ESP;

int main() { setvbuf(stdout, nullptr, _IOLBF, 0); setup(); for (;;) loop(); }

// itoa and utoa come with the ESP32's C library; a PC's does not have them.
extern "C" char* utoa(unsigned int value, char* text, int base) { char t[40]; int n = 0; do { int d = value % base; t[n++] = (char)(d < 10 ? '0' + d : 'a' + d - 10); value /= base; } while (value); int i = 0; while (n) text[i++] = t[--n]; text[i] = 0; return text; }
extern "C" char* itoa(int value, char* text, int base) { if (value < 0 && base == 10) { text[0] = '-'; utoa((unsigned int)(-(long)value), text + 1, base); return text; } return utoa((unsigned int)value, text, base); }
