import { motion } from 'motion/react';
import { Sparkles, Heart, Users, Wind, Shield } from 'lucide-react';

interface LandingProps {
  onLogin: () => void;
}

export default function Landing({ onLogin }: LandingProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 text-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8 }}
        className="mb-8"
      >
        <div className="w-24 h-24 rounded-full bg-serenix-accent flex items-center justify-center text-white mx-auto mb-6 shadow-lg shadow-serenix-accent/20">
          <Sparkles size={48} />
        </div>
        <h1 className="font-serif text-5xl md:text-7xl font-medium tracking-tight mb-4">
          Welcome to <span className="italic">SerenixAI</span>
        </h1>
        <p className="text-xl md:text-2xl text-serenix-ink/70 max-w-2xl mx-auto font-light leading-relaxed">
          A private space for thoughtful check-ins and reflection when life feels heavy.
        </p>
        <p className="mt-4 text-sm md:text-base text-serenix-ink/55 max-w-2xl mx-auto">
          SerenixAI supports reflection and next steps. It is not therapy or emergency care, and it cannot replace professional or personal support.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.8 }}
        className="flex flex-col gap-4 w-full max-w-sm"
      >
        <button
          onClick={onLogin}
          className="bg-serenix-ink text-white px-8 py-4 rounded-full text-lg font-medium shadow-xl hover:bg-serenix-ink/90 transition-all active:scale-95"
        >
          Start Check-In
        </button>
        <p className="text-serenix-ink/40 text-sm">
          Find clear prompts and gentle nudges toward real-world support in one place.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8, duration: 1 }}
        className="mt-24 grid grid-cols-1 md:grid-cols-3 gap-12 max-w-5xl"
      >
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-white/50 flex items-center justify-center text-serenix-accent">
            <Heart size={24} />
          </div>
          <h3 className="font-serif text-xl font-medium">Private Check-In Space</h3>
          <p className="text-serenix-ink/60 font-light">
            Take a breath, name what you are feeling, and choose one next step.
          </p>
        </div>
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-white/50 flex items-center justify-center text-serenix-accent">
            <Users size={24} />
          </div>
          <h3 className="font-serif text-xl font-medium">Invite-Only Circles</h3>
          <p className="text-serenix-ink/60 font-light">
            Create private group spaces with people you trust using invite links or codes.
          </p>
        </div>
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-white/50 flex items-center justify-center text-serenix-accent">
            <Shield size={24} />
          </div>
          <h3 className="font-serif text-xl font-medium">Scope & Safety</h3>
          <p className="text-serenix-ink/60 font-light">
            Designed for reflective support. If you may be at risk, use immediate human help resources.
          </p>
        </div>
      </motion.div>

      {/* Floating decorative elements */}
      <motion.div
        animate={{ 
          y: [0, -20, 0],
          rotate: [0, 5, 0]
        }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        className="fixed top-20 left-[10%] text-serenix-accent/20 -z-10"
      >
        <Wind size={120} />
      </motion.div>
      <motion.div
        animate={{ 
          y: [0, 20, 0],
          rotate: [0, -5, 0]
        }}
        transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        className="fixed bottom-20 right-[10%] text-serenix-accent/20 -z-10"
      >
        <Heart size={100} />
      </motion.div>
    </div>
  );
}
