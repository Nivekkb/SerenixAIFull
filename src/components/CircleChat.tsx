import { useState, useEffect, useRef } from 'react';
import { User } from 'firebase/auth';
import { db } from '../firebase';
import { collection, addDoc, query, orderBy, onSnapshot, limit, doc, updateDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Sparkles, ArrowLeft, Share2, Check, MessageSquare, Heart, BookOpen, Activity, AlertTriangle, PhoneCall, Play, RotateCw } from 'lucide-react';
import { Message, Circle, OperationType } from '../types';
import { handleFirestoreError } from '../utils/errorHandlers';
import ReactMarkdown from 'react-markdown';

interface CircleChatProps {
  user: User;
  circleId: string;
  onBack: () => void;
}

export default function CircleChat({ user, circleId, onBack }: CircleChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [circle, setCircle] = useState<Circle | null>(null);
  const [input, setInput] = useState('');
  const [isMediating, setIsMediating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showActivities, setShowActivities] = useState(false);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);
  const [serverNotice, setServerNotice] = useState<string | null>(null);
  const [isRegeneratingInvite, setIsRegeneratingInvite] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const typingClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const governanceBaseUrl = (
    import.meta.env.VITE_SELF_GOVERNANCE_CIRCLE_URL
    || import.meta.env.VITE_SELF_GOVERNANCE_URL
    || import.meta.env.VITE_SELF_GOVERNANCE_POST_URL
    || import.meta.env.VITE_SELF_GOVERNANCE_PRE_URL
    || ''
  ).trim().replace(/\/+$/, '');

  const parseTimestampMs = (value: unknown): number | null => {
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    if (value && typeof value === 'object' && typeof (value as { toDate?: () => Date }).toDate === 'function') {
      const date = (value as { toDate: () => Date }).toDate();
      const parsed = date.getTime();
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  };

  const clearTypingState = async () => {
    try {
      await deleteDoc(doc(db, `circles/${circleId}/typing`, user.uid));
    } catch {
      // no-op
    }
  };

  const bumpTypingState = async () => {
    try {
      await setDoc(doc(db, `circles/${circleId}/typing`, user.uid), {
        userId: user.uid,
        displayName: user.displayName || 'Someone',
        typing: true,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
    } catch {
      // no-op
    }
  };

  useEffect(() => {
    const unsubscribeCircle = onSnapshot(doc(db, 'circles', circleId), (snap) => {
      if (snap.exists()) {
        setCircle({ id: snap.id, ...snap.data() } as Circle);
      }
    });

    const path = `circles/${circleId}/messages`;
    const q = query(collection(db, path), orderBy('timestamp', 'asc'), limit(100));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const msgs = snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Message));
        setMessages(msgs);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, path);
      },
    );

    return () => {
      unsubscribe();
      unsubscribeCircle();
    };
  }, [circleId]);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  }, [messages, isMediating]);

  useEffect(() => {
    const typingPath = collection(db, `circles/${circleId}/typing`);
    const unsubscribeTyping = onSnapshot(typingPath, (snapshot) => {
      const now = Date.now();
      const active = snapshot.docs
        .map((entry) => entry.data() as { userId?: string; displayName?: string; typing?: boolean; updatedAt?: unknown })
        .filter((entry) => entry.typing === true && entry.userId !== user.uid)
        .filter((entry) => {
          const updatedAtMs = parseTimestampMs(entry.updatedAt);
          if (updatedAtMs === null) return true;
          return now - updatedAtMs < 12000;
        })
        .map((entry) => (entry.displayName || 'Someone').trim())
        .filter((name) => name.length > 0);

      setTypingUsers(Array.from(new Set(active)));
    });

    return () => unsubscribeTyping();
  }, [circleId, user.uid]);

  useEffect(() => () => {
    if (typingClearTimerRef.current) {
      clearTimeout(typingClearTimerRef.current);
      typingClearTimerRef.current = null;
    }
    void clearTypingState();
  }, [circleId, user.uid]);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim()) return;

    const text = input.trim();
    setInput('');
    if (typingClearTimerRef.current) {
      clearTimeout(typingClearTimerRef.current);
      typingClearTimerRef.current = null;
    }
    void clearTypingState();

    const path = `circles/${circleId}/messages`;
    try {
      await addDoc(collection(db, path), {
        content: text,
        senderId: user.uid,
        senderName: user.displayName || 'Anonymous',
        timestamp: new Date().toISOString(),
        type: 'text',
      });

      if (messages.length > 0 && (messages.length + 1) % 3 === 0) {
        triggerMediation([...messages, {
          id: `temp-${Date.now()}`,
          content: text,
          senderId: user.uid,
          senderName: user.displayName || 'Anonymous',
          timestamp: new Date().toISOString(),
          type: 'text',
        }]);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  };

  const callCircleServer = async (path: string, body: Record<string, unknown>) => {
    if (!governanceBaseUrl) {
      throw new Error('Shared circle AI requires VITE_SELF_GOVERNANCE_CIRCLE_URL (or VITE_SELF_GOVERNANCE_URL) to be configured.');
    }

    const token = await user.getIdToken();
    const response = await fetch(`${governanceBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Firebase-Auth': token,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Circle server request failed (${response.status}): ${text}`);
    }

    return response.json();
  };

  const triggerMediation = async (currentMessages: Message[]) => {
    setIsMediating(true);
    try {
      const recentMessages = currentMessages.slice(-8).map((m) => ({
        senderName: m.senderName,
        content: m.content,
      }));

      const result = await callCircleServer('/v1/circles/intervene', {
        circleId,
        presenceMode: circle?.aiPresence || 'facilitation',
        recentMessages,
      });
      setServerNotice(result.posted ? 'Shared AI guidance was added for the group.' : 'No AI facilitation was needed this turn.');
      setTimeout(() => setServerNotice(null), 2500);
    } catch (error) {
      console.error('Mediation failed:', error);
      setServerNotice(error instanceof Error ? error.message : 'Shared AI mediation failed.');
    } finally {
      setIsMediating(false);
    }
  };

  const triggerActivity = async (type: 'starter' | 'gratitude' | 'story' | 'checkin') => {
    setIsMediating(true);
    setShowActivities(false);
    try {
      const recentMessages = messages.slice(-5).map((m) => ({
        senderName: m.senderName,
        content: m.content,
      }));

      await callCircleServer('/v1/circles/activity', {
        circleId,
        type,
        recentMessages,
      });
      setServerNotice('A shared activity prompt was added for the group.');
      setTimeout(() => setServerNotice(null), 2500);
    } catch (error) {
      console.error('Activity failed:', error);
      setServerNotice(error instanceof Error ? error.message : 'Shared circle activity failed.');
    } finally {
      setIsMediating(false);
    }
  };

  const resumeCircle = async () => {
    try {
      await callCircleServer('/v1/circles/resume', { circleId });
      setServerNotice('Shared safety pause was cleared.');
      setTimeout(() => setServerNotice(null), 2500);
    } catch (error) {
      setServerNotice(error instanceof Error ? error.message : 'Unable to clear safety pause.');
    }
  };

  const copyInvite = async () => {
    if (!circle?.inviteCode) {
      setInviteNotice('Invite code is not ready yet.');
      setTimeout(() => setInviteNotice(null), 2500);
      return;
    }

    const expiresText = circle.inviteExpiresAt ? ` This code expires on ${new Date(circle.inviteExpiresAt).toLocaleString()}.` : '';
    const inviteMessage = `You are invited to a private SerenixAI circle. Open SerenixAI, go to Circles, then join with code: ${circle.inviteCode}.${expiresText}`;
    await navigator.clipboard.writeText(inviteMessage);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const regenerateInvite = async () => {
    setIsRegeneratingInvite(true);
    try {
      const result = await callCircleServer('/v1/circles/invite/regenerate', { circleId });
      const inviteCode = typeof result.inviteCode === 'string' ? result.inviteCode : null;
      const expiresAt = typeof result.expiresAt === 'string' ? result.expiresAt : null;
      setCircle((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          inviteCode: inviteCode || prev.inviteCode,
          inviteExpiresAt: expiresAt || prev.inviteExpiresAt || null,
          inviteUpdatedAt: new Date().toISOString(),
          inviteRevokedAt: null,
        };
      });
      setInviteNotice('Invite code regenerated. Old code is now revoked.');
      setTimeout(() => setInviteNotice(null), 3000);
    } catch (error) {
      setInviteNotice(error instanceof Error ? error.message : 'Unable to regenerate invite code right now.');
    } finally {
      setIsRegeneratingInvite(false);
    }
  };

  const updatePresenceMode = async (mode: 'quiet' | 'facilitation' | 'reflection') => {
    try {
      await updateDoc(doc(db, 'circles', circleId), {
        aiPresence: mode,
      });
      setCircle((prev) => (prev ? { ...prev, aiPresence: mode } : null));
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `circles/${circleId}`);
    }
  };

  if (!circle) return null;

  return (
    <div className="flex-1 flex flex-col h-full max-w-5xl mx-auto w-full px-4 py-4">
      <div className="glass rounded-3xl p-4 mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 hover:bg-serenix-blue rounded-full transition-colors">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h2 className="font-serif text-xl font-medium">{circle.name}</h2>
            <p className="text-xs text-serenix-ink/40">{circle.members.length} members</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {circle.createdBy === user.uid && (
            <div className="hidden sm:flex items-center bg-white/30 rounded-full p-1 mr-2">
              {(['quiet', 'facilitation', 'reflection'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => updatePresenceMode(mode)}
                  className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-tighter transition-all ${
                    (circle.aiPresence || 'facilitation') === mode
                      ? 'bg-serenix-ink text-white shadow-sm'
                      : 'text-serenix-ink/40 hover:text-serenix-ink'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => setShowActivities(!showActivities)}
            className={`p-2 rounded-full transition-all ${showActivities ? 'bg-serenix-accent text-white' : 'bg-white/50 hover:bg-white text-serenix-ink'}`}
          >
            <Sparkles size={20} />
          </button>
          <button
            onClick={copyInvite}
            title="Copy invite code"
            className="flex items-center gap-2 px-4 py-2 bg-white/50 rounded-full text-sm font-medium hover:bg-white transition-colors"
          >
            {copied ? <Check size={16} className="text-green-500" /> : <Share2 size={16} />}
            <span>{copied ? 'Copied' : 'Invite'}</span>
          </button>
          {circle.createdBy === user.uid && (
            <button
              onClick={regenerateInvite}
              disabled={isRegeneratingInvite}
              title="Regenerate invite code"
              className="flex items-center gap-2 px-4 py-2 bg-white/50 rounded-full text-sm font-medium hover:bg-white transition-colors disabled:opacity-40"
            >
              <RotateCw size={16} className={isRegeneratingInvite ? 'animate-spin' : ''} />
              <span>{isRegeneratingInvite ? 'Regenerating...' : 'Regenerate'}</span>
            </button>
          )}
        </div>
      </div>

      <div className="glass rounded-[2rem] p-4 md:p-5 h-[72vh] min-h-[32rem] max-h-[48rem] flex flex-col overflow-hidden">
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

        <div className="mb-3 px-3 py-2 rounded-2xl bg-white/45 border border-white/40 text-xs text-serenix-ink/65">
          This circle is for guided support conversations. It is not therapy or emergency care. AI facilitation in this thread is shared across members and posted by the governance service.
        </div>

        {inviteNotice && (
          <div className="mb-3 px-3 py-2 rounded-2xl bg-white/70 border border-white/50 text-xs text-serenix-ink/75">
            {inviteNotice}
          </div>
        )}

        {circle.inviteCode && (
          <div className="mb-3 px-3 py-2 rounded-2xl bg-white/55 border border-white/40 text-xs text-serenix-ink/65">
            Invite code: <span className="font-semibold tracking-wider">{circle.inviteCode}</span>
            {circle.inviteExpiresAt && (
              <span> - Expires {new Date(circle.inviteExpiresAt).toLocaleString()}</span>
            )}
          </div>
        )}

        {serverNotice && (
          <div className="mb-3 px-3 py-2 rounded-2xl bg-white/70 border border-white/50 text-xs text-serenix-ink/75">
            {serverNotice}
          </div>
        )}

        {circle.safetyPauseActive && (
          <div className="mb-3 px-3 py-3 rounded-2xl bg-red-50 border border-red-200 text-xs text-red-700 flex flex-col sm:flex-row sm:items-center gap-3">
            <div>
              <p className="font-semibold uppercase tracking-wide text-[11px]">Safety pause is active for this circle</p>
              <p>{circle.safetyPauseReason || 'This thread was paused for safety because the conversation reached a higher-risk level.'}</p>
            </div>
            {circle.createdBy === user.uid && (
              <button
                type="button"
                onClick={resumeCircle}
                className="sm:ml-auto inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-600 text-white"
              >
                <Play size={12} />
                Resume thread
              </button>
            )}
          </div>
        )}

        <AnimatePresence>
          {showActivities && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="bg-white/45 rounded-3xl p-4 mb-4 grid grid-cols-2 sm:grid-cols-4 gap-3 border border-white/45"
            >
              <button
                onClick={() => triggerActivity('starter')}
                className="flex flex-col items-center gap-2 p-3 rounded-2xl hover:bg-white/60 transition-colors"
              >
                <MessageSquare size={20} className="text-serenix-accent" />
                <span className="text-xs font-medium">Starter</span>
              </button>
              <button
                onClick={() => triggerActivity('gratitude')}
                className="flex flex-col items-center gap-2 p-3 rounded-2xl hover:bg-white/60 transition-colors"
              >
                <Heart size={20} className="text-serenix-accent" />
                <span className="text-xs font-medium">Gratitude</span>
              </button>
              <button
                onClick={() => triggerActivity('story')}
                className="flex flex-col items-center gap-2 p-3 rounded-2xl hover:bg-white/60 transition-colors"
              >
                <BookOpen size={20} className="text-serenix-ink" />
                <span className="text-xs font-medium">Story</span>
              </button>
              <button
                onClick={() => triggerActivity('checkin')}
                className="flex flex-col items-center gap-2 p-3 rounded-2xl hover:bg-white/60 transition-colors"
              >
                <Activity size={20} className="text-serenix-accent" />
                <span className="text-xs font-medium">Check-in</span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex-1 overflow-y-auto space-y-4 mb-4 px-2 custom-scrollbar">
          <div className="text-center py-8 opacity-30">
            <p className="text-xs uppercase tracking-widest font-medium">Circle created on {new Date(circle.createdAt).toLocaleDateString()}</p>
          </div>

          <AnimatePresence initial={false}>
            {messages.map((msg, index) => {
              const previous = messages[index - 1];
              const isGrouped = Boolean(previous && previous.senderId === msg.senderId);

              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex flex-col ${msg.senderId === 'ai' ? `items-center ${isGrouped ? 'mt-2' : 'my-8'}` : msg.senderId === user.uid ? 'items-end mt-1' : 'items-start mt-1'}`}
                >
                  {msg.senderId === 'ai' ? (
                    <div className="max-w-[90%] bg-serenix-accent/10 border border-serenix-accent/20 rounded-[2rem] p-6 text-center">
                      {!isGrouped && (
                        <div className="flex items-center justify-center gap-2 mb-3 text-serenix-accent">
                          <Sparkles size={18} />
                          <span className="text-xs font-bold uppercase tracking-tighter">Shared AI facilitation</span>
                        </div>
                      )}
                      <div className="markdown-body markdown-ai text-serenix-ink italic text-sm md:text-base">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    </div>
                  ) : (
                    <div className={`flex flex-col max-w-[80%] ${msg.senderId === user.uid ? 'items-end' : 'items-start'}`}>
                      {!isGrouped && (
                        <span className="text-[10px] font-bold text-serenix-ink/30 mb-1 px-2 uppercase tracking-wider">
                          {msg.senderId === user.uid ? 'You' : msg.senderName}
                        </span>
                      )}
                      <div className={`px-4 py-2.5 rounded-2xl shadow-sm ${msg.senderId === user.uid ? (isGrouped ? 'bg-serenix-ink text-white' : 'bg-serenix-ink text-white rounded-tr-none') : (isGrouped ? 'bg-white text-serenix-ink' : 'bg-white text-serenix-ink rounded-tl-none')}`}>
                        <p className="text-sm leading-relaxed">{msg.content}</p>
                      </div>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>

          {isMediating && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex justify-center py-4"
            >
              <div className="flex items-center gap-2 text-serenix-accent">
                <Sparkles size={16} className="animate-pulse" />
                <span className="text-xs font-medium italic">SerenixAI is mediating...</span>
              </div>
            </motion.div>
          )}

          {typingUsers.length > 0 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex justify-start py-2"
            >
              <div className="px-3 py-1.5 rounded-full bg-white/70 border border-white/60 text-[11px] text-serenix-ink/65 italic">
                {typingUsers.slice(0, 2).join(', ')} {typingUsers.length > 1 ? 'are' : 'is'} typing...
              </div>
            </motion.div>
          )}
          <div ref={scrollRef} />
        </div>

        <form onSubmit={handleSend} className="relative">
          <input
            type="text"
            value={input}
            onChange={(e) => {
              const nextValue = e.target.value;
              setInput(nextValue);

              if (nextValue.trim()) {
                void bumpTypingState();
                if (typingClearTimerRef.current) clearTimeout(typingClearTimerRef.current);
                typingClearTimerRef.current = setTimeout(() => {
                  void clearTypingState();
                  typingClearTimerRef.current = null;
                }, 2500);
              } else {
                if (typingClearTimerRef.current) {
                  clearTimeout(typingClearTimerRef.current);
                  typingClearTimerRef.current = null;
                }
                void clearTypingState();
              }
            }}
            onBlur={() => {
              if (typingClearTimerRef.current) {
                clearTimeout(typingClearTimerRef.current);
                typingClearTimerRef.current = null;
              }
              void clearTypingState();
            }}
            disabled={Boolean(circle.safetyPauseActive)}
            placeholder={
              circle.safetyPauseActive
                ? 'This thread is paused for safety...'
                : circle.aiPresence === 'quiet'
                  ? 'Share with the circle (quiet facilitation mode)...'
                  : circle.aiPresence === 'reflection'
                    ? 'Share with the circle (active facilitation mode)...'
                    : 'Share with the circle...'
            }
            className={`w-full bg-white/70 rounded-full px-6 py-4 pr-16 focus:outline-none focus:ring-2 focus:ring-serenix-accent/30 text-serenix-ink placeholder:text-serenix-ink/35 shadow-md ${circle.safetyPauseActive ? 'opacity-50 cursor-not-allowed' : ''}`}
          />
          <button
            type="submit"
            disabled={!input.trim() || Boolean(circle.safetyPauseActive)}
            className="absolute right-2 top-2 bottom-2 w-12 rounded-full bg-serenix-ink text-white flex items-center justify-center disabled:opacity-30 transition-all hover:scale-105 active:scale-95"
          >
            <Send size={18} />
          </button>
        </form>
      </div>
    </div>
  );
}
