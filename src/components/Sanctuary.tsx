import { useState, useEffect, useRef } from 'react';
import { User } from 'firebase/auth';
import { db } from '../firebase';
import { collection, addDoc, query, orderBy, onSnapshot, limit } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Sparkles, User as UserIcon, Wind, Mic, MicOff } from 'lucide-react';
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
  "Can we do a breathing exercise?",
  "I just need to vent.",
  "Tell me something encouraging."
];

export default function Sanctuary({ user, profile }: SanctuaryProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [showFallbackHint, setShowFallbackHint] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);

  const aiName = profile?.aiSettings?.name || 'SerenixAI';
  const aiAvatar = profile?.aiSettings?.avatar || '✨';

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = false;
      recognitionRef.current.lang = 'en-US';

      recognitionRef.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInput(prev => prev + (prev ? ' ' : '') + transcript);
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

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      setIsListening(true);
      recognitionRef.current?.start();
    }
  };

  useEffect(() => {
    const path = `private_chats/${user.uid}/messages`;
    const q = query(collection(db, path), orderBy('timestamp', 'asc'), limit(50));
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Message));
      setMessages(msgs);
      setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    });

    return () => unsubscribe();
  }, [user.uid]);

  const handleSend = async (e?: React.FormEvent, customText?: string) => {
    e?.preventDefault();
    const messageToSend = customText || input.trim();
    if (!messageToSend || isTyping) return;

    setInput('');
    setIsTyping(true);

    const path = `private_chats/${user.uid}/messages`;
    
    try {
      // 1. Save user message
      await addDoc(collection(db, path), {
        content: messageToSend,
        senderId: user.uid,
        senderName: user.displayName || 'You',
        timestamp: new Date().toISOString(),
        type: 'text'
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
      setIsTyping(false);
      return;
    }

    let aiText = '';
    try {
      // 2. Get AI response
      const history = messages.map(m => ({
        role: (m.senderId === 'ai' ? 'model' : 'user') as 'user' | 'model',
        parts: [{ text: m.content }]
      }));
      
      aiText = await getAIResponse(messageToSend, history, profile?.aiSettings, profile?.preferredName, user.uid);
      const status = getLastAIResponseStatus();
      if (status.fallbackActive) {
        setShowFallbackHint(true);
      }
    } catch (error) {
      console.error('Gemini response error:', error);
      setShowFallbackHint(true);
      aiText = "There was a connection issue on the AI side. You can keep sharing here, and if it helps, consider reaching out to someone you trust while we reconnect.";
    }

    try {
      // 3. Save AI message
      await addDoc(collection(db, path), {
        content: aiText,
        senderId: 'ai',
        senderName: aiName,
        timestamp: new Date().toISOString(),
        type: 'ai'
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full max-w-4xl mx-auto w-full px-4 py-6">
      <div className="flex items-center gap-3 mb-6 px-2">
        <div className="w-10 h-10 rounded-full bg-serenix-accent flex items-center justify-center text-white shadow-md text-xl">
          {aiAvatar === '✨' ? <Wind size={20} /> : aiAvatar}
        </div>
        <div>
          <h2 className="font-serif text-2xl font-medium">{aiName}'s Sanctuary</h2>
          <p className="text-serenix-ink/50 text-sm">A safe space to breathe and vent.</p>
          {showFallbackHint && (
            <p className="text-[10px] text-serenix-ink/25 tracking-wide" title="Backup deterministic safety mode is active">
              backup mode
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-6 mb-6 px-2 custom-scrollbar">
        {messages.length === 0 && !isTyping && (
          <div className="h-full flex flex-col items-center justify-center text-center opacity-40 py-20">
            <Sparkles size={48} className="mb-4" />
            <p className="text-lg font-serif italic">"Take a deep breath. This space is here to listen."</p>
          </div>
        )}
        
        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex ${msg.senderId === 'ai' ? 'justify-start' : 'justify-end'}`}
            >
              <div className={`flex gap-3 max-w-[85%] ${msg.senderId === 'ai' ? 'flex-row' : 'flex-row-reverse'}`}>
                <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center ${msg.senderId === 'ai' ? 'bg-serenix-accent text-white' : 'bg-white text-serenix-ink'}`}>
                  {msg.senderId === 'ai' ? <Sparkles size={14} /> : <UserIcon size={14} />}
                </div>
                <div className={`px-4 py-3 rounded-2xl shadow-sm ${msg.senderId === 'ai' ? 'bg-white text-serenix-ink rounded-tl-none' : 'bg-serenix-ink text-white rounded-tr-none'}`}>
                  <div className={`markdown-body text-sm leading-relaxed ${msg.senderId === 'ai' ? 'markdown-ai' : 'markdown-user'}`}>
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
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
              <span className="text-xs text-serenix-ink/40 font-medium italic">SerenixAI is reflecting...</span>
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
            className="text-xs bg-white/40 hover:bg-white/60 text-serenix-ink/70 px-4 py-2 rounded-full border border-white/20 transition-colors"
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
            placeholder="How are you feeling right now?"
            className="w-full glass rounded-full px-6 py-4 pr-16 focus:outline-none focus:ring-2 focus:ring-serenix-accent/30 text-serenix-ink placeholder:text-serenix-ink/30 shadow-lg"
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
  );
}
