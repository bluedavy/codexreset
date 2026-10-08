/* Browser-only poster generation: no upload, tracking parameter or server write. */
(() => {
  'use strict';
  const URL_GAME = 'https://reset.wowtools.ai/';
  const $ = id => document.getElementById(id);
  let posterUrl, file, generating = false, generation = 0;

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Image could not be loaded'));
      img.src = src;
    });
  }

  async function drawBeast(ctx, snapshot) {
    const original = $('boss'), clone = original.cloneNode(true);
    const log = 2 - snapshot.hits / (snapshot.hpDecayK * Math.LN10);
    // Freeze the confirmed round's expression, including during a tap animation.
    clone.dataset.mood = log >= Math.log10(50) ? 'smug' : log >= 1 ? 'annoyed' : log >= 0 ? 'nervous' : log >= -1 ? 'panicking' : log >= -2 ? 'barely' : 'alive';
    const properties = ['fill','stroke','stroke-width','stroke-linejoin','stroke-linecap','font-family','font-size','font-weight','text-anchor'];
    const originals = [original, ...original.querySelectorAll('*')];
    const clones = [clone, ...clone.querySelectorAll('*')];
    clones.forEach((el, i) => {
      const style = getComputedStyle(originals[i]);
      for (const key of properties) el.style.setProperty(key, style.getPropertyValue(key));
      el.style.animation = 'none';
      el.style.transform = 'none';
      // Resolve local gradient URLs after computed style expands them to page URLs.
      for (const key of ['fill','stroke']) {
        const value = el.style.getPropertyValue(key);
        const match = value.match(/url\(["']?[^)]*#([^"')]+)["']?\)/);
        if (match) el.style.setProperty(key, `url(#${match[1]})`);
      }
    });
    clone.style.display = 'block';
    clone.style.opacity = '1';
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', '760');
    clone.setAttribute('height', '460');
    clone.querySelector('#hp').textContent = snapshot.hp;
    clone.querySelector('#hp').style.fontSize = (snapshot.hp.length > 10 ? 18 : 25) + 'px';
    clone.querySelector('#quota-fill').setAttribute('width', Math.max(1.5, 247 * Math.pow(10, Math.max(-10, log)) / 100));
    clone.querySelectorAll('.mouth').forEach(el => el.style.display = 'none');
    const mouth = log >= Math.log10(50) ? '.smug' : log >= 1 ? '.frown' : log >= -2 ? '.worried' : '.tired';
    clone.querySelector(mouth).style.display = 'block';
    clone.querySelectorAll('.sweat').forEach(el => el.style.opacity = log < 1 && (el.classList.contains('one') || log < 0) ? '1' : '0');
    clone.querySelectorAll('.bandage,.dizzy').forEach(el => el.style.opacity = log < -1 ? '1' : '0');
    clone.querySelector('.crack').style.opacity = log < -2 ? '1' : '0';
    const src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], {type:'image/svg+xml;charset=utf-8'}));
    try { ctx.drawImage(await loadImage(src), 160, 335, 760, 460); }
    finally { URL.revokeObjectURL(src); }
  }

  async function makePoster(snapshot) {
    const canvas = document.createElement('canvas');
    canvas.width = 1080; canvas.height = 1440;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    const ink = '#1c304b', blue = '#326fba';
    const font = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const box = (x,y,w,h,r,color) => {ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();};
    const text = (value,x,y,size,color=ink,weight=700,maxWidth=920) => {
      ctx.fillStyle=color;ctx.textAlign='center';
      while (size > 16) {ctx.font=`${weight} ${size}px ${font}`;if(ctx.measureText(value).width <= maxWidth) break;size--;}
      ctx.fillText(value,x,y);
    };
    ctx.fillStyle='#fcf8eb';ctx.fillRect(0,0,1080,1440);
    box(38,38,1004,1364,40,'#fffdf4');
    ctx.strokeStyle='#d9e4ed';ctx.lineWidth=3;ctx.stroke();
    text('THE UNOFFICIAL CODEX RESET RAID',540,118,25,blue,800);
    text('JOIN THE RESET RAID',540,218,64,blue,900);
    text('Tibo, one more reset please.',540,286,36,ink,800);
    box(106,328,868,480,32,'#f3eddb');
    text('THE QUOTA BEAST',540,379,27,ink,900);
    await drawBeast(ctx, snapshot);
    box(134,805,812,94,24,'#e9f0f8');
    text(`${snapshot.fans.toLocaleString('en-US')} fans  ·  ${snapshot.hits.toLocaleString('en-US')} hits`,540,866,38,blue,800,750);
    text('Every hit counts. Bring your crew.',540,952,31,ink,700);
    const qr = await loadImage('/invite-qr.svg');
    ctx.imageSmoothingEnabled=false;ctx.drawImage(qr,392,984,296,296);
    text('SCAN TO JOIN',540,1313,24,blue,800);
    text('reset.wowtools.ai',540,1357,27,ink,800);
    const stamp = new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date());
    text(`Round snapshot · ${stamp} UTC  /  Built by Codex`,540,1384,17,'#687484',500);
    return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('PNG export failed')),'image/png'));
  }

  window.ResetRaidShare = {
    init(getSnapshot) {
      const dialog=$('share-dialog'),preview=$('share-preview'),save=$('share-save'),share=$('share-file'),note=$('share-note'),retry=$('share-retry');
      const busy = value => {generating=value;retry.disabled=value;};
      async function generate() {
        if (generating) return;
        const id=++generation,snapshot=getSnapshot();
        preview.hidden=save.hidden=share.hidden=retry.hidden=true;
        file=null;
        if(posterUrl){URL.revokeObjectURL(posterUrl);posterUrl=null;}
        if(!snapshot){note.textContent='Syncing round stats. Try again shortly, or copy the invitation link.';retry.hidden=false;return;}
        busy(true);note.textContent='Generating your poster…';
        try {
          const blob=await makePoster(snapshot);
          if(id!==generation||!dialog.open) return;
          file=new File([blob], 'codex-reset-raid.png', {type:'image/png'});
          posterUrl=URL.createObjectURL(blob);preview.src=posterUrl;save.href=posterUrl;
          preview.hidden=save.hidden=false;
          try {share.hidden=!(navigator.share&&navigator.canShare?.({files:[file]}));} catch {share.hidden=true;}
          note.textContent='Save or press and hold the image to send it to friends. Stats reflect the confirmed round at creation time.';
        } catch {
          if(id!==generation||!dialog.open) return;
          note.textContent='Could not generate the poster. Try again, or copy the invitation link.';retry.hidden=false;
        } finally {if(id===generation)busy(false);}
      }
      $('invite').addEventListener('click',()=>{dialog.showModal();generate();});
      $('share-close').addEventListener('click',()=>dialog.close());
      dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
      dialog.addEventListener('close',()=>{generation++;busy(false);if(posterUrl){URL.revokeObjectURL(posterUrl);posterUrl=null;}preview.removeAttribute('src');save.removeAttribute('href');file=null;});
      retry.addEventListener('click',generate);
      share.addEventListener('click',async()=>{
        if(!file)return;
        share.disabled=true;
        try {await navigator.share({files:[file],title:'JOIN THE RESET RAID',text:'Every hit counts. Scan to join the Codex Reset Raid!'});}
        catch(error){if(error.name!=='AbortError')note.textContent='Sharing is unavailable. Save or press and hold the image to send it.';}
        finally {share.disabled=false;}
      });
      $('share-copy').addEventListener('click',async()=>{
        try {await navigator.clipboard.writeText(URL_GAME);note.textContent='Invitation link copied. Bring your friends to the raid!';}
        catch {note.textContent='Could not copy. Copy this link: '+URL_GAME;}
      });
    }
  };
})();
