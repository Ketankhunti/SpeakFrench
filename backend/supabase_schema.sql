-- Supabase SQL Schema for SpeakFrench

-- ── Helper: auto-update updated_at on row change ──
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Tables ──

-- User profiles
CREATE TABLE profiles (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_profiles_email ON profiles(email);
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Session pack catalog (admin-managed)
CREATE TABLE session_packs (
    id TEXT PRIMARY KEY,                     -- e.g. 'essai_plus', 'decouverte'
    name TEXT NOT NULL,                      -- display name
    sessions INTEGER NOT NULL,               -- number of sessions in pack
    price_cents INTEGER NOT NULL,            -- price in CAD cents
    active BOOLEAN DEFAULT TRUE,             -- soft-delete / hide from store
    sort_order INTEGER DEFAULT 0,            -- display ordering
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER trg_session_packs_updated_at BEFORE UPDATE ON session_packs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed the pack catalog
INSERT INTO session_packs (id, name, sessions, price_cents, sort_order) VALUES
    ('essai_plus',   'Starter',   2,   399, 1),
    ('decouverte',   'Focus',     5,   999, 2),
    ('preparation',  'Prep',     20,  2499, 3),
    ('intensif',     'Intensive', 50,  4999, 4),
    ('marathon',     'Marathon', 100,  7999, 5);

-- User packs (session balances)
CREATE TABLE user_packs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    pack_id TEXT NOT NULL REFERENCES session_packs(id),
    sessions_total INTEGER NOT NULL,
    sessions_remaining INTEGER NOT NULL,
    stripe_session_id TEXT,
    amount_cad DECIMAL(10, 2),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_user_packs_user_id ON user_packs(user_id);
CREATE INDEX idx_user_packs_remaining ON user_packs(user_id, sessions_remaining);
CREATE TRIGGER trg_user_packs_updated_at BEFORE UPDATE ON user_packs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Session history
CREATE TABLE session_history (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    exam_part INTEGER NOT NULL DEFAULT 1,
    level TEXT NOT NULL DEFAULT 'B1',
    duration_seconds INTEGER DEFAULT 0,
    pronunciation_score DECIMAL(5, 1),
    grammar_score DECIMAL(5, 1),
    vocabulary_score DECIMAL(5, 1),
    coherence_score DECIMAL(5, 1),
    transcript JSONB DEFAULT '[]',
    ai_review TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_session_history_user_id ON session_history(user_id);
CREATE INDEX idx_session_history_created_at ON session_history(created_at);

-- Demo usage tracking (for free tier)
CREATE TABLE demo_usage (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    ip_address INET,
    demos_used INTEGER DEFAULT 0,
    last_demo_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_demo_usage_user_id ON demo_usage(user_id);

-- ── Row Level Security ──

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_usage ENABLE ROW LEVEL SECURITY;

-- Users can only read their own data
CREATE POLICY "Users can view own profile" ON profiles
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own profile" ON profiles
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own profile" ON profiles
    FOR UPDATE USING (auth.uid() = user_id);

-- Pack catalog is publicly readable (pricing page)
CREATE POLICY "Anyone can view active packs" ON session_packs
    FOR SELECT USING (active = TRUE);

CREATE POLICY "Users can view own packs" ON user_packs
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can view own history" ON session_history
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can view own demo usage" ON demo_usage
    FOR SELECT USING (auth.uid() = user_id);

-- Service role can do everything (backend uses service key)
CREATE POLICY "Service can manage profiles" ON profiles
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service can manage packs catalog" ON session_packs
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service can manage packs" ON user_packs
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service can manage history" ON session_history
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Service can manage demos" ON demo_usage
    FOR ALL USING (auth.role() = 'service_role');

-- ── Storage ──
-- Avatar bucket (run via Supabase dashboard or API, not raw SQL)
-- INSERT INTO storage.buckets (id, name, public) VALUES ('avatars', 'avatars', TRUE);
--
-- Storage policies (applied via dashboard):
-- • Authenticated users can upload to their own folder: avatars/{user_id}/*
-- • Public read access for all avatar files
