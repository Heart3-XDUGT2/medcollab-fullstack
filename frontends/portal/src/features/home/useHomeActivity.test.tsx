import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useHomeActivity, type HomeActivity } from './useHomeActivity';
import type { HomeApi, Identity } from './api';
let host: HTMLDivElement, root: Root, model: HomeActivity;
const session = {loggedIn:true,issuer:'issuer',subject:'a',username:'a',csrfToken:'t',csrfHeaderName:'X-CSRF'};
const dataset = {id:'ct',name:'CT',access:'public',scope:'personal',ownerUsername:'',instanceCount:10,createdAt:'2026-11-04T00:00:00Z',teamId:null,teamName:null};
const page = {items:[],total:0,page:0,size:20};
const api = () => ({
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
