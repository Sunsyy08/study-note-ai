import { GoogleGenerativeAI } from '@google/generative-ai';

// 퀴즈 생성도 시간이 걸릴 수 있으니 60초까지 허용
export const maxDuration = 60;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function POST(request) {
  try {
    const { summary, keywords } = await request.json();

    if (!summary) {
      return Response.json(
        { success: false, error: '요약 내용이 없어서 퀴즈를 만들 수 없어요.' },
        { status: 400 }
      );
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });

    const prompt = `아래는 학생의 학습 노트를 AI가 요약한 내용입니다.

[요약]
${summary}

[키워드]
${Array.isArray(keywords) ? keywords.join(', ') : ''}

이 내용을 바탕으로 4지선다 객관식 퀴즈를 4개 만들어주세요.

규칙:
- 요약과 키워드에 실제로 나온 내용만 가지고 문제를 내세요.
- 보기 4개는 모두 그럴듯해야 하고, 정답은 1개만 있어야 합니다.
- 정답 위치(answer)는 문제마다 골고루 섞어주세요.
- 해설(explanation)은 1문장으로 짧게 써주세요.

다음 형식의 JSON으로만 답하세요 (다른 설명 없이):
{
  "quiz": [
    {
      "question": "질문 내용",
      "options": ["보기1", "보기2", "보기3", "보기4"],
      "answer": 0,
      "explanation": "정답 해설 한 문장"
    }
  ]
}

answer 는 정답 보기의 번호입니다. 0이면 첫 번째 보기, 3이면 네 번째 보기입니다.`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const cleaned = responseText.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    // AI가 이상한 형식으로 줬을 때를 대비해서 걸러내기
    const quiz = (parsed.quiz || []).filter(
      (q) =>
        q &&
        typeof q.question === 'string' &&
        Array.isArray(q.options) &&
        q.options.length === 4 &&
        typeof q.answer === 'number' &&
        q.answer >= 0 &&
        q.answer <= 3
    );

    if (quiz.length === 0) {
      throw new Error('퀴즈 형식이 올바르지 않아요. 다시 시도해주세요.');
    }

    return Response.json({ success: true, quiz });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}
