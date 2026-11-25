// Checks the website's ready-made Samsung timings against the infrared library the boards use,
// with the library's own host-side test helpers: (1) the library, asked to send the code twice,
// produces exactly these timings; (2) the library's receiver, shown these timings, reads them as
// SAMSUNG, 32 bits, with the same code.
#include <cstdio>
#include <cstdlib>
#include <vector>
#include <string>
#include <sstream>
#include <iostream>
#include "IRrecv.h"
#include "IRrecv_test.h"
#include "IRsend.h"
#include "IRsend_test.h"
int main() {
  IRsendTest irsend(4); IRrecv irrecv(15); irsend.begin();
  std::string line; int checked = 0, bad = 0;
  while (std::getline(std::cin, line)) {
    std::istringstream in(line); std::string hex; in >> hex; if (hex.empty()) continue;
    const uint64_t code = strtoull(hex.c_str(), nullptr, 16);
    std::vector<uint16_t> mine; uint32_t value; while (in >> value) mine.push_back(static_cast<uint16_t>(value));
    // (1) the library's own output for the code sent twice (one repeat)
    irsend.reset(); irsend.sendSAMSUNG(code, 32, 1);
    std::vector<uint32_t> theirs; for (uint16_t i = 0; i < irsend.last + 1 && irsend.output[i]; i++) theirs.push_back(irsend.output[i]);
    // The library ends with the gap after the last message; the website's timings end with the last mark.
    bool same = theirs.size() == mine.size() + 1;
    for (size_t i = 0; same && i < mine.size(); i++) same = theirs[i] == mine[i];
    // (2) decode the website's timings
    irsend.reset(); irsend.sendRaw(mine.data(), mine.size(), 38); irsend.makeDecodeResult();
    const bool read = irrecv.decode(&irsend.capture) && irsend.capture.decode_type == SAMSUNG && irsend.capture.bits == 32 && irsend.capture.value == code;
    checked++; if (!same || !read) { bad++; printf("MISMATCH %s same=%d read=%d (library %zu timings, website %zu)\n", hex.c_str(), same, read, theirs.size(), mine.size()); }
  }
  printf("%d codes checked, %d wrong\n", checked, bad);
  return bad ? 1 : 0;
}
