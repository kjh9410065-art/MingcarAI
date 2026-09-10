/* FLiCK AI 블로그 작성기 이미지 자동 생성 기능 */
(function(){
  let lastBody = '';
  let running = false;

  // 이미지 번호, 설명, 앞뒤 문맥, 가장 가까운 소제목을 함께 추출합니다.
  function extractPrompts(body){
    const out = [];
    const re = /\[IMAGE_(\d+)\][\r\n]+\[이미지 설명:\s*([^\]]+)\]/g;
    let m;
    while((m = re.exec(body)) && out.length < 6){
      const prompt = m[2].trim();
      if(!prompt || prompt.includes('실제로 만들기 쉬운 구체적인 장면')) continue;
      const before = body.slice(Math.max(0, m.index - 1200), m.index);
      const after = body.slice(m.index + m[0].length, m.index + m[0].length + 500);
      const headings = [...before.matchAll(/##\s+([^\n]+)/g)];
      const heading = headings.length ? headings[headings.length - 1][1].trim() : '';
      out.push({number:Number(m[1]), prompt, heading, context:`${before}\n${after}`.trim()});
    }
    return out;
  }

  // 계산기 글에서 제목이 비어 있으면 주제를 기반으로 제목을 자동 보완합니다.
  function ensureTitle(){
    const title = document.getElementById('title');
    const topic = document.getElementById('topicManual')?.value.trim() || document.getElementById('topic')?.value.trim() || '';
    const body = document.getElementById('body')?.value.trim() || '';
    const calcTab = [...document.querySelectorAll('.tab')].find(x => x.dataset.site === 'calc');
    const isCalc = calcTab?.classList.contains('active');
    if(!title || title.value.trim() || !isCalc || !body) return;
    let base = topic.replace(/[,，]\s*(알아두면 좋은 기준|비교할 때 확인할 조건|초보자가 놓치기 쉬운 부분|선택 전에 체크할 항목|쉽게 이해하는 방법|이용 전에 알아둘 내용|처음 알아볼 때 필요한 정보|선택할 때 주의할 점)$/,'').trim();
    if(!base) base = '생활에 유용한 계산 방법';
    title.value = `${base}, 계산 전에 알아둘 점`;
  }

  async function generateImage(prompt){
    const r = await fetch('/api/generate-image', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt})});
    const d = await r.json().catch(()=>({}));
    if(!r.ok || !d.image) throw new Error(d.error || '이미지 생성 실패');
    return d.image;
  }

  // 이미지 설명, 소제목, 본문 문맥을 별도 AI에게 보내 실제 이미지의 목적을 확정합니다.
  async function reviewImagePrompt(topic, site, source, context, heading){
    const r = await fetch('/api/review-image-prompt', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({topic, site, prompt:source, context, heading})
    });
    const d = await r.json().catch(()=>({}));
    if(!r.ok || !d.prompt) throw new Error(d.error || '이미지 프롬프트 검수 실패');
    return String(d.prompt).trim();
  }

  function createGallery(){
    let box = document.getElementById('aiImageGallery');
    if(box) return box;
    box = document.createElement('section');
    box.id = 'aiImageGallery'; box.style.marginTop = '22px';
    box.innerHTML = '<label>🖼️ 자동 생성된 이미지</label><div id="aiImageList"></div>';
    const copy = document.getElementById('copyBtn');
    (copy?.parentElement || document.querySelector('.result') || document.body).appendChild(box);
    return box;
  }

  // 핵심 단어를 이용해 AI가 문맥과 무관한 소재를 선택하지 못하도록 시각적 기준점을 정합니다.
  function visualAnchor(site, text){
    const s = String(text || '').toLowerCase();
    if(site === 'mingka'){
      if(/장기렌트|리스|계약기간|계약서|월 납입|납입금|계약 조건/.test(s)) return 'PRIMARY VISUAL ANCHOR: a car key resting directly on one single rental or lease contract document on a clean desk; this exact pair is the dominant subject';
      if(/연비|연료|주행거리|연료비|전비/.test(s)) return 'PRIMARY VISUAL ANCHOR: one modern car dashboard instrument cluster viewed straight on; the dashboard is the dominant subject';
      if(/유지비|정비|수리|소모품|보험료|자동차세|세금/.test(s)) return 'PRIMARY VISUAL ANCHOR: one automotive maintenance invoice with a car key on a clean desk; the invoice is blank and unreadable';
      if(/가격|비용|총비용|초기 비용/.test(s)) return 'PRIMARY VISUAL ANCHOR: one car key beside one simple blank cost document on a clean desk; no dashboard';
      return 'PRIMARY VISUAL ANCHOR: one modern car or one clearly relevant automotive object directly named in the section; do not invent another automotive concept';
    }
    if(site === 'calc'){
      if(/연봉|월급|급여|실수령|소득/.test(s)) return 'PRIMARY VISUAL ANCHOR: one calculator beside one blank salary statement on a clean office desk; the calculator and paper are dominant';
      if(/세금|소득세|원천징수/.test(s)) return 'PRIMARY VISUAL ANCHOR: one calculator beside one blank tax document on a clean office desk';
      if(/대출|원리금|이자율/.test(s)) return 'PRIMARY VISUAL ANCHOR: one calculator beside one blank loan document on a clean desk';
      if(/예금|적금|저축|복리|단리/.test(s)) return 'PRIMARY VISUAL ANCHOR: one calculator beside one savings notebook and blank financial paper on a clean desk';
      if(/생활비|지출|가계부|예산|소비|영수증/.test(s)) return 'PRIMARY VISUAL ANCHOR: a small stack of blank receipts beside one calculator on a clean desk';
      return 'PRIMARY VISUAL ANCHOR: one calculator as the dominant subject, with at most one closely related blank paper item';
    }
    if(/이미지 생성|그림 생성|사진 생성/.test(s)) return 'PRIMARY VISUAL ANCHOR: one desktop monitor displaying a generic image-generation workspace with simple abstract blocks and no readable text';
    if(/API|개발|코드|프로그래밍/.test(s)) return 'PRIMARY VISUAL ANCHOR: one laptop displaying a generic code editor with abstract lines and no readable text';
    if(/영상|동영상|편집/.test(s)) return 'PRIMARY VISUAL ANCHOR: one desktop monitor displaying a generic video-editing timeline with abstract blocks and no readable text';
    return 'PRIMARY VISUAL ANCHOR: one computer or digital device directly named in the section, with no unrelated objects';
  }

  // 이미지별 역할을 정해 서로 다른 문단이 비슷한 사진만 만드는 것을 줄입니다.
  function imageRole(index, site){
    if(site === 'calc') return ['핵심 계산 도구','계산에 필요한 핵심 자료','본문의 계산 대상','계산 결과를 확인하는 도구','글의 핵심 내용을 보여주는 대표 장면'][index % 5];
    if(site === 'mingka') return ['핵심 자동차 요소','계약 또는 이용 조건의 핵심 요소','차량 관련 핵심 요소','비용 또는 조건의 핵심 요소','글의 핵심 내용을 보여주는 대표 장면'][index % 5];
    return ['핵심 AI 또는 디지털 도구','사용 과정의 핵심 기기','비교 대상의 핵심 기능','작업 결과','글의 핵심 내용을 보여주는 대표 장면'][index % 5];
  }

  async function makeImages(body){
    if(running) return;
    const original = extractPrompts(body);
    if(!original.length) return;
    running = true;
    const status = document.getElementById('status');
    const topic = document.getElementById('topicManual')?.value.trim() || document.getElementById('topic')?.value.trim() || '';
    const site = [...document.querySelectorAll('.tab')].find(x => x.classList.contains('active'))?.dataset.site || 'mingka';
    const gallery = createGallery();
    const list = gallery.querySelector('#aiImageList');
    list.innerHTML = '';

    try{
      for(let i=0;i<original.length;i++){
        const item = original[i];
        status.textContent = `이미지 ${i+1}/${original.length} 프롬프트 검수 중...`;
        const role = imageRole(i, site);
        const anchor = visualAnchor(site, `${topic}\n${item.heading}\n${item.prompt}\n${item.context}`);
        const reviewed = await reviewImagePrompt(topic, site, item.prompt, `${role}\n${anchor}\n${item.context}`, item.heading);
        // 기준점을 먼저 배치하고 실제 촬영 가능한 구도까지 지정해 이미지가 다른 주제로 이탈하지 않게 합니다.
        const finalPrompt = `${anchor}. ARTICLE TOPIC: ${topic}. ARTICLE SECTION: ${item.heading || role}. IMAGE PURPOSE: ${role}. ${reviewed}. The primary visual anchor is mandatory and must occupy most of the frame. The image must communicate the exact meaning of the section at first glance. Show exactly one clear scene and no more than two closely related objects. Never replace the anchor with a generic lifestyle scene. Never add decorative objects or an unrelated vehicle, person, chart, screen, or document. Use a realistic Korean editorial photograph, medium close-up product/document composition, eye-level or slight top-down camera angle, natural daylight, realistic materials, crisp focus on the primary subject, subtle background blur only when useful. No collage, no split screen, no fantasy, no illustration, no anime, no painting. No people, no faces, no hands, no bodies. No readable text, no letters, no numbers, no logos, no brand names, no signs, no watermark. If a document or monitor is necessary, show it partially and make all content completely unreadable with neutral lines or blocks only.`;

        const card = document.createElement('div');
        card.style.margin = '12px 0 20px'; card.style.padding = '10px';
        card.style.border = '1px solid #eee'; card.style.borderRadius = '14px';
        card.innerHTML = `<strong>이미지 ${item.number}</strong><div style="font-size:12px;color:#777;margin:6px 0 10px">원본 설명: ${item.prompt}</div><div style="padding:30px;text-align:center;background:#fafafa;border-radius:10px">생성 중...</div>`;
        list.appendChild(card);

        const image = await generateImage(finalPrompt);
        const img = document.createElement('img');
        img.src = image; img.alt = item.prompt; img.style.display = 'block';
        img.style.width = '100%'; img.style.borderRadius = '10px'; img.loading = 'lazy';
        card.querySelector('div:last-child').replaceWith(img);
      }
      status.textContent = `글 + 이미지 ${original.length}장 생성 완료 ✓`;
    }catch(e){
      status.textContent = `글 생성 완료 · 이미지 생성 일부 실패: ${e.message}`;
    }finally{ running = false; }
  }

  // 글 생성 직후 제목을 보완하고 이미지 자동 생성을 시작합니다.
  setInterval(()=>{
    ensureTitle();
    const body = document.getElementById('body')?.value || '';
    if(body && body !== lastBody && /\[IMAGE_\d+\]/.test(body)){
      lastBody = body; makeImages(body);
    }
  }, 700);
})();
