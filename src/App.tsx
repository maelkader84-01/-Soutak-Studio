/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Modality } from "@google/genai";
import { motion, AnimatePresence } from "motion/react";
import { 
  Mic, 
  Send, 
  Youtube, 
  Volume2, 
  Loader2, 
  Sparkles, 
  Play, 
  Square,
  MessageSquare,
  History,
  Settings2
} from "lucide-react";

// --- Types & Constants ---

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  audioBase64?: string;
  timestamp: Date;
}

type Mode = 'chat' | 'tts';

const SYSTEM_INSTRUCTION = `
You are a charismatic Egyptian YouTuber. Your voice must sound 100% human, natural, and energetic. Avoid any robotic or formal Arabic (MSA) tones.  

Key Style Instructions:
- Persona: Act like a tech or lifestyle YouTuber talking directly to his 'fam' or 'followers'. Use a warm, friendly, and engaging tone.
- Natural Fillers: Occasionally use natural Egyptian fillers like 'يا جماعة', 'بصوا بقى', 'تمام؟', 'زي ما انتم شايفين' to enhance the human feel.
- Pronunciation of (ج): Always use the hard 'G' (as in 'Game').
- Pronunciation of (ق): Always pronounced as a glottal stop (Hamza / ').
- Audio Quality: Output must be high-fidelity, mimicking a professional studio microphone used by creators.

Always pronounce numbers as they are spoken in Egypt:
- 11: 'Hidashar' (حداشر).
- 12: 'Etnashar' (اتناشر).
- 15: 'Khamastashar' (خمستاشر).
- 100: 'Meya' (مية).
- 1000: 'Alf' (ألف).
- Currency: Say 'Geneh' (جنيه) instead of 'Junayh'.

Strategy for "Ultra-Natural" Sound:
- Use 'Phonetic Spelling' for slang: If you feel the text won't sound right, spell the word as it sounds (e.g., 'Awy' instead of 'أوي').
- Pacing: Speak at a natural conversational speed, not too slow, with pauses for breath between sentences.
`;

const TTS_INSTRUCTION = `
You are a charismatic Egyptian YouTuber. 
YOUR TASK: Read the provided text EXACTLY as it is written. Do not add any new words, do not summarize, and do not respond to it. Just read it aloud in your energetic, natural Egyptian voice.
Follow all pronunciation rules (G is hard, Q is hamza, numbers are Egyptian).
If the text is in English, read it with a cool, tech-savvy Egyptian accent.
`;

// --- Components ---

export default function App() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [mode, setMode] = useState<Mode>('chat');
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Initialize Gemini
  const aiRef = useRef<GoogleGenAI | null>(null);

  useEffect(() => {
    // Lazy init for Gemini API to avoid crashes if key is missing initially
    if (!aiRef.current && process.env.GEMINI_API_KEY) {
      aiRef.current = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    }
  }, []);

  const playAudio = async (base64Audio: string) => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({
          sampleRate: 24000
        });
      }

      // Stop previous audio if any
      if (audioSourceRef.current) {
        audioSourceRef.current.stop();
      }

      // Check if it's raw PCM (signed 16-bit) or a container.
      // Usually Gemini Audio Modality returns raw PCM 16-bit 24kHz.
      // If it has a header, we'd need to skip it, but let's assume raw PCM first.
      
      const audioData = atob(base64Audio);
      const arrayBuffer = new ArrayBuffer(audioData.length);
      const view = new Uint8Array(arrayBuffer);
      for (let i = 0; i < audioData.length; i++) {
        view[i] = audioData.charCodeAt(i);
      }

      // Try to determine if it's PCM or WAV
      // WAV header starts with 'RIFF'
      const isWav = audioData.startsWith('RIFF');

      let audioBuffer: AudioBuffer;

      if (isWav) {
        audioBuffer = await audioContextRef.current.decodeAudioData(arrayBuffer);
      } else {
        // Assume Raw PCM 16-bit
        const pcm16 = new Int16Array(arrayBuffer);
        const float32 = new Float32Array(pcm16.length);
        for (let i = 0; i < pcm16.length; i++) {
          float32[i] = pcm16[i] / 32768;
        }
        audioBuffer = audioContextRef.current.createBuffer(1, float32.length, 24000);
        audioBuffer.getChannelData(0).set(float32);
      }

      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      
      source.onended = () => {
        setIsPlaying(false);
        audioSourceRef.current = null;
      };
      
      setIsPlaying(true);
      source.start();
      audioSourceRef.current = source;
    } catch (error) {
      console.error("Error playing audio:", error);
      setIsPlaying(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isGenerating) return;
    if (!aiRef.current) {
      console.error("AI not initialized. Check API key.");
      return;
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      text: input,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsGenerating(true);

    try {
      const response = await aiRef.current.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: input }] }],
        config: {
          systemInstruction: mode === 'chat' ? SYSTEM_INSTRUCTION : TTS_INSTRUCTION,
          temperature: mode === 'chat' ? 0.85 : 0.7, // Lower temperature for TTS accuracy
          topP: 0.95,
          responseModalities: [Modality.AUDIO],
        },
      });

      const text = response.text || "بص يا فنان، كملنا!";
      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        text: text,
        audioBase64: base64Audio,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMessage]);
      
      if (base64Audio) {
        await playAudio(base64Audio);
      }
    } catch (error) {
      console.error("Error generating content:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-studio-bg text-neutral-100 font-sans selection:bg-primary-red/30">
      {/* Sidebar - Quick Studio Stats */}
      <div className="fixed left-0 top-0 h-full w-20 bg-neutral-900 border-r border-studio-border flex flex-col items-center py-8 gap-8 hidden md:flex z-50">
        <div className="w-12 h-12 rounded-2xl bg-primary-red flex items-center justify-center shadow-lg shadow-primary-red/20">
          <Youtube className="w-7 h-7 text-white" />
        </div>
        <div className="flex flex-col gap-6">
          <div className="p-3 rounded-xl hover:bg-neutral-800 transition-colors cursor-pointer text-neutral-400 hover:text-white">
            <Mic className="w-6 h-6" />
          </div>
          <div className="p-3 rounded-xl hover:bg-neutral-800 transition-colors cursor-pointer text-neutral-400 hover:text-white">
            <History className="w-6 h-6" />
          </div>
          <div className="p-3 rounded-xl hover:bg-neutral-800 transition-colors cursor-pointer text-neutral-400 hover:text-white">
            <Settings2 className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="md:ml-20 min-h-screen flex flex-col relative overflow-hidden">
        {/* Header */}
        <header className="h-20 border-b border-studio-border flex items-center justify-between px-8 bg-studio-bg/80 backdrop-blur-md sticky top-0 z-40">
          <div className="flex items-center gap-4">
            <div className="w-8 h-8 bg-primary-red rounded-lg shadow-lg shadow-primary-red/20" />
            <h1 className="text-xl font-extrabold tracking-tight">
              CREATOR STUDIO <span className="font-light text-neutral-500 uppercase text-xs tracking-widest ml-2">| Egyptian Persona v2.0</span>
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex bg-neutral-900 p-1 rounded-2xl border border-studio-border">
              <button 
                onClick={() => setMode('chat')}
                className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all ${mode === 'chat' ? 'bg-primary-red text-white shadow-lg' : 'text-neutral-500 hover:text-neutral-300'}`}
              >
                CHAT / دردشة
              </button>
              <button 
                onClick={() => setMode('tts')}
                className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all ${mode === 'tts' ? 'bg-primary-red text-white shadow-lg' : 'text-neutral-500 hover:text-neutral-300'}`}
              >
                TTS / تحويل نص
              </button>
            </div>
            <div className="bento-pill hidden sm:block font-bold px-3 py-1 text-[10px]">AUDIO ENABLED</div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto px-6 py-10 max-w-7xl mx-auto w-full scroll-smooth">
          {messages.length === 0 ? (
            <div className="bento-grid">
              {/* Main Persona Card */}
              <motion.div 
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                className="bento-card bento-card-red col-span-4 lg:col-span-2 row-span-2"
              >
                <span className="bento-label">الشخصية الأساسية / The Persona</span>
                <h2 className="bento-title">المبدع المصري الكاريزماتي</h2>
                <p className="text-neutral-400 leading-relaxed mb-6 font-medium">
                  صوت بشري 100%، طاقة عالية، وروح الفكاهة المصرية. تقدر تدردش معاه (Chat) أو تخليه يقرأ أي نص تكتبه بالظبط (TTS).
                </p>
                <div className="mt-auto grid grid-cols-2 gap-4">
                  <div className="bg-neutral-800/50 p-3 rounded-xl border border-neutral-700/50">
                    <span className="bento-label block mb-1">الأسلوب</span>
                    <div className="font-bold text-sm">حميمي / طاقة عالية</div>
                  </div>
                  <div className="bg-neutral-800/50 p-3 rounded-xl border border-neutral-700/50">
                    <span className="bento-label block mb-1">النبرة</span>
                    <div className="font-bold text-sm">صديق مخلص</div>
                  </div>
                </div>
              </motion.div>

              {/* Hard G Card */}
              <motion.div 
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.1 }}
                className="bento-card lg:col-span-1"
              >
                <span className="bento-label">قواعد النطق (ج)</span>
                <h2 className="bento-title">Hard 'G' Only</h2>
                <p className="text-xs text-neutral-500 mb-4">دائماً جيم مصرية زي كلمة "Game".</p>
                <div className="bento-stat mt-auto">GEMA / جيم</div>
              </motion.div>

              {/* Glottal Stop Card */}
              <motion.div 
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="bento-card lg:col-span-1"
              >
                <span className="bento-label">قواعد النطق (ق)</span>
                <h2 className="bento-title">Glottal Stop</h2>
                <p className="text-xs text-neutral-500 mb-4">القاف بتتنطق همزة (') في أغلب الكلام.</p>
                <div className="bento-stat mt-auto">'AL / قال</div>
              </motion.div>

              {/* Currency Card */}
              <motion.div 
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="bento-card col-span-4 lg:col-span-2"
              >
                <span className="bento-label">العملة والأرقام / Currency & Numbers</span>
                <div className="flex flex-wrap gap-2 mt-4">
                  {["11: حداشر", "12: اتناشر", "100: مية", "الجنيه: Geneh", "1000: ألف", "15: خمستاشر"].map(pill => (
                    <span key={pill} className="bento-pill text-[10px] sm:text-xs">{pill}</span>
                  ))}
                </div>
              </motion.div>

              {/* Settings Card */}
              <motion.div 
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="bento-card lg:col-span-1 row-span-2"
              >
                <span className="bento-label">الإعدادات التقنية</span>
                <div className="mt-6 flex-1 flex flex-col justify-around">
                  <div>
                    <span className="bento-label block mb-2">Temperature</span>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-1 bg-neutral-800 rounded-full overflow-hidden">
                        <div className="h-full bg-primary-red w-[85%]" />
                      </div>
                      <span className="text-xs font-bold">0.85</span>
                    </div>
                  </div>
                  <div>
                    <span className="bento-label block mb-2">Top-P</span>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-1 bg-neutral-800 rounded-full overflow-hidden">
                        <div className="h-full bg-primary-red w-[95%]" />
                      </div>
                      <span className="text-xs font-bold">0.95</span>
                    </div>
                  </div>
                  <div>
                    <span className="bento-label block mb-1">Model</span>
                    <div className="font-bold text-primary-red text-sm uppercase tracking-tighter">Gemini 3 Flash</div>
                  </div>
                </div>
              </motion.div>

              {/* Suggested Questions */}
              <motion.div 
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="bento-card lg:col-span-1"
              >
                <span className="bento-label">لوازم الكلام</span>
                <div className="mt-2 flex flex-col gap-1">
                  {["يا جماعة", "بصوا بقى", "تمام؟"].map(tag => (
                    <span key={tag} className="text-sm text-neutral-300 font-medium">• {tag}</span>
                  ))}
                </div>
              </motion.div>

              {/* Quick Actions / Suggestions Title */}
              <div className="col-span-4 mt-8 flex items-center gap-3">
                <div className="h-px flex-1 bg-studio-border" />
                <span className="bento-label mb-0">ابدأ ريكورد جديد / Start Session</span>
                <div className="h-px flex-1 bg-studio-border" />
              </div>

              {/* Suggestion Buttons */}
              {["اعمل مقدمة لفيديو جيمنج", "أنا عايز ريفيو لموبايل جديد", "مساعدة في ترتيب فيديو طبخ", "نصيحة للمتابعين في الكومنتات"].map((suggest, i) => (
                <motion.button 
                  key={suggest}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.6 + (i * 0.1) }}
                  onClick={() => setInput(suggest)}
                  className="bento-card hover:border-primary-red/50 hover:bg-neutral-900/50 transition-all text-left group lg:col-span-1"
                >
                  <p className="text-sm text-neutral-400 group-hover:text-white transition-colors">{suggest}</p>
                </motion.button>
              ))}
            </div>
          ) : (
            <div className="space-y-8 pb-32">
              <AnimatePresence mode="popLayout">
                {messages.map((msg) => (
                  <motion.div
                    key={msg.id}
                    initial={{ y: 20, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`max-w-[85%] bento-card ${
                      msg.role === 'user' 
                        ? 'bg-neutral-800 border-none rounded-tr-none shadow-xl' 
                        : 'bento-card-red rounded-tl-none relative overflow-hidden bg-studio-card/40 backdrop-blur-sm'
                    }`}>
                      <div className="flex flex-col gap-3">
                        <p className="leading-relaxed whitespace-pre-wrap text-sm sm:text-base font-medium">{msg.text}</p>
                        
                        {msg.audioBase64 && (
                          <div className="mt-4 flex items-center gap-4 bg-neutral-950/50 p-4 rounded-2xl border border-studio-border">
                            <button
                              onClick={() => playAudio(msg.audioBase64!)}
                              className="w-12 h-12 rounded-full bg-primary-red hover:bg-primary-red/80 flex items-center justify-center transition-all shadow-lg shadow-primary-red/20 shrink-0"
                            >
                              <Play className="w-5 h-5 fill-current ml-1" />
                            </button>
                            <div className="flex-1 flex flex-col gap-2">
                                <div className="flex items-end gap-1.5 h-6">
                                    {[1, 2, 3, 4, 5, 4, 3, 2, 3, 4, 5, 6, 5, 4, 3, 4, 5, 6, 7].map((h, i) => (
                                        <div 
                                            key={i} 
                                            className="w-1 bg-primary-red rounded-full transition-all duration-300"
                                            style={{ 
                                                height: isPlaying ? `${Math.random() * 80 + 20}%` : `${h * 15}%`,
                                                opacity: isPlaying ? 1 : 0.3
                                            }}
                                        />
                                    ))}
                                </div>
                                <span className="text-[10px] text-neutral-500 uppercase tracking-tighter italic font-bold">"يا مساء الفل على أحلى متابعين..."</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))}
                
                {isGenerating && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex justify-start"
                  >
                    <div className="bento-card bg-studio-card/40 border-studio-border rounded-tl-none flex flex-row items-center gap-4 py-4 pr-6">
                      <div className="flex gap-1">
                        {[0, 150, 300].map(delay => (
                          <div key={delay} className="w-2 h-2 bg-primary-red rounded-full animate-bounce" style={{ animationDelay: `${delay}ms` }} />
                        ))}
                      </div>
                      <span className="bento-label mb-0 text-neutral-500 font-bold">بنسجل دلوقتي... Recording</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <div ref={(el) => el?.scrollIntoView({ behavior: 'smooth' })} />
            </div>
          )}
        </div>

        {/* Search Input Bar */}
        <div className="fixed bottom-0 left-0 right-0 md:left-20 p-6 md:p-10 pointer-events-none">
          <div className="max-w-4xl mx-auto pointer-events-auto">
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-primary-red/30 to-orange-600/30 rounded-[2.5rem] blur opacity-0 group-focus-within:opacity-100 transition duration-700" />
              <div className="relative flex items-end gap-3 bg-studio-card border border-studio-border p-4 rounded-[2.5rem] focus-within:border-primary-red/50 transition-all backdrop-blur-xl shadow-2xl">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder={mode === 'chat' ? "قولي عايز كيمو يسجل لك إيه النهاردة؟" : "اكتب النص اللي عايز كيمو يقرأه بالظبط..."}
                  className="flex-1 bg-transparent border-none focus:ring-0 resize-none max-h-40 min-h-[52px] py-3 px-5 text-neutral-100 placeholder:text-neutral-600 text-lg sm:text-xl font-bold rtl"
                  rows={1}
                />
                <button 
                  onClick={handleSend}
                  disabled={!input.trim() || isGenerating}
                  className="w-14 h-14 rounded-full bg-primary-red flex items-center justify-center transition-all disabled:opacity-30 disabled:grayscale hover:scale-105 active:scale-95 shadow-xl shadow-primary-red/30 shrink-0"
                >
                  {isGenerating ? <Loader2 className="w-6 h-6 animate-spin" /> : <Send className="w-6 h-6" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
