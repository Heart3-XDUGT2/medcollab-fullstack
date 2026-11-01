'use strict';

(() => {
  const el = (id) => document.getElementById(id);
  const panel = el('mask-editor');
  const baseCanvas = el('mask-base-canvas');
  const overlay = el('mask-overlay-canvas');
  const base = baseCanvas.getContext('2d');
  const paint = overlay.getContext('2d');
  let current = null;
  let generation = 0;
  const drafts = globalThis.maskDrafts;

  const workspacePath = (context, seriesId = context.seriesId) => datasetPath(context.datasetId)
    + '/segmentations/' + encodeURIComponent(seriesId);
  const alive = (context) => context === current && context.epoch === sessionEpoch
    && activeDataset?.id === context.datasetId;
  const unsaved = (context) => context && context.localChange !== context.savedChange;

  function message(text) { el('mask-message').textContent = text; }

  function freezeForIdentity(context, text) {
    context.authPaused = true;
    clearTimeout(context.saveTimer);
    if (context.stroke) finishStroke(context);
    flush().catch(() => {});
    clearTimeout(context.saveTimer);
    el('mask-original-account').textContent = context.identity?.username || '原来的账号';
    el('mask-reauth').hidden = false;
    message(text);
    updateControls();
  }

  function handleUnauthorized() {
    const context = current;
    if (!context || !alive(context) || (!unsaved(context) && !context.saving && !context.stroke?.changed)) return false;
    freezeForIdentity(context, '登录已过期。本地草稿仍会保存到 IndexedDB；上传前请在新标签页重新登录原账号。');
    return true;
  }

  async function verifyIdentity(context) {
    const session = await request('/api/session');
    if (!alive(context)) throw new ApiError('当前影像已切换，请重新打开。');
    if (!session?.loggedIn) {
      if (!handleUnauthorized()) showLogin('登录已失效，请重新登录。');
      throw new ApiError('请在新标签页重新登录原账号，再回到本页重试保存。', 401);
    }
    if (!context.identity || session.issuer !== context.identity.issuer || session.subject !== context.identity.subject) {
      freezeForIdentity(context, '当前登录的账户发生变化，未保存掩码仍保留在本页。请重新登录原账号，避免将原账号的草稿写入其他账户。');
      throw new ApiError('当前账户与这份私有草稿的原账号不一致，尚未发送绘制内容。', 403);
    }
    return session;
  }

  function encodeRuns(mask) {
    const runs = [];
    if (!mask) return runs;
    let start = -1;
    for (let index = 0; index <= mask.length; index += 1) {
      if (index < mask.length && mask[index]) {
        if (start < 0) start = index;
      } else if (start >= 0) {
        runs.push(start, index - start);
        start = -1;
      }
    }
    return runs;
  }

  function snapshotMasks(context) {
    const result = [];
    for (const source of context.seriesSources) {
      const runs = encodeRuns(context.masks.get(source.id));
      if (runs.length) result.push({instanceId: source.id, runs});
    }
    return result;
  }

  function masksFromWorkspace(context, masks) {
    if (!Array.isArray(masks)) throw new ApiError('服务器返回的掩码格式不正确。');
    const result = new Map();
    for (const item of masks) {
      const source = context.sources.get(item.instanceId);
      if (!source || source.seriesId !== context.seriesId || !Array.isArray(item.runs) || item.runs.length % 2) {
        throw new ApiError('服务器返回了不属于当前 CT 序列的掩码。');
      }
      const values = new Uint8Array(source.rows * source.columns);
      let previousEnd = 0;
      for (let index = 0; index < item.runs.length; index += 2) {
        const start = item.runs[index];
        const length = item.runs[index + 1];
        if (!Number.isInteger(start) || !Number.isInteger(length) || start < previousEnd || length <= 0
            || start + length > values.length) throw new ApiError('服务器返回的掩码像素范围不正确。');
        values.fill(1, start, start + length);
        previousEnd = start + length;
      }
      result.set(item.instanceId, values);
    }
    return result;
  }

  function checkWorkspace(workspace, seriesId) {
    if (!workspace || workspace.seriesId !== seriesId || !Number.isSafeInteger(workspace.publishedVersion)
        || workspace.publishedVersion < 0) {
      throw new ApiError('服务器返回的掩码版本信息不正确。');
    }
  }

  function applyWorkspace(context, workspace) {
    checkWorkspace(workspace, context.seriesId);
    context.masks = masksFromWorkspace(context, workspace.masks);
    context.workspace = {...workspace, hasDraft: false, baseVersion: workspace.publishedVersion};
    context.latestVersion = workspace.publishedVersion;
    context.localChange = 0;
    context.savedChange = 0;
    context.saveError = '';
    context.undo.clear();
    context.label = workspace.label || '手绘区域';
    el('mask-label').value = context.label;
    renderOverlay(context);
    renderStatus(context);
  }

  async function restoreLocal(context, workspace) {
    context.draftKey = drafts.key(context.identity, context.datasetId, context.seriesId);
    context.sourceFingerprint = drafts.fingerprint(context.seriesSources);
    let local = await drafts.read(context.draftKey);
    if (!alive(context)) return;
    // Upgrade old private Java drafts only once, after the local transaction has committed.
    const legacy = await request(workspacePath(context) + '/legacy-draft');
    if (!alive(context)) return;
    if (legacy && !local.draft) {
      local = await drafts.write(context.draftKey, local.revision, {
        baseVersion: legacy.baseVersion, label: legacy.label, masks: legacy.masks,
        sourceFingerprint: context.sourceFingerprint, publicationId: crypto.randomUUID(), legacyRevision: legacy.revision});
    }
    context.localRevision = local.revision;
    context.localDraft = local.draft;
    if (legacy) {
      if (local.draft?.legacyRevision === legacy.revision) {
        try {
          await verifyIdentity(context);
          await request(workspacePath(context) + '/legacy-draft?revision=' + legacy.revision, {method: 'DELETE'});
        } catch (error) { context.migrationWarning = '本地草稿已保存；旧 Java 草稿尚未清除：' + error.message; }
      } else context.migrationWarning = '另有旧版 Java 草稿未迁移，为避免覆盖已保留；请先备份现有草稿。';
    }
    if (!alive(context)) return;
    if (!local.draft) { renderStatus(context); return; }
    const draft = local.draft;
    if (draft.schema !== 1 || draft.sourceFingerprint !== context.sourceFingerprint) {
      context.draftConflict = true;
      context.saveError = '本地草稿与当前 CT 源文件不匹配，已保留原草稿。请确认后再放弃草稿。';
      renderStatus(context);
      return;
    }
    if (!Number.isSafeInteger(draft.baseVersion) || draft.baseVersion < 0 || typeof draft.label !== 'string')
      throw new ApiError('本地草稿格式不正确，原草稿已保留。');
    context.masks = masksFromWorkspace(context,draft.masks);
    context.workspace.hasDraft = true;
    context.workspace.baseVersion = draft.baseVersion;
    context.label = draft.label;
    el('mask-label').value = draft.label;
    renderOverlay(context);
    renderStatus(context);
  }

  function renderStatus(context) {
    if (!alive(context) || !context.workspace) return;
    const workspace = context.workspace;
    el('mask-draft-status').textContent = context.saveError
      ? '本地草稿尚未保存成功：' + context.saveError + ' 请保留本页，点击“保存私有草稿”重试。'
      : context.saving ? '正在将绘制进度保存到浏览器 IndexedDB…'
        : unsaved(context) ? '本页有尚未保存到 IndexedDB 的绘制进度…'
          : workspace.hasDraft ? '本地草稿已保存到 IndexedDB，刷新可恢复；仅保存在此浏览器，尚未上传。'
            : '当前显示已上传的掩码，没有本地草稿。';
    if (context.migrationWarning) el('mask-draft-status').textContent += ' ' + context.migrationWarning;
    const version = context.latestVersion;
    el('mask-shared-status').textContent = version > 0
      ? '共享版本：第 ' + version + ' 版'
        + (workspace.publishedBy ? '；上传者：' + workspace.publishedBy : '')
        + (workspace.publishedAt ? '；上传时间：' + new Date(workspace.publishedAt).toLocaleString() : '')
        + '。页面每 5 秒检查已上传的新版本。'
      : '共享版本：尚无上传的掩码。页面每 5 秒检查新版本。';
    const conflict = (workspace.hasDraft || unsaved(context)) && version !== workspace.baseVersion;
    context.conflict = conflict;
    el('mask-conflict-status').textContent = conflict
      ? '其他用户已上传新版本。你的私有草稿已保留，不会自动覆盖。请先记录需要保留的内容，再使用“放弃草稿并载入最新”。'
      : context.draftConflict ? '另一个窗口修改了当前账号的私有草稿。当前绘制仍保留在本页，请先处理版本冲突。' : '';
    const download = el('mask-download');
    download.hidden = !version;
    if (version) download.href = workspacePath(context) + '/file';
    else download.removeAttribute('href');
    updateControls();
  }

  function updateControls() {
    const context = current;
    const ready = context && alive(context) && context.workspace && !context.loading;
    const disabled = Boolean(busy || !ready || context?.operation || context?.authPaused);
    panel.querySelectorAll('button, input, select').forEach((control) => { control.disabled = disabled; });
    if (ready) {
      el('mask-undo').disabled = disabled || !context.source || !context.undo.has(context.source.id);
      el('mask-clear').disabled = disabled || context.draftConflict || !context.imageReady;
      const retry = context.localDraft?.publishAttempted && !unsaved(context);
      el('mask-publish').textContent = retry ? '重试保存并上传' : '保存并上传';
      el('mask-publish').disabled = disabled || (context.conflict && !retry) || context.draftConflict
        || (!context.workspace.hasDraft && !unsaved(context));
    }
    overlay.style.pointerEvents = disabled || context?.draftConflict || !context?.imageReady ? 'none' : 'auto';
    overlay.setAttribute('aria-disabled', String(disabled || !context?.imageReady));
    el('mask-download').setAttribute('aria-disabled', String(disabled));
    el('mask-download').tabIndex = disabled ? -1 : 0;
    if (context?.authPaused) {
      appSection.querySelectorAll('button, input, select').forEach((control) => { control.disabled = true; });
      el('mask-resume-save').disabled = Boolean(busy || context.operation);
      el('mask-save-draft').disabled = Boolean(busy || context.operation);
    }
  }

  function renderOverlay(context) {
    if (!context.source || !alive(context)) return;
    const source = context.source;
    if (overlay.width !== source.columns || overlay.height !== source.rows) {
      overlay.width = source.columns;
      overlay.height = source.rows;
    }
    const image = paint.createImageData(source.columns, source.rows);
    const mask = context.masks.get(source.id);
    if (mask) {
      for (let index = 0; index < mask.length; index += 1) {
        if (!mask[index]) continue;
        const offset = index * 4;
        image.data[offset] = 255;
        image.data[offset + 1] = 32;
        image.data[offset + 2] = 32;
        image.data[offset + 3] = 105;
      }
    }
    context.overlayImage = image;
    paint.putImageData(image, 0, 0);
    el('mask-slice-description').textContent = '当前序列：' + (source.seriesDescription || source.seriesId)
      + '；切片实例 ' + (source.instanceNumber || '未知') + '；像素尺寸 ' + source.columns + ' × ' + source.rows + '。';
  }

  function markChanged(context) {
    context.localChange += 1;
    context.saveError = '';
    renderStatus(context);
    clearTimeout(context.saveTimer);
    context.saveTimer = setTimeout(() => {
      if (alive(context)) flush().catch(() => { /* A visible status retains the save failure. */ });
    }, 650);
  }

  async function flush() {
    const context = current;
    if (!context || !alive(context) || !context.workspace) return;
    if (context.stroke) finishStroke(context);
    clearTimeout(context.saveTimer);
    if (context.saving) await context.saving;
    if (!alive(context) || !unsaved(context)) return;
    if (context.draftConflict) throw new ApiError('私有草稿在其他窗口发生变化，请先处理冲突。', 409);
    const save = async () => {
      while (alive(context) && unsaved(context)) {
        const change = context.localChange;
        const masks = snapshotMasks(context);
        const payload = {baseVersion: context.workspace.baseVersion,
          label: context.label.trim() || '手绘区域', masks, sourceFingerprint: context.sourceFingerprint,
          publicationId: crypto.randomUUID(), legacyRevision: context.localDraft?.legacyRevision};
        try {
          const result = await drafts.write(context.draftKey, context.localRevision, payload);
          if (!alive(context)) return;
          context.localRevision = result.revision;
          context.localDraft = result.draft;
          context.workspace.hasDraft = true;
          context.savedChange = change;
          context.saveError = '';
        } catch (error) {
          if (alive(context)) {
            context.saveError = error.message;
            if (error.status === 409) context.draftConflict = true;
            renderStatus(context);
          }
          throw error;
        }
      }
    };
    context.saving = save();
    renderStatus(context);
    try { await context.saving; }
    finally {
      context.saving = null;
      if (alive(context)) renderStatus(context);
    }
  }

  function close() {
    if (current) {
      clearTimeout(current.saveTimer);
      clearInterval(current.pollTimer);
    }
    current = null;
    generation += 1;
    panel.hidden = true;
    previewContainer.hidden = false;
    el('mask-series').replaceChildren();
    el('mask-reauth').hidden = true;
    message('');
    base.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
    paint.clearRect(0, 0, overlay.width, overlay.height);
  }

  function pause() {
    if (current) clearInterval(current.pollTimer);
  }

  async function openDataset(dataset, epoch) {
    close();
    const context = {datasetId: dataset.id, epoch, generation: ++generation, sources: new Map(), seriesSources: [],
      seriesId: null, source: null, workspace: null, masks: new Map(), undo: new Map(), localChange: 0,
      savedChange: 0, latestVersion: 0, label: '手绘区域', loading: true, imageReady: false,
      saving: null, operation: false, stroke: null, sliceSequence: 0, saveError: '', draftConflict: false,
      identity: null, authPaused: false, localRevision: 0, localDraft: null, migrationWarning: ''};
    current = context;
    const [response, session] = await Promise.all([
      request(datasetPath(dataset.id) + '/segmentation/sources'), request('/api/session')]);
    if (!alive(context)) return;
    if (!session?.loggedIn || !session.issuer || !session.subject) throw new ApiError('无法读取登录身份，请刷新页面后重新登录。');
    context.identity = {issuer: session.issuer, subject: session.subject, username: session.username};
    if (!Array.isArray(response?.items)) throw new ApiError('服务器返回的 CT 源文件列表格式不正确。');
    const series = new Map();
    for (const source of response.items) {
      if (!source.id || !source.seriesId || !Number.isInteger(source.rows) || !Number.isInteger(source.columns)
          || source.rows <= 0 || source.columns <= 0 || source.rows * source.columns > 16777216) {
        throw new ApiError('CT 像素尺寸不受当前绘制器支持。');
      }
      context.sources.set(source.id, source);
      if (!series.has(source.seriesId)) series.set(source.seriesId, []);
      series.get(source.seriesId).push(source);
    }
    for (const [id, sources] of series) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = (sources[0].seriesDescription || 'CT 序列') + '（' + sources.length + ' 张）';
      el('mask-series').append(option);
    }
    context.loading = false;
    context.pollTimer = setInterval(() => poll(context), 5000);
    updateControls();
  }

  async function showSlice(instance, image) {
    const context = current;
    if (!context || !alive(context)) return;
    if (context.authPaused) return;
    if (context.stroke) finishStroke(context);
    const sequence = ++context.sliceSequence;
    const source = context.sources.get(instance.id);
    if (!source) {
      panel.hidden = true;
      previewContainer.hidden = false;
      context.imageReady = false;
      return;
    }
    panel.hidden = false;
    previewContainer.hidden = true;
    context.imageReady = false;
    context.loading = true;
    updateControls();
    try {
      if (context.seriesId !== source.seriesId) {
        await flush();
        if (!alive(context) || sequence !== context.sliceSequence) return;
        const workspace = await request(workspacePath(context, source.seriesId));
        if (!alive(context) || sequence !== context.sliceSequence) return;
        context.seriesId = source.seriesId;
        context.seriesSources = Array.from(context.sources.values()).filter((item) => item.seriesId === source.seriesId);
        context.source = source;
        context.draftConflict = false;
        applyWorkspace(context, workspace);
        await restoreLocal(context, workspace);
        if (!alive(context) || sequence !== context.sliceSequence) return;
      } else context.source = source;
      el('mask-series').value = source.seriesId;
      renderOverlay(context);
      const drawImage = () => {
        if (!alive(context) || sequence !== context.sliceSequence) return;
        if (image.naturalWidth !== source.columns || image.naturalHeight !== source.rows) {
          context.imageReady = false;
          message('预览图像尺寸与原始 CT 不一致，已暂停绘制以避免掩码错位。');
          updateControls();
          return;
        }
        baseCanvas.width = source.columns;
        baseCanvas.height = source.rows;
        base.drawImage(image, 0, 0);
        context.imageReady = true;
        message('可在 CT 上绘制；切换切片会保留已经绘制的掩码。');
        updateControls();
      };
      if (image.complete && image.naturalWidth) drawImage();
      else {
        base.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
        image.addEventListener('load', drawImage, {once: true});
        image.addEventListener('error', () => {
          if (alive(context) && sequence === context.sliceSequence) {
            message('CT 预览读取失败，已暂停绘制。请检查连接后重试。');
            context.imageReady = false;
            updateControls();
          }
        }, {once: true});
      }
      renderStatus(context);
    } catch (error) {
      if (alive(context) && sequence === context.sliceSequence) {
        context.draftConflict = true;
        message('绘制器读取失败，原本地草稿已保留：' + error.message);
      }
    } finally {
      if (alive(context) && sequence === context.sliceSequence) {
        context.loading = false;
        updateControls();
      }
    }
  }

  async function poll(context) {
    if (!alive(context) || context.authPaused || context.polling || context.loading || context.operation || context.saving || context.stroke
        || !context.workspace || busy || document.hidden || browseSection.hidden || appSection.hidden) return;
    context.polling = true;
    const change = context.localChange;
    const seriesId = context.seriesId;
    try {
      const status = await request(workspacePath(context) + '/status');
      if (!alive(context) || context.seriesId !== seriesId) return;
      checkWorkspace(status, seriesId);
      context.latestVersion = status.publishedVersion;
      context.workspace.publishedBy = status.publishedBy;
      context.workspace.publishedAt = status.publishedAt;
      const local = await drafts.read(context.draftKey);
      if (!alive(context) || context.seriesId !== seriesId) return;
      if (local.revision !== context.localRevision) context.draftConflict = true;
      if (status.publishedVersion !== context.workspace.publishedVersion
          && !context.draftConflict && !context.workspace.hasDraft && !unsaved(context) && !context.stroke && change === context.localChange) {
        const workspace = await request(workspacePath(context));
        if (!alive(context) || context.seriesId !== seriesId || context.localChange !== change || unsaved(context) || context.stroke
            || context.workspace.hasDraft) return;
        applyWorkspace(context, workspace);
        message('已同步其他用户上传的第 ' + workspace.publishedVersion + ' 版掩码。');
      } else {
        renderStatus(context);
      }
    } catch (error) {
      if (alive(context)) message('暂时无法检查共享版本：' + error.message + ' 当前绘制会保留。');
    } finally { context.polling = false; }
  }

  function point(event) {
    const rect = overlay.getBoundingClientRect();
    return {x: Math.max(0, Math.min(overlay.width - 1, (event.clientX - rect.left) * overlay.width / rect.width)),
      y: Math.max(0, Math.min(overlay.height - 1, (event.clientY - rect.top) * overlay.height / rect.height))};
  }

  function paintPoint(context, position) {
    const source = context.source;
    let mask = context.masks.get(source.id);
    if (!mask) { mask = new Uint8Array(source.rows * source.columns); context.masks.set(source.id, mask); }
    const radius = Math.max(1, Math.min(80, Number(el('mask-brush-size').value) || 10));
    const value = el('mask-tool').value === 'eraser' ? 0 : 1;
    const startX = Math.max(0, Math.floor(position.x - radius));
    const endX = Math.min(source.columns - 1, Math.ceil(position.x + radius));
    const startY = Math.max(0, Math.floor(position.y - radius));
    const endY = Math.min(source.rows - 1, Math.ceil(position.y + radius));
    for (let y = startY; y <= endY; y += 1) {
      for (let x = startX; x <= endX; x += 1) {
        if ((x - position.x) ** 2 + (y - position.y) ** 2 > radius ** 2) continue;
        const index = y * source.columns + x;
        if (mask[index] === value) continue;
        mask[index] = value;
        const offset = index * 4;
        context.overlayImage.data[offset] = 255;
        context.overlayImage.data[offset + 1] = 32;
        context.overlayImage.data[offset + 2] = 32;
        context.overlayImage.data[offset + 3] = value ? 105 : 0;
        context.stroke.changed = true;
      }
    }
  }

  function finishStroke(context) {
    if (!context.stroke) return;
    const stroke = context.stroke;
    context.stroke = null;
    try { overlay.releasePointerCapture(stroke.pointerId); } catch { /* Pointer may already have been released. */ }
    if (stroke.changed) {
      context.undo.set(stroke.sourceId, stroke.before);
      markChanged(context);
    }
    updateControls();
  }

  overlay.addEventListener('pointerdown', (event) => {
    const context = current;
    if (!context || !alive(context) || context.authPaused || busy || context.loading || context.operation || !context.imageReady
        || !context.source || context.stroke || event.button !== 0) return;
    event.preventDefault();
    overlay.setPointerCapture(event.pointerId);
    const values = context.masks.get(context.source.id);
    const start = point(event);
    context.stroke = {pointerId: event.pointerId, sourceId: context.source.id, changed: false,
      before: values ? values.slice() : new Uint8Array(context.source.rows * context.source.columns), previous: start};
    paintPoint(context, start);
    paint.putImageData(context.overlayImage, 0, 0);
  });

  overlay.addEventListener('pointermove', (event) => {
    const context = current;
    if (!context?.stroke || context.stroke.pointerId !== event.pointerId || !alive(context)) return;
    event.preventDefault();
    const next = point(event);
    const previous = context.stroke.previous;
    const distance = Math.hypot(next.x - previous.x, next.y - previous.y);
    const radius = Math.max(1, Math.min(80, Number(el('mask-brush-size').value) || 10));
    const steps = Math.max(1, Math.ceil(distance / Math.max(1, radius / 2)));
    for (let step = 1; step <= steps; step += 1) {
      paintPoint(context, {x: previous.x + (next.x - previous.x) * step / steps,
        y: previous.y + (next.y - previous.y) * step / steps});
    }
    context.stroke.previous = next;
    paint.putImageData(context.overlayImage, 0, 0);
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    overlay.addEventListener(name, (event) => {
      if (current?.stroke?.pointerId === event.pointerId) finishStroke(current);
    });
  }

  async function operation(action, localOnly = false) {
    const context = current;
    if (!context || !alive(context) || context.operation || busy || context.loading || !context.workspace) return;
    context.operation = true;
    setBusy(true);
    try {
      if (!localOnly) await verifyIdentity(context);
      if (alive(context) && (localOnly || !context.authPaused)) await action(context);
    }
    catch (error) {
      if (alive(context)) {
        message(error.message);
        // A local CAS conflict must not be treated as a publication-version-only conflict.
        if (error.status === 409 && error.message.includes('另一个页面')) context.draftConflict = true;
        if (error.status === 409) {
          try {
            const status = await request(workspacePath(context) + '/status');
            if (alive(context)) {
              context.latestVersion = status.publishedVersion;
              renderStatus(context);
            }
          } catch { /* Retain the operation failure. */ }
        }
      }
    } finally {
      context.operation = false;
      if (alive(context)) setBusy(false);
    }
  }

  el('mask-label').addEventListener('input', () => {
    const context = current;
    if (!context || !alive(context) || busy || !context.workspace) return;
    context.label = el('mask-label').value;
    markChanged(context);
  });
  el('mask-undo').addEventListener('click', () => {
    const context = current;
    if (!context || busy || !context.source || !context.undo.has(context.source.id)) return;
    context.masks.set(context.source.id, context.undo.get(context.source.id));
    context.undo.delete(context.source.id);
    renderOverlay(context);
    markChanged(context);
  });
  el('mask-clear').addEventListener('click', () => {
    const context = current;
    if (!context || busy || !context.source || !context.imageReady) return;
    const mask = context.masks.get(context.source.id);
    if (!mask?.some((value) => value)) return;
    context.undo.set(context.source.id, mask.slice());
    context.masks.delete(context.source.id);
    renderOverlay(context);
    markChanged(context);
  });
  el('mask-save-draft').addEventListener('click', () => operation(async (context) => {
    await flush();
    if (alive(context)) message(context.workspace.hasDraft ? '草稿已保存到此浏览器的 IndexedDB，尚未上传到 Orthanc。' : '没有新的绘制进度需要保存。');
  }, true));
  el('mask-publish').addEventListener('click', () => operation(async (context) => {
    await flush();
    if (!alive(context)) return;
    if (!context.workspace.hasDraft) throw new ApiError('请先绘制掩码。');
    if (!snapshotMasks(context).length && context.workspace.publishedVersion === 0) {
      throw new ApiError('请至少绘制一个区域，再生成第一版 DICOM SEG。');
    }
    message('正在生成 DICOM SEG 并上传到 Orthanc，请等待服务器确认…');
    // Publish the exact committed local snapshot. Retry uses its stable publicationId.
    // A CAS write also detects a different tab saving after our last status check.
    const attempt = await drafts.write(context.draftKey, context.localRevision,
      {...context.localDraft, publishAttempted: true});
    context.localRevision = attempt.revision;
    context.localDraft = attempt.draft;
    const draft = attempt.draft;
    const result = await sendJson(workspacePath(context) + '/publish', 'POST', {
      expectedPublishedVersion: draft.baseVersion, label: draft.label, masks: draft.masks, publicationId: draft.publicationId});
    if (!alive(context)) return;
    try {
      const cleared = await drafts.write(context.draftKey, context.localRevision, null);
      context.localRevision = cleared.revision;
      context.localDraft = null;
    } catch (error) {
      context.saveError = '成品上传成功，但本地草稿未清除：' + error.message;
      context.draftConflict = true;
      renderStatus(context);
      message('第 ' + result.publishedVersion + ' 版已存入 Orthanc。本地草稿仍保留，请重新打开检查。');
      return;
    }
    applyWorkspace(context, result);
    message('保存并上传成功：第 ' + result.publishedVersion + ' 版已存入 Orthanc，其他可访问此影像集的用户会自动同步。');
  }));
  el('mask-reload').addEventListener('click', () => operation(async (context) => {
    if ((unsaved(context) || context.workspace.hasDraft)
        && !window.confirm('放弃当前账号在此 CT 序列的私有草稿，并载入最新已上传掩码？尚未上传的绘制会被清除。')) return;
    clearTimeout(context.saveTimer);
    if (context.saving) {
      try { await context.saving; } catch { /* The explicit discard below resolves failed private saves. */ }
    }
    const result = await request(workspacePath(context));
    if (!alive(context)) return;
    const local = await drafts.read(context.draftKey);
    // Confirm clearing the latest local revision; never delete another tab's newer work silently.
    if (local.revision !== context.localRevision && !window.confirm('另一页面更新了本地草稿，确定也要放弃这份较新的草稿吗？')) return;
    const cleared = await drafts.write(context.draftKey, local.revision, null);
    context.localRevision = cleared.revision;
    context.localDraft = null;
    context.draftConflict = false;
    applyWorkspace(context, result);
    message('已载入最新已上传掩码。');
  }));
  el('mask-series').addEventListener('change', () => {
    const context = current;
    if (!context || busy) return;
    const source = Array.from(context.sources.values()).find((item) => item.seriesId === el('mask-series').value);
    const index = source ? instances.findIndex((instance) => instance.id === source.id) : -1;
    if (index >= 0) { currentIndex = index; renderPreview(); }
  });
  el('mask-resume-save').addEventListener('click', async () => {
    const context = current;
    if (!context || !alive(context) || busy || !context.authPaused) return;
    setBusy(true);
    try {
      await verifyIdentity(context);
      if (!alive(context)) return;
      context.authPaused = false;
      el('mask-reauth').hidden = true;
      await flush();
      if (alive(context)) message('已确认原账号身份，本地草稿已保存到 IndexedDB，可以继续上传。');
    } catch (error) {
      if (alive(context)) message(error.message);
    } finally {
      if (alive(context)) setBusy(false);
    }
  });
  el('mask-download').addEventListener('click', (event) => { if (busy || current?.operation) event.preventDefault(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flush().catch(() => {});
  });
  window.addEventListener('beforeunload', (event) => {
    if (current && (unsaved(current) || current.saving || current.stroke?.changed)) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  window.maskEditor = {openDataset, showSlice, flush, close, pause, updateControls, handleUnauthorized};
})();
