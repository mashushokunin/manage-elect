const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadLineService() {
  const context = vm.createContext({ console, String, Array, RegExp });
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'gas', 'LineService.gs'),
    'utf8'
  );
  vm.runInContext(source, context, { filename: 'LineService.gs' });
  return context;
}

test('returns a connection confirmation for the test command', () => {
  const gas = loadLineService();
  const messages = gas.buildLineReplyMessages_('接続テスト');

  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, 'text');
  assert.match(messages[0].text, /接続できています/);
  assert.match(messages[0].text, /Supabase/);
});

test('returns guidance for an unsupported message', () => {
  const gas = loadLineService();
  const messages = gas.buildLineReplyMessages_('こんにちは');

  assert.equal(messages.length, 1);
  assert.match(messages[0].text, /メッセージを受信しました/);
  assert.match(messages[0].text, /接続テスト/);
});
