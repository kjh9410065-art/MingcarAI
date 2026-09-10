/* FLiCK AI 블로그 작성기 이미지 자동 생성 기능 */
(function(){
  let lastBody = '';
  let running = false;

  // 이미지 번호, 설명, 앞뒤 문맥, 그리고 가장 가까운 소제목을 함께 추출합니다.
  function extractPrompts(body){
    const out = [];
    const re = /\[IMAGE_(\d+)\][\r\n]+\[이미지 설명:\s*([^\]]+)\]/g;
    let m;
    while((m = re.exec(body)) && out.length < 6){
      const prompt = m[2].trim();
      if(!prompt || prompt.includes('실제로 만들기 쉬운 구체적인 장면')) continue;
      const before = body.slice(Math.max(0, m.index - 1200), m.index);
      const after = body.slice(m.index + m[0].length, m.index + m[0].length + 500);
      // 이미지 바로 앞에 있는 가장 최근의 ## 소제목을 찾아 이미지 목적을 명확히 합니다.
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

  // 이미지별 역할을 정해 5장이 전부 비슷한 사무실 사진이 되는 것을 방지합니다.
  function imageRole(index, site){
    if(site === 'calc') return [
      '주제의 핵심 계산 도구를 대표하는 장면',
      '계산에 실제로 필요한 핵심 자료를 대표하는 장면',
      '본문에서 설명한 계산 대상 또는 비교 대상을 대표하는 장면',
      '계산 결과를 확인하는 데 사용하는 핵심 도구를 대표하는 장면',
      '글의 핵심 내용을 가장 직관적으로 보여주는 대표 장면'
    ][index % 5];
    if(site === 'mingka') return [
      '주제의 핵심 자동차 요소를 대표하는 장면',
      '본문에서 설명한 계약 또는 이용 조건의 핵심 요소를 대표하는 장면',
      '본문에서 설명한 차량 관련 핵심 요소를 대표하는 장면',
      '본문에서 설명한 비용 또는 조건의 핵심 요소를 대표하는 장면',
      '글의 핵심 내용을 가장 직관적으로 보여주는 대표 장면'
    ][index % 5];
    return [
      '주제의 핵심 AI 또는 디지털 도구를 대표하는 장면',
      '본문에서 설명한 사용 과정의 핵심 기기를 대표하는 장면',
      '본문에서 설명한 비교 대상의 핵심 기능을 대표하는 장면',
      '본문에서 설명한 작업 결과를 대표하는 장면',
      '글의 핵심 내용을 가장 직관적으로 보여주는 대표 장면'
    ][index % 5];
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
        const reviewed = await reviewImagePrompt(topic, site, item.prompt, `${role}\n${item.context}`, item.heading);
        // AI 검수 결과보다 글의 핵심 주제와 소제목을 우선하도록 최종 지시를 명시합니다.
        const finalPrompt = `${reviewed}. ARTICLE TOPIC: ${topic}. ARTICLE SECTION: ${item.heading || role}. The primary subject must directly and unmistakably represent this section. Show exactly one main subject or one tightly related pair. Do not invent a generic lifestyle scene. Do not add objects merely for decoration. Do not add a person unless the article explicitly requires a person. Photorealistic Korean editorial photography, realistic materials, natural daylight, clean composition. No collage, no split screen, no fantasy, no illustration, no anime. No readable text, no letters, no numbers, no logos, no brand names, no signs, no watermark.`;

        const card = document.createElement('div');
        card.style.margin = '12px 0 20px'; card.style.padding = '10px';
        card.style.border = '1px solid #eee'; card.style.borderRadius = '14px';
        card.innerHTML = `<strong>이미지 ${item.number}</strong><div style="font-size:12px;color:#777;margin:6px 0 10px">원본 설명: ${item.prompt}</div><div style="padding:30px;text-align:center;background:#fafafa;border-radius:10px">생성 중...</div>`;
        list.appendChild(card);

        // 최종 프롬프트 하나만 FLUX에 전달합니다.
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
