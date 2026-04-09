-- Run this in your Supabase SQL Editor to create the legal_chunks table
-- Go to: https://supabase.com/dashboard > Your Project > SQL Editor

CREATE TABLE IF NOT EXISTS legal_chunks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  document_name TEXT NOT NULL,
  section_title TEXT NOT NULL,
  content TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for fast text search
CREATE INDEX IF NOT EXISTS idx_legal_chunks_content ON legal_chunks USING gin(to_tsvector('english', content));
CREATE INDEX IF NOT EXISTS idx_legal_chunks_section ON legal_chunks USING gin(to_tsvector('english', section_title));
CREATE INDEX IF NOT EXISTS idx_legal_chunks_document ON legal_chunks(document_name);

-- Enable Row Level Security
ALTER TABLE legal_chunks ENABLE ROW LEVEL SECURITY;

-- Allow read access to everyone (public legal documents)
CREATE POLICY "Legal chunks are publicly readable"
  ON legal_chunks
  FOR SELECT
  TO anon
  USING (true);

-- Only service role can insert/update/delete
CREATE POLICY "Only service role can modify legal chunks"
  ON legal_chunks
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
