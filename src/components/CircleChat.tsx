import { useState, useEffect, useRef } from 'react';
import { User } from 'firebase/auth';
import { db } from '../firebase';
import { collection, addDoc, query, orderBy, onSnapshot, limit, doc, getDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Sparkles, User as UserIcon, ArrowLeft, Share2, Copy, Check, MessageSquare, Heart, BookOpen, Activity } from 'lucide-react';
import { Message, Circle, OperationType } from '../types';
import { handleFirestoreError } from '../utils/errorHandlers';
import { getCircleMediation, getCircleActivity, analyzeCircleConversation, CircleAnalysis } from '../services/gemini';
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
  const [isLocked, setIsLocked] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchCircle = async () => {
      const snap = await getDoc(doc(db, 'circles', circleId));
      if (snap.exists()) {
        setCircle({ id: snap.id, ...snap.data() } as Circle);
      }
    };
    fetchCircle();

    const path = `circles/${circleId}/messages`;
    const q = query(collection(db, path), orderBy('timestamp', 'asc'), limit(100));
    
    const unsubscribe = onSnapshot(q, async (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Message));
      setMessages(msgs);
      
      // Initial AI Invite for new circles
      if (msgs.length === 0 && !isMediating) {
        setIsMediating(true);
        try {
          await addDoc(collection(db, path), {
            content: "Feel free to start the conversation whenever you’re ready. If you'd like a prompt, I can suggest one.",
            senderId: 'ai',
            senderName: 'SerenixAI',
            timestamp: new Date().toISOString(),
            type: 'ai'
          });
        } catch (error) {
          console.error('Initial invite failed:', error);
        } finally {
          setIsMediating(false);
        }
      }

      // Check if last message was a Level 4 mediation to lock the chat
      const lastMsg = msgs[msgs.length - 1];
      if (lastMsg?.senderId === 'ai' && lastMsg.content.includes("ending the current discussion thread for safety")) {
        setIsLocked(true);
      } else {
        setIsLocked(false);
      }

      setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });

    return () => unsubscribe();
  }, [circleId]);

  // Silence detection for new circles
  useEffect(() => {
    if (messages.length === 1 && messages[0].senderId === 'ai' && messages[0].content.includes("whenever you’re ready")) {
      const timer = setTimeout(async () => {
        // Still only the AI invite after 30 seconds
        if (messages.length === 1 && !isMediating) {
          triggerActivity('starter');
        }
      }, 30000); // 30 seconds of silence
      return () => clearTimeout(timer);
    }
  }, [messages, isMediating]);

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLocked) return;

    const text = input.trim();
    setInput('');

    const path = `circles/${circleId}/messages`;
    try {
      await addDoc(collection(db, path), {
        content: text,
        senderId: user.uid,
        senderName: user.displayName || 'Anonymous',
        timestamp: new Date().toISOString(),
        type: 'text'
      });

      // Analyze for conflict/engagement every 3 messages
      if (messages.length > 0 && (messages.length + 1) % 3 === 0) {
        triggerMediation([...messages, { content: text, senderName: user.displayName || 'Anonymous' } as Message]);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  };

  const triggerMediation = async (currentMessages: Message[]) => {
    setIsMediating(true);
    const path = `circles/${circleId}/messages`;
    try {
      const recentMessages = currentMessages.slice(-8).map(m => ({
        senderName: m.senderName,
        content: m.content
      }));
      
      const analysis = await analyzeCircleConversation(recentMessages, circle?.aiPresence || 'facilitation');

      if (analysis.shouldIntervene || analysis.hasConflict) {
        const mediation = await getCircleMediation(recentMessages, analysis, circle?.aiPresence || 'facilitation');

        await addDoc(collection(db, path), {
          content: mediation,
          senderId: 'ai',
          senderName: 'SerenixAI',
          timestamp: new Date().toISOString(),
          type: 'ai'
        });

        if (analysis.level === 4) {
          setIsLocked(true);
        }
      }
    } catch (error) {
      console.error('Mediation failed:', error);
    } finally {
      setIsMediating(false);
    }
  };

  const triggerActivity = async (type: 'starter' | 'gratitude' | 'story' | 'checkin') => {
    setIsMediating(true);
    setShowActivities(false);
    const path = `circles/${circleId}/messages`;
    try {
      const recentMessages = messages.slice(-5).map(m => ({
        senderName: m.senderName,
        content: m.content
      }));
      
      const activity = await getCircleActivity(type, recentMessages);

      await addDoc(collection(db, path), {
        content: activity,
        senderId: 'ai',
        senderName: 'SerenixAI',
        timestamp: new Date().toISOString(),
        type: 'ai'
      });
    } catch (error) {
      console.error('Activity failed:', error);
    } finally {
      setIsMediating(false);
    }
  };

  const copyInvite = () => {
    const url = `${window.location.origin}/join/${circleId}`;
    const message = `Hey, I made a small private circle on SerenixAI for a few of us to check in and share what’s been going on in life. It’s pretty relaxed and optional, but I thought you might like being part of it. Here’s the link if you want to see it: ${url}`;
    
    navigator.clipboard.writeText(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const updatePresenceMode = async (mode: 'quiet' | 'facilitation' | 'reflection') => {
    try {
      await updateDoc(doc(db, 'circles', circleId), {
        aiPresence: mode
      });
      setCircle(prev => prev ? { ...prev, aiPresence: mode } : null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `circles/${circleId}`);
    }
  };

  if (!circle) return null;

  return (
    <div className="flex-1 flex flex-col h-full max-w-5xl mx-auto w-full px-4 py-4">
      {/* Header */}
      <div className="glass rounded-3xl p-4 mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-2 hover:bg-serenix-blue rounded-full transition-colors">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h2 className="font-serif text-xl font-medium">{circle.name}</h2>
            <p className="text-xs text-serenix-ink/40">{circle.members.length} members in circle</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
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
          <button 
            onClick={() => setShowActivities(!showActivities)}
            className={`p-2 rounded-full transition-all ${showActivities ? 'bg-serenix-accent text-white' : 'bg-white/50 hover:bg-white text-serenix-ink'}`}
          >
            <Sparkles size={20} />
          </button>
          <button 
            onClick={copyInvite}
            title="Copy a warm invite message to your clipboard"
            className="flex items-center gap-2 px-4 py-2 bg-white/50 rounded-full text-sm font-medium hover:bg-white transition-colors"
          >
            {copied ? <Check size={16} className="text-green-500" /> : <Share2 size={16} />}
            <span>{copied ? 'Message Copied' : 'Invite'}</span>
          </button>
        </div>
      </div>

      {/* Activities Menu */}
      <AnimatePresence>
        {showActivities && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="glass rounded-3xl p-4 mb-4 grid grid-cols-2 sm:grid-cols-4 gap-3"
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
              <Heart size={20} className="text-pink-400" />
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
              <Activity size={20} className="text-green-500" />
              <span className="text-xs font-medium">Check-in</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto space-y-4 mb-4 px-2 custom-scrollbar">
        <div className="text-center py-8 opacity-30">
          <p className="text-xs uppercase tracking-widest font-medium">Circle created on {new Date(circle.createdAt).toLocaleDateString()}</p>
        </div>

        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex flex-col ${msg.senderId === 'ai' ? 'items-center my-8' : msg.senderId === user.uid ? 'items-end' : 'items-start'}`}
            >
              {msg.senderId === 'ai' ? (
                <div className="max-w-[90%] bg-serenix-accent/10 border border-serenix-accent/20 rounded-[2rem] p-6 text-center">
                  <div className="flex items-center justify-center gap-2 mb-3 text-serenix-accent">
                    <Sparkles size={18} />
                    <span className="text-xs font-bold uppercase tracking-tighter">AI Reflection</span>
                  </div>
                  <div className="markdown-body markdown-ai text-serenix-ink italic text-sm md:text-base">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                </div>
              ) : (
                <div className={`flex flex-col max-w-[80%] ${msg.senderId === user.uid ? 'items-end' : 'items-start'}`}>
                  <span className="text-[10px] font-bold text-serenix-ink/30 mb-1 px-2 uppercase tracking-wider">
                    {msg.senderId === user.uid ? 'You' : msg.senderName}
                  </span>
                  <div className={`px-4 py-2.5 rounded-2xl shadow-sm ${msg.senderId === user.uid ? 'bg-serenix-ink text-white rounded-tr-none' : 'bg-white text-serenix-ink rounded-tl-none'}`}>
                    <p className="text-sm leading-relaxed">{msg.content}</p>
                  </div>
                </div>
              )}
            </motion.div>
          ))}
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
        <div ref={scrollRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="relative">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isLocked}
          placeholder={
            isLocked 
              ? "This thread is temporarily paused for safety..." 
              : (circle.aiPresence === 'quiet' 
                  ? "Share with the circle (AI is in Quiet Mode)..." 
                  : (circle.aiPresence === 'reflection' 
                      ? "Share with the circle (AI is in Reflection Mode)..." 
                      : "Share with the circle..."))
          }
          className={`w-full glass rounded-full px-6 py-4 pr-16 focus:outline-none focus:ring-2 focus:ring-serenix-accent/30 text-serenix-ink placeholder:text-serenix-ink/30 shadow-lg ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
        />
        <button
          type="submit"
          disabled={!input.trim() || isLocked}
          className="absolute right-2 top-2 bottom-2 w-12 rounded-full bg-serenix-ink text-white flex items-center justify-center disabled:opacity-30 transition-all hover:scale-105 active:scale-95"
        >
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}
