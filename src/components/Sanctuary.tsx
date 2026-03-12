import { useState, useEffect, useMemo, useRef } from 'react';
import { User } from 'firebase/auth';
import { db } from '../firebase';
import { collection, addDoc, query, orderBy, onSnapshot, limit, doc, setDoc } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Sparkles, User as UserIcon, Wind, Mic, MicOff, AlertTriangle, PhoneCall, Shield } from 'lucide-react';
import { Message, OperationType, UserProfile } from '../types';
import { handleFirestoreError } from '../utils/errorHandlers';
import { getAIResponse, getLastAIResponseStatus } from '../services/gemini';
import ReactMarkdown from 'react-markdown';

interface SanctuaryProps {
  user: User;
  profile: UserProfile | null;
}

const QUICK_PROMPTS = [
  "I'm feeling overwhelmed.",
  'Can we try a grounding step?',
  'I just need to vent.',
  'Help me think through this.',
];

function createLocalMessage(partial: Omit<Message, 'id'>): Message {
  return {
    ...partial,
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
  };
}

export default function Sanctuary({ user, profile }: SanctuaryProps) {
  const [persistedMessages, setPersistedMessages] = useState<Message[]>([]);
  const [runtimeMessages, setRuntimeMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [showFallbackHint, setShowFallbackHint] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [isGrantingConsent, setIsGrantingConsent] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  const aiName = 'SerenixAI';
  const retentionMode = profile?.chatRetentionMode || 'ephemeral';
  const hasSensitiveConsent = Boolean(profile?.sensitiveDataConsentAt);

  const messages = useMemo(() => {
    if (retentionMode === 'persistent') {
      return persistedMessages;
    }
    return runtimeMessages;
  }, [retentionMode, persistedMessages, runtimeMessages]);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInput((prev) => prev + (prev ? ' ' : '') + transcript);
        setIsListening(false);
      };

      recognitionRef.current.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
      };

      recognitionRef.current.onend = () => {
        setIsListening(false);
      };
    }
  }, []);

  useEffect(() => {
    if (retentionMode !== 'persistent') {
      setPersistedMessages([]);
      return;
    }

    const path = `private_chats/${user.uid}/messages`;
    const q = query(collection(db, path), orderBy('timestamp', 'asc'), limit(100));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const msgs = snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Message));
        setPersistedMessages(msgs);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, path);
      },
    );

    return () => unsubscribe();
  }, [retentionMode, user.uid]);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }, [messages, isTyping]);

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      setIsListening(true);
      recognitionRef.current?.start();
    }
  };

  const grantSensitiveConsent = async () => {
    setConsentError(null);
    setIsGrantingConsent(true);
    try {
      const consentAt = new Date().toISOString();
      await setDoc(doc(db, 'users', user.uid), {
        uid: user.uid,
        displayName: profile?.displayName || user.displayName || 'Anonymous',
        email: profile?.email || user.email || '',
        photoURL: profile?.photoURL || user.photoURL || null,
        createdAt: profile?.createdAt || consentAt,
        preferredName: profile?.preferredName || null,
        responseLength: profile?.responseLength || 'short',
        chatRetentionMode: profile?.chatRetentionMode || 'ephemeral',
        sensitiveDataConsentAt: consentAt,
      }, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    } finally {
      setIsGrantingConsent(false);
    }
  };

  const handleSend = async (e?: React.FormEvent, customText?: string) => {
    e?.preventDefault();
    const messageToSend = customText || input.trim();
    if (!messageToSend || isTyping) return;

    if (!hasSensitiveConsent) {
      setConsentError('Please review and accept the chat-data notice before continuing.');
      return;
    }

    setConsentError(null);
    setInput('');
    setIsTyping(true);

    const userMessage = createLocalMessage({
      content: messageToSend,
      senderId: user.uid,
      senderName: user.displayName || 'You',
      timestamp: new Date().toISOString(),
      type: 'text',
    });

    if (retentionMode === 'ephemeral') {
      setRuntimeMessages((prev) => [...prev, userMessage]);
    } else {
      const path = `private_chats/${user.uid}/messages`;
      try {
        await addDoc(collection(db, path), {
          content: userMessage.content,
          senderId: userMessage.senderId,
          senderName: userMessage.senderName,
          timestamp: userMessage.timestamp,
          type: 'text',
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, path);
        setIsTyping(false);
        return;
      }
    }

    let aiText = '';
    try {
      const history = messages.map((m) => ({
        role: (m.senderId === 'ai' ? 'model' : 'user') as 'user' | 'model',
        parts: [{ text: m.content }],
      }));

      aiText = await getAIResponse(messageToSend, history, profile?.responseLength || 'short', profile?.preferredName, user.uid);
      const status = getLastAIResponseStatus();
      if (status.fallbackActive) {
        setShowFallbackHint(true);
      }
    } catch (error) {
      console.error('Gemini response error:', error);
      setShowFallbackHint(true);
      aiText = 'There was a connection issue on the AI side. For now, focus on one safe next step, and consider reaching out to someone you trust while this reconnects.';
    }

    const aiMessage = createLocalMessage({
      content: aiText,
      senderId: 'ai',
      senderName: aiName,
      timestamp: new Date().toISOString(),
      type: 'ai',
    });

    if (retentionMode === 'ephemeral') {
      setRuntimeMessages((prev) => [...prev, aiMessage]);
    } else {
      const path = `private_chats/${user.uid}/messages`;
      try {
        await addDoc(collection(db, path), {
          content: aiMessage.content,
          senderId: aiMessage.senderId,
          senderName: aiMessage.senderName,
          timestamp: aiMessage.timestamp,
          type: aiMessage.type,
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, path);
      }
    }

    setIsTyping(false);
  };

  return (
    <div className="flex-1 flex flex-col h-full max-w-4xl mx-auto w-full px-4 py-6">
      <div className="flex items-center gap-3 mb-4 px-2">
        <div className="w-10 h-10 rounded-full bg-serenix-accent flex items-center justify-center text-white shadow-md text-xl">
          <Wind size={20} />
        </div>
        <div>
          <h2 className="font-serif text-2xl font-medium">{aiName} Check-In Space</h2>
          <p className="text-serenix-ink/50 text-sm">A calm place to think things through. Not therapy, emergency care, or a replacement for human support.</p>
          {showFallbackHint && (
            <p className="text-[10px] text-serenix-ink/25 tracking-wide" title="Backup deterministic safety mode is active">
              safety backup active
            </p>
          )}
        </div>
      </div>

      <div className="mb-3 px-3 py-2 rounded-2xl bg-amber-50/80 border border-amber-200 text-xs text-amber-900 flex flex-wrap items-center gap-2">
        <AlertTriangle size={14} />
        <span>Need immediate human help?</span>
        <a href="tel:911" className="inline-flex items-center gap-1 underline">
          <PhoneCall size={12} />
          Call emergency services
        </a>
        <a href="tel:988" className="underline">Call or text 988</a>
        <a href="https://988lifeline.org" target="_blank" rel="noreferrer" className="underline">988 Lifeline</a>
      </div>

      {!hasSensitiveConsent && (
        <div className="mb-3 px-3 py-2 rounded-2xl bg-white/70 border border-white/50 text-xs text-serenix-ink/75 flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="flex items-center gap-2">
            <Shield size={14} />
            <span>Before starting, please confirm consent for handling sensitive text. If you prefer, keep retention on ephemeral so transcripts are not stored.</span>
          </div>
          <button
            type="button"
            onClick={grantSensitiveConsent}
            disabled={isGrantingConsent}
            className="sm:ml-auto px-3 py-1.5 rounded-full bg-serenix-ink text-white text-xs disabled:opacity-40"
          >
            {isGrantingConsent ? 'Saving...' : 'I consent'}
          </button>
        </div>
      )}

      {consentError && (
        <div className="mb-3 px-3 py-2 rounded-2xl bg-red-50 border border-red-200 text-xs text-red-700">
          {consentError}
        </div>
      )}

      <div className="mb-4 px-3 py-2 rounded-2xl bg-white/45 border border-white/40 text-xs text-serenix-ink/65">
        Retention mode: <span className="font-semibold uppercase tracking-wide">{retentionMode}</span>{' '}
        ({retentionMode === 'ephemeral' ? 'messages stay in this session only' : 'your messages and AI replies are saved to your private transcript'}).
      </div>

      <div className="glass rounded-[2rem] p-4 md:p-5 h-[70vh] min-h-[30rem] max-h-[46rem] flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto space-y-6 mb-4 px-2 custom-scrollbar">
          {messages.length === 0 && !isTyping && (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-40 py-20">
              <Sparkles size={48} className="mb-4" />
              <p className="text-lg font-serif italic">Use this space to organize your thoughts and choose one supportive next step.</p>
            </div>
          )}

          <AnimatePresence initial={false}>
            {messages.map((msg, index) => {
              const previous = messages[index - 1];
              const isGrouped = Boolean(previous && previous.senderId === msg.senderId);

              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${msg.senderId === 'ai' ? 'justify-start' : 'justify-end'} ${isGrouped ? 'mt-1' : 'mt-4'}`}
                >
                  <div className={`flex gap-3 max-w-[85%] ${msg.senderId === 'ai' ? 'flex-row' : 'flex-row-reverse'}`}>
                    {!isGrouped ? (
                      <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center ${msg.senderId === 'ai' ? 'bg-serenix-accent text-white' : 'bg-white text-serenix-ink'}`}>
                        {msg.senderId === 'ai' ? <Sparkles size={14} /> : <UserIcon size={14} />}
                      </div>
                    ) : (
                      <div className="w-8 h-8 flex-shrink-0" />
                    )}
                    <div className={`px-4 py-3 rounded-2xl shadow-sm ${msg.senderId === 'ai' ? (isGrouped ? 'bg-white text-serenix-ink' : 'bg-white text-serenix-ink rounded-tl-none') : (isGrouped ? 'bg-serenix-ink text-white' : 'bg-serenix-ink text-white rounded-tr-none')}`}>
                      <div className={`markdown-body text-sm leading-relaxed ${msg.senderId === 'ai' ? 'markdown-ai' : 'markdown-user'}`}>
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {isTyping && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex justify-start"
            >
              <div className="flex gap-3 items-center ml-11">
                <div className="flex gap-1">
                  <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1 }} className="w-1.5 h-1.5 bg-serenix-accent rounded-full" />
                  <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1, delay: 0.2 }} className="w-1.5 h-1.5 bg-serenix-accent rounded-full" />
                  <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1, delay: 0.4 }} className="w-1.5 h-1.5 bg-serenix-accent rounded-full" />
                </div>
                <span className="text-xs text-serenix-ink/40 font-medium italic">Preparing a response...</span>
              </div>
            </motion.div>
          )}
          <div ref={scrollRef} />
        </div>

        <div className="mb-4 flex flex-wrap gap-2 px-2">
          {QUICK_PROMPTS.map((prompt, idx) => (
            <motion.button
              key={idx}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handleSend(undefined, prompt)}
              className="text-xs bg-white/40 hover:bg-white/65 text-serenix-ink/70 px-4 py-2 rounded-full border border-white/35 transition-colors"
            >
              {prompt}
            </motion.button>
          ))}
        </div>

        <form onSubmit={handleSend} className="relative flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="What feels most important to unpack right now?"
              className="w-full bg-white/70 rounded-full px-6 py-4 pr-16 focus:outline-none focus:ring-2 focus:ring-serenix-accent/30 text-serenix-ink placeholder:text-serenix-ink/35 shadow-md"
            />
            <button
              type="button"
              onClick={toggleListening}
              className={`absolute right-14 top-1/2 -translate-y-1/2 p-2 rounded-full transition-colors ${isListening ? 'bg-red-100 text-red-500 animate-pulse' : 'text-serenix-ink/30 hover:text-serenix-ink'}`}
            >
              {isListening ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
            <button
              type="submit"
              disabled={!input.trim() || isTyping}
              className="absolute right-2 top-2 bottom-2 w-12 rounded-full bg-serenix-ink text-white flex items-center justify-center disabled:opacity-30 transition-all hover:scale-105 active:scale-95"
            >
              <Send size={18} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
