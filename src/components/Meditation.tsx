import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Pause, RotateCcw, Wind, Moon, Sun, Clock, BookOpen, Volume2 } from 'lucide-react';
import { MeditationExercise } from '../types';

const EXERCISES: MeditationExercise[] = [
  {
    id: '1',
    title: 'Morning Calm',
    theme: 'focus',
    duration: 5,
    text: "Find a comfortable seated position. Close your eyes and take a deep breath in through your nose, feeling your chest expand. Hold for a moment, then exhale slowly through your mouth. Imagine a soft, golden light filling your mind, clearing away any morning fog. Focus on the sensation of your breath, the rise and fall of your shoulders. You are present. You are ready for the day."
  },
  {
    id: '2',
    title: 'Stress Release',
    theme: 'stress relief',
    duration: 10,
    text: "Sit or lie down in a quiet space. Begin by tensing the muscles in your toes for five seconds, then release them completely. Move up to your calves, thighs, and so on, all the way to your face. With each release, imagine stress leaving your body like a dark mist dissipating in the wind. Breathe deeply into any areas that still feel tight. You are safe. You are letting go."
  },
  {
    id: '3',
    title: 'Deep Sleep Journey',
    theme: 'sleep',
    duration: 15,
    text: "As you lie in bed, let your body sink into the mattress. Imagine you are floating on a calm, dark lake under a vast, starry sky. The water is warm and supportive. With every breath, you drift further away from the day's worries. The stars above are twinkling softly, whispering peace. Your limbs feel heavy and relaxed. The world is quiet. You are drifting into a deep, restful sleep."
  }
];

export default function Meditation() {
  const [selectedExercise, setSelectedExercise] = useState<MeditationExercise | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    let interval: any;
    if (isPlaying && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft(prev => prev - 1);
        setProgress(prev => prev + (100 / (selectedExercise!.duration * 60)));
      }, 1000);
    } else if (timeLeft === 0) {
      setIsPlaying(false);
    }
    return () => clearInterval(interval);
  }, [isPlaying, timeLeft, selectedExercise]);

  const startExercise = (ex: MeditationExercise) => {
    setSelectedExercise(ex);
    setTimeLeft(ex.duration * 60);
    setProgress(0);
    setIsPlaying(true);
  };

  const togglePlay = () => setIsPlaying(!isPlaying);
  const reset = () => {
    if (selectedExercise) {
      setTimeLeft(selectedExercise.duration * 60);
      setProgress(0);
      setIsPlaying(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex-1 max-w-5xl mx-auto w-full px-4 py-8 overflow-y-auto custom-scrollbar">
      <div className="mb-8">
        <h2 className="font-serif text-3xl font-medium">Mindfulness Sanctuary</h2>
        <p className="text-serenix-ink/50">Guided journeys for your inner peace.</p>
      </div>

      <AnimatePresence mode="wait">
        {!selectedExercise ? (
          <motion.div
            key="list"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="grid grid-cols-1 md:grid-cols-3 gap-6"
          >
            {EXERCISES.map((ex) => (
              <div
                key={ex.id}
                onClick={() => startExercise(ex)}
                className="glass rounded-[2rem] p-6 cursor-pointer hover:scale-105 transition-all group"
              >
                <div className="w-12 h-12 rounded-2xl bg-serenix-blue flex items-center justify-center text-serenix-accent mb-4 group-hover:bg-serenix-accent group-hover:text-white transition-colors">
                  {ex.theme === 'focus' && <Sun size={24} />}
                  {ex.theme === 'stress relief' && <Wind size={24} />}
                  {ex.theme === 'sleep' && <Moon size={24} />}
                </div>
                <h3 className="font-serif text-xl font-medium mb-1">{ex.title}</h3>
                <div className="flex items-center gap-2 text-serenix-ink/40 text-sm mb-4">
                  <Clock size={14} />
                  <span>{ex.duration} minutes</span>
                </div>
                <p className="text-serenix-ink/60 text-sm line-clamp-3 font-light leading-relaxed">
                  {ex.text}
                </p>
              </div>
            ))}
          </motion.div>
        ) : (
          <motion.div
            key="player"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="glass rounded-[3rem] p-8 md:p-12 flex flex-col items-center text-center max-w-2xl mx-auto"
          >
            <button
              onClick={() => setSelectedExercise(null)}
              className="absolute top-8 left-8 text-serenix-ink/40 hover:text-serenix-ink transition-colors"
            >
              <BookOpen size={24} />
            </button>

            <div className="w-32 h-32 rounded-full bg-serenix-blue flex items-center justify-center text-serenix-accent mb-8 relative">
              <motion.div
                animate={{ scale: isPlaying ? [1, 1.2, 1] : 1 }}
                transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                className="absolute inset-0 rounded-full bg-serenix-accent/10"
              />
              {selectedExercise.theme === 'focus' && <Sun size={48} />}
              {selectedExercise.theme === 'stress relief' && <Wind size={48} />}
              {selectedExercise.theme === 'sleep' && <Moon size={48} />}
            </div>

            <h3 className="font-serif text-3xl font-medium mb-2">{selectedExercise.title}</h3>
            <p className="text-serenix-ink/40 uppercase tracking-widest text-xs font-bold mb-8">
              {selectedExercise.theme} • {selectedExercise.duration} MIN
            </p>

            <div className="w-full bg-serenix-ink/5 h-1.5 rounded-full mb-4 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progress}%` }}
                className="h-full bg-serenix-accent"
              />
            </div>
            <div className="flex justify-between w-full text-xs text-serenix-ink/40 font-mono mb-12">
              <span>{formatTime(Math.floor((selectedExercise.duration * 60) - timeLeft))}</span>
              <span>{formatTime(timeLeft)}</span>
            </div>

            <div className="flex items-center gap-8 mb-12">
              <button onClick={reset} className="p-3 text-serenix-ink/40 hover:text-serenix-ink transition-colors">
                <RotateCcw size={24} />
              </button>
              <button
                onClick={togglePlay}
                className="w-20 h-20 rounded-full bg-serenix-ink text-white flex items-center justify-center shadow-xl hover:scale-105 transition-all active:scale-95"
              >
                {isPlaying ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" className="ml-1" />}
              </button>
              <div className="p-3 text-serenix-ink/40">
                <Volume2 size={24} />
              </div>
            </div>

            <div className="bg-white/40 rounded-3xl p-6 text-serenix-ink/70 italic font-serif leading-relaxed">
              {selectedExercise.text}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
