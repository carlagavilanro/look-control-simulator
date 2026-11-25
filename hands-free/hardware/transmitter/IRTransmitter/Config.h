#pragma once
// Wi-Fi: the easy way is to leave these two as they are and give the board its Wi-Fi over USB
// from the website's Boards and Wi-Fi page (https://control.carla.codes/boards). The board keeps
// it in its own storage, and it can be changed there at any time without Arduino IDE. A name and
// password typed here are used only while the board has none saved over USB.
// CONTROL_TOKEN is only for the older local Wi-Fi API; the website link does not use it.
// The USB Serial Monitor fan test needs no Wi-Fi or control token.
constexpr char WIFI_SSID[] = "CHANGE_ME";
constexpr char WIFI_PASSWORD[] = "CHANGE_ME";
constexpr char CONTROL_TOKEN[] = "CHANGE_ME_USE_A_LONG_RANDOM_TOKEN";
constexpr int16_t IR_TRANSMITTER_PIN = 4;
constexpr bool PRACTICE_MODE = false; // LIVE infrared output, explicitly enabled.

// Website link. Once the board has Wi-Fi (see above), it connects out to the website below and
// sends the commands chosen there or in the Windows app. The board shows a link code on the
// Boards and Wi-Fi page and in the Serial Monitor; it is typed once on the website.
// Wi-Fi must be a 2.4 GHz network.
// If you do type a password in this file, do it only on your own computer and do not share the
// file afterwards.
constexpr char CLOUD_HOST[] = "control.carla.codes";
// Leave true. false still encrypts, but no longer checks that the other end really is the
// website; use it only to find out whether a certificate problem is what stops the board.
constexpr bool CLOUD_VERIFY_CERTIFICATE = true;
