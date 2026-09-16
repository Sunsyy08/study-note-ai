'use client';

import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function Home() {
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');

  async function handleUpload() {
    if (!file) {
      setMessage('사진을 먼저 선택해주세요!');
      return;
    }

    setUploading(true);
    setMessage('업로드 중...');

    // 원본 파일명이 한글이나 공백을 포함해도 문제없도록, 확장자만 남기고 새 이름을 만들어요
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

    const { error: insertError } = await supabase
      .from('notes')
      .insert({ image_url: urlData.publicUrl, status: 'pending' });

    if (insertError) {
      setMessage('기록 저장 실패: ' + insertError.message);
    } else {
      setMessage('업로드 성공! 접수 대장에 기록됐어요 ✅');
    }

    setUploading(false);
  }

  return (
    <main style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Hello, 학습노트! 📚</h1>
      <p>공부 노트 사진을 올려보세요.</p>

      <input
        type="file"
        accept="image/*"
        onChange={(e) => setFile(e.target.files[0])}
      />
      <button onClick={handleUpload} disabled={uploading}>
        {uploading ? '업로드 중...' : '업로드'}
      </button>

      {message && <p>{message}</p>}
    </main>
  );
}
