/* FLiCK AI 블로그 작성기 이미지·제목 보정 기능 */
(function(){
  let lastBody = '';
  let running = false;

  // 본문에서 [IMAGE_1] 아래의 이미지 설명을 찾아 실제 이미지 생성에 사용합니다.
  function extractPrompts(body){
    const out = [];
    const re = /\[IMAGE_(\d+)\][\r\n]+\[이미지 설명:\s*([^\]]+)\]/g;
    let m;
    while((m = re.exec(body)) && out.length < 6){
      const prompt = m[2].trim();
      // AI가 예시 문구를 그대로 출력한 경우에는 이미지 생성 대상에서 제외합니다.
      if(prompt && !prompt.includes('실제로 만들기 쉬운 구체적인 장면')){
        out.push({ number: Number(m[1]), prompt });
      }
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

    // 주제 자체를 그대로 쓰기보다 검색형 제목으로 자연스럽게 정리합니다.
    let base = topic.replace(/[,，]\s*(알아두면 좋은 기준|비교할 때 확인할 조건|초보자가 놓치기 쉬운 부분|선택 전에 체크할 항목|쉽게 이해하는 방법|이용 전에 알아둘 내용|처음 알아볼 때 필요한 정보|선택할 때 주의할 점)$/,'').trim();
    if(!base) base = '생활에 유용한 계산 방법';
    title.value = `${base}, 계산 전에 알아둘 점`;
  }

  // 이미지 생성 API를 호출합니다.
  async function generateImage(prompt){
    const r = await fetch('/api/generate-image', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({prompt})
    });
    const d = await r.json().catch(()=>({}));
    if(!r.ok || !d.image) throw new Error(d.error || '이미지 생성 실패');
    return d.image;
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

  // 한 장씩 생성해 진행 상황을 화면에 보여줍니다.
  async function makeImages(body){
    if(running) return;
    const prompts = extractPrompts(body);
    if(!prompts.length) return;
    running = true;
    const status = document.getElementById('status');
    const gallery = createGallery();
    const list = gallery.querySelector('#aiImageList');
    list.innerHTML = '';

    try{
      for(let i=0;i<prompts.length;i++){
        status.textContent = `글 생성 완료 · 이미지 ${i+1}/${prompts.length} 생성 중...`;
        const p = prompts[i];
        const card = document.createElement('div');
        card.style.margin = '12px 0 20px';
        card.style.padding = '10px';
        card.style.border = '1px solid #eee';
        card.style.borderRadius = '14px';
        card.innerHTML = `<strong>이미지 ${p.number}</strong><div style="font-size:12px;color:#777;margin:6px 0 10px">${p.prompt}</div><div style="padding:30px;text-align:center;background:#fafafa;border-radius:10px">생성 중...</div>`;
        list.appendChild(card);

        const image = await generateImage(
          `${p.prompt}. 네이버 블로그에 사용할 자연스러운 실제 사진 느낌의 이미지. 깔끔한 구도, 자연스러운 조명, 고품질. 이미지 안에 글자, 문구, 로고, 워터마크를 넣지 않는다.`
        );

        const img = document.createElement('img');
        img.src = image;
        img.alt = p.prompt;
        img.style.display = 'block';
        img.style.width = '100%';
        img.style.borderRadius = '10px';
        img.loading = 'lazy';
        const placeholder = card.querySelector('div:last-child');
        placeholder.replaceWith(img);
      }
      status.textContent = `글 + 이미지 ${prompts.length}장 생성 완료 ✓`;
    }catch(e){
      status.textContent = `글 생성 완료 · 이미지 생성 일부 실패: ${e.message}`;
    }finally{
      running = false;
    }
  }

  // 글 생성 직후 계산기 제목이 비어 있는 경우 자동으로 보완하고, 이미지 생성을 시작합니다.
  setInterval(()=>{
    ensureTitle();
    const body = document.getElementById('body')?.value || '';
    if(body && body !== lastBody && /\[IMAGE_\d+\]/.test(body)){
      lastBody = body;
      makeImages(body);
    }
  }, 700);
})();
