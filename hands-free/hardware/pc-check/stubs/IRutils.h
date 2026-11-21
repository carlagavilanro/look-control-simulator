#pragma once
#include <IRrecv.h>
String typeToString(const decode_type_t protocol, const bool isRepeat = false);
String resultToHexidecimal(const decode_results* const result);
