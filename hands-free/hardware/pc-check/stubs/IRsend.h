#pragma once
#include <IRremoteESP8266.h>
// Signature of sendRaw as in IRremoteESP8266 IRsend.h.
class IRsend { public: explicit IRsend(uint16_t pin, bool inverted = false, bool use_modulation = true) {} void begin(); void sendRaw(const uint16_t buf[], const uint16_t len, const uint16_t hz); };
