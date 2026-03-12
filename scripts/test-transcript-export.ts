import assert from 'node:assert/strict';
import type { Message } from '../src/types';
import { buildTranscriptExportFilename, buildTranscriptExportPayload } from '../src/utils/transcriptExport';

const exportedAt = '2026-03-12T05:30:00.123Z';

const messages: Message[] = [
  {
    id: 'm1',
    content: 'I feel overwhelmed.',
    senderId: 'user-123',
    senderName: 'Kevin',
    timestamp: '2026-03-12T05:29:00.000Z',
    type: 'text',
  },
  {
    id: 'm2',
    content: 'That sounds heavy. Let us take one slow breath first.',
    senderId: 'ai',
    senderName: 'SerenixAI',
    timestamp: '2026-03-12T05:29:10.000Z',
    type: 'ai',
    writtenBy: 'trusted_backend',
    writerService: 'governance-server',
    writerRoute: '/v1/private/respond',
    writerGeneratedAt: '2026-03-12T05:29:10.000Z',
  },
];

const payload = buildTranscriptExportPayload({
  userId: 'user-123',
  retentionMode: 'persistent',
  messages,
  exportedAt,
});

assert.equal(payload.exportedAt, exportedAt);
assert.equal(payload.userId, 'user-123');
assert.equal(payload.retentionMode, 'persistent');
assert.equal(payload.includesAIReplies, true);
assert.equal(payload.messages.length, 2);
assert.equal(payload.messages[0]?.type, 'text');
assert.equal(payload.messages[1]?.type, 'ai');
assert.equal(payload.messages[1]?.writtenBy, 'trusted_backend');
assert.equal(payload.messages[1]?.writerRoute, '/v1/private/respond');

const fileName = buildTranscriptExportFilename(exportedAt);
assert.equal(fileName, 'serenix-transcript-2026-03-12T05-30-00-123Z.json');

console.log('[test-transcript-export] ok');
