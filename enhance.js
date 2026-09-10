/* FLiCK AI 블로그 작성기 이미지 프롬프트 검수·생성 기능 */
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
      if(prompt && !prompt.includes('실제로 만들기 쉬운 구체적인 장면')) out.push({number:Number(m[1]), prompt});
    }
    return out;
  }

  // 글의 주제와 이미지 설명을 별도 AI 검수 API로 보내 최종 이미지 프롬프트를 만듭니다.
  async function reviewImagePrompt(prompt, topic){
    const r = await fetch('/api/review-image-prompt', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({prompt, topic})
    });
    const d = await r.json().catch(()=>({}));
    if(!r.ok || !d.prompt) throw new Error(d.error || '이미지 프롬프트 검수 실패');
    return String(d.prompt).trim();
  }

  // 검수된 최종 프롬프트로 FLUX 이미지를 생성합니다.
  async function generateImage(prompt){
    const r = await fetch('/api/generate-image', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({prompt})
    });
    const d = await r.json().catch(()=>({}));
    if(!r.ok || !d.image) throw new Error(d.error || '이미지 생성 실패');
    return d.image;
  }

  // 생성된 이미지를 글 아래에 카드 형태로 표시합니다.
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

  // 한 장마다 프롬프트를 먼저 검수한 뒤 이미지를 생성합니다.
  async function makeImages(body){
    if(running) return;
    const prompts = extractPrompts(body);
    if(!prompts.length) return;
    running = true;
    const status = document.getElementById('status');
    const gallery = createGallery();
    const list = gallery.querySelector('#aiImageList');
    list.innerHTML = '';
    const topic = document.getElementById('topicManual')?.value.trim() || document.getElementById('topic')?.value.trim() || '';

    try{
      for(let i=0;i<prompts.length;i++){
        const p = prompts[i];
        status.textContent = `글 완료 · 이미지 ${i+1}/${prompts.length} 프롬프트 검수 중...`;
        const card = document.createElement('div');
        card.style.margin = '12px 0 20px'; card.style.padding = '10px';
        card.style.border = '1px solid #eee'; card.style.borderRadius = '14px';
        card.innerHTML = `<strong>이미지 ${p.number}</strong><div style="font-size:12px;color:#777;margin:6px 0 10px">원본 설명: ${p.prompt}</div><div style="padding:30px;text-align:center;background:#fafafa;border-radius:10px">프롬프트 검수 중...</div>`;
        list.appendChild(card);

        // 이미지 생성 전에 주제 적합성·사진 스타일·금지 요소를 별도 AI가 다시 확인합니다.
        const reviewedPrompt = await reviewImagePrompt(p.prompt, topic);
        card.querySelector('div:last-child').textContent = '검수 완료 · 이미지 생성 중...';

        // 검수 결과에 사진 품질과 문자 제거 조건을 마지막으로 덧붙입니다.
        const finalPrompt = `${reviewedPrompt}. Photorealistic editorial photograph for a Korean blog, modern Korean setting, natural lighting, realistic materials, clean composition, no people as the main subject, no text, no letters, no numbers, no symbols, no logos, no watermark, no illustration, no anime, no painting, no cartoon, no fantasy.`;
        const image = await generateImage(finalPrompt);

        const img = document.createElement('img');
        img.src = image; img.alt = p.prompt; img.style.display = 'block';
        img.style.width = '100%'; img.style.borderRadius = '10px'; img.loading = 'lazy';
        card.querySelector('div:last-child').replaceWith(img);
      }
      status.textContent = `글 + 이미지 ${prompts.length}장 생성 완료 ✓`;
    }catch(e){
      status.textContent = `글 생성 완료 · 이미지 생성 일부 실패: ${e.message}`;
    }finally{ running = false; }
  }

  // 글 생성 직후 이미지 자동 생성을 시작합니다.
  setInterval(()=>{
    const body = document.getElementById('body')?.value || '';
    if(body && body !== lastBody && /\[IMAGE_\d+\]/.test(body)){
      lastBody = body;
      makeImages(body);
    }
  }, 700);
})();
