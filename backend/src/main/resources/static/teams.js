/* Plain test client. The API contract is independent of this UI. No passwords/tokens in storage. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const enc = encodeURIComponent;
  let identity = null, team = null, busy = false, uncertain = false, alive = true;
  const controller = new AbortController();
  addEventListener('pagehide', () => { alive = false; controller.abort(); });
  const same = s => s.loggedIn && identity && s.issuer === identity.issuer && s.subject === identity.subject;
  const show = text => { if (alive) $('status').textContent = text; };
  function assertActive() { if (!alive || controller.signal.aborted) throw new Error('页面已离开'); }
  async function json(path, options = {}) {
    assertActive();
    const r = await fetch(path, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: controller.signal, ...options });
    const body = await r.json(); assertActive();
    if (!r.ok) { const e = new Error(body.error || `请求失败（${r.status}）`); e.status = r.status; throw e; }
    return body;
  }
  async function session() {
    const s = await json('/api/session');
    if (!same(s)) {
      identity = null; team = null; $('selected').hidden = true; $('mine').replaceChildren(); $('invitation').textContent = '';
      $('account').textContent = '登录已失效或账号已变化，请登录后重新打开此页。';
      throw new Error('账号已变化，已停止操作。请重新打开页面。');
    }
    return s;
  }
  async function write(path, method, body) {
    const s = await session(); assertActive();
    const headers = { [s.csrfHeaderName]: s.csrfToken };
    let content;
    if (body instanceof FormData) content = body;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; content = JSON.stringify(body); }
    try { return await json(path, { method, headers, body: content }); }
    catch (e) {
      if (!e.status || e.status >= 500) { uncertain = true; throw new Error(`${e.message}。操作结果尚未确认，请先刷新核对，勿直接重复提交。`); }
      throw e;
    }
  }
  async function run(action, mutation = false) {
    if (busy || !identity) return;
    if (mutation && uncertain) return show('上次操作结果未确认，请先刷新团队与权限核对。');
    busy = true; $('controls').disabled = true; show('处理中…');
    try { await session(); await action(); }
    catch (e) { if (alive) show(e.message); }
    finally { busy = false; if (alive) $('controls').disabled = !identity; }
  }
  function button(text, action) { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.onclick = action; return b; }
  function li(parent, text) { const el = document.createElement('li'); el.append(document.createTextNode(text)); parent.append(el); return el; }
  async function loadMine() {
    const data = await json('/api/teams'); $('mine').replaceChildren();
    if (!data.items.length) $('mine').textContent = '尚未加入任何团队。';
    for (const t of data.items) $('mine').append(button(`${t.name}（${t.id}，${t.role === 'leader' ? '组长' : '组员'}，${t.memberCount} 人）`, () => run(async () => { await select(t.id); show('团队已载入。'); })), document.createElement('br'));
  }
  async function select(id) {
    const [t, members, datasets] = await Promise.all([json(`/api/teams/${enc(id)}`), json(`/api/teams/${enc(id)}/members`), json(`/api/teams/${enc(id)}/datasets`)]);
    if (team?.id !== id) $('invitation').textContent = '';
    team = t; $('selected').hidden = false; $('team-title').textContent = t.name;
    $('team-info').textContent = `ID：${t.id}；组长：${t.leaderUsername}；我的角色：${t.role === 'leader' ? '组长' : '组员'}`;
    $('leader').hidden = t.role !== 'leader'; $('leave').disabled = t.role === 'leader';
    $('members').replaceChildren(); $('users').replaceChildren(); $('datasets').replaceChildren(); $('upload-target').replaceChildren();
    for (const m of members.items) {
      const row = li($('members'), `${m.username}（${m.role === 'leader' ? '组长' : '组员'}） `);
      if (t.role === 'leader' && m.role !== 'leader') {
        row.append(button('移除成员', () => run(async () => {
          if (!confirm(`将 ${m.username} 移出团队？其上传仍保留，团队访问将失效。`)) return show('已取消。');
          await write(`/api/teams/${enc(t.id)}/members/${enc(m.subject)}`, 'DELETE'); await select(t.id); await loadMine(); show('成员已移除。');
        }, true)));
        row.append(button('移交组长', () => run(async () => {
          if (!confirm(`将组长移交给 ${m.username}？`)) return show('已取消。');
          await write(`/api/teams/${enc(t.id)}/transfer`, 'POST', { subject: m.subject }); await select(t.id); await loadMine(); $('invitation').textContent = ''; show('组长已移交。');
        }, true)));
      }
    }
    for (const d of datasets.items) {
      const row = li($('datasets'), `${d.name}；上传者：${d.ownerUsername}；${d.instanceCount} 个实例 `);
      const open = document.createElement('a'); open.textContent = '打开工作界面'; open.href = '/workspace?' + new URLSearchParams({ datasetId: d.id, access: d.access, intent: 'view', returnPath: '/home' }); row.append(open);
      if (d.canDelete) row.append(button('删除我的上传', () => run(async () => {
        if (!confirm(`删除「${d.name}」？团队成员将无法再打开此数据集及其发布标注。`)) return show('已取消。');
        await write(`/api/teams/${enc(t.id)}/datasets/${enc(d.id)}`, 'DELETE'); await select(t.id); show('数据集已从团队库删除。');
      }, true)));
      const option = document.createElement('option'); option.value = d.id; option.textContent = `${d.name}（${d.ownerUsername}）`; $('upload-target').append(option);
    }
    if (!datasets.items.length) li($('datasets'), '团队库暂无影像，请先创建数据集并导入。');
  }
  $('refresh').onclick = () => run(async () => {
    await loadMine(); if (team) { const id = team.id; try { await select(id); } catch (e) { if(e.status!==404) throw e; team=null; $('selected').hidden=true; } }
    uncertain = false; show('已刷新，请核对上次操作的结果。');
  });
  $('create').onsubmit = e => { e.preventDefault(); const name = e.currentTarget.elements.name.value; run(async () => {
    const r = await write('/api/teams', 'POST', { name }); await loadMine(); await select(r.team.id);
    $('invitation').textContent = `请复制保存：团队 ${r.team.name}；ID ${r.team.id}；邀请码 ${r.inviteCode}`; show('团队已创建。');
  }, true); };
  $('search').onsubmit = e => { e.preventDefault(); const q = e.currentTarget.elements.q.value; run(async () => {
    const r = await json('/api/teams/search?' + new URLSearchParams({ q })); $('search-results').replaceChildren();
    for (const t of r.items) li($('search-results'), `${t.name}；ID：${t.id}；组长：${t.leaderUsername}`).append(button('填入加入表单', () => { $('join').elements.teamId.value = t.id; $('join').elements.inviteCode.focus(); }));
    show(r.items.length ? '找到团队；自行加入仍需邀请码。' : '未找到匹配团队。');
  }); };
  $('join').onsubmit = e => { e.preventDefault(); const teamId = e.currentTarget.elements.teamId.value, inviteCode = e.currentTarget.elements.inviteCode.value; run(async () => {
    const r = await write('/api/teams/join', 'POST', { teamId, inviteCode }); $('join').elements.inviteCode.value = ''; $('invitation').textContent = ''; await loadMine(); await select(r.id); show('已加入团队。');
  }, true); };
  $('rename').onsubmit = e => { e.preventDefault(); const name = e.currentTarget.elements.name.value, id = team?.id; run(async () => { await write(`/api/teams/${enc(id)}`, 'PATCH', { name }); await loadMine(); await select(id); show('队名已修改。'); }, true); };
  $('rotate').onclick = () => { const id = team?.id; run(async () => {
    if (!confirm('生成新邀请码后，旧邀请码立即失效。继续？')) return show('已取消。');
    const r = await write(`/api/teams/${enc(id)}/invite-code`, 'POST'); $('invitation').textContent = `请复制保存：团队 ${r.team.name}；ID ${r.team.id}；新邀请码 ${r.inviteCode}`; show('新邀请码已生成。');
  }, true); };
  $('user-search').onsubmit = e => { e.preventDefault(); const q = e.currentTarget.elements.q.value, id = team?.id; run(async () => {
    const r = await json('/api/users?' + new URLSearchParams({ q })); $('users').replaceChildren();
    for (const u of r.items) li($('users'), `${u.username} `).append(button('添加进团队', () => run(async () => {
      await write(`/api/teams/${enc(id)}/members`, 'PUT', { subject: u.subject }); await select(id); await loadMine(); show('成员已添加。');
    }, true)));
    show(r.items.length ? '请选择准确的账号。' : '没有找到账号。');
  }); };
  $('leave').onclick = () => { const id = team?.id; run(async () => {
    if (!confirm('退出后将失去团队访问权限，你上传的资料继续留在团队。继续？')) return show('已取消。');
    await write(`/api/teams/${enc(id)}/leave`, 'POST'); team = null; $('selected').hidden = true; $('invitation').textContent = ''; await loadMine(); show('已退出团队。');
  }, true); };
  $('create-dataset').onsubmit = e => { e.preventDefault(); const name = e.currentTarget.elements.name.value, id = team?.id; run(async () => {
    const d = await write(`/api/teams/${enc(id)}/datasets`, 'POST', { name }); await select(id); $('upload-target').value = d.id; show('数据集已创建，可以导入 DICOM。');
  }, true); };
  async function upload(inputId) {
    const id = team?.id, datasetId = $('upload-target').value, files = Array.from($(inputId).files);
    if (!datasetId || !files.length) return show('请先选择目标数据集和文件。');
    await run(async () => {
      let complete = 0;
      try {
        for (const f of files) {
          if (!f.size || f.size > 64 * 1024 * 1024) throw new Error(`文件大小不符合要求：${f.name}`);
          show(`正在上传 ${complete + 1}/${files.length}：${f.name}`);
          const form = new FormData(); form.append('file', f); form.append('datasetId', datasetId); await write('/api/import', 'POST', form); complete++;
        }
      } catch (e) { throw new Error(`已确认 ${complete}/${files.length} 个文件完成。${e.message}`); }
      finally { $(inputId).value = ''; }
      await select(id); show(`导入完成：${complete} 个文件。`);
    }, true);
  }
  $('upload-files').onclick = () => upload('files'); $('upload-folder').onclick = () => upload('folder');
  (async () => {
    try {
      const s = await json('/api/session');
      if (!s.loggedIn) { $('account').textContent = '请先登录，再打开团队页面。'; return; }
      identity = { issuer: s.issuer, subject: s.subject }; $('account').textContent = `当前账号：${s.username}`;
      await run(async () => { await loadMine(); show('请选择团队，或创建、加入团队。'); });
    } catch (e) { show(e.message); }
  })();
})();
