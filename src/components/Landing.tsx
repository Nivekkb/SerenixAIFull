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
          Your emotional sanctuary. A safe space to breathe, vent, and find peace with AI-guided support.
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
          Begin Your Journey
        </button>
        <p className="text-serenix-ink/40 text-sm">
          Join our community of {Math.floor(Math.random() * 1000) + 500}+ finding peace today.
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
          <h3 className="font-serif text-xl font-medium">Private Sanctuary</h3>
          <p className="text-serenix-ink/60 font-light">
            A personal space to chat with our empathetic AI whenever you feel overwhelmed.
          </p>
        </div>
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-white/50 flex items-center justify-center text-serenix-accent">
            <Users size={24} />
          </div>
          <h3 className="font-serif text-xl font-medium">Support Circles</h3>
          <p className="text-serenix-ink/60 font-light">
            Join AI-mediated group chats with friends to support each other in a safe environment.
          </p>
        </div>
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-white/50 flex items-center justify-center text-serenix-accent">
            <Shield size={24} />
          </div>
          <h3 className="font-serif text-xl font-medium">Safe & Secure</h3>
          <p className="text-serenix-ink/60 font-light">
            Your privacy is our priority. Your sanctuary is yours alone.
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
