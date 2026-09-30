'use client';

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';

// 과목 목록 (여기만 고치면 전체가 같이 바뀝니다)
const SUBJECTS = ['국어', '영어', '수학', '전공', '기타'];

// 보기 번호 표시용
const CIRCLE = ['①', '②', '③', '④'];

export default function Home() {
  const [file, setFile] = useState(null);
  const [subject, setSubject] = useState('기타'); // 업로드할 때 고른 과목
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [message, setMessage] = useState('');
  const [notes, setNotes] = useState([]);
  const [loadingNotes, setLoadingNotes] = useState(true);

  // 필터 상태
  const [subjectFilter, setSubjectFilter] = useState('전체');
  const [favoriteOnly, setFavoriteOnly] = useState(false);

  // 퀴즈 상태: { [노트id]: { loading, error, questions, picked } }
  const [quizzes, setQuizzes] = useState({});

  useEffect(() => {
    loadNotes();
  }, []);

  async function loadNotes() {
    setLoadingNotes(true);
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
      .insert({
        image_url: urlData.publicUrl,
        status: 'pending',
        subject: subject,        // ← 과목 같이 저장
        is_favorite: false,      // ← 처음엔 즐겨찾기 해제 상태
      })
      .select()
      .single();

    if (insertError) {
      setMessage('기록 저장 실패: ' + insertError.message);
      setUploading(false);
      return;
    }

    setMessage('업로드 성공! 이제 AI가 분석하도록 요청할게요...');
    setUploading(false);
    loadNotes();

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
    loadNotes();
  }

  // ⭐ 즐겨찾기 켜고 끄기
  async function toggleFavorite(note) {
    const next = !note.is_favorite;

    // 화면을 먼저 바꿔서 빠르게 반응하도록
    setNotes((prev) =>
      prev.map((n) => (n.id === note.id ? { ...n, is_favorite: next } : n))
    );

    const { error } = await supabase
      .from('notes')
      .update({ is_favorite: next })
      .eq('id', note.id);

    // 저장 실패하면 원래대로 되돌리기
    if (error) {
      setNotes((prev) =>
        prev.map((n) => (n.id === note.id ? { ...n, is_favorite: !next } : n))
      );
      setMessage('중요 표시 저장 실패: ' + error.message);
    }
  }

  // 🧠 퀴즈 만들기
  async function makeQuiz(note) {
    const summaryRow = note.note_summaries?.[0];

    if (!summaryRow) {
      setQuizzes((prev) => ({
        ...prev,
        [note.id]: { loading: false, error: '아직 분석이 끝나지 않은 노트예요.', questions: null, picked: {} },
      }));
      return;
    }

    setQuizzes((prev) => ({
      ...prev,
      [note.id]: { loading: true, error: null, questions: null, picked: {} },
    }));

    try {
      const res = await fetch('/api/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: summaryRow.summary,
          keywords: summaryRow.keywords,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setQuizzes((prev) => ({
          ...prev,
          [note.id]: { loading: false, error: null, questions: data.quiz, picked: {} },
        }));
      } else {
        setQuizzes((prev) => ({
          ...prev,
          [note.id]: { loading: false, error: data.error, questions: null, picked: {} },
        }));
      }
    } catch (e) {
      setQuizzes((prev) => ({
        ...prev,
        [note.id]: { loading: false, error: e.message, questions: null, picked: {} },
      }));
    }
  }

  // 퀴즈 보기 선택
  function pickAnswer(noteId, questionIndex, optionIndex) {
    setQuizzes((prev) => {
      const current = prev[noteId];
      if (!current) return prev;
      // 이미 고른 문제는 다시 못 고르게
      if (current.picked[questionIndex] !== undefined) return prev;

      return {
        ...prev,
        [noteId]: {
          ...current,
          picked: { ...current.picked, [questionIndex]: optionIndex },
        },
      };
    });
  }

  // 퀴즈 닫기
  function closeQuiz(noteId) {
    setQuizzes((prev) => {
      const next = { ...prev };
      delete next[noteId];
      return next;
    });
  }

  // 필터 적용된 목록
  const visibleNotes = notes.filter((note) => {
    if (favoriteOnly && !note.is_favorite) return false;
    if (subjectFilter !== '전체' && (note.subject || '기타') !== subjectFilter) return false;
    return true;
  });

  // 필터 버튼 스타일
  function filterBtnStyle(active) {
    return {
      padding: '0.35rem 0.8rem',
      marginRight: '0.4rem',
      marginBottom: '0.4rem',
      borderRadius: '999px',
      border: active ? '1px solid #333' : '1px solid #ddd',
      background: active ? '#333' : '#fff',
      color: active ? '#fff' : '#555',
      cursor: 'pointer',
      fontSize: '0.85rem',
    };
  }

  return (
    <main style={{ maxWidth: '600px', margin: '0 auto', padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Hello, 학습노트! 📚</h1>
      <p>공부 노트 사진을 올리면 AI가 요약해드려요.</p>

      {/* ===== 업로드 영역 ===== */}
      <div style={{ margin: '1.5rem 0', padding: '1rem', background: '#f5f5f5', borderRadius: '8px' }}>
        <div style={{ marginBottom: '0.7rem' }}>
          <label style={{ fontSize: '0.9rem', marginRight: '0.5rem' }}>과목</label>
          <select
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            style={{ padding: '0.3rem 0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
          >
            {SUBJECTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

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

      {/* ===== 필터 영역 ===== */}
      <div style={{ margin: '0.8rem 0 1.2rem' }}>
        <div>
          <button style={filterBtnStyle(subjectFilter === '전체')} onClick={() => setSubjectFilter('전체')}>
            전체
          </button>
          {SUBJECTS.map((s) => (
            <button key={s} style={filterBtnStyle(subjectFilter === s)} onClick={() => setSubjectFilter(s)}>
              {s}
            </button>
          ))}
        </div>
        <div style={{ marginTop: '0.3rem' }}>
          <button style={filterBtnStyle(!favoriteOnly)} onClick={() => setFavoriteOnly(false)}>
            전체 노트
          </button>
          <button style={filterBtnStyle(favoriteOnly)} onClick={() => setFavoriteOnly(true)}>
            ⭐ 중요 노트만
          </button>
        </div>
      </div>

      {loadingNotes && <p>불러오는 중...</p>}
      {!loadingNotes && notes.length === 0 && <p>아직 기록이 없어요. 첫 사진을 올려보세요!</p>}
      {!loadingNotes && notes.length > 0 && visibleNotes.length === 0 && (
        <p style={{ color: '#888' }}>조건에 맞는 노트가 없어요.</p>
      )}

      {visibleNotes.map((note) => {
        const quiz = quizzes[note.id];

        return (
          <div
            key={note.id}
            style={{
              border: '1px solid #ddd',
              borderRadius: '8px',
              padding: '1rem',
              marginBottom: '1rem',
            }}
          >
            {/* 과목 뱃지 + 즐겨찾기 버튼 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span
                style={{
                  fontSize: '0.75rem',
                  background: '#eef1f5',
                  color: '#555',
                  padding: '0.2rem 0.6rem',
                  borderRadius: '999px',
                }}
              >
                {note.subject || '기타'}
              </span>

              <button
                onClick={() => toggleFavorite(note)}
                style={{
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  color: note.is_favorite ? '#e8a900' : '#999',
                }}
              >
                {note.is_favorite ? '★ 중요' : '☆ 중요'}
              </button>
            </div>

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

                {/* 🧠 퀴즈 버튼 */}
                <button
                  onClick={() => makeQuiz(note)}
                  disabled={quiz?.loading}
                  style={{
                    marginTop: '0.5rem',
                    padding: '0.4rem 0.8rem',
                    borderRadius: '6px',
                    border: '1px solid #ccc',
                    background: '#fff',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                  }}
                >
                  {quiz?.loading ? '퀴즈 만드는 중...' : '🧠 퀴즈 만들기'}
                </button>

                {/* 퀴즈 결과 */}
                {quiz?.error && (
                  <p style={{ color: '#c00', fontSize: '0.85rem', marginTop: '0.5rem' }}>
                    ❌ {quiz.error}
                  </p>
                )}

                {quiz?.questions && (
                  <div
                    style={{
                      marginTop: '0.8rem',
                      padding: '0.8rem',
                      background: '#fafafa',
                      borderRadius: '6px',
                    }}
                  >
                    {quiz.questions.map((q, qi) => {
                      const picked = quiz.picked[qi];
                      const answered = picked !== undefined;
                      const correct = answered && picked === q.answer;

                      return (
                        <div key={qi} style={{ marginBottom: '1rem' }}>
                          <p style={{ fontWeight: 'bold', marginBottom: '0.4rem' }}>
                            Q{qi + 1}. {q.question}
                          </p>

                          {q.options.map((opt, oi) => (
                            <button
                              key={oi}
                              onClick={() => pickAnswer(note.id, qi, oi)}
                              disabled={answered}
                              style={{
                                display: 'block',
                                width: '100%',
                                textAlign: 'left',
                                marginBottom: '0.3rem',
                                padding: '0.4rem 0.6rem',
                                borderRadius: '6px',
                                fontSize: '0.85rem',
                                cursor: answered ? 'default' : 'pointer',
                                border:
                                  answered && oi === q.answer
                                    ? '1px solid #2e7d32'
                                    : answered && oi === picked
                                    ? '1px solid #c62828'
                                    : '1px solid #ddd',
                                background:
                                  answered && oi === q.answer
                                    ? '#e8f5e9'
                                    : answered && oi === picked
                                    ? '#ffebee'
                                    : '#fff',
                              }}
                            >
                              {CIRCLE[oi]} {opt}
                            </button>
                          ))}

                          {answered && (
                            <p style={{ fontSize: '0.85rem', marginTop: '0.3rem' }}>
                              {correct
                                ? '✅ 정답입니다!'
                                : `❌ 틀렸습니다. 정답은 ${CIRCLE[q.answer]}입니다.`}
                              {q.explanation && (
                                <span style={{ color: '#666' }}> — {q.explanation}</span>
                              )}
                            </p>
                          )}
                        </div>
                      );
                    })}

                    <button
                      onClick={() => closeQuiz(note.id)}
                      style={{
                        border: 'none',
                        background: 'none',
                        color: '#888',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        padding: 0,
                      }}
                    >
                      퀴즈 닫기
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </main>
  );
}
