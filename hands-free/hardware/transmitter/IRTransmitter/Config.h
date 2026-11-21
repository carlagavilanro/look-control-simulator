#pragma once
// Optional: configure these only if you also want the existing local Wi-Fi API.
// The USB Serial Monitor fan test needs no Wi-Fi or control token.
constexpr char WIFI_SSID[] = "CHANGE_ME";
constexpr char WIFI_PASSWORD[] = "CHANGE_ME";
constexpr char CONTROL_TOKEN[] = "CHANGE_ME_USE_A_LONG_RANDOM_TOKEN";
constexpr int16_t IR_TRANSMITTER_PIN = 4;
constexpr bool PRACTICE_MODE = false; // LIVE infrared output, explicitly enabled.

// Website link (optional). With the Wi-Fi name and password above filled in, the transmitter
// also connects out to the website below and sends the commands chosen there or in the Windows
// app. It needs no CONTROL_TOKEN for this: the board shows a link code in the Serial Monitor and
// you type it on the website's Setup page. Wi-Fi must be a 2.4 GHz network.
// Fill this file in only on your own computer, and do not share it once it holds your password.
constexpr char CLOUD_HOST[] = "control.carla.codes";
// Leave true. false still encrypts, but no longer checks that the other end really is the
// website; use it only to find out whether a certificate problem is what stops the board.
constexpr bool CLOUD_VERIFY_CERTIFICATE = true;
