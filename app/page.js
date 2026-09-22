'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function Home() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [message, setMessage] = useState('');
  const [notes, setNotes] = useState([]);
  const [loadingNotes, setLoadingNotes] = useState(true);

  // 화면이 열릴 때 지금까지의 기록을 불러오기
  useEffect(() => {
    loadNotes();
  }, []);

  async function loadNotes() {
    setLoadingNotes(true);
    // notes 테이블과 note_summaries 테이블을 한 번에 조회 (join)
    const { data, error } = await supabase
      .from('notes')
      .select('*, note_summaries(summary, keywords)')
      .order('created_at', { ascending: false });

    if (!error) {
      setNotes(data);
    }
    setLoadingNotes(false);
  }

  async function handleUpload() {
    if (!file) {
      setMessage('사진을 먼저 선택해주세요!');
      return;
    }

    setUploading(true);
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
    loadNotes(); // 목록에 방금 올린 것을 pending 상태로 바로 반영

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
    } else {
      setMessage('분석 실패: ' + analyzeData.error);
    }

    setFile(null);
    loadNotes(); // 분석 결과까지 반영해서 목록 새로고침
  }

  return (
    <main style={{ maxWidth: '600px', margin: '0 auto', padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Hello, 학습노트! 📚</h1>
      <p>공부 노트 사진을 올리면 AI가 요약해드려요.</p>

      <div style={{ margin: '1.5rem 0', padding: '1rem', background: '#f5f5f5', borderRadius: '8px' }}>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files[0])}
        />
        <button
          onClick={handleUpload}
          disabled={uploading || analyzing}
          style={{ marginLeft: '0.5rem' }}
        >
          {uploading ? '업로드 중...' : analyzing ? 'AI 분석 중...' : '업로드'}
        </button>
        {message && <p style={{ marginTop: '0.5rem', fontSize: '0.9rem' }}>{message}</p>}
      </div>

      <h2>📋 지금까지의 학습 기록</h2>

      {loadingNotes && <p>불러오는 중...</p>}
      {!loadingNotes && notes.length === 0 && <p>아직 기록이 없어요. 첫 사진을 올려보세요!</p>}

      {notes.map((note) => (
        <div
          key={note.id}
          style={{
            border: '1px solid #ddd',
            borderRadius: '8px',
            padding: '1rem',
            marginBottom: '1rem',
          }}
        >
          <img
            src={note.image_url}
            alt="학습 노트"
            style={{ maxWidth: '150px', display: 'block', marginBottom: '0.5rem' }}
          />
          <p style={{ fontSize: '0.8rem', color: '#888' }}>
            {new Date(note.created_at).toLocaleString('ko-KR')}
          </p>

          {note.status === 'pending' && <p>⏳ 분석 대기중...</p>}

          {note.status === 'done' && note.note_summaries?.[0] && (
            <>
              <p><strong>📝 요약</strong>: {note.note_summaries[0].summary}</p>
              <p><strong>🔑 키워드</strong>: {note.note_summaries[0].keywords?.join(', ')}</p>
            </>
          )}
        </div>
      ))}
    </main>
  );
}
