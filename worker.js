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

        // 글 전체를 별도의 편집 AI로 검수합니다.
        const reviewPrompt = `아래 네이버 블로그 초안을 게시 전 최종 검수하고 수정하라.
제목과 본문은 자연스러운 한국어로 작성한다. 일본어 히라가나/가타카나, 중국어 문장, 힌디어 등이 섞이면 자연스러운 한국어로 바꾼다. AI, API, URL, SUV, EV 같은 일반적인 영문 약어는 허용한다. 번역투와 반복 문장을 제거한다. [IMAGE_숫자]와 [이미지 설명: ...] 형식은 유지한다.
각 이미지 설명은 이미지 생성 모델이 장면을 정확히 이해하도록 최소 40자 이상의 구체적인 한국어 설명으로 작성한다. 반드시 '무엇을 보여주는지 + 어디에서 + 어떤 구도로 + 어떤 물건이 보이는지 + 글의 어떤 내용을 설명하는지'를 포함한다. '관련된 장면', '비교하는 모습', '자료를 확인하는 모습'처럼 추상적이고 짧은 표현을 쓰지 않는다. 실제 글의 바로 앞 소제목과 문단 내용을 시각적으로 보여주는 장면이어야 한다. 서로 다른 이미지의 설명은 서로 다른 장면이어야 한다. 이미지 설명 예시 문구를 그대로 복사하지 않는다. 이미지에 읽을 수 있는 글자나 한자를 요구하지 않는다.
원래 주제와 핵심 정보는 유지하며 확인되지 않은 가격, 통계, 순위, 할인율은 추가하지 않는다. 제목과 본문은 반드시 비어 있지 않게 한다.

검수할 초안:
${JSON.stringify(draftData)}`;
        let finalData = draftData;
        try {
          const reviewed = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
            messages: [
              { role: 'system', content: '너는 네이버 블로그 게시 전 최종 편집자다. 제목과 본문에서 일본어, 중국어, 힌디어 등 외국어 문장이 남지 않도록 한국어로 교정한다. 이미지 설명은 최소 40자의 구체적인 실제 촬영 장면으로 교정한다. 이미지 설명은 앞뒤 문단과 정확히 연결되어야 하며 추상적인 표현을 사용하지 않는다. JSON 형식을 정확히 지킨다. AI, API, URL 같은 일반적인 영문 용어는 허용한다.' },
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

    // 이미지 프롬프트 검수 API: 본문 문맥까지 받아 이미지 한 장의 목적을 확정합니다.
    if (url.pathname === '/api/review-image-prompt' && request.method === 'POST') {
      try {
        const body = await request.json();
        const source = String(body.prompt || '').trim();
        const topic = String(body.topic || '').trim();
        const site = String(body.site || '').trim();
        const context = String(body.context || '').trim();
        if (!source) return json({ error: '이미지 설명이 없습니다.' }, 400);

        let sceneRule = '문맥에 실제로 등장한 핵심 대상 하나만 선택한다. 사이트 종류라는 이유만으로 새로운 사물이나 상황을 추가하지 않는다.';
        if (site === 'calc') {
          sceneRule = '계산기 글의 문맥에 실제로 등장한 핵심 계산 대상만 시각화한다. 연봉·세금이면 급여명세서와 계산기, 이자면 계산기와 금융 서류, 생활비면 영수증과 계산기처럼 문맥에 명시된 대상만 사용한다. 사람은 넣지 않는다.';
        } else if (site === 'mingka') {
          sceneRule = '자동차 글의 문맥에 실제로 등장한 핵심 자동차 관련 대상만 시각화한다. 계약이면 자동차 키와 계약 서류, 연비면 차량 대시보드와 계기판, 유지비면 차량 또는 정비 관련 물품처럼 문맥에 명시된 대상만 사용한다. 사람은 넣지 않는다.';
        } else if (site === 'hub') {
          sceneRule = 'AI·디지털 글의 문맥에 실제로 등장한 핵심 디지털 대상을 하나만 시각화한다. API라면 개발 환경이나 API 관련 화면, 이미지 생성이라면 이미지 작업 화면, 서비스 비교라면 실제 비교 대상이 드러나는 단순한 컴퓨터 화면처럼 문맥에 명시된 대상만 사용한다. 문맥에 영상 편집이 명시되지 않았다면 영상 편집 화면을 절대 만들지 않는다. 사람은 넣지 않는다.';
        }

        const result = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
          messages: [
            {
              role: 'system',
              content: `너는 네이버 블로그용 이미지 프롬프트 최종 검수자다. 가장 중요한 규칙은 '문맥에 없는 내용을 상상해서 추가하지 않는 것'이다. 입력된 블로그 주제, 원본 이미지 설명, 주변 본문 문맥을 읽고 그 문단의 핵심을 정확히 보여주는 실제 사진 장면 하나를 설계한다. ${sceneRule}
반드시 다음 순서로 내부적으로 판단한다: 1) 이 이미지가 설명하는 바로 앞 문단의 핵심 주제를 찾는다. 2) 그 문단에 실제로 등장한 시각화 가능한 명사를 1개 또는 서로 직접 관련된 2개만 고른다. 3) 고른 대상 외에는 새로운 개념을 추가하지 않는다. 4) 그 대상이 가장 잘 보이는 하나의 실제 촬영 장면을 만든다.
특히 'API', 'AI', '영상 생성' 같은 추상적인 단어만 있을 경우 임의로 사람, 영상 편집자, 카메라, 회의실, 만족한 사용자 등을 추가하지 않는다. 문맥에 영상 편집 장면이 명시되어 있지 않으면 영상 편집 화면을 만들지 않는다.
결과는 영어 한 문장만 출력한다. 사진에 보이는 대상, 장소, 배치, 구도, 조명까지 구체적으로 적는다. 중국풍, 일본풍, 동양화, 애니메이션, 일러스트, 캐릭터, 판타지 스타일을 사용하지 않는다. 사람, 얼굴, 손, 신체는 넣지 않는다. 이미지 안에 글자, 한자, 일본어, 숫자, 로고, 브랜드명, 워터마크, 간판 문구를 넣지 않는다. 화면이 필요하면 읽을 수 있는 실제 텍스트 대신 단순한 UI 블록과 그래픽으로 표현한다. 한국의 현대적인 환경, 사실적인 상업 사진, 자연광, 깔끔한 구도를 사용한다.`
            },
            { role: 'user', content: `블로그 주제: ${topic}\n사이트: ${site}\n원본 이미지 설명: ${source}\n이미지 주변 본문 문맥: ${context}\n위 입력에 없는 새로운 소재를 추가하지 말고, 이 이미지가 보여줘야 할 단 하나의 장면을 영어 한 문장으로 작성하라.` }
          ],
          max_tokens: 650, temperature: 0.05, top_p: 0.7
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

    // 최신 이미지 프롬프트 검수 스크립트를 주입합니다.
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const response = await env.ASSETS.fetch(request);
      const html = await response.text();
      const injected = html.includes('enhance.js') ? html : html.replace('</body>', '<script src="/enhance.js?v=10"></script></body>');
      return new Response(injected, { status: response.status, headers: new Headers(response.headers) });
    }
    return env.ASSETS.fetch(request);
  }
};

function parseModelJSON(raw) {
  let text = String(raw).replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(text); } catch (e) {}
  const a = text.indexOf('{'); const b = text.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch (e) {} }
  throw new Error('AI 결과 형식을 읽지 못했습니다.');
}

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
