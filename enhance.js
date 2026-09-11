/* FLiCK AI 블로그 작성기 개선판
 * 개인용 작업대 UI + 자동 이미지 생성 + 초안 자동 저장을 한 파일에서 관리합니다.
 */
(function(){
  'use strict';

  let lastBody = '';
  let running = false;

  // 본문에서 이미지 번호, 설명, 앞뒤 문맥을 추출합니다.
  function extractPrompts(body){
    const out=[];
    const re=/\[IMAGE_(\d+)\][\r\n]+\[이미지 설명:\s*([^\]]+)\]/g;
    let m;
    while((m=re.exec(body)) && out.length<6){
      const prompt=m[2].trim();
      if(!prompt || prompt.includes('실제로 만들기 쉬운 구체적인 장면')) continue;
      const before=body.slice(Math.max(0,m.index-1400),m.index);
      const after=body.slice(m.index+m[0].length,m.index+m[0].length+700);
      const headings=[...before.matchAll(/##\s+([^\n]+)/g)];
      const heading=headings.length?headings[headings.length-1][1].trim():'';
      out.push({number:Number(m[1]),prompt,heading,context:`${before}\n${after}`.trim()});
    }
    return out;
  }

  // 이미지 생성 API를 호출합니다.
  async function generateImage(prompt){
    const r=await fetch('/api/generate-image',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.image) throw new Error(d.error||'이미지 생성 실패');
    return d.image;
  }

  // 본문 문맥을 기준으로 이미지 프롬프트를 한 번 더 검수합니다.
  async function reviewImagePrompt(topic,site,source,context,heading){
    const r=await fetch('/api/review-image-prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({topic,site,prompt:source,context,heading})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||!d.prompt) throw new Error(d.error||'이미지 프롬프트 검수 실패');
    return String(d.prompt).trim();
  }

  // 글의 주제에 맞는 핵심 장면을 정합니다.
  // 문서 이미지만 반복되지 않도록 자동차 자체를 우선 시각화합니다.
  function visualAnchor(site,text,index){
    const s=String(text||'').toLowerCase();

    if(site==='mingka'){
      if(/연비|연료|주행거리|전비|충전/.test(s)){
        return index%2===0
          ? 'PRIMARY VISUAL ANCHOR: a modern car dashboard and instrument cluster photographed from the driver seat, with no readable numbers'
          : 'PRIMARY VISUAL ANCHOR: a modern car parked at a clean charging or fuel station, photographed as a realistic automotive editorial photo';
      }
      if(/유지비|정비|수리|소모품|보험료|자동차세|세금/.test(s)){
        return index%2===0
          ? 'PRIMARY VISUAL ANCHOR: a clean modern car in a professional automotive service bay, no mechanic visible'
          : 'PRIMARY VISUAL ANCHOR: a close automotive detail of a tire, wheel and clean car body in a service center';
      }
      if(/계약서|계약기간|계약 조건|월 납입|납입금|장기렌트|리스/.test(s)){
        const scenes=[
          'PRIMARY VISUAL ANCHOR: a modern mid-size car photographed from a three-quarter front angle in a clean Korean dealership lot',
          'PRIMARY VISUAL ANCHOR: the interior of a modern car photographed from the open driver door, focusing on the steering wheel, center console and seats',
          'PRIMARY VISUAL ANCHOR: a modern car parked neatly in an apartment parking area, photographed as a realistic Korean automotive editorial photo',
          'PRIMARY VISUAL ANCHOR: a close-up of a modern car key placed beside the steering wheel inside a clean modern car, no document visible',
          'PRIMARY VISUAL ANCHOR: a modern car photographed from a clean side profile in natural daylight, with the entire vehicle clearly visible'
        ];
        return scenes[index%scenes.length];
      }
      if(/가격|비용|총비용|초기 비용/.test(s)){
        return index%2===0
          ? 'PRIMARY VISUAL ANCHOR: a modern car photographed in a clean dealership lot with the entire vehicle clearly visible'
          : 'PRIMARY VISUAL ANCHOR: a car key and steering wheel inside a modern car, photographed in close detail with no paper or screen';
      }
      return 'PRIMARY VISUAL ANCHOR: one modern car clearly related to the article topic, photographed as a realistic Korean automotive editorial photo';
    }

    if(site==='calc'){
      if(/연봉|월급|급여|실수령|소득/.test(s)) return index%2===0
        ? 'PRIMARY VISUAL ANCHOR: one modern calculator beside a simple blank salary paper with no readable text'
        : 'PRIMARY VISUAL ANCHOR: a calculator and a clean desk with coins arranged naturally, no readable text';
      if(/세금|소득세|원천징수/.test(s)) return 'PRIMARY VISUAL ANCHOR: one modern calculator beside a completely blank tax-form-like paper with no readable text';
      if(/대출|원리금|이자율/.test(s)) return 'PRIMARY VISUAL ANCHOR: one modern calculator beside a simple blank financial paper and a few coins, no readable text';
      if(/예금|적금|저축|복리|단리/.test(s)) return 'PRIMARY VISUAL ANCHOR: one calculator beside a simple savings notebook with no readable text and a few coins';
      if(/생활비|지출|가계부|예산|소비|영수증/.test(s)) return 'PRIMARY VISUAL ANCHOR: one calculator beside a small stack of blank receipts and coins, no readable text';
      return 'PRIMARY VISUAL ANCHOR: one modern calculator as the dominant subject on a clean desk';
    }

    if(/이미지 생성|그림 생성|사진 생성/.test(s)) return 'PRIMARY VISUAL ANCHOR: one desktop monitor showing a generic image-generation interface made only of abstract UI blocks and colored shapes, no readable text';
    if(/API|개발|코드|프로그래밍/.test(s)) return 'PRIMARY VISUAL ANCHOR: one laptop showing a generic code editor made only of abstract colored code lines, no readable text';
    if(/영상|동영상|편집/.test(s)) return 'PRIMARY VISUAL ANCHOR: one desktop monitor showing a generic video-editing timeline made only of abstract blocks, no readable text';
    return 'PRIMARY VISUAL ANCHOR: one modern computer or digital device directly related to the article section';
  }

  // 이미지마다 서로 다른 촬영 역할을 부여합니다.
  function imageRole(index,site){
    if(site==='mingka') return ['대표 차량 장면','차량 실내 장면','실제 이용 환경','차량 세부 장면','대표 차량 장면'][index%5];
    if(site==='calc') return ['핵심 계산 도구','계산 자료 장면','계산 대상 장면','금액 확인 장면','대표 계산 장면'][index%5];
    return ['핵심 AI 도구','사용 환경 장면','기능을 보여주는 장면','작업 결과 장면','대표 서비스 장면'][index%5];
  }

  // 이미지 갤러리를 만듭니다.
  function createGallery(){
    let box=document.getElementById('aiImageGallery');
    if(box) return box;
    box=document.createElement('section');
    box.id='aiImageGallery';
    box.innerHTML='<label>🖼️ 자동 생성 이미지</label><div id="aiImageList"></div>';
    const result=document.querySelector('.result');
    (result||document.body).appendChild(box);
    return box;
  }

  // 글의 이미지 자리마다 본문과 연결된 장면을 생성합니다.
  async function makeImages(body){
    if(running) return;
    const original=extractPrompts(body);
    if(!original.length) return;
    running=true;
    const status=document.getElementById('status');
    const topic=document.getElementById('topicManual')?.value.trim()||document.getElementById('topic')?.value.trim()||'';
    const active=document.querySelector('.tab.active');
    const site=active?.dataset.site||'mingka';
    const gallery=createGallery();
    const list=gallery.querySelector('#aiImageList');
    list.innerHTML='';

    try{
      for(let i=0;i<original.length;i++){
        const item=original[i];
        status.textContent=`이미지 ${i+1}/${original.length} 생성 준비 중...`;
        const role=imageRole(i,site);
        const anchor=visualAnchor(site,`${topic}\n${item.heading}\n${item.prompt}\n${item.context}`,i);
        const reviewed=await reviewImagePrompt(topic,site,item.prompt,`${role}\n${anchor}\n${item.context}`,item.heading);

        // 생성 모델이 문서·글자를 과하게 만들지 않도록 최종 안전 규칙을 강하게 적용합니다.
        const finalPrompt=`${anchor}. ARTICLE TOPIC: ${topic}. ARTICLE SECTION: ${item.heading||role}. IMAGE PURPOSE: ${role}. ${reviewed}. Create ONE coherent realistic photograph, not an illustration. The main subject must fill most of the frame and be immediately recognizable. Prefer a real physical object, vehicle, interior or environment over paperwork. Do not create a generic office desk scene unless the article section is specifically about an office. Do not create documents, forms, receipts, contracts or papers unless they are essential to the exact section. If paper is necessary, it must be completely blank and contain zero writing. No readable text, letters, numbers, Korean characters, Chinese characters, Japanese characters, logos, brand names, signs or watermarks. Never invent text. Do not repeat the same composition as other images. No collage, split screen, infographic, diagram, poster, screenshot, fantasy, anime, cartoon, painting or 3D render. No people, faces, hands or bodies. Natural daylight, realistic Korean editorial photography, crisp focus, professional composition, subtle background blur, 4:5 vertical composition.`;

        const card=document.createElement('div');
        card.className='image-card';
        card.innerHTML=`<strong>이미지 ${item.number}</strong><div class="image-source">${escapeHtml(item.prompt)}</div><div class="image-loading">생성 중...</div>`;
        list.appendChild(card);

        try{
          const image=await generateImage(finalPrompt);
          const img=document.createElement('img');
          img.src=image;img.alt=item.prompt;img.loading='lazy';
          card.querySelector('.image-loading').replaceWith(img);
        }catch(e){
          const failed=card.querySelector('.image-loading');
          failed.textContent=`생성 실패 · ${e.message}`;
          failed.className='image-failed';
          const retry=document.createElement('button');
          retry.textContent='↻ 다시 생성';
          retry.className='image-retry';
          retry.onclick=()=>retryOne(card,finalPrompt,item.prompt);
          card.appendChild(retry);
        }
      }
      status.textContent=`글 + 이미지 ${original.length}장 작업 완료 ✓`;
    }catch(e){
      status.textContent=`글 생성 완료 · 이미지 작업 중 일부 실패: ${e.message}`;
    }finally{running=false;}
  }

  // 실패한 이미지만 다시 생성합니다.
  async function retryOne(card,prompt,alt){
    const button=card.querySelector('.image-retry');
    if(button) button.disabled=true;
    try{
      const image=await generateImage(prompt);
      const img=document.createElement('img');img.src=image;img.alt=alt;img.loading='lazy';
      card.querySelector('.image-failed')?.replaceWith(img);
      button?.remove();
    }catch(e){
      if(button){button.disabled=false;button.textContent='↻ 다시 생성';}
    }
  }

  // HTML에 넣을 텍스트의 특수문자를 안전하게 처리합니다.
  function escapeHtml(value){
    return String(value||'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }

  // 개인용 작업대 UI를 적용합니다.
  function installUI(){
    if(document.getElementById('privateBlogUI')) return;
    const style=document.createElement('style');
    style.id='privateBlogUI';
    style.textContent=`
      body{max-width:980px!important;background:linear-gradient(180deg,#f6f5fb,#fafafd)!important;padding:18px!important}
      main{padding:22px!important;border:1px solid #eceaf4;box-shadow:0 10px 35px rgba(30,25,60,.07)!important}
      h1{font-size:clamp(25px,5vw,36px);letter-spacing:-.04em;margin-bottom:8px!important}
      .muted{font-size:13px!important;line-height:1.55}
      .tabs{margin:16px 0!important;gap:7px!important}.tab{border-radius:12px!important;min-height:48px;transition:.15s}.tab.active{box-shadow:0 5px 14px rgba(117,103,232,.2)}
      .site-info{background:#f7f5ff!important;border-radius:15px!important;padding:15px 16px!important}
      label{font-size:14px!important;margin-top:18px!important}
      input,select,textarea,button{border-radius:12px!important;border-color:#dedce6!important}input,select{min-height:48px}
      textarea{min-height:420px!important;line-height:1.75!important}.btn{min-height:48px!important}.primary{box-shadow:0 7px 18px rgba(117,103,232,.18)}
      .status{font-size:13px!important;line-height:1.45;background:#f7f6fb!important}.result{margin-top:24px!important;padding-top:18px;border-top:1px solid #eee}.result:before{content:'생성 결과';display:block;font-size:19px;font-weight:900;margin-bottom:4px}
      #title{font-weight:800;font-size:16px}#tags{color:#6259a9}
      .private-tools{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0 4px}.private-tools button{background:#fff;font-weight:800;cursor:pointer;min-height:44px}.private-tools .primary-tool{background:#7567e8;color:#fff;border-color:#7567e8}
      .private-save{font-size:12px;color:#777;margin:7px 2px}.image-card{margin:12px 0 20px;padding:12px;border:1px solid #eee;border-radius:14px;background:#fff}.image-source{font-size:12px;color:#777;margin:6px 0 10px;line-height:1.5}.image-card img{display:block;width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:10px}.image-loading,.image-failed{padding:30px;text-align:center;background:#fafafa;border-radius:10px;color:#777}.image-retry{margin-top:8px;width:100%;padding:10px;cursor:pointer;background:#fff}
      @media(max-width:700px){body{padding:8px!important}main{padding:16px!important;border-radius:18px!important}.tabs{position:sticky;top:0;z-index:20;background:#fff;padding:6px 0;border-radius:0 0 12px 12px}.tab{font-size:14px!important}.private-tools{grid-template-columns:1fr 1fr}textarea{min-height:360px!important}}
    `;
    document.head.appendChild(style);

    // 개인 작업용 복사/저장 버튼을 결과 영역에 추가합니다.
    const result=document.querySelector('.result');
    if(result&&!document.querySelector('.private-tools')){
      const tools=document.createElement('div');tools.className='private-tools';
      tools.innerHTML='<button data-copy="title">제목 복사</button><button data-copy="body">본문 복사</button><button data-copy="tags">태그 복사</button><button class="primary-tool" id="saveDraftBtn">💾 초안 저장</button>';
      const copy=result.querySelector('#copyBtn');
      result.insertBefore(tools,copy||result.firstChild);
      const note=document.createElement('div');note.id='privateSaveNote';note.className='private-save';result.appendChild(note);
      tools.querySelectorAll('[data-copy]').forEach(btn=>btn.onclick=()=>copyField(btn.dataset.copy,btn));
      document.getElementById('saveDraftBtn').onclick=saveDraft;
    }

    // 운영 중인 실제 주소를 표시합니다.
    const urls={mingka:'https://mingka.tcflick.com/',hub:'https://hub.carpick.workers.dev/',calc:'https://flick-calc.carpick.workers.dev/'};
    function refreshUrl(){
      const active=document.querySelector('.tab.active');const link=document.querySelector('#siteInfo a');
      const url=active&&urls[active.dataset.site];
      if(link&&url){link.href=url;link.textContent=url;}
    }
    document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>setTimeout(refreshUrl,0)));
    refreshUrl();

    // 입력 내용은 자동으로 임시 저장해 새로고침에도 복구할 수 있게 합니다.
    ['title','body','tags'].forEach(id=>document.getElementById(id)?.addEventListener('input',()=>{clearTimeout(window.__draftTimer);window.__draftTimer=setTimeout(saveDraft,800)}));
    setTimeout(restoreDraft,200);
  }

  // 제목, 본문, 태그를 각각 클립보드로 복사합니다.
  async function copyField(id,button){
    const el=document.getElementById(id);if(!el)return;
    const value=el.value||'';
    try{await navigator.clipboard.writeText(value)}catch(e){el.focus();el.select();document.execCommand('copy');}
    const old=button.textContent;button.textContent='✓ 복사됨';setTimeout(()=>button.textContent=old,1000);
  }

  // 현재 결과를 브라우저에 임시 저장합니다.
  function saveDraft(){
    const data={title:document.getElementById('title')?.value||'',body:document.getElementById('body')?.value||'',tags:document.getElementById('tags')?.value||'',savedAt:new Date().toISOString()};
    if(!data.title&&!data.body)return;
    localStorage.setItem('flik_private_blog_draft_v1',JSON.stringify(data));
    const note=document.getElementById('privateSaveNote');if(note)note.textContent='✓ 초안을 이 브라우저에 저장했습니다.';
  }

  // 새로고침하면 마지막 초안을 복구합니다.
  function restoreDraft(){
    try{
      const d=JSON.parse(localStorage.getItem('flik_private_blog_draft_v1')||'null');if(!d)return;
      const title=document.getElementById('title'),body=document.getElementById('body'),tags=document.getElementById('tags');
      if(title&&!title.value)title.value=d.title||'';if(body&&!body.value)body.value=d.body||'';if(tags&&!tags.value)tags.value=d.tags||'';
      const note=document.getElementById('privateSaveNote');if(note)note.textContent='마지막 초안을 불러왔습니다.';
    }catch(e){}
  }

  installUI();

  // 글 생성 후 이미지 표식이 생기면 자동으로 이미지 작업을 시작합니다.
  setInterval(()=>{
    const body=document.getElementById('body')?.value||'';
    if(body&&body!==lastBody&&/\[IMAGE_\d+\]/.test(body)){lastBody=body;makeImages(body);}
  },700);
})();