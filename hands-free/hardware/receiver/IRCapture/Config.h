#pragma once
constexpr uint16_t IR_RECEIVER_PIN = 15;
constexpr uint16_t CAPTURE_BUFFER_SIZE = 2048;
constexpr uint8_t CAPTURE_TIMEOUT_MS = 100;
// Limits stop new writes instead of deleting previous captures.
constexpr size_t MAX_SAVED_CAPTURES = 256;
constexpr size_t MAX_CAPTURE_STORAGE_BYTES = 512 * 1024;
constexpr size_t MAX_CAPTURE_RECORD_BYTES = 24576;
constexpr size_t STORAGE_RESERVE_BYTES = 32768;
