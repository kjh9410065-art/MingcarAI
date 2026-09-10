/* FLiCK AI 블로그 작성기 이미지 자동 생성 기능 */
(function(){
  let lastBody = '';
  let running = false;

  // 이미지 번호와 함께 이미지 바로 앞뒤의 본문 문맥도 추출합니다.
  // 단순한 한 줄 설명만 보내면 이미지가 글과 무관해질 수 있어 소제목과 주변 문장을 함께 검수합니다.
  function extractPrompts(body){
    const out = [];
    const re = /\[IMAGE_(\d+)\][\r\n]+\[이미지 설명:\s*([^\]]+)\]/g;
    let m;
    while((m = re.exec(body)) && out.length < 6){
      const prompt = m[2].trim();
      if(!prompt || prompt.includes('실제로 만들기 쉬운 구체적인 장면')) continue;

      // 이미지 앞뒤의 실제 글 내용을 가져와 이미지의 목적을 명확하게 전달합니다.
      const before = body.slice(Math.max(0, m.index - 700), m.index);
      const after = body.slice(m.index + m[0].length, m.index + m[0].length + 350);
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

  // 이미지 설명뿐 아니라 주변 본문과 사이트 정보를 함께 AI에게 보내 이미지 한 장의 목적을 확정합니다.
  async function reviewImagePrompt(topic, site, source, context){
    const r = await fetch('/api/review-image-prompt', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({topic, site, prompt:source, context})
    });
    const d = await r.json().catch(()=>({}));
    if(!r.ok || !d.prompt) throw new Error(d.error || '이미지 프롬프트 검수 실패');
    return String(d.prompt).trim();
  }

  // 글 아래에 실제 생성된 이미지를 표시합니다.
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

  // 사이트마다 사용할 수 있는 대표적인 촬영 대상을 제한합니다.
  function finalSceneRule(site){
    if(site === 'calc') return 'modern Korean office desk still life; choose ONLY the single most relevant object or pair of closely related objects from the article, such as a calculator with blank paper, a laptop showing a generic blank calculation interface, or a notebook with a calculator; no people';
    if(site === 'mingka') return 'modern Korean automotive scene; choose ONLY the single most relevant subject from the article, such as one car dashboard, one vehicle exterior, or one small group of contract papers with a car key; no people';
    return 'modern technology scene; choose ONLY the single most relevant subject from the article, such as one laptop, one smartphone, or one simple device setup; no people';
  }

  // 한 장씩 프롬프트를 검수한 뒤 생성합니다.
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
        status.textContent = `이미지 프롬프트 ${i+1}/${original.length} 검수 중...`;
        const reviewed = await reviewImagePrompt(topic, site, item.prompt, item.context);
        const finalPrompt = `${reviewed}. ${finalSceneRule(site)}. Photorealistic commercial blog photography, natural daylight, clean composition. No text, no letters, no numbers, no logos, no signs, no watermark.`;

        const card = document.createElement('div');
        card.style.margin = '12px 0 20px';
        card.style.padding = '10px';
        card.style.border = '1px solid #eee';
        card.style.borderRadius = '14px';
        card.innerHTML = `<strong>이미지 ${item.number}</strong><div style="font-size:12px;color:#777;margin:6px 0 10px">원본 설명: ${item.prompt}</div><div style="padding:30px;text-align:center;background:#fafafa;border-radius:10px">생성 중...</div>`;
        list.appendChild(card);

        // 최종 검수된 한 장면 프롬프트만 FLUX에 전달합니다.
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
