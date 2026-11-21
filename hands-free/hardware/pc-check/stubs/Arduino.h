// Stand-in for the ESP32 Arduino core, for running the sketches on a PC.
// String, Print and Stream are the REAL core classes (from arduino-esp32); the hardware is faked.
#pragma once
#define ARDUINO 10819
#define ESP32 1
#include <cstdint>
#include <cstddef>
#include <cstring>
#include <cstdlib>
#include <cstdio>
#include <cstdarg>
#include <cmath>
#include <cctype>
#include <vector>
#include <functional>
#include <algorithm>
#include "pgmspace.h"
#include "stdlib_noniso.h"
#include "WString.h"
#include "Print.h"
#include "Stream.h"
typedef bool boolean; typedef uint8_t byte;
#define LOW 0
#define HIGH 1
unsigned long millis(); unsigned long micros(); void delay(uint32_t ms); void delayMicroseconds(uint32_t us); void yield();
// FreeRTOS, as Arduino.h brings it in (freertos/FreeRTOS.h, task.h, semphr.h).
typedef void* SemaphoreHandle_t; typedef void* TaskHandle_t; typedef void (*TaskFunction_t)(void*);
typedef int BaseType_t; typedef unsigned int UBaseType_t; typedef uint32_t TickType_t;
#define pdTRUE ((BaseType_t)1)
#define pdFALSE ((BaseType_t)0)
#define pdPASS (pdTRUE)
#define portMAX_DELAY ((TickType_t)0xffffffffUL)
#define pdMS_TO_TICKS(ms) ((TickType_t)(ms))
SemaphoreHandle_t xSemaphoreCreateMutex(); SemaphoreHandle_t xSemaphoreCreateBinary();
BaseType_t xSemaphoreTake(SemaphoreHandle_t semaphore, TickType_t ticks); BaseType_t xSemaphoreGive(SemaphoreHandle_t semaphore);
void vTaskDelay(const TickType_t ticks);
BaseType_t xTaskCreatePinnedToCore(TaskFunction_t task, const char* const name, const uint32_t stackDepth, void* const parameters, UBaseType_t priority, TaskHandle_t* const created, const BaseType_t core);
extern "C" void configTime(long gmtOffset_sec, int daylightOffset_sec, const char* server1, const char* server2 = nullptr, const char* server3 = nullptr);
class HardwareSerial : public Stream {
 public:
  void begin(unsigned long baud);
  int available() override; int read() override; int peek() override;
  size_t write(uint8_t c) override; size_t write(const uint8_t* buffer, size_t size) override;
  using Print::write;
};
extern HardwareSerial Serial;
class EspClass { public: void restart(); const char* getChipModel(); };
extern EspClass ESP;
void setup(); void loop();
