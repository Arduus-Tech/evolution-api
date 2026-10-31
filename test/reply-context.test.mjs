import assert from 'node:assert/strict';
import test from 'node:test';

import { loadMessageMethods } from './load-message-methods.mjs';

const sender = '100000000001@lid';
const quotedAuthor = '100000000002@lid';
const group = '120363000000000001@g.us';
const text = 'E avaliando o aparelho de entrada?';
const quotedText = 'Modelo de teste: valor de entrada R$ 2.050. Código REPLY-CONTEXT-42.';
const json = (value) => JSON.parse(JSON.stringify(value));

function envelope(message, extra = {}) {
  return {
    key: { id: '3EB0TESTREPLY0001', remoteJid: group, participant: sender, fromMe: false },
    pushName: 'Operador de teste',
    messageTimestamp: 1793451739,
    message,
    ...extra,
  };
}

function textReply(fromMe = false) {
  return envelope(
    {
      messageContextInfo: {
        threadId: [],
        messageSecret: Buffer.from([1, 2, 3]),
        limitSharingV2: { sharingLimited: false },
      },
      extendedTextMessage: {
        text,
        contextInfo: {
          stanzaId: '3EB0QUOTED000001',
          participant: quotedAuthor,
          remoteJid: group,
          quotedMessage: { extendedTextMessage: { text: quotedText } },
          mentionedJid: [quotedAuthor],
          forwardingScore: 1,
        },
      },
    },
    { key: { id: '3EB0TESTREPLY0001', remoteJid: group, participant: sender, fromMe } },
  );
}

for (const fromMe of [false, true]) {
  test(`text reply retains quote, mentions and device metadata (fromMe=${fromMe})`, () => {
    const input = textReply(fromMe);
    const before = structuredClone(input);
    const result = loadMessageMethods().prepareMessage(input);
    assert.equal(result.messageType, 'conversation');
    assert.equal(result.message.conversation, text);
    assert.equal(result.message.extendedTextMessage, undefined);
    assert.equal(result.contextInfo.stanzaId, '3EB0QUOTED000001');
    assert.equal(result.contextInfo.participant, quotedAuthor);
    assert.equal(result.contextInfo.remoteJid, group);
    assert.equal(result.contextInfo.quotedMessage.conversation, quotedText);
    assert.deepEqual(json(result.contextInfo.mentionedJid), [quotedAuthor]);
    assert.deepEqual(Array.from(result.contextInfo.messageSecret), [1, 2, 3]);
    assert.deepEqual(json(result.contextInfo.limitSharingV2), { sharingLimited: false });
    assert.equal(result.key.participant, sender);
    assert.deepEqual(structuredClone(input), before, 'normalization must not mutate the incoming envelope');
    // The wire representation used by both webhook and JSON storage retains the quote.
    assert.equal(json(result).contextInfo.quotedMessage.conversation, quotedText);
  });
}

test('text replying to an image retains media metadata and caption', () => {
  const input = textReply();
  input.message.extendedTextMessage.contextInfo.quotedMessage = {
    imageMessage: { caption: 'Imagem citada', mimetype: 'image/jpeg', mediaKey: Buffer.from([4, 5, 6]) },
  };
  const result = loadMessageMethods().prepareMessage(input);
  assert.equal(result.contextInfo.stanzaId, '3EB0QUOTED000001');
  assert.equal(result.contextInfo.quotedMessage.imageMessage.caption, 'Imagem citada');
  assert.deepEqual(Array.from(result.contextInfo.quotedMessage.imageMessage.mediaKey), [4, 5, 6]);
});

test('mentions survive even when the text does not quote another message', () => {
  const result = loadMessageMethods().prepareMessage(
    envelope({
      extendedTextMessage: { text: 'Olá @teste', contextInfo: { mentionedJid: [quotedAuthor] } },
    }),
  );
  assert.deepEqual(json(result.contextInfo.mentionedJid), [quotedAuthor]);
  assert.equal(result.contextInfo.stanzaId, undefined);
});

test('plain text does not acquire an invented quote', () => {
  const result = loadMessageMethods().prepareMessage(envelope({ conversation: 'Olá' }));
  assert.equal(result.message.conversation, 'Olá');
  assert.equal(result.contextInfo, undefined);
});

for (const type of ['imageMessage', 'audioMessage', 'videoMessage', 'documentMessage', 'stickerMessage']) {
  test(`${type} keeps its existing native reply context`, () => {
    const contextInfo = {
      stanzaId: 'MEDIA-QUOTE',
      participant: quotedAuthor,
      quotedMessage: { conversation: quotedText },
    };
    const result = loadMessageMethods().prepareMessage(envelope({ [type]: { contextInfo, mimetype: 'test/type' } }));
    assert.equal(result.messageType, type);
    assert.deepEqual(json(result.message[type].contextInfo), contextInfo);
  });
}

test('findMessages labels a reply with the current sender, never the quoted author', async () => {
  const subject = loadMessageMethods();
  const records = [
    { key: { fromMe: false, participant: sender }, contextInfo: { participant: quotedAuthor }, pushName: null },
  ];
  subject.prismaRepository = { message: { count: async () => 1, findMany: async () => records } };
  const result = await subject.fetchMessages({ where: { key: { remoteJid: group } } });
  assert.equal(result.messages.records[0].pushName, sender.split('@')[0]);
});

test('findMessages does not invent a sender from the quoted author when the key is incomplete', async () => {
  const subject = loadMessageMethods();
  const records = [{ key: { fromMe: false }, contextInfo: { participant: quotedAuthor }, pushName: null }];
  subject.prismaRepository = { message: { count: async () => 1, findMany: async () => records } };
  const result = await subject.fetchMessages({ where: {} });
  assert.equal(result.messages.records[0].pushName, null);
});
