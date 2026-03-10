import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { db } from '../firebase';
import { collection, addDoc, query, onSnapshot, orderBy, where, doc, updateDoc, arrayUnion, limit } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import { Plus, Users, ArrowRight, Sparkles, X } from 'lucide-react';
import { Circle, OperationType } from '../types';
import { handleFirestoreError } from '../utils/errorHandlers';

interface CirclesProps {
  user: User;
  onJoinCircle: (id: string) => void;
}

export default function Circles({ user, onJoinCircle }: CirclesProps) {
  const [circles, setCircles] = useState<Circle[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const [activeTab, setActiveTab] = useState<'my' | 'discover'>('my');
  const [discoverCircles, setDiscoverCircles] = useState<Circle[]>([]);

  useEffect(() => {
    // Show circles where user is a member
    const q = query(
      collection(db, 'circles'),
      where('members', 'array-contains', user.uid),
      orderBy('createdAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Circle));
      setCircles(list);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'circles');
    });

    return () => unsubscribe();
  }, [user.uid]);

  useEffect(() => {
    if (activeTab === 'discover') {
      const q = query(
        collection(db, 'circles'),
        orderBy('createdAt', 'desc'),
        limit(20)
      );

      const unsubscribe = onSnapshot(q, (snapshot) => {
        const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Circle));
        // Filter out circles user is already in
        setDiscoverCircles(list.filter(c => !c.members.includes(user.uid)));
      });

      return () => unsubscribe();
    }
  }, [activeTab, user.uid]);

  const handleJoin = async (circleId: string) => {
    try {
      const circleRef = doc(db, 'circles', circleId);
      await updateDoc(circleRef, {
        members: arrayUnion(user.uid)
      });
      onJoinCircle(circleId);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `circles/${circleId}`);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    try {
      const docRef = await addDoc(collection(db, 'circles'), {
        name: newName.trim(),
        description: newDesc.trim(),
        createdBy: user.uid,
        members: [user.uid],
        createdAt: new Date().toISOString(),
        aiPresence: 'facilitation'
      });
      setIsCreating(false);
      setNewName('');
      setNewDesc('');
      onJoinCircle(docRef.id);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'circles');
    }
  };

  return (
    <div className="flex-1 max-w-5xl mx-auto w-full px-4 py-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
        <div>
          <h2 className="font-serif text-3xl font-medium">Support Circles</h2>
          <p className="text-serenix-ink/50">Shared spaces for collective healing.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="bg-white/40 p-1 rounded-full flex">
            <button 
              onClick={() => setActiveTab('my')}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${activeTab === 'my' ? 'bg-white text-serenix-ink shadow-sm' : 'text-serenix-ink/40'}`}
            >
              My Circles
            </button>
            <button 
              onClick={() => setActiveTab('discover')}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all ${activeTab === 'discover' ? 'bg-white text-serenix-ink shadow-sm' : 'text-serenix-ink/40'}`}
            >
              Discover
            </button>
          </div>
          <button
            onClick={() => setIsCreating(true)}
            className="flex items-center gap-2 bg-serenix-accent text-white px-5 py-2.5 rounded-full shadow-lg hover:scale-105 transition-transform active:scale-95"
          >
            <Plus size={20} />
            <span className="font-medium hidden sm:inline">New Circle</span>
          </button>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'my' ? (
          <motion.div
            key="my-circles"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
          >
            {circles.length === 0 ? (
              <div className="glass rounded-3xl p-12 text-center flex flex-col items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-serenix-blue flex items-center justify-center text-serenix-accent">
                  <Users size={32} />
                </div>
                <h3 className="font-serif text-xl font-medium">No Circles Yet</h3>
                <p className="text-serenix-ink/60 max-w-md">
                  Create your first circle to invite friends and support each other with AI mediation.
                </p>
                <button
                  onClick={() => setIsCreating(true)}
                  className="text-serenix-accent font-medium hover:underline"
                >
                  Create one now
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {circles.map((circle) => (
                  <motion.div
                    key={circle.id}
                    whileHover={{ y: -5 }}
                    className="glass rounded-3xl p-6 flex flex-col h-full cursor-pointer group"
                    onClick={() => onJoinCircle(circle.id)}
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className="w-10 h-10 rounded-xl bg-serenix-pink flex items-center justify-center text-serenix-ink/70">
                        <Users size={20} />
                      </div>
                      <div className="flex items-center gap-1 text-xs font-medium text-serenix-ink/40">
                        <Sparkles size={12} />
                        <span>AI Mediated</span>
                      </div>
                    </div>
                    <h3 className="font-serif text-xl font-medium mb-2 group-hover:text-serenix-accent transition-colors">
                      {circle.name}
                    </h3>
                    <p className="text-serenix-ink/60 text-sm line-clamp-2 mb-6 flex-1">
                      {circle.description || 'A safe space for support and connection.'}
                    </p>
                    <div className="flex items-center justify-between pt-4 border-t border-serenix-ink/5">
                      <span className="text-xs text-serenix-ink/40">{circle.members.length} members</span>
                      <div className="text-serenix-accent flex items-center gap-1 font-medium text-sm">
                        <span>Enter</span>
                        <ArrowRight size={16} />
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        ) : (
          <motion.div
            key="discover-circles"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
          >
            {discoverCircles.length === 0 ? (
              <div className="glass rounded-3xl p-12 text-center flex flex-col items-center gap-4">
                <p className="text-serenix-ink/60">No new circles to discover right now.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {discoverCircles.map((circle) => (
                  <motion.div
                    key={circle.id}
                    whileHover={{ y: -5 }}
                    className="glass rounded-3xl p-6 flex flex-col h-full"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className="w-10 h-10 rounded-xl bg-serenix-blue flex items-center justify-center text-serenix-ink/70">
                        <Users size={20} />
                      </div>
                    </div>
                    <h3 className="font-serif text-xl font-medium mb-2">{circle.name}</h3>
                    <p className="text-serenix-ink/60 text-sm line-clamp-2 mb-6 flex-1">
                      {circle.description || 'A safe space for support and connection.'}
                    </p>
                    <button 
                      onClick={() => handleJoin(circle.id)}
                      className="w-full py-2.5 rounded-full bg-serenix-ink text-white font-medium text-sm hover:bg-serenix-ink/90 transition-all"
                    >
                      Join Circle
                    </button>
                  </motion.div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Create Modal */}
      <AnimatePresence>
        {isCreating && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-serenix-ink/20 backdrop-blur-sm"
              onClick={() => setIsCreating(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-[2.5rem] p-8 shadow-2xl"
            >
              <button
                onClick={() => setIsCreating(false)}
                className="absolute top-6 right-6 text-serenix-ink/20 hover:text-serenix-ink transition-colors"
              >
                <X size={24} />
              </button>
              <h3 className="font-serif text-2xl font-medium mb-6">Create a Circle</h3>
              <form onSubmit={handleCreate} className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-serenix-ink/60 mb-2 ml-1">Circle Name</label>
                  <input
                    autoFocus
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g., Sunday Reflection"
                    className="w-full bg-serenix-blue/50 rounded-2xl px-5 py-3.5 focus:outline-none focus:ring-2 focus:ring-serenix-accent/30 text-serenix-ink"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-serenix-ink/60 mb-2 ml-1">Description (Optional)</label>
                  <textarea
                    value={newDesc}
                    onChange={(e) => setNewDesc(e.target.value)}
                    placeholder="What is this circle for?"
                    rows={3}
                    className="w-full bg-serenix-blue/50 rounded-2xl px-5 py-3.5 focus:outline-none focus:ring-2 focus:ring-serenix-accent/30 text-serenix-ink resize-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!newName.trim()}
                  className="w-full bg-serenix-ink text-white py-4 rounded-full font-medium shadow-xl hover:bg-serenix-ink/90 transition-all active:scale-95 disabled:opacity-30"
                >
                  Create Circle
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
