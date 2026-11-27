import orders from '../orders/worker/index.mjs';
import { assets } from './assets.mjs';
import { findShot, historyApi, orderExtractId } from './history.mjs';

const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const pagePolicy = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; " +
  "img-src 'self' data:; frame-src 'self'; base-uri 'none'; form-action 'none'";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (request.method === 'GET' && Object.hasOwn(assets, path)) {
      const [body, type] = assets[path];
      return new Response(body, {headers:{
        'Content-Type': type + '; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': pagePolicy,
        'X-Content-Type-Options': 'nosniff',
      }});
    }
    if (path === '/orders') return Response.redirect(new URL('/orders/', url), 302);
    if (path === '/api/window/open' || path === '/api/window/close') return json({ok:true});
    if (path !== '/api/extractions' && !path.startsWith('/api/extractions/') && !path.startsWith('/orders/api/')) {
      return json({error:'요청을 찾을 수 없습니다.'}, 404);
    }
    // GPT Sites supplies this identity header at its authenticated ingress.
    const owner = request.headers.get('oai-authenticated-user-id');
    if (!owner) return json({error:'로그인 후 이용하세요.'}, 401);
    if (!env.DB) return json({error:'데이터 저장소에 연결할 수 없습니다.'}, 503);
    try {
      if (path.startsWith('/orders/api/')) {
        const backend = new URL(url);
        backend.pathname = path.slice('/orders'.length);
        if (path === '/orders/api/shot-extract' && request.method === 'POST') {
          if (request.headers.get('Origin') !== url.origin) return json({error:'요청 출처를 확인할 수 없습니다.'},403);
          let filename;
          try { ({filename} = await request.json()); }
          catch { return json({error:'추출 파일 이름을 확인해 주세요.'},400); }
          if (!await findShot(env.DB, owner, filename)) return json({error:'추출 기록을 찾을 수 없습니다.'},404);
          return orders.fetch(new Request(backend, {
            method: 'POST',
            headers: {'Content-Type':'application/json', Origin:url.origin, 'oai-authenticated-user-id':owner},
            body: JSON.stringify({filename,id:await orderExtractId(filename)}),
          }), env);
        }
        return orders.fetch(new Request(backend, request), env);
      }
      return await historyApi(request, env.DB, owner, url);
    } catch (error) {
      console.error('Sites data request failed:', error.name);
      return json({error:'서버 작업을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.'}, 500);
    }
  },
};
