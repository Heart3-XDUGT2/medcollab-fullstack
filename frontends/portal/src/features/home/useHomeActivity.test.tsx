import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useHomeActivity, type HomeActivity } from './useHomeActivity';
import { ApiError, type HomeApi, type Identity } from './api';
let host: HTMLDivElement, root: Root, model: HomeActivity;
const session = {loggedIn:true,issuer:'issuer',subject:'a',username:'a',csrfToken:'t',csrfHeaderName:'X-CSRF'};
const dataset = {id:'ct',name:'CT',access:'public',scope:'personal',ownerUsername:'',instanceCount:10,createdAt:'2026-11-04T00:00:00Z',teamId:null,teamName:null};
const page = {items:[],total:0,page:0,size:20};
const api = () => ({
  homeActivitySupported:vi.fn(async()=>true),
  getSession:vi.fn(async()=>session), listFavorites:vi.fn(async()=>({...page,items:[{dataset,favoritedAt:dataset.createdAt}],total:1})),
  listRecent:vi.fn(async()=>page), favoriteStates:vi.fn(async()=>[{datasetId:'ct',favorited:true}]),
  setFavorite:vi.fn(async()=>({})),removeRecent:vi.fn(async()=>({})),
});
function Harness({client,signal,identity,onBlocked}: {client:any;signal:AbortSignal;identity:Identity;onBlocked:any}) {
  model=useHomeActivity({enabled:true,api:client as HomeApi,identity,signal,datasetIds:['ct'],onBlocked});
  return <output>{model.favorites.items.length}</output>;
}
const pause=()=>new Promise(r=>setTimeout(r,5));
beforeEach(()=>{host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
test('loads server favorites and re-reads after a successful explicit toggle',async()=>{
  const client=api(), controller=new AbortController();
  await act(async()=>{root.render(<Harness client={client} signal={controller.signal} identity={{issuer:'issuer',subject:'a'}} onBlocked={vi.fn()}/>);await pause();});
  expect(model.favoriteIds).toEqual(['ct']);
  await act(async()=>{await model.toggleFavorite('ct');await pause();});
  expect(client.setFavorite).toHaveBeenCalledWith('ct',false,{issuer:'issuer',subject:'a'},expect.any(AbortSignal));
  expect(client.listFavorites).toHaveBeenCalledTimes(2);
});
test('a late response from a cancelled account scope is ignored',async()=>{
  const client=api(), controller=new AbortController();let resolve!: (value:any)=>void;
  client.listFavorites.mockImplementationOnce(()=>new Promise(r=>resolve=r));
  await act(async()=>{root.render(<Harness client={client} signal={controller.signal} identity={{issuer:'issuer',subject:'a'}} onBlocked={vi.fn()}/>);await pause();});
  await act(async()=>{controller.abort();resolve({...page,items:[{dataset,favoritedAt:dataset.createdAt}],total:1});await pause();});
  expect(model.favoriteIds).toEqual([]); expect(model.favorites.items).toEqual([]);
});
test('unknown write outcome disables another toggle until manual read verification',async()=>{
  const client=api(), controller=new AbortController();client.setFavorite.mockRejectedValue(new Error('断线'));
  await act(async()=>{root.render(<Harness client={client} signal={controller.signal} identity={{issuer:'issuer',subject:'a'}} onBlocked={vi.fn()}/>);await pause();});
  await act(async()=>{await model.toggleFavorite('ct');await pause();});
  expect(model.error).toContain('不会自动重试');expect(model.favoriteDisabled).toBe(true);
  await model.toggleFavorite('ct');expect(client.setFavorite).toHaveBeenCalledTimes(1);
});
test('a dataset-scoped mutation404 retains its resource meaning and is not retried',async()=>{
  const client=api(), controller=new AbortController();
  client.setFavorite.mockRejectedValue(new ApiError('资源不存在或已失去访问权限',404));
  await act(async()=>{root.render(<Harness client={client} signal={controller.signal} identity={{issuer:'issuer',subject:'a'}} onBlocked={vi.fn()}/>);await pause();});
  await act(async()=>{await model.toggleFavorite('ct');await pause();});
  expect(model.error).toContain('资源不存在或已失去访问权限');
  expect(model.error).not.toContain('接口与当前服务不匹配');
  expect(model.error).toContain('不会自动重试');
  expect(model.favoriteDisabled).toBe(true);
  await model.toggleFavorite('ct');expect(client.setFavorite).toHaveBeenCalledTimes(1);
});
test('unsupported services make no activity reads or writes',async()=>{
  const client=api(), controller=new AbortController();
  client.homeActivitySupported.mockResolvedValue(false);
  await act(async()=>{root.render(<Harness client={client} signal={controller.signal} identity={{issuer:'issuer',subject:'a'}} onBlocked={vi.fn()}/>);await pause();});
  expect(model.favorites.status).toBe('unsupported');expect(model.recent.status).toBe('unsupported');
  expect(model.favoriteDisabled).toBe(true);
  await model.toggleFavorite('ct');await model.removeRecent();
  for(const method of [client.listFavorites,client.listRecent,client.favoriteStates,client.setFavorite,client.removeRecent])
    expect(method).not.toHaveBeenCalled();
});
test.each(['favorites','recent'] as const)('a failed %s list does not erase the other list',async kind=>{
  const client=api(), controller=new AbortController();
  if(kind==='favorites') client.listFavorites.mockRejectedValue(new ApiError('资源不存在或已失去访问权限',404));
  else client.listRecent.mockRejectedValue(new ApiError('资源不存在或已失去访问权限',404));
  await act(async()=>{root.render(<Harness client={client} signal={controller.signal} identity={{issuer:'issuer',subject:'a'}} onBlocked={vi.fn()}/>);await pause();});
  const failed=kind==='favorites'?model.favorites:model.recent;
  const ready=kind==='favorites'?model.recent:model.favorites;
  expect(failed.status).toBe('failed');expect(failed.error).toContain('接口与当前服务不匹配');
  expect(failed.error).not.toContain('失去访问权限');expect(ready.status).toBe('ready');
  expect(model.favoriteDisabled).toBe(kind==='favorites');
});
test('failed states keep valid lists visible but forbid favorite writes',async()=>{
  const client=api(), controller=new AbortController();
  client.favoriteStates.mockRejectedValue(new ApiError('服务不可用',503));
  await act(async()=>{root.render(<Harness client={client} signal={controller.signal} identity={{issuer:'issuer',subject:'a'}} onBlocked={vi.fn()}/>);await pause();});
  expect(model.favorites.status).toBe('ready');expect(model.recent.status).toBe('ready');
  expect(model.error).toContain('收藏状态');expect(model.favoriteDisabled).toBe(true);
  await model.toggleFavorite('ct');expect(client.setFavorite).not.toHaveBeenCalled();
});
test('omitted batch states are unknown rather than unfavorited',async()=>{
  const client=api(), controller=new AbortController();
  client.favoriteStates.mockResolvedValue([]);
  await act(async()=>{root.render(<Harness client={client} signal={controller.signal} identity={{issuer:'issuer',subject:'a'}} onBlocked={vi.fn()}/>);await pause();});
  expect(model.favoriteDisabled).toBe(true);expect(model.error).toContain('未能确认');
  await model.toggleFavorite('ct');expect(client.setFavorite).not.toHaveBeenCalled();
});
test.each([401,403])('an activity %s blocks the account and clears independently loaded data',async status=>{
  const client=api(), controller=new AbortController(), onBlocked=vi.fn();
  client.listRecent.mockRejectedValue(new ApiError('会话失效',status));
  await act(async()=>{root.render(<Harness client={client} signal={controller.signal} identity={{issuer:'issuer',subject:'a'}} onBlocked={onBlocked}/>);await pause();});
  expect(onBlocked).toHaveBeenCalledWith(status,undefined);
  expect(model.favorites.items).toEqual([]);expect(model.favoriteIds).toEqual([]);
  expect(model.favoriteDisabled).toBe(true);
  await model.toggleFavorite('ct');await model.removeRecent();
  expect(client.setFavorite).not.toHaveBeenCalled();expect(client.removeRecent).not.toHaveBeenCalled();
});
test('an account change discovered after capability detection prevents all activity reads',async()=>{
  const client=api(), controller=new AbortController(), onBlocked=vi.fn();
  client.getSession.mockResolvedValue({...session,subject:'b'});
  await act(async()=>{root.render(<Harness client={client} signal={controller.signal} identity={{issuer:'issuer',subject:'a'}} onBlocked={onBlocked}/>);await pause();});
  expect(onBlocked).toHaveBeenCalledWith(401,'identity-changed');
  expect(client.listFavorites).not.toHaveBeenCalled();expect(client.listRecent).not.toHaveBeenCalled();
});
