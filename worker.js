// FLiCK AI 블로그 작성기 Worker
// 브라우저에서 API 키를 입력하지 않고 Cloudflare Workers AI를 호출합니다.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 글 생성 API: 브라우저가 이 주소로 프롬프트를 보내면 Workers AI가 답변합니다.
    if (url.pathname === '/api/generate' && request.method === 'POST') {
      try {
        const body = await request.json();
        const prompt = String(body.prompt || '').trim();
        if (!prompt) {
          return json({ error: '프롬프트가 없습니다.' }, 400);
        }

        // 2026년 현재 사용 가능한 Cloudflare Workers AI 모델로 생성합니다.
        // 기존 llama-3.1-8b-instruct는 2026-05-30에 폐기되어 3.2 3B로 교체했습니다.
        const result = await env.AI.run('@cf/meta/llama-3.2-3b-instruct', {
          messages: [
            // 밍카·HUB·계산기 세 사이트 모두 사용할 수 있도록 범용 블로그 작성 역할로 설정합니다.
            { role: 'system', content: '너는 한국어 정보 블로그 작성 도우미다. 확인되지 않은 사실, 가격, 통계, 순위 등을 임의로 만들지 않는다. 사용자가 요청한 사이트와 주제에 맞는 자연스러운 글을 작성한다.' },
            { role: 'user', content: prompt }
          ],
          max_tokens: 3500,
          temperature: 0.7
        });

        return json({ text: result?.response || '' });
      } catch (error) {
        return json({ error: error?.message || 'AI 생성에 실패했습니다.' }, 500);
      }
    }

    // 나머지 요청은 index.html 등 정적 파일에서 제공합니다.
    return env.ASSETS.fetch(request);
  }
};

// JSON 응답을 쉽게 만들기 위한 공통 함수입니다.
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8' }
  });
}
