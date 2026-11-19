import { APPLICATION_TOOLS, SKILLS } from './applicationTools.js';
import { STATE_LABELS } from '../state/AgentStore.js';
export const escapeText = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

/** Local sidebar tools. File contents stay in memory; schedules persist as configuration. */
export class WorkspacePanel {
  constructor(store, notify) {
    this.store = store; this.notify = notify; this.files = []; this.schedules = [];
    try { const saved = JSON.parse(localStorage.getItem('office-schedules') || '[]'); if (Array.isArray(saved)) this.schedules = saved.filter(s => s && typeof s.id === 'string' && typeof s.name === 'string' && /^\d{2}:\d{2}$/.test(s.time)); } catch { /* optional storage */ }
    this.dialog = document.createElement('dialog'); this.dialog.className = 'workspace-dialog'; document.body.append(this.dialog);
    this.dialog.addEventListener('close', () => this.onClose?.());
    this.dialog.addEventListener('click', event => {
      const b = event.target.closest('button'); if (!b) return; const d = b.dataset;
      if ('close' in d) this.dialog.close();
      if (d.open) this.open(d.open);
      if (d.agent) this.assign(d.agent, d.prompt);
      if ('pick' in d) this.pickFiles();
      if ('remove' in d) { const f = this.files.splice(Number(d.remove),1)[0]; if(f?.url) URL.revokeObjectURL(f.url); this.render(); }
      if (d.toggle) { const s = this.schedules.find(s=>s.id===d.toggle); if(s) s.enabled=!s.enabled; this.save(); this.render(); }
      if (d.run) { const s=this.schedules.find(s=>s.id===d.run); if(s) { this.dialog.close(); if(this.onSkill) this.onSkill(s.agent,s.name); else this.assign(s.agent,s.name); } }
      if (d.delete) { this.schedules=this.schedules.filter(s=>s.id!==d.delete); this.save(); this.render(); }
    });
  }
  save() { try { localStorage.setItem('office-schedules',JSON.stringify(this.schedules)); } catch { this.notify('存储不可用，配置仅保留在本次会话'); } }
  open(page) { this.page=page; this.render(); if(!this.dialog.open) this.dialog.showModal(); }
  assign(id,prompt) { this.dialog.close(); this.store.select(id); if(prompt) { this.store.assignTask(id,prompt); this.notify('已交代模拟任务'); } else document.querySelector('#agent-chat-input')?.focus(); }
  pickFiles() {
    const input=document.createElement('input'); input.type='file'; input.multiple=true; if(this.page==='image') input.accept='image/*';
    input.onchange=async()=> {
      for(const file of input.files) {
        const image=file.type.startsWith('image/');
        const readable=file.type.startsWith('text/') || /\.(md|txt|json|csv|js|css|html)$/i.test(file.name);
        this.files.push({name:file.name,size:file.size,image,url:image?URL.createObjectURL(file):null,text:readable?await file.slice(0,20000).text():null});
      }
      if(this.dialog.open) this.render();
    }; input.click();
  }
  render() {
    const p=this.page, agents=this.store.getSnapshot().agents;
    const titles={chat:'新建对话',clock:'定时任务',tool:'技能广场',apps:'应用',doc:'文档',image:'图库',computer:'此电脑',settings:'设置',notifications:'通知'};
    let html='';
    const skill = SKILLS.find(item => item.id === p);
    if (skill) {
      const agent = agents.find(item => item.id === skill.agent);
      titles[p] = skill.label;
      html = `<p>${skill.prompt}。补充具体要求后，交给 ${escapeText(agent.name)}。</p><form id="skill-form" class="workspace-form"><label>任务要求<textarea name="prompt" rows="5" maxlength="240" required>${escapeText(skill.prompt)}</textarea></label><button class="workspace-primary">交给 ${escapeText(agent.name)} →</button><small>提交后在对话中查看结果，运行模式以对话连接状态为准。</small></form>`;
    }
    if(p==='chat') html=`<p>选择办公室里的伙伴，直接交代任务。</p><div class="workspace-cards">${agents.map(a=>`<button data-agent="${a.id}"><strong>${a.name}</strong><span>${a.role}</span><small>${STATE_LABELS[a.state]} →</small></button>`).join('')}</div>`;
    if(p==='tool') html=`<p>选择技能，交给对应伙伴。</p><div class="workspace-cards">${SKILLS.map(skill=>`<button data-open="${skill.id}"><strong>${skill.label}</strong><span>${skill.prompt}</span><small>交给 ${skill.agent} →</small></button>`).join('')}</div>`;
    if(p==='apps') html=`<p>当前工作空间的可用工具。</p><div class="workspace-cards">${APPLICATION_TOOLS.map(([id,n])=>`<button data-open="${id}"><strong>${n}</strong><span>打开 →</span></button>`).join('')}</div>`;
    if(p==='clock') html=`<p>仅页面打开时检查时间；到点或点击立即交代后，进入后端对话。关闭页面后不会执行。不要将此功能作为后台调度展示。</p><form id="schedule-form" class="workspace-form"><label>任务内容<input name="name" required maxlength="240" placeholder="每天整理工作摘要"></label><label>伙伴<select name="agent">${agents.map(a=>`<option value="${a.id}">${a.name}</option>`).join('')}</select></label><label>每天时间<input name="time" type="time" required value="09:00"></label><button class="workspace-primary">创建自动任务</button></form><div class="schedule-list">${this.schedules.map(s=>`<article><strong>${escapeText(s.name)}</strong><small>${escapeText(s.time)} · ${escapeText(s.agent)} · ${s.enabled?'已启用':'已暂停'}</small><div><button data-toggle="${escapeText(s.id)}">${s.enabled?'暂停':'启用'}</button><button data-run="${escapeText(s.id)}">立即交代</button><button data-delete="${escapeText(s.id)}">删除</button></div></article>`).join('')||'<p>尚未创建自动任务。</p>'}</div>`;
    if(['doc','image','computer'].includes(p)) {
      const files=this.files.map((f,i)=>({...f,index:i})).filter(f=>p==='image'?f.image:p==='doc'?!f.image:true);
      html=`<p>仅查看你主动选择的文件，不扫描磁盘。文件保留在本次会话，刷新后清除。</p><button class="workspace-primary" data-pick>选择${p==='image'?'图片':'文件'}</button><div class="local-files">${files.map(f=>`<article>${f.image?`<img src="${f.url}" alt="${escapeText(f.name)}">`:''}<strong>${escapeText(f.name)}</strong><small>${(f.size/1024).toFixed(1)} KB</small>${f.text!==null?`<details><summary>文本预览</summary><pre>${escapeText(f.text)}</pre></details>`:''}<button data-remove="${f.index}">移除</button></article>`).join('')||'<p>尚未选择文件。</p>'}</div>`;
    }
    if(p==='notifications') html=`<div class="schedule-list">${this.store.getSnapshot().tasks.map(t=>`<article><strong>${escapeText(t.name)}</strong><small>${STATE_LABELS[t.status]||'已重置'} · ${new Date(t.createdAt).toLocaleString()}</small><button data-agent="${t.agentId}">查看伙伴 →</button></article>`).join('')||'<p>暂无任务通知。</p>'}</div>`;
    if(p==='settings') html='<p>聊天可连接后端运行。办公室手动操作和定时任务仍为本地演示。</p><label class="workspace-setting">动画速度<select id="preference-speed"><option value="0.5">0.5×</option><option value="1">1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label><label class="workspace-setting">暂停动画<input id="preference-pause" type="checkbox"></label>';
    this.dialog.innerHTML=`<header><h2>${titles[p]||'工作空间'}</h2><button data-close aria-label="关闭">×</button></header>${html}`;
    const form=this.dialog.querySelector('#schedule-form');
    if(form) form.onsubmit=e=>{e.preventDefault(); const d=new FormData(form); const name=String(d.get('name')).trim(); if(!name)return; this.schedules.push({id:crypto.randomUUID(),name,agent:d.get('agent'),time:d.get('time'),enabled:true,lastDate:null});this.save();this.render();};
    const skillForm = this.dialog.querySelector('#skill-form');
    if (skillForm) skillForm.onsubmit = event => { event.preventDefault(); const prompt = String(new FormData(skillForm).get('prompt')).trim(); if (prompt) { if (this.onSkill) { this.dialog.close(); this.onSkill(skill.agent, prompt); } else this.assign(skill.agent, prompt); } };
    if(p==='settings') {
      const speed=this.dialog.querySelector('#preference-speed'),control=document.querySelector('#animation-speed'); speed.value=control.value;
      speed.onchange=()=>{control.value=speed.value;control.dispatchEvent(new Event('change'));};
      const paused=this.dialog.querySelector('#preference-pause'),button=document.querySelector('#toggle-animation');paused.checked=button.getAttribute('aria-pressed')==='true';paused.onchange=()=>button.click();
    }
  }
  tick() {
    const n=new Date(),date=`${n.getFullYear()}-${n.getMonth()+1}-${n.getDate()}`,time=`${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`;
    for(const s of this.schedules) {
      if(!s.enabled||s.time!==time||s.lastDate===date||this.isBackendBusy?.())continue;
      const a=this.store.getSnapshot().agents.find(a=>a.id===s.agent);if(!a||a.taskId)continue;
      s.lastDate=date;this.save(); if(this.onSkill) this.onSkill(s.agent,s.name); else this.store.assignTask(s.agent,s.name); this.notify(`已触发页面内定时任务：${s.name}`);
    }
  }
  dispose(){this.files.forEach(f=>{if(f.url)URL.revokeObjectURL(f.url);});this.dialog.remove();}
}
