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

        // 블로그 글처럼 긴 한국어 결과를 안정적으로 만들기 위해 70B 모델을 사용합니다.
        // JSON Mode를 함께 사용해 제목·본문·해시태그 형식을 안정적으로 맞춥니다.
        const result = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
          messages: [
            // 세 사이트 모두 사용할 수 있는 한국어 정보 블로그 작성 역할입니다.
            {
              role: 'system',
              content: '너는 한국어 네이버 블로그 전문 작성자다. 반드시 자연스러운 한국어만 사용한다. 영어, 힌디어, 일본어 등 다른 언어 단어를 불필요하게 섞지 않는다. 확인되지 않은 사실, 가격, 통계, 순위 등을 임의로 만들지 않는다. 사용자가 요청한 사이트와 주제에 맞는 읽기 쉬운 정보글을 작성한다.'
            },
            { role: 'user', content: prompt }
          ],
          max_tokens: 3500,
          temperature: 0.35,
          top_p: 0.9,
          response_format: {
            type: 'json_schema',
            json_schema: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                body: { type: 'string' },
                tags: { type: 'string' }
              },
              required: ['title', 'body', 'tags']
            }
          }
        });

        // 모델 응답은 일반 문자열일 수도 있고 JSON 객체일 수도 있으므로 브라우저가 항상 문자열을 받게 합니다.
        const response = result?.response;
        const text = typeof response === 'string' ? response : JSON.stringify(response || {});
        return json({ text });
      } catch (error) {
        return json({ error: error?.message || 'AI 생성에 실패했습니다.' }, 500);
      }
    }

    // 이미지 설명을 받으면 FLUX로 실제 이미지를 생성합니다.
    if (url.pathname === '/api/generate-image' && request.method === 'POST') {
      try {
        const body = await request.json();
        const prompt = String(body.prompt || '').trim();
        if (!prompt) {
          return json({ error: '이미지 설명이 없습니다.' }, 400);
        }

        // 빠른 이미지 생성을 위해 FLUX.1 Schnell을 사용합니다.
        const result = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
          prompt: prompt.slice(0, 2000),
          num_steps: 4
        });

        if (!result?.image) {
          throw new Error('이미지 응답이 비어 있습니다.');
        }

        // 브라우저에서 바로 표시할 수 있도록 Data URI로 반환합니다.
        return json({ image: `data:image/png;base64,${result.image}` });
      } catch (error) {
        return json({ error: error?.message || '이미지 생성에 실패했습니다.' }, 500);
      }
    }

    // index.html을 제공할 때 이미지 자동 생성 스크립트를 함께 주입합니다.
    // 기존 화면 코드를 크게 건드리지 않고 한 번의 글 생성으로 이미지를 이어서 만들 수 있게 합니다.
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const response = await env.ASSETS.fetch(request);
      const html = await response.text();
      const injected = html.replace('</body>', '<script src="/enhance.js?v=1"></script></body>');
      return new Response(injected, {
        status: response.status,
        headers: new Headers(response.headers)
      });
    }

    // 나머지 요청은 정적 파일에서 제공합니다.
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
