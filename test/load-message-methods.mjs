import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { getContentType, getDevice, isJidNewsletter } from 'baileys';
import Long from 'long';
import ts from 'typescript';

// Execute the actual service methods without importing server.module, which
// starts external integrations. Only transport/database dependencies are stubbed.
export function loadMessageMethods() {
  const path = new URL('../src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts', import.meta.url);
  const source = ts.createSourceFile(path.pathname, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const service = source.statements.find(
    (node) => ts.isClassDeclaration(node) && node.name?.text === 'BaileysStartupService',
  );
  assert.ok(service, 'the production service must exist');
  const names = ['deserializeMessageBuffers', 'prepareMessage', 'fetchMessages'];
  const methods = names.map((name) => {
    const method = service.members.find((node) => ts.isMethodDeclaration(node) && node.name.getText(source) === name);
    assert.ok(method, `production method ${name} must exist`);
    return method.getText(source);
  });
  const js = ts.transpileModule(`class Subject { ${methods.join('\n')} } module.exports = Subject;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const status = { 0: 'ERROR', 1: 'PENDING', 2: 'SERVER_ACK', 3: 'DELIVERY_ACK', 4: 'READ', 5: 'PLAYED' };
  const sandbox = {
    module: { exports: {} },
    Buffer,
    Uint8Array,
    Long,
    status,
    getContentType,
    getDevice,
    isJidNewsletter,
  };
  vm.runInNewContext(js, sandbox, { timeout: 1000 });
  const instance = new sandbox.module.exports();
  instance.instanceId = 'isolated-reply-test';
  return instance;
}
