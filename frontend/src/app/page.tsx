"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { Mic, Play, MessageCircle, Clock3, BarChart3, Globe, Sparkles, AudioLines, Languages, ArrowRight, ChevronRight } from "lucide-react";
import PricingCards from "@/components/PricingCards";

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] as const } },
});

const staggerContainer = {
  animate: { transition: { staggerChildren: 0.1 } },
};

const cardHover = {
  rest: { scale: 1, y: 0 },
  hover: { scale: 1.02, y: -6, transition: { duration: 0.3, ease: "easeOut" as const } },
};

export default function Home() {
  return (
    <main className="min-h-screen bg-[var(--background)] relative overflow-hidden noise-overlay">
      {/* Animated Background Orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-indigo-600/20 blur-[150px] float" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-violet-600/15 blur-[150px] float" style={{ animationDelay: "-2s" }} />
        <div className="absolute top-[30%] right-[20%] w-[35%] h-[35%] rounded-full bg-blue-500/10 blur-[120px] float" style={{ animationDelay: "-4s" }} />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-50 glass-panel border-b border-white/[0.06]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-3 group">
            <div className="rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-500 p-2.5 text-white shadow-lg shadow-indigo-500/25 transition-all duration-300 group-hover:shadow-indigo-500/40 group-hover:scale-105">
              <Mic size={18} />
            </div>
            <span className="text-2xl font-bold tracking-tight text-white">SpeakFrench</span>
          </Link>

          <nav className="hidden items-center gap-8 text-sm font-medium text-slate-400 md:flex">
            <Link href="#features" className="hover:text-white transition-colors duration-200">Features</Link>
            <Link href="#pricing" className="hover:text-white transition-colors duration-200">Pricing</Link>
            <Link href="#how-it-works" className="hover:text-white transition-colors duration-200">How It Works</Link>
            <Link href="/auth" className="hover:text-white transition-colors duration-200">Login</Link>
            <Link href="/auth" className="btn-primary px-5 py-2.5 flex items-center gap-2 text-sm">
              <span>Get Started</span>
              <Play size={14} className="fill-current" />
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto max-w-7xl px-6 pt-24 pb-20 text-center lg:pt-36 lg:pb-28">
        <motion.div {...fadeUp(0)}>
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-400/20 bg-indigo-500/10 px-4 py-1.5 text-sm font-medium text-indigo-300 backdrop-blur-sm mb-8">
            <Sparkles size={14} className="text-indigo-400" />
            <span>Next-Gen AI Speaking Simulator</span>
          </div>
        </motion.div>

        <motion.h1 {...fadeUp(0.1)} className="text-5xl font-extrabold tracking-tight text-white sm:text-7xl mb-8 leading-[1.1]">
          Master TCF/TEF Speaking <br />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-violet-400 to-purple-400">
            With Confidence
          </span>
        </motion.h1>

        <motion.p {...fadeUp(0.2)} className="mx-auto max-w-2xl text-lg text-slate-400 mb-12 leading-relaxed">
          Realistic examiner interactions, instant scoring, and personalized feedback.
          Stop guessing your level and start practicing with an intelligent AI tutor.
        </motion.p>

        <motion.div {...fadeUp(0.3)} className="flex flex-wrap justify-center gap-4">
          <Link href="/auth" className="btn-primary px-8 py-4 text-lg flex items-center gap-3">
            <Mic size={20} />
            <span>Practice Now</span>
            <ArrowRight size={18} />
          </Link>
          <Link href="#pricing" className="btn-secondary px-8 py-4 text-lg flex items-center gap-2">
            <span>View Pricing</span>
            <ChevronRight size={18} />
          </Link>
        </motion.div>

        {/* Decorative Stats Bar */}
        <motion.div {...fadeUp(0.45)} className="mt-20 mx-auto max-w-3xl">
          <div className="glass-card p-1 grid grid-cols-3 divide-x divide-white/[0.06]">
            {[
              { value: "10,000+", label: "Sessions Completed" },
              { value: "98%", label: "Accuracy Rate" },
              { value: "B1-C2", label: "All Levels" },
            ].map((stat, i) => (
              <div key={i} className="py-5 px-4 text-center">
                <p className="text-2xl font-bold text-white">{stat.value}</p>
                <p className="text-sm text-slate-400 mt-1">{stat.label}</p>
              </div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-7xl px-6 py-24 relative z-10">
        <motion.div {...fadeUp()} className="text-center mb-16">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Why Choose <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">SpeakFrench</span>?
          </h2>
          <p className="mt-4 text-slate-400 max-w-xl mx-auto">Everything you need to achieve your target language level.</p>
        </motion.div>

        <motion.div variants={staggerContainer} initial="initial" whileInView="animate" viewport={{ once: true, margin: "-80px" }} className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[
            { title: "Real Exam Scenarios", desc: "Questions based on official TCF/TEF themes and formats.", icon: MessageCircle, gradient: "from-blue-500 to-cyan-400" },
            { title: "Instant Scoring", desc: "Get precise evaluation on pronunciation, grammar & fluency.", icon: BarChart3, gradient: "from-emerald-500 to-teal-400" },
            { title: "Continuous Flow", desc: "Seamless transitions across all speaking exam parts.", icon: Languages, gradient: "from-indigo-500 to-violet-400" },
            { title: "Realistic Voices", desc: "High-quality neural text-to-speech for examiner audio.", icon: AudioLines, gradient: "from-amber-500 to-orange-400" },
            { title: "Timed Sessions", desc: "Simulate real test conditions with precise timers.", icon: Clock3, gradient: "from-rose-500 to-pink-400" },
            { title: "Practice Anywhere", desc: "Access your dashboard remotely anytime, any device.", icon: Globe, gradient: "from-cyan-500 to-blue-400" },
          ].map((f, i) => (
            <motion.div key={i} variants={fadeUp()} whileHover="hover" initial="rest" animate="rest">
              <motion.div variants={cardHover} className="glass-card p-8 h-full group cursor-default">
                <div className={`inline-flex rounded-2xl bg-gradient-to-br ${f.gradient} p-3.5 text-white mb-6 shadow-lg transition-transform duration-300 group-hover:scale-110`}>
                  <f.icon size={24} />
                </div>
                <h3 className="text-xl font-bold text-white mb-3">{f.title}</h3>
                <p className="text-slate-400 leading-relaxed">{f.desc}</p>
              </motion.div>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="mx-auto max-w-7xl px-6 py-24 relative z-10">
        <motion.div {...fadeUp()} className="text-center mb-16">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            How It Works
          </h2>
          <p className="mt-4 text-slate-400">Three simple steps to start improving.</p>
        </motion.div>

        <div className="grid gap-8 md:grid-cols-3">
          {[
            { step: "01", title: "Choose Your Level", desc: "Select your target exam (TCF or TEF) and proficiency level from B1 to C2." },
            { step: "02", title: "Practice Speaking", desc: "Listen to AI-generated exam prompts, then record your responses in real-time." },
            { step: "03", title: "Get Scored Instantly", desc: "Receive detailed scores on pronunciation, grammar, vocabulary, and coherence." },
          ].map((item, i) => (
            <motion.div key={i} {...fadeUp(i * 0.15)} className="glass-card p-8 text-center relative overflow-hidden group">
              <div className="absolute top-4 right-4 text-6xl font-black text-white/[0.03] group-hover:text-white/[0.06] transition-colors duration-500">
                {item.step}
              </div>
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white font-bold text-lg mb-6 shadow-lg shadow-indigo-500/20">
                {item.step}
              </div>
              <h3 className="text-xl font-bold text-white mb-3">{item.title}</h3>
              <p className="text-slate-400 leading-relaxed">{item.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="mx-auto max-w-7xl px-6 py-24 relative z-10">
        <motion.div {...fadeUp()} className="text-center mb-16">
          <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Simple, <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-400">Transparent</span> Pricing
          </h2>
          <p className="mt-4 text-slate-400 max-w-xl mx-auto">No subscriptions. Buy session packs and use them whenever you&apos;re ready. All prices in CAD.</p>
        </motion.div>

        <PricingCards userId="demo-user" compact />

        <motion.div {...fadeUp(0.3)} className="mt-10 text-center">
          <Link href="/pricing" className="btn-secondary inline-flex items-center gap-2 px-6 py-3">
            View All Packs
            <ArrowRight size={16} />
          </Link>
        </motion.div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-6 py-24 relative z-10">
        <motion.div {...fadeUp()} className="glass-card p-12 md:p-16 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-indigo-600/10 via-violet-600/10 to-purple-600/10 pointer-events-none" />
          <h2 className="relative text-3xl md:text-4xl font-bold text-white mb-4">
            Ready to ace your speaking exam?
          </h2>
          <p className="relative text-slate-400 max-w-xl mx-auto mb-8">
            Join thousands of students who improved their French speaking scores with AI-powered practice.
          </p>
          <div className="relative flex flex-wrap justify-center gap-4">
            <Link href="/dashboard" className="btn-primary px-8 py-4 text-lg flex items-center gap-3">
              <Mic size={20} />
              <span>Start Free Demo</span>
            </Link>
            <Link href="/pricing" className="btn-secondary px-8 py-4 text-lg">
              View Pricing
            </Link>
          </div>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/[0.06] py-8">
        <div className="mx-auto max-w-7xl px-6 flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-slate-500">
          <p>&copy; 2026 SpeakFrench. All rights reserved.</p>
          <div className="flex gap-6">
            <Link href="/pricing" className="hover:text-white transition-colors">Pricing</Link>
            <Link href="/dashboard" className="hover:text-white transition-colors">Dashboard</Link>
            <Link href="/profile" className="hover:text-white transition-colors">Profile</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
