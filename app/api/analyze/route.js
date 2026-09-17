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

export async function POST(request) {
  try {
    const { noteId, imageUrl } = await request.json();

    // 1. 사진 데이터를 가져와서 AI가 읽을 수 있는 형태로 변환
    const imageResponse = await fetch(imageUrl);
    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString('base64');

    // 2. Gemini에게 "이 사진 속 학습 내용을 요약해줘" 라고 요청
    const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });

    const prompt = `이 이미지는 학생의 학습 노트 사진입니다.
다음 형식의 JSON으로만 답하세요 (다른 설명 없이):
{
  "summary": "노트 내용을 3~4문장으로 요약",
  "keywords": ["핵심 키워드1", "핵심 키워드2", "핵심 키워드3"]
}`;

    const result = await model.generateContent([
      prompt,
      { inlineData: { data: base64Image, mimeType: 'image/jpeg' } },
    ]);

    const responseText = result.response.text();
    const cleaned = responseText.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    // 3. 분석 결과를 note_summaries 테이블에 저장
    const { error: insertError } = await supabase
      .from('note_summaries')
      .insert({
        note_id: noteId,
        summary: parsed.summary,
        keywords: parsed.keywords,
      });

    if (insertError) throw insertError;

    // 4. notes 테이블의 상태를 "완료"로 변경
    await supabase.from('notes').update({ status: 'done' }).eq('id', noteId);

    return Response.json({ success: true, summary: parsed.summary, keywords: parsed.keywords });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}
