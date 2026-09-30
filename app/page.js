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
  const [listFilter, setListFilter] = useState('all'); // 'all' | 'favorite' | 'wrong'

  // 퀴즈 상태: { [노트id]: { loading, error, questions, picked } }
  const [quizzes, setQuizzes] = useState({});

  // 펼침 상태
  const [openWrong, setOpenWrong] = useState({}); // 오답노트 펼침
  const [openScore, setOpenScore] = useState({}); // 필기 점수 상세 펼침

  useEffect(() => {
    loadNotes();
  }, []);

  async function loadNotes() {
    setLoadingNotes(true);
    // notes + note_summaries(점수 포함) + wrong_answers(오답) 를 한 번에 가져옵니다
    const { data, error } = await supabase
      .from('notes')
      .select(
        '*, note_summaries(summary, keywords, score, organization_score, key_content_score, readability_score, review_score, feedback), wrong_answers(id, question, options, user_answer, correct_answer, explanation, created_at)'
      )
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
        subject: subject,
        is_favorite: false,
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

    setNotes((prev) =>
      prev.map((n) => (n.id === note.id ? { ...n, is_favorite: next } : n))
    );

    const { error } = await supabase
      .from('notes')
      .update({ is_favorite: next })
      .eq('id', note.id);

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

  // 퀴즈 보기 선택 → 틀리면 오답노트에 자동 저장
  async function pickAnswer(note, questionIndex, optionIndex) {
    const current = quizzes[note.id];
    if (!current || !current.questions) return;
    // 이미 고른 문제는 다시 못 고르게
    if (current.picked[questionIndex] !== undefined) return;

    const q = current.questions[questionIndex];

    // 1. 화면에 먼저 정답/오답 표시
    setQuizzes((prev) => ({
      ...prev,
      [note.id]: {
        ...prev[note.id],
        picked: { ...prev[note.id].picked, [questionIndex]: optionIndex },
      },
    }));

    // 2. 맞았으면 여기서 끝
    if (optionIndex === q.answer) return;

    // 3. 틀렸으면 오답노트에 저장
    const { data, error } = await supabase
      .from('wrong_answers')
      .insert({
        note_id: note.id,
        question: q.question,
        options: q.options,
        user_answer: optionIndex,
        correct_answer: q.answer,
        explanation: q.explanation || null,
      })
      .select()
      .single();

    if (error) {
      setMessage('오답 저장 실패: ' + error.message);
      return;
    }

    // 4. 화면의 오답 개수를 바로 반영 (새로고침 없이)
    setNotes((prev) =>
      prev.map((n) =>
        n.id === note.id
          ? { ...n, wrong_answers: [...(n.wrong_answers || []), data] }
          : n
      )
    );
  }

  // 퀴즈 닫기
  function closeQuiz(noteId) {
    setQuizzes((prev) => {
      const next = { ...prev };
      delete next[noteId];
      return next;
    });
  }

  // 오답 하나 지우기 (복습 완료)
  async function deleteWrongAnswer(noteId, wrongId) {
    const { error } = await supabase.from('wrong_answers').delete().eq('id', wrongId);

    if (error) {
      setMessage('오답 삭제 실패: ' + error.message);
      return;
    }

    setNotes((prev) =>
      prev.map((n) =>
        n.id === noteId
          ? { ...n, wrong_answers: (n.wrong_answers || []).filter((w) => w.id !== wrongId) }
          : n
      )
    );
  }

  function toggleWrong(noteId) {
    setOpenWrong((prev) => ({ ...prev, [noteId]: !prev[noteId] }));
  }

  function toggleScore(noteId) {
    setOpenScore((prev) => ({ ...prev, [noteId]: !prev[noteId] }));
  }

  // 필터 적용된 목록
  const visibleNotes = notes.filter((note) => {
    const wrongCount = note.wrong_answers?.length || 0;
    if (listFilter === 'favorite' && !note.is_favorite) return false;
    if (listFilter === 'wrong' && wrongCount === 0) return false;
    if (subjectFilter !== '전체' && (note.subject || '기타') !== subjectFilter) return false;
    return true;
  });

  // 전체 오답 개수 (필터 버튼에 표시)
  const totalWrong = notes.reduce((sum, n) => sum + (n.wrong_answers?.length || 0), 0);

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

  // 점수 막대 한 줄
  function ScoreBar({ label, value }) {
    if (value == null) return null;
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
        <span style={{ fontSize: '0.8rem', width: '110px', flexShrink: 0 }}>{label}</span>
        <div style={{ flex: 1, height: '6px', background: '#e8e8e8', borderRadius: '999px' }}>
          <div
            style={{
              width: `${value}%`,
              height: '100%',
              background: '#5b8def',
              borderRadius: '999px',
            }}
          />
        </div>
        <span style={{ fontSize: '0.8rem', width: '38px', textAlign: 'right', color: '#555' }}>
          {value}점
        </span>
      </div>
    );
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
          <button style={filterBtnStyle(listFilter === 'all')} onClick={() => setListFilter('all')}>
            전체 노트
          </button>
          <button style={filterBtnStyle(listFilter === 'favorite')} onClick={() => setListFilter('favorite')}>
            ⭐ 중요 노트만
          </button>
          <button style={filterBtnStyle(listFilter === 'wrong')} onClick={() => setListFilter('wrong')}>
            ❌ 오답노트{totalWrong > 0 ? ` (${totalWrong})` : ''}
          </button>
        </div>
      </div>

      {loadingNotes && <p>불러오는 중...</p>}
      {!loadingNotes && notes.length === 0 && <p>아직 기록이 없어요. 첫 사진을 올려보세요!</p>}
      {!loadingNotes && notes.length > 0 && visibleNotes.length === 0 && (
        <p style={{ color: '#888' }}>
          {listFilter === 'wrong' ? '아직 틀린 문제가 없어요. 퀴즈를 풀어보세요!' : '조건에 맞는 노트가 없어요.'}
        </p>
      )}

      {visibleNotes.map((note) => {
        const quiz = quizzes[note.id];
        const summaryRow = note.note_summaries?.[0];
        // 최근에 틀린 것부터 보여주기
        const wrongList = [...(note.wrong_answers || [])].sort(
          (a, b) => new Date(b.created_at) - new Date(a.created_at)
        );
        const wrongCount = wrongList.length;

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

            {note.status === 'done' && summaryRow && (
              <>
                <p><strong>📝 요약</strong>: {summaryRow.summary}</p>
                <p><strong>🔑 키워드</strong>: {summaryRow.keywords?.join(', ')}</p>

                {/* ===== ✨ AI 필기 점수 ===== */}
                {summaryRow.score != null && (
                  <div style={{ marginTop: '0.6rem' }}>
                    <button
                      onClick={() => toggleScore(note.id)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        padding: '0.5rem 0.7rem',
                        borderRadius: '6px',
                        border: '1px solid #dde3ef',
                        background: '#f4f7fd',
                        cursor: 'pointer',
                        fontSize: '0.9rem',
                      }}
                    >
                      ✨ AI 필기 점수{' '}
                      <strong style={{ color: '#3b6fd4' }}>{summaryRow.score}점</strong>
                      <span style={{ float: 'right', color: '#888', fontSize: '0.8rem' }}>
                        {openScore[note.id] ? '닫기 ▲' : '자세히 ▼'}
                      </span>
                    </button>

                    {openScore[note.id] && (
                      <div
                        style={{
                          marginTop: '0.5rem',
                          padding: '0.8rem',
                          background: '#fafbfe',
                          borderRadius: '6px',
                        }}
                      >
                        <ScoreBar label="📚 내용 정리" value={summaryRow.organization_score} />
                        <ScoreBar label="🧠 핵심 내용" value={summaryRow.key_content_score} />
                        <ScoreBar label="👀 가독성" value={summaryRow.readability_score} />
                        <ScoreBar label="🔄 복습하기 좋음" value={summaryRow.review_score} />

                        {summaryRow.feedback && (
                          <p style={{ fontSize: '0.85rem', marginTop: '0.7rem', lineHeight: 1.6 }}>
                            <strong>💬 AI 한마디</strong>
                            <br />
                            {summaryRow.feedback}
                          </p>
                        )}

                        <p style={{ fontSize: '0.72rem', color: '#aaa', marginTop: '0.5rem' }}>
                          AI가 사진만 보고 매긴 참고용 점수예요.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* ===== ❌ 오답노트 ===== */}
                <div style={{ marginTop: '0.6rem' }}>
                  {wrongCount > 0 ? (
                    <button
                      onClick={() => toggleWrong(note.id)}
                      style={{
                        padding: '0.4rem 0.8rem',
                        borderRadius: '6px',
                        border: '1px solid #f0c6c6',
                        background: '#fdf3f3',
                        color: '#b23b3b',
                        cursor: 'pointer',
                        fontSize: '0.85rem',
                      }}
                    >
                      ❌ 오답 {wrongCount}개 {openWrong[note.id] ? '▲' : '▼'}
                    </button>
                  ) : (
                    <span style={{ fontSize: '0.82rem', color: '#bbb' }}>❌ 오답 없음</span>
                  )}

                  {openWrong[note.id] && wrongCount > 0 && (
                    <div
                      style={{
                        marginTop: '0.6rem',
                        padding: '0.8rem',
                        background: '#fdf8f8',
                        borderRadius: '6px',
                      }}
                    >
                      {wrongList.map((w, wi) => (
                        <div
                          key={w.id}
                          style={{
                            paddingBottom: '0.8rem',
                            marginBottom: '0.8rem',
                            borderBottom: wi === wrongList.length - 1 ? 'none' : '1px solid #eee',
                          }}
                        >
                          <p style={{ fontWeight: 'bold', marginBottom: '0.4rem', fontSize: '0.9rem' }}>
                            Q. {w.question}
                          </p>

                          <p style={{ fontSize: '0.85rem', margin: '0.2rem 0', color: '#c62828' }}>
                            내가 선택한 답: {CIRCLE[w.user_answer]}{' '}
                            {Array.isArray(w.options) ? w.options[w.user_answer] : ''}
                          </p>
                          <p style={{ fontSize: '0.85rem', margin: '0.2rem 0', color: '#2e7d32' }}>
                            정답: {CIRCLE[w.correct_answer]}{' '}
                            {Array.isArray(w.options) ? w.options[w.correct_answer] : ''}
                          </p>

                          {w.explanation && (
                            <p style={{ fontSize: '0.85rem', margin: '0.4rem 0', color: '#555', lineHeight: 1.6 }}>
                              💡 {w.explanation}
                            </p>
                          )}

                          <p style={{ fontSize: '0.75rem', color: '#aaa', margin: '0.3rem 0' }}>
                            {new Date(w.created_at).toLocaleString('ko-KR')}에 틀림
                          </p>

                          <button
                            onClick={() => deleteWrongAnswer(note.id, w.id)}
                            style={{
                              border: 'none',
                              background: 'none',
                              color: '#888',
                              cursor: 'pointer',
                              fontSize: '0.8rem',
                              padding: 0,
                            }}
                          >
                            ✓ 복습 완료 (목록에서 지우기)
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* ===== 🧠 퀴즈 버튼 ===== */}
                <button
                  onClick={() => makeQuiz(note)}
                  disabled={quiz?.loading}
                  style={{
                    marginTop: '0.6rem',
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
                              onClick={() => pickAnswer(note, qi, oi)}
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
                                : `❌ 틀렸습니다. 정답은 ${CIRCLE[q.answer]}입니다. (오답노트에 저장됐어요)`}
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
