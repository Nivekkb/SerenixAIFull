import { useState } from 'react';
import { db } from '../firebase';
import { doc, updateDoc, collection, getDocs, query, limit, writeBatch, deleteField } from 'firebase/firestore';
import { Save, Check, Database, Trash2 } from 'lucide-react';
import { UserProfile, OperationType, ResponseLength } from '../types';
import { handleFirestoreError } from '../utils/errorHandlers';

interface AISettingsProps {
  user: UserProfile;
}

export default function AISettings({ user }: AISettingsProps) {
  const [preferredName, setPreferredName] = useState(user.preferredName || '');
  const [responseLength, setResponseLength] = useState<ResponseLength>(user.responseLength || 'short');
  const [retentionMode, setRetentionMode] = useState<'ephemeral' | 'persistent'>(user.chatRetentionMode || 'ephemeral');
  const [consentEnabled, setConsentEnabled] = useState(Boolean(user.sensitiveDataConsentAt));
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isDeletingTranscript, setIsDeletingTranscript] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const deletePrivateTranscript = async () => {
    setDeleteStatus(null);
    setIsDeletingTranscript(true);
    try {
      let hasMore = true;
      while (hasMore) {
        const page = await getDocs(query(collection(db, `private_chats/${user.uid}/messages`), limit(400)));
        if (page.empty) {
          hasMore = false;
          break;
        }

        const batch = writeBatch(db);
        page.docs.forEach((item) => batch.delete(item.ref));
        await batch.commit();
        hasMore = page.size === 400;
      }

      await updateDoc(doc(db, 'users', user.uid), {
        chatRetentionMode: 'ephemeral',
      });
      setRetentionMode('ephemeral');
      setDeleteStatus('Private transcript deleted. Retention set to ephemeral.');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `private_chats/${user.uid}/messages`);
    } finally {
      setIsDeletingTranscript(false);
    }
  };

  const handleSave = async () => {
    if (preferredName && !/^[a-zA-Z\s]*$/.test(preferredName)) {
      setError('Preferred name can only contain letters and spaces.');
      return;
    }

    setError(null);
    setIsSaving(true);

    try {
      await updateDoc(doc(db, 'users', user.uid), {
        aiSettings: deleteField(),
        preferredName: preferredName.trim() || null,
        responseLength,
        chatRetentionMode: retentionMode,
        sensitiveDataConsentAt: consentEnabled
          ? (user.sensitiveDataConsentAt || new Date().toISOString())
          : null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex-1 max-w-3xl mx-auto w-full px-4 py-8 flex flex-col">
      <div className="mb-8">
        <h2 className="font-serif text-3xl font-medium">Tool Settings</h2>
        <p className="text-serenix-ink/50">Choose how this check-in space addresses you and handles your data.</p>
      </div>

      <div className="glass rounded-[2rem] p-4 md:p-6 h-[72vh] min-h-[32rem] max-h-[48rem] flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
          <div className="space-y-6">
            <section className="bg-white/45 border border-white/45 rounded-[2rem] p-8">
          <div className="mb-2">
            <label className="block text-xs font-bold uppercase tracking-widest text-serenix-ink/40 mb-2">
              Preferred name (optional)
            </label>
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
            </section>

            <section className="bg-white/45 border border-white/45 rounded-[2rem] p-8">
          <div className="mb-4">
            <h3 className="font-serif text-xl">Response Length</h3>
            <p className="text-sm text-serenix-ink/50">Default is short to keep things easier to take in during heavy moments.</p>
          </div>
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setResponseLength('short')}
              className={`w-full text-left p-4 rounded-2xl border-2 transition-all ${responseLength === 'short' ? 'border-serenix-accent bg-serenix-accent/5' : 'border-transparent bg-white/35 hover:bg-white/55'}`}
            >
              <p className="font-medium">Short (default)</p>
              <p className="text-xs text-serenix-ink/55 mt-1">1-3 concise sentences, easiest to read when you feel overloaded.</p>
            </button>
            <button
              type="button"
              onClick={() => setResponseLength('medium')}
              className={`w-full text-left p-4 rounded-2xl border-2 transition-all ${responseLength === 'medium' ? 'border-serenix-accent bg-serenix-accent/5' : 'border-transparent bg-white/35 hover:bg-white/55'}`}
            >
              <p className="font-medium">Medium</p>
              <p className="text-xs text-serenix-ink/55 mt-1">Balanced detail with moderate length.</p>
            </button>
            <button
              type="button"
              onClick={() => setResponseLength('long')}
              className={`w-full text-left p-4 rounded-2xl border-2 transition-all ${responseLength === 'long' ? 'border-serenix-accent bg-serenix-accent/5' : 'border-transparent bg-white/35 hover:bg-white/55'}`}
            >
              <p className="font-medium">Long</p>
              <p className="text-xs text-serenix-ink/55 mt-1">More detail and context when you want a deeper response.</p>
            </button>
          </div>
            </section>

            <section className="bg-white/45 border border-white/45 rounded-[2rem] p-8">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-xl bg-white/70 flex items-center justify-center text-serenix-ink/60">
              <Database size={18} />
            </div>
            <div>
              <h3 className="font-serif text-xl">Chat Privacy Controls</h3>
              <p className="text-sm text-serenix-ink/50">Choose how private chat text is handled.</p>
            </div>
          </div>

          <div className="space-y-3 mb-5">
            <button
              type="button"
              onClick={() => setRetentionMode('ephemeral')}
              className={`w-full text-left p-4 rounded-2xl border-2 transition-all ${retentionMode === 'ephemeral' ? 'border-serenix-accent bg-serenix-accent/5' : 'border-transparent bg-white/35 hover:bg-white/55'}`}
            >
              <p className="font-medium">Ephemeral (recommended)</p>
              <p className="text-xs text-serenix-ink/55 mt-1">Messages stay in your active session and are not saved as transcript history.</p>
            </button>
            <button
              type="button"
              onClick={() => setRetentionMode('persistent')}
              className={`w-full text-left p-4 rounded-2xl border-2 transition-all ${retentionMode === 'persistent' ? 'border-serenix-accent bg-serenix-accent/5' : 'border-transparent bg-white/35 hover:bg-white/55'}`}
            >
              <p className="font-medium">Persistent</p>
              <p className="text-xs text-serenix-ink/55 mt-1">Your messages and AI replies are stored in your private transcript until you delete them.</p>
            </button>
          </div>

          <label className="flex items-start gap-3 text-sm mb-4">
            <input
              type="checkbox"
              checked={consentEnabled}
              onChange={(e) => setConsentEnabled(e.target.checked)}
              className="mt-0.5"
            />
            <span className="text-serenix-ink/70">
              I understand this space may process sensitive emotional text and that it is not therapy or emergency care.
            </span>
          </label>

          <p className="text-xs text-serenix-ink/55 mb-4">
            In persistent mode, saved transcripts include both what you wrote and what the AI replied, so you can review the full exchange later.
          </p>

          <button
            type="button"
            onClick={deletePrivateTranscript}
            disabled={isDeletingTranscript}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/70 hover:bg-white text-serenix-ink/75 text-sm border border-serenix-ink/10 disabled:opacity-40"
          >
            <Trash2 size={14} />
            {isDeletingTranscript ? 'Deleting transcript...' : 'Delete private transcript'}
          </button>
          {deleteStatus && <p className="text-xs text-serenix-ink/55 mt-3">{deleteStatus}</p>}
            </section>
          </div>
        </div>

        <div className="pt-4 mt-4 border-t border-white/40">
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
                <span>Save Settings</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
