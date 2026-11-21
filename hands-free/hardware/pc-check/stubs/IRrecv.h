#pragma once
#include <IRremoteESP8266.h>
class decode_results { public: decode_type_t decode_type = UNKNOWN; uint64_t value = 0; uint32_t address = 0, command = 0; uint16_t bits = 0; volatile uint16_t* rawbuf = nullptr; uint16_t rawlen = 0; bool overflow = false, repeat = false; };
class IRrecv { public: explicit IRrecv(const uint16_t recvpin, const uint16_t bufsize = 100, const uint8_t timeout = 15, const bool save_buffer = false, const uint8_t timer_num = 0) {} void setUnknownThreshold(const uint16_t length) {} void enableIRIn(const bool pullup = false) {} void disableIRIn(void) {} bool decode(decode_results* results, void* save = NULL, uint8_t max_skip = 0, uint16_t tolerance = 25); void resume(void) {} };
