/* FLiCK AI 블로그 작성기 이미지 자동 생성 기능 */
(function(){
  let lastBody = '';
  let running = false;

  // 이미지 번호, 설명, 그리고 해당 이미지 앞뒤의 본문 문맥을 함께 추출합니다.
  function extractPrompts(body){
    const out = [];
    const re = /\[IMAGE_(\d+)\][\r\n]+\[이미지 설명:\s*([^\]]+)\]/g;
    let m;
    while((m = re.exec(body)) && out.length < 6){
      const prompt = m[2].trim();
      if(!prompt || prompt.includes('실제로 만들기 쉬운 구체적인 장면')) continue;
      const before = body.slice(Math.max(0, m.index - 1000), m.index);
      const after = body.slice(m.index + m[0].length, m.index + m[0].length + 500);
      out.push({number:Number(m[1]), prompt, context:`${before}\n${after}`.trim()});
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

  // 이미지 생성 API를 호출합니다.
  async function generateImage(prompt){
    const r = await fetch('/api/generate-image', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt})});
    const d = await r.json().catch(()=>({}));
    if(!r.ok || !d.image) throw new Error(d.error || '이미지 생성 실패');
    return d.image;
  }

  // 이미지 설명, 소제목 주변 문맥, 사이트 종류를 모두 AI 검수 단계에 전달합니다.
  async function reviewImagePrompt(topic, site, source, context){
    const r = await fetch('/api/review-image-prompt', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({topic, site, prompt:source, context})
    });
    const d = await r.json().catch(()=>({}));
    if(!r.ok || !d.prompt) throw new Error(d.error || '이미지 프롬프트 검수 실패');
    return String(d.prompt).trim();
  }

  function createGallery(){
    let box = document.getElementById('aiImageGallery');
    if(box) return box;
    box = document.createElement('section');
    box.id = 'aiImageGallery';
    box.style.marginTop = '22px';
    box.innerHTML = '<label>🖼️ 자동 생성된 이미지</label><div id="aiImageList"></div>';
    const copy = document.getElementById('copyBtn');
    (copy?.parentElement || document.querySelector('.result') || document.body).appendChild(box);
    return box;
  }

  // 사이트별 기본 방향은 유지하되, 원본 주제에서 벗어나지 않도록 합니다.
  function finalSceneRule(site){
    if(site === 'calc') return 'Use only the exact calculator topic described in the prompt. Select the most relevant physical subject: calculator for calculation topics, calculator with blank financial paper for salary or tax topics, calculator with blank loan paper for loan topics, calculator with blank savings paper for interest topics, receipts with calculator for household spending topics. Do not combine unrelated objects.';
    if(site === 'mingka') return 'Use only the exact automotive topic described in the prompt. Select the most relevant subject: one vehicle for vehicle topics, one dashboard for driving or fuel topics, car key with contract paper for rental or lease contract topics, maintenance items for maintenance topics. Do not combine unrelated objects.';
    return 'Use only the exact AI or digital topic described in the prompt. Select the most relevant subject: one computer for AI software topics, one simple code editor screen for API development topics, one image-editing workspace for image generation topics, one video-editing workspace for video topics. Do not combine unrelated objects.';
  }

  // 한 장씩 문맥을 읽고 프롬프트를 검수한 뒤 이미지를 생성합니다.
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
        const reviewed = await reviewImagePrompt(topic, site, item.prompt, item.context);
        // 검수 결과에 해당 이미지의 정확한 목적과 사이트별 범위를 추가합니다.
        const finalPrompt = `${reviewed}. ${finalSceneRule(site)}. One clear subject, one clear scene, no collage, no split screen, no infographic unless the topic itself is specifically about a chart. Photorealistic editorial photography, realistic proportions, natural daylight, clean composition. No people, no faces, no hands, no bodies. No readable text, no letters, no numbers, no logos, no brand names, no signs, no watermark.`;

        const card = document.createElement('div');
        card.style.margin = '12px 0 20px';
        card.style.padding = '10px';
        card.style.border = '1px solid #eee';
        card.style.borderRadius = '14px';
        card.innerHTML = `<strong>이미지 ${item.number}</strong><div style="font-size:12px;color:#777;margin:6px 0 10px">원본 설명: ${item.prompt}</div><div style="padding:30px;text-align:center;background:#fafafa;border-radius:10px">생성 중...</div>`;
        list.appendChild(card);

        // 최종 프롬프트 하나만 FLUX에 전달합니다.
        const image = await generateImage(finalPrompt);
        const img = document.createElement('img');
        img.src = image;
        img.alt = item.prompt;
        img.style.display = 'block';
        img.style.width = '100%';
        img.style.borderRadius = '10px';
        img.loading = 'lazy';
        card.querySelector('div:last-child').replaceWith(img);
      }
      status.textContent = `글 + 이미지 ${original.length}장 생성 완료 ✓`;
    }catch(e){
      status.textContent = `글 생성 완료 · 이미지 생성 일부 실패: ${e.message}`;
    }finally{
      running = false;
    }
  }

  // 글 생성 직후 계산기 제목을 보완하고 이미지 자동 생성을 시작합니다.
  setInterval(()=>{
    ensureTitle();
    const body = document.getElementById('body')?.value || '';
    if(body && body !== lastBody && /\[IMAGE_\d+\]/.test(body)){
      lastBody = body;
      makeImages(body);
    }
  }, 700);
})();
