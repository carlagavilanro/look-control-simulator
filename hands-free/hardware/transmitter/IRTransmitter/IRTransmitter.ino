#include <Arduino.h>
#include <ctype.h>
#include <WiFi.h>
#include <WebServer.h>
#include <IRremoteESP8266.h>
#include <IRsend.h>
#include "Config.h"
#include "SignalStore.h"
#include "WebPage.h"

// Transmitter board only. No receiver object, capture loop, or receiver GPIO.
IRsend transmitter(IR_TRANSMITTER_PIN);
WebServer server(80);
String recentRequests[16];
uint8_t requestSlot=0;
uint32_t lastCommandAt=0,lastReconnectAt=0;
bool hasCommand=false,wasConnected=false;

#include "FanTest.h"
#include "CloudTransmitter.h"

void reply(int code,const String& message){JsonDocument doc;doc["message"]=message;String text;serializeJson(doc,text);server.sendHeader("Cache-Control","no-store");server.send(code,"application/json",text);}
bool authorized(){
  if(String(CONTROL_TOKEN).startsWith("CHANGE_ME") || strlen(CONTROL_TOKEN)<24){reply(503,"Configure a control token of at least 24 characters.");return false;}
  if(server.header("X-Control-Token")!=CONTROL_TOKEN){reply(401,"Incorrect control token.");return false;}
  const String origin=server.header("Origin");
  if(origin.length() && origin!=String("http://")+server.hostHeader()){reply(403,"Cross-origin request rejected.");return false;}
  return true;
}
void handleCommand(){
  if(!authorized())return;
  const String id=server.arg("request_id"),name=server.arg("command");
  if(id.length()!=32){reply(400,"Missing or invalid request ID.");return;}
  for(size_t i=0;i<id.length();++i)if(!isxdigit(static_cast<unsigned char>(id[i]))){reply(400,"Invalid request ID.");return;}
  for(const auto& previous:recentRequests)if(previous==id){reply(409,"Duplicate request rejected; no signal sent.");return;}
  if(hasCommand && millis()-lastCommandAt<800){reply(429,"Please wait before another command.");return;}
  if(!signalsReady){reply(503,"No valid signal file loaded.");return;}
  if(name.startsWith("heater_")){reply(400,"Heater control is not enabled.");return;}
  const StoredSignal* selected=nullptr;
  for(const auto& entry:signals)if(entry.name==name){selected=&entry;break;}
  if(!selected){reply(400,"Command not found in signals.json.");return;}
  recentRequests[requestSlot]=id;requestSlot=(requestSlot+1)%16;lastCommandAt=millis();hasCommand=true;
  if(PRACTICE_MODE){Serial.println("PRACTICE command: "+name);reply(200,"Practice command received. No IR signal sent.");return;}
  Serial.println("IR command: "+name);
  transmitter.sendRaw(selected->raw.data(),static_cast<uint16_t>(selected->raw.size()),selected->carrier);
  reply(200,"IR signal sent. Appliance response is unverified.");
}
void setup(){
  Serial.begin(115200);delay(500);transmitter.begin();beginSignalStorage();
  // The Wi-Fi set from the website's Boards and Wi-Fi page, or else the one in Config.h.
  cloud::loadWifi();cloud::joinWifi();
  const char* headers[]={"X-Control-Token","Origin"};server.collectHeaders(headers,2);
  server.on("/",HTTP_GET,[]{server.sendHeader("X-Frame-Options","DENY");server.sendHeader("Cache-Control","no-store");server.send_P(200,"text/html",WEB_PAGE);});
  server.on("/api/status",HTTP_GET,[]{JsonDocument doc;doc["practice"]=PRACTICE_MODE;doc["signalsReady"]=signalsReady;doc["storageReady"]=storageReady;doc["signalCount"]=signals.size();doc["signalFileApi"]=1;JsonArray names=doc["commands"].to<JsonArray>();if(signalsReady)for(const auto& item:signals)names.add(item.name);String text;serializeJson(doc,text);server.sendHeader("Cache-Control","no-store");server.send(200,"application/json",text);});
  server.on("/api/command",HTTP_POST,handleCommand);
  server.on("/api/signals",HTTP_GET,[]{if(!authorized())return;if(!signalsReady){reply(503,"No valid signal file loaded.");return;}File file=LittleFS.open(signalFile,"r");if(!file){reply(500,"Cannot read signal file.");return;}server.sendHeader("Cache-Control","no-store");server.streamFile(file,"application/json");file.close();});
  server.on("/api/signals",HTTP_PUT,[]{if(!authorized())return;String error;const String body=server.arg("plain");if(body.length()>MAX_SIGNAL_FILE_BYTES){reply(413,"Maximum signal file size is 32768 bytes.");return;}if(!installSignals(body,error)){reply(400,error);return;}reply(200,"Signal file saved in transmitter flash. No IR command was sent.");});
  server.onNotFound([]{reply(404,"Not found.");});server.begin();
  Serial.println("Transmitter ready. Receiver board is not required.");
  beginFanTest();
  beginWebsite();
}
void loop(){
  handleSerialFanTest();
  handleWebsite();
  const bool connected=WiFi.status()==WL_CONNECTED;
  if(connected&&!wasConnected){Serial.print("Transmitter and signal-file upload: http://");Serial.println(WiFi.localIP());}
  if(!connected&&wasConnected)Serial.println("Wi-Fi disconnected; website commands unavailable.");
  wasConnected=connected;
  if(connected)server.handleClient();else if(millis()-lastReconnectAt>15000&&cloud::wifiConfigured()){lastReconnectAt=millis();WiFi.reconnect();}
  delay(2);
}
