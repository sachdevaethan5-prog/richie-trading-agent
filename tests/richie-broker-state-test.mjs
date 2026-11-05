import test from 'node:test';
import assert from 'node:assert/strict';
import {brokerRows} from '../src/core/broker-state.mjs';
test('broker errors and malformed payloads cannot masquerade as an empty position list',()=>{
 for(const s of ['bad','{}','{"data":{"error":"offline"}}'])assert.throws(()=>brokerRows(s,'positions'));
 assert.deepEqual(brokerRows('{"data":{"positions":[]}}','positions'),[]);
});
