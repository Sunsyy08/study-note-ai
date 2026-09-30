import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';

// 이 함수가 최대 60초까지 실행되도록 허용 (사진 크기에 따라 시간이 걸릴 수 있어요)
export const maxDuration = 60;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 서버 전용 supabase 클라이언트 (여기서만 사용)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// AI가 점수를 이상하게 줬을 때를 대비해서 0~100 사이 정수로 맞춰주는 함수
function toScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export async function POST(request) {
  try {
    const { noteId, imageUrl } = await request.json();

    // 1. 사진 데이터를 가져와서 AI가 읽을 수 있는 형태로 변환
    const imageResponse = await fetch(imageUrl);
    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString('base64');

    // 2. Gemini에게 요약 + 키워드 + 필기 점수를 한 번에 요청
    const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });

    const prompt = `이 이미지는 학생의 학습 노트(필기) 사진입니다.
내용을 요약하고, 이 필기가 "공부하고 복습하기에 좋은 필기인지"를 평가해주세요.

[점수 기준 — 매우 중요]
- 글씨체가 예쁜지는 절대 평가하지 마세요. 악필이어도 내용이 잘 정리되어 있으면 높은 점수를 주세요.
- organizationScore (내용 정리): 제목과 내용이 구분되는지, 순서나 구조가 잡혀 있는지
- keyContentScore (핵심 내용): 중요한 개념·공식·정의가 실제로 담겨 있는지
- readabilityScore (가독성): 글씨 크기와 줄 간격, 알아보기 힘든 부분이 얼마나 되는지 (예쁨이 아니라 "읽을 수 있는가")
- reviewScore (복습하기 좋은 정도): 나중에 다시 봤을 때 바로 이해되는 구조인지, 표시나 강조가 있는지
- score (전체 점수): 위 네 항목을 고려한 종합 점수

모든 점수는 0~100 사이의 정수입니다.
사진이 흐리거나 일부만 찍혀서 판단하기 어려우면, 무리하게 추측하지 말고 중간 점수(60~75)를 주고
feedback에 "사진이 흐려서 정확한 평가가 어렵다"는 점을 적어주세요.

feedback은 학생에게 건네는 2문장입니다.
잘한 점 1문장 + 이렇게 하면 더 좋아진다는 제안 1문장으로 써주세요. 비난하지 마세요.

다음 형식의 JSON으로만 답하세요 (다른 설명 없이):
{
  "summary": "노트 내용을 3~4문장으로 요약",
  "keywords": ["핵심 키워드1", "핵심 키워드2", "핵심 키워드3"],
  "score": 87,
  "organizationScore": 92,
  "keyContentScore": 85,
  "readabilityScore": 84,
  "reviewScore": 88,
  "feedback": "잘한 점 한 문장. 개선 제안 한 문장."
}`;

    const result = await model.generateContent([
      prompt,
      { inlineData: { data: base64Image, mimeType: 'image/jpeg' } },
    ]);

    const responseText = result.response.text();
    const cleaned = responseText.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    // 3. 분석 결과를 note_summaries 테이블에 저장 (점수 칸이 늘어났습니다)
    const { error: insertError } = await supabase
      .from('note_summaries')
      .insert({
        note_id: noteId,
        summary: parsed.summary,
        keywords: parsed.keywords,
        score: toScore(parsed.score),
        organization_score: toScore(parsed.organizationScore),
        key_content_score: toScore(parsed.keyContentScore),
        readability_score: toScore(parsed.readabilityScore),
        review_score: toScore(parsed.reviewScore),
        feedback: parsed.feedback || null,
      });

    if (insertError) throw insertError;

    // 4. notes 테이블의 상태를 "완료"로 변경
    await supabase.from('notes').update({ status: 'done' }).eq('id', noteId);

    return Response.json({
      success: true,
      summary: parsed.summary,
      keywords: parsed.keywords,
      score: toScore(parsed.score),
    });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}
