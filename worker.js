// FLiCK AI 블로그 작성기 Worker
// 개인용 블로그 생성기에 필요한 글 생성과 이미지 프롬프트 검수 API를 제공합니다.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 글 생성: 무료 사용량을 아끼기 위해 현재 무료 플랜에서 사용 가능한 8B Fast 모델을 사용합니다.
    if (url.pathname === '/api/generate' && request.method === 'POST') {
      try {
        const body = await request.json();
        const prompt = String(body.prompt || '').trim();
        if (!prompt) return json({ error: '프롬프트가 없습니다.' }, 400);

        const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
          messages: [
            {
              role: 'system',
              content: '너는 한국어 네이버 블로그 전문 작성자다. 자연스럽고 읽기 쉬운 한국어로 작성한다. 일본어, 중국어, 힌디어 등 외국어 문장을 만들지 않는다. AI, API, URL, SUV, EV 같은 일반적인 영문 용어는 필요할 때 사용할 수 있다. 확인되지 않은 가격, 통계, 순위, 할인율, 성능 수치를 임의로 만들지 않는다. 글의 내용과 정확히 연결되는 실제 사진용 이미지 설명을 여러 장 만든다. 각 이미지 설명은 서로 다른 장면이어야 한다.'
            },
            { role: 'user', content: prompt }
          ],
          max_tokens: 2800,
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

        const text = typeof result?.response === 'string'
          ? result.response
          : JSON.stringify(result?.response || {});
        const data = parseModelJSON(text);
        if (!data.title || !data.body) throw new Error('AI 초안에 제목 또는 본문이 없습니다.');

        data.title = cleanKorean(data.title);
        data.body = cleanKorean(data.body);
        return json({ text: JSON.stringify(data) });
      } catch (error) {
        return json({ error: friendlyAIError(error) }, 500);
      }
    }

    // 이미지 프롬프트 검수: 사이트 종류에 맞는 물건을 강제로 넣지 않고 원본 설명을 최우선으로 합니다.
    if (url.pathname === '/api/review-image-prompt' && request.method === 'POST') {
      try {
        const body = await request.json();
        const source = String(body.prompt || '').trim();
        const topic = String(body.topic || '').trim();
        const context = String(body.context || '').trim();
        const heading = String(body.heading || '').trim();
        if (!source) return json({ error: '이미지 설명이 없습니다.' }, 400);

        const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct-fast', {
          messages: [
            {
              role: 'system',
              content: `너는 블로그용 실제 사진 프롬프트 편집자다.
가장 중요한 규칙은 원본 이미지 설명을 다른 소재로 바꾸지 않는 것이다.
사이트 이름이나 주제의 일반적인 이미지 소재를 억지로 추가하지 않는다.
원본 설명에 없는 자동차, 계약서, 계산기, 노트북, 사람, 문서, 화면 등을 자동으로 추가하지 않는다.
원본 설명에 실제로 포함된 핵심 장면과 사물을 유지하면서 사진으로 만들기 어려운 표현만 구체적인 촬영 장면으로 다듬는다.
장소와 구도는 해당 장면에 자연스러운 범위에서 선택한다.
각 이미지가 서로 다른 장면이라면 그대로 서로 다르게 유지한다.
결과는 영어 한 문장만 출력한다.
사실적인 한국의 현대적 상업 사진 스타일, 자연스러운 조명, 현실적인 물체 비율을 사용한다.
읽을 수 있는 글자, 숫자, 로고, 브랜드명, 워터마크는 넣지 않는다.
원본 설명에 사람이 명시되지 않았다면 사람, 얼굴, 손, 신체를 추가하지 않는다.`
            },
            {
              role: 'user',
              content: `블로그 주제: ${topic}\n소제목: ${heading}\n원본 이미지 설명: ${source}\n주변 본문 문맥: ${context}\n\n원본 이미지 설명의 핵심 장면을 그대로 살린 실제 사진 프롬프트를 영어 한 문장으로 작성하라.`
            }
          ],
          max_tokens: 320,
          temperature: 0.1,
          top_p: 0.8
        });

        const response = typeof result?.response === 'string' ? result.response.trim() : '';
        if (!response) throw new Error('이미지 프롬프트 검수 결과가 비어 있습니다.');
        return json({ prompt: response.replace(/^['"“”]+|['"“”]+$/g, '') });
      } catch (error) {
        return json({ error: friendlyAIError(error) }, 500);
      }
    }

    // 검수된 프롬프트로 실제 이미지를 생성합니다.
    if (url.pathname === '/api/generate-image' && request.method === 'POST') {
      try {
        const body = await request.json();
        const prompt = String(body.prompt || '').trim();
        if (!prompt) return json({ error: '이미지 설명이 없습니다.' }, 400);

        const result = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
          prompt: prompt.slice(0, 2048),
          steps: 4
        });
        if (!result?.image) throw new Error('이미지 응답이 비어 있습니다.');
        return json({ image: `data:image/jpeg;base64,${result.image}` });
      } catch (error) {
        return json({ error: friendlyAIError(error) }, 500);
      }
    }

    // 최신 enhance.js를 항상 페이지에 주입합니다.
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const response = await env.ASSETS.fetch(request);
      const html = await response.text();
      // 기존 enhance.js가 HTML에 들어 있어도 새 버전으로 교체해 캐시 때문에 패치가 안 보이는 문제를 막습니다.
      const scriptTag = '<script src="/enhance.js?v=12"></script>';
      const injected = html.includes('enhance.js')
        ? html.replace(/<script[^>]+src=["'][^"']*enhance\.js[^"']*["'][^>]*><\/script>/gi, scriptTag)
        : html.replace('</body>', `${scriptTag}</body>`);
      return new Response(injected, {
        status: response.status,
        headers: new Headers(response.headers)
      });
    }

    return env.ASSETS.fetch(request);
  }
};

// AI가 JSON을 코드블록 등으로 감싸도 실제 JSON 부분을 찾아 읽습니다.
function parseModelJSON(raw) {
  let text = String(raw)
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try { return JSON.parse(text); } catch (e) {}

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch (e) {}
  }
  throw new Error('AI 결과 형식을 읽지 못했습니다.');
}

// 블로그에 불필요한 일본어/중국어 문장이 섞이는 것을 마지막으로 정리합니다.
function cleanKorean(value) {
  return String(value || '')
    .replace(/[\u3040-\u30ff]+/g, '')
    .replace(/[\u3400-\u4dbf\u4e00-\u9fff]+/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

// Cloudflare 사용량 초과 오류를 사용자가 이해하기 쉬운 한국어로 표시합니다.
function friendlyAIError(error) {
  const message = String(error?.message || error || 'AI 요청에 실패했습니다.');
  if (/10,000 neurons|daily free allocation|3036|Account limited/i.test(message)) {
    return '오늘 Cloudflare Workers AI 무료 사용량을 모두 사용했습니다. 무료 사용량은 한국시간 오전 9시에 다시 초기화됩니다.';
  }
  return message;
}

// JSON 응답 공통 처리 함수입니다.
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}