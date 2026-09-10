/* FLiCK AI 블로그 작성기 이미지 자동 생성 기능 */
(function(){
  let lastBody = '';
  let running = false;

  // 본문에서 [IMAGE_1] 아래의 이미지 설명을 찾아 실제 이미지 생성에 사용합니다.
  function extractPrompts(body){
    const out = [];
    const re = /\[IMAGE_(\d+)\][\r\n]+\[이미지 설명:\s*([^\]]+)\]/g;
    let m;
    while((m = re.exec(body)) && out.length < 6){
      out.push({ number: Number(m[1]), prompt: m[2].trim() });
    }
    return out;
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

  // 기존 글 생성 코드가 본문 textarea에 값을 넣은 뒤 자동으로 이미지 생성을 시작합니다.
  setInterval(()=>{
    const body = document.getElementById('body')?.value || '';
    if(body && body !== lastBody && /\[IMAGE_\d+\]/.test(body)){
      lastBody = body;
      makeImages(body);
    }
  }, 700);
})();
