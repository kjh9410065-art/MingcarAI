// FLiCK AI 블로그 작성기 Worker
// 브라우저에서 API 키를 입력하지 않고 Cloudflare Workers AI를 호출합니다.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 글 생성 API: 초안 생성 후 게시 전에 한 번 검수합니다.
    if (url.pathname === '/api/generate' && request.method === 'POST') {
      try {
        const body = await request.json();
        const prompt = String(body.prompt || '').trim();
        if (!prompt) return json({ error: '프롬프트가 없습니다.' }, 400);

        // 1단계: 블로그 글 초안을 생성합니다.
        const draft = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
          messages: [
            { role: 'system', content: '너는 한국어 네이버 블로그 전문 작성자다. 제목, 본문, 해시태그를 자연스러운 한국어로 작성한다. 일본어, 중국어, 힌디어 등 외국어 문장을 절대 작성하지 않는다. AI, API, URL, SUV처럼 한국어 글에서 일반적으로 쓰이는 영문 용어는 필요한 경우 사용할 수 있다. 확인되지 않은 사실, 가격, 통계, 순위 등을 임의로 만들지 않는다. 이미지 설명은 실제 사진으로 만들 수 있는 구체적인 장면으로 작성한다.' },
            { role: 'user', content: prompt }
          ],
          max_tokens: 3500, temperature: 0.35, top_p: 0.9,
          response_format: { type: 'json_schema', json_schema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' }, tags: { type: 'string' } }, required: ['title', 'body', 'tags'] } }
        });

        const draftResponse = draft?.response;
        const draftText = typeof draftResponse === 'string' ? draftResponse : JSON.stringify(draftResponse || {});
        const draftData = parseModelJSON(draftText);
        if (!draftData.title || !draftData.body) throw new Error('AI 초안에 제목 또는 본문이 없습니다.');

        // 2단계: 글 전체를 별도의 편집 AI로 검수합니다.
        const reviewPrompt = `아래 네이버 블로그 초안을 게시 전 최종 검수하고 수정하라.
제목과 본문은 자연스러운 한국어로 작성한다. 일본어 히라가나/가타카나, 중국어 문장, 힌디어 등 외국어가 섞이면 자연스러운 한국어로 바꾼다. AI, API, URL, SUV, EV 같은 일반적인 영문 약어는 허용한다. 번역투와 반복 문장을 제거한다. [IMAGE_숫자]와 [이미지 설명: ...] 형식은 유지한다. 이미지 설명은 추상적인 표현이 아니라 실제 촬영 가능한 장면으로 고친다. 주제와 직접 관련된 사물, 장소, 행동을 구체적으로 적고 불필요한 인물은 넣지 않는다. 이미지 안의 글자, 한자, 일본어, 로고, 워터마크를 요구하지 않는다. 원래 주제와 핵심 정보는 유지하며 확인되지 않은 가격, 통계, 순위, 할인율은 추가하지 않는다. 제목과 본문은 반드시 비어 있지 않게 한다.

검수할 초안:
${JSON.stringify(draftData)}`;

        let finalData = draftData;
        try {
          const reviewed = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
            messages: [
              { role: 'system', content: '너는 네이버 블로그 게시 전 최종 편집자다. 제목과 본문에서 일본어, 중국어, 힌디어 등 외국어 문장이 남지 않도록 한국어로 교정한다. 이미지 설명도 한국어로 구체적으로 교정한다. JSON 형식을 정확히 지킨다. AI, API, URL 같은 일반적인 영문 용어는 허용한다.' },
              { role: 'user', content: reviewPrompt }
            ],
            max_tokens: 3500, temperature: 0.15, top_p: 0.9,
            response_format: { type: 'json_schema', json_schema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' }, tags: { type: 'string' } }, required: ['title', 'body', 'tags'] } }
          });
          const reviewedResponse = reviewed?.response;
          const reviewedText = typeof reviewedResponse === 'string' ? reviewedResponse : JSON.stringify(reviewedResponse || {});
          const reviewedData = parseModelJSON(reviewedText);
          if (reviewedData.title && reviewedData.body) finalData = reviewedData;
        } catch (reviewError) {
          // 검수 AI가 일시적으로 실패해도 초안을 잃지 않습니다.
          finalData = draftData;
        }

        finalData.title = cleanKorean(finalData.title);
        finalData.body = cleanKorean(finalData.body);
        return json({ text: JSON.stringify(finalData) });
      } catch (error) {
        return json({ error: error?.message || 'AI 생성에 실패했습니다.' }, 500);
      }
    }

    // 이미지 프롬프트 검수 API: 이미지 생성 직전에 별도의 AI가 프롬프트를 다시 설계합니다.
    if (url.pathname === '/api/review-image-prompt' && request.method === 'POST') {
      try {
        const body = await request.json();
        const source = String(body.prompt || '').trim();
        const topic = String(body.topic || '').trim();
        if (!source) return json({ error: '이미지 설명이 없습니다.' }, 400);

        const result = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
          messages: [
            {
              role: 'system',
              content: '너는 네이버 블로그용 이미지 프롬프트 최종 검수자다. 입력 설명을 주제에 정확히 맞는 실제 사진용 장면 하나로 다시 작성한다. 결과는 영어 한 문장만 출력한다. 실제 촬영 가능한 장면만 사용한다. 사람 얼굴이나 인물 초상이 핵심이 아니면 사람을 넣지 않는다. 중국풍, 일본풍, 동양화, 애니메이션, 일러스트, 캐릭터, 판타지 스타일을 절대 사용하지 않는다. 이미지 안에 글자, 한자, 일본어, 숫자, 로고, 브랜드명, 워터마크, 간판 문구를 넣지 않는다. 추상적인 개념은 실제 사물이나 상황으로 바꾼다. 주제와 무관한 장식과 인물을 넣지 않는다. 한국의 현대적인 환경을 기본으로 하며 사실적인 사진, 자연광, 깔끔한 구도를 사용한다. 그래프나 문서가 필요한 경우 글자를 그리지 말고 빈 종이와 단순한 도형으로 표현한다.'
            },
            {
              role: 'user',
              content: `블로그 주제: ${topic}\n원본 이미지 설명: ${source}\n위 설명을 주제에 맞는 실제 사진용 장면 프롬프트로 재작성하라.`
            }
          ],
          max_tokens: 500,
          temperature: 0.1,
          top_p: 0.8
        });
        const response = result?.response;
        const reviewed = typeof response === 'string' ? response.trim() : '';
        if (!reviewed) throw new Error('이미지 프롬프트 검수 결과가 비어 있습니다.');
        return json({ prompt: reviewed.replace(/^['"“”]+|['"“”]+$/g, '') });
      } catch (error) {
        return json({ error: error?.message || '이미지 프롬프트 검수에 실패했습니다.' }, 500);
      }
    }

    // 검수된 이미지 프롬프트로 FLUX 이미지를 생성합니다.
    if (url.pathname === '/api/generate-image' && request.method === 'POST') {
      try {
        const body = await request.json();
        const prompt = String(body.prompt || '').trim();
        if (!prompt) return json({ error: '이미지 설명이 없습니다.' }, 400);
        const result = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', { prompt: prompt.slice(0, 2048), steps: 4 });
        if (!result?.image) throw new Error('이미지 응답이 비어 있습니다.');
        return json({ image: `data:image/jpeg;base64,${result.image}` });
      } catch (error) {
        return json({ error: error?.message || '이미지 생성에 실패했습니다.' }, 500);
      }
    }

    // index.html에 이미지 자동 생성 스크립트를 주입합니다.
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const response = await env.ASSETS.fetch(request);
      const html = await response.text();
      const injected = html.includes('enhance.js') ? html : html.replace('</body>', '<script src="/enhance.js?v=6"></script></body>');
      return new Response(injected, { status: response.status, headers: new Headers(response.headers) });
    }
    return env.ASSETS.fetch(request);
  }
};

// 모델 응답이 JSON 문자열이나 코드블록이어도 객체를 읽습니다.
function parseModelJSON(raw) {
  let text = String(raw).replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(text); } catch (e) {}
  const a = text.indexOf('{'); const b = text.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch (e) {} }
  throw new Error('AI 결과 형식을 읽지 못했습니다.');
}

// 검수 후 남을 수 있는 일본어와 긴 한자 문자열을 제거합니다.
function cleanKorean(value) {
  return String(value || '')
    .replace(/[\u3040-\u30ff]+/g, '')
    .replace(/[\u3400-\u4dbf\u4e00-\u9fff]+/g, (m) => m.length <= 2 ? m : '')
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=UTF-8' } });
}
