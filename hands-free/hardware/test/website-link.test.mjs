import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=file=>fs.readFileSync(new URL('../'+file,import.meta.url),'utf8');
test('the two sketches carry the same website link and certificates',()=>{
 for(const file of ['CloudLink.h','CloudCert.h'])assert.equal(read('transmitter/IRTransmitter/'+file),read('receiver/IRCapture/'+file),file);
 const certificates=read('receiver/IRCapture/CloudCert.h').match(/-----BEGIN CERTIFICATE-----/g);assert.equal(certificates.length,2);
});
test('no Wi-Fi name, password or key is ever committed with a sketch',()=>{
 for(const file of ['transmitter/IRTransmitter/Config.h','receiver/IRCapture/Config.h']){
  const text=read(file);
  assert.match(text,/WIFI_SSID\[\] = "CHANGE_ME";/,file);assert.match(text,/WIFI_PASSWORD\[\] = "CHANGE_ME";/,file);
  assert.match(text,/CLOUD_VERIFY_CERTIFICATE = true;/,file);
 }
 assert.match(read('transmitter/IRTransmitter/Config.h'),/CONTROL_TOKEN\[\] = "CHANGE_ME_USE_A_LONG_RANDOM_TOKEN";/);
});
test('the working sketches gain only the lines that start the website link',()=>{
 const sender=read('transmitter/IRTransmitter/IRTransmitter.ino'),receiver=read('receiver/IRCapture/IRCapture.ino');
 for(const line of ['#include "CloudTransmitter.h"','  beginWebsite();','  handleWebsite();','#include "FanTest.h"','  handleSerialFanTest();'])assert.ok(sender.includes(line),line);
 for(const line of ['#include "CloudReceiver.h"','  beginWebsite();','  handleWebsite();','    websiteNoteSignal();','      if(saved) websiteNoteSaved(capture["capture_id"].as<uint32_t>());','else if(serialCommand == "CLOUD") printWebsiteStatus();'])assert.ok(receiver.includes(line),line);
 // The key the website gives a board is kept in flash and never written to the USB line.
 for(const file of ['transmitter/IRTransmitter/CloudLink.h','transmitter/IRTransmitter/CloudTransmitter.h','receiver/IRCapture/CloudReceiver.h'])assert.doesNotMatch(read(file),/(say|print|println)\([^;]*\bkey\b/,file);
});
