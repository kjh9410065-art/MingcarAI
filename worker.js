// 밍카 AI 블로그 작성기 Worker
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

        // 혼자 사용하는 블로그 작성기라 가벼운 모델을 기본으로 사용합니다.
        const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
          messages: [
            { role: 'system', content: '너는 한국어 자동차 정보 블로그 작성 도우미다. 확인되지 않은 사실을 만들지 않는다.' },
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
