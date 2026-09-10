// FLiCK AI 블로그 작성기 Worker
// 브라우저에서 API 키를 입력하지 않고 Cloudflare Workers AI를 호출합니다.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 글 생성 API: 초안 생성 후 반드시 한 번 검수한 뒤 브라우저에 전달합니다.
    if (url.pathname === '/api/generate' && request.method === 'POST') {
      try {
        const body = await request.json();
        const prompt = String(body.prompt || '').trim();
        if (!prompt) return json({ error: '프롬프트가 없습니다.' }, 400);

        // 1단계: 블로그 글 초안을 생성합니다.
        const draft = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
          messages: [
            {
              role: 'system',
              content: '너는 한국어 네이버 블로그 전문 작성자다. 제목, 본문, 해시태그를 자연스러운 한국어로 작성한다. 일본어, 중국어, 힌디어 등 외국어 문장을 절대 작성하지 않는다. AI, API, URL, SUV처럼 한국어 글에서 일반적으로 쓰이는 영문 용어는 필요한 경우 사용할 수 있다. 확인되지 않은 사실, 가격, 통계, 순위 등을 임의로 만들지 않는다. 사용자가 요청한 사이트와 주제에 맞는 읽기 쉬운 정보글을 작성한다. 이미지 설명은 실제 이미지 생성에 바로 사용할 수 있는 구체적인 장면으로 작성한다.'
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

        const draftResponse = draft?.response;
        const draftText = typeof draftResponse === 'string' ? draftResponse : JSON.stringify(draftResponse || {});
        const draftData = parseModelJSON(draftText);
        if (!draftData.title || !draftData.body) throw new Error('AI 초안에 제목 또는 본문이 없습니다.');

        // 2단계: 초안을 화면에 넣기 전에 별도의 검수 단계에서 외국어와 어색한 표현을 정리합니다.
        const reviewPrompt = `아래 네이버 블로그 초안을 게시 전 최종 검수하고 수정하라.
반드시 지켜야 할 규칙:
1. 제목과 본문은 자연스러운 한국어로만 작성한다.
2. 일본어 히라가나/가타카나, 중국어 문장, 힌디어 등 외국어 문장이 섞여 있으면 의미가 통하도록 자연스러운 한국어로 바꾼다.
3. AI, API, URL, SUV, EV 등 한국어 글에서 일반적으로 사용하는 영문 약어는 그대로 둘 수 있다.
4. 의미 없는 외국어 단어, 번역투, 이상한 문장, 반복 문장을 제거한다.
5. [IMAGE_숫자]와 [이미지 설명: ...] 형식은 유지한다. 이미지 설명도 한국어로 고친다.
6. 원래 주제와 핵심 정보는 유지한다.
7. 확인되지 않은 가격, 통계, 순위, 할인율 등의 새로운 사실을 추가하지 않는다.
8. 제목은 반드시 비어 있지 않은 자연스러운 한국어 제목이어야 한다.
9. 본문은 반드시 비어 있지 않아야 한다.
10. 해시태그는 기존 형식을 유지한다.

검수할 초안:
${JSON.stringify(draftData)}`;

        let finalData = draftData;
        try {
          const reviewed = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
            messages: [
              {
                role: 'system',
                content: '너는 네이버 블로그 게시 전 최종 편집자다. 출력물에 일본어, 중국어, 힌디어 등 외국어 문장이 남지 않도록 반드시 한국어로 교정한다. 제목과 본문을 읽기 자연스럽게 다듬고 JSON 형식을 정확히 지킨다. AI, API, URL 같은 일반적인 영문 용어는 허용한다.'
              },
              { role: 'user', content: reviewPrompt }
            ],
            max_tokens: 3500,
            temperature: 0.15,
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

          const reviewedResponse = reviewed?.response;
          const reviewedText = typeof reviewedResponse === 'string' ? reviewedResponse : JSON.stringify(reviewedResponse || {});
          const reviewedData = parseModelJSON(reviewedText);
          if (reviewedData.title && reviewedData.body) finalData = reviewedData;
        } catch (reviewError) {
          // 검수 AI가 일시적으로 실패해도 이미 만들어진 초안을 잃지 않도록 초안을 사용합니다.
          finalData = draftData;
        }

        // 화면에 표시하기 직전 마지막 안전 검사입니다.
        finalData.title = cleanKorean(finalData.title);
        finalData.body = cleanKorean(finalData.body);
        return json({ text: JSON.stringify(finalData) });
      } catch (error) {
        return json({ error: error?.message || 'AI 생성에 실패했습니다.' }, 500);
      }
    }

    // 이미지 설명을 받으면 FLUX로 실제 이미지를 생성합니다.
    if (url.pathname === '/api/generate-image' && request.method === 'POST') {
      try {
        const body = await request.json();
        const prompt = String(body.prompt || '').trim();
        if (!prompt) return json({ error: '이미지 설명이 없습니다.' }, 400);

        // FLUX.1 schnell의 공식 파라미터는 steps입니다. seed는 보내지 않습니다.
        const result = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
          prompt: prompt.slice(0, 2048),
          steps: 4
        });

        if (!result?.image) throw new Error('이미지 응답이 비어 있습니다.');

        // 브라우저에서 바로 표시할 수 있도록 Data URI로 반환합니다.
        return json({ image: `data:image/jpeg;base64,${result.image}` });
      } catch (error) {
        return json({ error: error?.message || '이미지 생성에 실패했습니다.' }, 500);
      }
    }

    // index.html을 제공할 때 이미지 자동 생성 스크립트를 함께 주입합니다.
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const response = await env.ASSETS.fetch(request);
      const html = await response.text();
      const injected = html.includes('enhance.js')
        ? html
        : html.replace('</body>', '<script src="/enhance.js?v=4"></script></body>');
      return new Response(injected, {
        status: response.status,
        headers: new Headers(response.headers)
      });
    }

    // 나머지 요청은 정적 파일에서 제공합니다.
    return env.ASSETS.fetch(request);
  }
};

// 모델 응답이 JSON 문자열이거나 코드블록인 경우에도 객체를 읽습니다.
function parseModelJSON(raw) {
  let text = String(raw).replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(text); } catch (e) {}
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(text.slice(a, b + 1)); } catch (e) {}
  }
  throw new Error('AI 결과 형식을 읽지 못했습니다.');
}

// 검수 후에도 남을 수 있는 일본어/히라가나/가타카나 문장을 마지막으로 제거합니다.
function cleanKorean(value) {
  return String(value || '')
    .replace(/[\u3040-\u30ff]+/g, '')
    .replace(/[\u3400-\u4dbf\u4e00-\u9fff]+/g, (m) => {
      // 한자 한 글자가 일반적인 한국어 표현에 포함되는 경우는 보존합니다.
      return m.length <= 2 ? m : '';
    })
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// JSON 응답을 쉽게 만들기 위한 공통 함수입니다.
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8' }
  });
}
