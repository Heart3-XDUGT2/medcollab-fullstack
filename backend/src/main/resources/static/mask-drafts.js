'use strict';

// Shared browser-only draft store. No HTTP requests, cookies, or credentials are stored here.
(() => {
  const databaseName = 'medcollab-mask-drafts';
  const storeName = 'drafts';
  let opening;
  const fail = (message, status = 0) => Object.assign(new Error(message), {status});
  function key(identity, datasetId, seriesId) {
    if (!identity?.issuer || !identity?.subject || !datasetId || !seriesId) throw fail('无法确定草稿所属账号和 CT 序列。');
    return JSON.stringify([identity.issuer, identity.subject, datasetId, seriesId]);
  }
  function fingerprint(sources) {
    return JSON.stringify(sources.map(s => [s.id, s.sopInstanceUid, s.rows, s.columns])
      .sort((a, b) => a[0].localeCompare(b[0])));
  }
  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) { reject(fail('此浏览器不支持 IndexedDB，草稿尚未保存。')); return; }
      const request = indexedDB.open(databaseName, 1);
      let blocked = false;
      request.onupgradeneeded = () => request.result.createObjectStore(storeName, {keyPath: 'key'});
      request.onblocked = () => { blocked = true; reject(fail('浏览器草稿数据库被旧页面占用，请关闭旧页面后重试。')); };
      request.onerror = () => reject(fail('无法打开浏览器草稿数据库：' + request.error?.message));
      request.onsuccess = () => {
        if (blocked) { request.result.close(); return; }
        request.result.onversionchange = () => { request.result.close(); opening = null; };
        resolve(request.result);
      };
    }).catch(error => { opening = null; throw error; });
    return opening;
  }
  async function transaction(key, write, change) {
    const db = await open();
    return new Promise((resolve, reject) => {
      let result, problem;
      // A committed readwrite transaction is the save acknowledgement, not an individual put().
      const tx = db.transaction(storeName, write ? 'readwrite' : 'readonly');
      const store = tx.objectStore(storeName);
      const get = store.get(key);
      get.onsuccess = () => {
        try { result = change(get.result || {key, revision: 0, draft: null}, store); }
        catch (error) { problem = error; tx.abort(); }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(problem || fail('本地草稿保存失败（可能是磁盘空间不足或浏览器限制）：' + tx.error?.message));
      tx.onerror = () => { /* onabort reports transaction failures, including quota errors. */ };
    });
  }
  const read = key => transaction(key, false, record => record);
  const write = (key, expectedRevision, draft) => transaction(key, true, (record, store) => {
    if (record.revision !== expectedRevision) throw fail('另一个页面已更新此账号的本地草稿；本页内容已保留，请先处理冲突。', 409);
    if (!Number.isSafeInteger(record.revision + 1)) throw fail('本地草稿版本超出范围。');
    const next = {key, revision: record.revision + 1, draft: draft ? {...draft, schema: 1, updatedAt: new Date().toISOString()} : null};
    // Keep an empty revision after clearing to prevent stale pages from overwriting a recreated draft.
    store.put(next);
    return next;
  });
  globalThis.maskDrafts = {key, fingerprint, read, write};
})();
