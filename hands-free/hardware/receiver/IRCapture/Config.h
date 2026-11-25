#pragma once
constexpr uint16_t IR_RECEIVER_PIN = 15;
constexpr uint16_t CAPTURE_BUFFER_SIZE = 2048;
constexpr uint8_t CAPTURE_TIMEOUT_MS = 100;
// Limits stop new writes instead of deleting previous captures.
constexpr size_t MAX_SAVED_CAPTURES = 256;
constexpr size_t MAX_CAPTURE_STORAGE_BYTES = 512 * 1024;
constexpr size_t MAX_CAPTURE_RECORD_BYTES = 24576;
constexpr size_t STORAGE_RESERVE_BYTES = 32768;

// Website link. Without Wi-Fi the receiver records exactly as before, into its own storage.
// With Wi-Fi it also sends every saved recording to the website below.
// Wi-Fi: the easy way is to leave the two lines below as they are and give the board its Wi-Fi
// over USB from the website's Boards and Wi-Fi page (https://control.carla.codes/boards). The
// board keeps it in its own storage, and it can be changed there at any time without Arduino
// IDE. A name and password typed here are used only while the board has none saved over USB.
// There is no key to copy: the receiver shows a link code on that page and in the Serial
// Monitor, and it is typed once on the website. Wi-Fi must be a 2.4 GHz network.
// If you do type a password in this file, do it only on your own computer and do not share the
// file afterwards.
constexpr char WIFI_SSID[] = "CHANGE_ME";
constexpr char WIFI_PASSWORD[] = "CHANGE_ME";
constexpr char CLOUD_HOST[] = "control.carla.codes";
// Leave true. false still encrypts, but no longer checks that the other end really is the
// website; use it only to find out whether a certificate problem is what stops the board.
constexpr bool CLOUD_VERIFY_CERTIFICATE = true;
