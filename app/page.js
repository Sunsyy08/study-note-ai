'use client';

import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function Home() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState(null);

  async function handleUpload() {
    if (!file) {
      setMessage('사진을 먼저 선택해주세요!');
      return;
    }

    setUploading(true);
    setResult(null);
    setMessage('업로드 중...');

    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}.${fileExt}`;

    const { error: uploadError } = await supabase.storage
      .from('note-images')
      .upload(fileName, file);

    if (uploadError) {
      setMessage('업로드 실패: ' + uploadError.message);
      setUploading(false);
      return;
    }

    const { data: urlData } = supabase.storage
      .from('note-images')
      .getPublicUrl(fileName);

    const { data: noteData, error: insertError } = await supabase
      .from('notes')
      .insert({ image_url: urlData.publicUrl, status: 'pending' })
      .select()
      .single();

    if (insertError) {
      setMessage('기록 저장 실패: ' + insertError.message);
      setUploading(false);
      return;
    }

    setMessage('업로드 성공! 이제 AI가 분석하도록 요청할게요...');
    setUploading(false);

    setAnalyzing(true);
    const analyzeResponse = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noteId: noteData.id, imageUrl: urlData.publicUrl }),
    });

    const analyzeData = await analyzeResponse.json();
    setAnalyzing(false);

    if (analyzeData.success) {
      setMessage('분석 완료! ✅');
      setResult(analyzeData);
    } else {
      setMessage('분석 실패: ' + analyzeData.error);
    }
  }

  return (
    <main style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Hello, 학습노트! 📚</h1>
      <p>공부 노트 사진을 올리면 AI가 요약해드려요.</p>

      <input
        type="file"
        accept="image/*"
        onChange={(e) => setFile(e.target.files[0])}
      />
      <button onClick={handleUpload} disabled={uploading || analyzing}>
        {uploading ? '업로드 중...' : analyzing ? 'AI 분석 중...' : '업로드'}
      </button>

      {message && <p>{message}</p>}

      {result && (
        <div style={{ marginTop: '1rem', padding: '1rem', border: '1px solid #ccc' }}>
          <h3>📝 요약</h3>
          <p>{result.summary}</p>
          <h3>🔑 키워드</h3>
          <p>{result.keywords.join(', ')}</p>
        </div>
      )}
    </main>
  );
}
