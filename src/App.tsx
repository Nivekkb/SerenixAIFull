import { useState, useEffect } from 'react';
import { auth, db } from './firebase';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, signOut, User } from 'firebase/auth';
import { doc, setDoc, onSnapshot } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import { MessageCircle, Users, LogOut, Sparkles, Menu, X, Settings } from 'lucide-react';
import { UserProfile } from './types';
import Landing from './components/Landing';
import Sanctuary from './components/Sanctuary';
import Circles from './components/Circles';
import CircleChat from './components/CircleChat';
import AISettings from './components/AISettings';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'landing' | 'sanctuary' | 'circles' | 'circle-chat' | 'settings'>('landing');
  const [activeCircleId, setActiveCircleId] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    let unsubscribeProfile: (() => void) | undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const userRef = doc(db, 'users', firebaseUser.uid);

        unsubscribeProfile = onSnapshot(userRef, (snap) => {
          if (snap.exists()) {
            setProfile(snap.data() as UserProfile);
          } else {
            const newUser: UserProfile = {
              uid: firebaseUser.uid,
              displayName: firebaseUser.displayName || 'Anonymous',
              email: firebaseUser.email || '',
              photoURL: firebaseUser.photoURL || undefined,
              createdAt: new Date().toISOString(),
              responseLength: 'short',
              chatRetentionMode: 'ephemeral',
              sensitiveDataConsentAt: null,
            };
            setDoc(userRef, newUser);
          }
        });

        setUser(firebaseUser);
        if (view === 'landing') setView('sanctuary');
      } else {
        setUser(null);
        setProfile(null);
        setView('landing');
        if (unsubscribeProfile) unsubscribeProfile();
      }
      setLoading(false);
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeProfile) unsubscribeProfile();
    };
  }, []);

  const handleLogin = async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error('Login failed:', error);
    }
  };

  const handleLogout = () => {
    signOut(auth);
    setIsMenuOpen(false);
  };

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-serenix-blue">
        <motion.div
          animate={{ scale: [1, 1.1, 1], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="text-serenix-accent"
        >
          <Sparkles size={48} />
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-serenix-blue via-serenix-lavender to-serenix-pink">
      {user && (
        <nav className="glass sticky top-0 z-50 px-4 py-3 flex items-center justify-between">
          <div
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => setView('sanctuary')}
          >
            <div className="w-8 h-8 rounded-full bg-serenix-accent flex items-center justify-center text-white">
              <Sparkles size={18} />
            </div>
            <span className="font-serif text-xl font-medium tracking-tight">SerenixAI</span>
          </div>

          <div className="hidden md:flex items-center gap-6">
            <button
              onClick={() => setView('sanctuary')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full transition-colors ${view === 'sanctuary' ? 'bg-white/60 text-serenix-ink font-medium' : 'text-serenix-ink/60 hover:text-serenix-ink'}`}
            >
              <MessageCircle size={18} />
              <span>Check-In</span>
            </button>
            <button
              onClick={() => setView('circles')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full transition-colors ${view === 'circles' || view === 'circle-chat' ? 'bg-white/60 text-serenix-ink font-medium' : 'text-serenix-ink/60 hover:text-serenix-ink'}`}
            >
              <Users size={18} />
              <span>Circles</span>
            </button>
            <button
              onClick={() => setView('settings')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full transition-colors ${view === 'settings' ? 'bg-white/60 text-serenix-ink font-medium' : 'text-serenix-ink/60 hover:text-serenix-ink'}`}
            >
              <Settings size={18} />
              <span>Settings</span>
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 px-3 py-1.5 text-serenix-ink/60 hover:text-red-400 transition-colors"
            >
              <LogOut size={18} />
              <span>Sign Out</span>
            </button>
          </div>

          <button className="md:hidden text-serenix-ink" onClick={() => setIsMenuOpen(!isMenuOpen)}>
            {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </nav>
      )}

      <AnimatePresence>
        {isMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="md:hidden fixed inset-0 z-40 bg-white/90 backdrop-blur-xl pt-20 px-6 flex flex-col gap-8"
          >
            <button
              onClick={() => { setView('sanctuary'); setIsMenuOpen(false); }}
              className="flex items-center gap-4 text-2xl font-serif"
            >
              <MessageCircle size={28} className="text-serenix-accent" />
              <span>Check-In</span>
            </button>
            <button
              onClick={() => { setView('circles'); setIsMenuOpen(false); }}
              className="flex items-center gap-4 text-2xl font-serif"
            >
              <Users size={28} className="text-serenix-accent" />
              <span>Circles</span>
            </button>
            <button
              onClick={() => { setView('settings'); setIsMenuOpen(false); }}
              className="flex items-center gap-4 text-2xl font-serif"
            >
              <Settings size={28} className="text-serenix-accent" />
              <span>Settings</span>
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-4 text-2xl font-serif text-red-400"
            >
              <LogOut size={28} />
              <span>Sign Out</span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <main className="flex-1 flex flex-col overflow-hidden">
        <AnimatePresence mode="wait">
          {view === 'landing' && <Landing key="landing" onLogin={handleLogin} />}
          {view === 'sanctuary' && user && <Sanctuary key="sanctuary" user={user} profile={profile} />}
          {view === 'circles' && user && (
            <Circles
              key="circles"
              user={user}
              onJoinCircle={(id) => {
                setActiveCircleId(id);
                setView('circle-chat');
              }}
            />
          )}
          {view === 'circle-chat' && user && activeCircleId && (
            <CircleChat
              key="circle-chat"
              user={user}
              circleId={activeCircleId}
              onBack={() => setView('circles')}
            />
          )}
          {view === 'settings' && profile && (
            <AISettings
              key="settings"
              user={profile}
            />
          )}
        </AnimatePresence>
      </main>

      {!user && view === 'landing' && (
        <footer className="p-6 text-center text-serenix-ink/40 text-sm">
          <p>(c) {new Date().getFullYear()} SerenixAI - Private reflection space with clear safety boundaries</p>
        </footer>
      )}
    </div>
  );
}
