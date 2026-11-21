#pragma once
constexpr uint16_t IR_RECEIVER_PIN = 15;
constexpr uint16_t CAPTURE_BUFFER_SIZE = 2048;
constexpr uint8_t CAPTURE_TIMEOUT_MS = 100;
// Limits stop new writes instead of deleting previous captures.
constexpr size_t MAX_SAVED_CAPTURES = 256;
constexpr size_t MAX_CAPTURE_STORAGE_BYTES = 512 * 1024;
constexpr size_t MAX_CAPTURE_RECORD_BYTES = 24576;
constexpr size_t STORAGE_RESERVE_BYTES = 32768;

// Website link (optional). Leave CHANGE_ME and the receiver stays off Wi-Fi and records exactly
// as before. With the Wi-Fi name and password filled in, it also sends every saved recording to
// the website below. There is no key to copy: the receiver shows a link code in the Serial
// Monitor and you type it on the website's Setup page. Wi-Fi must be a 2.4 GHz network.
// Fill this file in only on your own computer, and do not share it once it holds your password.
constexpr char WIFI_SSID[] = "CHANGE_ME";
constexpr char WIFI_PASSWORD[] = "CHANGE_ME";
constexpr char CLOUD_HOST[] = "control.carla.codes";
// Leave true. false still encrypts, but no longer checks that the other end really is the
// website; use it only to find out whether a certificate problem is what stops the board.
constexpr bool CLOUD_VERIFY_CERTIFICATE = true;
