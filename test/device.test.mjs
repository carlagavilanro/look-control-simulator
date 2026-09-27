import test from 'node:test';import assert from 'node:assert/strict';import {applyCommand} from '../public/device.mjs';
test('simulation clamps speed and does not mutate input',()=>{const state={on:false,speed:3,oscillating:false};assert.equal(applyCommand(state,'speed-up').speed,3);assert.equal(applyCommand({...state,speed:1},'speed-down').speed,1);assert.equal(applyCommand(state,'power').on,true);assert.equal(state.on,false);});
test('unknown commands cannot reach a device',()=>{assert.throws(()=>applyCommand({},'heater-on'),/Unknown/);});
