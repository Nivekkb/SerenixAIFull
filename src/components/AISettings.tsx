import { useState } from 'react';
import { db } from '../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { motion } from 'motion/react';
import { Sparkles, Save, Check, User as UserIcon, Heart, Wind, Zap } from 'lucide-react';
import { UserProfile, AISettings as AISettingsType, OperationType } from '../types';
import { handleFirestoreError } from '../utils/errorHandlers';

interface AISettingsProps {
  user: UserProfile;
  onUpdate: (settings: AISettingsType) => void;
}

const AVATARS = ['✨', '🦋', '🌿', '☁️', '🌙', '🌊', '🦊', '🦉'];
const STYLES: { id: AISettingsType['style'], label: string, icon: any, desc: string }[] = [
  { id: 'empathetic', label: 'Empathetic', icon: Heart, desc: 'Deep validation and emotional mirroring.' },
  { id: 'calm', label: 'Calm', icon: Wind, desc: 'Steady, rhythmic language and grounding.' },
  { id: 'encouraging', label: 'Encouraging', icon: Zap, desc: 'Focus on strengths and small wins.' }
];

export default function AISettings({ user, onUpdate }: AISettingsProps) {
  const [name, setName] = useState(user.aiSettings?.name || 'SerenixAI');
  const [avatar, setAvatar] = useState(user.aiSettings?.avatar || '✨');
  const [style, setStyle] = useState<AISettingsType['style']>(user.aiSettings?.style || 'empathetic');
  const [preferredName, setPreferredName] = useState(user.preferredName || '');
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    // Validation for preferredName: only letters and spaces
    if (preferredName && !/^[a-zA-Z\s]*$/.test(preferredName)) {
      setError('Preferred name can only contain letters and spaces.');
      return;
    }
    setError(null);
    setIsSaving(true);
    const settings: AISettingsType = { name, avatar, style };
    
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        aiSettings: settings,
        preferredName: preferredName.trim() || null
      });
      onUpdate(settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${user.uid}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-8 overflow-y-auto custom-scrollbar">
      <div className="mb-8">
        <h2 className="font-serif text-3xl font-medium">Personalize Your AI</h2>
        <p className="text-serenix-ink/50">Tailor your companion to your emotional needs.</p>
      </div>

      <div className="space-y-8">
        <section className="glass rounded-[2rem] p-8">
          <div className="mb-8">
            <label className="block text-xs font-bold uppercase tracking-widest text-serenix-ink/40 mb-2">What should I call you? (Optional)</label>
            <input
              type="text"
              value={preferredName}
              onChange={(e) => {
                setPreferredName(e.target.value);
                if (error) setError(null);
              }}
              className={`w-full bg-white/50 rounded-2xl px-5 py-3 focus:outline-none focus:ring-2 text-xl font-serif ${error ? 'ring-red-400 ring-2' : 'focus:ring-serenix-accent/30'}`}
              placeholder="Your preferred name..."
            />
            {error && <p className="text-red-500 text-xs mt-2 ml-1">{error}</p>}
            <p className="text-serenix-ink/30 text-[10px] mt-2 uppercase tracking-tighter">Only letters and spaces allowed</p>
          </div>

          <div className="flex items-center gap-6 mb-8">
            <div className="w-20 h-20 rounded-full bg-serenix-blue flex items-center justify-center text-4xl shadow-inner">
              {avatar}
            </div>
            <div className="flex-1">
              <label className="block text-xs font-bold uppercase tracking-widest text-serenix-ink/40 mb-2">Companion Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full bg-white/50 rounded-2xl px-5 py-3 focus:outline-none focus:ring-2 focus:ring-serenix-accent/30 text-xl font-serif"
                placeholder="Name your companion..."
              />
            </div>
          </div>

          <label className="block text-xs font-bold uppercase tracking-widest text-serenix-ink/40 mb-4">Choose an Avatar</label>
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-3">
            {AVATARS.map(av => (
              <button
                key={av}
                onClick={() => setAvatar(av)}
                className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl transition-all ${avatar === av ? 'bg-serenix-accent text-white scale-110 shadow-lg' : 'bg-white/50 hover:bg-white'}`}
              >
                {av}
              </button>
            ))}
          </div>
        </section>

        <section className="glass rounded-[2rem] p-8">
          <label className="block text-xs font-bold uppercase tracking-widest text-serenix-ink/40 mb-6">Conversational Style</label>
          <div className="space-y-4">
            {STYLES.map(s => (
              <button
                key={s.id}
                onClick={() => setStyle(s.id)}
                className={`w-full flex items-start gap-4 p-4 rounded-2xl transition-all border-2 text-left ${style === s.id ? 'bg-serenix-accent/5 border-serenix-accent shadow-sm' : 'bg-white/30 border-transparent hover:bg-white/50'}`}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${style === s.id ? 'bg-serenix-accent text-white' : 'bg-white text-serenix-ink/40'}`}>
                  <s.icon size={20} />
                </div>
                <div>
                  <h4 className="font-medium text-serenix-ink">{s.label}</h4>
                  <p className="text-sm text-serenix-ink/50 font-light">{s.desc}</p>
                </div>
                {style === s.id && <Check size={20} className="ml-auto text-serenix-accent" />}
              </button>
            ))}
          </div>
        </section>

        <button
          onClick={handleSave}
          disabled={isSaving}
          className={`w-full py-4 rounded-full font-medium shadow-xl transition-all flex items-center justify-center gap-2 ${saved ? 'bg-green-500 text-white' : 'bg-serenix-ink text-white hover:bg-serenix-ink/90 active:scale-95'}`}
        >
          {isSaving ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : saved ? (
            <>
              <Check size={20} />
              <span>Preferences Saved</span>
            </>
          ) : (
            <>
              <Save size={20} />
              <span>Save Preferences</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
