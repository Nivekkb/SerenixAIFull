import type { Message } from '../types';

export interface TranscriptExportPayload {
  exportedAt: string;
  userId: string;
  retentionMode: 'ephemeral' | 'persistent';
  includesAIReplies: boolean;
  messages: Array<{
    timestamp: string;
    senderId: string;
    senderName: string;
    type: 'text' | 'ai';
    content: string;
    writtenBy: Message['writtenBy'] | null;
    writerService: string | null;
    writerRoute: string | null;
    writerGeneratedAt: string | null;
  }>;
}

export function buildTranscriptExportPayload(args: {
  userId: string;
  retentionMode: 'ephemeral' | 'persistent';
  messages: Message[];
  exportedAt?: string;
}): TranscriptExportPayload {
  const exportedAt = args.exportedAt || new Date().toISOString();
  const includesAIReplies = args.messages.some((message) => message.type === 'ai');

  return {
    exportedAt,
    userId: args.userId,
    retentionMode: args.retentionMode,
    includesAIReplies,
    messages: args.messages.map((message) => ({
      timestamp: message.timestamp,
      senderId: message.senderId,
      senderName: message.senderName,
      type: message.type,
      content: message.content,
      writtenBy: message.writtenBy || null,
      writerService: message.writerService || null,
      writerRoute: message.writerRoute || null,
      writerGeneratedAt: message.writerGeneratedAt || null,
    })),
  };
}

export function buildTranscriptExportFilename(exportedAt?: string): string {
  const stamp = (exportedAt || new Date().toISOString()).replace(/[:.]/g, '-');
  return `serenix-transcript-${stamp}.json`;
}
