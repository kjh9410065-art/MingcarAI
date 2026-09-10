/* FLiCK AI 블로그 작성기 이미지 자동 생성 기능 */
(function(){
  let lastBody = '';
  let running = false;

  // 본문에서 이미지 번호와 설명을 찾아 실제 이미지 생성에 사용합니다.
  function extractPrompts(body){
    const out = [];
    const re = /\[IMAGE_(\d+)\][\r\n]+\[이미지 설명:\s*([^\]]+)\]/g;
    let m;
    while((m = re.exec(body)) && out.length < 6){
      const prompt = m[2].trim();
      if(prompt && !prompt.includes('실제로 만들기 쉬운 구체적인 장면')) out.push({ number: Number(m[1]), prompt });
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

  // 이미지 설명을 한 장씩 별도 AI에게 검수받습니다. 여러 설명을 한 번에 보내지 않습니다.
  async function reviewImagePrompt(topic, site, source){
    const r = await fetch('/api/review-image-prompt', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({topic, site, prompt:source})
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

  // 사이트별로 사람이 등장하지 않는 단일 장면을 최종 고정합니다.
  function finalSceneRule(site){
    if(site === 'calc') return 'photorealistic modern Korean office desk still life, calculator, blank financial documents, notebook and pen as the only visible subjects, no people, no hands, no faces, no bodies';
    if(site === 'mingka') return 'photorealistic modern car-related still life, one vehicle or one dashboard with a small amount of related paperwork, no people, no hands, no faces, no bodies';
    return 'photorealistic modern technology still life, one computer or smartphone device as the main subject, no people, no hands, no faces, no bodies';
  }

  // 한 장씩 프롬프트 검수 후 생성합니다.
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
        const reviewed = await reviewImagePrompt(topic, site, item.prompt);
        // AI가 만든 프롬프트 뒤에 사이트별 단일 장면 규칙만 짧게 덧붙입니다.
        const finalPrompt = `${reviewed}. ${finalSceneRule(site)}. Clean composition, natural daylight, realistic commercial photography. No text, no letters, no numbers, no logos, no signs, no watermark.`;

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
