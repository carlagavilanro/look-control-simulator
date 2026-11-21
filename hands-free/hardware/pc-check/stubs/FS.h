#pragma once
#include <Arduino.h>
#include <memory>
#include <string>
namespace fs {
struct FileState;
class File : public Stream {
 public:
  File() {}
  explicit File(std::shared_ptr<FileState> state) : state_(state) {}
  size_t write(uint8_t c) override; size_t write(const uint8_t* buffer, size_t size) override;
  int available() override; int read() override; int peek() override; void flush() override;
  size_t size() const; void close(); operator bool() const; const char* name() const;
  bool isDirectory(void); File openNextFile(const char* mode = "r");
  using Print::write;
 private:
  std::shared_ptr<FileState> state_;
};
class FS {
 public:
  File open(const char* path, const char* mode = "r", const bool create = false);
  File open(const String& path, const char* mode = "r", const bool create = false);
  bool exists(const char* path); bool exists(const String& path);
  bool remove(const char* path); bool remove(const String& path);
  bool rename(const char* from, const char* to); bool rename(const String& from, const String& to);
  bool mkdir(const char* path); bool mkdir(const String& path);
};
}
using fs::File; using fs::FS;
